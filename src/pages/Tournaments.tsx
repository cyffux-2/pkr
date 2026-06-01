import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { getPublicUrl } from '../lib/publicUrl';
import { ensureTournamentTableConnection, getCachedTournamentTable } from '../lib/tournamentConnections';
import { ensureTableStateCache } from '../lib/tableStateCache';
import { watchDismissedEliminatedTables } from '../lib/eliminatedTournamentDismissals';
import {
  getActiveTablesForUser,
  watchActiveTablesForUser,
  type ActiveTableEntry,
} from '../lib/activeTablesRegistry';
import PlayerAvatar from '../components/PlayerAvatar';
import { TournamentTableTab } from '../components/TournamentTableTab';
import { ProfilePopup } from './ProfilModule/ProfilePopup';
import styles from './Tournaments.module.css';

interface TournamentRow {
  id: number;
  tournament_name: string;
  start_date: string;
  max_players: number;
  min_players: number;
  players: string[];
  ranked: boolean;
  time_per_level: number;
  alive_players_count?: number;
  current_level?: number;
  registration_closed?: boolean;
  tableId?: number;
}

interface PokerTableRow {
  tournament: number | null;
  players: unknown;
}

type TournamentPageMode = 'tournament' | 'sng';

interface PageConfig {
  dataName: string;
  tableLabel: string;
  emptyText: string;
  loadingText: string;
  loadErrorText: string;
  alreadyJoinedText: string;
  fullText: string;
  joinErrorText: string;
  unregisterErrorText: string;
  joinedText: string;
  unregisteredText: string;
  searchingTableText: string;
  registeredTablePendingText: string;
  noTableText: string;
  rowKind: 'tournament' | 'sng';
  filter: (tournament: TournamentRow) => boolean;
  pageClassName?: string;
}

function getPlayerIdsFromTableRows(tableRows: PokerTableRow[], tournamentId: number) {
  return tableRows
    .filter(row => row.tournament === tournamentId)
    .flatMap(row => Array.isArray(row.players) ? row.players : [])
    .filter((playerId): playerId is string => typeof playerId === 'string');
}

function isTrioTournamentName(name: string) {
  return /^triple\s+(normal|turbo)$/i.test(name.trim());
}

function isTrioTournament(tournament: Pick<TournamentRow, 'tournament_name' | 'max_players'>) {
  return tournament.max_players === 3 && isTrioTournamentName(tournament.tournament_name);
}

function isHeadupTournamentName(name: string) {
  return /^headup\s+(normal|turbo)$/i.test(name.trim());
}

function isHeadupTournament(tournament: Pick<TournamentRow, 'tournament_name' | 'max_players'>) {
  return tournament.max_players === 2 && isHeadupTournamentName(tournament.tournament_name);
}

const TOURNAMENT_PAGE_MIN_PLAYERS = 20;

