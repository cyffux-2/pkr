import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { translateAuthError } from '../../../lib/authErrors';
import styles from '../Settings.module.css';
import { Toggle, SettingRow, Modal } from '../settings.components';

export function SectionUtilisateur() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState(true);
  const [modal, setModal] = useState<'pseudo' | 'email' | 'password' | 'avatar' | 'delete' | null>(null);

  const [pseudo,        setPseudo]        = useState('');
  const [newEmail,      setNewEmail]      = useState('');
  const [newPwd,        setNewPwd]        = useState('');
  const [confirmPwd,    setConfirmPwd]    = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [feedback,      setFeedback]      = useState('');
  const [loading,       setLoading]       = useState(false);

  const ok  = (msg: string) => { setFeedback('✓ ' + msg); setTimeout(() => setFeedback(''), 3000); };
  const err = (msg: string) => { setFeedback('✗ ' + msg); setTimeout(() => setFeedback(''), 4000); };

  const savePseudo = async () => {
    if (!pseudo.trim()) return err('Pseudo vide.');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ data: { pseudo: pseudo.trim() } });
    setLoading(false);
    if (error) return err(translateAuthError(error.message));
    ok('Pseudo mis à jour !'); setModal(null); setPseudo('');
  };

  const saveEmail = async () => {
    if (!newEmail.trim()) return err('Email vide.');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setLoading(false);
    if (error) return err(translateAuthError(error.message));
    ok('Email mis à jour ! Vérifie ta boite mail.'); setModal(null); setNewEmail('');
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

  const toggleNotifs = async (val: boolean) => {
    setNotifications(val);
    await supabase.auth.updateUser({ data: { notifications: val } });
  };

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setLoading(true);
    const ext  = file.name.split('.').pop();
    const path = `${user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (upErr) { setLoading(false); return err(translateAuthError(upErr.message)); }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const { error: upUser } = await supabase.auth.updateUser({ data: { avatar_url: data.publicUrl } });
    setLoading(false);
    if (upUser) return err(translateAuthError(upUser.message));
    ok('Avatar mis à jour !'); setModal(null);
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
          action={<button className={styles.btnModify} onClick={() => setModal('pseudo')}>Modifier</button>} />
        <SettingRow label="Avatar" sub="Choisis ton avatar pour t'exprimer."
          action={<button className={styles.btnModify} onClick={() => setModal('avatar')}>Modifier</button>} />
        <SettingRow label="Email" sub="Adresse utilisée pour la connexion et la sécurité."
          action={<button className={styles.btnModify} onClick={() => setModal('email')}>Modifier</button>} />
        <SettingRow label="Mot de passe" sub="Mets à jour ton mot de passe régulièrement."
          action={<button className={styles.btnModify} onClick={() => setModal('password')}>Modifier</button>} />
        <SettingRow label="Notifications" sub="Recevoir les alertes importantes du compte."
          action={<Toggle checked={notifications} onChange={toggleNotifs} />} />
        <div className={styles.rowDanger} onClick={() => setModal('delete')}>
          <div className={styles.dangerIcon}>!</div>
          <span className={styles.dangerLabel}>Supprimer le compte</span>
        </div>
      </div>

      {modal === 'pseudo' && (
        <Modal title="Modifier le pseudo" onClose={() => setModal(null)}>
          <input className={styles.modalInput} placeholder="Nouveau pseudo" value={pseudo} onChange={e => setPseudo(e.target.value)} />
          <button className={styles.modalBtn} onClick={savePseudo} disabled={loading}>{loading ? '...' : 'Enregistrer'}</button>
        </Modal>
      )}
      {modal === 'email' && (
        <Modal title="Modifier l'email" onClose={() => setModal(null)}>
          <p className={styles.modalHint}>Email actuel : <strong>{user?.email}</strong></p>
          <input className={styles.modalInput} type="email" placeholder="Nouvel email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <button className={styles.modalBtn} onClick={saveEmail} disabled={loading}>{loading ? '...' : 'Enregistrer'}</button>
        </Modal>
      )}
      {modal === 'password' && (
        <Modal title="Modifier le mot de passe" onClose={() => setModal(null)}>
          <input className={styles.modalInput} type="password" placeholder="Nouveau mot de passe" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
          <input className={styles.modalInput} type="password" placeholder="Confirmer le mot de passe" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
          <button className={styles.modalBtn} onClick={savePassword} disabled={loading}>{loading ? '...' : 'Enregistrer'}</button>
        </Modal>
      )}
      {modal === 'avatar' && (
        <Modal title="Modifier l'avatar" onClose={() => setModal(null)}>
          <p className={styles.modalHint}>Formats acceptés : JPG, PNG, WEBP (max 2Mo)</p>
          <label className={styles.fileLabel}>
            <input type="file" accept="image/*" onChange={uploadAvatar} style={{ display: 'none' }} />
            {loading ? 'Envoi...' : 'Choisir un fichier'}
          </label>
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal title="Supprimer le compte" onClose={() => setModal(null)}>
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
