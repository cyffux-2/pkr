import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { translateAuthError } from '../../lib/authErrors';
import { formatLiveStatNumber, useLiveSiteStats } from '../../lib/useLiveSiteStats';
import { getPublicUrl } from '../../lib/publicUrl';
import styles from './auth.module.css';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { stats, loading: statsLoading } = useLiveSiteStats();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const routeNotice = (location.state as { notice?: string } | null)?.notice;
    if (routeNotice) {
      setNotice(routeNotice);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const code = new URLSearchParams(window.location.search).get('code');
    const errorDescription = new URLSearchParams(window.location.search).get('error_description');

    if (errorDescription) {
      setError(translateAuthError(errorDescription));
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (!code) return;

    setLoading(true);
    supabase.auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) {
          setError(translateAuthError(error.message));
        } else {
          navigate('/home', { replace: true });
        }
      })
      .finally(() => {
        setLoading(false);
        window.history.replaceState({}, document.title, window.location.pathname);
      });
  }, [location.state, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(translateAuthError(error.message));
    } else {
      navigate('/home');
    }
    setLoading(false);
  };

  return (
    <div className={styles.authBg}>
      <div className={styles.bgCircleRed}></div>
      <div className={styles.bgCircleGrey}></div>
      <div className={styles.bgCircleGreen}></div>

      <div className={styles.loginContainer}>
        {/* Panneau gauche sombre */}
        <div className={styles.leftPanel}>

          {/* Contenu textuel (flux normal) */}
          <div className={styles.leftContent}>
            <div className={styles.logoLeft}>
              <img src={getPublicUrl('/logo.png')} alt="Logo PKR" className={styles.logoImageLeft} />
            </div>
            <h2 className={styles.heroTitle}>DÉFIE LES<br />MEILLEURS</h2>
            <p className={styles.heroDesc}>
              Connecte-toi à ton espace PKR, mesure-toi aux autres joueurs
              et prouve que tu mérites ta place en haut du classement.
            </p>
          </div>

          {/* Zone basse : table + chips + stats (position relative, hauteur fixe) */}
          <div className={styles.tableZone}>
            {/* Table SVG */}
            <svg
              viewBox="0 0 340 160"
              xmlns="http://www.w3.org/2000/svg"
              className={styles.tableSvg}
              preserveAspectRatio="xMidYMid meet"
            >
              <ellipse cx="170" cy="110" rx="155" ry="55" fill="#0c3f1e" />
              <ellipse cx="170" cy="110" rx="130" ry="44" fill="#104e26" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              <ellipse cx="170" cy="110" rx="100" ry="34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <ellipse cx="170" cy="110" rx="70" ry="24" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            </svg>

            {/* Chip stack 1 — en haut au centre de la table */}
            <img src={getPublicUrl('/jeton.png')} alt="Jetons" className={styles.chipStack1} />
            {/* Chip stack 2 — en bas au centre de la table */}
            <img src={getPublicUrl('/jeton.png')} alt="Jetons" className={styles.chipStack2} />

            {/* Stats par-dessus le bord bas de la table */}
            <div className={styles.heroStats}>
              <div>
                <strong>{statsLoading ? '...' : formatLiveStatNumber(stats.playersInGame)}</strong>
                <span>Joueurs en jeu</span>
              </div>
              <div>
                <strong>{statsLoading ? '...' : formatLiveStatNumber(stats.activeTables)}</strong>
                <span>Tables actives</span>
              </div>
              <div>
                <strong>{statsLoading ? '...' : formatLiveStatNumber(stats.weeklyRegistrations)}</strong>
                <span>Inscriptions cette semaine</span>
              </div>
            </div>
          </div>

        </div>

        {/* Panneau droit clair */}
        <div className={styles.cardLight}>
          <div className={styles.logo}>
            <img src={getPublicUrl('/logo.png')} alt="Logo PKR" className={styles.logoImage} />
          </div>
          <p className={styles.subtitleLight}>Connecte-toi pour reprendre la compétition.</p>

          {notice && <div className={styles.notice}>{notice}</div>}
          {error && <div className={styles.error}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label className={styles.labelLight}>Email</label>
              <input
                type="email"
                className={styles.inputLight}
                placeholder="paul@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.labelLight}>Mot de passe</label>
              <input
                type="password"
                className={styles.inputLight}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            <div className={styles.rememberRowLight}>
              <label className={styles.checkLabelLight}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                />
                Se souvenir de moi
              </label>
              <Link to="/forgot-password" className={styles.forgotLinkLight}>
                Mot de passe oublié ?
              </Link>
            </div>

            <button type="submit" className={styles.btnRed} disabled={loading}>
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <div className={styles.footerLight}>
            Pas encore de compte ?{' '}<Link to="/register">Créer un compte</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
