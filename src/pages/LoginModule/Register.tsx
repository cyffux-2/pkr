import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { translateAuthError } from '../../lib/authErrors';
import { useAuth } from '../../context/AuthContext';
import { getPublicUrl } from '../../lib/publicUrl';
import styles from './auth.module.css';

type Level = 'debutant' | 'intermediaire' | 'avance';

const LEVEL_ELO: Record<Level, number> = {
  debutant: 400,
  intermediaire: 600,
  avance: 800,
};

export default function Register() {
  const navigate = useNavigate();
  const { syncAuthSession } = useAuth();
  const [email, setEmail] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [level, setLevel] = useState<Level>('debutant');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          pseudo: pseudo.trim(),
          username: pseudo.trim(),
          level,
          elo: LEVEL_ELO[level],
        },
      },
    });

    if (error) {
      setError(translateAuthError(error.message));
    } else {
      if (data.session) {
        const activeSession = await syncAuthSession(data.session);
        if (!activeSession?.access_token) {
          setError('Connexion incomplète. Réessaie dans quelques secondes.');
          setLoading(false);
          return;
        }
        navigate('/home', { replace: true });
      } else {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) {
          setError(translateAuthError(signInError.message));
        } else {
          const activeSession = await syncAuthSession(signInData.session ?? undefined);
          if (!activeSession?.access_token) {
            setError('Connexion incomplète. Réessaie dans quelques secondes.');
            setLoading(false);
            return;
          }
          navigate('/home', { replace: true });
        }
      }
    }
    setLoading(false);
  };

  const levels: { id: Level; label: string }[] = [
    { id: 'debutant', label: 'Débutant' },
    { id: 'intermediaire', label: 'Intermédiaire' },
    { id: 'avance', label: 'Avancé' },
  ];

  return (
    <div className={styles.authBg}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoCircle}>
            {/* Si tu as un SVG spécifique pour le logo K en diamant, insère-le ici */}
            <div className={styles.logo}>
              <img src={getPublicUrl('/logo.png')} alt="Logo PKR" className={styles.logoImage} />
            </div>
          </div>
        </div>
        <p className={styles.title}>Créer un compte</p>

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
          <div className={styles.field}>
            <label className={styles.label}>Pseudo</label>
            <input 
              type="text" 
              className={styles.input} 
              placeholder="Ton pseudo"
              value={pseudo} 
              onChange={e => setPseudo(e.target.value)} 
              required 
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Mot de passe</label>
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
            <label className={styles.label}>Confirmer mot de passe</label>
            <input 
              type="password" 
              className={styles.input} 
              placeholder="••••••••"
              value={confirm} 
              onChange={e => setConfirm(e.target.value)} 
              required 
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Ton niveau au poker</label>
            <div className={styles.levelGroup}>
              {levels.map(l => (
                <button
                  key={l.id}
                  type="button"
                  className={level === l.id ? styles.levelBtnActive : styles.levelBtn}
                  onClick={() => setLevel(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className={styles.btnRed} disabled={loading}>
            {loading ? 'Création...' : 'Créer mon compte'}
          </button>
        </form>

        <div className={styles.footer}>
          Déjà inscrit ? <Link to="/login">Se connecter</Link>
        </div>
      </div>
    </div>
  );
}
