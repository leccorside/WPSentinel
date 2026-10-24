import React, { useEffect, useRef } from 'react';

function timeAgo(dateString) {
  if (!dateString) return '';
  const now = Date.now();
  const past = new Date(dateString).getTime();
  const diffSec = Math.floor((now - past) / 1000);

  if (diffSec < 45) return 'agora há pouco';
  if (diffSec < 90) return 'há 1 minuto';
  if (diffSec < 3600) return `há ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 7200) return 'há 1 hora';
  if (diffSec < 86400) return `há ${Math.floor(diffSec / 3600)} h`;
  const days = Math.floor(diffSec / 86400);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}

export function NotificationsPopover({
  isOpen,
  onClose,
  notifications = { unreadCount: 0, hasCriticalUnread: false, items: [] },
  onMarkRead,
  onMarkAllRead,
  onNavigateView,
}) {
  const popoverRef = useRef(null);

  // Fecha o popover ao clicar fora
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const items = notifications.items || [];
  const unreadCount = notifications.unreadCount || 0;

  const handleItemClick = (item) => {
    if (!item.read && onMarkRead) {
      onMarkRead(item.id);
    }
    if (item.link === 'cleanup' && onNavigateView) {
      onNavigateView('cleanup');
      onClose();
    } else if (onNavigateView) {
      onNavigateView('overview', item.site !== 'sistema' && item.site !== 'geral' ? item.site : 'all');
      onClose();
    }
  };

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'critical':
        return {
          icon: 'crisis_alert',
          border: 'border-error/40',
          bg: 'bg-error-container/20 text-error',
          badge: 'Crítico',
        };
      case 'high':
        return {
          icon: 'warning',
          border: 'border-amber-500/40',
          bg: 'bg-amber-500/10 text-amber-400',
          badge: 'Alto',
        };
      default:
        return {
          icon: 'info',
          border: 'border-primary/40',
          bg: 'bg-primary-container/20 text-primary',
          badge: 'Info',
        };
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-24px)] bg-surface-container-low border border-outline-variant/40 rounded-xl shadow-[0_16px_36px_rgba(0,0,0,0.7)] backdrop-blur-2xl z-50 overflow-hidden flex flex-col max-h-[520px] animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-outline-variant/30 flex items-center justify-between bg-surface-container-lowest/80">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-lg">notifications</span>
          <span className="font-headline font-bold text-xs uppercase tracking-wider text-on-surface">
            Notificações do Perímetro
          </span>
          {unreadCount > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                notifications.hasCriticalUnread
                  ? 'bg-error text-on-error animate-pulse shadow-[0_0_8px_rgba(255,100,100,0.5)]'
                  : 'bg-primary text-on-primary'
              }`}
            >
              {unreadCount}
            </span>
          )}
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="flex items-center gap-1 text-[11px] font-mono text-primary hover:text-primary-container transition-colors cursor-pointer"
            title="Marcar todas como lidas"
          >
            <span className="material-symbols-outlined text-sm">done_all</span>
            <span>Marcar lidas</span>
          </button>
        )}
      </div>

      {/* Lista com Scroll */}
      <div className="flex-1 overflow-y-auto divide-y divide-outline-variant/20 divide-dashed">
        {items.length === 0 ? (
          <div className="py-12 px-4 text-center flex flex-col items-center justify-center text-outline">
            <span className="material-symbols-outlined text-4xl mb-2 opacity-50">notifications_paused</span>
            <span className="text-xs font-mono">Nenhuma notificação registrada no momento</span>
          </div>
        ) : (
          items.map((item) => {
            const sev = getSeverityBadge(item.severity);
            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`p-3.5 hover:bg-surface-container transition-all cursor-pointer flex gap-3 relative ${
                  !item.read ? 'bg-surface-container-high/40' : 'opacity-85'
                }`}
              >
                {/* Indicador de não lido */}
                {!item.read && (
                  <span
                    className={`absolute left-1.5 top-5 w-1.5 h-1.5 rounded-full ${
                      item.severity === 'critical' ? 'bg-error shadow-[0_0_6px_#ff4d4d]' : 'bg-primary'
                    }`}
                  />
                )}

                {/* Ícone de severidade */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${sev.border} ${sev.bg}`}
                >
                  <span className="material-symbols-outlined text-base">{sev.icon}</span>
                </div>

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-xs font-mono font-bold text-on-surface truncate">
                        {item.site}
                      </span>
                      <span
                        className={`text-[9px] font-mono uppercase px-1 py-0.2 rounded border ${sev.border} ${sev.bg}`}
                      >
                        {sev.badge}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-outline shrink-0">
                      {timeAgo(item.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs text-on-surface-variant font-sans leading-snug line-clamp-2">
                    {item.message}
                  </p>

                  {item.details?.file && (
                    <span className="inline-block mt-1 text-[10px] font-mono text-tertiary-fixed-dim bg-surface-container-lowest px-1.5 py-0.5 rounded border border-outline-variant/30 truncate max-w-full">
                      {item.details.file}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-2.5 bg-surface-container-lowest border-t border-outline-variant/30 flex items-center justify-between text-xs font-mono">
        <button
          type="button"
          onClick={() => {
            if (onNavigateView) onNavigateView('overview');
            onClose();
          }}
          className="w-full text-center py-1.5 text-primary hover:text-on-surface text-xs font-headline font-semibold flex items-center justify-center gap-1 transition-colors"
        >
          <span>Ver histórico no feed da Visão Geral</span>
          <span className="material-symbols-outlined text-sm">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}
