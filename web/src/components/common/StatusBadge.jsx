import React from 'react';

export function StatusBadge({ status = 'healthy', label, pulse = true, className = '' }) {
  const configs = {
    critical: {
      bg: 'bg-error-container',
      text: 'text-on-error-container',
      border: 'border-error/40',
      dot: 'bg-error',
      defaultLabel: 'Crítico',
    },
    warning: {
      bg: 'bg-amber-950/40',
      text: 'text-amber-300',
      border: 'border-amber-500/40',
      dot: 'bg-amber-400',
      defaultLabel: 'Aviso',
    },
    healthy: {
      bg: 'bg-emerald-950/40',
      text: 'text-secondary',
      border: 'border-secondary/40',
      dot: 'bg-secondary',
      defaultLabel: 'Seguro',
    },
    info: {
      bg: 'bg-sky-950/40',
      text: 'text-tertiary-fixed-dim',
      border: 'border-tertiary/40',
      dot: 'bg-tertiary',
      defaultLabel: 'Info',
    },
    running: {
      bg: 'bg-blue-950/40',
      text: 'text-primary',
      border: 'border-primary/40',
      dot: 'bg-primary',
      defaultLabel: 'Em execução',
    },
    inactive: {
      bg: 'bg-surface-container-high',
      text: 'text-on-surface-variant',
      border: 'border-outline-variant/30',
      dot: 'bg-outline',
      defaultLabel: 'Parado',
    },
  };

  const config = configs[status] || configs.inactive;
  const displayText = label || config.defaultLabel;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono uppercase tracking-wider ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      <span className="relative flex h-2 w-2">
        {pulse && status !== 'inactive' && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.dot}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`} />
      </span>
      <span>{displayText}</span>
    </span>
  );
}
