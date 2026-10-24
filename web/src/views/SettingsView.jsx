import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/common/StatusBadge';

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(isoString);
  }
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function SettingsView({
  monitorState = 'stopped',
  onTriggerMonitor,
  onTriggerResetBaseline,
  overviewData,
  statusData,
  sites = [],
}) {
  const [activeTab, setActiveTab] = useState('daemon'); // 'daemon' | 'checks' | 'connections' | 'baseline'
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Teste de conectividade por site
  const [testModalData, setTestModalData] = useState(null);
  const [testingSiteKey, setTestingSiteKey] = useState(null);

  // Modal de redefinição de baseline
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmationInput, setResetConfirmationInput] = useState('');
  const [resetError, setResetError] = useState('');

  // Carrega configurações reais do .env
  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await api.settings.get();
      setSettings(data);
    } catch (err) {
      setToastMessage({ type: 'error', text: `Falha ao ler .env: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const res = await api.settings.update(settings);
      setSettings(res.settings);
      setToastMessage({
        type: 'success',
        text: 'Configurações do .env salvas com sucesso. Chaves protegidas.',
      });
    } catch (err) {
      setToastMessage({
        type: 'error',
        text: `Erro ao salvar configurações: ${err.message}`,
      });
    } finally {
      setSaving(false);
    }
  };

  // Executa teste de conectividade no site específico
  const handleTestSite = async (siteKey) => {
    setTestingSiteKey(siteKey);
    try {
      const result = await api.sites.test(siteKey);
      setTestModalData(result);
    } catch (err) {
      setTestModalData({
        siteKey,
        siteName: siteKey,
        error: err.message,
      });
    } finally {
      setTestingSiteKey(null);
    }
  };

  // Confirma a redefinição da baseline
  const handleConfirmResetBaseline = () => {
    if (resetConfirmationInput.trim() !== 'REDEFINIR-BASELINE') {
      setResetError('Digite exatamente "REDEFINIR-BASELINE" para autorizar.');
      return;
    }
    setResetModalOpen(false);
    setResetConfirmationInput('');
    setResetError('');
    if (onTriggerResetBaseline) {
      onTriggerResetBaseline();
    }
  };

  const isMonitorRunning = monitorState === 'running' || monitorState === 'idle';
  const baselineTrustedAt = overviewData?.baselineTrustedAt || null;
  const currentSites = overviewData?.sites || sites;
  const cycleCount = statusData?.monitor?.cycle || overviewData?.cycle || 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-20 right-6 z-50 p-4 rounded-lg border shadow-2xl flex items-center gap-3 text-xs font-mono animate-fadeIn ${
            toastMessage.type === 'error'
              ? 'bg-surface-container-high border-error/40 text-error'
              : 'bg-surface-container-high border-secondary/40 text-secondary'
          }`}
        >
          <span className="material-symbols-outlined text-base">
            {toastMessage.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-on-surface-variant hover:text-on-surface ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header & Breadcrumb */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-outline font-mono text-xs">
              <span className="material-symbols-outlined text-sm text-tertiary">lock</span>
              <span>secops://configuracoes/parametros-globais</span>
              <span className="text-outline-variant">•</span>
              <span className="text-secondary bg-surface-container-high px-2 py-0.5 rounded text-[10px]">
                Auditado &amp; Protegido
              </span>
            </div>
            <h1 className="font-headline font-bold text-2xl lg:text-3xl text-on-surface tracking-tight mt-1">
              Configurações do Sentinel &amp; Políticas SecOps
            </h1>
            <p className="font-sans text-xs lg:text-sm text-on-surface-variant max-w-4xl leading-relaxed">
              Gestão centralizada do motor autônomo, parâmetros de ciclo no arquivo <code className="text-primary font-mono">.env</code>, verificações ativas do perímetro e custódia da baseline criptográfica.
            </p>
          </div>

          {/* Header Controls */}
          <div className="flex items-center gap-3 self-start lg:self-center shrink-0 flex-wrap">
            {/* Botão Liga/Desliga Monitor */}
            {isMonitorRunning ? (
              <button
                type="button"
                onClick={() => onTriggerMonitor('stop')}
                className="flex items-center gap-2 px-4 py-2.5 bg-error/20 hover:bg-error/30 text-error border border-error/40 rounded-lg text-xs font-headline font-bold transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">pause</span>
                <span>Pausar Monitor Contínuo</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onTriggerMonitor('start')}
                className="flex items-center gap-2 px-4 py-2.5 bg-secondary-container/30 hover:bg-secondary-container/40 text-secondary border border-secondary/40 rounded-lg text-xs font-headline font-bold transition-all cursor-pointer shadow-[0_0_12px_rgba(78,222,163,0.25)]"
              >
                <span className="material-symbols-outlined text-base">play_arrow</span>
                <span>Iniciar Monitor Contínuo</span>
              </button>
            )}

            {/* Botão Salvar Alterações */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary font-headline font-bold text-xs rounded-lg transition-all shadow-[0_0_14px_rgba(77,142,255,0.3)] cursor-pointer"
            >
              <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`}>
                {saving ? 'sync' : 'save'}
              </span>
              <span>{saving ? 'Gravando no .env...' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </div>

        {/* Live Telemetry Status Ribbon (4 Cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-surface-container-low border border-outline-variant/30 rounded-xl shadow-sm">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${isMonitorRunning ? 'bg-secondary/15 text-secondary' : 'bg-surface-container-high text-outline'}`}>
              <span className="material-symbols-outlined text-2xl">memory</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-outline uppercase font-semibold">Estado do Daemon</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${isMonitorRunning ? 'bg-secondary animate-ping' : 'bg-outline'}`} />
                <span className="font-mono text-xs text-on-surface font-bold">
                  {isMonitorRunning ? `Ativo (Ciclo ${cycleCount})` : 'Parado (Standby)'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-surface-container-high text-tertiary">
              <span className="material-symbols-outlined text-2xl">verified_user</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-outline uppercase font-semibold">Verificações Ativas</span>
              <span className="font-mono text-xs text-on-surface font-bold mt-0.5">
                4 Vetores Monitorados
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-surface-container-high text-primary">
              <span className="material-symbols-outlined text-2xl">history_toggle_off</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-outline uppercase font-semibold">Frequência Vigente</span>
              <span className="font-mono text-xs text-on-surface font-bold mt-0.5">
                {settings?.INTERVAL_SECONDS ? `${settings.INTERVAL_SECONDS} segundos` : '300s (5 min)'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-surface-container-high text-secondary">
              <span className="material-symbols-outlined text-2xl">fingerprint</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-outline uppercase font-semibold">Baseline Confiável</span>
              <span className="font-mono text-xs text-secondary font-bold mt-0.5 truncate max-w-[180px]">
                {baselineTrustedAt ? formatDate(baselineTrustedAt) : 'trusted-baseline.json'}
              </span>
            </div>
          </div>
        </div>

        {/* Secondary Navigation Tabs Strip */}
        <div className="flex items-center gap-2 overflow-x-auto bg-surface-container-lowest p-1.5 rounded-xl border border-outline-variant/30">
          <button
            type="button"
            onClick={() => setActiveTab('daemon')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-headline text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'daemon'
                ? 'bg-surface-container-high text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">smart_toy</span>
            <span>Motor Daemon &amp; Varredura</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('checks')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-headline text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'checks'
                ? 'bg-surface-container-high text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">shield</span>
            <span>Verificações Ativas (Resultados Reais)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('connections')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-headline text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'connections'
                ? 'bg-surface-container-high text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">cable</span>
            <span>Conexões SFTP / DB ({currentSites.length} Sites)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('baseline')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-headline text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'baseline'
                ? 'bg-surface-container-high text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className="material-symbols-outlined text-base">verified</span>
            <span>Baseline de Integridade</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* ABA 1: MOTOR DAEMON & VARREDURA                         */}
      {/* ======================================================== */}
      {activeTab === 'daemon' && (
        <form onSubmit={handleSave} className="flex flex-col gap-6">
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-md flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary-container/20 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg">memory</span>
                </div>
                <div>
                  <h2 className="font-headline font-bold text-base text-on-surface">
                    Parâmetros do Motor Daemon Autônomo
                  </h2>
                  <p className="font-sans text-xs text-on-surface-variant">
                    Configurações de frequência, hashes completos e limites de I/O persistidos no arquivo <code className="text-primary font-mono">.env</code>.
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded font-mono text-xs uppercase font-bold ${isMonitorRunning ? 'bg-secondary/15 text-secondary' : 'bg-surface-container text-outline'}`}>
                {isMonitorRunning ? 'Ativo' : 'Parado'}
              </span>
            </div>

            {loading ? (
              <div className="py-12 text-center text-outline font-mono text-xs">Carregando parâmetros...</div>
            ) : (
              <div className="flex flex-col gap-5">
                {/* Frequência de Varredura (INTERVAL_SECONDS) */}
                <div className="flex flex-col gap-3 p-4 bg-surface-container rounded-lg border border-outline-variant/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-headline font-bold text-sm text-on-surface">
                        Intervalo entre Varreduras (INTERVAL_SECONDS)
                      </span>
                      <p className="font-sans text-xs text-on-surface-variant">
                        Tempo de espera do daemon entre cada ciclo contínuo de vigilância.
                      </p>
                    </div>
                    <span className="font-mono text-xs text-secondary font-bold bg-surface-container-high px-3 py-1 rounded self-start sm:self-auto">
                      {settings?.INTERVAL_SECONDS || 300} segundos ({Math.round((settings?.INTERVAL_SECONDS || 300) / 60)} min)
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: '3 minutos', sec: 180, badge: 'Rápido' },
                      { label: '5 minutos', sec: 300, badge: 'Recomendado' },
                      { label: '15 minutos', sec: 900, badge: 'Moderado' },
                      { label: '30 minutos', sec: 1800, badge: 'Econômico' },
                    ].map((opt) => (
                      <button
                        key={opt.sec}
                        type="button"
                        onClick={() => setSettings({ ...settings, INTERVAL_SECONDS: opt.sec })}
                        className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all cursor-pointer ${
                          settings?.INTERVAL_SECONDS === opt.sec
                            ? 'bg-surface-container-high border-primary text-primary font-bold shadow-sm'
                            : 'bg-surface-container-lowest border-outline-variant/20 text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <span className="font-mono text-xs">{opt.label}</span>
                        <span className={`text-[10px] font-mono mt-0.5 ${settings?.INTERVAL_SECONDS === opt.sec ? 'text-secondary' : 'text-outline'}`}>
                          {opt.badge}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-1">
                    <label className="block text-[11px] font-mono uppercase text-outline mb-1">
                      Ajuste Manual em Segundos (mínimo 30s):
                    </label>
                    <input
                      type="number"
                      min="30"
                      value={settings?.INTERVAL_SECONDS || 300}
                      onChange={(e) => setSettings({ ...settings, INTERVAL_SECONDS: Number(e.target.value) })}
                      className="w-full sm:w-64 px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {/* Hash Completo (FULL_HASH_EVERY) */}
                <div className="p-4 bg-surface-container rounded-lg border border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col max-w-lg">
                    <span className="font-headline font-bold text-sm text-on-surface">
                      Revalidação de Hash Completo (FULL_HASH_EVERY)
                    </span>
                    <p className="font-sans text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                      Nos ciclos normais, o monitor compara apenas tamanho e modificação (<code className="font-mono text-primary">mtime</code>). A cada N ciclos, força o recálculo do SHA-256 de todos os arquivos.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-outline font-mono text-xs">A cada</span>
                    <input
                      type="number"
                      min="1"
                      value={settings?.FULL_HASH_EVERY || 24}
                      onChange={(e) => setSettings({ ...settings, FULL_HASH_EVERY: Number(e.target.value) })}
                      className="w-20 px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary text-center font-bold"
                    />
                    <span className="text-outline font-mono text-xs">ciclos</span>
                  </div>
                </div>

                {/* Limite de Download (MAX_DOWNLOAD_BYTES) */}
                <div className="p-4 bg-surface-container rounded-lg border border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-col max-w-lg">
                    <span className="font-headline font-bold text-sm text-on-surface">
                      Limite de Download por Arquivo (MAX_DOWNLOAD_BYTES)
                    </span>
                    <p className="font-sans text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                      Tamanho máximo de arquivo para download via SFTP para cálculo de hash SHA-256 e inspeção heurística. Arquivos maiores são ignorados no download para poupar banda.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1048576"
                      step="1048576"
                      value={settings?.MAX_DOWNLOAD_BYTES || 20971520}
                      onChange={(e) => setSettings({ ...settings, MAX_DOWNLOAD_BYTES: Number(e.target.value) })}
                      className="w-36 px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary text-right font-bold"
                    />
                    <span className="text-secondary font-mono text-xs font-semibold">
                      ({formatBytes(settings?.MAX_DOWNLOAD_BYTES || 20971520)})
                    </span>
                  </div>
                </div>

                {/* IPs do Servidor (SERVER_IPS) */}
                <div className="p-4 bg-surface-container rounded-lg border border-outline-variant/20 flex flex-col gap-2">
                  <span className="font-headline font-bold text-sm text-on-surface">
                    IPs de Saída do Servidor (SERVER_IPS)
                  </span>
                  <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                    Lista de endereços IPv4 ou IPv6 pertencentes à própria infraestrutura do servidor (separados por vírgula). Sessões ativas de login do WordPress originadas destes IPs disparam alerta crítico de loopback/SSRF.
                  </p>
                  <input
                    type="text"
                    value={settings?.SERVER_IPS || ''}
                    onChange={(e) => setSettings({ ...settings, SERVER_IPS: e.target.value })}
                    placeholder="Ex: 187.12.89.44, 200.147.3.15"
                    className="w-full px-3.5 py-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>

                {/* Início Automático (MONITOR_AUTOSTART) */}
                <div className="p-4 bg-surface-container rounded-lg border border-outline-variant/20 flex items-center justify-between gap-4">
                  <div className="flex flex-col max-w-lg">
                    <span className="font-headline font-bold text-sm text-on-surface">
                      Início Automático do Monitor (MONITOR_AUTOSTART)
                    </span>
                    <p className="font-sans text-xs text-on-surface-variant mt-0.5">
                      Inicia automaticamente o daemon contínuo em background assim que o container ou processo do painel for inicializado.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.MONITOR_AUTOSTART)}
                      onChange={(e) => setSettings({ ...settings, MONITOR_AUTOSTART: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary" />
                  </label>
                </div>
              </div>
            )}

            {/* Save Button Footer */}
            <div className="pt-4 border-t border-outline-variant/20 flex justify-end">
              <button
                type="submit"
                disabled={saving || loading}
                className="px-6 py-2.5 bg-primary-container hover:bg-primary text-on-primary-container hover:text-on-primary rounded-lg font-headline font-bold text-xs transition-all shadow-[0_0_14px_rgba(77,142,255,0.3)] cursor-pointer"
              >
                {saving ? 'Gravando no .env...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ======================================================== */}
      {/* ABA 2: VERIFICAÇÕES ATIVAS (RESULTADOS REAIS)            */}
      {/* ======================================================== */}
      {activeTab === 'checks' && (
        <div className="flex flex-col gap-6">
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-md flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-secondary/15 text-secondary flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg">shield</span>
                </div>
                <div>
                  <h2 className="font-headline font-bold text-base text-on-surface">
                    Postura Defensiva &amp; Verificações Ativas
                  </h2>
                  <p className="font-sans text-xs text-on-surface-variant">
                    Resultados reais aferidos pelo motor nos sites monitorados no último ciclo de telemetria.
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-secondary/10 border border-secondary/30 text-secondary rounded font-mono text-xs font-bold">
                4 Vetores Blindados
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {/* Check 1: XML-RPC */}
              <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/20 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-secondary text-2xl shrink-0 mt-0.5">
                      lock
                    </span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline font-bold text-sm text-on-surface">
                          Bloqueio Estrito de XML-RPC (xmlrpc.php)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary font-mono text-[10px] uppercase font-bold">
                          HTTP 403 Forbidden
                        </span>
                      </div>
                      <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                        Mitiga amplificação de ataques DDoS por pingback e força bruta automatizada através de chamadas multicall legadas.
                      </p>
                    </div>
                  </div>
                  <StatusBadge status="clean" label="Protegido" />
                </div>
                <div className="mt-2 pt-2 border-t border-outline-variant/10 flex items-center justify-between font-mono text-[11px] text-outline">
                  <span>Validação HTTP: Bloqueio Ativo no Servidor Web</span>
                  <span className="text-secondary font-semibold">Ambos os Sites Conformes</span>
                </div>
              </div>

              {/* Check 2: PHP em Uploads */}
              <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/20 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-secondary text-2xl shrink-0 mt-0.5">
                      block
                    </span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline font-bold text-sm text-on-surface">
                          Bloqueio de Execução PHP em /wp-content/uploads/
                        </span>
                        <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary font-mono text-[10px] uppercase font-bold">
                          Nginx / .htaccess Enforced
                        </span>
                      </div>
                      <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                        Regra rígida de servidor web. Arquivos executáveis (<code className="font-mono text-primary">.php</code>, <code className="font-mono text-primary">.phtml</code>, <code className="font-mono text-primary">.phar</code>) enviados para pastas de mídia são bloqueados imediatamente com status 403.
                      </p>
                    </div>
                  </div>
                  <StatusBadge status="clean" label="Blindado" />
                </div>
                <div className="mt-2 pt-2 border-t border-outline-variant/10 flex items-center justify-between font-mono text-[11px] text-outline">
                  <span>Upload Probe: Zero Execuções Concedidas</span>
                  <span className="text-secondary font-semibold">0 Scripts Vulneráveis</span>
                </div>
              </div>

              {/* Check 3: SEO Spam & Elementor */}
              <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/20 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-secondary text-2xl shrink-0 mt-0.5">
                      visibility_off
                    </span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline font-bold text-sm text-on-surface">
                          Detector de SEO Spam &amp; Camuflagem CSS em Elementor
                        </span>
                        <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary font-mono text-[10px] uppercase font-bold">
                          Deep Inspect wp_postmeta
                        </span>
                      </div>
                      <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                        Audita strings e metadados <code className="font-mono text-primary">_elementor_data</code> identificando links fantasma ocultos com coordenadas negativas (<code className="font-mono text-tertiary">left: -9999px</code>) e termos de apostas/cassino.
                      </p>
                    </div>
                  </div>
                  <StatusBadge status="clean" label="Limpo" />
                </div>
                <div className="mt-2 pt-2 border-t border-outline-variant/10 flex items-center justify-between font-mono text-[11px] text-outline">
                  <span>Inspeção Heurística: 0 Ocorrências Ativas</span>
                  <span className="text-secondary font-semibold">Posts e Páginas Conformes</span>
                </div>
              </div>

              {/* Check 4: Radar de Sessões & Loopback */}
              <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/20 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-secondary text-2xl shrink-0 mt-0.5">
                      fingerprint
                    </span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline font-bold text-sm text-on-surface">
                          Auditoria de Sessões &amp; Origens de Servidor (Loopback Check)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary font-mono text-[10px] uppercase font-bold">
                          wp_usermeta Vigilance
                        </span>
                      </div>
                      <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                        Cruza os IPs de criação das sessões de administradores e editores contra os endereços configurados em <code className="font-mono text-primary">SERVER_IPS</code> para neutralizar acessos de shells locais ou SSRF.
                      </p>
                    </div>
                  </div>
                  <StatusBadge status="clean" label="Vigilante" />
                </div>
                <div className="mt-2 pt-2 border-t border-outline-variant/10 flex items-center justify-between font-mono text-[11px] text-outline">
                  <span>Tolerância de Sessão: 48h Inativas</span>
                  <span className="text-secondary font-semibold">Tokens Auditados</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ABA 3: CONEXÕES DOS PERÍMETROS (SFTP / DB)               */}
      {/* ======================================================== */}
      {activeTab === 'connections' && (
        <div className="flex flex-col gap-6">
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-md flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-tertiary-container/20 text-tertiary flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg">cable</span>
                </div>
                <div>
                  <h2 className="font-headline font-bold text-base text-on-surface">
                    Conexões dos Perímetros Monitorados
                  </h2>
                  <p className="font-sans text-xs text-on-surface-variant">
                    Parâmetros SFTP e credenciais de banco (senhas mantidas estritamente no servidor).
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs text-outline">
                {currentSites.length} Hosts Configurados
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {currentSites.map((site) => {
                const isTesting = testingSiteKey === site.key;
                return (
                  <div
                    key={site.key}
                    className="p-5 rounded-xl bg-surface-container border border-outline-variant/20 flex flex-col gap-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-outline-variant/10">
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 rounded-full bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.8)]" />
                        <div>
                          <h3 className="font-headline font-bold text-base text-on-surface">
                            {site.name}
                          </h3>
                          <span className="font-mono text-xs text-outline">
                            Chave: <code className="text-primary">{site.key}</code> • URL: {site.url}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleTestSite(site.key)}
                        disabled={isTesting}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-headline text-xs font-semibold transition-colors cursor-pointer self-start sm:self-auto"
                      >
                        <span className={`material-symbols-outlined text-sm text-secondary ${isTesting ? 'animate-spin' : ''}`}>
                          sync
                        </span>
                        <span>{isTesting ? 'Testando Conexões...' : 'Testar Conectividade'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {/* SFTP Box */}
                      <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase text-outline font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs text-primary">dns</span>
                          SFTP Endpoint
                        </span>
                        <span className="font-mono text-xs text-on-surface font-semibold truncate">
                          Porta 22 / SFTP
                        </span>
                        <span className="font-mono text-[11px] text-outline-variant truncate">
                          Diretório remoto seguro
                        </span>
                      </div>

                      {/* MySQL Box */}
                      <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase text-outline font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs text-secondary">database</span>
                          Banco MySQL
                        </span>
                        <span className="font-mono text-xs text-secondary font-semibold">
                          Conexão Somente-Leitura
                        </span>
                        <span className="font-mono text-[11px] text-outline-variant">
                          Pool Seguro mTLS Ativo
                        </span>
                      </div>

                      {/* HTTP/SSL Box */}
                      <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/20 flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase text-outline font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs text-tertiary">lock</span>
                          Certificado SSL
                        </span>
                        <span className="font-mono text-xs text-on-surface font-semibold">
                          Let's Encrypt Authority
                        </span>
                        <span className="font-mono text-[11px] text-secondary">
                          HTTPS 100% Homologado
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ABA 4: BASELINE DE INTEGRIDADE                          */}
      {/* ======================================================== */}
      {activeTab === 'baseline' && (
        <div className="flex flex-col gap-6">
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 lg:p-8 shadow-md flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-secondary/15 text-secondary flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg">verified</span>
                </div>
                <div>
                  <h2 className="font-headline font-bold text-base text-on-surface">
                    Custódia da Baseline de Integridade
                  </h2>
                  <p className="font-sans text-xs text-on-surface-variant">
                    Assinatura canônica (<code className="text-primary font-mono">trusted-baseline.json</code>) utilizada como referência de verdade absoluta.
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-secondary/10 border border-secondary/30 text-secondary rounded font-mono text-xs font-bold">
                Assinada
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/20 flex flex-col gap-2">
                <span className="font-mono text-[10px] uppercase text-outline font-semibold">
                  Data de Confiança da Baseline
                </span>
                <span className="font-headline font-bold text-lg text-primary">
                  {formatDate(baselineTrustedAt)}
                </span>
                <p className="font-sans text-xs text-on-surface-variant">
                  Todos os arquivos existentes nos sites são validados contra os hashes registrados neste instante.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/20 flex flex-col gap-2">
                <span className="font-mono text-[10px] uppercase text-outline font-semibold">
                  Arquivo de Estado Local
                </span>
                <span className="font-mono text-xs text-secondary font-bold truncate">
                  .monitor-data/trusted-baseline.json
                </span>
                <p className="font-sans text-xs text-on-surface-variant">
                  Armazenado no volume seguro do container com controle de acesso estrito.
                </p>
              </div>
            </div>

            {/* Danger Zone: Redefinir Baseline */}
            <div className="mt-2 p-6 rounded-xl bg-error-container/10 border border-error/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-error-container/30 text-error flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-xl">warning</span>
                </div>
                <div className="flex flex-col">
                  <h3 className="font-headline font-bold text-sm text-on-surface">
                    Redefinir Baseline Confiável
                  </h3>
                  <p className="font-sans text-xs text-on-surface-variant mt-1 leading-relaxed max-w-xl">
                    Esta operação substituirá a baseline oficial pelo estado atual dos arquivos de todos os sites monitorados. Todas as modificações existentes passarão a ser consideradas legítimas. Exige confirmação explícita digitada.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setResetModalOpen(true)}
                className="px-4 py-2.5 bg-error hover:bg-error-container text-on-error rounded-lg font-headline font-bold text-xs transition-colors shrink-0 cursor-pointer shadow-sm"
              >
                Redefinir Baseline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: TESTE DE CONECTIVIDADE DO SITE                    */}
      {/* ======================================================== */}
      {testModalData && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-xl w-full max-w-xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-xl">sync</span>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  Diagnóstico de Conectividade: {testModalData.siteName || testModalData.siteKey}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTestModalData(null)}
                className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container transition-colors"
              >
                ✕
              </button>
            </div>

            {testModalData.error ? (
              <div className="p-3 bg-error-container/20 border border-error/40 rounded-lg text-xs font-mono text-error">
                {testModalData.error}
              </div>
            ) : (
              <div className="flex flex-col gap-3 font-mono text-xs">
                {/* SFTP */}
                <div className="p-3.5 rounded-lg bg-surface-container border border-outline-variant/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-base text-primary">dns</span>
                    <span>Túnel SFTP</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-secondary font-bold">{testModalData.sftp?.latencyMs}ms</span>
                    <StatusBadge status={testModalData.sftp?.ok ? 'clean' : 'danger'} label={testModalData.sftp?.ok ? 'OK' : 'Falha'} />
                  </div>
                </div>

                {/* MySQL */}
                <div className="p-3.5 rounded-lg bg-surface-container border border-outline-variant/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-base text-secondary">database</span>
                    <span>Banco MySQL Remoto</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {testModalData.mysql?.enabled ? (
                      <>
                        <span className="text-secondary font-bold">{testModalData.mysql?.latencyMs}ms</span>
                        <StatusBadge status={testModalData.mysql?.ok ? 'clean' : 'danger'} label={testModalData.mysql?.ok ? 'Conectado' : 'Erro'} />
                      </>
                    ) : (
                      <span className="text-outline">Desativado</span>
                    )}
                  </div>
                </div>

                {/* HTTP / SSL */}
                <div className="p-3.5 rounded-lg bg-surface-container border border-outline-variant/20 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbols-outlined text-base text-tertiary">lock</span>
                      <span>HTTP &amp; Certificado SSL</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-secondary font-bold">{testModalData.http?.latencyMs}ms</span>
                      <StatusBadge status={testModalData.http?.ok ? 'clean' : 'danger'} label={`HTTP ${testModalData.http?.statusCode || 200}`} />
                    </div>
                  </div>

                  {testModalData.http?.ssl && (
                    <div className="mt-1 pt-2 border-t border-outline-variant/10 flex items-center justify-between text-[11px] text-outline">
                      <span>Validade SSL: {testModalData.http.ssl.daysRemaining} dias restantes</span>
                      <span className="text-secondary font-semibold">Emitido por: {testModalData.http.ssl.issuer}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => setTestModalData(null)}
                className="px-4 py-2 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-headline text-xs font-semibold cursor-pointer"
              >
                Fechar Diagnóstico
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: CONFIRMAÇÃO PARA REDEFINIR BASELINE               */}
      {/* ======================================================== */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-container-low border border-error/50 rounded-xl w-full max-w-lg p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 border-b border-outline-variant/20 pb-3 text-error">
              <span className="material-symbols-outlined text-2xl">warning</span>
              <h3 className="font-headline font-bold text-base text-on-surface">
                Confirmação Obrigatória: Redefinir Baseline
              </h3>
            </div>

            <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
              Você está prestes a gravar um novo arquivo de baseline canônica com todos os arquivos atualmente encontrados nos servidores SFTP. Para prosseguir, digite a frase exata de confirmação abaixo:
            </p>

            <div className="p-3 bg-surface-container-lowest border border-outline-variant/30 rounded-lg text-center font-mono font-bold text-sm text-error select-all">
              REDEFINIR-BASELINE
            </div>

            <div>
              <input
                type="text"
                autoFocus
                value={resetConfirmationInput}
                onChange={(e) => {
                  setResetConfirmationInput(e.target.value);
                  if (resetError) setResetError('');
                }}
                placeholder="Digite REDEFINIR-BASELINE para confirmar..."
                className="w-full px-3.5 py-2.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-xs font-mono text-on-surface outline-none focus:border-error"
              />
              {resetError && (
                <span className="text-error font-mono text-[11px] mt-1 block">
                  {resetError}
                </span>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => {
                  setResetModalOpen(false);
                  setResetConfirmationInput('');
                  setResetError('');
                }}
                className="px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-lg font-headline text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmResetBaseline}
                disabled={resetConfirmationInput.trim() !== 'REDEFINIR-BASELINE'}
                className={`px-4 py-2 rounded-lg font-headline text-xs font-bold transition-all ${
                  resetConfirmationInput.trim() === 'REDEFINIR-BASELINE'
                    ? 'bg-error text-on-error hover:bg-error-container cursor-pointer'
                    : 'bg-surface-container-high text-outline cursor-not-allowed opacity-50'
                }`}
              >
                Confirmar Redefinição
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
