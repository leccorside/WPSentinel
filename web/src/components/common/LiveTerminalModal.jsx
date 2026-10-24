import React, { useEffect, useRef, useState } from 'react';

export function LiveTerminalModal({
  isOpen,
  onClose,
  logs = [],
  onClear,
  activeJob = null,
  daemonState = 'stopped',
}) {
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef(null);

  useEffect(() => {
    if (autoScroll && isOpen) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  if (!isOpen) return null;

  const filteredLogs = filter
    ? logs.filter((l) => `${l.source} ${l.text}`.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[640px] bg-surface-container-low border border-outline-variant/40 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-4 py-3 bg-surface-container flex items-center justify-between border-b border-outline-variant/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-error" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
            </div>
            <span className="font-mono text-xs text-on-surface-variant">
              secops-daemon@wp-sentinel: /var/engine/stdout
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-outline">
              Daemon: <strong className="text-secondary">{daemonState}</strong>
            </span>
            {activeJob && (
              <span className="text-xs font-mono bg-primary-container/20 text-primary border border-primary/30 px-2 py-0.5 rounded">
                Job: {activeJob.label} ({activeJob.status})
              </span>
            )}
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
              type="button"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        </div>

        {/* Console Viewport */}
        <div className="flex-1 p-4 bg-surface-container-lowest font-mono text-xs leading-relaxed overflow-y-auto select-text">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-outline">
              Nenhuma linha de log registrada no momento.
            </div>
          ) : (
            filteredLogs.map((log, i) => {
              const time = log.at ? new Date(log.at).toLocaleTimeString() : '';
              const isError = log.stream === 'stderr' || /falha|erro|critical/i.test(log.text);
              const isSystem = log.source === 'system';
              const isMonitor = log.source === 'monitor';

              const colorClass = isError
                ? 'text-error'
                : isSystem
                  ? 'text-amber-300'
                  : isMonitor
                    ? 'text-sky-300'
                    : 'text-emerald-300';

              return (
                <div key={i} className="flex gap-2 py-0.5 hover:bg-surface-container-low/40 px-1 rounded">
                  <span className="text-outline select-none shrink-0">[{time}]</span>
                  <span className="text-outline-variant font-semibold select-none shrink-0">
                    ({log.source}):
                  </span>
                  <span className={`break-all ${colorClass}`}>{log.text}</span>
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>

        {/* Bottom Controls */}
        <div className="px-4 py-2.5 bg-surface-container border-t border-outline-variant/30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <span className="material-symbols-outlined text-outline text-sm">search</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar saída por texto..."
              className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-2.5 py-1 text-xs text-on-surface font-mono outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded bg-surface-container-lowest border-outline-variant text-primary"
              />
              <span>Rolar automaticamente</span>
            </label>

            {onClear && (
              <button
                type="button"
                onClick={onClear}
                className="px-2.5 py-1 rounded bg-surface-container-low hover:bg-surface-container-high text-xs text-on-surface-variant border border-outline-variant/30 transition-colors"
              >
                Limpar
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-xs text-on-surface font-medium transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
