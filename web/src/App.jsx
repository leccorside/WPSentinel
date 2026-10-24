import React, { useEffect, useState } from 'react';
import { api } from './api/client';
import { useEvents } from './hooks/useEvents';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Footer } from './components/layout/Footer';
import { LiveTerminalModal } from './components/common/LiveTerminalModal';
import { DoubleCheckModal } from './components/common/DoubleCheckModal';
import { OverviewView } from './views/OverviewView';
import { ScannerView } from './views/ScannerView';
import { CleanupView } from './views/CleanupView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';

export default function App() {
  const [authStatus, setAuthStatus] = useState({ required: false, authenticated: false, loading: true });
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Estados principais
  const [activeView, setActiveView] = useState('overview');
  const [selectedSite, setSelectedSite] = useState('all');

  const [status, setStatus] = useState(null);
  const [overview, setOverview] = useState(null);
  const [plan, setPlan] = useState(null);

  // Modais
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isDoubleCheckOpen, setIsDoubleCheckOpen] = useState(false);
  const [cleanActionLoading, setCleanActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const checkAuth = async () => {
    try {
      const data = await api.auth.status();
      setAuthStatus({ required: data.required, authenticated: data.authenticated, loading: false });
      return data.authenticated || !data.required;
    } catch {
      setAuthStatus((prev) => ({ ...prev, loading: false }));
      return false;
    }
  };

  const loadData = async () => {
    try {
      const [statusData, overviewData, planData] = await Promise.allSettled([
        api.status(),
        api.overview(),
        api.plan(),
      ]);
      if (statusData.status === 'fulfilled') setStatus(statusData.value);
      if (overviewData.status === 'fulfilled') setOverview(overviewData.value);
      if (planData.status === 'fulfilled') setPlan(planData.value);
    } catch {}
  };

  useEffect(() => {
    checkAuth().then((authed) => {
      if (authed) loadData();
    });
  }, []);

  // SSE Realtime Hook
  const { logs, clearLogs, connected: sseConnected } = useEvents({
    enabled: authStatus.authenticated || !authStatus.required,
    onMonitor: (m) => {
      setStatus((prev) => (prev ? { ...prev, monitor: m } : null));
    },
    onJob: (j) => {
      setStatus((prev) => (prev ? { ...prev, job: j } : null));
      if (j?.status === 'waiting_confirmation') {
        setIsDoubleCheckOpen(true);
      }
      if (j?.status === 'completed' || j?.status === 'failed') {
        loadData();
      }
    },
  });

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      await api.auth.login(password);
      setPassword('');
      setAuthStatus({ required: true, authenticated: true, loading: false });
      loadData();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {}
    setAuthStatus({ required: true, authenticated: false, loading: false });
    setStatus(null);
    setOverview(null);
  };

  const triggerJob = async (type) => {
    try {
      setIsTerminalOpen(true);
      await api.jobs.run(type);
      loadData();
    } catch (err) {
      setToastMessage({ type: 'error', text: err.message });
    }
  };

  const triggerMonitor = async (action) => {
    try {
      if (action === 'start') await api.monitor.start();
      else await api.monitor.stop();
      loadData();
    } catch (err) {
      setToastMessage({ type: 'error', text: err.message });
    }
  };

  const handleConfirmClean = async (code) => {
    setCleanActionLoading(true);
    try {
      await api.jobs.confirmClean(code);
      setIsDoubleCheckOpen(false);
      setIsTerminalOpen(true);
      loadData();
    } catch (err) {
      setToastMessage({ type: 'error', text: err.message });
    } finally {
      setCleanActionLoading(false);
    }
  };

  const handleCancelClean = async () => {
    setCleanActionLoading(true);
    try {
      await api.jobs.cancelClean();
      setIsDoubleCheckOpen(false);
      loadData();
    } catch (err) {
      setToastMessage({ type: 'error', text: err.message });
    } finally {
      setCleanActionLoading(false);
    }
  };

  // Se estiver carregando verificação de auth
  if (authStatus.loading) {
    return (
      <main className="min-h-screen bg-surface flex items-center justify-center font-mono text-xs text-outline">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
          <span>Inicializando WP Sentinel SecOps...</span>
        </div>
      </main>
    );
  }

  // Tela de Login
  if (authStatus.required && !authStatus.authenticated) {
    return (
      <main className="min-h-screen bg-surface-container-lowest flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-surface-container-low border border-outline-variant/30 rounded-xl p-8 shadow-[0_20px_40px_rgba(0,0,0,0.7)]">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded bg-primary-container/20 border border-primary/40 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-lg">shield</span>
            </div>
            <h1 className="font-headline font-bold text-lg text-on-surface uppercase tracking-tight">
              WP Sentinel
            </h1>
          </div>
          <p className="text-xs text-on-surface-variant font-mono mb-6">
            Acesso Restrito ao Painel SecOps
          </p>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-mono uppercase text-outline mb-1.5">
                Senha de Acesso
              </label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface font-mono text-sm outline-none focus:border-primary transition-colors"
              />
            </div>

            {loginError && (
              <div className="p-2.5 bg-error-container/20 border border-error/40 rounded-lg text-xs text-error font-medium">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-2.5 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary font-headline font-bold text-xs uppercase tracking-wider rounded-lg transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)] cursor-pointer"
            >
              {loginLoading ? 'Verificando...' : 'Entrar no Painel'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const currentJob = status?.job;
  const isScanning = currentJob?.status === 'running' && ['scan', 'scan_full'].includes(currentJob?.type);
  const sitesList = status?.sites || overview?.sites || [];

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 p-4 rounded-lg bg-surface-container-high border border-error/40 text-error shadow-xl flex items-center gap-3 text-xs font-mono">
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="text-on-surface-variant hover:text-on-surface">
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <Header
        sites={sitesList}
        selectedSite={selectedSite}
        onSelectSite={setSelectedSite}
        monitorState={status?.monitor?.state || 'stopped'}
        monitorCycle={status?.monitor?.cycle || 0}
        pendingPlanActions={plan?.summary?.actions || 0}
        onTriggerScan={() => triggerJob('scan')}
        onOpenCleanup={() => setActiveView('cleanup')}
        onOpenReports={() => setActiveView('reports')}
        onOpenTerminal={() => setIsTerminalOpen(true)}
        authRequired={authStatus.required}
        onLogout={handleLogout}
        isScanning={isScanning}
      />

      {/* Sidebar */}
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        sites={sitesList}
        selectedSite={selectedSite}
        onSelectSite={setSelectedSite}
        baselineDate={overview?.baselineTrustedAt}
      />

      {/* Main View Area */}
      <div className="pl-64 flex flex-col min-h-screen pt-16">
        <main className="flex-1 p-6 lg:p-8 bg-surface">
          {activeView === 'overview' && (
            <OverviewView
              overviewData={overview}
              statusData={status}
              selectedSite={selectedSite}
              onSelectSite={setSelectedSite}
              onTriggerScan={() => triggerJob('scan')}
              onTriggerFullScan={() => triggerJob('scan_full')}
              onOpenCleanup={() => setActiveView('cleanup')}
              onTriggerMonitor={triggerMonitor}
            />
          )}

          {activeView === 'scanner' && (
            <ScannerView
              sites={sitesList}
              selectedSite={selectedSite}
              onTriggerScan={() => triggerJob('scan')}
              onTriggerFullScan={() => triggerJob('scan_full')}
            />
          )}

          {activeView === 'cleanup' && (
            <CleanupView
              planData={plan}
              onTriggerPlan={() => triggerJob('plan')}
              onExecuteClean={() => triggerJob('clean')}
              isExecuting={currentJob?.status === 'running'}
            />
          )}

          {activeView === 'reports' && <ReportsView />}

          {activeView === 'settings' && (
            <SettingsView
              monitorState={status?.monitor?.state || 'stopped'}
              onTriggerMonitor={triggerMonitor}
              onTriggerResetBaseline={() => triggerJob('reset_baseline')}
            />
          )}
        </main>

        {/* Footer */}
        <Footer
          cycle={status?.monitor?.cycle || overview?.cycle || 0}
          lastUpdatedAt={status?.lastCycle?.updatedAt || overview?.updatedAt}
          sseConnected={sseConnected}
        />
      </div>

      {/* Live Terminal Modal */}
      <LiveTerminalModal
        isOpen={isTerminalOpen}
        onClose={() => setIsTerminalOpen(false)}
        logs={logs}
        onClear={clearLogs}
        activeJob={currentJob}
        daemonState={status?.monitor?.state || 'stopped'}
      />

      {/* Double Check Modal for Cleanup */}
      <DoubleCheckModal
        isOpen={isDoubleCheckOpen || currentJob?.status === 'waiting_confirmation'}
        title="Confirmação Obrigatória de Limpeza"
        promptText={currentJob?.confirmation?.prompt || 'Esta ação executará as remoções propostas pelo motor de limpeza.'}
        confirmationPhrase={currentJob?.confirmation?.code || (plan?.plan?.id ? `LIMPAR-${plan.plan.id}` : '')}
        onConfirm={handleConfirmClean}
        onCancel={handleCancelClean}
        loading={cleanActionLoading}
        actionLabel="Confirmar e Executar Limpeza"
      />
    </div>
  );
}
