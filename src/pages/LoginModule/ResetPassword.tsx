import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { translateAuthError } from '../../lib/authErrors';
import styles from './auth.module.css';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('error=access_denied') || hash.includes('otp_expired')) {
      setIsExpired(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(translateAuthError(error.message));
    } else {
      navigate('/login');
    }
    setLoading(false);
  };

  return (
    <div className={styles.authBg}>
      <div className={styles.bgCircleRed}></div>
      <div className={styles.bgCircleGrey}></div>
      <div className={styles.bgCircleGreen}></div>

      <div className={styles.card}>
        <div className={styles.logo}>
          <img src="/logo.png" alt="Logo PKR" className={styles.logoImage} />
        </div>

        {isExpired ? (
          <>
            <p className={styles.title}>Lien expiré</p>
            <p className={styles.subtitleDark}>
              Ce lien de réinitialisation est invalide ou a déjà été utilisé.
            </p>
            <button
              className={styles.btnRed}
              onClick={() => navigate('/forgot-password')}
            >
              Demander un nouveau lien
            </button>
            <div className={styles.footer}>
              <button
                onClick={() => navigate('/login')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
              >
                Retour à la connexion
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.title}>Nouveau mot de passe</p>
            <p className={styles.subtitleDark}>
              Choisis un nouveau mot de passe pour ton compte.
            </p>

            {error && <div className={styles.error}>{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label className={styles.label}>Nouveau mot de passe</label>
                <input
                  type="password"
                  className={styles.input}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Confirmer le mot de passe</label>
                <input
                  type="password"
                  className={styles.input}
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className={styles.btnRed} disabled={loading}>
                {loading ? 'Enregistrement...' : 'Enregistrer le mot de passe'}
              </button>
            </form>

            <div className={styles.footer}>
              <button
                onClick={() => navigate('/login')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
              >
                Retour à la connexion
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
