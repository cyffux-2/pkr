import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  closeTournamentConnectionsForUser,
  ensureTournamentTableConnection,
  getCachedTournamentTable,
} from '../lib/tournamentConnections';
import {
  ensureTableStateCache,
  getCachedTableState,
  watchCachedTableState,
} from '../lib/tableStateCache';
import {
  closePrivateCardsForUser,
  refreshPrivateCards,
  syncPrivateCardsWithTableState,
} from '../lib/privateCardsCache';
import {
  clearActiveTablesForUser,
  setActiveTablesForUser,
} from '../lib/activeTablesRegistry';
import {
  isDismissedElimination,
  watchDismissedEliminatedTables,
  type DismissedEliminationKey,
} from '../lib/eliminatedTournamentDismissals';

type ActiveTournamentRow = {
  id: number;
  tournament_name: string;
  start_date: string;
  max_players: number;
  players: string[];
};

const ACTIVE_TOURNAMENT_REFRESH_MS = 15000;
const ACTIVE_TOURNAMENT_EVENT_DEBOUNCE_MS = 500;

function tournamentFingerprint(tournament: ActiveTournamentRow) {
  return [
    tournament.id,
    tournament.tournament_name,
    tournament.start_date,
    tournament.max_players,
    tournament.players.join(','),
  ].join(':');
}

function sameTournamentRow(left: ActiveTournamentRow | undefined, right: ActiveTournamentRow) {
  return Boolean(left && tournamentFingerprint(left) === tournamentFingerprint(right));
}

function sameTournamentRows(left: ActiveTournamentRow[], right: ActiveTournamentRow[]) {
  if (left.length !== right.length) return false;

  return left.every((row, index) => tournamentFingerprint(row) === tournamentFingerprint(right[index]));
}

function isEndedTableStatus(status: unknown) {
  return status === 3 || status === '3' || status === 'ENDED';
}

