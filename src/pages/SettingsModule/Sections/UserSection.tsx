import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { translateAuthError } from '../../../lib/authErrors';
import styles from '../Settings.module.css';
import { SettingRow, Modal } from '../settings.components';

const AVATAR_PREVIEW_SIZE = 260;
const AVATAR_EXPORT_SIZE = 512;

type AvatarNaturalSize = {
  width: number;
  height: number;
};

type AvatarCropOffset = {
  x: number;
  y: number;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getAvatarScale(naturalSize: AvatarNaturalSize, zoom: number) {
  return Math.max(
    AVATAR_PREVIEW_SIZE / naturalSize.width,
    AVATAR_PREVIEW_SIZE / naturalSize.height,
  ) * zoom;
}

function clampAvatarOffset(naturalSize: AvatarNaturalSize | null, zoom: number, offset: AvatarCropOffset) {
  if (!naturalSize) return { x: 0, y: 0 };

  const scale = getAvatarScale(naturalSize, zoom);
  const maxX = Math.max(0, (naturalSize.width * scale - AVATAR_PREVIEW_SIZE) / 2);
  const maxY = Math.max(0, (naturalSize.height * scale - AVATAR_PREVIEW_SIZE) / 2);

  return {
    x: clampNumber(offset.x, -maxX, maxX),
    y: clampNumber(offset.y, -maxY, maxY),
  };
}

function getAvatarSourceCrop(naturalSize: AvatarNaturalSize, zoom: number, offset: AvatarCropOffset) {
  const clampedOffset = clampAvatarOffset(naturalSize, zoom, offset);
  const scale = getAvatarScale(naturalSize, zoom);
  const sourceSize = AVATAR_PREVIEW_SIZE / scale;

  return {
    x: clampNumber(naturalSize.width / 2 - sourceSize / 2 - clampedOffset.x / scale, 0, naturalSize.width - sourceSize),
    y: clampNumber(naturalSize.height / 2 - sourceSize / 2 - clampedOffset.y / scale, 0, naturalSize.height - sourceSize),
    size: sourceSize,
  };
}

export function SectionUtilisateur() {
  const navigate = useNavigate();
  const { user, profile, updateCachedProfile } = useAuth();
  const avatarImageRef = useRef<HTMLImageElement | null>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);
  const avatarDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offset: AvatarCropOffset;
  } | null>(null);
  const [modal, setModal] = useState<'pseudo' | 'password' | 'avatar' | 'delete' | null>(null);

  const [currentPseudo, setCurrentPseudo] = useState('');
  const [pseudo,        setPseudo]        = useState('');
  const [newPwd,        setNewPwd]        = useState('');
  const [confirmPwd,    setConfirmPwd]    = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [feedback,      setFeedback]      = useState('');
  const [loading,       setLoading]       = useState(false);
  const [avatarSourceUrl, setAvatarSourceUrl] = useState('');
  const [avatarFileName, setAvatarFileName] = useState('');
  const [avatarNaturalSize, setAvatarNaturalSize] = useState<AvatarNaturalSize | null>(null);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarOffset, setAvatarOffset] = useState<AvatarCropOffset>({ x: 0, y: 0 });
  const [avatarDragging, setAvatarDragging] = useState(false);

  const ok  = (msg: string) => { setFeedback('✓ ' + msg); setTimeout(() => setFeedback(''), 3000); };
  const err = (msg: string) => { setFeedback('✗ ' + msg); setTimeout(() => setFeedback(''), 4000); };

  useEffect(() => {
    setCurrentPseudo(profile?.username ?? '');
  }, [profile?.username]);

  useEffect(() => () => {
    if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);
  }, []);

  useEffect(() => {
    setAvatarOffset(current => clampAvatarOffset(avatarNaturalSize, avatarZoom, current));
  }, [avatarNaturalSize, avatarZoom]);

  const resetAvatarCrop = () => {
    if (avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current);
      avatarObjectUrlRef.current = null;
    }

    avatarImageRef.current = null;
    avatarDragRef.current = null;
    setAvatarSourceUrl('');
    setAvatarFileName('');
    setAvatarNaturalSize(null);
    setAvatarZoom(1);
    setAvatarOffset({ x: 0, y: 0 });
    setAvatarDragging(false);
  };

  const closeModal = () => {
    if (modal === 'avatar') resetAvatarCrop();
    setModal(null);
  };

  const openPseudoModal = () => {
    setPseudo(currentPseudo);
    setModal('pseudo');
  };

  const openAvatarModal = () => {
    resetAvatarCrop();
    setModal('avatar');
  };

  const savePseudo = async () => {
    if (!user) return err('Session expirée, reconnecte-toi.');
    const nextPseudo = pseudo.trim().replace(/\s+/g, ' ');
    if (!nextPseudo) return err('Pseudo vide.');
    if (nextPseudo.length < 2) return err('Pseudo trop court.');
    if (nextPseudo.length > 24) return err('Pseudo trop long.');

    setLoading(true);
    const { data: updatedProfile, error: profileError } = await supabase
      .from('profiles')
      .update({ username: nextPseudo })
      .eq('user_id', user.id)
      .select('username')
      .single();

    if (!profileError) {
      await supabase.auth.updateUser({
        data: {
          ...user.user_metadata,
          pseudo: nextPseudo,
          username: nextPseudo,
        },
      });
    }

    setLoading(false);
    if (profileError) return err(translateAuthError(profileError.message));

    const updatedUsername = updatedProfile?.username ?? nextPseudo;
    updateCachedProfile({ username: updatedUsername });
    setCurrentPseudo(updatedUsername);
    ok('Pseudo mis à jour !'); setModal(null); setPseudo('');
  };

  const savePassword = async () => {
    if (newPwd !== confirmPwd) return err('Les mots de passe ne correspondent pas.');
    if (newPwd.length < 6)    return err('Minimum 6 caractères.');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setLoading(false);
    if (error) return err(translateAuthError(error.message));
    ok('Mot de passe changé !'); setModal(null); setNewPwd(''); setConfirmPwd('');
  };

  const selectAvatarFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      err('Format image invalide.');
      return;
    }

    if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);

    const nextUrl = URL.createObjectURL(file);
    avatarObjectUrlRef.current = nextUrl;
    setAvatarSourceUrl(nextUrl);
    setAvatarFileName(file.name);
    setAvatarNaturalSize(null);
    setAvatarZoom(1);
    setAvatarOffset({ x: 0, y: 0 });
  };

  const renderCroppedAvatarBlob = async () => {
    const image = avatarImageRef.current;
    if (!image || !avatarNaturalSize) throw new Error('Image indisponible.');

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EXPORT_SIZE;
    canvas.height = AVATAR_EXPORT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Recadrage impossible.');

    const sourceCrop = getAvatarSourceCrop(avatarNaturalSize, avatarZoom, avatarOffset);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      image,
      sourceCrop.x,
      sourceCrop.y,
      sourceCrop.size,
      sourceCrop.size,
      0,
      0,
      AVATAR_EXPORT_SIZE,
      AVATAR_EXPORT_SIZE,
    );

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Recadrage impossible.'));
        }
      }, 'image/webp', 0.9);
    });
  };

  const uploadCroppedAvatar = async () => {
    if (!user) return err('Session expirée, reconnecte-toi.');
    if (!avatarSourceUrl || !avatarNaturalSize) return err('Choisis une image.');

    setLoading(true);
    const croppedAvatar = await renderCroppedAvatarBlob().catch(error => {
      setLoading(false);
      err(translateAuthError(error instanceof Error ? error.message : 'Recadrage impossible.'));
      return null;
    });
    if (!croppedAvatar) return;

    const version = Date.now();
    const path = `${user.id}/avatar.webp`;
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, croppedAvatar, {
      cacheControl: '3600',
      contentType: croppedAvatar.type || 'image/webp',
      upsert: true,
    });
    if (upErr) { setLoading(false); return err(translateAuthError(upErr.message)); }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicAvatarUrl = `${data.publicUrl}?v=${version}`;
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicAvatarUrl })
      .eq('user_id', user.id);

    if (profileError) {
      setLoading(false);
      return err(translateAuthError(profileError.message));
    }

    const { error: upUser } = await supabase.auth.updateUser({
      data: {
        ...user.user_metadata,
        avatar_url: publicAvatarUrl,
      },
    });
    setLoading(false);
    if (upUser) return err(translateAuthError(upUser.message));
    updateCachedProfile({ avatar_url: publicAvatarUrl });
    resetAvatarCrop();
    ok('Avatar mis à jour !'); setModal(null);
  };

  const startAvatarDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!avatarNaturalSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    avatarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: avatarOffset,
    };
    setAvatarDragging(true);
  };

  const moveAvatarDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = avatarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const nextOffset = {
      x: drag.offset.x + event.clientX - drag.startX,
      y: drag.offset.y + event.clientY - drag.startY,
    };
    setAvatarOffset(clampAvatarOffset(avatarNaturalSize, avatarZoom, nextOffset));
  };

  const endAvatarDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (avatarDragRef.current?.pointerId === event.pointerId) {
      avatarDragRef.current = null;
      setAvatarDragging(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== 'SUPPRIMER') return err('Tape SUPPRIMER pour confirmer.');
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setLoading(false); return err('Session expirée, reconnecte-toi.'); }
    const { data, error } = await supabase.functions.invoke('delete-user', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setLoading(false);
    if (error) return err(translateAuthError(error.message));
    if (data?.error) return err(translateAuthError(data.error));
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  const avatarPreviewStyle = avatarNaturalSize ? {
    width: avatarNaturalSize.width * Math.max(
      AVATAR_PREVIEW_SIZE / avatarNaturalSize.width,
      AVATAR_PREVIEW_SIZE / avatarNaturalSize.height,
    ),
    height: avatarNaturalSize.height * Math.max(
      AVATAR_PREVIEW_SIZE / avatarNaturalSize.width,
      AVATAR_PREVIEW_SIZE / avatarNaturalSize.height,
    ),
    transform: `translate(-50%, -50%) translate(${avatarOffset.x}px, ${avatarOffset.y}px) scale(${avatarZoom})`,
  } as CSSProperties : undefined;

  return (
    <div className={styles.sectionContent}>
      <h2 className={styles.sectionTitle}>Utilisateur</h2>
      <p className={styles.sectionSub}>Informations personnelles et sécurité du compte.</p>

      {feedback && (
        <div className={`${styles.feedback} ${feedback.startsWith('✓') ? styles.feedbackOk : styles.feedbackErr}`}>
          {feedback}
        </div>
      )}

      <div className={styles.rows}>
        <SettingRow label="Pseudo" sub="Nom visible à la table et dans les classements."
          action={<button className={styles.btnModify} onClick={openPseudoModal}>Modifier</button>} />
        <SettingRow label="Avatar" sub="Choisis ton avatar pour t'exprimer."
          action={<button className={styles.btnModify} onClick={openAvatarModal}>Modifier</button>} />
        <SettingRow label="Mot de passe" sub="Mets à jour ton mot de passe régulièrement."
          action={<button className={styles.btnModify} onClick={() => setModal('password')}>Modifier</button>} />
        <div className={styles.rowDanger} onClick={() => setModal('delete')}>
          <div className={styles.dangerIcon}>!</div>
          <span className={styles.dangerLabel}>Supprimer le compte</span>
        </div>
      </div>

      {modal === 'pseudo' && (
        <Modal title="Modifier le pseudo" onClose={closeModal}>
          {currentPseudo && <p className={styles.modalHint}>Pseudo actuel : <strong>{currentPseudo}</strong></p>}
          <input className={styles.modalInput} placeholder="Nouveau pseudo" value={pseudo} onChange={e => setPseudo(e.target.value)} />
          <button className={styles.modalBtn} onClick={savePseudo} disabled={loading}>{loading ? '...' : 'Enregistrer'}</button>
        </Modal>
      )}
      {modal === 'password' && (
        <Modal title="Modifier le mot de passe" onClose={closeModal}>
          <input className={styles.modalInput} type="password" placeholder="Nouveau mot de passe" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
          <input className={styles.modalInput} type="password" placeholder="Confirmer le mot de passe" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
          <button className={styles.modalBtn} onClick={savePassword} disabled={loading}>{loading ? '...' : 'Enregistrer'}</button>
        </Modal>
      )}
      {modal === 'avatar' && (
        <Modal title="Modifier l'avatar" onClose={closeModal}>
          <label className={styles.fileLabel}>
            <input type="file" accept="image/*" onChange={selectAvatarFile} style={{ display: 'none' }} />
            {avatarSourceUrl ? 'Choisir une autre image' : 'Choisir une image'}
          </label>

          {avatarSourceUrl && (
            <div className={styles.avatarCropper}>
              <div
                className={`${styles.avatarCropFrame} ${avatarDragging ? styles.avatarCropFrameDragging : ''}`}
                onPointerDown={startAvatarDrag}
                onPointerMove={moveAvatarDrag}
                onPointerUp={endAvatarDrag}
                onPointerCancel={endAvatarDrag}
              >
                <img
                  ref={avatarImageRef}
                  src={avatarSourceUrl}
                  alt=""
                  draggable={false}
                  className={styles.avatarCropImage}
                  style={avatarPreviewStyle}
                  onLoad={event => {
                    setAvatarNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                    setAvatarZoom(1);
                    setAvatarOffset({ x: 0, y: 0 });
                  }}
                />
              </div>

              <div className={styles.avatarCropControls}>
                <span>Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={avatarZoom}
                  onChange={event => setAvatarZoom(Number(event.target.value))}
                  className={styles.slider}
                />
              </div>

              <div className={styles.avatarCropActions}>
                <button
                  type="button"
                  className={styles.avatarSecondaryBtn}
                  onClick={() => {
                    setAvatarZoom(1);
                    setAvatarOffset({ x: 0, y: 0 });
                  }}
                  disabled={loading}
                >
                  Recentrer
                </button>
                <button
                  type="button"
                  className={styles.modalBtn}
                  onClick={uploadCroppedAvatar}
                  disabled={loading || !avatarNaturalSize}
                >
                  {loading ? 'Envoi...' : 'Enregistrer'}
                </button>
              </div>

              {avatarFileName && <p className={styles.avatarFileName}>{avatarFileName}</p>}
            </div>
          )}
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal title="Supprimer le compte" onClose={closeModal}>
          <p className={styles.modalHint} style={{ color: '#ff6b6b' }}>⚠️ Cette action est irréversible.</p>
          <p className={styles.modalHint}>Tape <strong>SUPPRIMER</strong> pour confirmer.</p>
          <input className={styles.modalInput} placeholder="SUPPRIMER" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} />
          <button className={`${styles.modalBtn} ${styles.modalBtnDanger}`} onClick={deleteAccount} disabled={loading}>
            {loading ? '...' : 'Supprimer définitivement'}
          </button>
        </Modal>
      )}
    </div>
  );
}
