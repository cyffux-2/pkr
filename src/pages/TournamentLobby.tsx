import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ensureTournamentTableConnection, getCachedTournamentTable } from '../lib/tournamentConnections';
import {
  ensureTableStateCache,
  getCachedTableState,
  refreshTableStateConnection,
  sendTablePlayerReturn,
  watchCachedTableState,
  type TableState,
} from '../lib/tableStateCache';
import { refreshPrivateCards } from '../lib/privateCardsCache';
import { watchDismissedEliminatedTables } from '../lib/eliminatedTournamentDismissals';
import { buildBlindLevels, getLevelIndexFromPublishedBlinds } from '../lib/tournamentLevels';
import { formatWireCard, isRedWireCard } from '../lib/cardDisplay';
import { useTablePreview } from '../hooks/useTablePreview';
import PlayerStatsPanel from '../components/PlayerStatsPanel';
import styles from './TournamentLobby.module.css';

interface TournamentRow {
  id: number;
  tournament_name: string;
  start_date: string;
  max_players: number;
  min_players: number;
  players: string[];
  ranked: boolean;
  time_per_level: number;
}

interface ProfileRow {
  user_id: string;
  username: string;
  tag: string | null;
  elo: number;
  avatar_url: string | null;
}

type PlayerRow = {
  id: string;
  name: string;
  elo: number | string;
  tag: string | null;
  avatar_url: string | null;
  rank: number | null;
  stack: number | string;
  bet: number;
};

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getLevelClock(tournament: TournamentRow | null, now: number) {
  if (!tournament) {
    return {
      label: '-',
      progress: 0,
    };
  }

  const startMs = new Date(tournament.start_date).getTime();
  const levelDurationMs = Math.max(tournament.time_per_level, 0.001) * 60_000;
  const beforeStartMs = startMs - now;

  if (beforeStartMs > 0) {
    const referenceMs = Math.max(beforeStartMs, 90 * 60_000);
    return {
      label: formatClock(beforeStartMs),
      progress: Math.max(18, Math.min(342, 360 - (beforeStartMs / referenceMs) * 360)),
    };
  }

  const elapsedInLevelMs = (now - startMs) % levelDurationMs;
  const remainingMs = levelDurationMs - elapsedInLevelMs;

  return {
    label: formatClock(remainingMs),
    progress: Math.max(0, Math.min(360, (elapsedInLevelMs / levelDurationMs) * 360)),
  };
}

function getCurrentLevelIndex(tournament: TournamentRow | null, now: number) {
  if (!tournament) return 0;

  const levelDurationMs = Math.max(tournament.time_per_level, 0.001) * 60_000;
  const elapsedMs = now - new Date(tournament.start_date).getTime();
  if (elapsedMs <= 0) return 0;

  return Math.max(0, Math.floor(elapsedMs / levelDurationMs));
}

