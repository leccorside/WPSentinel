import React, { useState } from 'react';
import { NotificationsPopover } from '../common/NotificationsPopover';

export function Header({
  sites = [],
  selectedSite = 'all',
  onSelectSite,
  monitorState = 'stopped',
  monitorCycle = 0,
  pendingPlanActions = 0,
  onTriggerScan,
  onOpenCleanup,
  onOpenReports,
  onOpenTerminal,
  authRequired = false,
  onLogout,
  isScanning = false,
  notifications = { unreadCount: 0, hasCriticalUnread: false, items: [] },
  onMarkRead,
  onMarkAllRead,
  onNavigateView,
}) {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const daemonPill = {
    running: { dot: 'bg-primary animate-pulse', text: 'Varredura Ativa' },
    waiting: { dot: 'bg-secondary', text: 'Daemon Ativo' },
    stopping: { dot: 'bg-amber-400', text: 'Parando...' },
    paused: { dot: 'bg-purple-400', text: 'Pausado' },
    stopped: { dot: 'bg-outline', text: 'Monitor Parado' },
  }[monitorState] || { dot: 'bg-outline', text: 'Monitor Parado' };

  return (
    <header className="fixed top-0 left-0 right-0 h-16 z-30 bg-surface-container-lowest/90 backdrop-blur-xl border-b border-outline-variant/30 flex items-center justify-between px-6">
      {/* Brand & Site Scope */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-primary-container/20 border border-primary/40 flex items-center justify-center text-primary shadow-[0_0_12px_rgba(77,142,255,0.3)]">
            <span className="material-symbols-outlined text-xl">shield</span>
          </div>
          <div className="flex flex-col">
            <span className="font-headline font-bold text-base text-on-surface tracking-tight leading-none uppercase">
              WP Sentinel
            </span>
            <span className="font-mono text-[10px] text-tertiary-fixed-dim leading-none mt-1">
              SecOps Pro
            </span>
          </div>
        </div>

        <span className="hidden sm:inline-flex px-2 py-0.5 bg-surface-container-high rounded text-primary font-mono text-[11px] font-semibold border border-outline-variant/30">
          v1.0 Docker
        </span>

        <div className="h-5 w-px bg-outline-variant/30 mx-1 hidden md:block" />

        {/* Site Selector */}
        <div className="relative">
          <select
            value={selectedSite}
            onChange={(e) => onSelectSite(e.target.value)}
            className="bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-1.5 text-xs font-mono text-on-surface outline-none cursor-pointer transition-colors"
          >
            <option value="all">Todos os Sites ({sites.length})</option>
            {sites.map((site) => (
              <option key={site.key} value={site.key}>
                {site.name} ({site.key})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Center Daemon Pill */}
      <div className="hidden xl:flex items-center gap-2 px-3 py-1 bg-surface-container-low border border-outline-variant/30 rounded-lg text-xs font-mono">
        <span className="relative flex h-2 w-2">
          <span className={`relative inline-flex rounded-full h-2 w-2 ${daemonPill.dot}`} />
        </span>
        <span className="text-on-surface font-semibold uppercase">{daemonPill.text}</span>
        {monitorCycle > 0 && (
          <>
            <span className="text-outline">•</span>
            <span className="text-on-surface-variant">Ciclo {monitorCycle}</span>
          </>
        )}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onTriggerScan}
          disabled={isScanning}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_12px_rgba(77,142,255,0.25)] cursor-pointer"
        >
          <span className={`material-symbols-outlined text-base ${isScanning ? 'animate-spin' : ''}`}>
            radar
          </span>
          <span className="hidden sm:inline">Disparar Varredura</span>
        </button>

        <button
          type="button"
          onClick={onOpenCleanup}
          className="relative flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg text-xs font-medium transition-colors"
        >
          <span className="material-symbols-outlined text-base text-tertiary-fixed-dim">
            cleaning_services
          </span>
          <span className="hidden md:inline">Plano de Limpeza</span>
          {pendingPlanActions > 0 && (
            <span className="px-1.5 py-0.2 bg-error-container text-on-error-container rounded text-[10px] font-mono font-bold">
              {pendingPlanActions}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenReports}
          className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface rounded-lg text-xs font-medium transition-colors"
        >
          <span className="material-symbols-outlined text-base">description</span>
          <span>Relatório Diário</span>
        </button>

        {/* Sino de Notificações */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsNotificationsOpen((prev) => !prev)}
            title="Central de Notificações do Perímetro"
            className={`relative p-1.5 rounded-lg border transition-all cursor-pointer ${
              isNotificationsOpen
                ? 'bg-surface-container-high border-primary/50 text-primary'
                : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/30 text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-lg">notifications</span>
            {notifications.unreadCount > 0 && (
              <span
                className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-mono font-bold leading-none ${
                  notifications.hasCriticalUnread
                    ? 'bg-error text-on-error animate-pulse shadow-[0_0_8px_rgba(255,100,100,0.6)]'
                    : 'bg-primary text-on-primary'
                }`}
              >
                {notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}
              </span>
            )}
          </button>

          <NotificationsPopover
            isOpen={isNotificationsOpen}
            onClose={() => setIsNotificationsOpen(false)}
            notifications={notifications}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onNavigateView={onNavigateView}
          />
        </div>

        <button
          type="button"
          onClick={onOpenTerminal}
          title="Abrir Terminal de Eventos ao Vivo"
          className="p-1.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-primary rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-lg">terminal</span>
        </button>

        {authRequired && (
          <button
            type="button"
            onClick={onLogout}
            title="Sair do Painel"
            className="p-1.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-error rounded-lg transition-colors ml-1"
          >
            <span className="material-symbols-outlined text-lg">logout</span>
          </button>
        )}
      </div>
    </header>
  );
}
