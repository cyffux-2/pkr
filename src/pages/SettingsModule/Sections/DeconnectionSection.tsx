import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import styles from '../Settings.module.css';

export function SectionDeconnexion() {
  const navigate   = useNavigate();
  const { logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className={styles.sectionContent}>
      <h2 className={styles.sectionTitle}>Déconnexion</h2>
      <p className={styles.sectionSub}>Confirme que tu souhaites quitter ta session PKR.</p>

      <div className={styles.logoutCard}>
        <div className={styles.logoutIcon}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
        </div>
        <p className={styles.logoutQuestion}>Voulez-vous vraiment vous déconnecter ?</p>
        <div className={styles.logoutBtns}>
          <button className={styles.logoutBtnCancel} onClick={() => navigate('/home')}>
            Annuler
          </button>
          <button className={styles.logoutBtnConfirm} onClick={handleLogout}>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
