export type Section = 'utilisateur' | 'interface' | 'son' | 'jeu' | 'raccourcis' | 'deconnexion';

export interface NavItem {
  id: Section;
  label: string;
  sub: string;
  icon: React.ReactNode;
}
