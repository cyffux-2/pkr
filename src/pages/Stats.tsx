import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PlayerStatsPanel, { type PlayerStatsProfile } from '../components/PlayerStatsPanel';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import styles from './Stats.module.css';

export default function Stats() {
  const navigate = useNavigate();
  const { user, loading, profile, profileLoading } = useAuth();
  const [rank, setRank] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login');
      return;
    }

    if (profileLoading) return;

    if (!profile) {
      setError('Impossible de charger les statistiques.');
      return;
    }

    let cancelled = false;

    const fetchRank = async () => {
      setError('');

      const { data: leaderboardRows } = await supabase
        .from('profiles')
        .select('user_id, elo')
        .order('elo', { ascending: false });

      if (cancelled) return;

      const position = (leaderboardRows ?? []).findIndex(row => row.user_id === profile.user_id);
      setRank(position >= 0 ? position + 1 : null);
    };

    fetchRank();

    return () => {
      cancelled = true;
    };
  }, [loading, navigate, profile, profileLoading, user]);

  const statsProfile = useMemo<PlayerStatsProfile | null>(() => {
    if (!profile) return null;
    return {
      ...profile,
      rank,
    };
  }, [profile, rank]);

  return (
    <div className={styles.page}>
      <button className={styles.backButton} type="button" onClick={() => navigate('/home')} aria-label="Retour">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <line x1="7" y1="7" x2="17" y2="17" vectorEffect="non-scaling-stroke" />
          <line x1="17" y1="7" x2="7" y2="17" vectorEffect="non-scaling-stroke" />
        </svg>
      </button>
      {error ? <p className={styles.feedback}>{error}</p> : <PlayerStatsPanel profile={statsProfile} />}
    </div>
  );
}
