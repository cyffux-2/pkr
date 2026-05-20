import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { publicAsset } from '../../lib/publicAssets';
import { ensureTournamentTableConnection, getCachedTournamentTable } from '../../lib/tournamentConnections';
import { ensureTableStateCache } from '../../lib/tableStateCache';
import { watchDismissedEliminatedTables } from '../../lib/eliminatedTournamentDismissals';
import {
  getActiveTablesForUser,
  watchActiveTablesForUser,
  type ActiveTableEntry,
} from '../../lib/activeTablesRegistry';
import { TournamentTableTab } from '../../components/TournamentTableTab';
import { ProfilePopup } from '../ProfilModule/ProfilePopup';
import styles from './Home.module.css';

interface Profile {
  username:   string;
  tag:        string;
  elo:        number;
  avatar_url: string | null;
}

interface ActiveTournament {
  id:              number;
  tournament_name: string;
  start_date:      string;
  players:         string[];
  tableId?:        number;
}

const GAME_MODES = [
  { label: 'Tournoi', path: '/tournaments', nodeName: 'Tournament' },
  { label: 'Sit&GO',  path: '/lobby?mode=sitgo', nodeName: 'Sit&go' },
  { label: 'Triple',  path: '/lobby?mode=triple', nodeName: 'Expresso' },
  { label: 'HeadUp',  path: '/lobby?mode=headup', nodeName: 'HeadUp' },
];

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [popupOpen,    setPopupOpen]    = useState(false);
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournament[]>([]);
  const [cachedActiveTables, setCachedActiveTables] = useState<ActiveTableEntry[]>([]);
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());
  const [selectedTableTournamentId, setSelectedTableTournamentId] = useState<number | null>(null);
  const [assignedTableIds, setAssignedTableIds] = useState<Record<number, number>>({});

  // Charge le profil depuis la table profiles
  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('username, tag, elo, avatar_url')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data as Profile);
      });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setActiveTournaments([]);
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

      if (error) {
        console.error('Failed to fetch active tournaments:', error);
        setActiveTournaments([]);
        return;
      }

      setActiveTournaments((data ?? []) as ActiveTournament[]);
    };

    fetchActiveTournaments();

    const channel = supabase
      .channel(`home-active-tournaments-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments' },
        fetchActiveTournaments
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setDismissedEliminations(new Set());
      setCachedActiveTables([]);
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

  const avatarUrl = profile?.avatar_url ?? null;
  const initiale  = profile?.username?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?';

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

    if (!tableId) {
      navigate('/tournaments');
      return;
    }

    navigate(`/game/${tableId}`, { state: { tournamentId: tournament.id } });
  };

  return (
    <div className={styles.page} data-name="Main Page - nothing">
      <div className={styles.background} aria-hidden="true" />

      <aside className={styles.sidebar}>
        <div className={styles.logoWrap}>
          <img
            src={publicAsset('/figma/main-page-nothing/pkr-logo-black-bg.png')}
            alt="PKR"
            className={styles.logoImg}
          />
        </div>

        <nav className={styles.modeList}>
          {GAME_MODES.map(({ label, path, nodeName }) => (
            <button
              key={label}
              className={styles.modeBtn}
              onClick={() => navigate(path)}
              data-name={nodeName}
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

          <button
            className={styles.iconBtn}
            onClick={() => setPopupOpen(v => !v)}
            title="Profil"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
            ) : (
              <>
                <img src={publicAsset('/figma/main-page-nothing/profile-icon.svg')} alt="" className={styles.iconImg} />
                <span className={styles.avatarInitiale}>{initiale}</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <main className={styles.main} aria-label="Accueil PKR">
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

      {popupOpen && (
        <ProfilePopup
          profile={profile}
          onClose={() => setPopupOpen(false)}
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
