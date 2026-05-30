import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  ensureTableStateCache,
  getCachedTableState,
  refreshTableStateConnection,
  requestTableStateSnapshot,
  sendTablePlayerAction,
  sendTablePlayerReturn,
  watchCachedTableState,
  type TablePlayer,
  type TableState,
  type WireCard,
} from '../lib/tableStateCache';
import {
  clearCachedPrivateCards,
  getCachedPrivateCards,
  refreshPrivateCards,
  syncPrivateCardsWithTableState,
  watchCachedPrivateCards,
} from '../lib/privateCardsCache';
import {
  dismissEliminatedTable,
  watchDismissedEliminatedTables,
} from '../lib/eliminatedTournamentDismissals';
import {
  getActiveTablesForUser,
  watchActiveTablesForUser,
  type ActiveTableEntry,
} from '../lib/activeTablesRegistry';
import {
  getShortcutIdByKey,
  isEditableShortcutTarget,
  normalizeKeyboardEventKey,
  sanitizeShortcuts,
} from '../lib/shortcuts';
import { getLevelIndexFromPublishedBlinds } from '../lib/tournamentLevels';
import PlayerAvatar from '../components/PlayerAvatar';
import { TournamentTableTab } from '../components/TournamentTableTab';
import styles from './Game.module.css';
import tableTabStyles from './Tournaments.module.css';

type PlayerAction = 'FOLD' | 'CHECK' | 'CALL' | 'RAISE';

type PlayerAvatarProfile = {
  user_id: string;
  avatar_url: string | null;
};

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
const PREFLOP_BET_PRESET_OPTIONS = [2, 2.5, 3, 3.5, 4, 5];
const DEFAULT_PREFLOP_BET_PRESETS = [2.5, 3];
const ACTION_TIMEOUT_MS = 15_000;
const ACTION_CONFIRMATION_GRACE_MS = 2_500;
const ACTION_LABELS: Record<PlayerAction, string> = {
  FOLD: 'Fold',
  CHECK: 'Check',
  CALL: 'Call',
  RAISE: 'Raise',
};
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

