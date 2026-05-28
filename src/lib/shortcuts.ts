export type ShortcutId = 'fold' | 'check' | 'raise' | 'half_pot' | 'pot' | 'allin';

export interface Shortcut {
  id: ShortcutId;
  label: string;
  sub: string;
  key: string;
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: 'fold', label: 'Se coucher', sub: 'Abandonner la main en cours.', key: 'F' },
  { id: 'check', label: 'Parole / Suivre', sub: 'Dire parole si possible, sinon suivre.', key: 'C' },
  { id: 'raise', label: 'Relancer', sub: 'Relance en fonction de la mise choisie.', key: 'R' },
  { id: 'half_pot', label: 'Mise 1/2 pot', sub: 'Préparer une mise à 50% du pot.', key: '1' },
  { id: 'pot', label: 'Mise pot', sub: 'Préparer une mise à hauteur du pot.', key: '2' },
  { id: 'allin', label: 'Tapis', sub: 'Préparer une action à tapis.', key: 'A' },
];

const SHORTCUT_IDS = new Set<ShortcutId>(DEFAULT_SHORTCUTS.map(shortcut => shortcut.id));

export function normalizeShortcutLabel(rawKey: unknown) {
  if (rawKey === ' ') return 'Space';
  if (typeof rawKey !== 'string') return '';

  const trimmed = rawKey.trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'space') return 'Space';
  return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
}

export function normalizeKeyboardEventKey(event: KeyboardEvent) {
  return normalizeShortcutLabel(event.key);
}

export function sanitizeShortcuts(value: unknown): Shortcut[] {
  const byId = new Map<ShortcutId, Shortcut>(DEFAULT_SHORTCUTS.map(shortcut => [shortcut.id, { ...shortcut }]));
  const usedKeys = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;

      const candidate = item as Partial<Shortcut>;
      const id = candidate.id;
      const key = normalizeShortcutLabel(candidate.key);
      if (!id || !SHORTCUT_IDS.has(id) || !key || usedKeys.has(key)) continue;

      const defaults = byId.get(id);
      if (!defaults) continue;

      byId.set(id, {
        ...defaults,
        label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label : defaults.label,
        sub: typeof candidate.sub === 'string' && candidate.sub.trim() ? candidate.sub : defaults.sub,
        key,
      });
      usedKeys.add(key);
    }
  }

  Array.from(byId.values()).forEach(shortcut => {
    const key = normalizeShortcutLabel(shortcut.key);
    shortcut.key = key || DEFAULT_SHORTCUTS.find(item => item.id === shortcut.id)?.key || '';
  });

  return DEFAULT_SHORTCUTS.map(defaults => byId.get(defaults.id) ?? defaults);
}

export function getShortcutIdByKey(shortcuts: Shortcut[]) {
  const byKey = new Map<string, ShortcutId>();
  for (const shortcut of sanitizeShortcuts(shortcuts)) {
    const key = normalizeShortcutLabel(shortcut.key);
    if (key) byKey.set(key, shortcut.id);
  }
  return byKey;
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}
