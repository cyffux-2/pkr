import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { requestTablePrivateCards, type TableState, type WireCard } from './tableStateCache';

type PrivateCardPayload = {
  card?: WireCard;
  cardIndex?: number;
  turnId?: number;
};

type PrivateCardsEntry = {
  tableId: number;
  userId: string;
  channel?: RealtimeChannel;
  connecting?: Promise<void>;
  reconnectTimeout?: number;
  requestRetryTimeout?: number;
  ready: boolean;
  cards: WireCard[];
  turnId: number | null;
  latestState?: TableState | null;
  lastRequestKey?: string;
  listeners: Set<(cards: WireCard[]) => void>;
};

const privateCardsCache = new Map<string, PrivateCardsEntry>();
const PRIVATE_CARD_RECONNECT_MS = 1000;
const PRIVATE_CARD_REQUEST_RETRY_MS = 900;
const PRIVATE_CARD_SUBSCRIBE_TIMEOUT_MS = 5000;

function cacheKey(tableId: number, userId: string) {
  return `${tableId}:${userId}`;
}

function getEntry(tableId: number, userId: string) {
  const key = cacheKey(tableId, userId);
  const existing = privateCardsCache.get(key);
  if (existing) return existing;

  const entry: PrivateCardsEntry = {
    tableId,
    userId,
    ready: false,
    cards: [],
    turnId: null,
    listeners: new Set(),
  };
  privateCardsCache.set(key, entry);
  return entry;
}

function notify(entry: PrivateCardsEntry) {
  const snapshot = entry.cards.slice(0, 2);
  entry.listeners.forEach(listener => listener(snapshot));
}

function hasBothCards(entry: PrivateCardsEntry) {
  return entry.cards.filter(Boolean).length >= 2;
}

function clearRequestRetry(entry: PrivateCardsEntry) {
  if (!entry.requestRetryTimeout) return;

  window.clearTimeout(entry.requestRetryTimeout);
  entry.requestRetryTimeout = undefined;
}

function setCards(entry: PrivateCardsEntry, cards: WireCard[]) {
  entry.cards = cards.slice(0, 2);
  if (hasBothCards(entry)) {
    clearRequestRetry(entry);
  }
  notify(entry);
}

function getChannelState(channel: RealtimeChannel | undefined) {
  return (channel as unknown as { state?: string } | undefined)?.state;
}

function isJoinedChannel(channel: RealtimeChannel | undefined) {
  const state = getChannelState(channel);
  return state === undefined || state === 'joined';
}

async function removePrivateCardsChannel(entry: PrivateCardsEntry, channel: RealtimeChannel | undefined) {
  if (!channel) return;
  if (entry.channel === channel) {
    entry.channel = undefined;
    entry.ready = false;
  }
  try {
    channel.unsubscribe();
  } catch {
    // Best effort cleanup; Supabase can already be closing the channel.
  }
  try {
    await supabase.removeChannel(channel);
  } catch {
    // The next ensure call will create a fresh channel.
  }
}

function scheduleReconnect(entry: PrivateCardsEntry) {
  if (entry.reconnectTimeout) return;

  entry.reconnectTimeout = window.setTimeout(() => {
    entry.reconnectTimeout = undefined;
    if (privateCardsCache.get(cacheKey(entry.tableId, entry.userId)) !== entry) return;

    void ensurePrivateCardsChannel(entry.tableId, entry.userId);
  }, PRIVATE_CARD_RECONNECT_MS);
}

function getHeroState(entry: PrivateCardsEntry) {
  const players = entry.latestState?.players ?? [];
  const seatIndex = players.findIndex(player => player?.id === entry.userId);
  const player = seatIndex >= 0 ? players[seatIndex] : null;
  return { seatIndex, player };
}

function scheduleRequestRetry(entry: PrivateCardsEntry) {
  if (entry.requestRetryTimeout) return;

  entry.requestRetryTimeout = window.setTimeout(() => {
    entry.requestRetryTimeout = undefined;
    if (privateCardsCache.get(cacheKey(entry.tableId, entry.userId)) !== entry) return;

    const { player } = getHeroState(entry);
    if (!player?.has_cards || hasBothCards(entry)) return;

    entry.lastRequestKey = undefined;
    requestMissingCards(entry);
  }, PRIVATE_CARD_REQUEST_RETRY_MS);
}

