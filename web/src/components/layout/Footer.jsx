import React from 'react';

export function Footer({ cycle = 0, lastUpdatedAt, sseConnected = false }) {
  return (
    <footer className="h-10 bg-surface-container-lowest border-t border-outline-variant/30 px-6 flex items-center justify-between text-xs text-outline font-mono">
      <div className="flex items-center gap-3">
        <span>WP Sentinel v1.0 SecOps PRO</span>
        <span>•</span>
        <span>{cycle > 0 ? `Último Ciclo: ${cycle}` : 'Aguardando primeiro ciclo'}</span>
        {lastUpdatedAt && (
          <>
            <span>•</span>
            <span>Atualizado: {new Date(lastUpdatedAt).toLocaleTimeString('pt-BR')}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            sseConnected ? 'bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.6)]' : 'bg-outline'
          }`}
        />
        <span className="text-[11px]">{sseConnected ? 'Tempo Real (SSE) Conectado' : 'Reconectando SSE...'}</span>
      </div>
    </footer>
  );
}
