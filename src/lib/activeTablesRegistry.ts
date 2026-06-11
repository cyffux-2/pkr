export type ActiveTableEntry = {
  tableId: number;
  tournamentId: number;
  tournamentName?: string;
  startDate?: string;
  maxPlayers?: number;
};

const activeTablesByUser = new Map<string, ActiveTableEntry[]>();
const listenersByUser = new Map<string, Set<(tables: ActiveTableEntry[]) => void>>();

function normalizeTables(tables: ActiveTableEntry[]) {
  const byTableId = new Map<number, ActiveTableEntry>();

  tables.forEach(table => {
    if (!Number.isFinite(table.tableId) || !Number.isFinite(table.tournamentId)) return;
    byTableId.set(table.tableId, {
      tableId: table.tableId,
      tournamentId: table.tournamentId,
      tournamentName: table.tournamentName,
      startDate: table.startDate,
      maxPlayers: table.maxPlayers,
    });
  });

  return Array.from(byTableId.values()).sort((left, right) => left.tableId - right.tableId);
}

function notify(userId: string) {
  const tables = activeTablesByUser.get(userId) ?? [];
  listenersByUser.get(userId)?.forEach(listener => listener(tables));
}

export function getActiveTablesForUser(userId: string) {
  return activeTablesByUser.get(userId) ?? [];
}

export function setActiveTablesForUser(userId: string, tables: ActiveTableEntry[]) {
  const next = normalizeTables(tables);
  const current = activeTablesByUser.get(userId) ?? [];
  const currentFingerprint = current.map(table => `${table.tournamentId}:${table.tableId}:${table.tournamentName ?? ''}:${table.startDate ?? ''}:${table.maxPlayers ?? ''}`).join('|');
  const nextFingerprint = next.map(table => `${table.tournamentId}:${table.tableId}:${table.tournamentName ?? ''}:${table.startDate ?? ''}:${table.maxPlayers ?? ''}`).join('|');

  if (currentFingerprint === nextFingerprint) return;

  if (next.length === 0) {
    activeTablesByUser.delete(userId);
  } else {
    activeTablesByUser.set(userId, next);
  }
  notify(userId);
}

export function removeActiveTournamentForUser(userId: string, tournamentId: number) {
  const current = activeTablesByUser.get(userId) ?? [];
  setActiveTablesForUser(
    userId,
    current.filter(table => table.tournamentId !== tournamentId),
  );
}

export function clearActiveTablesForUser(userId: string) {
  if (!activeTablesByUser.has(userId)) return;
  activeTablesByUser.delete(userId);
  notify(userId);
}

export function watchActiveTablesForUser(userId: string, listener: (tables: ActiveTableEntry[]) => void) {
  const listeners = listenersByUser.get(userId) ?? new Set<(tables: ActiveTableEntry[]) => void>();
  listeners.add(listener);
  listenersByUser.set(userId, listeners);
  listener(getActiveTablesForUser(userId));

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByUser.delete(userId);
    }
  };
}
