import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 56px)', gap: '1rem' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '64px', color: 'var(--gold)' }}>404</h1>
      <p style={{ color: 'var(--text-muted)' }}>Cette page n'existe pas.</p>
      <Link to="/home" style={{ color: 'var(--gold)', fontSize: '14px', letterSpacing: '1px' }}>← Retour à l'accueil</Link>
    </div>
  );
}
