import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PlayerStatsPanel from '../../components/PlayerStatsPanel';
import styles from './ProfilePopup.module.css';

interface Profile {
  user_id?:    string;
  username:   string;
  tag:        string;
  elo:        number;
  avatar_url: string | null;
}

interface Props {
  profile: Profile | null;
  onClose: () => void;
}

export function ProfilePopup({ profile, onClose }: Props) {
  const navigate = useNavigate();
  const ref      = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;

      if (statsOpen) {
        if (statsRef.current?.contains(target) || ref.current?.contains(target)) return;
        setStatsOpen(false);
        return;
      }

      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, statsOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (statsOpen) {
        setStatsOpen(false);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, statsOpen]);

  const initiale = profile?.username?.[0]?.toUpperCase() ?? '?';

  return (
    <div className={styles.overlay}>
      <div className={styles.popup} ref={ref}>

        <div className={styles.avatarWrap}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="Avatar" className={styles.avatarImg} />
          ) : (
            <div className={styles.avatarFallback}>{initiale}</div>
          )}
        </div>

        <div className={styles.identity}>
          <span className={styles.pseudo}>{profile?.username ?? '—'}</span>
          <span className={styles.tag}>#{profile?.tag ?? ''}</span>
        </div>

        <div className={styles.eloWrap}>
          <span className={styles.eloLabel}>ELO</span>
          <span className={styles.eloValue}>{profile?.elo ?? -1}</span>
        </div>

        <div className={styles.btns}>
          <button
            className={styles.btnSecondary}
            onClick={() => setStatsOpen(true)}
          >
            Voir les statistiques
          </button>
          <button
            className={styles.btnPrimary}
            onClick={() => { navigate('/settings?section=utilisateur'); onClose(); }}
          >
            Modifier l'utilisateur
          </button>
        </div>

      </div>
      {statsOpen && (
        <div
          className={styles.statsOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={`Statistiques de ${profile?.username ?? 'joueur'}`}
          onMouseDown={event => {
            if (event.target === event.currentTarget) setStatsOpen(false);
          }}
        >
          <div className={styles.statsModal} ref={statsRef}>
            <PlayerStatsPanel
              mode="modal"
              onClose={() => setStatsOpen(false)}
              profile={profile}
            />
          </div>
        </div>
      )}
    </div>
  );
}
