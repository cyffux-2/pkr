import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { applyPublicImageFallback, getPublicUrl } from '../../lib/publicUrl';
import styles from './auth.module.css';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const errorDescription = params.get('error_description');

    if (errorDescription) {
      navigate('/login', {
        replace: true,
        state: { notice: 'Lien invalide ou expiré.' },
      });
      return;
    }

    if (!code) {
      setError('Lien invalide ou expiré.');
      return;
    }

    supabase.auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) {
          navigate('/login', {
            replace: true,
            state: { notice: 'Lien invalide ou expiré.' },
          });
          return;
        }

        navigate('/home', { replace: true });
      });
  }, [navigate]);

  return (
    <div className={styles.authBg}>
      <div className={styles.bgCircleRed}></div>
      <div className={styles.bgCircleGrey}></div>
      <div className={styles.bgCircleGreen}></div>

      <div className={styles.card}>
        <div className={styles.logo}>
          <img src={getPublicUrl('/logo.png')} onError={event => applyPublicImageFallback(event.currentTarget, '/logo.png')} alt="Logo PKR" className={styles.logoImage} />
        </div>

        {error ? (
          <>
            <p className={styles.title}>Connexion impossible</p>
            <div className={styles.error}>{error}</div>
            <div className={styles.footer} style={{ marginTop: '2rem' }}>
              <Link to="/login">Retour à la connexion</Link>
            </div>
          </>
        ) : (
          <>
            <p className={styles.title}>Connexion en cours</p>
            <p className={styles.subtitleDark}>Préparation de ta session PKR...</p>
          </>
        )}
      </div>
    </div>
  );
}
