import React, { useEffect, useRef, useState } from 'react';
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
  const [notifications, setNotifications] = useState({ unreadCount: 0, hasCriticalUnread: false, items: [] });

  // Modais e Toasts
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isDoubleCheckOpen, setIsDoubleCheckOpen] = useState(false);
  const [cleanActionLoading, setCleanActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [alertToast, setAlertToast] = useState(null);

  const burstRef = useRef({
    timer: null,
    alerts: [],
    seenIds: new Set(),
  });

  // Título da aba do navegador dinâmico com o número de alertas não lidos
  useEffect(() => {
    const unread = notifications?.unreadCount || 0;
    if (unread > 0) {
      document.title = `(${unread}) WP Sentinel`;
    } else {
      document.title = 'WP Sentinel';
    }
  }, [notifications?.unreadCount]);

  // Timer para fechar alertToast automaticamente
  useEffect(() => {
    if (!alertToast) return;
    const timer = setTimeout(() => {
      setAlertToast(null);
    }, 7000);
    return () => clearTimeout(timer);
  }, [alertToast]);

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

  const loadNotifications = async () => {
    try {
      const data = await api.notifications.list();
      setNotifications(data);
    } catch {}
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
      loadNotifications();
    } catch {}
  };

  useEffect(() => {
    checkAuth().then((authed) => {
      if (authed) loadData();
    });
  }, []);

  // Processador de rajadas de alertas em tempo real
  const handleIncomingAlert = (item) => {
    const burst = burstRef.current;
    if (item.id && burst.seenIds.has(item.id)) return;
    if (item.id) {
      burst.seenIds.add(item.id);
      if (burst.seenIds.size > 500) {
        const first = burst.seenIds.values().next().value;
        burst.seenIds.delete(first);
      }
    }

    burst.alerts.push(item);

    if (burst.timer) clearTimeout(burst.timer);

    burst.timer = setTimeout(() => {
      const pendingAlerts = [...burst.alerts];
      burst.alerts = [];

      if (pendingAlerts.length === 0) return;

      if (pendingAlerts.length === 1) {
        const single = pendingAlerts[0];
        setAlertToast({
          id: single.id || `toast-${Date.now()}`,
          severity: single.severity || 'critical',
          site: single.site,
          title: single.site && single.site !== 'sistema' && single.site !== 'geral' ? single.site : 'Aviso do Sistema',
          message: single.message || single.title,
          link: single.link || 'overview',
          count: 1,
        });
      } else {
        // Agrupamento de rajadas (ex.: "5 alertas críticos — adguarda.com.br")
        const criticalCount = pendingAlerts.filter((a) => a.severity === 'critical').length;
        const sites = Array.from(new Set(pendingAlerts.map((a) => a.site).filter(Boolean)));
        const primarySite = sites.length === 1 ? sites[0] : `${sites.length} sites`;
        const severityLabel = criticalCount > 0 ? 'críticos' : 'de alta prioridade';

        setAlertToast({
          id: `burst-${Date.now()}`,
          severity: criticalCount > 0 ? 'critical' : 'high',
          site: primarySite,
          title: `${pendingAlerts.length} alertas ${severityLabel} — ${primarySite}`,
          message: pendingAlerts.map((a) => a.title || a.message).slice(0, 3).join(' • ') + (pendingAlerts.length > 3 ? ` (+${pendingAlerts.length - 3})` : ''),
          link: 'overview',
          count: pendingAlerts.length,
        });
      }
    }, 600);
  };

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
    onAlert: (alert) => {
      if (alert.severity === 'critical' || alert.severity === 'high') {
        handleIncomingAlert({
          id: `alert-${alert.id}`,
          site: alert.site,
          severity: alert.severity,
          message: alert.message,
          title: alert.message,
          link: 'overview',
        });
      }
      loadNotifications();
    },
    onNotification: (notif) => {
      setNotifications((prev) => {
        const items = [notif, ...(prev?.items || [])].slice(0, 50);
        const unreadCount = (prev?.unreadCount || 0) + 1;
        const hasCriticalUnread = Boolean(prev?.hasCriticalUnread || notif.severity === 'critical');
        return { ...prev, items, unreadCount, hasCriticalUnread };
      });
      if (notif.severity === 'critical' || notif.severity === 'high') {
        handleIncomingAlert(notif);
      }
    },
    onNotificationsUpdated: (data) => {
      setNotifications((prev) => ({
        ...prev,
        unreadCount: data.unreadCount,
        hasCriticalUnread: data.hasCriticalUnread,
      }));
    },
  });

  const handleMarkRead = async (id) => {
    try {
      const res = await api.notifications.markRead(id);
      setNotifications((prev) => ({
        ...prev,
        unreadCount: res.unreadCount,
        hasCriticalUnread: res.hasCriticalUnread,
        items: (prev?.items || []).map((item) => (item.id === id ? { ...item, read: true } : item)),
      }));
    } catch {}
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await api.notifications.markAllRead();
      setNotifications((prev) => ({
        ...prev,
        unreadCount: 0,
        hasCriticalUnread: false,
        items: (prev?.items || []).map((item) => ({ ...item, read: true })),
      }));
    } catch {}
  };

  const handleNavigateView = (view, siteFilter = null) => {
    setActiveView(view);
    if (siteFilter && siteFilter !== 'all') {
      setSelectedSite(siteFilter);
    }
  };

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
      {/* Toast Notification Simples (Erros de ação) */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 p-4 rounded-lg bg-surface-container-high border border-error/40 text-error shadow-xl flex items-center gap-3 text-xs font-mono">
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="text-on-surface-variant hover:text-on-surface">
            ✕
          </button>
        </div>
      )}

      {/* Toast de Alertas Críticos / Rajadas em Tempo Real */}
      {alertToast && (
        <div
          onClick={() => {
            handleNavigateView(alertToast.link || 'overview', alertToast.site !== 'sistema' && alertToast.site !== 'geral' ? alertToast.site : 'all');
            setAlertToast(null);
          }}
          className={`fixed top-20 right-6 z-50 p-4 rounded-xl shadow-[0_16px_36px_rgba(0,0,0,0.8)] border flex items-start gap-3.5 max-w-md cursor-pointer animate-in fade-in slide-in-from-top-4 duration-200 backdrop-blur-xl ${
            alertToast.severity === 'critical'
              ? 'bg-surface-container-high/95 border-error/50 text-on-surface shadow-[0_0_24px_rgba(255,77,77,0.35)]'
              : 'bg-surface-container-high/95 border-amber-500/50 text-on-surface shadow-[0_0_24px_rgba(245,158,11,0.25)]'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
              alertToast.severity === 'critical'
                ? 'bg-error-container/30 border-error/40 text-error'
                : 'bg-amber-500/10 border-amber-500/40 text-amber-400'
            }`}
          >
            <span className="material-symbols-outlined text-xl">
              {alertToast.severity === 'critical' ? 'crisis_alert' : 'warning'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-bold text-on-surface truncate">
                {alertToast.title}
              </span>
              {alertToast.count > 1 && (
                <span className="px-1.5 py-0.2 bg-error text-on-error rounded-full text-[10px] font-mono font-bold">
                  +{alertToast.count}
                </span>
              )}
            </div>
            <p className="text-xs text-on-surface-variant font-sans leading-snug line-clamp-2">
              {alertToast.message}
            </p>
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-primary mt-1 hover:underline">
              <span>Abrir no painel</span>
              <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAlertToast(null);
            }}
            className="text-on-surface-variant hover:text-on-surface p-1 transition-colors"
          >
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
        notifications={notifications}
        onMarkRead={handleMarkRead}
        onMarkAllRead={handleMarkAllRead}
        onNavigateView={handleNavigateView}
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
              onSelectSite={setSelectedSite}
              onTriggerScan={() => triggerJob('scan')}
              onTriggerFullScan={() => triggerJob('scan_full')}
              overviewData={overview}
              statusData={status}
            />
          )}

          {activeView === 'cleanup' && (
            <CleanupView
              planData={plan}
              onTriggerPlan={() => triggerJob('plan')}
              onExecuteClean={() => triggerJob('clean')}
              isExecuting={currentJob?.status === 'running'}
              onOpenTerminal={() => setIsTerminalOpen(true)}
              onReloadPlan={loadData}
            />
          )}

          {activeView === 'reports' && (
            <ReportsView
              sites={sitesList}
              overviewData={overview}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              monitorState={status?.monitor?.state || 'stopped'}
              onTriggerMonitor={triggerMonitor}
              onTriggerResetBaseline={() => triggerJob('reset_baseline')}
              overviewData={overview}
              statusData={status}
              sites={sitesList}
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
