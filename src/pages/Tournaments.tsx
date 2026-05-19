import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { publicAsset } from '../lib/publicAssets';
import { useAuth } from '../context/AuthContext';
import { ensureTournamentTableConnection, getCachedTournamentTable } from '../lib/tournamentConnections';
import { ensureTableStateCache } from '../lib/tableStateCache';
import { watchDismissedEliminatedTables } from '../lib/eliminatedTournamentDismissals';
import { TournamentTableTab } from '../components/TournamentTableTab';
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
}

interface PokerTableRow {
  tournament: number | null;
  players: unknown;
}

function getPlayerIdsFromTableRows(tableRows: PokerTableRow[], tournamentId: number) {
  return tableRows
    .filter(row => row.tournament === tournamentId)
    .flatMap(row => Array.isArray(row.players) ? row.players : [])
    .filter((playerId): playerId is string => typeof playerId === 'string');
}

const GAME_MODES = [
  { label: 'Tournoi', path: '/tournaments', active: true },
  { label: 'Sit&GO', path: '/lobby?mode=sitgo' },
  { label: 'Triple', path: '/lobby?mode=triple' },
  { label: 'HeadUp', path: '/lobby?mode=headup' },
];

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

function statusClass(tournament: TournamentRow) {
  const start = new Date(tournament.start_date).getTime();
  const now = Date.now();
  const filled = tournament.players.length >= tournament.max_players;

  if (filled) return styles.statusUnavailable;
  if (start <= now) return styles.statusJoinable;
  return styles.statusFuture;
}

export default function Tournaments() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [selectedTableTournamentId, setSelectedTableTournamentId] = useState<number | null>(null);
  const [assignedTableIds, setAssignedTableIds] = useState<Record<number, number>>({});
  const [alivePlayersByTournament, setAlivePlayersByTournament] = useState<Record<number, number>>({});
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());

  const activeTournaments = useMemo(
    () => tournaments.filter(tournament => (
      user &&
      tournament.players.includes(user.id) &&
      !dismissedEliminations.has(assignedTableIds[tournament.id] ?? getCachedTournamentTable(tournament.id, user.id) ?? -1)
    )),
    [assignedTableIds, dismissedEliminations, tournaments, user]
  );

  const formatPlayersCount = (tournament: TournamentRow) => {
    const registeredPlayers = tournament.players.length;
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
        setFeedback('Impossible de charger les tournois.');
        setTournaments([]);
        setAlivePlayersByTournament({});
      } else {
        const nextTournaments = ((data?.tournaments ?? []) as TournamentRow[]).slice(0, 10);
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
      .channel('main-page-tournoi')
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
  }, []);

  useEffect(() => {
    if (!user) {
      setDismissedEliminations(new Set());
      return;
    }

    return watchDismissedEliminatedTables(user.id, setDismissedEliminations);
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
      setFeedback('Tu es déjà inscrit à ce tournoi.');
      return;
    }

    if (tournament.players.length >= tournament.max_players) {
      setFeedback('Ce tournoi est complet.');
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
      setFeedback('Impossible de rejoindre ce tournoi.');
      return;
    }

    const updatedTournament = data?.tournament as TournamentRow | undefined;
    if (!updatedTournament) {
      setFeedback('Impossible de rejoindre ce tournoi.');
      return;
    }

    setFeedback('Inscription au tournoi confirmée.');
    setTournaments(current =>
      current.map(item => item.id === tournament.id ? updatedTournament : item)
    );

    setFeedback('Inscription confirmée, recherche de ta table...');
    const tableId = await requestTournamentTable(updatedTournament.id);
    if (tableId) {
      void ensureTableStateCache(tableId);
      navigate(`/game/${tableId}`, { state: { tournamentId: updatedTournament.id } });
    } else {
      setFeedback('Inscription confirmée. Ta table sera disponible bientôt.');
    }
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

    const knownTableId = assignedTableIds[tournament.id] ?? getCachedTournamentTable(tournament.id, user.id);
    if (!knownTableId) setFeedback('Recherche de ta table...');

    const tableId = knownTableId ?? await requestTournamentTable(tournament.id);

    if (!tableId) {
      setFeedback('Aucune table disponible pour ce tournoi.');
      return;
    }

    setFeedback('');
    void ensureTableStateCache(tableId);
    navigate(`/game/${tableId}`, { state: { tournamentId: tournament.id } });
  };

  return (
    <div className={styles.page} data-name="Main Page - tournoi">
      <aside className={styles.sidebar}>
        <button className={styles.logoWrap} onClick={() => navigate('/home')} aria-label="Accueil">
          <img src={publicAsset('/figma/main-page-nothing/pkr-logo-black-bg.png')} alt="PKR" className={styles.logoImg} />
        </button>

        <nav className={styles.modeList}>
          {GAME_MODES.map(({ label, path, active }) => (
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
            <img src={publicAsset('/figma/main-page-nothing/settings-icon.svg')} alt="" className={styles.iconImg} />
          </button>
          <button className={styles.iconBtn} onClick={() => navigate('/settings')} title="Profil">
            <img src={publicAsset('/figma/main-page-nothing/profile-icon.svg')} alt="" className={styles.iconImg} />
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <section className={styles.panel}>
          {feedback && <div className={styles.feedback}>{feedback}</div>}

          <div className={styles.table} role="table" aria-label="Tournois disponibles">
            <div className={`${styles.row} ${styles.header}`} role="row">
              <div>Tournoi</div>
              <div>Début</div>
              <div>Fin estimée</div>
              <div>Joueurs</div>
              <div>Structure</div>
              <div />
            </div>

            {loading && (
              <div className={styles.empty}>Chargement des tournois...</div>
            )}

            {!loading && tournaments.length === 0 && (
              <div className={styles.empty}>Aucun tournoi disponible pour le moment.</div>
            )}

            {!loading && tournaments.map((tournament, index) => {
              const joined = Boolean(user && tournament.players.includes(user.id));
              const full = tournament.players.length >= tournament.max_players;

              return (
                <div className={styles.row} role="row" key={tournament.id}>
                  <span className={`${styles.status} ${statusClass(tournament)}`} />
                  <div className={styles.nameCell}>
                    <span>#{String(index + 1).padStart(2, '0')}</span>
                    <strong>{tournament.tournament_name}</strong>
                  </div>
                  <div>{formatHour(tournament.start_date)}</div>
                  <div className={styles.muted}>{formatEstimatedEnd(tournament)}</div>
                  <div>{formatPlayersCount(tournament)}</div>
                  <div>
                    <span className={styles.structure}>
                      {tournament.time_per_level} min/niveau{tournament.ranked ? ' - Classé' : ''}
                    </span>
                  </div>
                  <button
                    className={`${styles.joinBtn} ${selectedTournamentId === tournament.id ? styles.joinBtnSelected : ''}`}
                    onClick={() => joinTournament(tournament)}
                    disabled={joined || full}
                  >
                    {joined ? 'Inscrit' : full ? 'Complet' : 'Rejoindre'}
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
                  tableId={user ? assignedTableIds[tournament.id] ?? getCachedTournamentTable(tournament.id, user.id) : null}
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
    </div>
  );
}
