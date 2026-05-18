import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ensureTableStateCache,
  getCachedTableState,
  watchCachedTableState,
  type TableState,
} from '../lib/tableStateCache';
import {
  getActiveTablesForUser,
  watchActiveTablesForUser,
  type ActiveTableEntry,
} from '../lib/activeTablesRegistry';

const SWITCH_COOLDOWN_MS = 650;

function parseGameTableId(pathname: string) {
  const match = pathname.match(/^\/game\/(\d+)/);
  if (!match) return null;

  const tableId = Number(match[1]);
  return Number.isFinite(tableId) ? tableId : null;
}

function getHeroSeatIndex(state: TableState | null | undefined, userId: string) {
  return state?.players.findIndex(player => player?.id === userId) ?? -1;
}

function isHeroTurn(state: TableState | null | undefined, userId: string) {
  const seatIndex = getHeroSeatIndex(state, userId);
  return Boolean(state && seatIndex >= 0 && state.playerToPlay === seatIndex);
}

function getPromptFingerprint(state: TableState | null | undefined) {
  const turnId = typeof state?.turnId === 'number' ? state.turnId : 'turn';
  const actionRequestId = typeof state?.actionRequestId === 'number' ? state.actionRequestId : 'request';
  const stateRevision = typeof state?.stateRevision === 'number' ? state.stateRevision : 'revision';
  return `${turnId}:${actionRequestId}:${stateRevision}`;
}

export function TableTurnAutoSwitcher() {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTables, setActiveTables] = useState<ActiveTableEntry[]>(() => (
    userId ? getActiveTablesForUser(userId) : []
  ));
  const [tableStates, setTableStates] = useState<Record<number, TableState>>({});
  const lastSwitchRef = useRef<{ targetTableId: number; fingerprint: string; at: number } | null>(null);

  const tableIds = useMemo(
    () => activeTables.map(table => table.tableId).sort((left, right) => left - right),
    [activeTables],
  );
  const tableIdsKey = tableIds.join('|');

  useEffect(() => {
    if (!userId) {
      setActiveTables([]);
      return;
    }

    return watchActiveTablesForUser(userId, setActiveTables);
  }, [userId]);

  useEffect(() => {
    setTableStates(current => {
      const activeIds = new Set(tableIds);
      const next = Object.entries(current).reduce<Record<number, TableState>>((accumulator, [rawTableId, state]) => {
        const tableId = Number(rawTableId);
        if (activeIds.has(tableId)) {
          accumulator[tableId] = state;
        }
        return accumulator;
      }, {});

      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [tableIdsKey, tableIds]);

  useEffect(() => {
    if (!userId || tableIds.length === 0) return;

    const cleanups = tableIds.map(tableId => {
      void ensureTableStateCache(tableId);
      const cached = getCachedTableState(tableId);
      if (cached) {
        setTableStates(current => ({ ...current, [tableId]: cached }));
      }

      return watchCachedTableState(tableId, state => {
        setTableStates(current => ({ ...current, [tableId]: state }));
      });
    });

    return () => {
      cleanups.forEach(cleanup => cleanup());
    };
  }, [tableIdsKey, tableIds, userId]);

  useEffect(() => {
    if (!userId) return;

    const currentTableId = parseGameTableId(location.pathname);
    if (!currentTableId) return;

    const currentState = tableStates[currentTableId] ?? getCachedTableState(currentTableId);
    if (isHeroTurn(currentState, userId)) return;

    const target = activeTables.find(table => {
      if (table.tableId === currentTableId) return false;
      const state = tableStates[table.tableId] ?? getCachedTableState(table.tableId);
      return isHeroTurn(state, userId);
    });
    if (!target) return;

    const targetState = tableStates[target.tableId] ?? getCachedTableState(target.tableId);
    const fingerprint = getPromptFingerprint(targetState);
    const lastSwitch = lastSwitchRef.current;
    const now = Date.now();
    if (
      lastSwitch &&
      lastSwitch.targetTableId === target.tableId &&
      lastSwitch.fingerprint === fingerprint &&
      now - lastSwitch.at < SWITCH_COOLDOWN_MS
    ) {
      return;
    }

    lastSwitchRef.current = {
      targetTableId: target.tableId,
      fingerprint,
      at: now,
    };

    navigate(`/game/${target.tableId}`, {
      state: {
        tournamentId: target.tournamentId,
        autoTableSwitch: true,
        autoTableSwitchAt: now,
        autoTableSwitchDirection: target.tableId > currentTableId ? 'right' : 'left',
      },
    });
  }, [activeTables, location.pathname, navigate, tableStates, userId]);

  return null;
}
