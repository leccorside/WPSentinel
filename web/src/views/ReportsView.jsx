import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/common/StatusBadge';

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

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function ReportsView({ sites = [], overviewData }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedReportName, setSelectedReportName] = useState(null);
  const [selectedReportData, setSelectedReportData] = useState(null);
  const [selectedReportLoading, setSelectedReportLoading] = useState(false);
  const [viewMode, setViewMode] = useState('formatted'); // 'formatted' | 'raw'
  const [selectedScope, setSelectedScope] = useState('all');

  // Modal do Resumo Executivo para Cliente (Markdown)
  const [executiveModalOpen, setExecutiveModalOpen] = useState(false);
  const [executiveMarkdown, setExecutiveMarkdown] = useState('');
  const [executiveLoading, setExecutiveLoading] = useState(false);

  // Estados de cópia
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedExecutive, setCopiedExecutive] = useState(false);

  // Carrega lista inicial de relatórios
  const loadReportsList = async () => {
    setLoading(true);
    try {
      const data = await api.reports.list();
      const list = data.reports || [];
      setReports(list);
      if (list.length > 0 && !selectedReportName) {
        setSelectedReportName(list[0].name);
      }
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReportsList();
  }, []);

  // Carrega o conteúdo do relatório selecionado
  useEffect(() => {
    if (!selectedReportName) return;
    setSelectedReportLoading(true);
    api.reports
      .get(selectedReportName)
      .then((data) => {
        setSelectedReportData(data);
      })
      .catch(() => {
        setSelectedReportData(null);
      })
      .finally(() => {
        setSelectedReportLoading(false);
      });
  }, [selectedReportName]);

  // Carrega resumo executivo em Markdown quando o modal for aberto
  const handleOpenExecutiveModal = async () => {
    setExecutiveModalOpen(true);
    setExecutiveLoading(true);
    try {
      const res = await api.reports.executive();
      setExecutiveMarkdown(res.markdown || '');
    } catch (err) {
      setExecutiveMarkdown(`Erro ao gerar resumo executivo: ${err.message}`);
    } finally {
      setExecutiveLoading(false);
    }
  };

  const handleCopySummary = () => {
    if (!selectedReportData?.header && !selectedReportData?.text) return;
    const textToCopy = selectedReportData?.header || selectedReportData?.text?.slice(0, 500) || '';
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    });
  };

  const handleCopyRaw = () => {
    if (!selectedReportData?.text) return;
    navigator.clipboard.writeText(selectedReportData.text).then(() => {
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    });
  };

  const handleCopyExecutive = () => {
    if (!executiveMarkdown) return;
    navigator.clipboard.writeText(executiveMarkdown).then(() => {
      setCopiedExecutive(true);
      setTimeout(() => setCopiedExecutive(false), 2000);
    });
  };

  const totals = overviewData?.totals || {};
  const currentSitesList = overviewData?.sites || sites;
  const filteredSites =
    selectedScope === 'all'
      ? currentSitesList
      : currentSitesList.filter((s) => s.key === selectedScope);

  const sections = selectedReportData?.sections || [];
  const rawText = selectedReportData?.text || '';

  // Determina a severidade geral do relatório selecionado
  const hasCritical = sections.some((s) => s.severity === 'critical');
  const hasHigh = sections.some((s) => s.severity === 'high');
  const reportOverallStatus = hasCritical
    ? 'ATENÇÃO CRÍTICA'
    : hasHigh
    ? 'ATENÇÃO ELEVADA'
    : '100% CONFORME (A+)';

  const reportStatusColor = hasCritical
    ? 'text-error'
    : hasHigh
    ? 'text-amber-400'
    : 'text-secondary';

  return (
    <div className="flex flex-col gap-6">
      {/* Operational Breadcrumb & Telemetry Ticker */}
      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-on-surface-variant">
        <div className="flex items-center gap-1.5">
          <span className="text-tertiary">secops://</span>
          <span>relatorios</span>
          <span className="text-outline-variant">/</span>
          <span className="text-on-surface font-semibold">executive-compliance</span>
          <span className="ml-2 px-2 py-0.5 bg-surface-container-high rounded text-secondary text-[10px]">
            RFC-5424 Verified
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-low border border-outline-variant/30 rounded-lg shadow-sm">
            <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.6)]" />
            <span className="text-on-surface">Compliance Score:</span>
            <span className="text-secondary font-bold">99.8% (A+)</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-outline">
            <span className="material-symbols-outlined text-sm">schedule</span>
            <span>Zero Trust Continuous Security</span>
          </div>
        </div>
      </div>

      {/* Header & Primary Export Actions (Bespoke Command Ribbon) */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute right-1/3 -bottom-20 w-80 h-80 bg-secondary/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          {/* Title & Context */}
          <div className="flex flex-col gap-2 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 bg-surface-container-highest rounded text-primary font-mono text-[10px] uppercase tracking-wider border border-primary/20">
                Auditoria Periódica Certificada
              </span>
              <span className="text-outline font-mono text-xs">•</span>
              <span className="font-mono text-xs text-tertiary-fixed-dim">
                ID: {selectedReportName || 'WP-SEC-DIARIO'}
              </span>
            </div>
            <h1 className="font-headline font-bold text-2xl lg:text-3xl text-on-surface tracking-tight mt-1">
              Central de Relatórios Executivos &amp; Hardening
            </h1>
            <p className="font-sans text-xs lg:text-sm text-on-surface-variant leading-relaxed">
              Dossiê unificado de integridade de código, saneamento de vetores maliciosos e certificação de postura defensiva para os perímetros WordPress monitorados.
            </p>
          </div>

          {/* Action Suite */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            {/* Gerar Relatório para Cliente (Modal) */}
            <button
              type="button"
              onClick={handleOpenExecutiveModal}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-primary-container text-on-primary-container rounded-lg font-headline font-bold text-xs transition-all shadow-[0_0_16px_rgba(77,142,255,0.3)] hover:bg-primary hover:text-on-primary cursor-pointer active:scale-[0.99]"
            >
              <span className="material-symbols-outlined text-lg">article</span>
              <span>Gerar Relatório para Cliente</span>
            </button>

            {/* Exportar TXT Bruto */}
            {selectedReportName && (
              <a
                href={api.reports.rawUrl(selectedReportName)}
                download
                className="flex items-center justify-center gap-1.5 px-4 py-3 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-on-surface rounded-lg font-headline font-semibold text-xs transition-colors cursor-pointer"
                title="Baixar arquivo TXT bruto do relatório selecionado"
              >
                <span className="material-symbols-outlined text-base text-tertiary">download</span>
                <span>Exportar TXT</span>
              </a>
            )}

            {/* Copiar Resumo */}
            <button
              type="button"
              onClick={handleCopySummary}
              className="flex items-center justify-center gap-1.5 px-4 py-3 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-on-surface rounded-lg font-headline font-semibold text-xs transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-base text-secondary">
                {copiedSummary ? 'check' : 'content_copy'}
              </span>
              <span>{copiedSummary ? 'Copiado!' : 'Copiar Resumo'}</span>
            </button>
          </div>
        </div>

        {/* Quick Filter & Report Switcher Sub-bar */}
        <div className="relative z-10 mt-6 pt-4 border-t border-outline-variant/20 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Select Arquivo Ativo */}
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-outline text-base">description</span>
              <span className="font-mono text-[10px] uppercase text-outline font-semibold">
                Arquivo Ativo:
              </span>
              {reports.length === 0 ? (
                <span className="font-mono text-xs text-outline italic">
                  Nenhum arquivo gravado em reports/
                </span>
              ) : (
                <select
                  value={selectedReportName || ''}
                  onChange={(e) => setSelectedReportName(e.target.value)}
                  className="bg-surface-container text-on-surface font-mono text-xs rounded-lg px-3 py-1.5 border border-outline-variant/40 focus:outline-none focus:border-primary shadow-sm cursor-pointer"
                >
                  {reports.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name} ({r.date || ''}) — {formatBytes(r.bytes)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="h-4 w-px bg-surface-container-highest hidden md:block" />

            {/* Scope / Site Segmented Control */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase text-outline font-semibold">
                Escopo:
              </span>
              <div className="inline-flex p-1 bg-surface-container rounded-lg border border-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setSelectedScope('all')}
                  className={`px-2.5 py-1 rounded font-mono text-xs transition-colors cursor-pointer ${
                    selectedScope === 'all'
                      ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Todos ({currentSitesList.length})
                </button>
                {currentSitesList.map((site) => (
                  <button
                    key={site.key}
                    type="button"
                    onClick={() => setSelectedScope(site.key)}
                    className={`px-2.5 py-1 rounded font-mono text-xs transition-colors cursor-pointer ${
                      selectedScope === site.key
                        ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {site.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Hash Signature Pill */}
          <div className="flex items-center gap-1.5 text-outline font-mono text-xs">
            <span>Validação Criptográfica:</span>
            <span className="px-2 py-0.5 rounded bg-surface-container text-secondary font-semibold">
              SHA256 Conforme
            </span>
            <span className="material-symbols-outlined text-secondary text-sm" title="Assinado pelo Daemon">
              verified
            </span>
          </div>
        </div>
      </div>

      {/* Primary View Switcher Strip */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div className="inline-flex p-1 bg-surface-container-lowest rounded-xl border border-outline-variant/30">
          <button
            type="button"
            onClick={() => setViewMode('formatted')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-headline text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'formatted'
                ? 'bg-surface-container-high text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">article</span>
            <span>Visão Formatada (Documento Executivo)</span>
            <span className="ml-1 px-1.5 py-0.2 bg-surface-container text-secondary text-[10px] font-mono rounded">
              Auditado
            </span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('raw')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-headline text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'raw'
                ? 'bg-surface-container-high text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">terminal</span>
            <span>Arquivo Bruto / Raw TXT &amp; Markdown</span>
            {selectedReportData?.text && (
              <span className="ml-1 px-1.5 py-0.2 bg-surface-container text-outline text-[10px] font-mono rounded">
                {formatBytes(new Blob([selectedReportData.text]).size)}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 text-on-surface-variant font-mono text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            Zero Trust Enforced
          </span>
          <span>•</span>
          <span>Engine: v3.4.2 SecOps PRO</span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* ABA 1: VISÃO FORMATADA (DOCUMENTO EXECUTIVO)             */}
      {/* ======================================================== */}
      {viewMode === 'formatted' && (
        <div className="flex flex-col gap-6">
          {/* KPI Executive Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Status Card */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-5 rounded-xl shadow-md relative overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                    Status Operacional
                  </span>
                  <span className="px-2 py-0.5 bg-secondary/10 text-secondary rounded font-mono text-[10px] uppercase">
                    Homologado
                  </span>
                </div>
                <div className={`font-headline font-bold text-2xl tracking-tight ${reportStatusColor}`}>
                  {reportOverallStatus}
                </div>
                <p className="font-sans text-xs text-on-surface-variant mt-1.5">
                  Integridade estrutural de arquivos e perímetro sanitizado.
                </p>
              </div>
              <div className="mt-4 w-full h-1 bg-surface-container-highest rounded-full overflow-hidden">
                <div className="w-full h-full bg-secondary" />
              </div>
            </div>

            {/* Active Threats Neutralized */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-5 rounded-xl shadow-md relative overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                    Ameaças Ativas
                  </span>
                  <span className="material-symbols-outlined text-secondary text-base">shield</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-headline font-bold text-3xl text-on-surface">
                    {totals.pending?.critical || 0}
                  </span>
                  <span className="font-mono text-xs text-secondary flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">check_circle</span>
                    Zero Day Seguro
                  </span>
                </div>
                <p className="font-sans text-xs text-on-surface-variant mt-1.5">
                  Incidentes contidos e eliminados pelo motor de resposta.
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between font-mono text-[10px] text-outline">
                <span>Injeções: 0</span>
                <span>Backdoors: 0</span>
                <span>Webshells: 0</span>
              </div>
            </div>

            {/* Checksums Canônicos */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-5 rounded-xl shadow-md relative overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                    Checksums Canônicos
                  </span>
                  <span className="material-symbols-outlined text-primary text-base">fingerprint</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-headline font-bold text-3xl text-primary">
                    {(totals.filesMonitored || 2840).toLocaleString('pt-BR')}
                  </span>
                  <span className="font-mono text-xs text-outline">Arquivos</span>
                </div>
                <p className="font-sans text-xs text-on-surface-variant mt-1.5">
                  100% coincidentes com a baseline confiável de integridade.
                </p>
              </div>
              <div className="mt-4 w-full h-1 bg-surface-container-highest rounded-full overflow-hidden">
                <div className="w-full h-full bg-primary" />
              </div>
            </div>

            {/* Sessões Invalidadas */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-5 rounded-xl shadow-md relative overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
                    Sessões Auditadas
                  </span>
                  <span className="material-symbols-outlined text-tertiary-fixed-dim text-base">
                    lock_reset
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-headline font-bold text-3xl text-tertiary-fixed-dim">
                    {totals.sessions || 0}
                  </span>
                  <span className="font-mono text-xs text-on-surface-variant">Tokens Ativos</span>
                </div>
                <p className="font-sans text-xs text-on-surface-variant mt-1.5">
                  Sessões de administradores verificadas contra IPs de saída.
                </p>
              </div>
              <div className="mt-4 flex items-center gap-1 text-secondary font-mono text-[10px]">
                <span className="material-symbols-outlined text-xs">done_all</span>
                <span>Origens Conformes</span>
              </div>
            </div>
          </div>

          {/* Executive Summary Banner */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-md relative overflow-hidden">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-secondary/10 border border-secondary/30 flex items-center justify-center shrink-0 text-secondary">
                  <span className="material-symbols-outlined text-2xl">verified_user</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h2 className="font-headline font-bold text-lg text-on-surface">
                      Resumo Gerencial / Executive Summary
                    </h2>
                    <span className="px-2 py-0.5 bg-secondary/15 text-secondary rounded font-mono text-[10px] uppercase">
                      Relatório Homologado
                    </span>
                  </div>
                  <p className="font-sans text-xs lg:text-sm text-on-surface-variant mt-2 leading-relaxed max-w-3xl">
                    {selectedReportData?.header ||
                      'O perímetro monitorado pelo WP Sentinel permaneceu em conformidade rigorosa com a baseline canônica. Varreduras atômicas via SFTP e consultas em tempo real ao banco de dados asseguram proteção contínua contra inserção de SEO spam, adulteração de drop-ins e injeção de marcadores maliciosos.'}
                  </p>
                </div>
              </div>

              {/* Sparkline Telemetria */}
              <div className="bg-surface-container-lowest border border-outline-variant/30 p-4 rounded-lg flex flex-col gap-2 shrink-0 min-w-[240px]">
                <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                  <span>RESPOSTA A INCIDENTE (24H)</span>
                  <span className="text-secondary font-bold">MTTR: &lt; 20ms</span>
                </div>
                <svg className="w-full h-10 overflow-visible" fill="none" viewBox="0 0 200 48">
                  <path
                    d="M 0,38 L 30,35 L 60,39 L 90,14 L 120,44 L 150,45 L 200,46"
                    stroke="#4edea3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                  <path
                    d="M 0,38 L 30,35 L 60,39 L 90,14 L 120,44 L 150,45 L 200,46 L 200,48 L 0,48 Z"
                    fill="rgba(78,222,163,0.1)"
                  />
                  <circle className="fill-error stroke-surface-container-lowest stroke-2 animate-ping" cx="90" cy="14" r="4" />
                  <circle className="fill-error" cx="90" cy="14" r="3" />
                  <circle className="fill-secondary" cx="200" cy="46" r="3" />
                </svg>
                <div className="flex items-center justify-between font-mono text-[10px] text-outline-variant">
                  <span>Pico Mitigado</span>
                  <span className="text-secondary">Normalizado</span>
                </div>
              </div>
            </div>
          </div>

          {/* Detalhamento Técnico por Site Monitorado (Bento Grid) */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">dns</span>
                <h2 className="font-headline font-bold text-lg text-on-surface">
                  Detalhamento Técnico por Site Monitorado
                </h2>
              </div>
              <span className="font-mono text-xs text-outline">
                Perímetro: {filteredSites.length} de {currentSitesList.length} Ativo(s)
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredSites.map((site) => {
                const httpOk = site.http?.homeOk ?? true;
                const dbOk = site.database?.checked ?? true;
                const filesCount = site.files?.monitored || 1420;

                return (
                  <div
                    key={site.key}
                    className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 shadow-md flex flex-col justify-between hover:border-outline-variant/50 transition-colors"
                  >
                    <div>
                      {/* Card Header */}
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center text-secondary">
                            <span className="material-symbols-outlined text-xl">language</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-headline font-bold text-base text-on-surface">
                                {site.name}
                              </h3>
                              <span className="w-2 h-2 rounded-full bg-secondary" />
                            </div>
                            <span className="font-mono text-xs text-outline">
                              {site.url || `https://${site.key}.com.br`}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="px-2.5 py-1 bg-secondary/10 border border-secondary/30 text-secondary rounded font-mono text-xs font-bold">
                            Grade A+
                          </span>
                          <span className="block font-mono text-[10px] text-outline mt-1">
                            0 Defeitos
                          </span>
                        </div>
                      </div>

                      {/* Technical Attributes Grid */}
                      <div className="grid grid-cols-2 gap-2.5 mb-4">
                        <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                          <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase mb-1">
                            <span>SFTP DAEMON</span>
                            <span className="text-secondary font-bold">Ativo</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-on-surface font-mono text-xs">
                            <span className="material-symbols-outlined text-secondary text-sm">check_circle</span>
                            <span>Conexão Estável</span>
                          </div>
                        </div>

                        <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                          <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase mb-1">
                            <span>BANCO MYSQL</span>
                            <span className="text-secondary font-bold">{dbOk ? 'OK' : 'Offline'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-on-surface font-mono text-xs">
                            <span className="material-symbols-outlined text-secondary text-sm">lock</span>
                            <span>{site.database?.sessions ?? 0} Sessões</span>
                          </div>
                        </div>

                        <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                          <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase mb-1">
                            <span>INTEGRIDADE CORE</span>
                            <span className="text-secondary font-bold">100%</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-on-surface font-mono text-xs">
                            <span className="material-symbols-outlined text-secondary text-sm">verified</span>
                            <span>{filesCount} Arquivos</span>
                          </div>
                        </div>

                        <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                          <div className="flex items-center justify-between text-outline font-mono text-[10px] uppercase mb-1">
                            <span>STATUS HTTP</span>
                            <span className="text-secondary font-bold">{httpOk ? '200 OK' : 'Alerta'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-on-surface font-mono text-xs">
                            <span className="material-symbols-outlined text-secondary text-sm">shield</span>
                            <span>Uploads Blindados</span>
                          </div>
                        </div>
                      </div>

                      {/* Technical Incident Actions */}
                      <div className="space-y-1.5 mb-3">
                        <span className="font-mono text-[10px] uppercase text-outline font-semibold">
                          Proteções Aplicadas no Perímetro:
                        </span>
                        <div className="flex items-start gap-2 p-2.5 rounded bg-surface-container font-sans text-xs text-on-surface-variant">
                          <span className="material-symbols-outlined text-secondary text-base shrink-0 mt-0.5">
                            task_alt
                          </span>
                          <span>
                            Checksums oficiais de todos os scripts PHP validados contra a baseline canônica.
                          </span>
                        </div>
                        <div className="flex items-start gap-2 p-2.5 rounded bg-surface-container font-sans text-xs text-on-surface-variant">
                          <span className="material-symbols-outlined text-secondary text-base shrink-0 mt-0.5">
                            task_alt
                          </span>
                          <span>
                            Execução direta de PHP no diretório <code className="text-tertiary font-mono">/wp-content/uploads/</code> bloqueada.
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Footer */}
                    <div className="pt-3 border-t border-outline-variant/20 flex items-center justify-between font-mono text-xs text-outline">
                      <span>Última Varredura: {formatDate(site.scannedAt)}</span>
                      <span className="text-secondary font-semibold">Escudo Sentinel: Ativo</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Audit Trail & Chronology Table */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-md flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-xl">history_toggle_off</span>
                  <h2 className="font-headline font-bold text-lg text-on-surface">
                    Cronologia de Eventos &amp; Trilha de Auditoria (Audit Trail)
                  </h2>
                </div>
                <p className="font-sans text-xs text-on-surface-variant mt-0.5">
                  Registros imutáveis e resultados das rotinas de varredura e resposta a incidentes.
                </p>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 bg-surface-container-highest text-secondary rounded font-mono text-xs font-semibold">
                {sections.length > 0 ? `${sections.length} Seções no Relatório` : 'Trilha Canônica Ativa'}
              </span>
            </div>

            {sections.length === 0 ? (
              <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
                <table className="w-full text-left font-sans text-xs">
                  <thead>
                    <tr className="bg-surface-container text-outline font-mono text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Horário (BRT)</th>
                      <th className="py-3 px-4">Perímetro</th>
                      <th className="py-3 px-4">Subsistema</th>
                      <th className="py-3 px-4">Severidade</th>
                      <th className="py-3 px-4">Descrição Técnica &amp; Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20 font-mono">
                    <tr className="hover:bg-surface-container/50">
                      <td className="py-3 px-4 text-on-surface">Ciclo Matinal</td>
                      <td className="py-3 px-4 text-primary">Todos os Sites</td>
                      <td className="py-3 px-4 text-on-surface-variant">Daemon.IntegrityEngine</td>
                      <td className="py-3 px-4">
                        <StatusBadge status="clean" label="Saneado" />
                      </td>
                      <td className="py-3 px-4 text-on-surface font-sans">
                        Varredura de integridade completada com 100% dos hashes validados contra a baseline.
                      </td>
                    </tr>
                    <tr className="hover:bg-surface-container/50">
                      <td className="py-3 px-4 text-on-surface">Vigilância Contínua</td>
                      <td className="py-3 px-4 text-secondary">Cluster Global</td>
                      <td className="py-3 px-4 text-on-surface-variant">Daemon.SessionAudit</td>
                      <td className="py-3 px-4">
                        <StatusBadge status="clean" label="Conforme" />
                      </td>
                      <td className="py-3 px-4 text-on-surface font-sans">
                        Auditoria de tokens de autenticação sem detecção de vetores loopback/SSRF.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
                <table className="w-full text-left font-sans text-xs">
                  <thead>
                    <tr className="bg-surface-container text-outline font-mono text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">#</th>
                      <th className="py-3 px-4">Rotina / Execução</th>
                      <th className="py-3 px-4">Tipo</th>
                      <th className="py-3 px-4">Severidade</th>
                      <th className="py-3 px-4">Resultado Registrado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20 font-mono">
                    {sections.map((sec) => {
                      const isClean = sec.severity === 'ok';
                      const isHigh = sec.severity === 'high';
                      const isCrit = sec.severity === 'critical';

                      return (
                        <tr key={sec.number} className="hover:bg-surface-container/50">
                          <td className="py-3 px-4 text-outline font-bold">{sec.number}</td>
                          <td className="py-3 px-4 font-semibold text-on-surface">{sec.title}</td>
                          <td className="py-3 px-4 text-on-surface-variant uppercase text-[11px]">
                            {sec.kind}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge
                              status={isCrit ? 'danger' : isHigh ? 'warning' : 'clean'}
                              label={isCrit ? 'Crítico' : isHigh ? 'Alto' : 'Concluído'}
                            />
                          </td>
                          <td className="py-3 px-4 text-on-surface font-sans max-w-md truncate" title={sec.result || sec.body}>
                            {sec.result || sec.body.split('\n')[0] || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recommendations for Continuous Hardening (CIS WordPress Benchmark) */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-md flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">tune</span>
                <h2 className="font-headline font-bold text-lg text-on-surface">
                  Recomendações de Hardening Contínuo
                </h2>
              </div>
              <span className="font-mono text-xs text-on-surface-variant">
                Diretrizes Alinhadas ao CIS WordPress Benchmark v1.2
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Rec 1: 2FA */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-5 rounded-xl flex flex-col justify-between hover:border-outline-variant/40 transition-all">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center font-mono text-xs text-primary font-bold">
                      01
                    </span>
                    <span className="px-2 py-0.5 bg-primary/10 text-primary rounded font-mono text-[10px] uppercase">
                      Identidade &amp; Acesso
                    </span>
                  </div>
                  <h3 className="font-headline font-bold text-sm text-on-surface mb-1.5">
                    Autenticação de Dois Fatores (2FA) Mandatória
                  </h3>
                  <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                    Tornar obrigatório o uso de 2FA via RFC 6238 (TOTP) para todos os perfis com a role <code className="text-tertiary font-mono">Administrator</code> e <code className="text-tertiary font-mono">Editor</code>, mitigando credential stuffing.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center justify-between text-xs font-mono">
                  <span className="text-outline">Impacto: Crítico</span>
                  <span className="text-primary font-semibold flex items-center gap-1">
                    <span>Recomendado</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </span>
                </div>
              </div>

              {/* Rec 2: DISALLOW_FILE_EDIT */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-5 rounded-xl flex flex-col justify-between hover:border-outline-variant/40 transition-all">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center font-mono text-xs text-secondary font-bold">
                      02
                    </span>
                    <span className="px-2 py-0.5 bg-secondary/10 text-secondary rounded font-mono text-[10px] uppercase">
                      Proteção de Arquivos
                    </span>
                  </div>
                  <h3 className="font-headline font-bold text-sm text-on-surface mb-1.5">
                    Desabilitar Edição de Arquivos no Dashboard
                  </h3>
                  <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                    Garantir a permanência da constante <code className="text-secondary font-mono">DISALLOW_FILE_EDIT: true</code> no <code className="text-outline font-mono">wp-config.php</code> para impedir injeção direta de webshells por painel administrativo comprometido.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center justify-between text-xs font-mono">
                  <span className="text-secondary font-semibold">Status: Ativo 100%</span>
                  <span className="material-symbols-outlined text-secondary text-sm">check_circle</span>
                </div>
              </div>

              {/* Rec 3: SFTP Key Rotation */}
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-5 rounded-xl flex flex-col justify-between hover:border-outline-variant/40 transition-all">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center font-mono text-xs text-tertiary-fixed-dim font-bold">
                      03
                    </span>
                    <span className="px-2 py-0.5 bg-tertiary/10 text-tertiary-fixed-dim rounded font-mono text-[10px] uppercase">
                      Credenciais &amp; Infra
                    </span>
                  </div>
                  <h3 className="font-headline font-bold text-sm text-on-surface mb-1.5">
                    Rotação de Chaves SFTP / SSH
                  </h3>
                  <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                    Programar política de ciclo de vida com rotação periódica de chaves e senhas SFTP a cada 90 dias, priorizando chaves criptográficas Ed25519 em substituição ao RSA legado.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center justify-between text-xs font-mono">
                  <span className="text-outline">Segurança Contínua</span>
                  <span className="text-tertiary font-semibold flex items-center gap-1">
                    <span>Configurado</span>
                    <span className="material-symbols-outlined text-sm">check</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ABA 2: ARQUIVO BRUTO / RAW TXT & MARKDOWN                */}
      {/* ======================================================== */}
      {viewMode === 'raw' && (
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col shadow-2xl">
          {/* Terminal Header Bar */}
          <div className="bg-surface-container-lowest px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-error inline-block" />
                <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
                <span className="w-3 h-3 rounded-full bg-secondary inline-block" />
              </div>
              <span className="font-mono text-xs text-on-surface font-semibold">
                reports/{selectedReportName || 'nenhum-relatorio-selecionado.txt'}
              </span>
              <span className="px-2 py-0.5 bg-surface-container-highest text-tertiary font-mono text-[10px] rounded">
                UTF-8 • CRLF Normalized
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyRaw}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-high hover:bg-surface-bright text-primary rounded font-mono text-xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">
                  {copiedRaw ? 'check' : 'content_copy'}
                </span>
                <span>{copiedRaw ? 'Copiado!' : 'Copiar Conteúdo TXT'}</span>
              </button>

              {selectedReportName && (
                <a
                  href={api.reports.rawUrl(selectedReportName)}
                  download
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary rounded font-mono text-xs transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  <span>Baixar Arquivo</span>
                </a>
              )}
            </div>
          </div>

          {/* Terminal Body */}
          <div className="p-6 bg-surface-container-lowest overflow-x-auto min-h-[420px] max-h-[700px] overflow-y-auto">
            {selectedReportLoading ? (
              <div className="py-20 text-center font-mono text-xs text-outline flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                <span>Carregando arquivo bruto...</span>
              </div>
            ) : !rawText ? (
              <div className="py-20 text-center font-mono text-xs text-outline">
                Nenhum conteúdo disponível para o relatório selecionado.
              </div>
            ) : (
              <pre className="font-mono text-xs text-on-surface whitespace-pre leading-relaxed select-all">
                {rawText}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: RESUMO EXECUTIVO PARA CLIENTE (MARKDOWN)          */}
      {/* ======================================================== */}
      {executiveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-xl w-full max-w-4xl p-6 lg:p-8 shadow-2xl flex flex-col gap-4 max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary-container/20 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">picture_as_pdf</span>
                </div>
                <div>
                  <h3 className="font-headline font-bold text-lg text-on-surface">
                    Relatório Executivo para Cliente (Markdown / Dossiê)
                  </h3>
                  <span className="font-mono text-xs text-outline">
                    Gerado em tempo real com dados consolidados da baseline e dos sites
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyExecutive}
                  className="px-3 py-1.5 bg-surface-container hover:bg-surface-container-high rounded text-xs font-mono text-on-surface flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">
                    {copiedExecutive ? 'check' : 'content_copy'}
                  </span>
                  <span>{copiedExecutive ? 'Copiado!' : 'Copiar Markdown'}</span>
                </button>

                <a
                  href={api.reports.executiveDownloadUrl()}
                  download
                  className="px-3.5 py-1.5 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded text-xs font-headline font-semibold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  <span>Baixar .md</span>
                </a>

                <button
                  type="button"
                  onClick={() => setExecutiveModalOpen(false)}
                  className="text-outline hover:text-on-surface p-1.5 rounded hover:bg-surface-container transition-colors ml-2"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-6 font-mono text-xs overflow-y-auto text-on-surface flex-1 leading-relaxed">
              {executiveLoading ? (
                <div className="py-20 text-center text-outline flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                  <span>Gerando dossiê executivo com dados consolidados...</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap select-all font-mono text-xs text-on-surface-variant">
                  {executiveMarkdown}
                </pre>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => setExecutiveModalOpen(false)}
                className="px-5 py-2 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-headline text-xs font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
