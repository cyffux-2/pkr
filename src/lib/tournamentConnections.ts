import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type Connection = {
  channel: RealtimeChannel;
  interval?: number;
  fallbackTimeout?: number;
  tableId?: number;
  fallback?: () => void;
  promise: Promise<number | null>;
  resolve: (tableId: number | null) => void;
  listeners: Set<(tableId: number) => void>;
};
type PokerTableRow = {
  id: number;
  players?: unknown;
};

const connections = new Map<string, Connection>();
const enableEdgeFunctionTableFallback = process.env.REACT_APP_ENABLE_GET_TOURNAMENT_TABLE_FUNCTION !== '0';

function connectionKey(tournamentId: number, userId: string) {
  return `${tournamentId}:${userId}`;
}

function parseTableId(payload: unknown) {
  const rawTableId = (payload as Record<string, unknown> | undefined)?.['table-id'];
  const tableId = typeof rawTableId === 'number' ? rawTableId : Number(rawTableId);
  return Number.isFinite(tableId) ? tableId : null;
}

function notify(connection: Connection, tableId: number) {
  if (connection.tableId === tableId) return;
  if (connection.fallbackTimeout) {
    window.clearTimeout(connection.fallbackTimeout);
    connection.fallbackTimeout = undefined;
  }
  connection.tableId = tableId;
  connection.resolve(tableId);
  connection.listeners.forEach(listener => listener(tableId));
}

function pickPlayerTable(rows: PokerTableRow[] | null | undefined, userId: string) {
  const tables = rows ?? [];
  return tables.find(candidate => (
    Array.isArray(candidate.players) ? candidate.players.includes(userId) : true
  )) ?? tables[0] ?? null;
}

export function getCachedTournamentTable(tournamentId: number, userId: string) {
  return connections.get(connectionKey(tournamentId, userId))?.tableId ?? null;
}

export function closeTournamentConnection(tournamentId: number, userId: string) {
  const key = connectionKey(tournamentId, userId);
  const connection = connections.get(key);
  if (!connection) return;

  if (connection.interval) window.clearInterval(connection.interval);
  if (connection.fallbackTimeout) window.clearTimeout(connection.fallbackTimeout);
  connection.channel.unsubscribe();
  void supabase.removeChannel(connection.channel);
  connections.delete(key);
}

export async function ensureTournamentTableConnection(params: {
  tournamentId: number;
  userId: string;
  accessToken: string;
  onAssigned?: (tableId: number) => void;
}) {
  const { tournamentId, userId, accessToken, onAssigned } = params;
  const key = connectionKey(tournamentId, userId);
  const existing = connections.get(key);

  if (existing) {
    if (existing.tableId) {
      onAssigned?.(existing.tableId);
    } else if (onAssigned) {
      existing.listeners.add(onAssigned);
      existing.fallback?.();
    }
    return existing.promise;
  }

  supabase.realtime.setAuth(accessToken);

  let resolveConnection: (tableId: number | null) => void = () => {};
  const promise = new Promise<number | null>(resolve => {
    resolveConnection = resolve;
  });

  const channelName = `tournament:${tournamentId}:private-user:${userId}`;
  const channel = supabase.channel(channelName, { config: { private: true } });
  const connection: Connection = {
    channel,
    promise,
    resolve: resolveConnection,
    listeners: new Set(onAssigned ? [onAssigned] : []),
  };

  connections.set(key, connection);

  const requestTable = () => {
    void channel.send({
      type: 'broadcast',
      event: 'wait-table',
      payload: {
        ready: true,
        playerId: userId,
      },
    });
  };

  let fallbackInFlight = false;
  const fallback = async () => {
    if (fallbackInFlight) return;
    fallbackInFlight = true;

    try {
      const { data: tableRows } = await supabase
        .from('poker-tables')
        .select('id, players')
        .eq('tournament', tournamentId)
        .order('created_at', { ascending: false });
      const dbTable = pickPlayerTable(tableRows as PokerTableRow[] | null, userId);
      if (dbTable?.id && Number.isFinite(Number(dbTable.id))) {
        notify(connection, Number(dbTable.id));
        return;
      }

      if (enableEdgeFunctionTableFallback) {
        const { data, error } = await supabase.functions.invoke('get-tournament-table', {
          body: { tournamentId },
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const tableId = error || data?.error || !data?.tableId ? null : Number(data.tableId);
        if (tableId && Number.isFinite(tableId)) {
          notify(connection, tableId);
        }
      }
    } finally {
      fallbackInFlight = false;
    }
  };
  connection.fallback = () => {
    void fallback();
  };

  channel
    .on('broadcast', { event: 'table-assigned' }, ({ payload }) => {
      const tableId = parseTableId(payload);
      if (tableId) {
        notify(connection, tableId);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        requestTable();
        if (connection.fallbackTimeout) window.clearTimeout(connection.fallbackTimeout);
        connection.fallbackTimeout = window.setTimeout(() => {
          void fallback();
        }, 1200);
        if (connection.interval) window.clearInterval(connection.interval);
        connection.interval = window.setInterval(() => {
          requestTable();
          void fallback();
        }, 5000);
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        void fallback();
      }
    });

  connection.fallbackTimeout = window.setTimeout(() => {
    void fallback();
  }, 1500);

  connection.interval = window.setInterval(() => {
    void fallback();
  }, 5000);

  return promise;
}

export function closeTournamentConnectionsForUser(userId: string) {
  Array.from(connections.entries()).forEach(([key, connection]) => {
    if (!key.endsWith(`:${userId}`)) return;
    if (connection.interval) window.clearInterval(connection.interval);
    if (connection.fallbackTimeout) window.clearTimeout(connection.fallbackTimeout);
    connection.channel.unsubscribe();
    void supabase.removeChannel(connection.channel);
    connections.delete(key);
  });
}