const PAGE_CONFIG: Record<TournamentPageMode, PageConfig> = {
  tournament: {
    dataName: 'Main Page - tournoi',
    tableLabel: 'Tournois disponibles',
    emptyText: 'Aucun tournoi disponible pour le moment.',
    loadingText: 'Chargement des tournois...',
    loadErrorText: 'Impossible de charger les tournois.',
    alreadyJoinedText: 'Tu es déjà inscrit à ce tournoi.',
    fullText: 'Ce tournoi est complet.',
    joinErrorText: 'Impossible de rejoindre ce tournoi.',
    unregisterErrorText: 'Impossible de te désinscrire de ce tournoi.',
    joinedText: 'Inscription au tournoi confirmée.',
    unregisteredText: 'Désinscription confirmée.',
    searchingTableText: 'Inscription confirmée, recherche de ta table...',
    registeredTablePendingText: 'Inscription confirmée. Ta table sera disponible bientôt.',
    noTableText: 'Aucune table disponible pour ce tournoi.',
    rowKind: 'tournament',
    filter: tournament => tournament.max_players >= TOURNAMENT_PAGE_MIN_PLAYERS,
  },
  sng: {
    dataName: 'Main Page - sng',
    tableLabel: 'Sit&GO disponibles',
    emptyText: 'Aucun Sit&GO disponible pour le moment.',
    loadingText: 'Chargement des Sit&GO...',
    loadErrorText: 'Impossible de charger les Sit&GO.',
    alreadyJoinedText: 'Tu es déjà inscrit à ce Sit&GO.',
    fullText: 'Ce Sit&GO est complet.',
    joinErrorText: 'Impossible de rejoindre ce Sit&GO.',
    unregisterErrorText: 'Impossible de te désinscrire de ce Sit&GO.',
    joinedText: 'Inscription au Sit&GO confirmée.',
    unregisteredText: 'Désinscription confirmée.',
    searchingTableText: 'Inscription confirmée, recherche de ta table...',
    registeredTablePendingText: 'Inscription confirmée. Ta table sera disponible bientôt.',
    noTableText: 'Aucune table disponible pour ce Sit&GO.',
    rowKind: 'sng',
    filter: tournament =>
      tournament.max_players < TOURNAMENT_PAGE_MIN_PLAYERS &&
      !isTrioTournament(tournament) &&
      !isHeadupTournament(tournament),
    pageClassName: styles.pageSng,
  },
};

const ROW_LIMIT = 10;
const REGISTRATION_CLOSED_AFTER_LEVEL = 10;

function getGameModes(activeMode: TournamentPageMode) {
  return [
    { label: 'Tournoi', path: '/tournaments', active: activeMode === 'tournament' },
    { label: 'Sit&GO', path: '/sng', active: activeMode === 'sng' },
    { label: 'Triple', path: '/trio' },
    { label: 'HeadUp', path: '/headup' },
  ];
}

function formatHour(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value)).replace(':', 'h');
}

function formatEstimatedEnd(tournament: TournamentRow) {
  const start = new Date(tournament.start_date);
  const duration = Math.max(tournament.time_per_level, 1) * 8;
  const end = new Date(start.getTime() + duration * 60_000);
  return formatHour(end.toISOString());
}

