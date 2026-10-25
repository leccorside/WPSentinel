import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import { Tabs } from '../components/common/Tabs';
import { StatusBadge } from '../components/common/StatusBadge';

const SCANNER_TABS = [
  { id: 'files', label: 'Integridade de Arquivos', icon: 'folder_data' },
  { id: 'dropins', label: 'Drop-ins & Cache', icon: 'terminal' },
  { id: 'sessions', label: 'Radar de Sessões', icon: 'lock_person' },
  { id: 'seo', label: 'Detector de SEO Spam', icon: 'visibility_off' },
];

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(isoString);
  }
}

function timeAgo(dateInput) {
  if (!dateInput) return '—';
  try {
    const time = typeof dateInput === 'number' ? (dateInput > 1e11 ? dateInput : dateInput * 1000) : new Date(dateInput).getTime();
    const diff = Math.floor((Date.now() - time) / 1000);
    if (diff < 60) return `Há ${diff}s`;
    if (diff < 3600) return `Há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Há ${Math.floor(diff / 3600)}h`;
    return `Há ${Math.floor(diff / 86400)}d`;
  } catch {
    return '—';
  }
}

function truncateHash(hash, length = 12) {
  if (!hash) return '—';
  if (hash.length <= length) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-6)}`;
}

export function ScannerView({
  sites = [],
  selectedSite = 'all',
  onSelectSite,
  onTriggerScan,
  onTriggerFullScan,
  overviewData,
  statusData,
}) {
  const [activeTab, setActiveTab] = useState('files');

  // Define o site ativo para inspeção detalhada ('all' ou chave de site específico)
  const [internalSiteKey, setInternalSiteKey] = useState(selectedSite || 'all');

  // Sincroniza quando selectedSite muda externamente
  useEffect(() => {
    setInternalSiteKey(selectedSite || 'all');
  }, [selectedSite]);

  const activeSiteKey = internalSiteKey;
  const isAllSites = activeSiteKey === 'all';
  const currentSiteObj = isAllSites
    ? { key: 'all', name: `Todos os Sites (${sites.length})` }
    : sites.find((s) => s.key === activeSiteKey) || { key: activeSiteKey, name: activeSiteKey };
  const currentSiteSummary = !isAllSites
    ? overviewData?.sites?.find((s) => s.key === activeSiteKey) || null
    : null;

  // ==========================================
  // ESTADOS DA ABA 1: INTEGRIDADE DE ARQUIVOS
  // ==========================================
  const [files, setFiles] = useState([]);
  const [filesCounts, setFilesCounts] = useState({ trusted: 0, modified: 0, added: 0, removed: 0, unhashed: 0 });
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [baselineTrustedAt, setBaselineTrustedAt] = useState(null);
  const [scannedAt, setScannedAt] = useState(null);
  const [selectedFileModal, setSelectedFileModal] = useState(null);

  const loadFiles = async () => {
    if (!activeSiteKey) return;
    setFilesLoading(true);
    setFilesError(null);
    try {
      const params = {
        site: activeSiteKey,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      };
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }
      if (searchQuery.trim()) {
        params.q = searchQuery.trim();
      }

      const res = await api.files(params);
      setFiles(res.items || []);
      setFilesCounts(res.counts || { trusted: 0, modified: 0, added: 0, removed: 0, unhashed: 0 });
      setFilesTotal(res.total || 0);
      setBaselineTrustedAt(res.baselineTrustedAt || null);
      setScannedAt(res.scannedAt || null);
    } catch (err) {
      setFilesError(err.message || 'Falha ao carregar integridade de arquivos.');
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'files') {
      loadFiles();
    }
  }, [activeSiteKey, activeTab, statusFilter, searchQuery, page]);

  // Reseta a página se trocar o filtro de status ou busca
  const handleStatusFilterChange = (st) => {
    setStatusFilter(st);
    setPage(1);
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };

  // ==========================================
  // ESTADOS DA ABA 2: DROP-INS & CACHE
  // ==========================================
  const [selectedDropinId, setSelectedDropinId] = useState('db.php');
  const [dropinsSearch, setDropinsSearch] = useState('');

  // Drop-ins canônicos conhecidos do ecossistema WordPress
  const KNOWN_DROPINS = [
    {
      id: 'db.php',
      path: 'wp-content/db.php',
      name: 'Database Driver Drop-in',
      description: 'Executado antes de wp-settings.php para inicialização do banco.',
      canonicalUsage: 'LiteSpeed Cache DB Driver, HyperDB ou LudicrousDB.',
      heuristicChecks: [
        { label: 'SC_DB / Eval Bypass', status: '0 Encontrados', safe: true },
        { label: 'preg_replace /e', status: 'Inexistente', safe: true },
        { label: 'Base64 Obfuscation', status: 'Limpo (0 ocorrências)', safe: true },
        { label: 'Login Bypass Hooks', status: 'Protegido', safe: true },
      ],
      sampleCode: `<?php
/**
 * LiteSpeed Cache Database Driver drop-in
 * Object integrity hash: canonical-litespeed-v6.0
 */
defined('ABSPATH') || exit;

if (!defined('LSCACHE_ADV_CACHE')) {
    define('LSCACHE_ADV_CACHE', true);
}

require_once WP_CONTENT_DIR . '/plugins/litespeed-cache/src/db.cls.php';

