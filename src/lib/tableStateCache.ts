import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type WireCard = {
  _color?: number;
  _value?: number;
  color?: number;
  value?: number;
};

export type TablePlayer = {
  id?: string;
  name?: string;
  has_cards: boolean;
  chips: number;
  bet: number;
  cards?: WireCard[];
};

export type EloAdjustmentInfo = {
  playerId: string;
  initialElo: number;
  newElo: number;
  delta: number;
  placement: number;
  chanceMultiplier: number;
  allInEvAdjustment: number;
};

export type TableEvent = {
  id: number;
  type: string;
  at: number;
  playerId?: string;
  seatIndex?: number;
  action?: string;
  value?: number;
  amount?: number;
  cardCount?: number;
  boardCount?: number;
  turnId?: number;
  actionRequestId?: number;
  BB?: number;
  SB?: number;
  pot?: number[];
  winningPlayerIds?: string[];
  automatic?: boolean;
};

export type TableState = {
  id: number;
  stateRevision?: number;
  sentAt?: number;
  tournamentId?: number;
  turnId?: number;
  actionRequestId?: number;
  common_cards: WireCard[];
  players: (TablePlayer | null)[];
  pot: number[];
  button: number;
  playerToPlay: number | null;
  BB: number;
  SB: number;
  game_status: string | number;
  showdown?: boolean;
  winningPlayerIds?: string[];
  tournamentWinnerIds?: string[];
  eloResults?: Record<string, EloAdjustmentInfo>;
  lastEvent?: TableEvent | null;
  events?: TableEvent[];
};

type ProfileRow = {
  user_id: string;
  username: string;
};

type CacheEntry = {
  channel?: RealtimeChannel;
  actionChannel?: RealtimeChannel;
  connecting?: Promise<TableState | null>;
  actionConnecting?: Promise<RealtimeChannel | null>;
  fallbackInterval?: number;
  snapshotInterval?: number;
  visibilityListener?: () => void;
  reconnectTimeout?: number;
  lastStateAt?: number;
  lastSnapshotRequestedAt?: number;
  fingerprint?: string;
  requestSnapshot?: (force?: boolean) => void;
  state?: TableState;
  listeners: Set<(state: TableState) => void>;
};

const tableCache = new Map<number, CacheEntry>();
const STALE_STATE_SNAPSHOT_MS = 12000;
const SNAPSHOT_CHECK_MS = 5000;
const SNAPSHOT_MIN_INTERVAL_MS = 5000;
const FALLBACK_REFRESH_MS = 5000;
const RECONNECT_DELAY_MS = 1000;
const ACTION_CHANNEL_RETRY_DELAY_MS = 180;

function numericValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isFreshTableState(current: TableState | null | undefined, next: TableState) {
  if (!current) return true;

  const currentRevision = numericValue(current.stateRevision);
  const nextRevision = numericValue(next.stateRevision);
  if (currentRevision !== null || nextRevision !== null) {
    if (currentRevision === null) return true;
    if (nextRevision === null) return false;
    return nextRevision >= currentRevision;
  }

  const currentSentAt = numericValue(current.sentAt);
  const nextSentAt = numericValue(next.sentAt);
  if (currentSentAt !== null || nextSentAt !== null) {
    if (currentSentAt === null) return true;
    if (nextSentAt === null) return false;
    return nextSentAt >= currentSentAt;
  }

  return true;
}

function pickFreshestTableState(current: TableState | null, candidate: TableState) {
  return isFreshTableState(current, candidate) ? candidate : current;
}

function cardFingerprint(card: WireCard | undefined) {
  if (!card) return '';
  return `${card._color ?? card.color ?? ''}:${card._value ?? card.value ?? ''}`;
}