function formatSngDuration(tournament: TournamentRow) {
  const estimatedMinutes = Math.max(tournament.time_per_level, 1) * 12;

  if (estimatedMinutes < 60) {
    return `0h${String(Math.round(estimatedMinutes)).padStart(2, '0')}`;
  }

  const roundedHalfHour = Math.round(estimatedMinutes / 30) * 30;
  const hours = Math.floor(roundedHalfHour / 60);
  const minutes = roundedHalfHour % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, '0')}`;
}

function formatSngStructure(tournament: TournamentRow) {
  const maxPlayers = Math.max(tournament.max_players, 2);
  const turbo = tournament.time_per_level <= 3;
  return `${maxPlayers} Max${turbo ? ' - turbo' : ''}`;
}

function formatSngName(tournament: TournamentRow) {
  const rawName = tournament.tournament_name.trim();
  if (rawName && !/^test$/i.test(rawName)) return rawName;
  return formatSngStructure(tournament);
}

function statusClass(tournament: TournamentRow, rowKind: PageConfig['rowKind']) {
  const start = new Date(tournament.start_date).getTime();
  const now = Date.now();
  const filled = tournament.players.length >= tournament.max_players;
  const closed = rowKind === 'tournament' && isRegistrationClosed(tournament);

  if (filled || closed) return styles.statusUnavailable;
  if (rowKind === 'sng') return styles.statusFuture;
  if (start <= now) return styles.statusJoinable;
  return styles.statusFuture;
}

function getCurrentTournamentLevel(tournament: TournamentRow) {
  if (typeof tournament.current_level === 'number') {
    return tournament.current_level;
  }

  const startTime = new Date(tournament.start_date).getTime();
  const levelMinutes = Number(tournament.time_per_level);
  if (!Number.isFinite(startTime) || !Number.isFinite(levelMinutes) || levelMinutes <= 0) {
    return 0;
  }

  const elapsedMs = Date.now() - startTime;
  if (elapsedMs < 0) return 0;

  return Math.floor(elapsedMs / (levelMinutes * 60_000)) + 1;
}

function isRegistrationClosed(tournament: TournamentRow) {
  if (tournament.max_players < TOURNAMENT_PAGE_MIN_PLAYERS) return false;
  return Boolean(tournament.registration_closed) || getCurrentTournamentLevel(tournament) > REGISTRATION_CLOSED_AFTER_LEVEL;
}

export function TournamentSelectionPage({ mode = 'tournament' }: { mode?: TournamentPageMode }) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const config = PAGE_CONFIG[mode];
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [selectedTableTournamentId, setSelectedTableTournamentId] = useState<number | null>(null);
  const [assignedTableIds, setAssignedTableIds] = useState<Record<number, number>>({});
  const [alivePlayersByTournament, setAlivePlayersByTournament] = useState<Record<number, number>>({});
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());
  const [cachedActiveTables, setCachedActiveTables] = useState<ActiveTableEntry[]>([]);
  const [openProfile, setOpenProfile] = useState(false);

  const activeTournaments = useMemo(
    () => mergeActiveTournamentTabs(
      tournaments.filter(tournament => Boolean(user && tournament.players.includes(user.id))),
      cachedActiveTables,
      user?.id,
    ).filter(tournament => {
      if (!user) return false;

      const tableId = tournament.tableId ?? assignedTableIds[tournament.id] ?? getCachedTournamentTable(tournament.id, user.id);
      return !dismissedEliminations.has(tableId ?? -1);
    }),
    [assignedTableIds, cachedActiveTables, dismissedEliminations, tournaments, user]
  );

  const searchableTournaments = useMemo(
    () => tournaments
      .filter(tournament => config.rowKind !== 'tournament' || !isRegistrationClosed(tournament))
      .filter(tournament => config.rowKind !== 'sng' || tournament.players.length < tournament.max_players)
      .slice()
      .sort((left, right) => new Date(left.start_date).getTime() - new Date(right.start_date).getTime())
      .slice(0, ROW_LIMIT),
    [config.rowKind, tournaments]
  );

  const formatPlayersCount = (tournament: TournamentRow) => {
    const registeredPlayers = tournament.players.length;
    if (config.rowKind === 'sng') {
      return `${registeredPlayers}/${tournament.max_players}`;
    }

    const rawAlivePlayers = typeof tournament.alive_players_count === 'number'
      ? tournament.alive_players_count
      : alivePlayersByTournament[tournament.id] ?? registeredPlayers;
    const alivePlayers = Math.max(0, Math.min(rawAlivePlayers, registeredPlayers));
    return `${alivePlayers}/${registeredPlayers}`;
  };

  useEffect(() => {
    let cancelled = false;

    const fetchTournaments = async () => {
      const { data, error } = await supabase.functions.invoke('list-tournaments');

      if (cancelled) return;

      if (error || data?.error) {
        setFeedback(config.loadErrorText);
        setTournaments([]);
        setAlivePlayersByTournament({});
      } else {
        const nextTournaments = ((data?.tournaments ?? []) as TournamentRow[])
          .filter(config.filter);
        setTournaments(nextTournaments);

        const tournamentIds = nextTournaments.map(tournament => tournament.id);
        if (tournamentIds.length === 0) {
          setAlivePlayersByTournament({});
        } else {
          const { data: tableRows } = await supabase
            .from('poker-tables')
            .select('tournament, players')
            .in('tournament', tournamentIds);

          const rows = (tableRows ?? []) as PokerTableRow[];
          const nextAliveCounts = nextTournaments.reduce<Record<number, number>>((counts, tournament) => {
            const rowsForTournament = rows.filter(row => row.tournament === tournament.id);
            if (typeof tournament.alive_players_count === 'number') {
              counts[tournament.id] = tournament.alive_players_count;
            } else {
              const tablePlayers = getPlayerIdsFromTableRows(rows, tournament.id);
              counts[tournament.id] = rowsForTournament.length > 0
                ? new Set(tablePlayers).size
                : tournament.players.length;
            }
            return counts;
          }, {});
          setAlivePlayersByTournament(nextAliveCounts);
        }
      }

      setLoading(false);
    };

    fetchTournaments();

    const refreshInterval = window.setInterval(fetchTournaments, 5000);

    const channel = supabase
      .channel(`main-page-${mode}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments' },
        fetchTournaments
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'poker-tables' },
        fetchTournaments
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      supabase.removeChannel(channel);
    };
  }, [config, mode]);

  useEffect(() => {
    if (!user) {
      setDismissedEliminations(new Set());
      setCachedActiveTables([]);
      setOpenProfile(false);
      return;
    }

    const unwatchDismissed = watchDismissedEliminatedTables(user.id, setDismissedEliminations);
    const unwatchActiveTables = watchActiveTablesForUser(user.id, setCachedActiveTables);

    setCachedActiveTables(getActiveTablesForUser(user.id));

    return () => {
      unwatchDismissed();
      unwatchActiveTables();
    };
  }, [user]);

  const requestTournamentTable = useCallback(async (tournamentId: number) => {
    if (!user) {
      navigate('/login');
      return null;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      navigate('/login');
      return null;
    }

    return ensureTournamentTableConnection({
      tournamentId,
      userId: user.id,
      accessToken: session.access_token,
      onAssigned: tableId => {
        setAssignedTableIds(current => ({ ...current, [tournamentId]: tableId }));
        void ensureTableStateCache(tableId);
      },
    });
  }, [navigate, user]);

  useEffect(() => {
    if (!user || activeTournaments.length === 0) return;

    const setup = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      for (const tournament of activeTournaments) {
        if (tournament.tableId) {
          void ensureTableStateCache(tournament.tableId);
          continue;
        }

        void ensureTournamentTableConnection({
          tournamentId: tournament.id,
          userId: user.id,
          accessToken: session.access_token,
          onAssigned: tableId => {
            setAssignedTableIds(current => ({ ...current, [tournament.id]: tableId }));
            void ensureTableStateCache(tableId);
          },
        });
      }
    };

    setup();
  }, [activeTournaments, user]);

  const joinTournament = async (tournament: TournamentRow) => {
    setSelectedTournamentId(tournament.id);
    window.setTimeout(() => setSelectedTournamentId(current => current === tournament.id ? null : current), 450);

    if (!user) {
      navigate('/login');
      return;
    }

    if (tournament.players.includes(user.id)) {
      setFeedback(config.alreadyJoinedText);
      return;
    }

    if (tournament.players.length >= tournament.max_players) {
      setFeedback(config.fullText);
      return;
    }

    if (isRegistrationClosed(tournament)) {
      setFeedback(`Les inscriptions sont fermées après le niveau ${REGISTRATION_CLOSED_AFTER_LEVEL}.`);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      navigate('/login');
      return;
    }

    const { data, error } = await supabase.functions.invoke('join-tournament', {
      body: { tournamentId: tournament.id },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error || data?.error) {
      setFeedback(data?.error || error?.message || config.joinErrorText);
      return;
    }

    const updatedTournament = data?.tournament as TournamentRow | undefined;
    if (!updatedTournament) {
      setFeedback(config.joinErrorText);
      return;
    }

    setFeedback(config.joinedText);
    setTournaments(current =>
      current.map(item => item.id === tournament.id ? updatedTournament : item)
    );

    setFeedback(config.searchingTableText);
    const tableId = await requestTournamentTable(updatedTournament.id);
    if (tableId) {
      void ensureTableStateCache(tableId);
      navigate(`/game/${tableId}`, { state: { tournamentId: updatedTournament.id, returnTo: mode === 'sng' ? '/sng' : '/tournaments' } });
    } else {
      setFeedback(config.registeredTablePendingText);
    }
  };

  const unregisterTournament = async (tournament: TournamentRow) => {
    setSelectedTournamentId(tournament.id);
    window.setTimeout(() => setSelectedTournamentId(current => current === tournament.id ? null : current), 450);

    if (!user) {
      navigate('/login');
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      navigate('/login');
      return;
    }

    const { data, error } = await supabase.functions.invoke('unregister-tournament', {
      body: { tournamentId: tournament.id },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error || data?.error) {
      setFeedback(data?.error || error?.message || config.unregisterErrorText);
      return;
    }

    const updatedTournament = data?.tournament as TournamentRow | undefined;
    if (!updatedTournament) {
      setFeedback(config.unregisterErrorText);
      return;
    }

    setFeedback(config.unregisteredText);
    setAssignedTableIds(current => {
      const next = { ...current };
      delete next[tournament.id];
      return next;
    });
    setTournaments(current =>
      current.map(item => item.id === tournament.id ? updatedTournament : item)
    );
  };

  const handleTournamentAction = (tournament: TournamentRow) => {
    if (user && tournament.players.includes(user.id)) {
      void unregisterTournament(tournament);
      return;
    }

    void joinTournament(tournament);
  };

  const openTournamentTable = async (tournament: TournamentRow) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setSelectedTableTournamentId(tournament.id);
    window.setTimeout(() => {
      setSelectedTableTournamentId(current => current === tournament.id ? null : current);
    }, 450);

    const knownTableId = tournament.tableId ?? assignedTableIds[tournament.id] ?? getCachedTournamentTable(tournament.id, user.id);
    if (!knownTableId) setFeedback('Recherche de ta table...');

    const tableId = knownTableId ?? await requestTournamentTable(tournament.id);

    if (!tableId) {
      setFeedback(config.noTableText);
      return;
    }

    setFeedback('');
    void ensureTableStateCache(tableId);
    navigate(`/game/${tableId}`, { state: { tournamentId: tournament.id, returnTo: mode === 'sng' ? '/sng' : '/tournaments' } });
  };

  return (
    <div className={`${styles.page} ${config.pageClassName ?? ''}`} data-name={config.dataName}>
      <aside className={styles.sidebar}>
        <button className={styles.logoWrap} onClick={() => navigate('/home')} aria-label="Accueil">
          <img src={getPublicUrl('/figma/main-page-nothing/pkr-logo-black-bg.png')} alt="PKR" className={styles.logoImg} />
        </button>

        <nav className={styles.modeList}>
          {getGameModes(mode).map(({ label, path, active }) => (
            <button
              key={label}
              className={`${styles.modeBtn} ${active ? styles.modeBtnActive : ''}`}
              onClick={() => navigate(path)}
            >
              <span>{label}</span>
              <span className={styles.playIcon} aria-hidden="true" />
            </button>
          ))}
        </nav>

        <div className={styles.bottomIcons}>
          <button className={styles.iconBtn} onClick={() => navigate('/settings')} title="Paramètres">
            <img src={getPublicUrl('/figma/main-page-nothing/settings-icon.svg')} alt="" className={styles.iconImg} />
          </button>
          <button className={styles.iconBtn} onClick={() => setOpenProfile(true)} title="Profil">
            <PlayerAvatar
              name={profile?.username ?? user?.email}
              avatarUrl={profile?.avatar_url}
              className={styles.profileAvatar}
              tone="dark"
            />
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <section className={styles.panel}>
          {feedback && <div className={styles.feedback}>{feedback}</div>}

          <div
            className={`${styles.table} ${config.rowKind === 'sng' ? styles.sngTable : ''}`}
            role="table"
            aria-label={config.tableLabel}
          >
            <div className={`${styles.row} ${styles.header}`} role="row">
              {config.rowKind === 'sng' ? (
                <>
                  <div>Tournoi</div>
                  <div>Durée</div>
                  <div>Joueurs</div>
                  <div>Structure</div>
                  <div />
                </>
              ) : (
                <>
                  <div>Tournoi</div>
                  <div>Début</div>
                  <div>Fin estimée</div>
                  <div>Joueurs</div>
                  <div>Structure</div>
                  <div />
                </>
              )}
            </div>

            {loading && (
              <div className={styles.empty}>{config.loadingText}</div>
            )}

            {!loading && searchableTournaments.length === 0 && (
              <div className={styles.empty}>{config.emptyText}</div>
            )}

            {!loading && searchableTournaments.map((tournament, index) => {
              const joined = Boolean(user && tournament.players.includes(user.id));
              const full = tournament.players.length >= tournament.max_players;
              const closed = config.rowKind === 'tournament' && isRegistrationClosed(tournament);
              const structureLabel = config.rowKind === 'sng'
                ? formatSngStructure(tournament)
                : `${tournament.time_per_level} min/niveau${tournament.ranked ? ' - Classé' : ''}`;

              return (
                <div className={styles.row} role="row" key={tournament.id}>
                  <span className={`${styles.status} ${statusClass(tournament, config.rowKind)}`} />
                  <div className={styles.nameCell}>
                    <span>#{String(index + 1).padStart(2, '0')}</span>
                    <strong>{config.rowKind === 'sng' ? formatSngName(tournament) : tournament.tournament_name}</strong>
                  </div>
                  {config.rowKind === 'sng' ? (
                    <div>{formatSngDuration(tournament)}</div>
                  ) : (
                    <>
                      <div>{formatHour(tournament.start_date)}</div>
                      <div className={styles.muted}>{formatEstimatedEnd(tournament)}</div>
                    </>
                  )}
                  <div>{formatPlayersCount(tournament)}</div>
                  <div>
                    <span className={styles.structure}>
                      {structureLabel}
                    </span>
                  </div>
                  <button
                    className={`${styles.joinBtn} ${selectedTournamentId === tournament.id ? styles.joinBtnSelected : ''}`}
                    onClick={() => handleTournamentAction(tournament)}
                    disabled={!joined && (full || closed)}
                  >
                    {joined ? 'Désinscrire' : closed ? 'Fermé' : full ? 'Complet' : 'Rejoindre'}
                  </button>
                </div>
              );
            })}
          </div>

        </section>

        {activeTournaments.length > 0 && (
          <div className={styles.bottomBar}>
            <div className={styles.tournamentTabs}>
              {activeTournaments.map(tournament => (
                <TournamentTableTab
                  key={tournament.id}
                  tournamentName={tournament.tournament_name}
                  tableId={user ? tournament.tableId ?? assignedTableIds[tournament.id] ?? getCachedTournamentTable(tournament.id, user.id) : null}
                  userId={user?.id}
                  selected={selectedTableTournamentId === tournament.id}
                  classes={styles}
                  onClick={() => openTournamentTable(tournament)}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {openProfile && (
        <ProfilePopup
          profile={profile}
          onClose={() => setOpenProfile(false)}
        />
      )}
    </div>
  );
}

export default function Tournaments() {
  return <TournamentSelectionPage mode="tournament" />;
}

function mergeActiveTournamentTabs(
  dbTournaments: TournamentRow[],
  cachedTables: ActiveTableEntry[],
  userId: string | undefined,
) {
  const byTournament = new Map<number, TournamentRow>();

  dbTournaments.forEach(tournament => {
    byTournament.set(tournament.id, { ...tournament });
  });

  cachedTables.forEach(entry => {
    const current = byTournament.get(entry.tournamentId);
    byTournament.set(entry.tournamentId, {
      id: entry.tournamentId,
      tournament_name: current?.tournament_name ?? entry.tournamentName ?? `Tournoi #${entry.tournamentId}`,
      start_date: current?.start_date ?? entry.startDate ?? '',
      max_players: current?.max_players ?? 0,
      min_players: current?.min_players ?? 0,
      players: current?.players ?? (userId ? [userId] : []),
      ranked: current?.ranked ?? true,
      time_per_level: current?.time_per_level ?? 0,
      alive_players_count: current?.alive_players_count,
      current_level: current?.current_level,
      registration_closed: current?.registration_closed,
      tableId: entry.tableId,
    });
  });

  return Array.from(byTournament.values()).sort((left, right) => {
    if (!left.start_date || !right.start_date) return left.id - right.id;
    return new Date(left.start_date).getTime() - new Date(right.start_date).getTime();
  });
}
