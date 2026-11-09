import React, { useState } from 'react';

// Escolha do escopo antes de disparar varredura ou plano: todos os sites ou um só.
// extraOption: ação alternativa opcional (ex.: "Só abrir a Central de Limpeza").
export function SiteScopeModal({ request, sites = [], defaultSite = 'all', onConfirm, onClose }) {
  const [choice, setChoice] = useState(sites.some((s) => s.key === defaultSite) ? defaultSite : 'all');
  if (!request) return null;

  const options = [{ key: 'all', name: `Todos os sites (${sites.length})`, url: null }, ...sites];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-full max-w-md bg-surface-container-low border border-outline-variant/40 rounded-xl shadow-2xl p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">{request.icon || 'radar'}</span>
          <h3 className="font-headline font-bold text-base text-on-surface">{request.title}</h3>
        </div>
        {request.description && <p className="font-sans text-xs text-on-surface-variant">{request.description}</p>}

        <div className="flex flex-col gap-2" role="radiogroup">
          {options.map((option) => (
            <label
              key={option.key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                choice === option.key
                  ? 'border-primary bg-primary/10'
                  : 'border-outline-variant/30 hover:bg-surface-container'
              }`}
            >
              <input
                type="radio"
                name="site-scope"
                value={option.key}
                checked={choice === option.key}
                onChange={() => setChoice(option.key)}
                className="accent-[#4d8eff]"
              />
              <span className="flex flex-col">
                <span className="font-headline text-sm text-on-surface">{option.name}</span>
                {option.url && <span className="font-mono text-[11px] text-outline">{option.key} • {option.url.replace(/^https?:\/\//, '')}</span>}
              </span>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 flex-wrap">
          {request.extraOption && (
            <button
              type="button"
              onClick={() => { request.extraOption.onClick(); onClose(); }}
              className="mr-auto px-3 py-1.5 rounded-lg font-headline text-xs font-semibold bg-surface-container hover:bg-surface-container-high text-on-surface-variant cursor-pointer"
            >
              {request.extraOption.label}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg font-headline text-xs font-semibold bg-surface-container hover:bg-surface-container-high text-on-surface-variant cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(choice === 'all' ? null : choice); onClose(); }}
            className="px-3 py-1.5 rounded-lg font-headline text-xs font-semibold bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary cursor-pointer"
          >
            {request.confirmLabel || 'Iniciar'}
          </button>
        </div>
      </div>
    </div>
  );
}
