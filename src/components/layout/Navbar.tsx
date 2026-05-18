import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './Navbar.module.css';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className={styles.nav}>
      <Link to="/home" className={styles.logo}>
        ROYAL POKER
        <span>DEPUIS 2024</span>
      </Link>
      <div className={styles.links}>
        <Link to="/lobby">Salon</Link>
        <Link to="/tournaments">Tournois</Link>
        <Link to="/leaderboard">Classement</Link>
        <Link to="/learn">Apprendre</Link>
      </div>
      <div className={styles.actions}>
        {user ? (
          <>
            <span className={styles.chips}>{user.email}</span>
            <button onClick={logout} className={styles.btnSecondary}>Quitter</button>
          </>
        ) : (
          <Link to="/login" className={styles.btnPrimary}>Jouer</Link>
        )}
      </div>
    </nav>
  );
}
