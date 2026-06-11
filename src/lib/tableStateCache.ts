import { RealtimeChannel } from '@supabase/supabase-js';
import { realtimeInputSupabase, supabase } from './supabase';

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
  absent?: boolean;
};

export type EloAdjustmentInfo = {
  playerId: string;
  initialElo: number;
  newElo: number;
  delta: number;
  placement: number;
  chanceMultiplier: number;
  eloMultiplier?: number;
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
  timebankRemainingMs?: number;
};

export type TableState = {
  id: number;
  stateRevision?: number;
  tableStep?: number;
  tournamentId?: number;
  turnId?: number;
  actionRequestId?: number;
  actionStartedAt?: number;
  actionDeadlineAt?: number;
  actionBaseTimeMs?: number;
  actionTimebankMs?: number;
  timebankRemainingMs?: Record<string, number>;
  timebankMaxMs?: number;
  timebankRefillIntervalMs?: number;
  nextTimebankRefillAt?: number;
  common_cards: WireCard[];
  players: (TablePlayer | null)[];
  pot: number[];
  button: number;
  playerToPlay: number | null;
  BB: number;
  SB: number;
  game_status: string | number;
  showdown?: boolean;
  absentPlayerIds?: string[];
  winningPlayerIds?: string[];
  winningCardsByPlayerId?: Record<string, WireCard[]>;
  tournamentWinnerIds?: string[];
  eloResults?: Record<string, EloAdjustmentInfo>;
  lastEvent?: TableEvent | null;
  events?: TableEvent[];
};

type CacheEntry = {
  stateChannel?: RealtimeChannel;
  inputChannel?: RealtimeChannel;
  stateConnecting?: Promise<TableState | null>;
  inputConnecting?: Promise<RealtimeChannel | null>;
  reconnectTimeout?: number;
  staleCheckInterval?: number;
  visibilityListener?: () => void;
  lastStateAt?: number;
  lastSnapshotRequestedAt?: number;
  latestTableStep?: number;
  showdownDisplayUntil?: number;
  showdownHoldTimeout?: number;
  notifyFrame?: number;
  notifyQueue: Array<{ state: TableState; fingerprint: string }>;
  pendingState?: TableState;
  pendingFingerprint?: string;
  state?: TableState;
  fingerprint?: string;
  listeners: Set<(state: TableState) => void>;
};

type TableInputEvent = 'player_action' | 'player_return' | 'private_cards_request' | 'snapshot_request';

const tableCache = new Map<number, CacheEntry>();
const MAX_CACHED_EVENTS = 80;
const STALE_STATE_SNAPSHOT_MS = 5_000;
const SNAPSHOT_CHECK_MS = 2_000;
const SNAPSHOT_MIN_INTERVAL_MS = 1_000;
const BACKGROUND_SNAPSHOT_MS = 10_000;
const RECONNECT_DELAY_MS = 800;
const MAX_NOTIFICATIONS_PER_FRAME = 1;
const MIN_SHOWDOWN_DISPLAY_MS = 3_000;

function shouldLogTableState() {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.REACT_APP_DEBUG_TABLE_STATE === '1' ||
    window.localStorage.getItem('pkrDebugTableState') === '1'
  );
}

function tableStateLog(label: string, state: TableState, extra: Record<string, unknown> = {}) {
  if (!shouldLogTableState()) return;

  console.log(`[TableState] ${label}`, {
    tableId: state.id,
    tableStep: state.tableStep ?? null,
    stateRevision: state.stateRevision ?? null,
    turnId: state.turnId ?? null,
    actionRequestId: state.actionRequestId ?? null,
    playerToPlay: state.playerToPlay ?? null,
    lastEvent: state.lastEvent
      ? {
        id: state.lastEvent.id,
        type: state.lastEvent.type,
        playerId: state.lastEvent.playerId ?? null,
        action: state.lastEvent.action ?? null,
      }
      : null,
    boardCount: state.common_cards.length,
    pot: state.pot,
    players: state.players.map((player, seatIndex) => player
      ? {
        seatIndex,
        id: player.id,
        chips: player.chips,
        bet: player.bet,
        has_cards: player.has_cards,
        absent: Boolean(player.absent),
      }
      : null
    ),
    ...extra,
  });
}