function requestMissingCards(entry: PrivateCardsEntry) {
  if (!entry.latestState) return;

  const { player } = getHeroState(entry);
  if (!player?.has_cards || hasBothCards(entry)) {
    clearRequestRetry(entry);
    return;
  }

  if (!entry.ready || !isJoinedChannel(entry.channel)) {
    void ensurePrivateCardsChannel(entry.tableId, entry.userId).finally(() => {
      if (!hasBothCards(entry)) {
        scheduleRequestRetry(entry);
      }
    });
    return;
  }

  const turnId = typeof entry.latestState.turnId === 'number' ? entry.latestState.turnId : null;
  const requestKey = `${entry.tableId}:${entry.userId}:${turnId ?? 'pending'}`;
  if (entry.lastRequestKey === requestKey) return;

  entry.lastRequestKey = requestKey;
  void requestTablePrivateCards(entry.tableId, entry.userId, turnId)
    .then(status => {
      if (status !== 'ok') {
        entry.lastRequestKey = undefined;
      }
    })
    .catch(() => {
      entry.lastRequestKey = undefined;
    })
    .finally(() => {
      const { player: latestPlayer } = getHeroState(entry);
      if (latestPlayer?.has_cards && !hasBothCards(entry)) {
        scheduleRequestRetry(entry);
      } else {
        clearRequestRetry(entry);
      }
    });
}

export function getCachedPrivateCards(tableId: number, userId: string) {
  return privateCardsCache.get(cacheKey(tableId, userId))?.cards.slice(0, 2) ?? [];
}

export function clearCachedPrivateCards(tableId: number, userId: string) {
  const entry = privateCardsCache.get(cacheKey(tableId, userId));
  if (!entry) return;

  entry.lastRequestKey = undefined;
  clearRequestRetry(entry);
  setCards(entry, []);
}

export function closePrivateCardsForUser(userId: string) {
  Array.from(privateCardsCache.entries()).forEach(([key, entry]) => {
    if (entry.userId !== userId) return;
    if (entry.reconnectTimeout) {
      window.clearTimeout(entry.reconnectTimeout);
    }
    clearRequestRetry(entry);
    void removePrivateCardsChannel(entry, entry.channel);
    privateCardsCache.delete(key);
  });
}

export function watchCachedPrivateCards(tableId: number, userId: string, listener: (cards: WireCard[]) => void) {
  const entry = getEntry(tableId, userId);
  entry.listeners.add(listener);
  listener(entry.cards.slice(0, 2));

  return () => {
    entry.listeners.delete(listener);
  };
}

export function syncPrivateCardsWithTableState(tableId: number, userId: string, state: TableState | null | undefined) {
  const entry = getEntry(tableId, userId);
  entry.latestState = state ?? null;

  const nextTurnId = typeof state?.turnId === 'number' ? state.turnId : null;
  if (entry.turnId !== nextTurnId) {
    entry.turnId = nextTurnId;
    entry.lastRequestKey = undefined;
    clearRequestRetry(entry);
    if (entry.cards.length > 0) setCards(entry, []);
  }

  const { player } = getHeroState(entry);
  if (!player?.has_cards) {
    entry.lastRequestKey = undefined;
    clearRequestRetry(entry);
    if (entry.cards.length > 0) setCards(entry, []);
    return;
  }

  void ensurePrivateCardsChannel(tableId, userId);
  requestMissingCards(entry);
}

export async function ensurePrivateCardsChannel(tableId: number, userId: string) {
  const entry = getEntry(tableId, userId);
  if (entry.connecting) return entry.connecting;

  if (entry.channel) {
    if (isJoinedChannel(entry.channel) && entry.ready) {
      return;
    }

    await removePrivateCardsChannel(entry, entry.channel);
  }

  entry.connecting = (async () => {
    const channel = supabase.channel(`table:${tableId}:private-user:${userId}`);
    entry.channel = channel;

    await new Promise<void>(resolve => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };

      const timeout = window.setTimeout(() => {
        void removePrivateCardsChannel(entry, channel).finally(() => {
          scheduleReconnect(entry);
          settle();
        });
      }, PRIVATE_CARD_SUBSCRIBE_TIMEOUT_MS);

      channel
        .on('broadcast', { event: 'info' }, ({ payload }) => {
          const privatePayload = payload as PrivateCardPayload | undefined;
          const card = privatePayload?.card;
          if (!card) return;

          const currentTurnId = entry.turnId;
          if (
            typeof privatePayload?.turnId === 'number' &&
            currentTurnId !== null &&
            privatePayload.turnId !== currentTurnId
          ) {
            return;
          }

          const next = entry.cards.slice(0, 2);
          const cardIndex = typeof privatePayload?.cardIndex === 'number' && privatePayload.cardIndex >= 0 && privatePayload.cardIndex < 2
            ? privatePayload.cardIndex
            : Math.min(next.length, 1);
          next[cardIndex] = card;
          setCards(entry, next);
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            entry.ready = true;
            requestMissingCards(entry);
            settle();
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            void removePrivateCardsChannel(entry, channel).finally(() => {
              scheduleReconnect(entry);
              settle();
            });
          }
        });
    });
  })();

  try {
    await entry.connecting;
  } finally {
    entry.connecting = undefined;
  }
}

export function refreshPrivateCards(tableId: number, userId: string, state?: TableState | null) {
  const entry = getEntry(tableId, userId);
  if (state !== undefined) {
    entry.latestState = state;
  }
  entry.lastRequestKey = undefined;
  clearRequestRetry(entry);

  void ensurePrivateCardsChannel(tableId, userId).finally(() => {
    requestMissingCards(entry);
  });
}