function stateFingerprint(state: TableState) {
  const eloResults = state.eloResults
    ? Object.entries(state.eloResults)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([playerId, result]) => [
        playerId,
        result.initialElo,
        result.newElo,
        result.delta,
        result.placement,
        result.chanceMultiplier,
        result.allInEvAdjustment,
      ])
    : [];

  return JSON.stringify({
    tournamentId: state.tournamentId ?? null,
    turnId: state.turnId ?? null,
    actionRequestId: state.actionRequestId ?? null,
    playerToPlay: state.playerToPlay,
    button: state.button,
    BB: state.BB,
    SB: state.SB,
    gameStatus: state.game_status,
    showdown: Boolean(state.showdown),
    winners: state.winningPlayerIds ?? [],
    tournamentWinners: state.tournamentWinnerIds ?? [],
    eloResults,
    lastEventId: state.lastEvent?.id ?? null,
    eventIds: state.events?.map(event => event.id) ?? [],
    commonCards: state.common_cards.map(cardFingerprint),
    pot: state.pot,
    players: state.players.map(player => player
      ? [
        player.id ?? '',
        player.name ?? '',
        player.has_cards,
        player.chips,
        player.bet,
        player.cards?.map(cardFingerprint) ?? [],
      ]
      : null
    ),
  });
}

function extractTableStatePayload(payload: unknown): TableState | null {
  if (!payload || typeof payload !== 'object') return null;

  const maybeWrapped = payload as { state?: unknown };
  const candidate = maybeWrapped.state ?? payload;
  if (!candidate || typeof candidate !== 'object') return null;

  const next = candidate as TableState;
  if (typeof next.id === 'number' && Array.isArray(next.players)) {
    return next;
  }

  return null;
}

function extractLatestTableState(rawState: unknown): TableState | null {
  if (!rawState || typeof rawState !== 'object') return null;

  const state = rawState as Record<string, Array<{ payload?: unknown }>>;
  let latest: TableState | null = null;

  for (const presences of Object.values(state)) {
    if (!Array.isArray(presences)) continue;
    for (const presence of presences) {
      const payload = extractTableStatePayload(presence?.payload);
      if (payload) {
        latest = pickFreshestTableState(latest, payload);
      }
    }
  }

  return latest;
}

function getEntry(tableId: number) {
  const existing = tableCache.get(tableId);
  if (existing) return existing;

  const entry: CacheEntry = {
    listeners: new Set(),
  };
  tableCache.set(tableId, entry);
  return entry;
}

export function getCachedTableState(tableId: number) {
  return tableCache.get(tableId)?.state ?? null;
}

export function setCachedTableState(state: TableState) {
  const entry = getEntry(state.id);

  if (!isFreshTableState(entry.state, state)) {
    return false;
  }

  entry.lastStateAt = Date.now();

  const fingerprint = stateFingerprint(state);
  if (entry.fingerprint === fingerprint) {
    entry.state = state;
    return false;
  }

  entry.fingerprint = fingerprint;
  entry.state = state;
  entry.listeners.forEach(listener => listener(state));
  return true;
}

export function watchCachedTableState(tableId: number, listener: (state: TableState) => void) {
  const entry = getEntry(tableId);
  entry.listeners.add(listener);
  if (entry.state) listener(entry.state);

  return () => {
    entry.listeners.delete(listener);
  };
}

async function resetTableChannel(tableId: number, channel: RealtimeChannel) {
  const entry = getEntry(tableId);
  if (entry.channel !== channel) return;

  entry.channel = undefined;
  if (entry.snapshotInterval) {
    window.clearInterval(entry.snapshotInterval);
    entry.snapshotInterval = undefined;
  }
  if (entry.fallbackInterval) {
    window.clearInterval(entry.fallbackInterval);
    entry.fallbackInterval = undefined;
  }
  entry.requestSnapshot = undefined;
  if (entry.visibilityListener) {
    document.removeEventListener('visibilitychange', entry.visibilityListener);
    entry.visibilityListener = undefined;
  }

  channel.unsubscribe();
  await supabase.removeChannel(channel);
}

