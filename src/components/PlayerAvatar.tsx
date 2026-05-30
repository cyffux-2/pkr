import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import styles from './PlayerAvatar.module.css';

type PlayerAvatarTone = 'default' | 'warm' | 'table' | 'tableRed' | 'dark';

interface PlayerAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  size?: number | string;
  fontSize?: number | string;
  className?: string;
  tone?: PlayerAvatarTone;
  ariaLabel?: string;
}

function toCssSize(value: number | string | undefined) {
  if (typeof value === 'number') return `${value}px`;
  return value;
}

function getAvatarLetter(name: string | null | undefined) {
  const firstLetter = Array.from((name ?? '').trim())[0];
  return firstLetter ? firstLetter.toUpperCase() : '?';
}

export default function PlayerAvatar({
  name,
  avatarUrl,
  size,
  fontSize,
  className = '',
  tone = 'default',
  ariaLabel,
}: PlayerAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const cleanAvatarUrl = avatarUrl?.trim() || null;
  const showImage = Boolean(cleanAvatarUrl && !imageFailed);
  const letter = useMemo(() => getAvatarLetter(name), [name]);

  useEffect(() => {
    setImageFailed(false);
  }, [cleanAvatarUrl]);

  const avatarStyle = {
    ...(size ? { '--player-avatar-size': toCssSize(size) } : {}),
    ...(fontSize ? { '--player-avatar-font-size': toCssSize(fontSize) } : {}),
  } as CSSProperties;

  return (
    <span
      className={`${styles.avatar} ${className}`}
      data-tone={tone}
      style={avatarStyle}
      aria-label={ariaLabel ?? (name ? `Avatar de ${name}` : 'Avatar joueur')}
      role="img"
    >
      {showImage ? (
        <img className={styles.image} src={cleanAvatarUrl as string} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span className={styles.letter}>{letter}</span>
      )}
    </span>
  );
}
