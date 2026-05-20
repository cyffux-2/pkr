import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  ensureTableStateCache,
  getCachedTableState,
  requestTableStateSnapshot,
  sendTablePlayerAction,
  watchCachedTableState,
  type TablePlayer,
  type TableEvent,
  type TableState,
  type WireCard,
} from '../lib/tableStateCache';
import {
  clearCachedPrivateCards,
  ensurePrivateCardsChannel,
  getCachedPrivateCards,
  syncPrivateCardsWithTableState,
  watchCachedPrivateCards,
} from '../lib/privateCardsCache';
import {
  dismissEliminatedTable,
  watchDismissedEliminatedTables,
} from '../lib/eliminatedTournamentDismissals';
import { getLevelIndexFromPublishedBlinds } from '../lib/tournamentLevels';
import styles from './Game.module.css';

type PlayerAction = 'FOLD' | 'CHECK' | 'CALL' | 'RAISE';

const SEATS = [
  styles.seatLeft,
  styles.seatTopLeft,
  styles.seatTop,
  styles.seatTopRight,
  styles.seatRight,
  styles.seatBottom,
];

const BET_PRESET_OPTIONS = [20, 33, 50, 75, 100, 150, 200];
const DEFAULT_BET_PRESETS = [50, 100];
const ACTION_TIMEOUT_MS = 15_000;
const ACTION_CONFIRMATION_GRACE_MS = 2_500;
const ACTION_LABELS: Record<PlayerAction, string> = {
  FOLD: 'Fold',
  CHECK: 'Check',
  CALL: 'Call',
  RAISE: 'Raise',
};
const ACTION_EVENT_LABELS: Record<string, string> = {
  FOLD: 'se couche',
  CHECK: 'check',
  CALL: 'suit',
  RAISE: 'relance',
};
const EVENT_FEED_TYPES = new Set([
  'player_action',
  'community_card',
  'blind_posted',
  'pot_update',
  'showdown_reveal',
  'showdown_payout',
  'level_changed',
  'level_pending',
  'player_eliminated',
]);

function formatCard(card: WireCard | undefined) {
  if (!card) return '?';

  const value = card._value ?? card.value;
  const color = card._color ?? card.color;
  const valueLabel = value === 1 ? 'A' : value === 13 ? 'K' : value === 12 ? 'Q' : value === 11 ? 'J' : String(value ?? '?');
  const suit = color === 0 ? '♠' : color === 1 ? '♥' : color === 2 ? '♦' : '♣';

  return `${valueLabel}${suit}`;
}