export default function TournamentLobby() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tournamentId } = useParams();
  const { user } = useAuth();
  const numericTournamentId = Number(tournamentId);
  const routeState = location.state as { returnTo?: string } | null;
  const returnTo = routeState?.returnTo === '/trio' || routeState?.returnTo === '/headup' || routeState?.returnTo === '/sng' || routeState?.returnTo === '/tournaments'
    ? routeState.returnTo
    : '/tournaments';

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [profileRanks, setProfileRanks] = useState<Record<string, number>>({});
  const [tableId, setTableId] = useState<number | null>(null);
  const [tableState, setTableState] = useState<TableState | null>(null);
  const [selectedStatsPlayer, setSelectedStatsPlayer] = useState<PlayerRow | null>(null);
  const [feedback, setFeedback] = useState('');
  const [now, setNow] = useState(Date.now());
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());
  const tablePreview = useTablePreview(tableId, user?.id);
  const eliminationDismissed = Boolean(tableId && dismissedEliminations.has(tableId));

  const joined = Boolean(user && tournament?.players.includes(user.id));
  const alivePlayerIds = useMemo(() => {
    return new Set(
      (tableState?.players ?? [])
        .map(player => player?.id)
        .filter((playerId): playerId is string => typeof playerId === 'string')
    );
  }, [tableState]);
  const playerRows = useMemo(() => {
    const tournamentPlayers = tournament?.players ?? [];
    const visiblePlayerIds = alivePlayerIds.size > 0
      ? tournamentPlayers.filter(playerId => alivePlayerIds.has(playerId))
      : tournamentPlayers;

    return visiblePlayerIds.map((playerId, index) => {
      const profile = profiles.find(item => item.user_id === playerId);
      const tablePlayer = tableState?.players.find(player => player?.id === playerId);
      return {
        id: playerId,
        name: tablePlayer?.name ?? profile?.username ?? 'Joueur',
        elo: profile?.elo ?? '-',
        tag: profile?.tag ?? null,
        avatar_url: profile?.avatar_url ?? null,
        rank: profileRanks[playerId] ?? null,
        stack: tablePlayer ? tablePlayer.chips : index === 0 ? 1000 : 1000,
        bet: tablePlayer?.bet ?? 0,
      };
    }).sort((left, right) => {
      const leftStack = typeof left.stack === 'number' ? left.stack : Number.NEGATIVE_INFINITY;
      const rightStack = typeof right.stack === 'number' ? right.stack : Number.NEGATIVE_INFINITY;
      return rightStack - leftStack;
    });
  }, [alivePlayerIds, profileRanks, profiles, tableState, tournament]);
  const currentLevelIndex = getLevelIndexFromPublishedBlinds(tableState?.SB, tableState?.BB) ?? getCurrentLevelIndex(tournament, now);
  const levelRows = useMemo(
    () => buildBlindLevels(tournament?.time_per_level ?? 5, currentLevelIndex),
    [currentLevelIndex, tournament?.time_per_level],
  );
  const registeredPlayers = tournament?.players.length ?? 0;
  const playersLeft = alivePlayerIds.size > 0 ? alivePlayerIds.size : registeredPlayers;
  const levelClock = getLevelClock(tournament, now);
  const countdownStyle = {
    '--countdown-progress': `${levelClock.progress}deg`,
  } as CSSProperties;

  const tableLabel = useMemo(() => {
    if (!joined) return 'Non inscrit';
    if (tableId) return `Table #${tableId}`;
    return 'Préconnexion';
  }, [joined, tableId]);
  const showTableButton = joined && !eliminationDismissed;
  const tableButtonUsesFallbackCards = !tableId || !tablePreview.tableState;
  const tableButtonCardLabels = tablePreview.isEliminated
    ? ['K', 'O']
    : tablePreview.heroHasCards
    ? [formatWireCard(tablePreview.privateCards[0]) || '?', formatWireCard(tablePreview.privateCards[1]) || '?']
    : tableButtonUsesFallbackCards
      ? ['A', 'K']
      : ['', ''];

  const visiblePlayers = useMemo(() => {
    if (playerRows.length > 0) return playerRows;
    return Array.from({ length: Math.min(tournament?.min_players ?? 2, 3) }, (_, index) => ({
      id: `empty-${index}`,
      name: 'Libre',
      elo: '-',
      tag: null,
      avatar_url: null,
      rank: null,
      stack: '-',
      bet: 0,
    }));
  }, [playerRows, tournament]);

  const closeStats = () => setSelectedStatsPlayer(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!user) {
      setDismissedEliminations(new Set());
      return;
    }

    return watchDismissedEliminatedTables(user.id, setDismissedEliminations);
  }, [user]);

  useEffect(() => {
    if (!Number.isFinite(numericTournamentId)) {
      navigate('/tournaments');
      return;
    }

    let cancelled = false;

    const fetchTournament = async () => {
      const { data, error } = await supabase.functions.invoke('list-tournaments');
      if (cancelled) return;

      const next = ((data?.tournaments ?? []) as TournamentRow[]).find(item => item.id === numericTournamentId) ?? null;
      if (error || data?.error || !next) {
        setFeedback('Tournoi introuvable.');
        setTournament(null);
        return;
      }

      setTournament(next);
      setFeedback('');

      if (next.players.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('user_id, username, tag, elo, avatar_url')
          .in('user_id', next.players);

        if (!cancelled) {
          setProfiles((profileRows ?? []) as ProfileRow[]);
        }

        const { data: leaderboardRows } = await supabase
          .from('profiles')
          .select('user_id, elo')
          .order('elo', { ascending: false });

        if (!cancelled) {
          setProfileRanks(Object.fromEntries((leaderboardRows ?? []).map((row, index) => [row.user_id, index + 1])));
        }
      } else {
        setProfiles([]);
        setProfileRanks({});
      }
    };

    fetchTournament();
    const interval = window.setInterval(fetchTournament, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [navigate, numericTournamentId]);

  useEffect(() => {
    if (!user || !joined || !tournament) return;

    const setup = async () => {
      const cached = getCachedTournamentTable(tournament.id, user.id);
      if (cached) {
        const cachedState = getCachedTableState(cached);
        setTableId(cached);
        setTableState(cachedState);
        void ensureTableStateCache(cached);
        refreshPrivateCards(cached, user.id, cachedState);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const assigned = await ensureTournamentTableConnection({
        tournamentId: tournament.id,
        userId: user.id,
        accessToken: session.access_token,
        onAssigned: setTableId,
      });
      if (assigned) {
        const assignedState = getCachedTableState(assigned);
        setTableId(assigned);
        setTableState(assignedState);
        void ensureTableStateCache(assigned);
        refreshPrivateCards(assigned, user.id, assignedState);
      }
    };

    setup();
  }, [joined, tournament, user]);

  useEffect(() => {
    if (!tableId) return;

    setTableState(getCachedTableState(tableId));
    void ensureTableStateCache(tableId);
    return watchCachedTableState(tableId, setTableState);
  }, [tableId]);

  const openTable = async () => {
    if (!user || !tournament) {
      navigate('/login');
      return;
    }

    const cached = tableId ?? getCachedTournamentTable(tournament.id, user.id);
    if (cached) {
      const cachedState = getCachedTableState(cached);
      void refreshTableStateConnection(cached, true);
      refreshPrivateCards(cached, user.id, cachedState);
      void sendTablePlayerReturn(cached, user.id);
      navigate(`/game/${cached}`, { state: { tournamentId: tournament.id, returnTo } });
      return;
    }

    setFeedback('Connexion à ta table...');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      navigate('/login');
      return;
    }

    const assigned = await ensureTournamentTableConnection({
      tournamentId: tournament.id,
      userId: user.id,
      accessToken: session.access_token,
      onAssigned: setTableId,
    });

    if (assigned) {
      const assignedState = getCachedTableState(assigned);
      void refreshTableStateConnection(assigned, true);
      refreshPrivateCards(assigned, user.id, assignedState);
      void sendTablePlayerReturn(assigned, user.id);
      navigate(`/game/${assigned}`, { state: { tournamentId: tournament.id, returnTo } });
    } else {
      setFeedback('Table encore indisponible.');
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <section className={styles.topPanel}>
          <h1>{tournament?.tournament_name ?? 'Tournoi'}</h1>
          <div className={styles.countdownDial} style={countdownStyle}>
            <div className={styles.countdownInner}>{levelClock.label}</div>
          </div>
          <p>{playersLeft}/{registeredPlayers}</p>
        </section>

        <section className={styles.lobbyPanel}>
          <div className={styles.levelTable}>
            <div className={`${styles.tableRow} ${styles.tableHead}`}>
              <span>Niveau</span>
              <span>Temps</span>
              <span>SB</span>
              <span>BB</span>
            </div>
            {levelRows.map(level => (
              <div key={level.level} className={`${styles.tableRow} ${level.isCurrent ? styles.currentLevel : ''}`}>
                <strong>{level.level}</strong>
                <strong>{level.duration}</strong>
                <span>{level.smallBlind}</span>
                <strong>{level.bigBlind}</strong>
              </div>
            ))}
          </div>

          <div className={styles.playersTable}>
            <div className={`${styles.playerRow} ${styles.tableHead}`}>
              <span>Nom</span>
              <span>Elo</span>
              <span>Stack</span>
              <span />
            </div>
            {visiblePlayers.map(player => (
              <div key={player.id} className={styles.playerRow}>
                <strong>{player.name}</strong>
                <strong>{player.elo}</strong>
                <span>{player.stack}</span>
                <button className={styles.statsButton} onClick={() => setSelectedStatsPlayer(player)}>
                  Stats
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className={styles.bottomActions}>
          <span>{tableLabel}{tableState ? ` · ${tableState.SB}/${tableState.BB}` : ''}</span>
          {showTableButton && (
            <button className={`${styles.backTournamentButton} ${tablePreview.isHeroTurn ? styles.backTournamentButtonPulse : ''}`} onClick={openTable}>
              <span className={styles.tableCardsPreview}>
                {[0, 1].map(index => {
                  const card = tablePreview.heroHasCards ? tablePreview.privateCards[index] : undefined;
                  const isFallbackRed = !tablePreview.heroHasCards && tableButtonUsesFallbackCards && index === 1;
                  const isEmpty = !tableButtonCardLabels[index];

                  return (
                    <span
                      key={index}
                      className={`${styles.tableCard} ${isRedWireCard(card) || isFallbackRed ? styles.tableCardRed : ''} ${isEmpty ? styles.tableCardEmpty : ''}`}
                    >
                      {tableButtonCardLabels[index]}
                    </span>
                  );
                })}
              </span>
              {tablePreview.isEliminated ? 'Voir le résultat' : 'Retour à la table'}
              <span className={styles.backArrow} />
            </button>
          )}
        </div>

        {feedback && <p className={styles.feedback}>{feedback}</p>}
      </main>

      {selectedStatsPlayer && (
        <div className={styles.statsOverlay} role="dialog" aria-modal="true" aria-label={`Stats de ${selectedStatsPlayer.name}`} onClick={closeStats}>
          <div onClick={event => event.stopPropagation()}>
            <PlayerStatsPanel
              mode="modal"
              onClose={closeStats}
              profile={{
                user_id: selectedStatsPlayer.id,
                username: selectedStatsPlayer.name,
                tag: selectedStatsPlayer.tag,
                elo: selectedStatsPlayer.elo,
                avatar_url: selectedStatsPlayer.avatar_url,
                rank: selectedStatsPlayer.rank,
                stack: selectedStatsPlayer.stack,
                bet: selectedStatsPlayer.bet,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
