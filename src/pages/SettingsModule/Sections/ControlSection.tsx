import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  DEFAULT_SHORTCUTS,
  normalizeShortcutLabel,
  sanitizeShortcuts,
  type Shortcut,
} from '../../../lib/shortcuts';
import styles from '../Settings.module.css';

export function SectionRaccourcis() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(DEFAULT_SHORTCUTS);
  const [editing, setEditing]     = useState<string | null>(null); // id du raccourci en cours d'édition
  const [conflict, setConflict]   = useState<string | null>(null);
  const [saved, setSaved]         = useState(false);

  // Charge depuis Supabase au montage
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const saved = user?.user_metadata?.shortcuts;
      setShortcuts(sanitizeShortcuts(saved));
    });
  }, []);

  // Écoute la touche pressée quand on est en mode édition
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!editing) return;
    e.preventDefault();

    const newKey = normalizeShortcutLabel(e.key);
    if (!newKey) return;

    // Vérifie les conflits
    const conflicting = shortcuts.find(s => s.key === newKey && s.id !== editing);
    if (conflicting) {
      setConflict(`"${newKey}" est déjà utilisé par "${conflicting.label}"`);
      setTimeout(() => setConflict(null), 2500);
      return;
    }

    const updated = sanitizeShortcuts(shortcuts.map(s => s.id === editing ? { ...s, key: newKey } : s));
    setShortcuts(updated);
    setEditing(null);
    setConflict(null);

    // Sauvegarde Supabase
    supabase.auth.updateUser({ data: { shortcuts: updated } }).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }, [editing, shortcuts]);

  useEffect(() => {
    if (editing) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [editing, handleKeyDown]);

  const resetAll = async () => {
    const defaults = sanitizeShortcuts(DEFAULT_SHORTCUTS);
    setShortcuts(defaults);
    setEditing(null);
    await supabase.auth.updateUser({ data: { shortcuts: defaults } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={styles.sectionContent}>
      <h2 className={styles.sectionTitle}>Raccourcis</h2>
      <p className={styles.sectionSub}>Configure les touches d'action pour jouer plus vite à la table.</p>

      {conflict && (
        <div className={`${styles.feedback} ${styles.feedbackErr}`}>{conflict}</div>
      )}
      {saved && !conflict && (
        <div className={`${styles.feedback} ${styles.feedbackOk}`}>✓ Raccourcis sauvegardés</div>
      )}

      <div className={styles.rows}>
        {shortcuts.map(s => (
          <div key={s.id} className={styles.row}>
            <div>
              <div className={styles.rowLabel}>{s.label}</div>
              <div className={styles.rowSub}>{s.sub}</div>
            </div>
            <div className={styles.rowAction}>
              <button
                className={`${styles.keyBadge} ${editing === s.id ? styles.keyBadgeEditing : ''}`}
                onClick={() => setEditing(editing === s.id ? null : s.id)}
                title="Cliquer puis appuyer sur une touche"
                type="button"
              >
                {editing === s.id ? '...' : s.key}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className={styles.resetBtn} onClick={resetAll} type="button">
        Réinitialiser les raccourcis
      </button>
    </div>
  );
}