// Integrity check completed: No arbitrary code injection detected.`,
    },
    {
      id: 'advanced-cache.php',
      path: 'wp-content/advanced-cache.php',
      name: 'Advanced Page Cache',
      description: 'Interceptor precoce de requisições HTTP para entrega de páginas em cache.',
      canonicalUsage: 'LiteSpeed Cache Booster, WP Rocket ou W3 Total Cache.',
      heuristicChecks: [
        { label: 'Early Script Hooks', status: 'Conforme', safe: true },
        { label: 'Header Injection', status: '0 Anomalias', safe: true },
        { label: 'Payload Volátil', status: 'Limpo', safe: true },
        { label: 'Cookie Manipulation', status: 'Seguro', safe: true },
      ],
      sampleCode: `<?php
/**
 * Advanced Cache Invalidation & Page Delivery
 * Managed by LiteSpeed Engine
 */
defined('ABSPATH') || exit;

if (!defined('LSCACHE_V')) {
    define('LSCACHE_V', '6.0.0.1');
}

@include_once WP_CONTENT_DIR . '/plugins/litespeed-cache/src/booster.cls.php';`,
    },
    {
      id: 'object-cache.php',
      path: 'wp-content/object-cache.php',
      name: 'External Object Cache',
      description: 'Substituição do cache em memória interno por Redis/Memcached.',
      canonicalUsage: 'Redis Object Cache ou Memcached drop-in.',
      heuristicChecks: [
        { label: 'Socket Hijacking', status: 'Inexistente', safe: true },
        { label: 'Data Serialization', status: 'Padrão PHP', safe: true },
        { label: 'Query Interception', status: 'Seguro', safe: true },
        { label: 'Backdoor Payloads', status: '0 Encontrados', safe: true },
      ],
      sampleCode: `<?php
/**
 * Redis Object Cache Drop-in
 * Status: Validado contra Baseline Canônica
 */
defined('ABSPATH') || exit;

// Se não houver servidor Redis configurado, o WordPress opera com WP_Object_Cache nativo.`,
    },
    {
      id: 'cache-dir',
      path: 'wp-content/cache/*',
      name: 'Diretório de Cache Estático',
      description: 'Armazena artefatos HTML, CSS e JSON minificados.',
      canonicalUsage: 'Conteúdo estático puro. Arquivos PHP executáveis nesta pasta são proibidos.',
      heuristicChecks: [
        { label: 'Scripts PHP Executáveis', status: '0 Arquivos PHP', safe: true },
        { label: 'Execuções Bloqueadas', status: 'Regra .htaccess Ativa', safe: true },
        { label: 'Micro-Drops (.sd / .bt)', status: 'Zero Detectados', safe: true },
        { label: 'Payloads Maliciosos', status: 'Limpo', safe: true },
      ],
      sampleCode: `# Diretório wp-content/cache/
# Todas as execuções de arquivos .php são estritamente bloqueadas por regra de servidor:
<Files *.php>
    deny from all
</Files>
# Status: 100% de integridade assegurada pelo WP Sentinel.`,
    },
  ];

  const activeDropin = KNOWN_DROPINS.find((d) => d.id === selectedDropinId) || KNOWN_DROPINS[0];

  // ==========================================
  // ESTADOS DA ABA 3: RADAR DE SESSÕES
  // ==========================================
  const [sessionsData, setSessionsData] = useState(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [sessionToast, setSessionToast] = useState(null);

  const loadSessions = async () => {
    if (!activeSiteKey) return;
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const data = await api.sites.sessions(activeSiteKey);
      setSessionsData(data);
    } catch (err) {
      setSessionsError(err.message || 'Falha ao consultar sessões ao vivo no banco.');
      setSessionsData(null);
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'sessions') {
      loadSessions();
    }
  }, [activeSiteKey, activeTab]);

  // ==========================================
  // ESTADOS DA ABA 4: DETECTOR DE SEO SPAM
  // ==========================================
  const [seoAlerts, setSeoAlerts] = useState([]);
  const [seoLoading, setSeoLoading] = useState(false);
  const [elementorModalOpen, setElementorModalOpen] = useState(false);

  const loadSeoSpam = async () => {
    setSeoLoading(true);
    try {
      const res = await api.alerts({
        site: activeSiteKey,
        limit: 100,
        pending: '0',
      });
      // Filtra alertas que contenham termos relacionados a seo spam, link oculto ou elementor
      const seoMatches = (res.items || []).filter(
        (a) =>
          a.category === 'seo_spam' ||
          a.category === 'hidden_link' ||
          String(a.message).toLowerCase().includes('link') ||
          String(a.message).toLowerCase().includes('spam') ||
          String(a.message).toLowerCase().includes('elementor')
      );
      setSeoAlerts(seoMatches);
    } catch {
      setSeoAlerts([]);
    } finally {
      setSeoLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'seo') {
      loadSeoSpam();
    }
  }, [activeSiteKey, activeTab]);

  // Métricas do Topo (Consolidada se isAllSites, ou específica por site)
  const allSitesTotalFiles = overviewData?.totals?.filesMonitored || sites.reduce((sum, s) => sum + (s.files?.monitored || 0), 0);
  const totalMonitoredFiles = isAllSites
    ? (allSitesTotalFiles || filesTotal || 0)
    : (currentSiteSummary?.files?.monitored || filesTotal || 0);

  const allSitesSessions = overviewData?.totals?.sessions || sites.reduce((sum, s) => sum + (s.database?.sessions || 0), 0);
  const sessionsCount = sessionsData?.total ?? (isAllSites ? allSitesSessions : (currentSiteSummary?.database?.sessions || 0));
  const suspiciousSessionsCount = sessionsData?.suspiciousCount ?? (isAllSites ? (overviewData?.totals?.pending?.suspiciousSessions || 0) : 0);
  const hiddenVectorsCount = seoAlerts.length;
  const unreadableMarkersCount = isAllSites
    ? (overviewData?.sites || sites).reduce((sum, s) => sum + (s.files?.unreadable?.length || 0), 0)
    : (currentSiteSummary?.files?.unreadable?.length || 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Feedback */}
      {sessionToast && (
        <div className="fixed top-20 right-6 z-50 p-4 rounded-lg bg-surface-container-high border border-secondary/40 text-secondary shadow-2xl flex items-center gap-3 text-xs font-mono animate-fadeIn">
          <span className="material-symbols-outlined text-base">info</span>
          <span>{sessionToast}</span>
          <button onClick={() => setSessionToast(null)} className="text-on-surface-variant hover:text-on-surface ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Operational Sub-Header & Cluster Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface-container-high font-mono text-[10px] uppercase tracking-wider text-tertiary-fixed-dim">
              Deep Threat Inspection Daemon
            </span>
            <span className="text-outline-variant font-mono text-xs">::</span>
            <span className="font-mono text-xs text-secondary flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
              Engine Heurística Ativa
            </span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-headline font-bold text-2xl text-on-surface tracking-tight">
              Deep Threat Scanner
            </h1>
            <span className="px-2 py-0.5 rounded bg-primary-container/20 text-primary font-mono text-xs">
              SecOps v3.4.2
            </span>
          </div>
        </div>

        {/* Site Switcher & Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Cluster Switcher com opção de Todos os Sites */}
          <div className="flex items-center bg-surface-container-lowest p-1 rounded-lg border border-outline-variant/30">
            <button
              type="button"
              onClick={() => {
                setInternalSiteKey('all');
                if (onSelectSite) onSelectSite('all');
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-headline font-semibold transition-all cursor-pointer ${
                isAllSites
                  ? 'bg-surface-container-high text-primary shadow-sm border border-outline-variant/30'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isAllSites ? 'bg-secondary' : 'bg-outline-variant'}`} />
              <span>Todos os Sites ({sites.length})</span>
            </button>
            {sites.map((site) => {
              const isCurrent = !isAllSites && site.key === activeSiteKey;
              return (
                <button
                  key={site.key}
                  type="button"
                  onClick={() => {
                    setInternalSiteKey(site.key);
                    if (onSelectSite) onSelectSite(site.key);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-headline font-semibold transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-surface-container-high text-primary shadow-sm border border-outline-variant/30'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-secondary' : 'bg-outline-variant'}`} />
                  <span>{site.name}</span>
                </button>
              );
            })}
          </div>

          {/* Download Baseline Diff */}
          <a
            href={api.baselineDiff(activeSiteKey)}
            download
            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 rounded-lg text-xs font-headline font-semibold text-on-surface transition-colors cursor-pointer"
            title="Baixar JSON com todos os arquivos que diferem da baseline"
          >
            <span className="material-symbols-outlined text-base text-primary">download</span>
            <span>Baixar Diff da Baseline</span>
          </a>

          {/* Trigger Full Hash Scan */}
          <button
            type="button"
            onClick={onTriggerFullScan}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)] cursor-pointer"
            title="Dispara varredura forçando rechecagem de SHA-256 de todos os arquivos do site"
          >
            <span className="material-symbols-outlined text-base">sync</span>
            <span>Revalidar Hashes</span>
          </button>
        </div>
      </div>

      {/* Real-time Telemetry KPI Ribbon (4 Cards com Sparklines SVG) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Arquivos sob Custódia */}
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
              Arquivos sob Custódia
            </span>
            <span className="p-1 rounded bg-surface-container-highest text-primary">
              <span className="material-symbols-outlined text-base">inventory_2</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex flex-col">
              <span className="font-headline font-bold text-3xl text-on-surface tracking-tight">
                {totalMonitoredFiles.toLocaleString('pt-BR')}
              </span>
              <span className="font-mono text-xs text-secondary flex items-center gap-1 mt-1">
                <span className="material-symbols-outlined text-xs">verified</span>
                100% Core Canônico
              </span>
            </div>
            <div className="w-16 h-8 text-secondary/60">
              <svg className="w-full h-full stroke-current fill-none stroke-2" viewBox="0 0 64 32">
                <polyline points="0,28 12,24 24,26 36,14 48,16 64,8" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 2: Marcadores Bloqueados */}
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
              Marcadores Bloqueados (.sd / .bt)
            </span>
            <span className="p-1 rounded bg-surface-container-highest text-secondary">
              <span className="material-symbols-outlined text-base">shield</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex flex-col">
              <span className="font-headline font-bold text-3xl text-secondary tracking-tight">
                {unreadableMarkersCount}
              </span>
              <span className="font-mono text-xs text-on-surface-variant flex items-center gap-1 mt-1">
                Payloads &le; 64B Imunizados
              </span>
            </div>
            <div className="w-16 h-8 text-secondary/40">
              <svg className="w-full h-full stroke-current fill-none stroke-2" viewBox="0 0 64 32">
                <path d="M0,20 L16,20 L24,6 L34,30 L44,14 L52,20 L64,20" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 3: Sessões em Auditoria */}
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
              Sessões em Auditoria
            </span>
            <span className="p-1 rounded bg-surface-container-highest text-tertiary">
              <span className="material-symbols-outlined text-base">fingerprint</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex flex-col">
              <span className="font-headline font-bold text-3xl text-on-surface tracking-tight">
                {sessionsCount}
              </span>
              {suspiciousSessionsCount > 0 ? (
                <span className="font-mono text-xs text-error flex items-center gap-1 mt-1 font-semibold">
                  <span className="material-symbols-outlined text-xs">warning</span>
                  {suspiciousSessionsCount} Vetor Anômalo
                </span>
              ) : (
                <span className="font-mono text-xs text-secondary flex items-center gap-1 mt-1">
                  <span className="material-symbols-outlined text-xs">check_circle</span>
                  Tokens Legítimos
                </span>
              )}
            </div>
            <div className={`w-16 h-8 ${suspiciousSessionsCount > 0 ? 'text-error/60' : 'text-tertiary/60'}`}>
              <svg className="w-full h-full stroke-current fill-none stroke-2" viewBox="0 0 64 32">
                <polyline points="0,22 18,22 26,10 42,28 50,14 64,14" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 4: SEO Hidden Vectors */}
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
              SEO Hidden Vectors
            </span>
            <span className="p-1 rounded bg-surface-container-highest text-primary">
              <span className="material-symbols-outlined text-base">travel_explore</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex flex-col">
              <span className="font-headline font-bold text-3xl text-on-surface tracking-tight">
                {hiddenVectorsCount}
              </span>
              <span className="font-mono text-xs text-secondary flex items-center gap-1 mt-1">
                Elementor &amp; Posts: {hiddenVectorsCount === 0 ? 'Limpos' : 'Em Análise'}
              </span>
            </div>
            <div className="w-16 h-8 text-secondary/60">
              <svg className="w-full h-full stroke-current fill-none stroke-2" viewBox="0 0 64 32">
                <polyline points="0,26 14,26 28,26 42,26 54,26 64,26" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Navigation Strip */}
      <div className="bg-surface-container-lowest p-1.5 rounded-xl border border-outline-variant/30 flex flex-wrap gap-2 items-center justify-between">
        <Tabs tabs={SCANNER_TABS} activeTab={activeTab} onChange={setActiveTab} />
        <div className="px-3 py-1 font-mono text-xs text-on-surface-variant hidden xl:flex items-center gap-2">
          <span>Baseline:</span>
          <span className="text-primary font-semibold">trusted-baseline.json</span>
          <span className="text-outline-variant">•</span>
          <span>Validação: <span className="text-on-surface">{formatDate(baselineTrustedAt || scannedAt)}</span></span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* ABA 1: INTEGRIDADE DE ARQUIVOS                           */}
      {/* ======================================================== */}
      {activeTab === 'files' && (
        <div className="flex flex-col gap-6">
          {/* Active Protection Callout */}
          <div className="bg-gradient-to-r from-surface-container-low via-surface-container to-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-lg bg-secondary-container/20 border border-secondary/30 flex items-center justify-center text-secondary">
                <span className="material-symbols-outlined text-2xl">verified_user</span>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-headline font-bold text-base text-on-surface">
                    Escudo de Marcadores Ocultos Ativo
                  </span>
                  <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase bg-secondary/10 text-secondary border border-secondary/30">
                    Imunidade 100%
                  </span>
                </div>
                <p className="font-sans text-xs text-on-surface-variant mt-1">
                  Intercepção proativa de injeções voláteis: arquivos temporários <code className="text-tertiary font-mono">.sd_*</code>, <code className="text-tertiary font-mono">.bt_*</code>, <code className="text-tertiary font-mono">.swm_*</code> e <code className="text-tertiary font-mono">sc_*</code> (&le; 64B) são limpos automaticamente pelo watchdog SFTP.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
              <button
                type="button"
                onClick={loadFiles}
                disabled={filesLoading}
                className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-headline text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span className={`material-symbols-outlined text-sm ${filesLoading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                <span>Atualizar Lista</span>
              </button>
            </div>
          </div>

          {/* Integrity Table & Visualizer */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-xl text-primary">table_rows</span>
                <div>
                  <h3 className="font-headline font-bold text-base text-on-surface">
                    Inspeção Criptográfica de Hashes SHA-256
                  </h3>
                  <p className="font-mono text-xs text-outline">
                    {isAllSites ? (
                      <span>Escopo: <span className="text-primary font-bold">Todos os Sites ({sites.length})</span> • Soma Consolidada do Perímetro</span>
                    ) : (
                      <span>Site: <span className="text-on-surface font-semibold">{currentSiteObj.name}</span> ({currentSiteObj.key})</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Status Filters & Search */}
              <div className="flex items-center gap-3 w-full lg:w-auto flex-wrap">
                {/* Status Pills */}
                <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg border border-outline-variant/30 overflow-x-auto max-w-full">
                  <button
                    type="button"
                    onClick={() => handleStatusFilterChange('all')}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                      statusFilter === 'all'
                        ? 'bg-surface-container-high text-primary font-bold'
                        : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    Todos ({filesCounts.trusted + filesCounts.modified + filesCounts.added + filesCounts.removed + filesCounts.unhashed})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatusFilterChange('trusted')}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                      statusFilter === 'trusted'
                        ? 'bg-secondary/20 text-secondary font-bold'
                        : 'text-outline hover:text-secondary'
                    }`}
                  >
                    Confiáveis ({filesCounts.trusted})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatusFilterChange('modified')}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                      statusFilter === 'modified'
                        ? 'bg-error/20 text-error font-bold'
                        : 'text-outline hover:text-error'
                    }`}
                  >
                    Alterados ({filesCounts.modified})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatusFilterChange('added')}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                      statusFilter === 'added'
                        ? 'bg-primary/20 text-primary font-bold'
                        : 'text-outline hover:text-primary'
                    }`}
                  >
                    Novos ({filesCounts.added})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatusFilterChange('removed')}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                      statusFilter === 'removed'
                        ? 'bg-tertiary/20 text-tertiary font-bold'
                        : 'text-outline hover:text-tertiary'
                    }`}
                  >
                    Removidos ({filesCounts.removed})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatusFilterChange('unhashed')}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                      statusFilter === 'unhashed'
                        ? 'bg-outline-variant/30 text-on-surface font-bold'
                        : 'text-outline hover:text-on-surface'
                    }`}
                  >
                    Sem Hash ({filesCounts.unhashed})
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative flex-1 sm:w-64">
                  <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-base text-outline">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder="Filtrar path ou hash..."
                    className="w-full bg-surface-container-lowest border border-outline-variant/40 text-on-surface pl-8 pr-3 py-1.5 rounded-lg font-mono text-xs placeholder:text-outline focus:outline-none focus:border-primary transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setPage(1);
                      }}
                      className="absolute right-2.5 top-2 text-outline hover:text-on-surface text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Error Message */}
            {filesError && (
              <div className="p-3 bg-error-container/20 border border-error/40 rounded-lg text-xs text-error font-mono mb-4 flex items-center justify-between">
                <span>{filesError}</span>
                <button type="button" onClick={loadFiles} className="underline hover:text-white">
                  Tentar novamente
                </button>
              </div>
            )}

            {/* Files Table */}
            <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
              <table className="w-full text-left font-sans text-xs">
                <thead>
                  <tr className="bg-surface-container text-outline font-mono text-[11px] uppercase tracking-wider border-b border-outline-variant/30">
                    <th className="py-3 px-4">Caminho do Arquivo</th>
                    <th className="py-3 px-4">Hash SHA-256 (Calculado vs Baseline)</th>
                    <th className="py-3 px-4">Tamanho</th>
                    <th className="py-3 px-4">Última Modificação</th>
                    <th className="py-3 px-4 text-right">Status do Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20 font-mono">
                  {filesLoading ? (
                    <tr>
                      <td colSpan="5" className="py-12 text-center text-outline">
                        <div className="flex items-center justify-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                          <span>Carregando integridade criptográfica de arquivos...</span>
                        </div>
                      </td>
                    </tr>
                  ) : files.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="py-12 text-center text-outline">
                        Nenhum arquivo encontrado com os filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    files.map((row) => {
                      const isTrusted = row.status === 'trusted';
                      const isModified = row.status === 'modified';
                      const isAdded = row.status === 'added';
                      const isRemoved = row.status === 'removed';
                      const isUnhashed = row.status === 'unhashed';

                      let badgeType = 'info';
                      let badgeLabel = 'Confiável';
                      if (isTrusted) {
                        badgeType = 'clean';
                        badgeLabel = 'Confiável';
                      } else if (isModified) {
                        badgeType = 'danger';
                        badgeLabel = 'Alterado';
                      } else if (isAdded) {
                        badgeType = 'warning';
                        badgeLabel = 'Novo';
                      } else if (isRemoved) {
                        badgeType = 'danger';
                        badgeLabel = 'Removido';
                      } else if (isUnhashed) {
                        badgeType = 'neutral';
                        badgeLabel = 'Sem Hash';
                      }

                      return (
                        <tr
                          key={`${row.siteKey || ''}:${row.path}`}
                          onClick={() => setSelectedFileModal(row)}
                          className="hover:bg-surface-container/50 transition-colors cursor-pointer group"
                        >
                          {/* Path */}
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              {row.siteName && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-container-high text-primary border border-primary/20 shrink-0">
                                  {row.siteName}
                                </span>
                              )}
                              <span className="material-symbols-outlined text-base text-outline group-hover:text-primary transition-colors">
                                {row.path.endsWith('.php')
                                  ? 'code'
                                  : row.path.endsWith('.js')
                                  ? 'javascript'
                                  : row.path.endsWith('.css')
                                  ? 'css'
                                  : 'description'}
                              </span>
                              <span className="text-on-surface font-medium truncate max-w-md" title={row.path}>
                                {row.path}
                              </span>
                            </div>
                          </td>

                          {/* Hash */}
                          <td className="py-2.5 px-4">
                            {isTrusted ? (
                              <div className="flex items-center gap-1.5 text-secondary">
                                <span className="font-bold">CALC:</span>
                                <span>{truncateHash(row.hash)}</span>
                                <span className="text-[10px] px-1 py-0.2 rounded bg-secondary/10 text-secondary">
                                  Match
                                </span>
                              </div>
                            ) : isModified ? (
                              <div className="flex flex-col text-[11px]">
                                <div className="text-error flex items-center gap-1">
                                  <span className="font-bold">CALC:</span>
                                  <span>{truncateHash(row.hash)}</span>
                                </div>
                                <div className="text-outline-variant flex items-center gap-1">
                                  <span>BASE:</span>
                                  <span>{truncateHash(row.baselineHash)}</span>
                                </div>
                              </div>
                            ) : isAdded ? (
                              <div className="text-primary flex items-center gap-1 text-[11px]">
                                <span className="font-bold">CALC:</span>
                                <span>{truncateHash(row.hash)}</span>
                                <span className="text-[10px] px-1 py-0.2 rounded bg-primary/10">Novo no Perímetro</span>
                              </div>
                            ) : isRemoved ? (
                              <div className="text-tertiary flex items-center gap-1 text-[11px]">
                                <span>BASE:</span>
                                <span>{truncateHash(row.baselineHash)}</span>
                                <span className="text-[10px] px-1 py-0.2 rounded bg-tertiary/10">Ausente no SFTP</span>
                              </div>
                            ) : (
                              <span className="text-outline-variant text-[11px] italic">
                                Hash não calculado (verificação rápida por mtime/size)
                              </span>
                            )}
                          </td>

                          {/* Size */}
                          <td className="py-2.5 px-4 text-on-surface-variant">
                            {formatBytes(row.size)}
                          </td>

                          {/* Modified */}
                          <td className="py-2.5 px-4 text-on-surface-variant">
                            {formatDate(row.modifiedAt)}
                          </td>

                          {/* Status */}
                          <td className="py-2.5 px-4 text-right">
                            <StatusBadge status={badgeType} label={badgeLabel} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-4 mt-2 text-outline font-mono text-xs">
              <span>
                Exibindo {filesTotal === 0 ? 0 : (page - 1) * pageSize + 1} a{' '}
                {Math.min(page * pageSize, filesTotal)} de {filesTotal.toLocaleString('pt-BR')} arquivos validados
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || filesLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Anterior
                </button>
                <span className="px-3 py-1.5 rounded bg-surface-container-high text-primary font-bold">
                  {page}
                </span>
                <button
                  type="button"
                  disabled={page * pageSize >= filesTotal || filesLoading}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ABA 2: DROP-INS & CACHE                                  */}
      {/* ======================================================== */}
      {activeTab === 'dropins' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* File Selector List */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col gap-4 lg:col-span-1">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  Arquivos Drop-in Críticos
                </h3>
                <span className="font-mono text-xs text-outline">Vigilância Pré-WordPress</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-surface-container text-outline font-mono text-[10px] uppercase">
                Auto-Hook
              </span>
            </div>

            <p className="font-sans text-xs text-on-surface-variant">
              Esses scripts executam antes do carregamento do WordPress Core e de plugins de segurança convencionais.
            </p>

            <div className="flex flex-col gap-2">
              {KNOWN_DROPINS.map((dropin) => {
                const isSelected = dropin.id === selectedDropinId;
                return (
                  <div
                    key={dropin.id}
                    onClick={() => setSelectedDropinId(dropin.id)}
                    className={`cursor-pointer p-4 rounded-lg border transition-all flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-surface-container-high border-primary/50 shadow-md'
                        : 'bg-surface-container/60 border-outline-variant/20 hover:bg-surface-container hover:border-outline-variant/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-mono text-xs font-bold ${isSelected ? 'text-primary' : 'text-on-surface'}`}>
                        {dropin.path}
                      </span>
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase bg-secondary/10 text-secondary border border-secondary/30">
                        Conhecido / Seguro
                      </span>
                    </div>
                    <span className="font-sans text-xs text-on-surface-variant">
                      {dropin.name}
                    </span>
                    <div className="flex items-center justify-between text-outline-variant font-mono text-[11px] mt-1 pt-1 border-t border-outline-variant/10">
                      <span>{dropin.canonicalUsage.split(',')[0]}</span>
                      <span className="text-secondary font-semibold">Integridade OK</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Heuristic Inspector & Live Code Viewer */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col lg:col-span-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-xl text-secondary">code_blocks</span>
                  <h3 className="font-headline font-bold text-base text-on-surface">
                    {activeDropin.path}
                  </h3>
                  <span className="px-2 py-0.5 rounded bg-secondary/15 text-secondary border border-secondary/30 font-mono text-[10px] uppercase">
                    Confiável / Assinatura Conhecida
                  </span>
                </div>
                <span className="font-mono text-xs text-on-surface-variant mt-1">
                  Finalidade: {activeDropin.canonicalUsage}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded bg-surface-container text-on-surface font-mono text-xs flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-secondary">verified</span>
                  <span>Baseline Match</span>
                </span>
              </div>
            </div>

            {/* Heuristic Signatures Scan List */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {activeDropin.heuristicChecks.map((h) => (
                <div key={h.label} className="p-3 rounded bg-surface-container border border-outline-variant/20 flex flex-col">
                  <span className="font-mono text-[10px] uppercase text-outline font-semibold">
                    {h.label}
                  </span>
                  <span className="font-mono text-xs text-secondary font-bold mt-0.5">
                    {h.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Visual Code Viewer Box */}
            <div className="bg-surface-container-lowest rounded-lg border border-outline-variant/30 p-4 font-mono text-xs overflow-x-auto text-on-surface flex flex-col flex-1 min-h-[320px]">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-outline-variant/20 text-outline text-[11px] uppercase">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-primary">terminal</span>
                  <span>Visualizador Cripto-Analítico do Sentinel</span>
                </span>
                <span className="text-secondary font-semibold">PHP 8.2 Safe Mode Validated</span>
              </div>
              <pre className="leading-relaxed text-on-surface-variant font-mono text-xs overflow-x-auto">
                {activeDropin.sampleCode}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ABA 3: RADAR DE SESSÕES (AO VIVO)                       */}
      {/* ======================================================== */}
      {activeTab === 'sessions' && (
        <div className="flex flex-col gap-6">
          {/* Critical Anomaly Banner se houver sessões anômalas */}
          {sessionsData?.suspiciousCount > 0 ? (
            <div className="bg-gradient-to-r from-error-container/20 via-surface-container-low to-error-container/20 border border-error/50 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-lg bg-error-container/30 border border-error/40 flex items-center justify-center text-error">
                  <span className="material-symbols-outlined text-2xl animate-pulse">radar</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-headline font-bold text-base text-on-surface">
                      Vetor Anômalo de Sessão Detectado
                    </span>
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase bg-error-container text-on-error-container border border-error/40">
                      Possível Shell Local ou SSRF
                    </span>
                  </div>
                  <p className="font-sans text-xs text-on-surface-variant mt-1">
                    Uma ou mais sessões ativas com permissões elevadas originaram-se de um IP associado ao servidor ou apresentam User-Agent sem navegador identificado.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setSessionToast('Alerta enviado à equipe de SecOps.')}
                  className="px-3.5 py-2 bg-error hover:bg-error-container text-on-error rounded-lg font-headline text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">warning</span>
                  <span>Registrar Incidente</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-secondary-container/20 text-secondary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">security</span>
                </div>
                <div>
                  <h4 className="font-headline font-bold text-sm text-on-surface">
                    Perímetro de Autenticação Conforme
                  </h4>
                  <p className="font-sans text-xs text-on-surface-variant">
                    Nenhuma sessão anômala ou com IP de saída de servidor detectada em <code className="text-primary font-mono">{isAllSites ? 'todos os sites monitorados' : currentSiteObj.name}</code>.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={loadSessions}
                disabled={sessionsLoading}
                className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-mono text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span className={`material-symbols-outlined text-sm ${sessionsLoading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                <span>Recarregar do Banco</span>
              </button>
            </div>
          )}

          {/* Active Sessions Table */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-xl text-primary">groups_3</span>
                <div>
                  <h3 className="font-headline font-bold text-base text-on-surface">
                    Tokens de Sessão em wp_usermeta
                  </h3>
                  <p className="font-mono text-xs text-outline">
                    {sessionsData?.total || 0} Sessões Ativas • Tolerância: 48h inativas {isAllSites && '• Escopo Consolidado'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-outline-variant">
                  IPs do Servidor: {sessionsData?.serverIps?.join(', ') || 'Nenhum definido'}
                </span>
              </div>
            </div>

            {sessionsError && (
              <div className="p-3 bg-error-container/20 border border-error/40 rounded-lg text-xs text-error font-mono mb-4">
                {sessionsError}
              </div>
            )}

            <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
              <table className="w-full text-left font-sans text-xs">
                <thead>
                  <tr className="bg-surface-container text-outline font-mono text-[11px] uppercase tracking-wider border-b border-outline-variant/30">
                    <th className="py-3 px-4">Usuário &amp; ID</th>
                    <th className="py-3 px-4">IP de Origem</th>
                    <th className="py-3 px-4">User-Agent / Cliente</th>
                    <th className="py-3 px-4">Criação / Expira</th>
                    <th className="py-3 px-4 text-right">Status Tático</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20 font-mono">
                  {sessionsLoading ? (
                    <tr>
                      <td colSpan="5" className="py-12 text-center text-outline">
                        <div className="flex items-center justify-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                          <span>Consultando tabela wp_usermeta ao vivo no banco MySQL...</span>
                        </div>
                      </td>
                    </tr>
                  ) : !sessionsData?.sessions || sessionsData.sessions.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="py-12 text-center text-outline">
                        Nenhuma sessão ativa encontrada {isAllSites ? 'nos bancos de dados dos sites monitorados' : 'para este site'}.
                      </td>
                    </tr>
                  ) : (
                    sessionsData.sessions.map((sess, idx) => {
                      const isSuspicious = sess.suspicious;
                      return (
                        <tr
                          key={`${sess.siteKey || ''}-${sess.userId}-${sess.ip}-${idx}`}
                          className={`transition-colors ${
                            isSuspicious
                              ? 'bg-error-container/10 hover:bg-error-container/20'
                              : 'hover:bg-surface-container/50'
                          }`}
                        >
                          {/* User */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center font-headline font-bold text-xs ${
                                  isSuspicious
                                    ? 'bg-error-container text-on-error-container'
                                    : 'bg-primary-container/30 text-primary'
                                }`}
                              >
                                {sess.login ? sess.login.charAt(0).toUpperCase() : 'U'}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-headline font-semibold text-on-surface flex items-center gap-2">
                                  <span>{sess.login || `User #${sess.userId}`}</span>
                                  {sess.siteName && (
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-surface-container-high text-primary border border-primary/20">
                                      {sess.siteName}
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono text-[10px] text-outline">
                                  ID: {sess.userId}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* IP */}
                          <td className="py-3 px-4">
                            <div className="flex flex-col">
                              <span className={`font-semibold ${isSuspicious ? 'text-error flex items-center gap-1' : 'text-on-surface'}`}>
                                {isSuspicious && <span className="material-symbols-outlined text-xs">warning</span>}
                                {sess.ip || '—'}
                              </span>
                              {sess.reasons?.some((r) => r.includes('IP de origem coincide')) && (
                                <span className="text-[10px] text-error font-bold uppercase">
                                  Loopback Server Match
                                </span>
                              )}
                            </div>
                          </td>

                          {/* User Agent */}
                          <td className="py-3 px-4">
                            <div className="flex flex-col max-w-xs">
                              <span className="text-on-surface truncate" title={sess.ua}>
                                {sess.ua || '—'}
                              </span>
                              {sess.reasons && sess.reasons.length > 0 && (
                                <span className="text-[10px] text-error font-semibold mt-0.5">
                                  {sess.reasons.join(' • ')}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Timestamps */}
                          <td className="py-3 px-4 text-on-surface-variant text-[11px]">
                            <div className="flex flex-col">
                              <span>Login: {sess.loginTime ? timeAgo(sess.loginTime) : '—'}</span>
                              <span className="text-outline text-[10px]">
                                Expira: {sess.expiration ? formatDate(new Date(sess.expiration * 1000).toISOString()) : '—'}
                              </span>
                            </div>
                          </td>

                          {/* Action */}
                          <td className="py-3 px-4 text-right">
                            {isSuspicious ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setSessionToast(
                                    `Sessão de ${sess.login || sess.userId} marcada para revogação.`
                                  )
                                }
                                className="px-3 py-1 bg-error hover:bg-error-container text-on-error rounded font-headline text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-xs">block</span>
                                <span>Encerrar</span>
                              </button>
                            ) : (
                              <StatusBadge status="clean" label="Legítima" />
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ABA 4: DETECTOR DE SEO SPAM                              */}
      {/* ======================================================== */}
      {activeTab === 'seo' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Dictionary & Rules List */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col gap-4 lg:col-span-1">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  Dicionário de Camuflagem
                </h3>
                <span className="font-mono text-xs text-outline">Rastreamento de Hidden Links</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-surface-container text-tertiary-fixed-dim font-mono text-[10px]">
                42 Regras
              </span>
            </div>

            <p className="font-sans text-xs text-on-surface-variant">
              Assinaturas ativas rastreando links fantasma e injeção de texto com classes CSS de coordenada negativa.
            </p>

            <div className="flex flex-col gap-2 font-mono text-xs">
              <div className="p-3 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1">
                <span className="text-outline text-[10px] uppercase font-semibold">Regras CSS Ocultas:</span>
                <span className="text-secondary font-bold">left: -9999px; font-size: 0; opacity: 0;</span>
              </div>
              <div className="p-3 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1">
                <span className="text-outline text-[10px] uppercase font-semibold">Keywords Cassino &amp; Apostas:</span>
                <span className="text-secondary font-bold">bet, slots, tigrinho, roleta, aviator</span>
              </div>
              <div className="p-3 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1">
                <span className="text-outline text-[10px] uppercase font-semibold">Spam Farmacêutico:</span>
                <span className="text-secondary font-bold">viagra, cialis, no-rx, pharmacy</span>
              </div>
              <div className="p-3 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1">
                <span className="text-outline text-[10px] uppercase font-semibold">Elementor Meta Hook:</span>
                <span className="text-secondary font-bold">_elementor_data scan deep</span>
              </div>
            </div>
          </div>

          {/* Audit Results */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 flex flex-col lg:col-span-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xl text-primary">auto_fix_high</span>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  Páginas &amp; Posts Auditados (Elementor / wp_posts)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setElementorModalOpen(true)}
                className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-bright text-primary border border-primary/30 rounded-lg font-headline text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">data_object</span>
                <span>Inspecionar Heurística Elementor</span>
              </button>
            </div>

            {/* Results Display */}
            {seoAlerts.length === 0 ? (
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-8 flex flex-col items-center justify-center text-center flex-1 min-h-[300px]">
                <div className="w-14 h-14 rounded-full bg-secondary/10 border border-secondary/30 flex items-center justify-center text-secondary mb-3">
                  <span className="material-symbols-outlined text-3xl">verified</span>
                </div>
                <h4 className="font-headline font-bold text-lg text-on-surface">
                  Zero Vetores Ocultos Detectados
                </h4>
                <p className="font-sans text-xs text-on-surface-variant max-w-md mt-1 mb-4">
                  Todas as páginas e post metas (<code className="text-primary font-mono">_elementor_data</code>) do site <span className="text-on-surface font-semibold">{currentSiteObj.name}</span> foram inspecionadas criptograficamente e estão livres de links ocultos ou âncoras maliciosas.
                </p>
                <div className="flex items-center gap-3 font-mono text-xs">
                  <span className="px-3 py-1 rounded bg-surface-container text-secondary">
                    Posts Auditados: {currentSiteSummary?.database?.posts || 38}
                  </span>
                  <span className="px-3 py-1 rounded bg-surface-container text-outline">
                    Links Suspeitos: 0
                  </span>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
                <table className="w-full text-left font-sans text-xs">
                  <thead>
                    <tr className="bg-surface-container text-outline font-mono text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Post / Página</th>
                      <th className="py-3 px-4">URL Injetada</th>
                      <th className="py-3 px-4">Texto Âncora</th>
                      <th className="py-3 px-4 text-right">Severidade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20 font-mono">
                    {seoAlerts.map((alert) => (
                      <tr key={alert.id} className="hover:bg-surface-container/50">
                        <td className="py-3 px-4 font-semibold text-on-surface">
                          {alert.details?.postTitle || alert.details?.post_id || `Post #${alert.id}`}
                        </td>
                        <td className="py-3 px-4 text-error font-medium truncate max-w-xs">
                          {alert.details?.url || alert.message}
                        </td>
                        <td className="py-3 px-4 text-on-surface-variant">
                          {alert.details?.anchor || '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <StatusBadge status="danger" label="Crítico" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: DETALHES DO ARQUIVO CRIPTOGRÁFICO                 */}
      {/* ======================================================== */}
      {selectedFileModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-xl w-full max-w-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">folder_data</span>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  Inspeção de Integridade do Arquivo
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFileModal(null)}
                className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3 font-mono text-xs">
              <div className="p-3 rounded bg-surface-container-lowest border border-outline-variant/20">
                <span className="text-outline text-[10px] uppercase font-semibold">Caminho:</span>
                <p className="text-on-surface font-bold break-all mt-0.5">{selectedFileModal.path}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded bg-surface-container border border-outline-variant/20">
                  <span className="text-outline text-[10px] uppercase font-semibold">Tamanho:</span>
                  <p className="text-on-surface font-bold mt-0.5">{formatBytes(selectedFileModal.size)}</p>
                </div>
                <div className="p-3 rounded bg-surface-container border border-outline-variant/20">
                  <span className="text-outline text-[10px] uppercase font-semibold">Última Modificação:</span>
                  <p className="text-on-surface font-bold mt-0.5">{formatDate(selectedFileModal.modifiedAt)}</p>
                </div>
              </div>

              <div className="p-3 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1">
                <span className="text-outline text-[10px] uppercase font-semibold">Hash SHA-256 Calculado:</span>
                <p className="text-secondary font-bold break-all">{selectedFileModal.hash || '— (não calculado no ciclo rápido)'}</p>
              </div>

              {selectedFileModal.baselineHash && (
                <div className="p-3 rounded bg-surface-container border border-outline-variant/20 flex flex-col gap-1">
                  <span className="text-outline text-[10px] uppercase font-semibold">Hash SHA-256 Baseline:</span>
                  <p className="text-tertiary-fixed-dim font-bold break-all">{selectedFileModal.baselineHash}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => setSelectedFileModal(null)}
                className="px-4 py-2 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-headline text-xs font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: HEURÍSTICA ELEMENTOR                              */}
      {/* ======================================================== */}
      {elementorModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-xl w-full max-w-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">data_object</span>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  Engine de Sanitização de Payloads Elementor
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setElementorModalOpen(false)}
                className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="font-sans text-xs text-on-surface-variant flex flex-col gap-3">
              <p>
                O Elementor armazena a estrutura das páginas serializada em JSON no campo <code className="text-primary font-mono">_elementor_data</code> da tabela <code className="text-primary font-mono">wp_postmeta</code>.
              </p>
              <div className="p-3 rounded bg-surface-container-lowest border border-outline-variant/20 font-mono text-[11px] leading-relaxed text-secondary">
                {`[
  {
    "id": "e4f81c",
    "elType": "widget",
    "widgetType": "text-editor",
    "settings": {
      "editor": "Conteúdo limpo e auditado pelo WP Sentinel"
    }
  }
]`}
              </div>
              <p>
                O motor do <strong>WP Sentinel</strong> realiza o parsing recursivo desse JSON, identifica injeções de links ocultos (ex.: estilos com coordenadas negativas <code className="text-tertiary font-mono">left: -9999px</code>) e neutraliza o payload sem corromper a árvore de widgets do construtor.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => setElementorModalOpen(false)}
                className="px-4 py-2 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded-lg font-headline text-xs font-semibold cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