function cardKey(card: WireCard | undefined) {
  if (!card) return '';
  return `${card._color ?? card.color ?? ''}:${card._value ?? card.value ?? ''}`;
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

function formatExactInputValue(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
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

function getConfiguredPreflopBetPresets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PREFLOP_BET_PRESETS;

  const presets = value
    .map(item => Number(item))
    .filter(item => PREFLOP_BET_PRESET_OPTIONS.includes(item));

  return presets.length > 0 ? Array.from(new Set(presets)) : DEFAULT_PREFLOP_BET_PRESETS;
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

function getTournamentReturnPath(tableEntry: ActiveTableEntry, fallback: string) {
  const name = tableEntry.tournamentName?.trim() ?? '';
  if (/^triple\s+(normal|turbo)$/i.test(name)) return '/trio';
  if (/^headup\s+(normal|turbo)$/i.test(name)) return '/headup';
  if (typeof tableEntry.maxPlayers === 'number' && tableEntry.maxPlayers <= 8) return '/sng';
  if (typeof tableEntry.maxPlayers === 'number' && tableEntry.maxPlayers > 8) return '/tournaments';
  return fallback;
}

export default function Game() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tableId } = useParams();
  const { user, loading: authLoading, profile, updateCachedProfile } = useAuth();

  const [table, setTable] = useState<TableState | null>(null);
  const [privateCards, setPrivateCards] = useState<WireCard[]>([]);
  const [submittedActionRequestId, setSubmittedActionRequestId] = useState<number | null>(null);
  const [raiseTo, setRaiseTo] = useState('');
  const [exactAllInRaiseTo, setExactAllInRaiseTo] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('Connexion à la table...');
  const [selectedAction, setSelectedAction] = useState<PlayerAction | null>(null);
  const [stackUnit, setStackUnit] = useState<'BB' | 'C'>('BB');
  const [actionDeadline, setActionDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [initialElo, setInitialElo] = useState<number | null>(null);
  const [currentElo, setCurrentElo] = useState<number | null>(null);
  const [heroEliminated, setHeroEliminated] = useState(false);
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());
  const [playerAvatarsById, setPlayerAvatarsById] = useState<Record<string, string | null>>({});
  const [activeTables, setActiveTables] = useState<ActiveTableEntry[]>(() => (
    user?.id ? getActiveTablesForUser(user.id) : []
  ));
  const tableReceivedRef = useRef(false);
  const hadHeroSeatRef = useRef(false);
  const tableRef = useRef<TableState | null>(null);
  const profileEloRef = useRef<number | null>(typeof profile?.elo === 'number' ? profile.elo : null);
  const pendingActionTimeoutRef = useRef<number | null>(null);

  const numericTableId = Number(tableId);
  const routeState = location.state as {
    tournamentId?: number;
    autoTableSwitch?: boolean;
    autoTableSwitchDirection?: 'left' | 'right';
    returnTo?: string;
  } | null;
  const routeTournamentId = routeState?.tournamentId;
  const tournamentListPath = routeState?.returnTo === '/sng' || routeState?.returnTo === '/trio' || routeState?.returnTo === '/headup'
    ? routeState.returnTo
    : '/tournaments';
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
  const switchableTables = useMemo(
    () => activeTables
      .filter(activeTable => Number.isFinite(activeTable.tableId) && !dismissedEliminations.has(activeTable.tableId))
      .sort((left, right) => {
        const leftTime = left.startDate ? new Date(left.startDate).getTime() : 0;
        const rightTime = right.startDate ? new Date(right.startDate).getTime() : 0;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.tableId - right.tableId;
      }),
    [activeTables, dismissedEliminations],
  );
  const showTableSwitcher = switchableTables.length >= 2;
  const potTotal = useMemo(() => table?.pot.reduce((sum, value) => sum + value, 0) ?? 0, [table]);
  const tablePlayers = useMemo(() => (table?.players.filter(Boolean) as TablePlayer[]) ?? [], [table]);
  const tablePlayerIdsKey = useMemo(
    () => tablePlayers
      .map(player => player.id)
      .filter((playerId): playerId is string => typeof playerId === 'string')
      .sort()
      .join('|'),
    [tablePlayers],
  );
  const heroSeatIndex = useMemo(() => table?.players.findIndex(player => player?.id === user?.id) ?? -1, [table, user]);
  const isHeroTurn = Boolean(table && heroSeatIndex >= 0 && table.playerToPlay === heroSeatIndex);
  const heroAbsent = Boolean(user?.id && (
    table?.players[heroSeatIndex]?.absent ||
    table?.absentPlayerIds?.includes(user.id)
  ));
  const currentMaxBet = useMemo(() => tablePlayers.reduce((max, player) => Math.max(max, player.bet ?? 0), 0), [tablePlayers]);
  const showOpponentCards = Boolean(table?.showdown);
  const winningPlayerIds = table?.winningPlayerIds ?? [];
  const winningCardKeysByPlayerId = useMemo(() => {
    const entries = Object.entries(table?.winningCardsByPlayerId ?? {});
    return Object.fromEntries(entries.map(([playerId, cards]) => [playerId, new Set(cards.map(cardKey))]));
  }, [table?.winningCardsByPlayerId]);
  const winningBoardCardKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.values(winningCardKeysByPlayerId).forEach(playerKeys => {
      table?.common_cards.forEach(card => {
        const key = cardKey(card);
        if (playerKeys.has(key)) keys.add(key);
      });
    });
    return keys;
  }, [table?.common_cards, winningCardKeysByPlayerId]);
  const tournamentWinnerIds = table?.tournamentWinnerIds ?? [];
  const finalWinnerIds = tournamentWinnerIds.length > 0 ? tournamentWinnerIds : winningPlayerIds;
  const activeActionRequestId = table?.actionRequestId ?? null;

  useEffect(() => {
    if (!tablePlayerIdsKey) {
      setPlayerAvatarsById({});
      return;
    }

    let cancelled = false;
    const playerIds = tablePlayerIdsKey.split('|').filter(Boolean);

    supabase
      .from('profiles')
      .select('user_id, avatar_url')
      .in('user_id', playerIds)
      .then(({ data, error }) => {
        if (cancelled || error) return;

        const nextAvatars = ((data ?? []) as PlayerAvatarProfile[]).reduce<Record<string, string | null>>((avatars, profile) => {
          avatars[profile.user_id] = profile.avatar_url;
          return avatars;
        }, {});
        setPlayerAvatarsById(nextAvatars);
      });

    return () => {
      cancelled = true;
    };
  }, [tablePlayerIdsKey]);
  const promptAlreadySubmitted = activeActionRequestId !== null && submittedActionRequestId === activeActionRequestId;
  const canAttemptAction = isHeroTurn && !promptAlreadySubmitted && !heroAbsent;
  const backendActionDeadline = typeof table?.actionDeadlineAt === 'number' ? table.actionDeadlineAt : null;
  const activeActionDeadline = backendActionDeadline ?? actionDeadline;
  const activeActionStartedAt = typeof table?.actionStartedAt === 'number' ? table.actionStartedAt : null;
  const activeActionBaseTimeMs = typeof table?.actionBaseTimeMs === 'number' ? table.actionBaseTimeMs : ACTION_TIMEOUT_MS;
  const activeActionTimebankMs = typeof table?.actionTimebankMs === 'number'
    ? table.actionTimebankMs
    : activeActionStartedAt !== null && activeActionDeadline !== null
      ? Math.max(0, activeActionDeadline - activeActionStartedAt - activeActionBaseTimeMs)
      : 0;
  const actionBaseDeadline = activeActionStartedAt !== null ? activeActionStartedAt + activeActionBaseTimeMs : null;
  const actionTimeLeftMs = canAttemptAction && activeActionDeadline ? Math.max(0, activeActionDeadline - now) : 0;
  const actionBaseTimeLeftMs = canAttemptAction && actionBaseDeadline ? Math.max(0, actionBaseDeadline - now) : actionTimeLeftMs;
  const actionTimebankLeftMs = canAttemptAction && activeActionDeadline
    ? actionBaseTimeLeftMs > 0
      ? activeActionTimebankMs
      : Math.max(0, activeActionDeadline - now)
    : user?.id
      ? table?.timebankRemainingMs?.[user.id] ?? table?.timebankMaxMs ?? 0
      : 0;
  const actionTimerUsesTimebank = canAttemptAction && actionBaseTimeLeftMs <= 0 && activeActionTimebankMs > 0;
  const actionProgress = actionTimerUsesTimebank
    ? Math.max(0, Math.min(1, actionTimebankLeftMs / Math.max(1, activeActionTimebankMs)))
    : Math.max(0, Math.min(1, actionBaseTimeLeftMs / Math.max(1, activeActionBaseTimeMs)));
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
  const preflopBetPresets = useMemo(
    () => getConfiguredPreflopBetPresets(user?.user_metadata?.preflop_bet_presets_bb),
    [user?.user_metadata?.preflop_bet_presets_bb],
  );
  const shortcuts = useMemo(
    () => sanitizeShortcuts(user?.user_metadata?.shortcuts),
    [user?.user_metadata?.shortcuts],
  );
  const shortcutIdByKey = useMemo(
    () => getShortcutIdByKey(shortcuts),
    [shortcuts],
  );
  const isWinningPlayer = (player: TablePlayer | null | undefined) => Boolean(player?.id && winningPlayerIds.includes(player.id));
  const isWinningPrivateCard = (player: TablePlayer | null | undefined, card: WireCard | undefined) => Boolean(
    card && player?.id && winningCardKeysByPlayerId[player.id]?.has(cardKey(card))
  );
  const isWinningBoardCard = (card: WireCard | undefined) => Boolean(card && winningBoardCardKeys.has(cardKey(card)));
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
  const isPreflop = (table?.common_cards?.length ?? 0) === 0;
  const activePresetCount = isPreflop ? preflopBetPresets.length : betPresets.length;
  const heroBet = visiblePlayers.hero?.bet ?? 0;
  const heroChips = visiblePlayers.hero?.chips ?? 0;
  const bigBlind = table?.BB ?? 50;
  const getMinRaiseToChips = useCallback(() => {
    const minRaiseTo = currentMaxBet > 0 ? currentMaxBet + bigBlind : bigBlind;
    return Math.max(0, Math.min(heroBet + heroChips, minRaiseTo));
  }, [bigBlind, currentMaxBet, heroBet, heroChips]);
  const getPreflopPresetRaiseToChips = useCallback((bigBlinds: number) => {
    const target = Math.round(bigBlinds * bigBlind);
    return Math.min(heroBet + heroChips, Math.max(getMinRaiseToChips(), target));
  }, [bigBlind, getMinRaiseToChips, heroBet, heroChips]);
  const getPresetRaiseToChips = useCallback((percent: number) => {
    const raiseBase = potTotal > 0 ? Math.round((potTotal * percent) / 100) : bigBlind;
    const minRaiseTo = getMinRaiseToChips();
    const target = Math.max(minRaiseTo, currentMaxBet + raiseBase);
    return Math.min(heroBet + heroChips, target);
  }, [bigBlind, currentMaxBet, getMinRaiseToChips, heroBet, heroChips, potTotal]);
  const getAllInRaiseToChips = useCallback(() => {
    return heroBet + heroChips;
  }, [heroBet, heroChips]);
  const formatRaiseInputFromChips = useCallback((amount: number) => {
    return stackUnit === 'BB' ? formatInputValue(amount / bigBlind) : formatInputValue(amount);
  }, [bigBlind, stackUnit]);
  const formatExactRaiseInputFromChips = useCallback((amount: number) => {
    return stackUnit === 'BB' ? formatExactInputValue(amount / bigBlind) : formatInputValue(amount);
  }, [bigBlind, stackUnit]);
  const parseRaiseInputToChips = useCallback(() => {
    const parsed = Number.parseFloat(raiseTo.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return stackUnit === 'BB' ? Math.round(parsed * bigBlind) : Math.round(parsed);
  }, [bigBlind, raiseTo, stackUnit]);
  const selectAllInRaise = useCallback(() => {
    const amount = getAllInRaiseToChips();
    setExactAllInRaiseTo(amount);
    setRaiseTo(formatExactRaiseInputFromChips(amount));
  }, [formatExactRaiseInputFromChips, getAllInRaiseToChips]);
  const toggleStackUnit = () => {
    const currentChips = exactAllInRaiseTo ?? parseRaiseInputToChips();
    setStackUnit(current => {
      const next = current === 'BB' ? 'C' : 'BB';
      if (currentChips) {
        const nextValue = next === 'BB' ? currentChips / bigBlind : currentChips;
        setRaiseTo(exactAllInRaiseTo !== null ? formatExactInputValue(nextValue) : formatInputValue(nextValue));
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
    const intervalMs = canAttemptAction ? 250 : 1000;
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [canAttemptAction]);

  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  useEffect(() => {
    profileEloRef.current = typeof profile?.elo === 'number' ? profile.elo : null;
  }, [profile?.elo]);

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
    if (!user) {
      setActiveTables([]);
      return;
    }

    setActiveTables(getActiveTablesForUser(user.id));
    return watchActiveTablesForUser(user.id, setActiveTables);
  }, [user]);

  useEffect(() => {
    clearPendingActionTimeout();
    hadHeroSeatRef.current = false;
    setPrivateCards([]);
    setHeroEliminated(false);
    setCurrentElo(null);
    setSubmittedActionRequestId(null);
  }, [clearPendingActionTimeout, numericTableId]);

  useEffect(() => {
    if (!user || !Number.isFinite(numericTableId)) {
      setPrivateCards([]);
      return;
    }

    setPrivateCards(getCachedPrivateCards(numericTableId, user.id));
    refreshPrivateCards(numericTableId, user.id, tableRef.current);

    return watchCachedPrivateCards(numericTableId, user.id, setPrivateCards);
  }, [numericTableId, user]);

  useEffect(() => {
    if (!user || !Number.isFinite(numericTableId)) return;
    syncPrivateCardsWithTableState(numericTableId, user.id, table);
  }, [numericTableId, table, user]);

  useEffect(() => {
    if (!user) return;
    const cachedElo = profileEloRef.current;
    setInitialElo(cachedElo);
    setCurrentElo(cachedElo);
  }, [numericTableId, user]);

  useEffect(() => {
    if (!user || typeof profile?.elo !== 'number') return;
    setInitialElo(current => current ?? profile.elo);
    setCurrentElo(current => current ?? profile.elo);
  }, [profile?.elo, user]);

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
        updateCachedProfile({ elo });
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
  }, [heroEliminated, heroWonTournament, initialElo, updateCachedProfile, user]);

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
      setActionDeadline(current => backendActionDeadline ?? (current && current > Date.now() ? current : Date.now() + ACTION_TIMEOUT_MS));
    } else {
      setActionDeadline(null);
    }
  }, [backendActionDeadline, canAttemptAction, table?.actionRequestId, table?.playerToPlay]);

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
        refreshPrivateCards(numericTableId, user.id, cached);
      }

      const unwatchCache = watchCachedTableState(numericTableId, state => {
        if (!mounted) return;
        tableReceivedRef.current = true;
        setTable(state);
        setFeedback('');
      });

      void ensureTableStateCache(numericTableId);
      refreshPrivateCards(numericTableId, user.id, cached);
      void sendTablePlayerReturn(numericTableId, user.id).then(status => {
        if (status === 'ok') {
          requestTableStateSnapshot(numericTableId, true);
        }
      });

      stateTimeout = window.setTimeout(() => {
        if (mounted && !tableReceivedRef.current) {
          setFeedback("En attente de l'état de la table...");
          void refreshTableStateConnection(numericTableId, true);
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

  useEffect(() => {
    if (!user || !Number.isFinite(numericTableId) || !heroAbsent || heroEliminated || heroWonTournament) return;

    let cancelled = false;
    const returnToActiveTable = () => {
      void sendTablePlayerReturn(numericTableId, user.id).then(status => {
        if (!cancelled && status === 'ok') {
          requestTableStateSnapshot(numericTableId, true);
        }
      });
    };

    returnToActiveTable();
    const interval = window.setInterval(returnToActiveTable, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [heroAbsent, heroEliminated, heroWonTournament, numericTableId, user]);

  const sendAction = useCallback(async (action: PlayerAction) => {
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
    if (heroAbsent) {
      setFeedback('Tu es absent, reconnexion à la table...');
      const status = await sendTablePlayerReturn(numericTableId, user.id);
      if (status === 'ok') {
        requestTableStateSnapshot(numericTableId, true);
        setFeedback('Tu es de retour, réessaie ton action.');
      } else {
        setFeedback('Retour impossible pour le moment.');
      }
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
      const parsed = exactAllInRaiseTo ?? (raiseTo.trim() === '' ? getMinRaiseToChips() : parseRaiseInputToChips());
      if (!parsed) {
        setFeedback('Entre un montant de relance valide.');
        return;
      }
      if (raiseTo.trim() === '') setRaiseTo(formatRaiseInputFromChips(parsed));
      payload.raiseTo = parsed;
      if (exactAllInRaiseTo !== null) payload.allIn = true;
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
      void refreshTableStateConnection(numericTableId, true);
      return;
    }

    if (action === 'FOLD') {
      clearCachedPrivateCards(numericTableId, user.id);
      setPrivateCards([]);
    }

    if (currentActionRequestId !== null) {
      pendingActionTimeoutRef.current = window.setTimeout(() => {
        pendingActionTimeoutRef.current = null;
        void refreshTableStateConnection(numericTableId, true);

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
  }, [
    clearPendingActionTimeout,
    exactAllInRaiseTo,
    formatRaiseInputFromChips,
    getMinRaiseToChips,
    heroAbsent,
    isHeroTurn,
    numericTableId,
    parseRaiseInputToChips,
    promptAlreadySubmitted,
    raiseTo,
    user,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableShortcutTarget(event.target)) return;

      const shortcutId = shortcutIdByKey.get(normalizeKeyboardEventKey(event));
      if (!shortcutId) return;

      event.preventDefault();

      if (shortcutId === 'fold') {
        void sendAction('FOLD');
        return;
      }

      if (shortcutId === 'check') {
        void sendAction(checkOrCallAction);
        return;
      }

      if (shortcutId === 'raise') {
        void sendAction('RAISE');
        return;
      }

      if (shortcutId === 'half_pot') {
        setExactAllInRaiseTo(null);
        setRaiseTo(formatRaiseInputFromChips(getPresetRaiseToChips(50)));
        return;
      }

      if (shortcutId === 'pot') {
        setExactAllInRaiseTo(null);
        setRaiseTo(formatRaiseInputFromChips(getPresetRaiseToChips(100)));
        return;
      }

      if (shortcutId === 'allin') {
        selectAllInRaise();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    checkOrCallAction,
    formatRaiseInputFromChips,
    getAllInRaiseToChips,
    getPresetRaiseToChips,
    sendAction,
    selectAllInRaise,
    shortcutIdByKey,
  ]);

  const quitEliminatedTournament = () => {
    if (user && Number.isFinite(numericTableId)) {
      dismissEliminatedTable(user.id, numericTableId);
    }

    setHeroEliminated(false);
    setFeedback('');
    navigate(tournamentListPath);
  };

  const returnToTable = async () => {
    if (!user) return;
    setFeedback('Retour à la table...');
    const status = await sendTablePlayerReturn(numericTableId, user.id);
    if (status === 'ok') {
      setFeedback('Tu es de retour.');
      requestTableStateSnapshot(numericTableId);
    } else {
      setFeedback('Retour impossible pour le moment.');
    }
  };

  const openTableFromSwitcher = (tableEntry: ActiveTableEntry) => {
    if (tableEntry.tableId === numericTableId) return;

    navigate(`/game/${tableEntry.tableId}`, {
      state: {
        tournamentId: tableEntry.tournamentId,
        returnTo: getTournamentReturnPath(tableEntry, tournamentListPath),
        autoTableSwitch: true,
        autoTableSwitchAt: Date.now(),
        autoTableSwitchDirection: tableEntry.tableId > numericTableId ? 'right' : 'left',
      },
    });
  };

  return (
    <div key={numericTableId} className={`${styles.page} ${autoSwitchClass}`}>
      <button className={`${styles.iconButton} ${styles.homeButton}`} onClick={() => navigate(tournamentListPath)} aria-label="Retour aux tournois">
        <span />
      </button>
      <button
        className={`${styles.iconButton} ${styles.lobbyButton}`}
        onClick={() => navigate(
          lobbyTournamentId ? `/tournament-lobby/${lobbyTournamentId}` : tournamentListPath,
          { state: { returnTo: tournamentListPath } }
        )}
        aria-label="Lobby du tournoi"
      >
        <span />
      </button>

      {showTableSwitcher && (
        <aside className={styles.tableSwitcherBar} aria-label="Changer de table">
          <div className={styles.tableSwitcherTabs}>
            {switchableTables.map(activeTable => (
              <TournamentTableTab
                key={`${activeTable.tournamentId}:${activeTable.tableId}`}
                tournamentName={activeTable.tournamentName ?? `Tournoi #${activeTable.tournamentId}`}
                tableId={activeTable.tableId}
                userId={user?.id}
                selected={activeTable.tableId === numericTableId}
                classes={tableTabStyles}
                onClick={() => openTableFromSwitcher(activeTable)}
              />
            ))}
          </div>
        </aside>
      )}

      <main className={styles.arena}>
        <section className={styles.table}>
          <div className={styles.outerRail} />
          <div className={styles.innerFelt}>
            <div className={styles.board}>
              <div className={styles.communityCards}>
                {Array.from({ length: 5 }).map((_, index) => {
                  const card = table?.common_cards[index];
                  return (
                    <div key={index} className={`${styles.card} ${styles.boardCard} ${card ? styles.cardVisible : styles.cardSlot} ${isRedCard(card) ? styles.redCard : ''} ${isWinningBoardCard(card) ? styles.winningCard : ''}`}>
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
              <PlayerAvatar
                name={player.name}
                avatarUrl={player.id ? playerAvatarsById[player.id] : null}
                className={styles.avatar}
                tone={index === 1 || index === 3 ? 'tableRed' : 'table'}
              />
              <div className={styles.opponentCards}>
                {[0, 1].map(cardIndex => {
                  const card = showOpponentCards ? player.cards?.[cardIndex] : undefined;
                  return (
                    <div key={cardIndex} className={`${styles.card} ${styles.smallCard} ${card ? styles.cardVisible : player.has_cards ? styles.cardBack : styles.cardSlot} ${isRedCard(card) ? styles.redCard : ''} ${isWinningPrivateCard(player, card) ? styles.winningCard : ''}`}>
                      {card ? formatCard(card) : ''}
                    </div>
                  );
                })}
              </div>
              {player.bet ? <div className={styles.bet}>{formatBet(player.bet, table?.BB, stackUnit)}</div> : null}
              <div className={styles.playerName}>{player.name ?? 'Joueur'}</div>
              {player.absent && <div className={styles.absentBadge}>Absent</div>}
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
                  <div key={index} className={`${styles.card} ${styles.heroCard} ${card ? styles.cardVisible : heroHasCards ? styles.cardBack : styles.cardSlot} ${isRedCard(card) ? styles.redCard : ''} ${isWinningPrivateCard(visiblePlayers.hero, card) ? styles.winningCard : ''}`}>
                    {card ? formatCard(card) : ''}
                  </div>
                );
              })}
              {heroAbsent && (
                <div className={styles.heroAbsentOverlay}>
                  <span>Absent</span>
                  <button onClick={returnToTable}>Revenir</button>
                </div>
              )}
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
            <div className={`${styles.actionTimer} ${actionTimerUsesTimebank ? styles.actionTimerBank : ''}`} style={{ '--action-progress': actionProgress } as CSSProperties}>
              <span>
                {actionTimerUsesTimebank
                  ? `Time Bank ${formatClock(actionTimebankLeftMs)}`
                  : `Temps ${formatClock(actionBaseTimeLeftMs)}`}
              </span>
              <small>
                {actionTimerUsesTimebank
                  ? 'Temps 0:00'
                  : `Time Bank ${formatClock(actionTimebankLeftMs)}`}
              </small>
              <div />
            </div>
          )}
          <div
            className={styles.presetRow}
            style={{ '--preset-count': activePresetCount + 1 } as CSSProperties}
          >
            {isPreflop
              ? preflopBetPresets.map(bigBlinds => (
                <button
                  key={bigBlinds}
                  className={styles.presetBtn}
                  onClick={() => {
                    setExactAllInRaiseTo(null);
                    setRaiseTo(formatRaiseInputFromChips(getPreflopPresetRaiseToChips(bigBlinds)));
                  }}
                >
                  {formatInputValue(bigBlinds)}BB
                </button>
              ))
              : betPresets.map(percent => (
                <button
                  key={percent}
                  className={styles.presetBtn}
                  onClick={() => {
                    setExactAllInRaiseTo(null);
                    setRaiseTo(formatRaiseInputFromChips(getPresetRaiseToChips(percent)));
                  }}
                >
                  {percent}%
                </button>
              ))}
            <button className={`${styles.presetBtn} ${styles.allInPresetBtn}`} onClick={selectAllInRaise}>
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
                onChange={event => {
                  setExactAllInRaiseTo(null);
                  setRaiseTo(event.target.value);
                }}
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
          <p className={styles.feedback}>{feedback || (canAttemptAction ? 'À toi de jouer.' : isHeroTurn ? 'Préparation de ton action...' : 'En attente des autres joueurs.')}</p>
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
