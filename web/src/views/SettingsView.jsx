import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

export function SettingsView({ monitorState, onTriggerMonitor, onTriggerResetBaseline }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.settings
      .get()
      .then((data) => setSettings(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const res = await api.settings.update(settings);
      setSettings(res.settings);
      setMessage('Configurações salvas no .env com sucesso.');
    } catch (err) {
      setMessage(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-on-surface-variant font-mono text-[11px] uppercase tracking-wider mb-1">
            <span>Parâmetros de Operação</span>
            <span>/</span>
            <span className="text-primary">Configurações & Baseline</span>
          </div>
          <h1 className="font-headline font-bold text-2xl text-on-surface tracking-tight flex items-center gap-3">
            Configurações do Sentinel
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {monitorState === 'stopped' ? (
            <button
              type="button"
              onClick={() => onTriggerMonitor('start')}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">play_arrow</span>
              <span>Iniciar Monitor Contínuo</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onTriggerMonitor('stop')}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_12px_rgba(239,68,68,0.3)] cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">stop</span>
              <span>Parar Monitor Contínuo</span>
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="p-3 bg-surface-container-high border border-outline-variant/40 rounded-lg text-xs text-on-surface">
          {message}
        </div>
      )}

      {/* Settings Form */}
      {loading ? (
        <div className="p-8 text-center text-xs text-outline font-mono">Carregando configurações...</div>
      ) : (
        <form onSubmit={handleSave} className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 flex flex-col gap-6 max-w-2xl">
          <div>
            <h2 className="font-headline font-bold text-base text-on-surface mb-1">Motor de Monitoramento</h2>
            <p className="text-xs text-on-surface-variant">
              Frequência de ciclo e revalidação de hashes armazenados no arquivo <code className="text-primary font-mono">.env</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase text-outline mb-1.5">
                Intervalo entre Varreduras (Segundos)
              </label>
              <input
                type="number"
                min="30"
                value={settings?.INTERVAL_SECONDS || 300}
                onChange={(e) => setSettings({ ...settings, INTERVAL_SECONDS: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-outline mb-1.5">
                Hash Completo a Cada (Ciclos)
              </label>
              <input
                type="number"
                min="1"
                value={settings?.FULL_HASH_EVERY || 24}
                onChange={(e) => setSettings({ ...settings, FULL_HASH_EVERY: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase text-outline mb-1.5">
              IPs Adicionais do Servidor (SERVER_IPS)
            </label>
            <input
              type="text"
              value={settings?.SERVER_IPS || ''}
              onChange={(e) => setSettings({ ...settings, SERVER_IPS: e.target.value })}
              placeholder="192.168.1.1, 10.0.0.1"
              className="w-full px-3 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
            />
            <p className="text-[11px] text-outline mt-1 font-mono">Sessões vindas destes IPs disparam alerta crítico de evasão.</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autostart"
              checked={Boolean(settings?.MONITOR_AUTOSTART)}
              onChange={(e) => setSettings({ ...settings, MONITOR_AUTOSTART: e.target.checked })}
              className="rounded bg-surface-container-lowest border-outline-variant text-primary"
            />
            <label htmlFor="autostart" className="text-xs text-on-surface font-mono cursor-pointer select-none">
              Iniciar monitor contínuo automaticamente ao ligar o painel (MONITOR_AUTOSTART)
            </label>
          </div>

          <div className="pt-4 border-t border-outline-variant/20 flex justify-between items-center">
            <button
              type="button"
              onClick={onTriggerResetBaseline}
              className="px-3.5 py-2 bg-surface-container hover:bg-surface-container-high border border-error/40 text-error rounded-lg text-xs font-headline font-semibold transition-colors"
            >
              Redefinir Baseline Confiável
            </button>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-primary hover:bg-primary-container text-on-primary hover:text-on-primary-container rounded-lg text-xs font-headline font-bold transition-all shadow-[0_0_12px_rgba(173,198,255,0.3)]"
            >
              {saving ? 'Gravando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
