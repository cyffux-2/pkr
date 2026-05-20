import { useEffect, useMemo, useState } from 'react';
import {
  ensureTableStateCache,
  getCachedTableState,
  watchCachedTableState,
  type TableState,
  type WireCard,
} from '../lib/tableStateCache';
import {
  ensurePrivateCardsChannel,
  getCachedPrivateCards,
  syncPrivateCardsWithTableState,
  watchCachedPrivateCards,
} from '../lib/privateCardsCache';

export function useTablePreview(tableId: number | null | undefined, userId: string | null | undefined) {
  const [tableState, setTableState] = useState<TableState | null>(() => (
    tableId ? getCachedTableState(tableId) : null
  ));
  const [privateCards, setPrivateCards] = useState<WireCard[]>(() => (
    tableId && userId ? getCachedPrivateCards(tableId, userId) : []
  ));

  useEffect(() => {
    if (!tableId) {
      setTableState(null);
      return;
    }

    setTableState(getCachedTableState(tableId));
    void ensureTableStateCache(tableId);
    return watchCachedTableState(tableId, setTableState);
  }, [tableId]);

  useEffect(() => {
    if (!tableId || !userId) {
      setPrivateCards([]);
      return;
    }

    setPrivateCards(getCachedPrivateCards(tableId, userId));
    void ensurePrivateCardsChannel(tableId, userId);
    return watchCachedPrivateCards(tableId, userId, setPrivateCards);
  }, [tableId, userId]);

  useEffect(() => {
    if (!tableId || !userId) return;
    syncPrivateCardsWithTableState(tableId, userId, tableState);
  }, [tableId, tableState, userId]);

  return useMemo(() => {
    const players = tableState?.players ?? [];
    const heroSeatIndex = userId ? players.findIndex(player => player?.id === userId) : -1;
    const hero = heroSeatIndex >= 0 ? players[heroSeatIndex] : null;
    const hasResolvedTable = Boolean(tableId && tableState);
    const heroHasCards = Boolean(hero?.has_cards);
    const isHeroTurn = Boolean(tableState && heroSeatIndex >= 0 && tableState.playerToPlay === heroSeatIndex);
    const isFinished = isTableEnded(tableState);
    const winnerIds = tableState?.tournamentWinnerIds?.length
      ? tableState.tournamentWinnerIds
      : tableState?.winningPlayerIds ?? [];
    const isVictory = Boolean(isFinished && userId && winnerIds.includes(userId));
    const isEliminated = Boolean(hasResolvedTable && (heroSeatIndex < 0 || (isFinished && !isVictory)));

    return {
      tableState,
      privateCards: heroHasCards ? privateCards : [],
      heroHasCards,
      isHeroTurn,
      isEliminated,
      isFinished,
      isVictory,
    };
  }, [privateCards, tableId, tableState, userId]);
}

function isTableEnded(state: TableState | null | undefined) {
  return state?.game_status === 3 ||
    state?.game_status === '3' ||
    state?.game_status === 'ENDED' ||
    Boolean(state?.tournamentWinnerIds?.length);
}