export function ActiveTablesPreloader() {
  const { user, session, loading } = useAuth();
  const userId = user?.id;
  const accessToken = session?.access_token;
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournamentRow[]>([]);
  const [knownTournamentsById, setKnownTournamentsById] = useState<Record<number, ActiveTournamentRow>>({});
  const [tableIdsByTournament, setTableIdsByTournament] = useState<Record<number, number>>({});
  const [dismissedEliminations, setDismissedEliminations] = useState<Set<DismissedEliminationKey>>(new Set());

  const registeredTournamentIds = useMemo(
    () => activeTournaments.map(tournament => tournament.id).sort((left, right) => left - right),
    [activeTournaments],
  );
  const activeTournamentIds = useMemo(
    () => activeTournaments
      .filter(tournament => {
        if (!userId) return false;

        const tableId = tableIdsByTournament[tournament.id] ?? getCachedTournamentTable(tournament.id, userId);
        return !tableId || !isDismissedElimination(dismissedEliminations, tableId, tournament.id);
      })
      .map(tournament => tournament.id)
      .sort((left, right) => left - right),
    [activeTournaments, dismissedEliminations, tableIdsByTournament, userId],
  );
  const tableIds = useMemo(
    () => Array.from(new Set(
      Object.entries(tableIdsByTournament)
        .filter(([rawTournamentId, tableId]) => !isDismissedElimination(dismissedEliminations, tableId, Number(rawTournamentId)))
        .map(([, tableId]) => tableId),
    ))
      .filter((tableId): tableId is number => Number.isFinite(tableId)),
    [dismissedEliminations, tableIdsByTournament],
  );

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      setActiveTournaments([]);
      setTableIdsByTournament({});
      return;
    }

    let cancelled = false;
    let eventDebounce: number | undefined;

    const fetchActiveTournaments = async () => {
      const { data, error } = await supabase
        .from('tournaments')
        .select('id, tournament_name, start_date, max_players, players')
        .contains('players', [userId])
        .order('start_date', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('Failed to preload active tournaments:', error);
        setActiveTournaments([]);
        return;
      }

      const rows = (data ?? []) as ActiveTournamentRow[];
      setActiveTournaments(current => sameTournamentRows(current, rows) ? current : rows);
      setKnownTournamentsById(current => {
        let changed = false;
        const next = { ...current };
        rows.forEach(tournament => {
          if (sameTournamentRow(current[tournament.id], tournament)) return;
          next[tournament.id] = tournament;
          changed = true;
        });
        return changed ? next : current;
      });
    };
    const scheduleActiveTournamentFetch = () => {
      if (eventDebounce) {
        window.clearTimeout(eventDebounce);
      }
      eventDebounce = window.setTimeout(() => {
        eventDebounce = undefined;
        void fetchActiveTournaments();
      }, ACTIVE_TOURNAMENT_EVENT_DEBOUNCE_MS);
    };

    void fetchActiveTournaments();
    const refreshInterval = window.setInterval(fetchActiveTournaments, ACTIVE_TOURNAMENT_REFRESH_MS);
    const channel = supabase
      .channel(`active-tables-preloader-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, scheduleActiveTournamentFetch)
      .subscribe();

    return () => {
      cancelled = true;
      if (eventDebounce) window.clearTimeout(eventDebounce);
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(channel);
    };
  }, [loading, userId]);

  useEffect(() => {
    if (!userId) {
      setDismissedEliminations(new Set());
      return;
    }

    return watchDismissedEliminatedTables(userId, setDismissedEliminations);
  }, [userId]);

  useEffect(() => {
    setTableIdsByTournament(current => {
      const activeIds = new Set(registeredTournamentIds);
      const next = Object.entries(current).reduce<Record<number, number>>((accumulator, [rawTournamentId, tableId]) => {
        const tournamentId = Number(rawTournamentId);
        const cachedState = getCachedTableState(tableId);
        const keepKnownTable = cachedState && isEndedTableStatus(cachedState.game_status) && !isDismissedElimination(dismissedEliminations, tableId, tournamentId);
        if (activeIds.has(tournamentId) || keepKnownTable) {
          accumulator[tournamentId] = tableId;
        }
        return accumulator;
      }, {});

      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [dismissedEliminations, registeredTournamentIds]);

  useEffect(() => {
    if (!userId || !accessToken || activeTournamentIds.length === 0) return;

    let cancelled = false;

    activeTournamentIds.forEach(tournamentId => {
      const cachedTableId = getCachedTournamentTable(tournamentId, userId);
      if (cachedTableId) {
        setTableIdsByTournament(current => (
          current[tournamentId] === cachedTableId ? current : { ...current, [tournamentId]: cachedTableId }
        ));
        void ensureTableStateCache(cachedTableId);
        refreshPrivateCards(cachedTableId, userId, getCachedTableState(cachedTableId));
      }

      void ensureTournamentTableConnection({
        tournamentId,
        userId,
        accessToken,
        onAssigned: tableId => {
          if (cancelled) return;
          setTableIdsByTournament(current => {
            void ensureTableStateCache(tableId);
            refreshPrivateCards(tableId, userId, getCachedTableState(tableId));
            return current[tournamentId] === tableId ? current : { ...current, [tournamentId]: tableId };
          });
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, activeTournamentIds, userId]);

  useEffect(() => {
    if (!userId || tableIds.length === 0) return;

    const cleanups = tableIds.map(tableId => {
      void ensureTableStateCache(tableId);
      refreshPrivateCards(tableId, userId, getCachedTableState(tableId));

      return watchCachedTableState(tableId, state => {
        syncPrivateCardsWithTableState(tableId, userId, state);
      });
    });

    return () => {
      cleanups.forEach(cleanup => cleanup());
    };
  }, [tableIds, userId]);

  useEffect(() => {
    if (!userId) return;

    return () => {
      clearActiveTablesForUser(userId);
      closeTournamentConnectionsForUser(userId);
      closePrivateCardsForUser(userId);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    setActiveTablesForUser(
      userId,
      Object.entries(tableIdsByTournament)
        .filter(([rawTournamentId, tableId]) => !isDismissedElimination(dismissedEliminations, tableId, Number(rawTournamentId)))
        .map(([rawTournamentId, tableId]) => {
          const tournamentId = Number(rawTournamentId);
          const tournament = knownTournamentsById[tournamentId];
          return {
            tournamentId,
            tableId,
            tournamentName: tournament?.tournament_name,
            startDate: tournament?.start_date,
            maxPlayers: tournament?.max_players,
          };
        }),
    );
  }, [dismissedEliminations, knownTournamentsById, tableIdsByTournament, userId]);

  return null;
}
