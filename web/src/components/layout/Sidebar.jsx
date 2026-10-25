import React from 'react';

const NAV_ITEMS = [
  { id: 'overview', label: 'Visão Geral & Risco', icon: 'grid_view' },
  { id: 'scanner', label: 'Deep Threat Scanner', icon: 'security' },
  { id: 'cleanup', label: 'Central de Limpeza', icon: 'healing' },
  { id: 'reports', label: 'Relatórios Executivos', icon: 'query_stats' },
  { id: 'settings', label: 'Configurações', icon: 'settings' },
];

export function Sidebar({
  activeView = 'overview',
  onSelectView,
  sites = [],
  selectedSite = 'all',
  onSelectSite,
  baselineDate,
}) {
  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 bg-surface-container-lowest border-r border-outline-variant/30 z-20 flex flex-col justify-between overflow-y-auto">
      <div className="pt-6">
        {/* Centro de Comando */}
        <div className="px-5 mb-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
            Centro de Comando
          </span>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-headline font-semibold transition-colors text-left w-full ${
                  isActive
                    ? 'bg-surface-container-high text-primary border border-outline-variant/40 shadow-sm'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-lg">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Perímetro Ativo */}
        <div className="px-5 mt-8 mb-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-outline font-semibold">
            Perímetro Ativo ({sites.length})
          </span>
        </div>

        <div className="flex flex-col gap-1 px-3">
          <button
            type="button"
            onClick={() => onSelectSite('all')}
            className={`flex items-center justify-between px-3 py-2 rounded text-xs transition-colors text-left ${
              selectedSite === 'all'
                ? 'bg-surface-container-high border border-primary/30 text-on-surface'
                : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedSite === 'all' ? 'bg-primary shadow-[0_0_6px_rgba(77,142,255,0.8)]' : 'bg-outline-variant'}`} />
              <span className="font-mono text-[11px] font-semibold truncate">Todos os Sites ({sites.length})</span>
            </div>
            <span className="font-mono text-[10px] text-primary shrink-0 ml-1">SOMA</span>
          </button>
          {sites.map((site) => {
            const isSiteSelected = selectedSite === site.key;
            return (
              <button
                key={site.key}
                type="button"
                onClick={() => onSelectSite(isSiteSelected ? 'all' : site.key)}
                className={`flex items-center justify-between px-3 py-2 rounded text-xs transition-colors text-left ${
                  isSiteSelected
                    ? 'bg-surface-container-high border border-primary/30 text-on-surface'
                    : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary shrink-0 shadow-[0_0_6px_rgba(78,222,163,0.8)]" />
                  <span className="font-mono text-[11px] truncate">{site.name || site.key}</span>
                </div>
                <span className="font-mono text-[10px] text-outline shrink-0 ml-1">
                  {site.db?.enabled || site.db === true ? 'DB' : 'SFTP'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Threat Feed / Baseline info box */}
      <div className="p-3 mb-2">
        <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-[10px] uppercase text-outline font-semibold">
              Baseline Confiável
            </span>
            <span className="font-mono text-[10px] text-secondary">Ativa</span>
          </div>
          <p className="text-[11px] text-on-surface-variant font-mono truncate">
            {baselineDate ? new Date(baselineDate).toLocaleDateString('pt-BR') : 'Definida'}
          </p>
        </div>
      </div>
    </aside>
  );
}
