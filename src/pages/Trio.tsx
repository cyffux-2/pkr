import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LocalLobbyPlayerCount from '../components/LocalLobbyPlayerCount';
import LocalTournamentLeaderboard from '../components/LocalTournamentLeaderboard';
import PlayerAvatar from '../components/PlayerAvatar';
import { TournamentTableTab } from '../components/TournamentTableTab';
import { useAuth } from '../context/AuthContext';
import { getPublicUrl } from '../lib/publicUrl';
import {
  getActiveTablesForUser,
  type ActiveTableEntry,
  watchActiveTablesForUser,
} from '../lib/activeTablesRegistry';
import { watchDismissedEliminatedTables } from '../lib/eliminatedTournamentDismissals';
import { supabase } from '../lib/supabase';
import { ensureTableStateCache } from '../lib/tableStateCache';
import { ensureTournamentTableConnection, getCachedTournamentTable } from '../lib/tournamentConnections';
import { ProfilePopup } from './ProfilModule/ProfilePopup';
import styles from './Tournaments.module.css';

type TrioChoice = 'normal' | 'turbo';

interface ActiveTournament {
  id: number;
  tournament_name: string;
  start_date: string;
  players: string[];
  tableId?: number;
}

const GAME_MODES = [
  { label: 'Tournoi', path: '/tournaments', active: false },
  { label: 'Sit&GO', path: '/sng', active: false },
  { label: 'Triple', path: '/trio', active: true },
  { label: 'HeadUp', path: '/headup', active: false },
];

