import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ProfilePopup.module.css';

interface Profile {
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

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
            onClick={() => { navigate('/stats'); onClose(); }}
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
    </div>
  );
}
