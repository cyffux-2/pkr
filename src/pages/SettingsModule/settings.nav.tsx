import { NavItem } from './settings.types';

const IconUser = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);
const IconInterface = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
  </svg>
);
const IconSound = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
  </svg>
);
const IconGame = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 12h4M8 10v4M15 12h.01M18 12h.01"/><rect x="2" y="6" width="20" height="12" rx="4"/>
  </svg>
);
const IconShortcut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01"/>
  </svg>
);
const IconLogout = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
  </svg>
);

export const NAV_ITEMS: NavItem[] = [
  { id: 'utilisateur', label: 'Utilisateur',  sub: 'Profil, email, pseudo',      icon: <IconUser /> },
  { id: 'interface',   label: 'Interface',    sub: 'Thème, couleurs, affichage', icon: <IconInterface /> },
  { id: 'son',         label: 'Son',          sub: 'Volume, alertes, ambiance',  icon: <IconSound /> },
  { id: 'jeu',         label: 'Jeu',          sub: 'Mises auto et préférences',  icon: <IconGame /> },
  { id: 'raccourcis',  label: 'Raccourcis',   sub: 'Touches et actions rapides', icon: <IconShortcut /> },
  { id: 'deconnexion', label: 'Déconnexion',  sub: 'Quitter la session',         icon: <IconLogout /> },
];
