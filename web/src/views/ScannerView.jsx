import React, { useState } from 'react';
import { Tabs } from '../components/common/Tabs';
import { KpiCard } from '../components/common/KpiCard';

const SCANNER_TABS = [
  { id: 'files', label: 'Integridade de Arquivos', icon: 'description' },
  { id: 'dropins', label: 'Drop-ins & Cache', icon: 'layers' },
  { id: 'sessions', label: 'Radar de Sessões', icon: 'passkey' },
  { id: 'seo', label: 'Detector de SEO Spam', icon: 'travel_explore' },
];

export function ScannerView({ sites = [], selectedSite, onTriggerScan, onTriggerFullScan }) {
  const [activeTab, setActiveTab] = useState('files');
  const [search, setSearch] = useState('');

  return (
    <div className="flex flex-col gap-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-on-surface-variant font-mono text-[11px] uppercase tracking-wider mb-1">
            <span>Telemetria Profunda</span>
            <span>/</span>
            <span className="text-tertiary-fixed-dim">Checksum & Heurística</span>
          </div>
          <h1 className="font-headline font-bold text-2xl text-on-surface tracking-tight flex items-center gap-3">
            Deep Threat Scanner
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/baseline-diff${selectedSite !== 'all' ? `?site=${selectedSite}` : ''}`}
            download
            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 rounded-lg text-xs font-headline font-semibold text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-base">download</span>
            <span>Baixar Diff da Baseline</span>
          </a>
          <button
            type="button"
            onClick={onTriggerFullScan}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)] cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">verified</span>
            <span>Revalidar Hashes</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={SCANNER_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab Content Placeholder / Shell */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 min-h-[360px] flex flex-col justify-center items-center text-center">
        <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-primary mb-3">
          <span className="material-symbols-outlined text-2xl">
            {SCANNER_TABS.find((t) => t.id === activeTab)?.icon}
          </span>
        </div>
        <h3 className="font-headline font-bold text-lg text-on-surface">
          {SCANNER_TABS.find((t) => t.id === activeTab)?.label}
        </h3>
        <p className="text-xs text-on-surface-variant max-w-md mt-1 mb-4">
          Visualização detalhada alimentada pelas APIs <code className="text-primary font-mono">/api/files</code> e <code className="text-primary font-mono">/api/sites/:key/sessions</code> (implementação das tabelas e filtros no Passo 8).
        </p>
        <span className="px-3 py-1 rounded bg-surface-container-high text-xs font-mono text-outline">
          Escopo atual: {selectedSite === 'all' ? 'Todos os Sites' : selectedSite}
        </span>
      </div>
    </div>
  );
}