async function resetTableActionChannel(tableId: number, channel: RealtimeChannel) {
  const entry = getEntry(tableId);
  if (entry.actionChannel === channel) {
    entry.actionChannel = undefined;
  }
  try {
    channel.unsubscribe();
  } catch {
    // Supabase can emit CLOSED while unsubscribe is already in progress.
  }
  try {
    await supabase.removeChannel(channel);
  } catch {
    // Best effort cleanup. The next action will recreate a fresh channel.
  }
}

function scheduleReconnect(tableId: number, channel: RealtimeChannel) {
  const entry = getEntry(tableId);
  if (entry.reconnectTimeout) return;

  entry.reconnectTimeout = window.setTimeout(() => {
    entry.reconnectTimeout = undefined;
    if (entry.channel === channel) {
      void resetTableChannel(tableId, channel).finally(() => {
        void ensureTableStateCache(tableId);
      });
      return;
    }
    void ensureTableStateCache(tableId);
  }, RECONNECT_DELAY_MS);
}

async function fetchDbFallback(tableId: number) {
  const { data: tableRow } = await supabase
    .from('poker-tables')
    .select('id, players')
    .eq('id', tableId)
    .maybeSingle();

  const rawPlayers = tableRow?.players;
  const playerIds = Array.isArray(rawPlayers)
    ? rawPlayers.filter((id): id is string => typeof id === 'string')
    : [];
  if (!tableRow?.id || playerIds.length === 0) return null;

  const { data: profileRows } = await supabase
    .from('profiles')
    .select('user_id, username')
    .in('user_id', playerIds);
  const profiles = (profileRows ?? []) as ProfileRow[];

  return {
    id: tableRow.id,
    common_cards: [],
    players: playerIds.map(playerId => {
      const profile = profiles.find(item => item.user_id === playerId);
      return {
        id: playerId,
        name: profile?.username ?? 'Joueur',
        has_cards: false,
        chips: 1000,
        bet: 0,
      };
    }),
    pot: [],
    button: 0,
    playerToPlay: null,
    BB: 50,
    SB: 25,
    game_status: 'PLAYING',
  } satisfies TableState;
}

export async function ensureTableStateCache(tableId: number) {
  const entry = getEntry(tableId);
  if (entry.channel) return entry.state ?? null;
  if (entry.connecting) return entry.connecting;

  entry.connecting = (async () => {
    if (entry.channel) return entry.state ?? null;

    const channel = supabase.channel(`table:${tableId}:spectator`, {
      config: {
        broadcast: {
          ack: true,
          self: false,
        },
      },
    });
    entry.channel = channel;

    const applyState = (payload: unknown) => {
      const next = extractTableStatePayload(payload);
      if (next) {
        setCachedTableState(next);
      }
    };

    const requestSnapshot = (force = false) => {
      const now = Date.now();
      if (!force && now - (entry.lastSnapshotRequestedAt ?? 0) < SNAPSHOT_MIN_INTERVAL_MS) {
        return;
      }
      entry.lastSnapshotRequestedAt = now;
      void channel.send({
        type: 'broadcast',
        event: 'snapshot_request',
        payload: {},
      });
    };
    entry.requestSnapshot = requestSnapshot;

    const requestSnapshotIfStale = () => {
      const latestStateAt = entry.lastStateAt ?? 0;
      if (Date.now() - latestStateAt >= STALE_STATE_SNAPSHOT_MS) {
        requestSnapshot();
      }
    };

    entry.visibilityListener = () => {
      if (document.visibilityState === 'visible') {
        requestSnapshot(true);
      }
    };
    document.addEventListener('visibilitychange', entry.visibilityListener);

    channel
      .on('broadcast', { event: 'state' }, ({ payload }) => {
        applyState(payload);
      })
      .on('broadcast', { event: 'table_update' }, ({ payload }) => {
        applyState(payload);
      })
      .on('presence', { event: 'sync' }, () => {
        const latest = extractLatestTableState(channel.presenceState());
        if (latest) setCachedTableState(latest);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          requestSnapshot(true);
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect(tableId, channel);
        }
      });

    entry.snapshotInterval = window.setInterval(requestSnapshotIfStale, SNAPSHOT_CHECK_MS);

    const refreshFallback = async () => {
      const fallbackState = await fetchDbFallback(tableId);
      if (fallbackState && !getCachedTableState(tableId)) {
        setCachedTableState(fallbackState);
      }
    };

    entry.fallbackInterval = window.setInterval(refreshFallback, FALLBACK_REFRESH_MS);
    void refreshFallback();

    return entry.state ?? null;
  })();

  try {
    return await entry.connecting;
  } finally {
    entry.connecting = undefined;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function isReusableActionChannel(channel: RealtimeChannel) {
  const state = (channel as unknown as { state?: string }).state;
  return state === undefined || state === 'joined';
}

async function createTableActionChannel(tableId: number) {
  const entry = getEntry(tableId);
  if (entry.actionChannel && isReusableActionChannel(entry.actionChannel)) return entry.actionChannel;

  const channel = supabase.channel(`table:${tableId}:actions`, {
    config: {
      broadcast: {
        ack: true,
        self: false,
      },
    },
  });
  entry.actionChannel = channel;

  const subscribed = await new Promise<boolean>(resolve => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        settle(true);
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (entry.actionChannel === channel) {
          entry.actionChannel = undefined;
        }

        if (!settled) {
          settle(false);
        }
      }
    });
  });

  if (!subscribed) {
    await resetTableActionChannel(tableId, channel);
    return null;
  }

  return channel;
}

