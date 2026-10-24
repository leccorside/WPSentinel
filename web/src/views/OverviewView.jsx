import React from 'react';
import { KpiCard } from '../components/common/KpiCard';
import { StatusBadge } from '../components/common/StatusBadge';

export function OverviewView({
  overviewData,
  selectedSite,
  onTriggerScan,
  onTriggerFullScan,
  onOpenCleanup,
  onSelectSite,
}) {
  const totals = overviewData?.totals || {};
  const sites = overviewData?.sites || [];
  const filteredSites = selectedSite === 'all' ? sites : sites.filter((s) => s.key === selectedSite);

  const pendingCrit = totals.pending?.critical || 0;
  const pendingHigh = totals.pending?.high || 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Title & Perímetro Operacional */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
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
              {filteredSites.length} {filteredSites.length === 1 ? 'SITE' : 'SITES'}
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTriggerFullScan}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 rounded-lg text-xs font-headline font-semibold text-primary transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">verified</span>
            <span>Revalidar Hashes</span>
          </button>
          <button
            type="button"
            onClick={onTriggerScan}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)] cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">sync</span>
            <span>Varredura Manual</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Alertas Críticos Pendentes"
          value={pendingCrit}
          subtext={pendingCrit > 0 ? 'Exigem intervenção imediata' : 'Nenhuma ameaça crítica ativa'}
          icon="warning"
          badgeText={pendingCrit > 0 ? 'Ação Urgente' : 'Seguro'}
          badgeColor={pendingCrit > 0 ? 'error' : 'secondary'}
          variant={pendingCrit > 0 ? 'critical' : 'default'}
        />
        <KpiCard
          title="Arquivos Sob Custódia"
          value={totals.filesMonitored?.toLocaleString('pt-BR') || '0'}
          subtext="Monitorados via integridade SHA-256"
          icon="folder_check"
          badgeText="Baseline Ativa"
          badgeColor="primary"
        />
        <KpiCard
          title="Sessões de Login"
          value={totals.sessions || '0'}
          subtext={
            totals.pending?.suspiciousSessions > 0
              ? `${totals.pending.suspiciousSessions} suspeita(s)`
              : 'Nenhuma sessão anômala'
          }
          icon="passkey"
          badgeText={totals.pending?.suspiciousSessions > 0 ? 'Alerta' : 'Auditado'}
          badgeColor={totals.pending?.suspiciousSessions > 0 ? 'warning' : 'secondary'}
        />
        <KpiCard
          title="SEO Spam Detectado"
          value={totals.pending?.hiddenLinks || 0}
          subtext="Injeções em posts ou Elementor"
          icon="travel_explore"
          badgeText={totals.pending?.hiddenLinks > 0 ? 'Detectado' : 'Limpo'}
          badgeColor={totals.pending?.hiddenLinks > 0 ? 'error' : 'secondary'}
        />
      </div>

      {/* Matriz de Defesa por Site */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-outline-variant/30 flex items-center justify-between">
          <div>
            <h2 className="font-headline font-bold text-base text-on-surface">Matriz de Defesa por Site</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Estado de integridade, drop-ins, PHP em uploads e sessões ativas
            </p>
          </div>
          <span className="font-mono text-xs text-outline">
            Total: {filteredSites.length} site(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-surface-container border-b border-outline-variant/20 text-outline uppercase text-[11px]">
              <tr>
                <th className="py-3 px-4">Site</th>
                <th className="py-3 px-4">Integridade de Arquivos</th>
                <th className="py-3 px-4">Uploads PHP</th>
                <th className="py-3 px-4">Marcadores</th>
                <th className="py-3 px-4">Banco MySQL</th>
                <th className="py-3 px-4">Sessões</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {filteredSites.map((site) => {
                const diff =
                  (site.files?.modified || 0) + (site.files?.added || 0) + (site.files?.removed || 0);
                const hasPhpInUploads = (site.files?.phpInUploads || 0) > 0;
                const hasMarkers = (site.files?.malwareMarkers || 0) > 0;

                return (
                  <tr key={site.key} className="hover:bg-surface-container/50 transition-colors">
                    <td className="py-3.5 px-4 font-headline font-semibold text-on-surface">
                      <div className="flex flex-col">
                        <span>{site.name}</span>
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[11px] text-tertiary-fixed-dim hover:underline mt-0.5"
                        >
                          {site.url}
                        </a>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      {diff === 0 ? (
                        <StatusBadge status="healthy" label="100% Íntegro" pulse={false} />
                      ) : (
                        <StatusBadge
                          status="warning"
                          label={`${diff} alteração(ões)`}
                          pulse={true}
                        />
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {hasPhpInUploads ? (
                        <StatusBadge
                          status="critical"
                          label={`${site.files.phpInUploads} PHP`}
                        />
                      ) : (
                        <span className="text-secondary">0 (Bloqueado)</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {hasMarkers ? (
                        <StatusBadge
                          status="critical"
                          label={`${site.files.malwareMarkers} marcador(es)`}
                        />
                      ) : (
                        <span className="text-secondary">Nenhum</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {site.database ? (
                        <span className="text-on-surface">
                          {site.database.users || 0} usuários ({site.database.adminUsers || 0} admin)
                        </span>
                      ) : (
                        <span className="text-outline">Desativado</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-on-surface">{site.database?.sessions || 0} ativas</span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectSite(site.key)}
                        className="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface text-[11px] font-medium transition-colors"
                      >
                        Filtrar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
