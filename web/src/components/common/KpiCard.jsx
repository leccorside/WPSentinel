import React from 'react';

export function KpiCard({
  title,
  value,
  subtext,
  icon,
  badgeText,
  badgeColor = 'secondary', // 'secondary' | 'error' | 'warning' | 'primary' | 'muted'
  variant = 'default', // 'default' | 'critical' | 'warning'
}) {
  const badgeClasses = {
    secondary: 'bg-secondary/10 text-secondary border border-secondary/30',
    error: 'bg-error-container text-on-error-container border border-error/40',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
    primary: 'bg-primary-container text-on-primary-container',
    muted: 'bg-surface-container-high text-on-surface-variant',
  }[badgeColor] || 'bg-surface-container-high text-on-surface-variant';

  const cardBorder = {
    critical: 'border-error/40 shadow-[0_0_16px_-2px_rgba(244,63,94,0.25)]',
    warning: 'border-amber-500/40 shadow-[0_0_14px_-2px_rgba(245,158,11,0.2)]',
    default: 'border-outline-variant/30 hover:border-outline-variant/60',
  }[variant] || 'border-outline-variant/30';

  return (
    <div className={`p-4 rounded-lg bg-surface-container-low border transition-all ${cardBorder}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-wider text-outline flex items-center gap-1.5">
          {icon && <span className="material-symbols-outlined text-sm">{icon}</span>}
          {title}
        </span>
        {badgeText && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${badgeClasses}`}>
            {badgeText}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-headline font-bold text-2xl text-on-surface tracking-tight">
          {value ?? '—'}
        </span>
      </div>
      {subtext && <p className="mt-1 text-xs text-on-surface-variant">{subtext}</p>}
    </div>
  );
}