async function ensureTableActionChannel(tableId: number) {
  const entry = getEntry(tableId);
  if (entry.actionChannel) {
    if (isReusableActionChannel(entry.actionChannel)) return entry.actionChannel;
    await resetTableActionChannel(tableId, entry.actionChannel);
  }
  if (entry.actionConnecting) return entry.actionConnecting;

  entry.actionConnecting = (async () => {
    const firstAttempt = await createTableActionChannel(tableId);
    if (firstAttempt) return firstAttempt;

    await sleep(ACTION_CHANNEL_RETRY_DELAY_MS);
    return createTableActionChannel(tableId);
  })();

  try {
    return await entry.actionConnecting;
  } finally {
    entry.actionConnecting = undefined;
  }
}

export function requestTableStateSnapshot(tableId: number) {
  const entry = tableCache.get(tableId);
  entry?.requestSnapshot?.();
}

export async function sendTablePlayerAction(tableId: number, payload: Record<string, unknown>) {
  try {
    await ensureTableStateCache(tableId);
  } catch {
    // The action channel can still be used if the state cache is reconnecting.
  }

  const channel = await ensureTableActionChannel(tableId);
  if (!channel) {
    return 'channel_unavailable';
  }

  let status: string;
  try {
    status = await channel.send({
      type: 'broadcast',
      event: 'player_action',
      payload,
    });
  } catch {
    status = 'send_error';
  }

  if (status !== 'ok') {
    await resetTableActionChannel(tableId, channel);
  }

  return status;
}

export async function requestTablePrivateCards(tableId: number, playerId: string, turnId?: number | null) {
  try {
    await ensureTableStateCache(tableId);
  } catch {
    // Private cards can still be requested while the public state cache reconnects.
  }

  const channel = await ensureTableActionChannel(tableId);
  if (!channel) {
    return 'channel_unavailable';
  }

  let status: string;
  try {
    status = await channel.send({
      type: 'broadcast',
      event: 'private_cards_request',
      payload: {
        playerId,
        ...(typeof turnId === 'number' ? { turnId } : {}),
      },
    });
  } catch {
    status = 'send_error';
  }

  if (status !== 'ok') {
    await resetTableActionChannel(tableId, channel);
  }

  return status;
}
