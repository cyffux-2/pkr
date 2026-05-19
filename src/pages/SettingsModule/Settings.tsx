import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Settings.module.css';
import { Section } from './settings.types';
import { NAV_ITEMS } from './settings.nav';
import { SectionPlaceholder } from './settings.components';
import { SectionUtilisateur } from './Sections/UserSection';
import { SectionSon } from './Sections/SoundSection';
import { SectionJeu } from './Sections/GameSection';
import { SectionRaccourcis } from './Sections/ControlSection';
import { SectionDeconnexion } from './Sections/DeconnectionSection';

export default function Settings() {
  const navigate   = useNavigate();
  const [active, setActive] = useState<Section>('utilisateur');

  const handleNav = (id: Section) => setActive(id);

  const renderSection = () => {
    switch (active) {
      case 'utilisateur': return <SectionUtilisateur />;
      case 'son':         return <SectionSon />;
      case 'interface':   return <SectionPlaceholder title="Interface"  sub="Thème, couleurs et affichage." />;
      case 'jeu':         return <SectionJeu />;
      case 'raccourcis':  return <SectionRaccourcis />;
      case 'deconnexion': return <SectionDeconnexion />;
      default:            return null;
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <aside className={styles.left}>
          <h1 className={styles.mainTitle}>Paramètres</h1>
          <p className={styles.mainSub}>Gère ton profil et ton expérience</p>
          <nav className={styles.nav}>
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`${styles.navItem} ${active === item.id ? styles.navItemActive : ''} ${item.id === 'deconnexion' ? styles.navItemLogout : ''}`}
                onClick={() => handleNav(item.id)}
              >
                {active === item.id && <span className={styles.navAccent} />}
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navText}>
                  <span className={styles.navLabel}>{item.label}</span>
                  <span className={styles.navSub}>{item.sub}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <main className={styles.right}>
          <div className={styles.topBar}>
            <button className={styles.backBtn} onClick={() => navigate('/home')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              Retour
            </button>
          </div>
          {renderSection()}
        </main>
      </div>
    </div>
  );
}
