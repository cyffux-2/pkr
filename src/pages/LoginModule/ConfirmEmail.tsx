import { Link, useLocation } from 'react-router-dom';
import { publicAsset } from '../../lib/publicAssets';
import styles from './auth.module.css';

export default function ConfirmEmail() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <div className={styles.authBg}>
      <div className={styles.bgCircleRed}></div>
      <div className={styles.bgCircleGrey}></div>
      <div className={styles.bgCircleGreen}></div>

      <div className={styles.card}>
        <div className={styles.logo}>
          <img src={publicAsset('/logo.png')} alt="Logo PKR" className={styles.logoImage} />
        </div>

        <p className={styles.title}>Email de confirmation envoyé</p>
        <p className={styles.subtitleDark}>
          Un mail de confirmation vous a été envoyé{email ? ` à ${email}` : ''}.
          Validez votre compte depuis votre boîte mail avant de vous connecter.
        </p>

        <div className={styles.footer} style={{ marginTop: '2rem' }}>
          <Link to="/login">Retour à la connexion</Link>
        </div>
      </div>
    </div>
  );
}
