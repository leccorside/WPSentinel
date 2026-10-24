import { useEffect, useState } from 'react';

// Página provisória do Passo 2: confirma que o front é servido pelo container e fala com a API.
// O layout e as telas dos protótipos entram a partir do Passo 6.
export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(setHealth)
      .catch((reason) => setError(reason.message));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', background: '#0f131c', color: '#dfe2ee', minHeight: '100vh', margin: 0, padding: '2rem' }}>
      <h1 style={{ marginTop: 0 }}>WP Sentinel</h1>
      <p>Painel em construção (Passo 2 do PASSOS.md).</p>
      {error && <p style={{ color: '#ffb4ab' }}>API indisponível: {error}</p>}
      {health && (
        <pre style={{ background: '#0a0e16', padding: '1rem', borderRadius: 8, overflowX: 'auto' }}>
          {JSON.stringify(health, null, 2)}
        </pre>
      )}
    </main>
  );
}
