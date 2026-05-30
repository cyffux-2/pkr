import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface LiveSiteStats {
  playersInGame: number;
  activeTables: number;
  openTournaments: number;
  weeklyRegistrations: number;
  completedTournamentsThisWeek: number;
}

interface TournamentStatsRow {
  max_players: number | null;
  players: unknown;
}

interface PokerTableStatsRow {
  players: unknown;
}

const EMPTY_LIVE_SITE_STATS: LiveSiteStats = {
  playersInGame: 0,
  activeTables: 0,
  openTournaments: 0,
  weeklyRegistrations: 0,
  completedTournamentsThisWeek: 0,
};

export function useLiveSiteStats() {
  const [stats, setStats] = useState<LiveSiteStats>(EMPTY_LIVE_SITE_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      const weekStartIso = new Date(getCurrentWeekStartMs()).toISOString();
      const [tablesResponse, tournamentsResponse, registrationsResponse, resultsResponse] = await Promise.all([
        supabase
          .from('poker-tables')
          .select('players'),
        supabase
          .from('tournaments')
          .select('max_players, players'),
        supabase
          .rpc('count_weekly_profile_registrations'),
        supabase
          .from('tournament_results')
          .select('tournament_finished_at')
          .gte('tournament_finished_at', weekStartIso),
      ]);

      if (cancelled) return;

      if (tablesResponse.error || tournamentsResponse.error) {
        setStats(EMPTY_LIVE_SITE_STATS);
        setLoading(false);
        return;
      }

      const tableRows = (tablesResponse.data ?? []) as PokerTableStatsRow[];
      const tournamentRows = (tournamentsResponse.data ?? []) as TournamentStatsRow[];
      const playersInGame = new Set<string>();

      tableRows.forEach(table => {
        getPlayerIds(table.players).forEach(playerId => playersInGame.add(playerId));
      });

      setStats({
        playersInGame: playersInGame.size,
        activeTables: tableRows.filter(table => getPlayerIds(table.players).length > 0).length,
        openTournaments: tournamentRows.filter(tournament => {
          const maxPlayers = normalizeStatNumber(tournament.max_players);
          return maxPlayers === null || getPlayerIds(tournament.players).length < maxPlayers;
        }).length,
        weeklyRegistrations: registrationsResponse.error ? 0 : normalizeStatNumber(registrationsResponse.data) ?? 0,
        completedTournamentsThisWeek: resultsResponse.error ? 0 : resultsResponse.data?.length ?? 0,
      });
      setLoading(false);
    };

    fetchStats();

    const refreshInterval = window.setInterval(fetchStats, 10000);
    const channel = supabase
      .channel('live-site-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poker-tables' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_results' }, fetchStats)
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      supabase.removeChannel(channel);
    };
  }, []);

  return { stats, loading };
}

export function formatLiveStatNumber(value: unknown) {
  const numberValue = normalizeStatNumber(value) ?? 0;
  return new Intl.NumberFormat('fr-FR').format(Math.round(numberValue));
}

function getPlayerIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((playerId): playerId is string => typeof playerId === 'string' && playerId.length > 0);
}

function normalizeStatNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getCurrentWeekStartMs() {
  const now = new Date();
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  const daysSinceMonday = (day + 6) % 7;

  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  weekStart.setHours(0, 0, 0, 0);

  return weekStart.getTime();
}
