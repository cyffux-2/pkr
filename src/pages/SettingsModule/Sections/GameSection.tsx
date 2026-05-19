import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import styles from '../Settings.module.css';

const BET_PRESET_OPTIONS = [20, 33, 50, 75, 100, 150, 200];
const DEFAULT_BET_PRESETS = [50, 100];

function sanitizeBetPresets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_BET_PRESETS;

  const presets = value
    .map(item => Number(item))
    .filter(item => BET_PRESET_OPTIONS.includes(item));

  return presets.length > 0 ? Array.from(new Set(presets)) : DEFAULT_BET_PRESETS;
}

export function SectionJeu() {
  const [betPresets, setBetPresets] = useState<number[]>(DEFAULT_BET_PRESETS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setBetPresets(sanitizeBetPresets(user?.user_metadata?.bet_presets));
    });
  }, []);

  const saveBetPresets = async (nextPresets: number[]) => {
    const sanitized = sanitizeBetPresets(nextPresets);
    setBetPresets(sanitized);
    await supabase.auth.updateUser({ data: { bet_presets: sanitized } });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const togglePreset = (preset: number) => {
    const nextPresets = betPresets.includes(preset)
      ? betPresets.filter(item => item !== preset)
      : [...betPresets, preset].sort((left, right) => left - right);

    void saveBetPresets(nextPresets);
  };

  const resetPresets = () => {
    void saveBetPresets(DEFAULT_BET_PRESETS);
  };

  return (
    <div className={styles.sectionContent}>
      <h2 className={styles.sectionTitle}>Jeu</h2>
      <p className={styles.sectionSub}>Choisis les boutons de mise affichés pendant une main.</p>

      {saved && (
        <div className={`${styles.feedback} ${styles.feedbackOk}`}>✓ Boutons de mise sauvegardés</div>
      )}

      <div className={styles.rows}>
        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>Boutons de mise</div>
            <div className={styles.rowSub}>Le bouton All-in reste toujours disponible à la table.</div>
          </div>
          <div className={`${styles.rowAction} ${styles.betPresetChoices}`}>
            {BET_PRESET_OPTIONS.map(preset => (
              <button
                key={preset}
                className={`${styles.betPresetChoice} ${betPresets.includes(preset) ? styles.betPresetChoiceActive : ''}`}
                onClick={() => togglePreset(preset)}
                type="button"
              >
                {preset}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className={styles.resetBtn} onClick={resetPresets}>
        Réinitialiser les boutons de mise
      </button>
    </div>
  );
}
