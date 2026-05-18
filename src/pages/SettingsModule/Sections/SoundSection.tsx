import { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import styles from '../Settings.module.css';
import { Toggle, Slider, SettingRow } from '../settings.components';

export function SectionSon() {
  const [volumeGeneral, setVolumeGeneral] = useState(80);
  const [effetsJeu,     setEffetsJeu]     = useState(60);
  const [musique,       setMusique]       = useState(40);
  const [alertes,       setAlertes]       = useState(true);
  const [silencieux,    setSilencieux]    = useState(false);

  const save = async (key: string, val: number | boolean) => {
    await supabase.auth.updateUser({ data: { [`sound_${key}`]: val } });
  };

  return (
    <div className={styles.sectionContent}>
      <h2 className={styles.sectionTitle}>Son</h2>
      <p className={styles.sectionSub}>Ajuste les volumes, alertes sonores et l'ambiance audio du jeu.</p>
      <div className={styles.rows}>
        <SettingRow label="Volume général" sub="Contrôle le volume global de l'application."
          action={<Slider value={volumeGeneral} onChange={v => { setVolumeGeneral(v); save('volume_general', v); }} />} />
        <SettingRow label="Effets de jeu" sub="Cartes, jetons, actions et réactions de table."
          action={<Slider value={effetsJeu} onChange={v => { setEffetsJeu(v); save('effets_jeu', v); }} />} />
        <SettingRow label="Musique d'ambiance" sub="Ambiance sonore du lobby et des tables."
          action={<Slider value={musique} onChange={v => { setMusique(v); save('musique', v); }} />} />
        <SettingRow label="Alertes sonores" sub="Active les notifications audio importantes."
          action={<Toggle checked={alertes} onChange={v => { setAlertes(v); save('alertes', v); }} />} />
        <SettingRow label="Mode silencieux" sub="Désactive tous les sons pendant une partie."
          action={<Toggle checked={silencieux} onChange={v => { setSilencieux(v); save('silencieux', v); }} />} />
      </div>
    </div>
  );
}
