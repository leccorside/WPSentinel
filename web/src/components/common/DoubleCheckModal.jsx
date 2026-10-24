import React, { useState } from 'react';

export function DoubleCheckModal({
  isOpen,
  title = 'Confirmação Obrigatória de Ação Crítica',
  promptText,
  confirmationPhrase,
  onConfirm,
  onCancel,
  loading = false,
  actionLabel = 'Executar Ação',
}) {
  const [typedPhrase, setTypedPhrase] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const isMatched = typedPhrase.trim() === confirmationPhrase?.trim();

  const handleConfirm = () => {
    if (!isMatched) {
      setError(`Digite exatamente "${confirmationPhrase}" para autorizar.`);
      return;
    }
    setError('');
    onConfirm(typedPhrase.trim());
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-surface-container-low border border-amber-500/50 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-4 bg-surface-container flex items-center justify-between border-b border-outline-variant/30">
          <div className="flex items-center gap-2 text-amber-400 font-headline font-semibold text-lg">
            <span className="material-symbols-outlined text-amber-400">warning</span>
            <span>{title}</span>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            type="button"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-4">
          <p className="text-sm text-on-surface leading-relaxed">
            {promptText || 'Esta ação executará alterações diretas em arquivos e registros de banco de dados nos sites de produção.'}
          </p>

          <div className="p-3 bg-surface-container-lowest border border-outline-variant/30 rounded-lg">
            <span className="block text-xs font-mono text-outline uppercase mb-1">Frase de confirmação exigida:</span>
            <div className="font-mono text-amber-300 font-bold tracking-wider select-all text-base">
              {confirmationPhrase}
            </div>
          </div>

          <div>
            <label className="block text-xs text-on-surface-variant mb-1.5 font-mono uppercase">
              Digite a frase acima para desbloquear:
            </label>
            <input
              type="text"
              autoFocus
              value={typedPhrase}
              onChange={(e) => {
                setTypedPhrase(e.target.value);
                if (error) setError('');
              }}
              placeholder={confirmationPhrase}
              className="w-full px-3.5 py-2.5 bg-surface-container-lowest border border-outline-variant/50 focus:border-amber-400 rounded-lg text-on-surface font-mono text-sm outline-none transition-colors"
            />
            {error && <p className="mt-1.5 text-xs text-error font-medium">{error}</p>}
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 mt-3 pt-3 border-t border-outline-variant/20">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 rounded-lg border border-outline-variant/40 hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isMatched || loading}
              className={`px-5 py-2 rounded-lg text-sm font-headline font-semibold transition-all ${
                isMatched && !loading
                  ? 'bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-[0_0_14px_rgba(245,158,11,0.4)] cursor-pointer'
                  : 'bg-surface-container-high text-outline cursor-not-allowed opacity-60'
              }`}
            >
              {loading ? 'Processando...' : actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