export default function Trio() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [openProfile, setOpenProfile] = useState(false);
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournament[]>([]);
  const [cachedActiveTables, setCachedActiveTables] = useState<ActiveTableEntry[]>([]);
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());
  const [assignedTableIds, setAssignedTableIds] = useState<Record<number, number>>({});
  const [selectedTableTournamentId, setSelectedTableTournamentId] = useState<number | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<TrioChoice | null>(null);
  const [joiningChoice, setJoiningChoice] = useState<TrioChoice | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!user) {
      setOpenProfile(false);
      setActiveTournaments([]);
      setCachedActiveTables([]);
      setDismissedEliminations(new Set());
      return;
    }

    let cancelled = false;
    const fetchActiveTournaments = async () => {
      const { data, error } = await supabase
        .from('tournaments')
        .select('id, tournament_name, start_date, players')
        .contains('players', [user.id])
        .order('start_date', { ascending: true });

      if (cancelled) return;
      if (!error) setActiveTournaments((data ?? []) as ActiveTournament[]);
    };

    fetchActiveTournaments();

    const channel = supabase
      .channel(`trio-active-tournaments-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments' },
        fetchActiveTournaments
      )
      .subscribe();

    const unwatchDismissed = watchDismissedEliminatedTables(user.id, setDismissedEliminations);
    const unwatchActiveTables = watchActiveTablesForUser(user.id, setCachedActiveTables);

    setCachedActiveTables(getActiveTablesForUser(user.id));

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      unwatchDismissed();
      unwatchActiveTables();
    };
  }, [user]);

  const visibleActiveTournaments = useMemo(
    () => mergeActiveTournamentTabs(activeTournaments, cachedActiveTables, user?.id).filter(tournament => {
      if (!user) return false;

      const tableId = tournament.tableId ?? assignedTableIds[tournament.id] ?? getCachedTournamentTable(tournament.id, user.id);
      return !tableId || !dismissedEliminations.has(tableId);
    }),
    [activeTournaments, assignedTableIds, cachedActiveTables, dismissedEliminations, user],
  );

  useEffect(() => {
    if (!user || visibleActiveTournaments.length === 0) return;

    const setup = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      for (const tournament of visibleActiveTournaments) {
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
  }, [visibleActiveTournaments, user]);

  const openTournamentTable = async (tournament: ActiveTournament) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setSelectedTableTournamentId(tournament.id);
    window.setTimeout(() => {
      setSelectedTableTournamentId(current => current === tournament.id ? null : current);
    }, 450);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      navigate('/login');
      return;
    }

    const tableId = tournament.tableId ?? getCachedTournamentTable(tournament.id, user.id) ?? await ensureTournamentTableConnection({
      tournamentId: tournament.id,
      userId: user.id,
      accessToken: session.access_token,
      onAssigned: assigned => {
        setAssignedTableIds(current => ({ ...current, [tournament.id]: assigned }));
        void ensureTableStateCache(assigned);
      },
    });

    if (!tableId) return;

    navigate(`/game/${tableId}`, { state: { tournamentId: tournament.id, returnTo: '/trio' } });
  };

  const selectChoice = async (choice: TrioChoice) => {
    if (joiningChoice) return;

    setSelectedChoice(choice);
    window.setTimeout(() => {
      setSelectedChoice(current => current === choice ? null : current);
    }, 220);

    if (!user) {
      navigate('/login');
      return;
    }

    setJoiningChoice(choice);
    setFeedback(choice === 'normal' ? 'Recherche d’un Triple Normal...' : 'Recherche d’un Triple Turbo...');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        navigate('/login');
        return;
      }

      const { data, error } = await supabase.functions.invoke('join-trio-tournament', {
        body: { variant: choice },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error || data?.error || !data?.tournament) {
        const details = data?.error || error?.message;
        setFeedback(details ? `Impossible de rejoindre un Triple : ${details}` : 'Impossible de rejoindre un Triple pour le moment.');
        console.error('join-trio-tournament failed:', error ?? data);
        return;
      }

      const tournament = data.tournament as ActiveTournament;
      setActiveTournaments(current => {
        const withoutCurrent = current.filter(item => item.id !== tournament.id);
        return [...withoutCurrent, tournament];
      });

      setFeedback('Triple trouvé, recherche de ta table...');
      const tableId = tournament.tableId ?? getCachedTournamentTable(tournament.id, user.id) ?? await ensureTournamentTableConnection({
        tournamentId: tournament.id,
        userId: user.id,
        accessToken: session.access_token,
        onAssigned: assigned => {
          setAssignedTableIds(current => ({ ...current, [tournament.id]: assigned }));
          void ensureTableStateCache(assigned);
        },
      });

      if (!tableId) {
        setFeedback('Inscription confirmée. Ta table sera disponible bientôt.');
        return;
      }

      setFeedback('');
      void ensureTableStateCache(tableId);
      navigate(`/game/${tableId}`, { state: { tournamentId: tournament.id, returnTo: '/trio' } });
    } finally {
      setJoiningChoice(null);
    }
  };

  return (
    <div className={`${styles.page} ${styles.pageTrio}`} data-name="Main Page - expresso">
      <aside className={styles.sidebar}>
        <button className={styles.logoWrap} onClick={() => navigate('/home')} aria-label="Accueil">
          <img src={getPublicUrl('/figma/main-page-nothing/pkr-logo-black-bg.png')} alt="PKR" className={styles.logoImg} />
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
        {feedback && <div className={styles.feedback}>{feedback}</div>}

        <section className={styles.trioPanel} aria-label="Triple">
          <div className={styles.trioChoices}>
            <button
              className={`${styles.trioChoiceBtn} ${selectedChoice === 'normal' ? styles.trioChoiceBtnSelected : ''}`}
              onClick={() => selectChoice('normal')}
              disabled={joiningChoice !== null}
            >
              Normal
            </button>
            <button
              className={`${styles.trioChoiceBtn} ${styles.trioChoiceBtnTurbo} ${selectedChoice === 'turbo' ? styles.trioChoiceBtnSelected : ''}`}
              onClick={() => selectChoice('turbo')}
              disabled={joiningChoice !== null}
            >
              Turbo
            </button>
          </div>
          <div className={styles.trioTriangle} aria-hidden="true">
            <span />
          </div>
          <div className={styles.modeInfoStack}>
            <LocalLobbyPlayerCount mode="trio" />
            <LocalTournamentLeaderboard mode="trio" title="Triple" />
          </div>
        </section>

        {visibleActiveTournaments.length > 0 && (
          <div className={styles.bottomBar}>
            <div className={styles.tournamentTabs}>
              {visibleActiveTournaments.map(tournament => (
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

function mergeActiveTournamentTabs(
  dbTournaments: ActiveTournament[],
  cachedTables: ActiveTableEntry[],
  userId: string | undefined,
) {
  const byTournament = new Map<number, ActiveTournament>();

  dbTournaments.forEach(tournament => {
    byTournament.set(tournament.id, { ...tournament });
  });

  cachedTables.forEach(entry => {
    const current = byTournament.get(entry.tournamentId);
    byTournament.set(entry.tournamentId, {
      id: entry.tournamentId,
      tournament_name: current?.tournament_name ?? entry.tournamentName ?? `Tournoi #${entry.tournamentId}`,
      start_date: current?.start_date ?? entry.startDate ?? '',
      players: current?.players ?? (userId ? [userId] : []),
      tableId: entry.tableId,
    });
  });

  return Array.from(byTournament.values()).sort((left, right) => {
    if (!left.start_date || !right.start_date) return left.id - right.id;
    return new Date(left.start_date).getTime() - new Date(right.start_date).getTime();
  });
}
