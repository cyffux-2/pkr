import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { ensureTournamentTableConnection, getCachedTournamentTable } from '../../lib/tournamentConnections';
import { ensureTableStateCache } from '../../lib/tableStateCache';
import { watchDismissedEliminatedTables } from '../../lib/eliminatedTournamentDismissals';
import {
  getActiveTablesForUser,
  watchActiveTablesForUser,
  type ActiveTableEntry,
} from '../../lib/activeTablesRegistry';
import { formatLiveStatNumber, useLiveSiteStats } from '../../lib/useLiveSiteStats';
import PlayerAvatar from '../../components/PlayerAvatar';
import { TournamentTableTab } from '../../components/TournamentTableTab';
import { ProfilePopup } from '../ProfilModule/ProfilePopup';
import styles from './Home.module.css';

type CarouselImageContext = {
  keys(): string[];
  (id: string): string | { default: string };
};

declare const require: {
  context(directory: string, useSubdirectories: boolean, regExp: RegExp): CarouselImageContext;
};

interface ActiveTournament {
  id:              number;
  tournament_name: string;
  start_date:      string;
  players:         string[];
  tableId?:        number;
}

interface CarouselImage {
  src: string;
  alt: string;
}

const GAME_MODES = [
  { label: 'Tournoi', path: '/tournaments', nodeName: 'Tournament' },
  { label: 'Sit&GO',  path: '/sng', nodeName: 'Sit&go' },
  { label: 'Triple',  path: '/trio', nodeName: 'Expresso' },
  { label: 'HeadUp',  path: '/headup', nodeName: 'HeadUp' },
];

const HOME_CAROUSEL_IMAGES = loadHomeCarouselImages();

export default function Home() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [popupOpen,    setPopupOpen]    = useState(false);
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournament[]>([]);
  const [cachedActiveTables, setCachedActiveTables] = useState<ActiveTableEntry[]>([]);
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<number>>(new Set());
  const [selectedTableTournamentId, setSelectedTableTournamentId] = useState<number | null>(null);
  const [assignedTableIds, setAssignedTableIds] = useState<Record<number, number>>({});
  const { stats: homeStats, loading: homeStatsLoading } = useLiveSiteStats();
  const [carouselIndex, setCarouselIndex] = useState(0);
  const carouselImageCount = HOME_CAROUSEL_IMAGES.length;
  const carouselImageIndex = carouselImageCount > 0 ? carouselIndex % carouselImageCount : 0;

  useEffect(() => {
    if (carouselImageCount <= 1) return;

    const interval = window.setInterval(() => {
      setCarouselIndex(current => (current + 1) % carouselImageCount);
    }, 5500);

    return () => window.clearInterval(interval);
  }, [carouselImageCount]);

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

  const showPreviousCarouselImage = () => {
    if (carouselImageCount <= 1) return;
    setCarouselIndex(current => (current - 1 + carouselImageCount) % carouselImageCount);
  };

  const showNextCarouselImage = () => {
    if (carouselImageCount <= 1) return;
    setCarouselIndex(current => (current + 1) % carouselImageCount);
  };

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
            src="/figma/main-page-nothing/pkr-logo-black-bg.png"
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
            <img src="/figma/main-page-nothing/settings-icon.svg" alt="" className={styles.iconImg} />
          </button>

          <button
            className={styles.iconBtn}
            onClick={() => setPopupOpen(v => !v)}
            title="Profil"
          >
            <PlayerAvatar
              name={profile?.username ?? user?.email}
              avatarUrl={profile?.avatar_url}
              className={styles.profileAvatar}
              tone="dark"
            />
          </button>
        </div>
      </aside>

      <main className={`${styles.main} ${visibleActiveTournaments.length > 0 ? styles.mainWithBottomBar : ''}`} aria-label="Accueil PKR">
        <div className={styles.homeContent}>
          {HOME_CAROUSEL_IMAGES.length > 0 && (
            <section className={styles.carouselPanel} aria-label="Informations PKR">
              <div className={styles.carouselViewport}>
                {HOME_CAROUSEL_IMAGES.map((image, index) => (
                  <img
                    key={image.src}
                    src={image.src}
                    alt={image.alt}
                    className={`${styles.carouselImage} ${index === carouselImageIndex ? styles.carouselImageActive : ''}`}
                    draggable={false}
                  />
                ))}
              </div>

              {carouselImageCount > 1 && (
                <div className={styles.carouselControls}>
                  <button
                    type="button"
                    className={styles.carouselArrow}
                    onClick={showPreviousCarouselImage}
                    aria-label="Information precedente"
                  >
                    &lt;
                  </button>

                  <div className={styles.carouselDots} aria-label="Choisir une information">
                    {HOME_CAROUSEL_IMAGES.map((image, index) => (
                      <button
                        key={image.src}
                        type="button"
                        className={`${styles.carouselDot} ${index === carouselImageIndex ? styles.carouselDotActive : ''}`}
                        onClick={() => setCarouselIndex(index)}
                        aria-label={`Information ${index + 1}`}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    className={styles.carouselArrow}
                    onClick={showNextCarouselImage}
                    aria-label="Information suivante"
                  >
                    &gt;
                  </button>
                </div>
              )}
            </section>
          )}

        <section className={styles.statsPanel} aria-label="Statistiques PKR">
          <div className={styles.statsHeader}>
            <span className={styles.liveDot} aria-label="En direct" />
          </div>

          <div className={styles.statsGrid}>
            <article className={`${styles.statCard} ${styles.statCardPrimary}`}>
              <span>Joueurs en jeu</span>
              <strong>{homeStatsLoading ? '...' : formatLiveStatNumber(homeStats.playersInGame)}</strong>
            </article>

            <article className={styles.statCard}>
              <span>Tables actives</span>
              <strong>{homeStatsLoading ? '...' : formatLiveStatNumber(homeStats.activeTables)}</strong>
            </article>

            <article className={styles.statCard}>
              <span>Tournois ouverts</span>
              <strong>{homeStatsLoading ? '...' : formatLiveStatNumber(homeStats.openTournaments)}</strong>
            </article>

            <article className={styles.statCard}>
              <span>Inscriptions cette semaine</span>
              <strong>{homeStatsLoading ? '...' : formatLiveStatNumber(homeStats.weeklyRegistrations)}</strong>
            </article>

            <article className={styles.statCard}>
              <span>Parties terminées cette semaine</span>
              <strong>{homeStatsLoading ? '...' : formatLiveStatNumber(homeStats.completedTournamentsThisWeek)}</strong>
            </article>
          </div>
        </section>
        </div>

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

function loadHomeCarouselImages(): CarouselImage[] {
  const context = require.context('../../assets/home-carousel', false, /\.(png|jpe?g|webp|avif|gif|svg)$/i);
  const collator = new Intl.Collator('fr-FR', { numeric: true, sensitivity: 'base' });

  return context.keys().sort(collator.compare).map(key => {
    const loaded = context(key);
    const src = typeof loaded === 'string' ? loaded : loaded.default;
    return {
      src,
      alt: formatCarouselImageAlt(key),
    };
  }).filter(image => Boolean(image.src));
}

function formatCarouselImageAlt(key: string) {
  const name = key
    .replace(/^\.\//, '')
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[-_ ]*/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  return name ? `Information PKR ${name}` : 'Information PKR';
}
