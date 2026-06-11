import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { translateAuthError } from '../../lib/authErrors';
import { applyPublicImageFallback, getPublicUrl } from '../../lib/publicUrl';
import styles from './auth.module.css';

type RecoveryStep = 'email' | 'code';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<RecoveryStep>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const normalizedEmail = email.trim().toLowerCase();

  const sendRecoveryCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!normalizedEmail) {
      setError('Email vide.');
      return;
    }

    setNotice('');
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setError(translateAuthError(error.message));
    } else {
      setStep('code');
      setNotice('Code de récupération envoyé.');
    }
    setLoading(false);
  };

  const changePasswordWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    const recoveryCode = code.trim().replace(/\s+/g, '');
    if (!normalizedEmail) {
      setError('Email vide.');
      setStep('email');
      return;
    }
    if (!recoveryCode) {
      setError('Code de récupération vide.');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < 6) {
      setError('Le mot de passe doit faire au moins 6 caractères.');
      return;
    }

    setLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: recoveryCode,
      type: 'recovery',
    });

    if (verifyError) {
      setLoading(false);
      setError(translateAuthError(verifyError.message));
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(translateAuthError(updateError.message));
    } else {
      await supabase.auth.signOut();
      navigate('/login', {
        replace: true,
        state: { notice: 'Mot de passe mis à jour. Tu peux te connecter.' },
      });
      setCode('');
      setPassword('');
      setConfirm('');
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
          <img src={getPublicUrl('/logo.png')} onError={event => applyPublicImageFallback(event.currentTarget, '/logo.png')} alt="Logo PKR" className={styles.logoImage} />
        </div>

        {step === 'code' ? (
          <>
            <p className={styles.title}>Code de récupération</p>
            <p className={styles.subtitleDark}>
              Entre le code reçu par email puis choisis ton nouveau mot de passe.
            </p>

            {error && <div className={styles.error}>{error}</div>}
            {notice && <div className={styles.notice}>{notice}</div>}

            <form onSubmit={changePasswordWithCode}>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <input
                  type="email"
                  className={styles.input}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className={styles.input}
                  placeholder="123456"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  required
                />
              </div>
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
                {loading ? 'Vérification...' : 'Changer le mot de passe'}
              </button>
            </form>

            <button
              type="button"
              className={styles.inlineAuthButton}
              onClick={() => sendRecoveryCode()}
              disabled={loading}
            >
              Renvoyer un code
            </button>

            <div className={styles.footer}>
              <Link to="/login">Retour à la connexion</Link>
            </div>
          </>
        ) : (
          <>
            <p className={styles.title}>Mot de passe oublié ?</p>
            <p className={styles.subtitleDark}>
              Entre ton email et on t'envoie un code de récupération.
            </p>

            {error && <div className={styles.error}>{error}</div>}
            {notice && <div className={styles.notice}>{notice}</div>}

            <form onSubmit={sendRecoveryCode}>
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
                {loading ? 'Envoi...' : 'Envoyer le code'}
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
