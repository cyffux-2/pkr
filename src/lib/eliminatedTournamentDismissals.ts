const STORAGE_PREFIX = 'pkr:dismissed-eliminated-tables:';
const CHANGE_EVENT = 'pkr:dismissed-eliminated-tables-change';

export type DismissedEliminationKey = string;

type DismissedTournamentChange = {
  userId: string;
  keys: DismissedEliminationKey[];
};

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function getEliminatedTournamentDismissalKey(
  tableId: number | null | undefined,
  tournamentId?: number | null,
): DismissedEliminationKey | null {
  if (typeof tableId !== 'number' || !Number.isFinite(tableId)) return null;
  return typeof tournamentId === 'number' && Number.isFinite(tournamentId)
    ? `${tournamentId}:${tableId}`
    : `table:${tableId}`;
}

function isValidDismissalKey(value: unknown): value is DismissedEliminationKey {
  return typeof value === 'string' && (/^\d+:\d+$/.test(value) || /^table:\d+$/.test(value));
}

export function isDismissedElimination(
  dismissed: Set<DismissedEliminationKey>,
  tableId: number | null | undefined,
  tournamentId?: number | null,
) {
  const key = getEliminatedTournamentDismissalKey(tableId, tournamentId);
  return Boolean(key && dismissed.has(key));
}

function readDismissedSet(userId: string) {
  if (typeof window === 'undefined') return new Set<DismissedEliminationKey>();

  try {
    const rawValue = window.localStorage.getItem(storageKey(userId));
    const parsed = rawValue ? JSON.parse(rawValue) : [];
    if (!Array.isArray(parsed)) return new Set<DismissedEliminationKey>();

    return new Set(
      parsed
        .filter(isValidDismissalKey),
    );
  } catch {
    return new Set<DismissedEliminationKey>();
  }
}

function writeDismissedSet(userId: string, keys: Set<DismissedEliminationKey>) {
  if (typeof window === 'undefined') return;

  const next = Array.from(keys).sort();
  window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<DismissedTournamentChange>(CHANGE_EVENT, {
    detail: {
      userId,
      keys: next,
    },
  }));
}

export function getDismissedEliminatedTables(userId: string) {
  return readDismissedSet(userId);
}

export function isEliminatedTableDismissed(
  userId: string | null | undefined,
  tableId: number | null | undefined,
  tournamentId?: number | null,
) {
  if (!userId) return false;
  return isDismissedElimination(readDismissedSet(userId), tableId, tournamentId);
}

export function dismissEliminatedTable(userId: string, tableId: number, tournamentId?: number | null) {
  const key = getEliminatedTournamentDismissalKey(tableId, tournamentId);
  if (!key) return;

  const dismissed = readDismissedSet(userId);
  if (dismissed.has(key)) return;

  dismissed.add(key);
  writeDismissedSet(userId, dismissed);
}

export function watchDismissedEliminatedTables(
  userId: string,
  listener: (keys: Set<DismissedEliminationKey>) => void,
) {
  listener(readDismissedSet(userId));

  const notify = () => listener(readDismissedSet(userId));

  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey(userId)) {
      notify();
    }
  };

  const onCustomChange = (event: Event) => {
    const detail = (event as CustomEvent<DismissedTournamentChange>).detail;
    if (detail?.userId === userId) {
      listener(new Set(detail.keys));
    }
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onCustomChange);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onCustomChange);
  };
}

export const watchDismissedEliminatedTournaments = watchDismissedEliminatedTables;
