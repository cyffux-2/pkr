import { useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { getPublicUrl } from '../lib/publicUrl';
import PlayerAvatar from './PlayerAvatar';
import styles from './PlayerStatsPanel.module.css';

export interface PlayerStatsProfile {
  user_id?: string;
  username?: string | null;
  tag?: string | null;
  elo?: number | string | null;
  avatar_url?: string | null;
  level?: string | null;
  rank?: number | null;
  stack?: number | string | null;
  bet?: number | string | null;
}

export interface PlayerStatsMetricSet {
  season?: string;
  winRate?: number | string;
  winRateCaption?: string;
  gamesWon?: number | string;
  gamesWonCaption?: string;
  gamesPlayed?: number | string;
  gamesCaption?: string;
  gains?: number | string;
  gainsCaption?: string;
  monthlyGoal?: number;
  gamesBeforeNextEmoji?: number | string;
  nextEmojiProgress?: number;
  rankExperience?: number;
  achievementsUnlocked?: number;
  achievementsTotal?: number;
  achievements?: PlayerAchievement[];
}

export interface PlayerAchievement {
  icon: string;
  title: string;
  description: string;
  unlocked?: boolean;
}

interface Props {
  profile: PlayerStatsProfile | null;
  metrics?: PlayerStatsMetricSet;
  mode?: 'page' | 'modal';
  onClose?: () => void;
}

type TournamentResultPlayerRow = {
  playerId?: string | null;
  player_id?: string | null;
  username?: string | null;
  placement?: number | null;
  isWinner?: boolean | null;
  is_winner?: boolean | null;
  eloDelta?: number | null;
  elo_delta?: number | null;
};

type TournamentResultRow = {
  players: TournamentResultPlayerRow[] | null;
  winner_ids: string[] | null;
  elo_delta: number[] | null;
  player_count: number | null;
  tournament_finished_at: string;
  tournament_name: string | null;
};

type PlayerTournamentStats = {
  gamesPlayed: number;
  gamesWon: number;
  weeklyEloGain: number;
  headupWins: number;
  trioWins: number;
  biggestFieldBeaten: number;
};

type SearchProfileRow = {
  user_id: string;
  username: string | null;
  tag: string | null;
  elo: number | null;
  avatar_url: string | null;
};

type LeaderboardKey = 'elo' | 'gamesPlayed' | 'gains' | 'gamesWon' | 'biggestFieldBeaten';

type LeaderboardEntry = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  value: number;
};

type LeaderboardData = Record<LeaderboardKey, LeaderboardEntry[]>;

type LeaderboardAccumulator = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  elo: number;
  gamesPlayed: number;
  gains: number;
  gamesWon: number;
  biggestFieldBeaten: number;
};

const DEFAULT_ACHIEVEMENTS: PlayerAchievement[] = [
  { icon: '★', title: 'Champion', description: '1er tournoi gagné', unlocked: true },
  { icon: '♠', title: 'Shark', description: '10 tables finales', unlocked: true },
  { icon: '◆', title: 'Grinder', description: '1000 mains jouées', unlocked: true },
  { icon: '✓', title: 'Clutch', description: '5 victoires d’affilée', unlocked: true },
  { icon: '●', title: 'Bounty', description: '50 éliminations' },
  { icon: '▲', title: 'High Roller', description: 'Top 10 classement' },
];

const EMPTY_LEADERBOARDS: LeaderboardData = {
  elo: [],
  gamesPlayed: [],
  gains: [],
  gamesWon: [],
  biggestFieldBeaten: [],
};

const LEADERBOARD_LIMIT = 5;

