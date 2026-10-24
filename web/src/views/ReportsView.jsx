import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

export function ReportsView() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.reports
      .list()
      .then((data) => setReports(data.reports || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-on-surface-variant font-mono text-[11px] uppercase tracking-wider mb-1">
            <span>Auditoria & Governança</span>
            <span>/</span>
            <span className="text-secondary">Histórico de Relatórios</span>
          </div>
          <h1 className="font-headline font-bold text-2xl text-on-surface tracking-tight flex items-center gap-3">
            Relatórios Executivos
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={api.reports.executiveDownloadUrl()}
            download
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)]"
          >
            <span className="material-symbols-outlined text-base">download</span>
            <span>Exportar Resumo Executivo (.md)</span>
          </a>
        </div>
      </div>

      {/* Reports List */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-outline-variant/30 flex items-center justify-between">
          <h2 className="font-headline font-bold text-base text-on-surface">Relatórios Diários Gravados</h2>
          <span className="font-mono text-xs text-outline">Total: {reports.length} arquivo(s)</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-outline font-mono">Carregando relatórios...</div>
        ) : reports.length === 0 ? (
          <div className="p-8 text-center text-xs text-outline font-mono">
            Nenhum relatório diário gerado em <code className="text-primary">reports/</code> até o momento.
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/20 font-mono text-xs">
            {reports.map((r) => (
              <div key={r.name} className="p-4 flex items-center justify-between hover:bg-surface-container/50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-outline text-lg">description</span>
                  <span className="font-semibold text-on-surface">{r.name}</span>
                  <span className="text-outline text-[11px]">{r.date || ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={api.reports.rawUrl(r.name)}
                    download
                    className="px-2.5 py-1 bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 rounded text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Baixar TXT
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