function getEntry(tableId: number) {
  const existing = tableCache.get(tableId);
  if (existing) return existing;

  const entry: CacheEntry = {
    listeners: new Set(),
    notifyQueue: [],
  };
  tableCache.set(tableId, entry);
  return entry;
}

function cardFingerprint(card: WireCard | undefined) {
  if (!card) return '';
  return `${card._color ?? card.color ?? ''}:${card._value ?? card.value ?? ''}`;
}

function numericValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stateTableStep(state: TableState | null | undefined) {
  return numericValue(state?.tableStep);
}

function isShowdownHoldActive(entry: CacheEntry) {
  return (entry.showdownDisplayUntil ?? 0) > Date.now();
}

function isShowdownDisplayState(state: TableState | null | undefined) {
  return Boolean(
    state?.showdown ||
    state?.lastEvent?.type === 'showdown_reveal' ||
    state?.winningPlayerIds?.length
  );
}

function trimEvents(state: TableState): TableState {
  if (!state.events || state.events.length <= MAX_CACHED_EVENTS) return state;
  return {
    ...state,
    events: state.events.slice(-MAX_CACHED_EVENTS),
  };
}

function stateFingerprint(state: TableState) {
  return JSON.stringify({
    stateRevision: state.stateRevision ?? null,
    tableStep: state.tableStep ?? null,
    turnId: state.turnId ?? null,
    actionRequestId: state.actionRequestId ?? null,
    actionStartedAt: state.actionStartedAt ?? null,
    actionDeadlineAt: state.actionDeadlineAt ?? null,
    playerToPlay: state.playerToPlay,
    button: state.button,
    BB: state.BB,
    SB: state.SB,
    status: state.game_status,
    showdown: Boolean(state.showdown),
    lastEventId: state.lastEvent?.id ?? null,
    eventIds: state.events?.slice(-MAX_CACHED_EVENTS).map(event => event.id) ?? [],
    commonCards: state.common_cards.map(cardFingerprint),
    pot: state.pot,
    absentPlayerIds: state.absentPlayerIds ?? [],
    winningPlayerIds: state.winningPlayerIds ?? [],
    tournamentWinnerIds: state.tournamentWinnerIds ?? [],
    winningCardsByPlayerId: Object.fromEntries(
      Object.entries(state.winningCardsByPlayerId ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([playerId, cards]) => [playerId, cards.map(cardFingerprint)])
    ),
    eloResults: Object.entries(state.eloResults ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    players: state.players.map(player => player
      ? [
        player.id ?? '',
        player.name ?? '',
        player.has_cards,
        player.chips,
        player.bet,
        Boolean(player.absent),
        player.cards?.map(cardFingerprint) ?? [],
      ]
      : null
    ),
  });
}

function extractTableStatePayload(payload: unknown): TableState | null {
  if (!payload || typeof payload !== 'object') return null;
  const wrapped = payload as { state?: unknown };
  const candidate = wrapped.state ?? payload;
  if (!candidate || typeof candidate !== 'object') return null;

  const state = candidate as TableState;
  return typeof state.id === 'number' && Array.isArray(state.players) ? state : null;
}

function notify(entry: CacheEntry, state: TableState) {
  if (isShowdownDisplayState(state)) {
    entry.showdownDisplayUntil = Math.max(
      entry.showdownDisplayUntil ?? 0,
      Date.now() + MIN_SHOWDOWN_DISPLAY_MS
    );
  }
  tableStateLog('displayed', state, {
    listeners: entry.listeners.size,
    showdownDisplayUntil: entry.showdownDisplayUntil ?? null,
  });
  entry.listeners.forEach(listener => listener(state));
}

function flushNotifyQueue(entry: CacheEntry) {
  entry.notifyFrame = undefined;

  let flushed = 0;

  while (entry.notifyQueue.length > 0) {
    const holdRemainingMs = (entry.showdownDisplayUntil ?? 0) - Date.now();
    if (holdRemainingMs > 0 && !isShowdownDisplayState(entry.notifyQueue[0]?.state)) {
      tableStateLog('holding after showdown', entry.state ?? entry.notifyQueue[0].state, {
        holdRemainingMs,
        queuedStates: entry.notifyQueue.length,
      });
      if (!entry.showdownHoldTimeout) {
        entry.showdownHoldTimeout = window.setTimeout(() => {
          entry.showdownHoldTimeout = undefined;
          if (!entry.notifyFrame) {
            entry.notifyFrame = window.requestAnimationFrame(() => flushNotifyQueue(entry));
          }
        }, Math.min(holdRemainingMs, MIN_SHOWDOWN_DISPLAY_MS));
      }
      return;
    }

    if (entry.showdownHoldTimeout) {
      window.clearTimeout(entry.showdownHoldTimeout);
      entry.showdownHoldTimeout = undefined;
    }

    if (!isShowdownHoldActive(entry)) {
      entry.showdownDisplayUntil = undefined;
    }

    const item = entry.notifyQueue.shift();
    if (!item) break;

    const itemTableStep = stateTableStep(item.state);
    if (
      itemTableStep !== null &&
      entry.latestTableStep !== undefined &&
      itemTableStep < entry.latestTableStep &&
      !isShowdownDisplayState(item.state)
    ) {
      tableStateLog('skipped queued stale', item.state, {
        latestTableStep: entry.latestTableStep,
      });
      continue;
    }

    notify(entry, item.state);
    entry.state = item.state;
    entry.fingerprint = item.fingerprint;
    if (entry.pendingFingerprint === item.fingerprint) {
      entry.pendingState = undefined;
      entry.pendingFingerprint = undefined;
    }
    flushed++;

    if (flushed >= MAX_NOTIFICATIONS_PER_FRAME) {
      break;
    }
  }

  if (entry.notifyQueue.length > 0) {
    entry.notifyFrame = window.requestAnimationFrame(() => flushNotifyQueue(entry));
  }
}

function enqueueNotification(entry: CacheEntry, state: TableState, fingerprint: string) {
  entry.notifyQueue.push({ state, fingerprint });
  if (!entry.notifyFrame) {
    entry.notifyFrame = window.requestAnimationFrame(() => flushNotifyQueue(entry));
  }
}

export function setCachedTableState(state: TableState) {
  const entry = getEntry(state.id);
  const nextState = trimEvents(state);
  const tableStep = stateTableStep(nextState);

  if (tableStep !== null && entry.latestTableStep !== undefined && tableStep < entry.latestTableStep) {
    entry.lastStateAt = Date.now();
    tableStateLog('ignored stale', nextState, {
      latestTableStep: entry.latestTableStep,
    });
    return false;
  }

  const fingerprint = stateFingerprint(nextState);

  if (entry.fingerprint === fingerprint || entry.pendingFingerprint === fingerprint) {
    entry.lastStateAt = Date.now();
    tableStateLog('ignored duplicate', nextState, {
      latestTableStep: entry.latestTableStep ?? null,
      pending: entry.pendingFingerprint === fingerprint,
    });
    return false;
  }

  entry.lastStateAt = Date.now();
  if (tableStep !== null) {
    entry.latestTableStep = Math.max(entry.latestTableStep ?? 0, tableStep);
    entry.notifyQueue = entry.notifyQueue.filter(item => {
      const itemTableStep = stateTableStep(item.state);
      const keep = isShowdownDisplayState(item.state) || itemTableStep === null || itemTableStep >= entry.latestTableStep!;
      if (!keep) {
        tableStateLog('dropped queued older state', item.state, {
          latestTableStep: entry.latestTableStep,
        });
      }
      return keep;
    });
  }
  entry.pendingState = nextState;
  entry.pendingFingerprint = fingerprint;
  tableStateLog('accepted', nextState, {
    latestTableStep: entry.latestTableStep ?? null,
    queuedStates: entry.notifyQueue.length,
  });
  enqueueNotification(entry, nextState, fingerprint);
  return true;
}

export function getCachedTableState(tableId: number) {
  return tableCache.get(tableId)?.state ?? null;
}

export function watchCachedTableState(tableId: number, listener: (state: TableState) => void) {
  const entry = getEntry(tableId);
  entry.listeners.add(listener);
  const visibleState = isShowdownHoldActive(entry)
    ? entry.state
    : entry.pendingState ?? entry.state;
  if (visibleState) listener(visibleState);

  return () => {
    entry.listeners.delete(listener);
  };
}

function getChannelState(channel: RealtimeChannel | undefined) {
  return (channel as unknown as { state?: string } | undefined)?.state;
}

function isReusableChannel(channel: RealtimeChannel | undefined) {
  const state = getChannelState(channel);
  return state === undefined || state === 'joining' || state === 'joined';
}

async function removeChannel(client: typeof supabase | typeof realtimeInputSupabase, channel: RealtimeChannel | undefined) {
  if (!channel) return;
  try {
    await Promise.resolve(channel.unsubscribe());
  } catch {
    // Already closed.
  }
  try {
    await client.removeChannel(channel);
  } catch {
    // Best effort cleanup.
  }
}

async function resetStateChannel(tableId: number, channel: RealtimeChannel | undefined) {
  const entry = getEntry(tableId);
  if (entry.stateChannel === channel) {
    entry.stateChannel = undefined;
  }
  if (entry.staleCheckInterval) {
    window.clearInterval(entry.staleCheckInterval);
    entry.staleCheckInterval = undefined;
  }
  if (entry.visibilityListener) {
    document.removeEventListener('visibilitychange', entry.visibilityListener);
    entry.visibilityListener = undefined;
  }
  if (entry.notifyFrame) {
    window.cancelAnimationFrame(entry.notifyFrame);
    entry.notifyFrame = undefined;
  }
  if (entry.showdownHoldTimeout) {
    window.clearTimeout(entry.showdownHoldTimeout);
    entry.showdownHoldTimeout = undefined;
  }
  entry.notifyQueue = [];
  entry.pendingState = undefined;
  entry.pendingFingerprint = undefined;
  entry.latestTableStep = undefined;
  entry.showdownDisplayUntil = undefined;
  await removeChannel(supabase, channel);
}

async function resetInputChannel(tableId: number, channel: RealtimeChannel | undefined) {
  const entry = getEntry(tableId);
  if (entry.inputChannel === channel) {
    entry.inputChannel = undefined;
  }
  await removeChannel(realtimeInputSupabase, channel);
}

function scheduleReconnect(tableId: number, channel: RealtimeChannel) {
  const entry = getEntry(tableId);
  if (entry.reconnectTimeout) return;

  entry.reconnectTimeout = window.setTimeout(() => {
    entry.reconnectTimeout = undefined;
    if (entry.stateChannel === channel) {
      void resetStateChannel(tableId, channel).finally(() => {
        void ensureTableStateCache(tableId);
      });
    }
  }, RECONNECT_DELAY_MS);
}

async function sendOnChannel(channel: RealtimeChannel, event: TableInputEvent, payload: Record<string, unknown>) {
  try {
    return await channel.send({
      type: 'broadcast',
      event,
      payload,
    });
  } catch {
    return 'send_error';
  }
}

async function sendTableInputBroadcast(tableId: number, event: TableInputEvent, payload: Record<string, unknown>) {
  const entry = getEntry(tableId);
  const inputChannel = await ensureTableInputChannel(tableId);

  if (inputChannel) {
    const status = await sendOnChannel(inputChannel, event, payload);
    if (status === 'ok') return 'ok';
    await resetInputChannel(tableId, inputChannel);
  }

  if (entry.stateChannel && isReusableChannel(entry.stateChannel)) {
    const status = await sendOnChannel(entry.stateChannel, event, payload);
    if (status === 'ok') return 'ok';
    await resetStateChannel(tableId, entry.stateChannel);
  }

  return 'channel_unavailable';
}

function requestSnapshot(tableId: number, force = false) {
  const entry = getEntry(tableId);
  const now = Date.now();
  if (!force && now - (entry.lastSnapshotRequestedAt ?? 0) < SNAPSHOT_MIN_INTERVAL_MS) {
    return;
  }

  entry.lastSnapshotRequestedAt = now;
  void sendTableInputBroadcast(tableId, 'snapshot_request', {
    requestedAt: now,
    force,
  });
}

export function requestTableStateSnapshot(tableId: number, force = false) {
  requestSnapshot(tableId, force);
}

export async function refreshTableStateConnection(tableId: number, force = false) {
  await ensureTableStateCache(tableId);
  requestSnapshot(tableId, force);
}

export async function ensureTableStateCache(tableId: number) {
  const entry = getEntry(tableId);
  if (entry.stateConnecting) return entry.stateConnecting;
  if (entry.stateChannel && isReusableChannel(entry.stateChannel)) {
    if (!entry.state || Date.now() - (entry.lastStateAt ?? 0) > SNAPSHOT_CHECK_MS) {
      requestSnapshot(tableId);
    }
    return entry.state ?? null;
  }
  if (entry.stateChannel) {
    await resetStateChannel(tableId, entry.stateChannel);
  }

  entry.stateConnecting = (async () => {
    const channel = supabase.channel(`table:${tableId}:spectator`, {
      config: {
        broadcast: {
          ack: false,
          self: false,
        },
      },
    });
    entry.stateChannel = channel;

    const applyPayload = (eventName: string, payload: unknown) => {
      const state = extractTableStatePayload(payload);
      if (!state) {
        if (shouldLogTableState()) {
          console.log(`[TableState] ignored invalid payload`, {
            tableId,
            eventName,
            payload,
          });
        }
        return;
      }

      tableStateLog('received', state, {
        eventName,
        currentLatestTableStep: entry.latestTableStep ?? null,
      });
      setCachedTableState(state);
    };

    channel
      .on('broadcast', { event: 'table_update' }, ({ payload }) => applyPayload('table_update', payload))
      .on('broadcast', { event: 'action_prompt' }, ({ payload }) => applyPayload('action_prompt', payload))
      .on('broadcast', { event: 'state' }, ({ payload }) => applyPayload('state', payload));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          settle(resolve);
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect(tableId, channel);
          settle(() => reject(error ?? new Error(`Table channel ${tableId} closed with ${status}`)));
        }
      });
    });

    entry.visibilityListener = () => {
      if (document.visibilityState === 'visible') {
        requestSnapshot(tableId, true);
      }
    };
    document.addEventListener('visibilitychange', entry.visibilityListener);

    entry.staleCheckInterval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      const stateAgeMs = now - (entry.lastStateAt ?? 0);
      const snapshotAgeMs = now - (entry.lastSnapshotRequestedAt ?? 0);

      if (stateAgeMs > STALE_STATE_SNAPSHOT_MS || snapshotAgeMs > BACKGROUND_SNAPSHOT_MS) {
        requestSnapshot(tableId);
      }
    }, SNAPSHOT_CHECK_MS);

    requestSnapshot(tableId, true);
    return entry.state ?? null;
  })();

  try {
    return await entry.stateConnecting;
  } finally {
    entry.stateConnecting = undefined;
  }
}

