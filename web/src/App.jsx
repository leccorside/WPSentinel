import { useEffect, useRef, useState } from 'react';

export default function App() {
  const [authStatus, setAuthStatus] = useState({ required: false, authenticated: false, loading: true });
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [actionError, setActionError] = useState('');
  const [cleanConfirmationInput, setCleanConfirmationInput] = useState('');
  const terminalEndRef = useRef(null);

  // Checa status de autenticação
  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        setAuthStatus({ required: data.required, authenticated: data.authenticated, loading: false });
        return data.authenticated || !data.required;
      }
    } catch {
      // Ignora erro de rede temporário
    }
    setAuthStatus((prev) => ({ ...prev, loading: false }));
    return false;
  };

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else if (res.status === 401) {
        setAuthStatus({ required: true, authenticated: false, loading: false });
      }
    } catch (err) {
      setActionError(`Erro ao carregar status: ${err.message}`);
    }
  };

  useEffect(() => {
    checkAuth().then((authed) => {
      if (authed) loadStatus();
    });
  }, []);

  // Conexão SSE para eventos ao vivo
  useEffect(() => {
    if (!authStatus.authenticated && authStatus.required) return;

    let eventSource;
    try {
      eventSource = new EventSource('/api/events');

      eventSource.addEventListener('init', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.recentLogs) setLogs(data.recentLogs);
          loadStatus();
        } catch {}
      });

      eventSource.addEventListener('log', (e) => {
        try {
          const entry = JSON.parse(e.data);
          setLogs((prev) => [...prev.slice(-300), entry]);
        } catch {}
      });

      eventSource.addEventListener('monitor', () => {
        loadStatus();
      });

      eventSource.addEventListener('job', () => {
        loadStatus();
      });

      eventSource.onerror = () => {
        // SSE tentará reconectar automaticamente
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [authStatus.authenticated, authStatus.required]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao autenticar');
      }
      setPassword('');
      setAuthStatus({ required: true, authenticated: true, loading: false });
      loadStatus();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setAuthStatus({ required: true, authenticated: false, loading: false });
    setStatus(null);
    setLogs([]);
  };

  const triggerJob = async (type) => {
    setActionError('');
    try {
      const res = await fetch('/api/jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao disparar trabalho');
      loadStatus();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const triggerMonitor = async (action) => {
    setActionError('');
    try {
      const res = await fetch(`/api/monitor/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erro ao ${action} monitor`);
      loadStatus();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const confirmClean = async () => {
    setActionError('');
    try {
      const res = await fetch('/api/jobs/clean/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cleanConfirmationInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código incorreto');
      setCleanConfirmationInput('');
      loadStatus();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const cancelClean = async () => {
    setActionError('');
    try {
      const res = await fetch('/api/jobs/clean/cancel', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao cancelar');
      setCleanConfirmationInput('');
      loadStatus();
    } catch (err) {
      setActionError(err.message);
    }
  };

  if (authStatus.loading) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', background: '#0a0e16', color: '#dfe2ee', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Carregando painel...</p>
      </main>
    );
  }

  // Tela de Login
  if (authStatus.required && !authStatus.authenticated) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', background: '#0a0e16', color: '#dfe2ee', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <div style={{ background: '#131824', border: '1px solid #232c3f', borderRadius: 12, padding: '2.5rem', width: '100%', maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '1.5rem', color: '#6ee7b7' }}>WP Sentinel</h1>
          <p style={{ margin: '0 0 1.5rem 0', color: '#94a3b8', fontSize: '0.9rem' }}>Acesso restrito. Digite a senha do painel.</p>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#cbd5e1' }}>Senha de Acesso</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                placeholder="••••••••••••"
                style={{ width: '100%', boxSizing: 'border-box', background: '#0a0e16', border: '1px solid #334155', borderRadius: 8, padding: '0.75rem', color: '#fff', fontSize: '1rem', outline: 'none' }}
              />
            </div>

            {loginError && (
              <div style={{ background: '#451a1a', border: '1px solid #ef4444', borderRadius: 8, padding: '0.75rem', marginBottom: '1.25rem', color: '#fca5a5', fontSize: '0.85rem' }}>
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              style={{ width: '100%', background: '#10b981', color: '#042f2e', fontWeight: 'bold', border: 'none', borderRadius: 8, padding: '0.75rem', cursor: loginLoading ? 'wait' : 'pointer', fontSize: '1rem', transition: 'background 0.2s' }}
            >
              {loginLoading ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const monitorState = status?.monitor?.state || 'stopped';
  const currentJob = status?.job;

  const monitorStateLabels = {
    stopped: { text: 'Parado', bg: '#334155', color: '#94a3b8' },
    running: { text: 'Varredura em andamento', bg: '#065f46', color: '#6ee7b7' },
    waiting: { text: 'Aguardando próximo ciclo', bg: '#1e3a8a', color: '#93c5fd' },
    stopping: { text: 'Parando...', bg: '#854d0e', color: '#fde047' },
    paused: { text: 'Pausado para trabalho', bg: '#701a75', color: '#f0abfc' },
  };

  const badge = monitorStateLabels[monitorState] || monitorStateLabels.stopped;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', background: '#0a0e16', color: '#dfe2ee', minHeight: '100vh', margin: 0, padding: '2rem' }}>
      {/* Cabeçalho */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid #1e293b', paddingBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: '#6ee7b7' }}>WP Sentinel</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>Painel de Segurança & Orquestração em Tempo Real (Passo 4)</p>
        </div>
        {authStatus.required && (
          <button
            onClick={handleLogout}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 6, padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Sair
          </button>
        )}
      </header>

      {actionError && (
        <div style={{ background: '#451a1a', border: '1px solid #ef4444', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.5rem', color: '#fca5a5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Cards de Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {/* Card Monitor */}
        <div style={{ background: '#131824', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motor Contínuo</span>
            <span style={{ background: badge.bg, color: badge.color, padding: '0.2rem 0.6rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>
              {badge.text}
            </span>
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: 600 }}>
            {status?.monitor?.cycle ? `Ciclo ${status.monitor.cycle}` : 'Sem ciclos ativos'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            {monitorState === 'stopped' ? (
              <button
                onClick={() => triggerMonitor('start')}
                style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 6, padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
              >
                ▶ Iniciar Monitor
              </button>
            ) : (
              <button
                onClick={() => triggerMonitor('stop')}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '0.4rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
              >
                ⏹ Parar Monitor
              </button>
            )}
          </div>
        </div>

        {/* Card Trabalho Atual */}
        <div style={{ background: '#131824', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trabalho Atual / Recente</span>
            <span style={{ background: currentJob?.status === 'running' ? '#065f46' : currentJob?.status === 'waiting_confirmation' ? '#b45309' : '#334155', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>
              {currentJob?.status || 'Nenhum'}
            </span>
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: 600 }}>
            {currentJob?.label || 'Inativo'}
          </p>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            {currentJob?.finishedAt ? `Concluído: ${new Date(currentJob.finishedAt).toLocaleTimeString()}` : currentJob?.startedAt ? `Iniciado: ${new Date(currentJob.startedAt).toLocaleTimeString()}` : 'Aguardando comando'}
          </span>
        </div>

        {/* Card Alertas */}
        <div style={{ background: '#131824', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.75rem' }}>Alertas Pendentes</span>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: status?.pendingAlerts?.critical ? '#ef4444' : '#10b981' }}>
              {status?.pendingAlerts?.critical || 0}
            </span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>crítico(s)</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: status?.pendingAlerts?.high ? '#f59e0b' : '#94a3b8', marginLeft: '1rem' }}>
              {status?.pendingAlerts?.high || 0}
            </span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>alto(s)</span>
          </div>
        </div>
      </div>

      {/* Modal / Banner de Confirmação Interativa de Limpeza */}
      {currentJob?.status === 'waiting_confirmation' && currentJob?.confirmation && (
        <div style={{ background: '#3b1c06', border: '2px solid #f59e0b', borderRadius: 10, padding: '1.5rem', marginBottom: '2rem', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
          <h2 style={{ margin: '0 0 0.5rem 0', color: '#fde047', fontSize: '1.25rem' }}>⚠️ Confirmação Obrigatória de Limpeza</h2>
          <p style={{ margin: '0 0 1rem 0', color: '#fed7aa', fontSize: '0.95rem' }}>{currentJob.confirmation.prompt}</p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder={currentJob.confirmation.code}
              value={cleanConfirmationInput}
              onChange={(e) => setCleanConfirmationInput(e.target.value)}
              style={{ background: '#1c1917', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.6rem 1rem', color: '#fff', fontSize: '1rem', fontFamily: 'monospace', outline: 'none', minWidth: 240 }}
            />
            <button
              onClick={confirmClean}
              style={{ background: '#10b981', color: '#042f2e', border: 'none', borderRadius: 6, padding: '0.6rem 1.25rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem' }}
            >
              Confirmar e Executar
            </button>
            <button
              onClick={cancelClean}
              style={{ background: '#78350f', color: '#fef3c7', border: 'none', borderRadius: 6, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}
            >
              Cancelar Limpeza
            </button>
          </div>
        </div>
      )}

      {/* Barra de Ações Rápidas */}
      <div style={{ background: '#131824', border: '1px solid #1e293b', borderRadius: 8, padding: '1.25rem', marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#cbd5e1' }}>Disparar Ações Manuais</h3>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => triggerJob('scan')}
            disabled={Boolean(currentJob && currentJob.status === 'running')}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6rem 1.1rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Disparar Varredura
          </button>
          <button
            onClick={() => triggerJob('scan_full')}
            disabled={Boolean(currentJob && currentJob.status === 'running')}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6rem 1.1rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Revalidar Hashes (Hash Completo)
          </button>
          <button
            onClick={() => triggerJob('plan')}
            disabled={Boolean(currentJob && currentJob.status === 'running')}
            style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6rem 1.1rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Gerar Plano de Limpeza
          </button>
          <button
            onClick={() => triggerJob('clean')}
            disabled={Boolean(currentJob && currentJob.status === 'running')}
            style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 6, padding: '0.6rem 1.1rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Executar Limpeza
          </button>
        </div>
      </div>

      {/* Terminal de Logs ao Vivo (SSE) */}
      <div style={{ background: '#080c14', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#0f172a', padding: '0.75rem 1rem', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8' }}>Terminal de Eventos ao Vivo (SSE: /api/events)</span>
          <button
            onClick={() => setLogs([])}
            style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 4, padding: '0.25rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer' }}
          >
            Limpar
          </button>
        </div>
        <div style={{ height: 350, overflowY: 'auto', padding: '1rem', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.5, background: '#05080f' }}>
          {logs.length === 0 ? (
            <span style={{ color: '#475569' }}>Aguardando eventos...</span>
          ) : (
            logs.map((log, index) => {
              const time = log.at ? new Date(log.at).toLocaleTimeString() : '';
              const isError = log.stream === 'stderr';
              return (
                <div key={index} style={{ color: isError ? '#f87171' : log.source === 'monitor' ? '#60a5fa' : '#34d399', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#64748b', marginRight: '0.5rem' }}>[{time}]</span>
                  <span style={{ color: '#94a3b8', marginRight: '0.5rem' }}>({log.source}):</span>
                  <span>{log.text}</span>
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </main>
  );
}
