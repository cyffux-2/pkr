import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import PlayerAvatar from './PlayerAvatar';
import styles from './LocalTournamentLeaderboard.module.css';

type LocalLeaderboardMode = 'trio' | 'headup';
type LocalLeaderboardMetric = 'wins' | 'gamesPlayed' | 'eloGain';

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
  tournament_finished_at: string;
  tournament_name: string | null;
};

type ProfileRow = {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
};

type LeaderboardEntry = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  gamesPlayed: number;
  wins: number;
  eloGain: number;
};

const MODE_MATCHERS: Record<LocalLeaderboardMode, RegExp> = {
  trio: /^triple\s+(normal|turbo)$/i,
  headup: /^head[-\s]?up\s+(normal|turbo)$/i,
};

const LIMIT = 5;

const METRICS: Array<{ key: LocalLeaderboardMetric; label: string }> = [
  { key: 'wins', label: 'Victoires' },
  { key: 'gamesPlayed', label: 'Parties' },
  { key: 'eloGain', label: 'ELO gagné' },
];

function normalizeNumber(value: number | string | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value);
}

function formatSignedNumber(value: number) {
  const formatted = formatNumber(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function getResultPlayers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(player => player && typeof player === 'object') as TournamentResultPlayerRow[];
}

function getTournamentNameQueryPattern(mode: LocalLeaderboardMode) {
  return mode === 'headup' ? 'Head%' : 'Triple%';
}

function getPlayerEloDelta(row: TournamentResultRow, player: TournamentResultPlayerRow, index: number) {
  const deltaFromList = Array.isArray(row.elo_delta) ? normalizeNumber(row.elo_delta[index]) : null;
  return deltaFromList ?? normalizeNumber(player.eloDelta ?? player.elo_delta) ?? 0;
}

function didPlayerWin(row: TournamentResultRow, player: TournamentResultPlayerRow, userId: string) {
  return Boolean(
    player.isWinner
    ?? player.is_winner
    ?? (row.winner_ids ?? []).includes(userId)
    ?? player.placement === 1,
  );
}

function getMetricValue(entry: LeaderboardEntry, metric: LocalLeaderboardMetric) {
  return entry[metric];
}

function formatMetricValue(entry: LeaderboardEntry, metric: LocalLeaderboardMetric) {
  if (metric === 'wins') return `${formatNumber(entry.wins)} Victoires`;
  if (metric === 'gamesPlayed') return `${formatNumber(entry.gamesPlayed)} parties`;
  return `${formatSignedNumber(entry.eloGain)} ELO`;
}

function getRank(entries: LeaderboardEntry[], index: number, metric: LocalLeaderboardMetric) {
  const entry = entries[index];
  if (!entry) return index + 1;

  const firstSameValueIndex = entries.findIndex(candidate => getMetricValue(candidate, metric) === getMetricValue(entry, metric));
  return firstSameValueIndex >= 0 ? firstSameValueIndex + 1 : index + 1;
}

function buildLeaderboard(mode: LocalLeaderboardMode, results: TournamentResultRow[], profiles: ProfileRow[]) {
  const profilesById = new Map(profiles.map(profile => [profile.user_id, profile]));
  const entries = new Map<string, LeaderboardEntry>();
  const matcher = MODE_MATCHERS[mode];

  results
    .filter(row => matcher.test((row.tournament_name ?? '').trim()))
    .forEach(row => {
      getResultPlayers(row.players).forEach((player, index) => {
        const userId = player.playerId ?? player.player_id;
        if (!userId) return;

        const profile = profilesById.get(userId);
        const current = entries.get(userId) ?? {
          userId,
          username: profile?.username || player.username || 'Joueur',
          avatarUrl: profile?.avatar_url ?? null,
          gamesPlayed: 0,
          wins: 0,
          eloGain: 0,
        };

        current.username = profile?.username || current.username;
        current.avatarUrl = profile?.avatar_url ?? current.avatarUrl;
        current.gamesPlayed += 1;
        current.eloGain += getPlayerEloDelta(row, player, index);
        if (didPlayerWin(row, player, userId)) current.wins += 1;
        entries.set(userId, current);
      });
    });

  return Array.from(entries.values());
}

export default function LocalTournamentLeaderboard({ mode, title }: { mode: LocalLeaderboardMode; title: string }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMetric, setActiveMetric] = useState<LocalLeaderboardMetric>('wins');

  const rankedEntries = useMemo(
    () => [...entries]
      .sort((left, right) => {
        const metricDifference = getMetricValue(right, activeMetric) - getMetricValue(left, activeMetric);
        if (metricDifference !== 0) return metricDifference;
        if (right.wins !== left.wins) return right.wins - left.wins;
        if (right.eloGain !== left.eloGain) return right.eloGain - left.eloGain;
        if (right.gamesPlayed !== left.gamesPlayed) return right.gamesPlayed - left.gamesPlayed;
        return left.username.localeCompare(right.username, 'fr');
      })
      .slice(0, LIMIT),
    [activeMetric, entries],
  );

  useEffect(() => {
    let cancelled = false;

    const loadLeaderboard = async () => {
      const [profilesResponse, resultsResponse] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, username, avatar_url'),
        supabase
          .from('tournament_results')
          .select('players, winner_ids, elo_delta, tournament_finished_at, tournament_name')
          .ilike('tournament_name', getTournamentNameQueryPattern(mode))
          .order('tournament_finished_at', { ascending: false })
          .limit(500),
      ]);

      if (cancelled) return;

      if (profilesResponse.error || resultsResponse.error) {
        setEntries([]);
      } else {
        setEntries(buildLeaderboard(
          mode,
          (resultsResponse.data ?? []) as TournamentResultRow[],
          (profilesResponse.data ?? []) as ProfileRow[],
        ));
      }

      setLoading(false);
    };

    loadLeaderboard();

    const channel = supabase
      .channel(`local-${mode}-leaderboard`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_results' },
        loadLeaderboard
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        loadLeaderboard
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [mode]);

  return (
    <aside className={`${styles.leaderboard} ${styles[mode]}`} aria-label={title}>
      <div className={styles.header}>
        <span>Leaderboard</span>
        <strong>{title}</strong>
      </div>

      <div className={styles.metricTabs} role="tablist" aria-label={`Classement ${title}`}>
        {METRICS.map(metric => (
          <button
            key={metric.key}
            className={activeMetric === metric.key ? styles.metricTabActive : ''}
            type="button"
            role="tab"
            aria-selected={activeMetric === metric.key}
            onClick={() => setActiveMetric(metric.key)}
          >
            {metric.label}
          </button>
        ))}
      </div>

      <div className={styles.rows}>
        {loading && <p className={styles.empty}>Chargement...</p>}
        {!loading && entries.length === 0 && <p className={styles.empty}>Aucune donnée</p>}
        {!loading && rankedEntries.map((entry, index) => (
          <div className={styles.row} key={entry.userId}>
            <span className={styles.rank}>#{getRank(rankedEntries, index, activeMetric)}</span>
            <div className={styles.identity}>
              <PlayerAvatar
                name={entry.username}
                avatarUrl={entry.avatarUrl}
                className={styles.leaderboardAvatar}
                tone={mode === 'headup' ? 'table' : 'warm'}
              />
              <strong>{entry.username}</strong>
            </div>
            <div className={styles.values}>
              <strong>{formatMetricValue(entry, activeMetric)}</strong>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