async function ensureTableInputChannel(tableId: number) {
  const entry = getEntry(tableId);
  if (entry.inputConnecting) return entry.inputConnecting;
  if (entry.inputChannel && isReusableChannel(entry.inputChannel)) {
    return entry.inputChannel;
  }
  if (entry.inputChannel) {
    await resetInputChannel(tableId, entry.inputChannel);
  }

  entry.inputConnecting = (async () => {
    const channel = realtimeInputSupabase.channel(`table:${tableId}:input`, {
      config: {
        broadcast: {
          ack: true,
          self: false,
        },
      },
    });
    entry.inputChannel = channel;

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
          settle(false);
        }
      });
    });

    if (!subscribed) {
      await resetInputChannel(tableId, channel);
      return null;
    }

    return channel;
  })();

  try {
    return await entry.inputConnecting;
  } finally {
    entry.inputConnecting = undefined;
  }
}

export async function sendTablePlayerAction(tableId: number, payload: Record<string, unknown>) {
  return sendTableInputBroadcast(tableId, 'player_action', payload);
}

export async function sendTablePlayerReturn(tableId: number, playerId: string) {
  return sendTableInputBroadcast(tableId, 'player_return', { playerId });
}

export async function requestTablePrivateCards(tableId: number, playerId: string, turnId?: number | null) {
  return sendTableInputBroadcast(tableId, 'private_cards_request', {
    playerId,
    ...(typeof turnId === 'number' ? { turnId } : {}),
  });
}
