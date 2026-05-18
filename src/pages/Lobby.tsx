import { useEffect } from 'react';
import { usePoker } from '../hooks/usePoker';

export default function Lobby() {
  const { tables, loading, fetchTables, joinTable } = usePoker();

  useEffect(() => { fetchTables(); }, []);

  return (
    <div style={{ padding: '2rem' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', marginBottom: '1.5rem' }}>
        Salon
      </h2>
      {loading && <p style={{ color: 'var(--text-muted)' }}>Chargement des tables...</p>}
      {tables.length === 0 && !loading && (
        <p style={{ color: 'var(--text-muted)' }}>Aucune table disponible pour le moment.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
        {tables.map(table => (
          <div key={table.id} onClick={() => joinTable(table.id)}
            style={{ background: 'var(--bg-darker)', border: '0.5px solid var(--border-gold)', borderRadius: '8px', padding: '1rem', cursor: 'pointer' }}>
            <p style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)' }}>{table.name}</p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{table.players}/{table.maxPlayers} joueurs · {table.blinds}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
