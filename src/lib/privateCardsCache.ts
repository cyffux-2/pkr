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
  ready: boolean;
  cards: WireCard[];
  turnId: number | null;
  latestState?: TableState | null;
  lastRequestKey?: string;
  listeners: Set<(cards: WireCard[]) => void>;
};

const privateCardsCache = new Map<string, PrivateCardsEntry>();
const PRIVATE_CARD_RECONNECT_MS = 1000;

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

function setCards(entry: PrivateCardsEntry, cards: WireCard[]) {
  entry.cards = cards.slice(0, 2);
  notify(entry);
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

function requestMissingCards(entry: PrivateCardsEntry) {
  if (!entry.ready || !entry.latestState) return;

  const { player } = getHeroState(entry);
  if (!player?.has_cards || entry.cards.filter(Boolean).length >= 2) return;

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
    });
}

export function getCachedPrivateCards(tableId: number, userId: string) {
  return privateCardsCache.get(cacheKey(tableId, userId))?.cards.slice(0, 2) ?? [];
}

export function clearCachedPrivateCards(tableId: number, userId: string) {
  const entry = privateCardsCache.get(cacheKey(tableId, userId));
  if (!entry) return;

  entry.lastRequestKey = undefined;
  setCards(entry, []);
}

export function closePrivateCardsForUser(userId: string) {
  Array.from(privateCardsCache.entries()).forEach(([key, entry]) => {
    if (entry.userId !== userId) return;
    if (entry.reconnectTimeout) {
      window.clearTimeout(entry.reconnectTimeout);
    }
    entry.channel?.unsubscribe();
    if (entry.channel) {
      void supabase.removeChannel(entry.channel);
    }
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
    if (entry.cards.length > 0) setCards(entry, []);
  }

  const { player } = getHeroState(entry);
  if (!player?.has_cards) {
    entry.lastRequestKey = undefined;
    if (entry.cards.length > 0) setCards(entry, []);
    return;
  }

  void ensurePrivateCardsChannel(tableId, userId);
  requestMissingCards(entry);
}

export async function ensurePrivateCardsChannel(tableId: number, userId: string) {
  const entry = getEntry(tableId, userId);
  if (entry.channel) return;
  if (entry.connecting) return entry.connecting;

  entry.connecting = (async () => {
    const channel = supabase.channel(`table:${tableId}:private-user:${userId}`);
    entry.channel = channel;

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
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          entry.ready = false;
          if (entry.channel === channel) {
            entry.channel = undefined;
          }
          scheduleReconnect(entry);
        }
      });
  })();

  try {
    await entry.connecting;
  } finally {
    entry.connecting = undefined;
  }
}