function isRedCard(card: WireCard | undefined) {
  const color = card?._color ?? card?.color;
  return color === 1 || color === 2;
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatChips(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatStack(player: TablePlayer | null | undefined, bigBlind: number | undefined, unit: 'BB' | 'C') {
  if (!player) return '';
  if (unit === 'C' || !bigBlind) return `${formatChips(player.chips)}C`;
  const stack = player.chips / bigBlind;
  return `${Number.isInteger(stack) ? stack : stack.toFixed(1)}BB`;
}

function formatBet(value: number | undefined, bigBlind: number | undefined, unit: 'BB' | 'C') {
  if (!value) return '';
  if (unit === 'C' || !bigBlind) return `${formatChips(value)}C`;
  const bet = value / bigBlind;
  return `${Number.isInteger(bet) ? bet : bet.toFixed(1)}BB`;
}

function formatInputValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getLuckMessage(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (value > 1.5) return 'très chanceux';
  if (value > 1) return 'chanceux';
  if (value < 0.5) return 'très malchanceux';
  if (value < 1) return 'malchanceux';
  return '';
}

function getConfiguredBetPresets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_BET_PRESETS;

  const presets = value
    .map(item => Number(item))
    .filter(item => BET_PRESET_OPTIONS.includes(item));

  return presets.length > 0 ? Array.from(new Set(presets)) : DEFAULT_BET_PRESETS;
}

function getPlayersClockwiseFromHero(players: (TablePlayer | null)[], heroSeatIndex: number) {
  if (heroSeatIndex < 0 || players.length === 0) {
    return players.filter((player): player is TablePlayer => Boolean(player)).slice(0, 5);
  }

  const ordered: TablePlayer[] = [];
  for (let offset = 1; offset < players.length; offset++) {
    const player = players[(heroSeatIndex + offset) % players.length];
    if (player) {
      ordered.push(player);
    }
  }

  return ordered.slice(0, 5);
}

function getUserDisplayName(user: { user_metadata?: Record<string, unknown>; email?: string } | null | undefined) {
  const metadata = user?.user_metadata ?? {};
  const name = metadata.username ?? metadata.pseudo ?? metadata.name;
  return typeof name === 'string' && name.trim() ? name : user?.email?.split('@')[0] ?? 'Toi';
}

function statusLabel(status: TableState['game_status'] | undefined) {
  if (status === 0 || status === '0' || status === 'WAITING') return 'En attente';
  if (status === 1 || status === '1' || status === 'PLAYING') return 'En cours';
  if (status === 2 || status === '2' || status === 'PAUSED') return 'En pause';
  if (status === 3 || status === '3' || status === 'ENDED') return 'Terminé';
  return 'Connexion';
}

function isTableEnded(status: TableState['game_status'] | undefined) {
  return status === 3 || status === '3' || status === 'ENDED';
}

function eventPlayerName(event: TableEvent, players: TablePlayer[], userId: string | undefined) {
  if (event.playerId && event.playerId === userId) return 'Tu';
  const player = players.find(candidate => candidate.id === event.playerId);
  return player?.name ?? (typeof event.seatIndex === 'number' ? `Joueur ${event.seatIndex + 1}` : 'Un joueur');
}

function formatTableEvent(event: TableEvent | null | undefined, players: TablePlayer[], userId: string | undefined) {
  if (!event) return '';

  const name = eventPlayerName(event, players, userId);
  switch (event.type) {
    case 'action_prompt':
      return event.playerId === userId ? 'À toi de jouer.' : `${name} réfléchit.`;
    case 'player_action': {
      const verb = event.action ? ACTION_EVENT_LABELS[event.action] ?? event.action.toLowerCase() : 'joue';
      const suffix = event.action === 'RAISE' && typeof event.value === 'number' ? ` à ${formatChips(event.value)}` : '';
      return `${name} ${verb}${suffix}.`;
    }
    case 'private_card':
      return event.playerId === userId ? 'Carte reçue.' : `Carte distribuée à ${name}.`;
    case 'community_card':
      return `Carte commune ${event.boardCount ?? '-'}/5.`;
    case 'blind_posted':
      return `${name} poste ${event.action ?? 'blind'}${typeof event.value === 'number' ? ` ${formatChips(event.value)}` : ''}.`;
    case 'pot_update':
      return 'Pot mis à jour.';
    case 'showdown_reveal':
      return 'Showdown.';
    case 'showdown_payout':
      return 'Pot attribué.';
    case 'hand_start':
      return 'Nouvelle main.';
    case 'hand_end':
      return 'Main suivante.';
    case 'level_changed':
      return `Nouveau niveau ${event.SB ?? '-'}/${event.BB ?? '-'}.`;
    case 'level_pending':
      return `Niveau suivant ${event.SB ?? '-'}/${event.BB ?? '-'} après la main.`;
    case 'player_eliminated':
      return `${name} est éliminé.`;
    case 'table_ended':
      return 'Table terminée.';
    case 'player_joined':
      return `${name} rejoint la table.`;
    case 'player_left':
      return `${name} quitte la table.`;
    default:
      return '';
  }
}

export default function Game() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tableId } = useParams();
  const { user, loading: authLoading } = useAuth();

  const [table, setTable] = useState<TableState | null>(null);
  const [privateCards, setPrivateCards] = useState<WireCard[]>([]);
  const [submittedActionRequestId, setSubmittedActionRequestId] = useState<number | null>(null);
  const [raiseTo, setRaiseTo] = useState('');
  const [feedback, setFeedback] = useState('Connexion à la table...');
  const [selectedAction, setSelectedAction] = useState<PlayerAction | null>(null);
  const [stackUnit, setStackUnit] = useState<'BB' | 'C'>('BB');
  const [actionDeadline, setActionDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [initialElo, setInitialElo] = useState<number | null>(null);
  const [currentElo, setCurrentElo] = useState<number | null>(null);
  const [heroEliminated, setHeroEliminated] = useState(false);
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());
  const [eventFeed, setEventFeed] = useState<TableEvent[]>([]);
  const tableReceivedRef = useRef(false);
  const hadHeroSeatRef = useRef(false);
  const tableRef = useRef<TableState | null>(null);
  const pendingActionTimeoutRef = useRef<number | null>(null);
  const seenEventIdsRef = useRef<Set<number>>(new Set());

  const numericTableId = Number(tableId);
  const routeState = location.state as {
    tournamentId?: number;
    autoTableSwitch?: boolean;
    autoTableSwitchDirection?: 'left' | 'right';
  } | null;
  const routeTournamentId = routeState?.tournamentId;
  const tableTournamentId = typeof table?.tournamentId === 'number' && Number.isFinite(table.tournamentId)
    ? table.tournamentId
    : null;
  const lobbyTournamentId = tableTournamentId ?? routeTournamentId;
  const resolvedTournamentId = typeof lobbyTournamentId === 'number' && Number.isFinite(lobbyTournamentId)
    ? lobbyTournamentId
    : null;
  const eliminationDismissed = Number.isFinite(numericTableId) && dismissedEliminations.has(numericTableId);
  const autoSwitchClass = routeState?.autoTableSwitch
    ? routeState.autoTableSwitchDirection === 'left'
      ? styles.pageAutoSwitchLeft
      : styles.pageAutoSwitchRight
    : '';
  const potTotal = useMemo(() => table?.pot.reduce((sum, value) => sum + value, 0) ?? 0, [table]);
  const tablePlayers = useMemo(() => (table?.players.filter(Boolean) as TablePlayer[]) ?? [], [table]);
  const heroSeatIndex = useMemo(() => table?.players.findIndex(player => player?.id === user?.id) ?? -1, [table, user]);
  const isHeroTurn = Boolean(table && heroSeatIndex >= 0 && table.playerToPlay === heroSeatIndex);
  const actionTimeLeftMs = actionDeadline ? Math.max(0, actionDeadline - now) : 0;
  const actionProgress = actionDeadline ? Math.max(0, Math.min(1, actionTimeLeftMs / ACTION_TIMEOUT_MS)) : 0;
  const currentMaxBet = useMemo(() => tablePlayers.reduce((max, player) => Math.max(max, player.bet ?? 0), 0), [tablePlayers]);
  const showOpponentCards = Boolean(table?.showdown);
  const winningPlayerIds = table?.winningPlayerIds ?? [];
  const tournamentWinnerIds = table?.tournamentWinnerIds ?? [];
  const finalWinnerIds = tournamentWinnerIds.length > 0 ? tournamentWinnerIds : winningPlayerIds;
  const activeActionRequestId = table?.actionRequestId ?? null;
  const promptAlreadySubmitted = activeActionRequestId !== null && submittedActionRequestId === activeActionRequestId;
  const canAttemptAction = isHeroTurn && !promptAlreadySubmitted;
  const lastEventFeedback = useMemo(
    () => formatTableEvent(table?.lastEvent, tablePlayers, user?.id),
    [table?.lastEvent, tablePlayers, user?.id],
  );
  const heroEloResult = user?.id ? table?.eloResults?.[user.id] : undefined;
  const displayedInitialElo = heroEloResult?.initialElo ?? initialElo;
  const displayedCurrentElo = heroEloResult?.newElo ?? currentElo;
  const eloDelta = displayedInitialElo !== null && displayedCurrentElo !== null ? displayedCurrentElo - displayedInitialElo : null;
  const luckMessage = getLuckMessage(heroEloResult?.chanceMultiplier);
  const luckMessageText = luckMessage ? `, ${luckMessage}` : '';
  const heroWonTournament = Boolean(
    user?.id &&
    !eliminationDismissed &&
    isTableEnded(table?.game_status) &&
    finalWinnerIds.includes(user.id)
  );
  const betPresets = useMemo(
    () => getConfiguredBetPresets(user?.user_metadata?.bet_presets),
    [user?.user_metadata?.bet_presets],
  );
  const isWinningPlayer = (player: TablePlayer | null | undefined) => Boolean(player?.id && winningPlayerIds.includes(player.id));
  const visiblePlayers = useMemo(() => {
    const hero = tablePlayers.find(player => player.id === user?.id) ?? (heroSeatIndex >= 0 ? table?.players[heroSeatIndex] ?? null : null);
    const opponents = getPlayersClockwiseFromHero(table?.players ?? [], heroSeatIndex);
    return {
      opponents,
      hero,
    };
  }, [heroSeatIndex, table, tablePlayers, user?.id]);
  const heroHasCards = Boolean(visiblePlayers.hero?.has_cards);
  const checkOrCallAction: PlayerAction = currentMaxBet > (visiblePlayers.hero?.bet ?? 0) ? 'CALL' : 'CHECK';
  const currentLevel = (getLevelIndexFromPublishedBlinds(table?.SB, table?.BB) ?? 0) + 1;
  const getPresetRaiseToChips = (percent: number) => {
    const heroBet = visiblePlayers.hero?.bet ?? 0;
    const heroChips = visiblePlayers.hero?.chips ?? 0;
    const bigBlind = table?.BB ?? 50;
    const raiseBase = potTotal > 0 ? Math.round((potTotal * percent) / 100) : bigBlind;
    const minRaiseTo = currentMaxBet > 0 ? currentMaxBet + bigBlind : bigBlind;
    const target = Math.max(minRaiseTo, currentMaxBet + raiseBase);
    return Math.min(heroBet + heroChips, target);
  };
  const getAllInRaiseToChips = () => {
    const heroBet = visiblePlayers.hero?.bet ?? 0;
    const heroChips = visiblePlayers.hero?.chips ?? 0;
    return heroBet + heroChips;
  };
  const formatRaiseInputFromChips = (amount: number) => {
    const bigBlind = table?.BB ?? 50;
    return stackUnit === 'BB' ? formatInputValue(amount / bigBlind) : formatInputValue(amount);
  };
  const parseRaiseInputToChips = () => {
    const parsed = Number.parseFloat(raiseTo.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return stackUnit === 'BB' ? Math.round(parsed * (table?.BB ?? 50)) : Math.round(parsed);
  };
  const toggleStackUnit = () => {
    const currentChips = parseRaiseInputToChips();
    setStackUnit(current => {
      const next = current === 'BB' ? 'C' : 'BB';
      if (currentChips) {
        const nextValue = next === 'BB' ? currentChips / (table?.BB ?? 50) : currentChips;
        setRaiseTo(formatInputValue(nextValue));
      }
      return next;
    });
  };
  const clearPendingActionTimeout = useCallback(() => {
    if (pendingActionTimeoutRef.current === null) return;
    window.clearTimeout(pendingActionTimeoutRef.current);
    pendingActionTimeoutRef.current = null;
  }, []);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  useEffect(() => () => {
    clearPendingActionTimeout();
  }, [clearPendingActionTimeout]);

  useEffect(() => {
    if (!user) {
      setDismissedEliminations(new Set());
      return;
    }

    return watchDismissedEliminatedTables(user.id, setDismissedEliminations);
  }, [user]);

  useEffect(() => {
    clearPendingActionTimeout();
    hadHeroSeatRef.current = false;
    setPrivateCards([]);
    setHeroEliminated(false);
    setCurrentElo(null);
    setSubmittedActionRequestId(null);
    setEventFeed([]);
    seenEventIdsRef.current.clear();
  }, [clearPendingActionTimeout, numericTableId]);

  useEffect(() => {
    const events = table?.events ?? (table?.lastEvent ? [table.lastEvent] : []);
    if (events.length === 0) return;

    setEventFeed(current => {
      const next = [...current];
      let changed = false;

      for (const event of events) {
        if (typeof event.id !== 'number' || seenEventIdsRef.current.has(event.id)) continue;

        seenEventIdsRef.current.add(event.id);
        if (!EVENT_FEED_TYPES.has(event.type)) continue;

        next.push(event);
        changed = true;
      }

      return changed ? next.slice(-8) : current;
    });
  }, [table?.events, table?.lastEvent]);

  useEffect(() => {
    if (!user || !Number.isFinite(numericTableId)) {
      setPrivateCards([]);
      return;
    }

    setPrivateCards(getCachedPrivateCards(numericTableId, user.id));
    void ensurePrivateCardsChannel(numericTableId, user.id);

    return watchCachedPrivateCards(numericTableId, user.id, setPrivateCards);
  }, [numericTableId, user]);

  useEffect(() => {
    if (!user || !Number.isFinite(numericTableId)) return;
    syncPrivateCardsWithTableState(numericTableId, user.id, table);
  }, [numericTableId, table, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setInitialElo(null);
    setCurrentElo(null);

    const fetchInitialElo = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('elo')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!cancelled) {
        const elo = (data as { elo?: number } | null)?.elo;
        if (typeof elo === 'number') {
          setInitialElo(elo);
          setCurrentElo(elo);
        }
      }
    };

    void fetchInitialElo();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!heroEloResult) return;
    setInitialElo(heroEloResult.initialElo);
    setCurrentElo(heroEloResult.newElo);
  }, [heroEloResult]);

  useEffect(() => {
    if (!user || !table) return;

    if (eliminationDismissed) {
      if (heroEliminated) {
        setHeroEliminated(false);
      }
      return;
    }

    if (table.players.length === 0) return;

    const heroOnTable = table.players.some(player => player?.id === user.id);
    if (heroOnTable) {
      hadHeroSeatRef.current = true;
      if (heroEliminated) {
        setHeroEliminated(false);
      }
      return;
    }

    if ((hadHeroSeatRef.current || resolvedTournamentId !== null) && !heroEliminated) {
      setHeroEliminated(true);
      setActionDeadline(null);
      setFeedback('Tu es éliminé. Mode spectateur.');
    }
  }, [eliminationDismissed, heroEliminated, resolvedTournamentId, table, user]);

  useEffect(() => {
    if ((!heroEliminated && !heroWonTournament) || !user) return;

    let cancelled = false;
    let attempts = 0;
    let interval: number | undefined;

    const refreshElo = async () => {
      attempts++;
      const { data } = await supabase
        .from('profiles')
        .select('elo')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      const elo = (data as { elo?: number } | null)?.elo;
      if (typeof elo === 'number') {
        setCurrentElo(elo);
        if (initialElo !== null && elo !== initialElo && interval) {
          window.clearInterval(interval);
          interval = undefined;
        }
      }

      if (attempts >= 15 && interval) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };

    void refreshElo();
    interval = window.setInterval(refreshElo, 2000);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [heroEliminated, heroWonTournament, initialElo, user]);

  useEffect(() => {
    setSubmittedActionRequestId(current => {
      const nextActionRequestId = table?.actionRequestId ?? null;
      const isStillPending = isHeroTurn && nextActionRequestId !== null && current === nextActionRequestId;
      if (!isStillPending && current !== null) {
        clearPendingActionTimeout();
      }
      return isStillPending ? current : null;
    });
  }, [clearPendingActionTimeout, isHeroTurn, table?.actionRequestId]);

  useEffect(() => {
    if (canAttemptAction) {
      setActionDeadline(current => current && current > Date.now() ? current : Date.now() + ACTION_TIMEOUT_MS);
    } else {
      setActionDeadline(null);
    }
  }, [canAttemptAction, table?.playerToPlay]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/');
      return;
    }
    if (!Number.isFinite(numericTableId)) {
      setFeedback('Table introuvable.');
      return;
    }

    let mounted = true;
    let stateTimeout: number | undefined;

    const setup = async () => {
      tableReceivedRef.current = false;
      setFeedback('Connexion à la table...');

      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return undefined;
      if (!session?.access_token) {
        navigate('/login');
        return;
      }

      supabase.realtime.setAuth(session.access_token);

      const cached = getCachedTableState(numericTableId);
      if (cached) {
        setTable(cached);
        tableReceivedRef.current = true;
        setFeedback('');
      }

      const unwatchCache = watchCachedTableState(numericTableId, state => {
        if (!mounted) return;
        tableReceivedRef.current = true;
        setTable(state);
        setFeedback('');
      });

      void ensureTableStateCache(numericTableId);
      void ensurePrivateCardsChannel(numericTableId, user.id);

      stateTimeout = window.setTimeout(() => {
        if (mounted && !tableReceivedRef.current) {
          setFeedback("En attente de l'état de la table...");
          void ensureTableStateCache(numericTableId);
        }
      }, 8000);

      return unwatchCache;
    };

    let cleanupWatch: (() => void) | undefined;
    void setup().then(cleanup => {
      cleanupWatch = cleanup;
    });

    return () => {
      mounted = false;
      cleanupWatch?.();
      if (stateTimeout) window.clearTimeout(stateTimeout);
    };
  }, [authLoading, navigate, numericTableId, user]);

  const sendAction = async (action: PlayerAction) => {
    if (!user) return;
    setSelectedAction(action);
    window.setTimeout(() => setSelectedAction(current => current === action ? null : current), 180);

    if (promptAlreadySubmitted) {
      setFeedback('Action déjà envoyée.');
      requestTableStateSnapshot(numericTableId);
      return;
    }
    if (!isHeroTurn) {
      setFeedback("Ce n'est pas à toi de jouer.");
      requestTableStateSnapshot(numericTableId);
      return;
    }

    const payload: Record<string, unknown> = {
      action,
      playerId: user.id,
    };
    const latestTable = tableRef.current;
    const currentActionRequestId = typeof latestTable?.actionRequestId === 'number' ? latestTable.actionRequestId : null;
    const currentTurnId = typeof latestTable?.turnId === 'number' ? latestTable.turnId : null;
    if (currentTurnId !== null) payload.turnId = currentTurnId;
    if (currentActionRequestId !== null) payload.actionRequestId = currentActionRequestId;

    if (action === 'CALL') payload.amount = 0;
    if (action === 'RAISE') {
      const parsed = parseRaiseInputToChips();
      if (!parsed) {
        setFeedback('Entre un montant de relance valide.');
        return;
      }
      payload.raiseTo = parsed;
    }

    setSubmittedActionRequestId(currentActionRequestId);
    setActionDeadline(null);
    setFeedback('Action envoyée.');
    clearPendingActionTimeout();

    let sendStatus: string;
    try {
      sendStatus = await sendTablePlayerAction(numericTableId, payload);
    } catch {
      sendStatus = 'send_error';
    }

    if (sendStatus !== 'ok') {
      clearPendingActionTimeout();
      setFeedback("Connexion action en cours, réessaie dans un instant.");
      setSubmittedActionRequestId(null);
      return;
    }

    if (action === 'FOLD') {
      clearCachedPrivateCards(numericTableId, user.id);
      setPrivateCards([]);
    }

    if (currentActionRequestId !== null) {
      pendingActionTimeoutRef.current = window.setTimeout(() => {
        pendingActionTimeoutRef.current = null;
        requestTableStateSnapshot(numericTableId);

        const latestTable = tableRef.current;
        const latestHeroSeat = latestTable?.players.findIndex(player => player?.id === user.id) ?? -1;
        if (
          latestTable?.actionRequestId === currentActionRequestId &&
          latestTable.playerToPlay === latestHeroSeat
        ) {
          setSubmittedActionRequestId(null);
          setFeedback('Confirmation non reçue, tu peux réessayer.');
        }
      }, ACTION_CONFIRMATION_GRACE_MS);
    }
  };

  const quitEliminatedTournament = () => {
    if (user && Number.isFinite(numericTableId)) {
      dismissEliminatedTable(user.id, numericTableId);
    }

    setHeroEliminated(false);
    setFeedback('');
    navigate('/tournaments');
  };

  return (
    <div key={numericTableId} className={`${styles.page} ${autoSwitchClass}`}>
      <button className={`${styles.iconButton} ${styles.homeButton}`} onClick={() => navigate('/tournaments')} aria-label="Retour aux tournois">
        <span />
      </button>
      <button
        className={`${styles.iconButton} ${styles.lobbyButton}`}
        onClick={() => navigate(lobbyTournamentId ? `/tournament-lobby/${lobbyTournamentId}` : '/tournaments')}
        aria-label="Lobby du tournoi"
      >
        <span />
      </button>

      <main className={styles.arena}>
        <section className={styles.table}>
          <div className={styles.outerRail} />
          <div className={styles.innerFelt}>
            <div className={styles.board}>
              <div className={styles.communityCards}>
                {Array.from({ length: 5 }).map((_, index) => {
                  const card = table?.common_cards[index];
                  return (
                    <div key={index} className={`${styles.card} ${styles.boardCard} ${card ? styles.cardVisible : styles.cardSlot} ${isRedCard(card) ? styles.redCard : ''}`}>
                      {card ? formatCard(card) : ''}
                    </div>
                  );
                })}
              </div>
              {potTotal > 0 && <div className={styles.pot}>Pot {formatBet(potTotal, table?.BB, stackUnit)}</div>}
            </div>
          </div>
        </section>

        {visiblePlayers.opponents.map((player, index) => {
          const tableIndex = table?.players.findIndex(candidate => candidate?.id === player.id) ?? -1;
          return (
            <div
              key={player.id ?? index}
              className={`${styles.player} ${SEATS[index] ?? styles.seatTop} ${table?.playerToPlay === tableIndex ? styles.playerActive : ''} ${isWinningPlayer(player) ? styles.playerWinner : ''}`}
            >
              <div className={styles.avatar}>{(player.name ?? '?').slice(0, 1).toUpperCase()}</div>
              <div className={styles.opponentCards}>
                {[0, 1].map(cardIndex => {
                  const card = showOpponentCards ? player.cards?.[cardIndex] : undefined;
                  return (
                    <div key={cardIndex} className={`${styles.card} ${styles.smallCard} ${card ? styles.cardVisible : player.has_cards ? styles.cardBack : styles.cardSlot} ${isRedCard(card) ? styles.redCard : ''}`}>
                      {card ? formatCard(card) : ''}
                    </div>
                  );
                })}
              </div>
              {player.bet ? <div className={styles.bet}>{formatBet(player.bet, table?.BB, stackUnit)}</div> : null}
              <div className={styles.playerName}>{player.name ?? 'Joueur'}</div>
              <div className={styles.playerStack}>{formatStack(player, table?.BB, stackUnit)}</div>
              {table?.button === tableIndex && <div className={styles.dealer}>D</div>}
            </div>
          );
        })}

        {visiblePlayers.hero && !heroEliminated && (
          <div className={`${styles.player} ${styles.heroPlayer} ${isHeroTurn ? styles.playerActive : ''} ${isWinningPlayer(visiblePlayers.hero) ? styles.playerWinner : ''}`}>
            {visiblePlayers.hero.bet ? <div className={styles.bet}>{formatBet(visiblePlayers.hero.bet, table?.BB, stackUnit)}</div> : null}
            <div className={styles.heroCards}>
              {[0, 1].map(index => {
                const card = heroHasCards ? privateCards[index] ?? visiblePlayers.hero?.cards?.[index] : undefined;
                return (
                  <div key={index} className={`${styles.card} ${styles.heroCard} ${card ? styles.cardVisible : heroHasCards ? styles.cardBack : styles.cardSlot} ${isRedCard(card) ? styles.redCard : ''}`}>
                    {card ? formatCard(card) : ''}
                  </div>
                );
              })}
            </div>
            <div className={styles.heroInfo}>
              <div className={styles.playerName}>{visiblePlayers.hero.name ?? getUserDisplayName(user)}</div>
              <div className={styles.playerStack}>{formatStack(visiblePlayers.hero, table?.BB, stackUnit) || '-'}</div>
            </div>
          </div>
        )}

        {visiblePlayers.hero && !heroEliminated && table?.button === heroSeatIndex && (
          <div className={`${styles.dealer} ${styles.heroDealer}`}>D</div>
        )}

        {(heroEliminated || heroWonTournament) && (
          <div className={`${styles.eliminationNotice} ${heroWonTournament ? styles.victoryNotice : ''}`}>
            <strong>{heroWonTournament ? 'Victoire' : 'Éliminé'}</strong>
            <span>
              {eloDelta === null
                ? 'ELO en cours...'
                : `ELO ${displayedInitialElo ?? '-'} -> ${displayedCurrentElo ?? '-'} (${eloDelta > 0 ? '+' : ''}${eloDelta}${luckMessageText})`}
            </span>
            <small>{heroWonTournament ? 'Tournoi terminé' : 'Mode spectateur'}</small>
            <button className={styles.eliminationQuitButton} onClick={quitEliminatedTournament}>
              Quitter
            </button>
          </div>
        )}

        <section className={styles.controls} aria-label="Actions">
          {canAttemptAction && (
            <div className={styles.actionTimer} style={{ '--action-progress': actionProgress } as CSSProperties}>
              <span>{formatClock(actionTimeLeftMs)}</span>
              <div />
            </div>
          )}
          <div className={styles.presetRow}>
            {betPresets.map(percent => (
              <button key={percent} className={styles.presetBtn} onClick={() => setRaiseTo(formatRaiseInputFromChips(getPresetRaiseToChips(percent)))}>
                {percent}%
              </button>
            ))}
            <button className={`${styles.presetBtn} ${styles.allInPresetBtn}`} onClick={() => setRaiseTo(formatRaiseInputFromChips(getAllInRaiseToChips()))}>
              All-in
            </button>
          </div>
          <div className={styles.actionRow}>
            {(['FOLD', checkOrCallAction, 'RAISE'] as PlayerAction[]).map(action => (
              <button
                key={action}
                className={`${styles.actionBtn} ${selectedAction === action ? styles.actionBtnSelected : ''} ${!canAttemptAction ? styles.actionBtnDisabled : ''}`}
                aria-disabled={!canAttemptAction}
                onClick={() => sendAction(action)}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
            <div className={styles.amountAction}>
              <input
                className={styles.raiseInput}
                value={raiseTo}
                onChange={event => setRaiseTo(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void sendAction('RAISE');
                }}
                placeholder="Relance"
                inputMode="numeric"
                aria-label="Montant de relance"
                disabled={!canAttemptAction}
              />
            </div>
          </div>
          <p className={styles.feedback}>{feedback || lastEventFeedback || (canAttemptAction ? 'À toi de jouer.' : isHeroTurn ? 'Préparation de ton action...' : 'En attente des autres joueurs.')}</p>
          {eventFeed.length > 0 && (
            <ol className={styles.eventFeed} aria-live="polite">
              {eventFeed.map(event => {
                const label = formatTableEvent(event, tablePlayers, user?.id);
                if (!label) return null;
                return <li key={event.id}>{label}</li>;
              })}
            </ol>
          )}
        </section>

        <footer className={styles.tableInfo}>
          <span>{statusLabel(table?.game_status)}</span>
          <span>Niveau {currentLevel} : {table?.SB ?? '-'}/{table?.BB ?? '-'}</span>
          <button className={styles.unitToggle} onClick={toggleStackUnit}>
            {stackUnit}
          </button>
        </footer>
      </main>
    </div>
  );
}