function normalizeNumber(value: number | string | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

type RankTierId = 'bronze' | 'silver' | 'gold' | 'emerald' | 'diamond' | 'legend';

interface RankTier {
  id: RankTierId;
  label: string;
  asset: string;
  minElo: number;
  nextElo?: number;
}

const RANK_TIERS: RankTier[] = [
  { id: 'bronze', label: 'Bronze', asset: 'Bronze.png', minElo: 0, nextElo: 400 },
  { id: 'silver', label: 'Argent', asset: 'Silver.png', minElo: 400, nextElo: 600 },
  { id: 'gold', label: 'Or', asset: 'Gold.png', minElo: 600, nextElo: 900 },
  { id: 'emerald', label: 'Émeraude', asset: 'emerauld.png', minElo: 900, nextElo: 1100 },
  { id: 'diamond', label: 'Diamant', asset: 'Diamond.png', minElo: 1100 },
  { id: 'legend', label: 'Légende', asset: 'Legend.png', minElo: 0 },
];

function getRankTier(elo: number | null, rank?: number | null) {
  if (typeof rank === 'number' && rank > 0 && rank <= 5) return RANK_TIERS[5];
  if (elo === null) return RANK_TIERS[0];
  if (elo > 1100) return RANK_TIERS[4];
  if (elo > 900) return RANK_TIERS[3];
  if (elo > 600) return RANK_TIERS[2];
  if (elo > 400) return RANK_TIERS[1];
  return RANK_TIERS[0];
}

function getNextRankTier(tier: RankTier) {
  const index = RANK_TIERS.findIndex(item => item.id === tier.id);
  if (index < 0 || index >= RANK_TIERS.length - 1) return null;
  return RANK_TIERS[index + 1];
}

function getRankProgress(elo: number | null, rank: number | null, totalRankedPlayers: number | null) {
  const tier = getRankTier(elo, rank);
  const nextTier = getNextRankTier(tier);

  if (!nextTier) {
    return {
      tier,
      nextTier: null,
      progress: 100,
      value: 'Rang maximal',
      hint: 'Top 5 global',
    };
  }

  if (tier.id === 'diamond') {
    const progress = rank && totalRankedPlayers && totalRankedPlayers > 5
      ? ((totalRankedPlayers - rank) / Math.max(1, totalRankedPlayers - 5)) * 100
      : 0;
    const placesLeft = rank ? Math.max(0, rank - 5) : null;

    return {
      tier,
      nextTier,
      progress: clampProgress(progress, 0),
      value: rank ? `#${rank} / Top 5` : 'Top 5 global',
      hint: placesLeft === null
        ? 'Classement requis'
        : placesLeft === 0
          ? 'Promotion prête'
          : `${placesLeft} place${placesLeft > 1 ? 's' : ''} à gagner`,
    };
  }

  const currentElo = elo ?? 0;
  const nextElo = tier.nextElo ?? currentElo;
  const progress = nextElo > tier.minElo
    ? ((currentElo - tier.minElo) / (nextElo - tier.minElo)) * 100
    : 100;
  const missingElo = Math.max(0, Math.ceil(nextElo - currentElo));

  return {
    tier,
    nextTier,
    progress: clampProgress(progress, 0),
    value: `${formatStatsNumber(currentElo)} / ${formatStatsNumber(nextElo)} ELO`,
    hint: missingElo === 0 ? 'Promotion prête' : `${missingElo} ELO avant ${nextTier.label}`,
  };
}

export function getPlayerLevelFromElo(elo: number | string | null | undefined, rank?: number | null) {
  return getRankTier(normalizeNumber(elo), rank).label;
}

export function formatStatsNumber(value: number | string | null | undefined) {
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('fr-FR').format(value);
}

function clampProgress(value: number | undefined, fallback: number) {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, next));
}

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + 1);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function formatSignedNumber(value: number | string | null | undefined) {
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const formatted = formatStatsNumber(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function getResultPlayers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(player => player && typeof player === 'object') as TournamentResultPlayerRow[];
}

function findPlayerResult(row: TournamentResultRow, userId: string) {
  const players = getResultPlayers(row.players);
  const index = players.findIndex(player => (player.playerId ?? player.player_id) === userId);
  return index >= 0 ? { player: players[index], index } : null;
}

function getPlayerResultEloDelta(row: TournamentResultRow, result: { player: TournamentResultPlayerRow; index: number } | null) {
  if (!result) return 0;
  const deltaFromList = Array.isArray(row.elo_delta) ? normalizeNumber(row.elo_delta[result.index]) : null;
  return deltaFromList ?? normalizeNumber(result.player.eloDelta ?? result.player.elo_delta) ?? 0;
}

function didPlayerWinTournament(row: TournamentResultRow, result: { player: TournamentResultPlayerRow; index: number } | null, userId: string) {
  if (!result) return false;
  return Boolean(
    result.player.isWinner
    ?? result.player.is_winner
    ?? (row.winner_ids ?? []).includes(userId)
    ?? result.player.placement === 1,
  );
}

function isHeadupTournamentName(name: string | null | undefined) {
  return /^headup\s+(normal|turbo)$/i.test((name ?? '').trim());
}

function isTrioTournamentName(name: string | null | undefined) {
  return /^triple\s+(normal|turbo)$/i.test((name ?? '').trim());
}

function sortLeaderboard(entries: LeaderboardAccumulator[], key: LeaderboardKey) {
  return [...entries]
    .sort((left, right) => right[key] - left[key])
    .slice(0, LEADERBOARD_LIMIT)
    .map(entry => ({
      userId: entry.userId,
      username: entry.username,
      avatarUrl: entry.avatarUrl,
      value: entry[key],
    }));
}

function getLeaderboardRank(entries: LeaderboardEntry[], index: number) {
  const entry = entries[index];
  if (!entry) return index + 1;

  const firstSameValueIndex = entries.findIndex(candidate => candidate.value === entry.value);
  return firstSameValueIndex >= 0 ? firstSameValueIndex + 1 : index + 1;
}

export default function PlayerStatsPanel({ profile, metrics, mode = 'page', onClose }: Props) {
  const [selectedProfile, setSelectedProfile] = useState<PlayerStatsProfile | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchProfileRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboards, setLeaderboards] = useState<LeaderboardData>(EMPTY_LEADERBOARDS);
  const activeProfile = selectedProfile ?? profile;
  const activeMetrics = selectedProfile ? undefined : metrics;
  const name = activeProfile?.username || 'Pseudo joueur';
  const elo = normalizeNumber(activeProfile?.elo);
  const providedRank = typeof activeProfile?.rank === 'number' && Number.isFinite(activeProfile.rank) ? activeProfile.rank : null;
  const [fetchedRank, setFetchedRank] = useState<number | null>(null);
  const [totalRankedPlayers, setTotalRankedPlayers] = useState<number | null>(null);
  const [rankLoading, setRankLoading] = useState(false);
  const [tournamentStats, setTournamentStats] = useState<PlayerTournamentStats | null>(null);
  const rank = providedRank ?? fetchedRank;
  const level = activeProfile?.level || getPlayerLevelFromElo(activeProfile?.elo, rank);
  const achievements = activeMetrics?.achievements ?? DEFAULT_ACHIEVEMENTS;
  const unlockedAchievements = activeMetrics?.achievementsUnlocked ?? achievements.filter(item => item.unlocked).length;
  const totalAchievements = activeMetrics?.achievementsTotal ?? 42;
  const nextEmojiProgress = clampProgress(activeMetrics?.nextEmojiProgress ?? activeMetrics?.monthlyGoal, 72);
  const gamesBeforeNextEmoji = activeMetrics?.gamesBeforeNextEmoji ?? '-';
  const achievementsProgress = totalAchievements > 0
    ? clampProgress((unlockedAchievements / totalAchievements) * 100, 43)
    : 0;
  const gamesWon = activeMetrics?.gamesWon ?? activeMetrics?.winRate ?? tournamentStats?.gamesWon ?? '-';
  const gamesPlayed = activeMetrics?.gamesPlayed ?? tournamentStats?.gamesPlayed ?? '-';
  const gains = activeMetrics?.gains ?? tournamentStats?.weeklyEloGain ?? '-';
  const headupWins = tournamentStats?.headupWins ?? '-';
  const trioWins = tournamentStats?.trioWins ?? '-';
  const biggestFieldBeaten = tournamentStats?.biggestFieldBeaten ?? '-';
  const rootClassName = `${styles.panel} ${mode === 'modal' ? styles.modalPanel : styles.pagePanel}`;
  const rankLabel = rank ? `#${rank}` : rankLoading ? '...' : 'Non classé';
  const rankProgress = getRankProgress(elo, rank, totalRankedPlayers);

  useEffect(() => {
    setSelectedProfile(null);
    setSearchOpen(false);
    setLeaderboardOpen(false);
    setSearchQuery('');
  }, [profile?.user_id]);

  useEffect(() => {
    if (!activeProfile?.user_id) {
      setFetchedRank(null);
      setTotalRankedPlayers(null);
      setRankLoading(false);
      return;
    }

    let cancelled = false;
    setRankLoading(providedRank === null);

    supabase
      .from('profiles')
      .select('user_id, elo')
      .or('tag.is.null,tag.neq.BOT')
      .order('elo', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error) {
          setFetchedRank(null);
          setTotalRankedPlayers(null);
        } else {
          const position = (data ?? []).findIndex(row => row.user_id === activeProfile.user_id);
          setTotalRankedPlayers((data ?? []).length);
          setFetchedRank(providedRank === null && position >= 0 ? position + 1 : null);
        }

        setRankLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProfile?.user_id, providedRank]);

  useEffect(() => {
    if (!activeProfile?.user_id) {
      setTournamentStats(null);
      return;
    }

    let cancelled = false;

    supabase
      .from('tournament_results')
      .select('players, winner_ids, elo_delta, player_count, tournament_finished_at, tournament_name')
      .filter('players', 'cs', JSON.stringify([{ playerId: activeProfile.user_id }]))
      .order('tournament_finished_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error) {
          setTournamentStats(null);
          return;
        }

        const results = (data ?? []) as TournamentResultRow[];
        const playerResults = results
          .map(row => ({ row, result: findPlayerResult(row, activeProfile.user_id as string) }))
          .filter(result => result.result !== null);
        const weekStartMs = getCurrentWeekStart().getTime();
        const weeklyEloGain = playerResults.reduce((total, result) => {
          const finishedAt = new Date(result.row.tournament_finished_at).getTime();
          return finishedAt >= weekStartMs ? total + getPlayerResultEloDelta(result.row, result.result) : total;
        }, 0);
        const winningResults = playerResults.filter(result => didPlayerWinTournament(result.row, result.result, activeProfile.user_id as string));

        setTournamentStats({
          gamesPlayed: playerResults.length,
          gamesWon: winningResults.length,
          weeklyEloGain,
          headupWins: winningResults.filter(result => isHeadupTournamentName(result.row.tournament_name)).length,
          trioWins: winningResults.filter(result => isTrioTournamentName(result.row.tournament_name)).length,
          biggestFieldBeaten: winningResults.reduce((max, result) => {
            const playerCount = normalizeNumber(result.row.player_count) ?? getResultPlayers(result.row.players).length;
            return Math.max(max, playerCount);
          }, 0),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeProfile?.user_id]);

  useEffect(() => {
    if (!searchOpen) return;

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setSearchLoading(true);
      const query = searchQuery.trim();
      let request = supabase
        .from('profiles')
        .select('user_id, username, tag, elo, avatar_url')
        .or('tag.is.null,tag.neq.BOT')
        .order('elo', { ascending: false })
        .limit(8);

      if (query) {
        request = request.ilike('username', `%${query}%`);
      }

      request.then(({ data, error }) => {
        if (cancelled) return;
        setSearchLoading(false);
        setSearchResults(error ? [] : (data ?? []) as SearchProfileRow[]);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    if (!leaderboardOpen) return;

    let cancelled = false;
    setLeaderboardLoading(true);

    Promise.all([
      supabase
        .from('profiles')
        .select('user_id, username, elo, avatar_url, tag')
        .or('tag.is.null,tag.neq.BOT')
        .order('elo', { ascending: false }),
      supabase
        .from('tournament_results')
        .select('players, winner_ids, elo_delta, player_count, tournament_finished_at')
        .order('tournament_finished_at', { ascending: false })
        .limit(500),
    ]).then(([profilesResponse, resultsResponse]) => {
      if (cancelled) return;

      if (profilesResponse.error || resultsResponse.error) {
        setLeaderboards(EMPTY_LEADERBOARDS);
        setLeaderboardLoading(false);
        return;
      }

      const entries = new Map<string, LeaderboardAccumulator>();
      const profileRows = (profilesResponse.data ?? []) as Array<{
        user_id: string;
        username: string | null;
        elo: number | null;
        avatar_url: string | null;
        tag?: string | null;
      }>;
      const humanPlayerIds = new Set(profileRows.map(profileRow => profileRow.user_id));

      const ensureEntry = (userId: string, username?: string | null) => {
        const existing = entries.get(userId);
        if (existing) {
          if (username && !existing.username) existing.username = username;
          return existing;
        }

        const entry: LeaderboardAccumulator = {
          userId,
          username: username || 'Joueur',
          avatarUrl: null,
          elo: 0,
          gamesPlayed: 0,
          gains: 0,
          gamesWon: 0,
          biggestFieldBeaten: 0,
        };
        entries.set(userId, entry);
        return entry;
      };

      profileRows.forEach(profileRow => {
        const entry = ensureEntry(profileRow.user_id, profileRow.username);
        entry.avatarUrl = profileRow.avatar_url;
        entry.elo = normalizeNumber(profileRow.elo) ?? 0;
      });

      ((resultsResponse.data ?? []) as TournamentResultRow[]).forEach(row => {
        getResultPlayers(row.players).forEach((player, index) => {
          const userId = player.playerId ?? player.player_id;
          if (!userId) return;
          if (!humanPlayerIds.has(userId)) return;

          const entry = ensureEntry(userId, player.username);
          const result = { player, index };
          entry.gamesPlayed += 1;
          entry.gains += getPlayerResultEloDelta(row, result);
          if (didPlayerWinTournament(row, result, userId)) {
            entry.gamesWon += 1;
            const playerCount = normalizeNumber(row.player_count) ?? getResultPlayers(row.players).length;
            entry.biggestFieldBeaten = Math.max(entry.biggestFieldBeaten, playerCount);
          }
        });
      });

      const allEntries = Array.from(entries.values());
      setLeaderboards({
        elo: sortLeaderboard(allEntries, 'elo'),
        gamesPlayed: sortLeaderboard(allEntries, 'gamesPlayed'),
        gains: sortLeaderboard(allEntries, 'gains'),
        gamesWon: sortLeaderboard(allEntries, 'gamesWon'),
        biggestFieldBeaten: sortLeaderboard(allEntries, 'biggestFieldBeaten'),
      });
      setLeaderboardLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [leaderboardOpen]);

  const selectSearchProfile = (player: SearchProfileRow) => {
    setSelectedProfile({
      user_id: player.user_id,
      username: player.username,
      tag: player.tag,
      elo: player.elo,
      avatar_url: player.avatar_url,
    });
    setSearchOpen(false);
    setSearchQuery('');
  };

  const toggleSearch = () => {
    setSearchOpen(current => {
      const next = !current;
      if (next) setLeaderboardOpen(false);
      return next;
    });
  };

  const toggleLeaderboard = () => {
    setLeaderboardOpen(current => {
      const next = !current;
      if (next) setSearchOpen(false);
      return next;
    });
  };

  return (
    <section className={rootClassName} aria-label={`Statistiques de ${name}`}>
      <div className={styles.glowOrange} aria-hidden="true" />
      <div className={styles.glowBlue} aria-hidden="true" />
      <div className={styles.glowGold} aria-hidden="true" />

      {onClose && (
        <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Fermer les statistiques">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="7" y1="7" x2="17" y2="17" vectorEffect="non-scaling-stroke" />
            <line x1="17" y1="7" x2="7" y2="17" vectorEffect="non-scaling-stroke" />
          </svg>
        </button>
      )}

      <header className={styles.header}>
        <div>
          <h1>Statistiques</h1>
        </div>
        <div className={styles.headerActions}>
          <span>{metrics?.season ?? 'Saison ALPHA'}</span>
          <div className={styles.leaderboardWrap}>
            <button
              className={styles.leaderboardButton}
              type="button"
              onClick={toggleLeaderboard}
            >
              Leaderboard
            </button>
            {leaderboardOpen && (
              <>
                <button
                  className={styles.searchBackdrop}
                  type="button"
                  aria-label="Fermer les leaderboards"
                  onClick={() => setLeaderboardOpen(false)}
                />
                <div className={styles.leaderboardPanel}>
                  <div className={styles.leaderboardPanelHeader}>
                    <h2>Leaderboards</h2>
                    {leaderboardLoading && <span>Chargement...</span>}
                  </div>
                  <div className={styles.leaderboardGrid}>
                    <LeaderboardCard title="ELO" entries={leaderboards.elo} />
                    <LeaderboardCard title="Parties jouées" entries={leaderboards.gamesPlayed} />
                    <LeaderboardCard title="Gain ELO" entries={leaderboards.gains} signed />
                    <LeaderboardCard title="Parties gagnées" entries={leaderboards.gamesWon} />
                    <LeaderboardCard title="Plus gros field battu" entries={leaderboards.biggestFieldBeaten} />
                    <LeaderboardCard title="Succès" entries={[]} inDevelopment />
                  </div>
                </div>
              </>
            )}
          </div>
          <div className={styles.searchWrap}>
            <button
              className={styles.searchButton}
              type="button"
              onClick={toggleSearch}
            >
              Rechercher
            </button>
            {searchOpen && (
              <>
                <button
                  className={styles.searchBackdrop}
                  type="button"
                  aria-label="Fermer la recherche"
                  onClick={() => setSearchOpen(false)}
                />
                <div className={styles.searchPanel}>
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Pseudo joueur"
                  />
                  <div className={styles.searchResults}>
                    {searchLoading && <p>Recherche...</p>}
                    {!searchLoading && searchResults.length === 0 && <p>Aucun joueur</p>}
                    {!searchLoading && searchResults.map(player => (
                      <button
                        key={player.user_id}
                        type="button"
                        onMouseDown={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          selectSearchProfile(player);
                        }}
                      >
                        <strong>{player.username ?? 'Joueur'}</strong>
                        <span>{formatStatsNumber(player.elo)} ELO</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className={styles.contentGrid}>
        <article className={`${styles.card} ${styles.profileCard}`}>
          <div className={styles.identityRow}>
            <PlayerAvatar
              name={name}
              avatarUrl={activeProfile?.avatar_url}
              className={styles.profileAvatar}
              tone="warm"
            />
            <div className={styles.identityText}>
              <h2>{name}</h2>
              <p>Niveau : {level}</p>
            </div>
          </div>

          <div className={styles.rankBlock}>
            <span>Rank global</span>
            <strong>{rankLabel}</strong>
            <em>{elo === null ? 'ELO -' : `ELO ${formatStatsNumber(elo)}`}</em>
          </div>
        </article>

        <div className={styles.statsGrid}>
          <StatsKpi title="Parties gagnées" value={formatStatsNumber(gamesWon)} compact />
          <StatsKpi title="Parties jouées" value={formatStatsNumber(gamesPlayed)} compact />
          <StatsKpi title="Gain ELO" value={formatSignedNumber(gains)} compact />
          <StatsKpi title="Victoire HeadUp" value={formatStatsNumber(headupWins)} compact />
          <StatsKpi title="Victoire Trio" value={formatStatsNumber(trioWins)} compact />
          <StatsKpi title="Plus gros field battu" value={formatStatsNumber(biggestFieldBeaten)} compact />
        </div>

        <article className={`${styles.card} ${styles.achievementsPanel} ${styles.developmentHost}`}>
          <div className={styles.panelTitle}>
            <h2>Succès</h2>
          </div>
          <div className={styles.achievementGrid}>
            {achievements.map(achievement => (
              <div
                key={achievement.title}
                className={`${styles.achievement} ${achievement.unlocked ? styles.achievementUnlocked : ''}`}
              >
                <span>{achievement.icon}</span>
                <div>
                  <strong>{achievement.title}</strong>
                  <small>{achievement.description}</small>
                </div>
              </div>
            ))}
          </div>
          <DevelopmentRibbon />
        </article>

        <article className={`${styles.card} ${styles.progressPanel}`}>
          <div className={styles.panelTitle}>
            <h2>Progression</h2>
          </div>
          <RankProgressCard rankProgress={rankProgress} />
          <ProgressRow
            label="Games avant prochain emoji"
            value={formatStatsNumber(gamesBeforeNextEmoji)}
            progress={nextEmojiProgress}
            inDevelopment
          />
          <ProgressRow
            label="Succès débloqués"
            value={`${unlockedAchievements} / ${totalAchievements}`}
            progress={achievementsProgress}
            inDevelopment
          />
        </article>
      </div>
    </section>
  );
}

function RankProgressCard({ rankProgress }: { rankProgress: ReturnType<typeof getRankProgress> }) {
  const assetSrc = getPublicUrl(`/Assets/${rankProgress.tier.asset}`);

  return (
    <div className={styles.rankProgressCard}>
      <div className={styles.rankAssetFrame}>
        <img className={styles.rankAsset} src={assetSrc} alt={rankProgress.tier.label} />
      </div>
      <div className={styles.rankProgressContent}>
        <div className={styles.rankProgressHeader}>
          <div>
            <span>Rank actuel</span>
            <strong>{rankProgress.tier.label}</strong>
          </div>
        </div>
        <div className={styles.progressTrack}>
          <span style={{ '--progress': `${rankProgress.progress}%` } as CSSProperties} />
        </div>
        <div className={styles.rankProgressMeta}>
          <span>{rankProgress.value}</span>
          <span>{rankProgress.hint}</span>
        </div>
      </div>
    </div>
  );
}

function StatsKpi({ title, value, compact = false }: { title: string; value: string | number; compact?: boolean }) {
  return (
    <article className={`${styles.card} ${styles.kpiCard} ${compact ? styles.kpiCardCompact : ''}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DevelopmentRibbon() {
  return <span className={styles.developmentRibbon}>En développement</span>;
}

function LeaderboardCard({ title, entries, signed = false, inDevelopment = false }: { title: string; entries: LeaderboardEntry[]; signed?: boolean; inDevelopment?: boolean }) {
  return (
    <article className={`${styles.leaderboardCard} ${inDevelopment ? styles.leaderboardCardDeveloping : ''}`}>
      <h3>{title}</h3>
      {entries.length > 0 ? (
        <div className={styles.leaderboardRows}>
          {entries.map((entry, index) => (
            <div key={`${title}-${entry.userId}`} className={styles.leaderboardRow}>
              <span className={styles.leaderboardRank}>#{getLeaderboardRank(entries, index)}</span>
              <strong>{entry.username}</strong>
              <em>{signed ? formatSignedNumber(entry.value) : formatStatsNumber(entry.value)}</em>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.leaderboardEmpty}>{inDevelopment ? 'Disponible bientôt' : 'Aucune donnée'}</p>
      )}
      {inDevelopment && <DevelopmentRibbon />}
    </article>
  );
}

function ProgressRow({ label, value, progress, inDevelopment = false }: { label: string; value: string; progress: number; inDevelopment?: boolean }) {
  return (
    <div className={`${styles.progressRow} ${inDevelopment ? styles.progressRowDeveloping : ''}`}>
      <div className={styles.progressLabel}>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <div className={styles.progressTrack}>
        <span style={{ '--progress': `${progress}%` } as CSSProperties} />
      </div>
      {inDevelopment && <DevelopmentRibbon />}
    </div>
  );
}
