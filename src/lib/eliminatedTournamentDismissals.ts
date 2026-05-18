const STORAGE_PREFIX = 'pkr:dismissed-eliminated-tables:';
const CHANGE_EVENT = 'pkr:dismissed-eliminated-tables-change';

type DismissedTournamentChange = {
  userId: string;
  tableIds: number[];
};

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function readDismissedSet(userId: string) {
  if (typeof window === 'undefined') return new Set<number>();

  try {
    const rawValue = window.localStorage.getItem(storageKey(userId));
    const parsed = rawValue ? JSON.parse(rawValue) : [];
    if (!Array.isArray(parsed)) return new Set<number>();

    return new Set(
      parsed
        .map(value => Number(value))
        .filter(value => Number.isFinite(value)),
    );
  } catch {
    return new Set<number>();
  }
}

function writeDismissedSet(userId: string, tableIds: Set<number>) {
  if (typeof window === 'undefined') return;

  const next = Array.from(tableIds).sort((left, right) => left - right);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<DismissedTournamentChange>(CHANGE_EVENT, {
    detail: {
      userId,
      tableIds: next,
    },
  }));
}

export function getDismissedEliminatedTables(userId: string) {
  return readDismissedSet(userId);
}

export function isEliminatedTableDismissed(userId: string | null | undefined, tableId: number | null | undefined) {
  if (!userId || typeof tableId !== 'number' || !Number.isFinite(tableId)) return false;
  return readDismissedSet(userId).has(tableId);
}

export function dismissEliminatedTable(userId: string, tableId: number) {
  if (!Number.isFinite(tableId)) return;

  const dismissed = readDismissedSet(userId);
  if (dismissed.has(tableId)) return;

  dismissed.add(tableId);
  writeDismissedSet(userId, dismissed);
}

export function watchDismissedEliminatedTables(
  userId: string,
  listener: (tableIds: Set<number>) => void,
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
      listener(new Set(detail.tableIds));
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
