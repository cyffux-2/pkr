import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { translateAuthError } from '../../lib/authErrors';
import { publicAsset } from '../../lib/publicAssets';
import styles from './auth.module.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) { setError(translateAuthError(error.message)); } else { setSent(true); }
    setLoading(false);
  };

  return (
    <div className={styles.authBg}>
      <div className={styles.bgCircleRed}></div>
      <div className={styles.bgCircleGrey}></div>
      <div className={styles.bgCircleGreen}></div>

      <div className={styles.card}>
        <div className={styles.logo}>
          <img src={publicAsset('/logo.png')} alt="Logo PKR" className={styles.logoImage} />
        </div>

        {sent ? (
          <>
            <p className={styles.title}>Email envoyé !</p>
            <p className={styles.subtitleDark}>
              Vérifie ta boîte mail pour réinitialiser ton mot de passe.
            </p>
            <div className={styles.footer} style={{ marginTop: '2rem' }}>
              <Link to="/login">Retour à la connexion</Link>
            </div>
          </>
        ) : (
          <>
            <p className={styles.title}>Mot de passe oublié ?</p>
            <p className={styles.subtitleDark}>
              Entre ton email et on t'envoie un lien pour réinitialiser ton mot de passe.
            </p>

            {error && <div className={styles.error}>{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <input
                  type="email"
                  className={styles.input}
                  placeholder="exemple@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className={styles.btnRed} disabled={loading}>
                {loading ? 'Envoi...' : 'Envoyer le lien'}
              </button>
            </form>

            <div className={styles.footer}>
              <Link to="/login">Retour à la connexion</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
