import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import styles from '../Settings.module.css';

const BET_PRESET_OPTIONS = [20, 33, 50, 75, 100, 150, 200];
const DEFAULT_BET_PRESETS = [50, 100];
const PREFLOP_BET_PRESET_OPTIONS = [2, 2.5, 3, 3.5, 4, 5];
const DEFAULT_PREFLOP_BET_PRESETS = [2.5, 3];

function sanitizeBetPresets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_BET_PRESETS;

  const presets = value
    .map(item => Number(item))
    .filter(item => BET_PRESET_OPTIONS.includes(item));

  return presets.length > 0 ? Array.from(new Set(presets)) : DEFAULT_BET_PRESETS;
}

function sanitizePreflopBetPresets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PREFLOP_BET_PRESETS;

  const presets = value
    .map(item => Number(item))
    .filter(item => PREFLOP_BET_PRESET_OPTIONS.includes(item));

  return presets.length > 0 ? Array.from(new Set(presets)) : DEFAULT_PREFLOP_BET_PRESETS;
}

function formatPreset(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function SectionJeu() {
  const [betPresets, setBetPresets] = useState<number[]>(DEFAULT_BET_PRESETS);
  const [preflopBetPresets, setPreflopBetPresets] = useState<number[]>(DEFAULT_PREFLOP_BET_PRESETS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setBetPresets(sanitizeBetPresets(user?.user_metadata?.bet_presets));
      setPreflopBetPresets(sanitizePreflopBetPresets(user?.user_metadata?.preflop_bet_presets_bb));
    });
  }, []);

  const saveBetPresets = async (nextPresets: number[]) => {
    const sanitized = sanitizeBetPresets(nextPresets);
    setBetPresets(sanitized);
    await supabase.auth.updateUser({ data: { bet_presets: sanitized } });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const savePreflopBetPresets = async (nextPresets: number[]) => {
    const sanitized = sanitizePreflopBetPresets(nextPresets);
    setPreflopBetPresets(sanitized);
    await supabase.auth.updateUser({ data: { preflop_bet_presets_bb: sanitized } });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const togglePreset = (preset: number) => {
    const nextPresets = betPresets.includes(preset)
      ? betPresets.filter(item => item !== preset)
      : [...betPresets, preset].sort((left, right) => left - right);

    void saveBetPresets(nextPresets);
  };

  const togglePreflopPreset = (preset: number) => {
    const nextPresets = preflopBetPresets.includes(preset)
      ? preflopBetPresets.filter(item => item !== preset)
      : [...preflopBetPresets, preset].sort((left, right) => left - right);

    void savePreflopBetPresets(nextPresets);
  };

  const resetPresets = () => {
    void saveBetPresets(DEFAULT_BET_PRESETS);
    void savePreflopBetPresets(DEFAULT_PREFLOP_BET_PRESETS);
  };

  return (
    <div className={styles.sectionContent}>
      <h2 className={styles.sectionTitle}>Jeu</h2>
      <p className={styles.sectionSub}>Choisis les mises affichées pendant une main.</p>

      {saved && (
        <div className={`${styles.feedback} ${styles.feedbackOk}`}>✓ Mises sauvegardées</div>
      )}

      <div className={styles.rows}>
        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>Mises préflop</div>
            <div className={styles.rowSub}>Affichés avant le flop, en montant total de relance en BB.</div>
          </div>
          <div className={`${styles.rowAction} ${styles.betPresetChoices}`}>
            {PREFLOP_BET_PRESET_OPTIONS.map(preset => (
              <button
                key={preset}
                className={`${styles.betPresetChoice} ${preflopBetPresets.includes(preset) ? styles.betPresetChoiceActive : ''}`}
                onClick={() => togglePreflopPreset(preset)}
                type="button"
              >
                {formatPreset(preset)}BB
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>Mises postflop</div>
            <div className={styles.rowSub}>Affichés à partir du flop, en pourcentage du pot.</div>
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
        Réinitialiser les mises
      </button>
    </div>
  );
}
