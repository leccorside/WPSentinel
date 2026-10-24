import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/common/StatusBadge';

export function OverviewView({
  overviewData,
  selectedSite,
  onSelectSite,
  onTriggerScan,
  onTriggerFullScan,
  onOpenCleanup,
  statusData,
  onTriggerMonitor,
}) {
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('all'); // 'all' | 'critical' | 'high' | 'info'
  const [onlyPending, setOnlyPending] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAlertPayload, setSelectedAlertPayload] = useState(null);

  // Modal de teste de conectividade
  const [testResult, setTestResult] = useState(null);
  const [testingSiteKey, setTestingSiteKey] = useState(null);

  const totals = overviewData?.totals || {};
  const sites = overviewData?.sites || [];
  const filteredSites = selectedSite === 'all' ? sites : sites.filter((s) => s.key === selectedSite);

  const pendingCrit = totals.pending?.critical || 0;
  const pendingHigh = totals.pending?.high || 0;
  const filesMonitored = totals.filesMonitored || 0;
  const sessionsTotal = totals.sessions || 0;
  const suspiciousSessions = totals.pending?.suspiciousSessions || 0;
  const hiddenLinksTotal = totals.pending?.hiddenLinks || 0;

  // Carrega alertas do feed
  const loadAlerts = async () => {
    setAlertsLoading(true);
    try {
      const params = {
        limit: 100,
        pending: onlyPending ? '1' : '0',
      };
      if (severityFilter !== 'all') params.severity = severityFilter;
      if (selectedSite !== 'all') params.site = selectedSite;
      if (searchQuery.trim()) params.q = searchQuery.trim();

      const data = await api.alerts(params);
      setAlerts(data.items || []);
    } catch {
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [severityFilter, selectedSite, onlyPending, searchQuery]);

  // Executa teste de conectividade no site
  const handleTestSite = async (siteKey) => {
    setTestingSiteKey(siteKey);
    try {
      const result = await api.sites.test(siteKey);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        siteName: siteKey,
        error: err.message,
      });
    } finally {
      setTestingSiteKey(null);
    }
  };

  const monitorState = statusData?.monitor?.state || 'stopped';
  const monitorCycle = statusData?.monitor?.cycle || overviewData?.cycle || 0;
  const intervalSeconds = overviewData?.settings?.intervalSeconds || 300;
  const fullHashEvery = overviewData?.settings?.fullHashEvery || 24;
  const nextFullHash = overviewData?.settings?.nextFullHashCycle || (Math.floor(monitorCycle / fullHashEvery) + 1) * fullHashEvery;
  const baselineDate = overviewData?.baselineTrustedAt;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header: Perímetro Operacional & Scope Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-on-surface-variant font-mono text-[11px] uppercase tracking-wider mb-1">
            <span>Perímetro Operacional</span>
            <span>/</span>
            <span className="text-tertiary-fixed-dim">Zero Trust Watchdog</span>
          </div>
          <h1 className="font-headline font-bold text-2xl text-on-surface tracking-tight flex items-center gap-3">
            Visão Geral & Matriz de Risco
            <span className="px-2 py-0.5 bg-secondary/10 text-secondary text-xs font-mono font-semibold rounded flex items-center gap-1.5 border border-secondary/30">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
              {filteredSites.length} {filteredSites.length === 1 ? 'SITE MONITORADO' : 'SITES MONITORADOS'}
            </span>
          </h1>
        </div>

        {/* Right Controls: Scope switcher + Botões de Ação */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center p-1 bg-surface-container-low border border-outline-variant/30 rounded-lg">
            <button
              type="button"
              onClick={() => onSelectSite('all')}
              className={`px-3 py-1.5 rounded text-xs font-headline font-semibold transition-all ${
                selectedSite === 'all'
                  ? 'bg-surface-container-high text-primary shadow-sm border border-outline-variant/40'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Todos ({sites.length})
            </button>
            {sites.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onSelectSite(s.key)}
                className={`px-3 py-1.5 rounded text-xs font-headline font-semibold transition-all ${
                  selectedSite === s.key
                    ? 'bg-surface-container-high text-primary shadow-sm border border-outline-variant/40'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onTriggerFullScan}
            title="Força o cálculo de SHA-256 em todos os arquivos de todos os sites"
            className="flex items-center gap-1.5 px-3 py-2 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-primary rounded-lg text-xs font-headline font-semibold transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">verified</span>
            <span className="hidden sm:inline">Revalidar Hashes</span>
          </button>

          <button
            type="button"
            onClick={onTriggerScan}
            className="group flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary font-headline font-bold text-xs uppercase tracking-wider rounded-lg transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)] cursor-pointer"
          >
            <span className="material-symbols-outlined text-base group-hover:rotate-180 transition-transform duration-500">
              sync
            </span>
            <span>Varredura Manual</span>
          </button>
        </div>
      </div>

      {/* 4 Primary KPI Metrics Grid com Sparklines conforme DESIGN.md */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Integridade / Ameaças Pendentes */}
        <div className={`p-4 rounded-xl bg-surface-container-low border transition-all ${
          pendingCrit > 0
            ? 'border-error/40 shadow-[0_0_16px_-2px_rgba(244,63,94,0.3)]'
            : 'border-outline-variant/30 hover:border-outline-variant/60'
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[11px] text-outline uppercase tracking-wider block mb-1">
                Score de Integridade
              </span>
              <span className="font-headline font-bold text-2xl text-on-surface tracking-tight">
                {pendingCrit === 0 ? '100% Blindado' : `${pendingCrit} Crítico(s)`}
              </span>
            </div>
            <div className={`p-2 rounded-lg ${pendingCrit > 0 ? 'bg-error-container text-on-error-container' : 'bg-secondary/10 text-secondary'}`}>
              <span className="material-symbols-outlined text-xl">shield</span>
            </div>
          </div>
          <div className="my-2">
            <svg className={`w-full h-6 ${pendingCrit > 0 ? 'text-error' : 'text-secondary'}`} fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
              <path d="M0 20 L20 18 L40 19 L60 12 L80 14 L100 10" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              <path d="M0 20 L20 18 L40 19 L60 12 L80 14 L100 10 V 24 H 0 Z" fill="currentColor" fillOpacity="0.1" />
            </svg>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-on-surface-variant">
              {pendingCrit > 0 ? `${pendingCrit} pendência(s) de limpeza` : '0 ameaças ativas pós-limpeza'}
            </span>
            <span className="px-1.5 py-0.5 bg-secondary/10 text-secondary rounded text-[10px]">CONFORME</span>
          </div>
        </div>

        {/* KPI 2: Sessões Remotas */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 hover:border-outline-variant/60 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[11px] text-outline uppercase tracking-wider block mb-1">
                Sessões Remotas (MySQL)
              </span>
              <span className="font-headline font-bold text-2xl text-on-surface tracking-tight">
                {suspiciousSessions > 0 ? `${suspiciousSessions} Anômala(s)` : `${sessionsTotal} Ativas`}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-tertiary/10 text-tertiary">
              <span className="material-symbols-outlined text-xl">fingerprint</span>
            </div>
          </div>
          <div className="my-2">
            <svg className="w-full h-6 text-tertiary" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
              <path d="M0 16 L20 16 L40 14 L60 8 L80 8 L100 8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              <path d="M0 16 L20 16 L40 14 L60 8 L80 8 L100 8 V 24 H 0 Z" fill="currentColor" fillOpacity="0.1" />
            </svg>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-on-surface-variant">
              {suspiciousSessions > 0 ? 'Sessão com IP do servidor/Wordpress' : `${sessionsTotal} sessões legítimas`}
            </span>
            <span className="px-1.5 py-0.5 bg-surface-container-high text-tertiary rounded text-[10px]">AUDITADO</span>
          </div>
        </div>

        {/* KPI 3: Arquivos Monitorados */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 hover:border-outline-variant/60 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[11px] text-outline uppercase tracking-wider block mb-1">
                Integridade Core
              </span>
              <span className="font-headline font-bold text-2xl text-on-surface tracking-tight">
                {filesMonitored.toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-xl">checklist</span>
            </div>
          </div>
          <div className="my-2">
            <svg className="w-full h-6 text-primary" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
              <path d="M0 22 L25 20 L50 15 L75 14 L100 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              <path d="M0 22 L25 20 L50 15 L75 14 L100 12 V 24 H 0 Z" fill="currentColor" fillOpacity="0.1" />
            </svg>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-on-surface-variant">Custódia SHA-256 canônica</span>
            <span className="px-1.5 py-0.5 bg-surface-container-high text-primary rounded text-[10px]">SHA-256 SYNC</span>
          </div>
        </div>

        {/* KPI 4: SEO Spam Vector */}
        <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 hover:border-outline-variant/60 transition-all">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-[11px] text-outline uppercase tracking-wider block mb-1">
                SEO Spam Vector
              </span>
              <span className="font-headline font-bold text-2xl text-on-surface tracking-tight">
                {hiddenLinksTotal > 0 ? `${hiddenLinksTotal} Oculto(s)` : '0 Ocultos'}
              </span>
            </div>
            <div className={`p-2 rounded-lg ${hiddenLinksTotal > 0 ? 'bg-error-container text-on-error-container' : 'bg-secondary/10 text-secondary'}`}>
              <span className="material-symbols-outlined text-xl">visibility</span>
            </div>
          </div>
          <div className="my-2">
            <svg className={`w-full h-6 ${hiddenLinksTotal > 0 ? 'text-error' : 'text-secondary'}`} fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
              <path d="M0 24 L30 18 L60 12 L80 12 L100 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              <path d="M0 24 L30 18 L60 12 L80 12 L100 6 V 24 H 0 Z" fill="currentColor" fillOpacity="0.1" />
            </svg>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-on-surface-variant">Post Content & Elementor</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${hiddenLinksTotal > 0 ? 'bg-error-container text-on-error-container' : 'bg-secondary/10 text-secondary'}`}>
              {hiddenLinksTotal > 0 ? 'DETECTADO' : 'CLEAN'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Split Layout: Matriz de Defesa por Perímetro (Col 8) + Painel do Motor (Col 4) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Coluna 8: Cards de Defesa por Site */}
        <div className="xl:col-span-8 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-headline font-bold text-lg text-on-surface">Matriz de Defesa por Perímetro</h2>
            <span className="font-mono text-xs text-outline uppercase tracking-wider">
              Auditoria Criptográfica Remota
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredSites.map((site) => {
              const diff = (site.files?.modified || 0) + (site.files?.added || 0) + (site.files?.removed || 0);
              const isClean = diff === 0 && (site.files?.phpInUploads || 0) === 0;

              return (
                <div
                  key={site.key}
                  className="flex flex-col justify-between p-5 bg-surface-container-low border border-outline-variant/30 rounded-xl hover:border-outline-variant/60 transition-all shadow-sm"
                >
                  <div>
                    {/* Header do Card */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary border border-outline-variant/30">
                          <span className="material-symbols-outlined text-xl">domain</span>
                        </div>
                        <div>
                          <h3 className="font-headline font-bold text-base text-on-surface leading-tight">
                            {site.name}
                          </h3>
                          <span className="font-mono text-xs text-secondary flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-secondary shadow-[0_0_6px_rgba(78,222,163,0.8)]" />
                            {isClean ? '100% Operacional & Blindado' : `${diff} alteração(ões)`}
                          </span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 bg-surface-container-highest rounded text-on-surface-variant font-mono text-[10px]">
                        {site.database ? 'DB + SFTP' : 'SFTP'}
                      </span>
                    </div>

                    {/* Parameters Checklist com Dados Reais */}
                    <div className="flex flex-col gap-1.5 font-mono text-xs mb-4">
                      <div className="flex items-center justify-between p-2 rounded bg-surface-container-lowest">
                        <span className="text-on-surface-variant">Conexão SFTP</span>
                        <span className="text-secondary flex items-center gap-1">
                          <span>{site.files?.monitored || 0} arquivos monitorados</span>
                          <span className="text-secondary font-bold">✓</span>
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded bg-surface-container-lowest">
                        <span className="text-on-surface-variant">Banco Remoto MySQL</span>
                        <span className={site.database ? 'text-secondary' : 'text-outline'}>
                          {site.database ? `${site.database.users || 0} usuário(s) • Conectado` : 'Desativado'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded bg-surface-container-lowest">
                        <span className="text-on-surface-variant">Drop-ins / mu-plugins</span>
                        <span className="text-secondary">
                          {site.files?.muPluginsCount || 0} mu-plugin(s) ativo(s)
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded bg-surface-container-lowest">
                        <span className="text-on-surface-variant">PHP em /uploads/</span>
                        <span className={(site.files?.phpInUploads || 0) > 0 ? 'text-error font-bold' : 'text-secondary'}>
                          {(site.files?.phpInUploads || 0) > 0 ? `${site.files.phpInUploads} arquivo(s)` : '0 (Zero Exec)'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded bg-surface-container-lowest">
                        <span className="text-on-surface-variant">Marcadores de Malware</span>
                        <span className={(site.files?.malwareMarkers || 0) > 0 ? 'text-error font-bold' : 'text-secondary'}>
                          {(site.files?.malwareMarkers || 0) > 0 ? `${site.files.malwareMarkers} detectado(s)` : '0 marcadores'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between p-2 rounded bg-surface-container-lowest">
                        <span className="text-on-surface-variant">Última Varredura</span>
                        <span className="text-on-surface-variant">
                          {site.scannedAt ? new Date(site.scannedAt).toLocaleTimeString('pt-BR') : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions do Card: Ver Logs do Site & Testar */}
                  <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/20">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectSite(site.key);
                        setSearchQuery(site.name);
                      }}
                      className="flex-1 py-1.5 px-3 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-lg font-headline font-semibold text-xs transition-colors text-center cursor-pointer"
                    >
                      Ver Logs do Site
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestSite(site.key)}
                      disabled={testingSiteKey === site.key}
                      title="Testar Conectividade SFTP, MySQL e HTTP/SSL agora"
                      className="flex items-center justify-center p-2 bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary rounded-lg transition-colors cursor-pointer"
                    >
                      <span className={`material-symbols-outlined text-base ${testingSiteKey === site.key ? 'animate-spin' : ''}`}>
                        refresh
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Coluna 4: Painel do Motor (Daemon Engine) */}
        <div className="xl:col-span-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-headline font-bold text-lg text-on-surface">Daemon Engine</h2>
            <span className="font-mono text-xs text-secondary uppercase flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
              Ciclo {monitorCycle}
            </span>
          </div>

          <div className="p-5 bg-surface-container-low border border-outline-variant/30 rounded-xl flex flex-col justify-between flex-1">
            <div>
              {/* Radar Cyber Visual com Mira & Pings */}
              <div className="relative w-full h-44 rounded-lg bg-surface-container-lowest overflow-hidden flex items-center justify-center mb-4 border border-outline-variant/20">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
                {/* Anéis concêntricos */}
                <div className="absolute w-36 h-36 rounded-full border border-outline-variant/30 animate-ping opacity-20" />
                <div className="absolute w-28 h-28 rounded-full border border-tertiary/20" />
                <div className="absolute w-16 h-16 rounded-full border border-secondary/30" />
                {/* Crosshairs */}
                <div className="absolute w-full h-px bg-outline-variant/20" />
                <div className="absolute h-full w-px bg-outline-variant/20" />
                {/* Center Shield */}
                <div className="relative z-10 flex flex-col items-center">
                  <span className="material-symbols-outlined text-3xl text-secondary">verified_user</span>
                  <span className="font-mono text-[10px] text-on-surface mt-1 uppercase font-bold tracking-wider">
                    SENTINEL-CORE
                  </span>
                </div>
                {/* Pings dos sites reais */}
                {sites.map((s, idx) => (
                  <div
                    key={s.key}
                    className={`absolute flex items-center gap-1 ${
                      idx === 0 ? 'top-6 left-8' : 'bottom-6 right-8'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_6px_rgba(78,222,163,0.9)]" />
                    <span className="font-mono text-[9px] text-on-surface-variant font-bold uppercase truncate max-w-[80px]">
                      {s.key}
                    </span>
                  </div>
                ))}
              </div>

              {/* Parâmetros do Motor */}
              <div className="flex flex-col gap-2 font-mono text-xs">
                <div className="flex items-center justify-between text-on-surface-variant">
                  <span>Estado do Motor:</span>
                  <span className="text-secondary font-bold uppercase">{monitorState}</span>
                </div>
                <div className="flex items-center justify-between text-on-surface-variant">
                  <span>Frequência Daemon:</span>
                  <span className="text-on-surface">A cada {Math.round(intervalSeconds / 60)} min ({intervalSeconds}s)</span>
                </div>
                <div className="flex items-center justify-between text-on-surface-variant">
                  <span>Próximo Hash Completo:</span>
                  <span className="text-primary font-bold">Ciclo {nextFullHash} (a cada {fullHashEvery} ciclos)</span>
                </div>
                <div className="flex items-center justify-between text-on-surface-variant">
                  <span>Baseline Confiável:</span>
                  <span className="text-secondary truncate max-w-[170px]">
                    {baselineDate ? new Date(baselineDate).toLocaleDateString('pt-BR') : 'Definida'}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions do Motor */}
            <div className="mt-5 pt-4 border-t border-outline-variant/20 flex flex-col gap-2">
              {monitorState === 'stopped' ? (
                <button
                  type="button"
                  onClick={() => onTriggerMonitor('start')}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-headline font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">play_arrow</span>
                  <span>Ligar Monitor Contínuo</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onTriggerMonitor('stop')}
                  className="w-full py-2 bg-red-600/90 hover:bg-red-500 text-white rounded-lg text-xs font-headline font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">stop</span>
                  <span>Desligar Monitor Contínuo</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Feed de Alertas & Trilha de Auditoria (com filtros Todos, Críticos, Altos, Info e Busca) */}
      <div className="flex flex-col gap-4 bg-surface-container-low border border-outline-variant/30 rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-headline font-bold text-lg text-on-surface">
              Feed de Alertas & Trilha de Auditoria
            </h2>
            <p className="text-xs text-on-surface-variant">
              Eventos catalogados no histórico de integridade ({alerts.length} exibidos)
            </p>
          </div>

          {/* Filtros de Severidade e Escopo */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg border border-outline-variant/30 text-xs font-headline">
              <button
                type="button"
                onClick={() => setSeverityFilter('all')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  severityFilter === 'all'
                    ? 'bg-surface-container-high text-primary font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter('critical')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  severityFilter === 'critical'
                    ? 'bg-error-container text-on-error-container font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Críticos
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter('high')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  severityFilter === 'high'
                    ? 'bg-amber-950/60 text-amber-300 font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Altos
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter('info')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  severityFilter === 'info'
                    ? 'bg-sky-950/60 text-sky-300 font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Info
              </button>
            </div>

            <label className="flex items-center gap-1.5 text-xs font-mono text-on-surface-variant cursor-pointer select-none bg-surface-container-lowest px-2.5 py-1.5 rounded-lg border border-outline-variant/30">
              <input
                type="checkbox"
                checked={onlyPending}
                onChange={(e) => setOnlyPending(e.target.checked)}
                className="rounded bg-surface-container border-outline-variant text-primary"
              />
              <span>Só Pendentes</span>
            </label>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar alerta..."
                className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-2.5 py-1 text-xs font-mono text-on-surface outline-none focus:border-primary w-36 lg:w-48"
              />
            </div>
          </div>
        </div>

        {/* Lista de Alertas */}
        <div className="flex flex-col gap-2 mt-2">
          {alertsLoading ? (
            <div className="p-8 text-center text-xs text-outline font-mono">
              Carregando eventos do histórico...
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-8 text-center text-xs text-outline font-mono bg-surface-container-lowest rounded-lg border border-outline-variant/20">
              Nenhum alerta encontrado para os filtros selecionados. O perímetro está em conformidade.
            </div>
          ) : (
            alerts.map((alert, index) => {
              const isCrit = alert.severity === 'critical';
              const isHigh = alert.severity === 'high';
              const badgeStyle = isCrit
                ? 'bg-error-container text-on-error-container'
                : isHigh
                  ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30'
                  : 'bg-surface-container-high text-on-surface-variant';

              const icon = isCrit
                ? 'pest_control'
                : isHigh
                  ? 'warning'
                  : 'info';

              return (
                <div
                  key={index}
                  onClick={() => setSelectedAlertPayload(alert)}
                  className="p-3.5 bg-surface-container-lowest hover:bg-surface-container rounded-lg border border-outline-variant/20 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg mt-0.5 ${isCrit ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-primary'}`}>
                      <span className="material-symbols-outlined text-lg">{icon}</span>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded ${badgeStyle}`}>
                          {alert.severity}
                        </span>
                        <span className="font-mono text-xs text-primary font-semibold">
                          {alert.siteName}
                        </span>
                        <span className="text-outline text-xs">•</span>
                        <span className="font-mono text-[11px] text-outline">
                          {new Date(alert.timestamp).toLocaleString('pt-BR')}
                        </span>
                        {alert.pending && (
                          <span className="px-1.5 py-0.2 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded text-[9px] font-mono uppercase">
                            Pendente
                          </span>
                        )}
                      </div>

                      <p className="font-body text-xs text-on-surface font-medium leading-relaxed">
                        {alert.message}
                      </p>

                      {alert.context && (
                        <p className="font-mono text-[11px] text-on-surface-variant mt-0.5 truncate max-w-2xl">
                          {alert.context}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <span className="font-mono text-[10px] text-outline hover:text-primary transition-colors flex items-center gap-1">
                      <span>Ver payload</span>
                      <span className="material-symbols-outlined text-sm">chevron_right</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal de Detalhes do Alerta Selecionado */}
      {selectedAlertPayload && (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-surface-container-low border border-outline-variant/40 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 bg-surface-container border-b border-outline-variant/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusBadge status={selectedAlertPayload.severity} label={selectedAlertPayload.severity} />
                <span className="font-headline font-semibold text-sm text-on-surface">
                  {selectedAlertPayload.siteName} — {selectedAlertPayload.message}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAlertPayload(null)}
                className="text-on-surface-variant hover:text-on-surface p-1"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="p-5 overflow-y-auto max-h-[480px] flex flex-col gap-3 font-mono text-xs">
              <div className="flex justify-between text-outline border-b border-outline-variant/20 pb-2">
                <span>Timestamp:</span>
                <span className="text-on-surface">{selectedAlertPayload.timestamp}</span>
              </div>
              <div className="flex justify-between text-outline border-b border-outline-variant/20 pb-2">
                <span>Site Key:</span>
                <span className="text-on-surface">{selectedAlertPayload.site}</span>
              </div>

              <div>
                <span className="text-outline uppercase block mb-1">Detalhes Criptográficos (details):</span>
                <pre className="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-[11px] text-emerald-300 overflow-x-auto leading-relaxed">
                  {JSON.stringify(selectedAlertPayload.details || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="px-5 py-3 bg-surface-container border-t border-outline-variant/30 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedAlertPayload(null)}
                className="px-4 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold text-on-surface"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Teste de Conectividade do Site */}
      {testResult && (
        <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-surface-container-low border border-primary/40 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 bg-surface-container border-b border-outline-variant/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">network_check</span>
                <h3 className="font-headline font-bold text-sm text-on-surface">
                  Diagnóstico de Conectividade: {testResult.siteName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTestResult(null)}
                className="text-on-surface-variant hover:text-on-surface p-1"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="p-5 flex flex-col gap-3 font-mono text-xs">
              {testResult.error ? (
                <div className="p-3 bg-error-container/20 text-error rounded-lg">
                  {testResult.error}
                </div>
              ) : (
                <>
                  {/* SFTP */}
                  <div className="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-on-surface block">SFTP (Porta {testResult.sftp?.port || 22})</span>
                      <span className="text-[11px] text-outline">{testResult.sftp?.host}</span>
                    </div>
                    <div className="text-right">
                      <span className={testResult.sftp?.ok ? 'text-secondary font-bold' : 'text-error font-bold'}>
                        {testResult.sftp?.ok ? `OK (${testResult.sftp.latencyMs}ms)` : 'Falha'}
                      </span>
                      {testResult.sftp?.error && (
                        <span className="block text-[10px] text-error">{testResult.sftp.error}</span>
                      )}
                    </div>
                  </div>

                  {/* MySQL */}
                  <div className="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-on-surface block">MySQL Remoto</span>
                      <span className="text-[11px] text-outline">
                        {testResult.mysql?.enabled ? `${testResult.mysql.host}:${testResult.mysql.port}` : 'Desativado'}
                      </span>
                    </div>
                    <div className="text-right">
                      {testResult.mysql?.enabled ? (
                        <span className={testResult.mysql.ok ? 'text-secondary font-bold' : 'text-error font-bold'}>
                          {testResult.mysql.ok ? `OK (${testResult.mysql.latencyMs}ms)` : 'Falha'}
                        </span>
                      ) : (
                        <span className="text-outline">Não configurado</span>
                      )}
                      {testResult.mysql?.error && (
                        <span className="block text-[10px] text-error">{testResult.mysql.error}</span>
                      )}
                    </div>
                  </div>

                  {/* HTTP & SSL */}
                  <div className="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-on-surface block">HTTP / HTTPS</span>
                      <span className="text-[11px] text-outline">Status {testResult.http?.statusCode || '—'}</span>
                    </div>
                    <div className="text-right">
                      <span className={testResult.http?.ok ? 'text-secondary font-bold' : 'text-error font-bold'}>
                        {testResult.http?.ok ? `OK (${testResult.http.latencyMs}ms)` : 'Falha'}
                      </span>
                    </div>
                  </div>

                  {testResult.http?.ssl && (
                    <div className="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 flex flex-col gap-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-outline">Certificado SSL:</span>
                        <span className={testResult.http.ssl.valid ? 'text-secondary font-bold' : 'text-error font-bold'}>
                          {testResult.http.ssl.valid ? `Válido (${testResult.http.ssl.daysRemaining} dias)` : 'Expirado'}
                        </span>
                      </div>
                      <div className="flex justify-between text-outline">
                        <span>Emissor:</span>
                        <span className="text-on-surface">{testResult.http.ssl.issuer}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 bg-surface-container border-t border-outline-variant/30 flex justify-end">
              <button
                type="button"
                onClick={() => setTestResult(null)}
                className="px-4 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
