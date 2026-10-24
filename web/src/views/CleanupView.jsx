import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/common/StatusBadge';

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

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

function timeAgo(dateInput) {
  if (!dateInput) return '—';
  try {
    const time = typeof dateInput === 'number' ? (dateInput > 1e11 ? dateInput : dateInput * 1000) : new Date(dateInput).getTime();
    const diff = Math.floor((Date.now() - time) / 1000);
    if (diff < 60) return `Há ${diff}s`;
    if (diff < 3600) return `Há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Há ${Math.floor(diff / 3600)}h`;
    return `Há ${Math.floor(diff / 86400)}d`;
  } catch {
    return '—';
  }
}

export function CleanupView({
  planData,
  onTriggerPlan,
  onExecuteClean,
  isExecuting = false,
  onOpenTerminal,
  onReloadPlan,
}) {
  const plan = planData?.plan || null;
  const summary = planData?.summary || {};
  const fileActions = plan?.fileActions || [];
  const databaseActions = plan?.databaseActions || [];
  const manualReview = plan?.manualReview || [];
  const totalActions = fileActions.length + databaseActions.length;

  const [backupsData, setBackupsData] = useState({ plans: [], others: [] });
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [markingKey, setMarkingKey] = useState(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [copiedPhrase, setCopiedPhrase] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Carrega histórico real de backups da limpeza
  const loadBackups = async () => {
    setBackupsLoading(true);
    try {
      const data = await api.backups();
      setBackupsData(data || { plans: [], others: [] });
    } catch {
      setBackupsData({ plans: [], others: [] });
    } finally {
      setBackupsLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, [planData]);

  // Alterna o status de revisão manual do item
  const handleToggleReview = async (item) => {
    const newReviewedStatus = !item.reviewed;
    setMarkingKey(item.key);
    try {
      await api.manualReview.mark(item.key, newReviewedStatus, 'Marcado via painel SecOps');
      setToastMessage({
        type: 'success',
        text: newReviewedStatus
          ? `Item "${item.path || item.key}" marcado como revisado.`
          : `Item "${item.path || item.key}" desmarcado (pendente).`,
      });
      if (onReloadPlan) {
        onReloadPlan();
      }
    } catch (err) {
      setToastMessage({
        type: 'error',
        text: `Falha ao atualizar revisão: ${err.message}`,
      });
    } finally {
      setMarkingKey(null);
    }
  };

  const confirmationCode = plan?.id ? `LIMPAR-${plan.id}` : '';

  const handleCopyCode = () => {
    if (!confirmationCode) return;
    navigator.clipboard.writeText(confirmationCode).then(() => {
      setCopiedPhrase(true);
      setTimeout(() => setCopiedPhrase(false), 2000);
    });
  };

  const handleCopyJson = () => {
    if (!plan) return;
    navigator.clipboard.writeText(JSON.stringify(plan, null, 2)).then(() => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    });
  };

  const pendingManualCount = manualReview.filter((m) => !m.reviewed).length;
  const reviewedManualCount = manualReview.filter((m) => m.reviewed).length;
  const recentBackup = backupsData.plans?.[0] || null;

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

      {/* Top Incident / Execution Header Banner */}
      <div className="relative overflow-hidden rounded-xl bg-surface-container-low border border-outline-variant/30 shadow-xl p-6 lg:p-8">
        <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <div className="absolute -left-12 -bottom-12 w-64 h-64 rounded-full bg-secondary/5 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div className="flex flex-col gap-2 max-w-3xl">
            {/* Badges Ribbon */}
            <div className="flex items-center gap-2 flex-wrap">
              {plan ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-secondary/10 border border-secondary/30 text-secondary font-mono text-[10px] uppercase rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.8)]" />
                  Pronto para Execução Segura
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-container-high text-outline font-mono text-[10px] uppercase rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-outline" />
                  Nenhum Plano Gerado
                </span>
              )}

              {plan?.id && (
                <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant font-mono text-xs rounded border border-outline-variant/30">
                  ID: <strong className="text-primary font-semibold">PLANO-{plan.id}</strong>
                </span>
              )}

              {plan?.createdAt && (
                <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant font-mono text-xs rounded border border-outline-variant/30">
                  Criado: {formatDate(plan.createdAt)} ({timeAgo(plan.createdAt)})
                </span>
              )}

              <span className="text-outline-variant font-mono text-xs">•</span>
              <span className="font-mono text-xs text-on-surface-variant">
                Fonte: <span className="text-on-surface font-semibold">last-cleanup-plan.json</span>
              </span>
            </div>

            {/* Title & Description */}
            <h1 className="font-headline font-bold text-2xl lg:text-3xl text-on-surface tracking-tight mt-1">
              Central de Limpeza Assistida &amp; Resposta a Incidentes
            </h1>
            <p className="font-sans text-xs lg:text-sm text-on-surface-variant leading-relaxed">
              Remediação de vetores detectados com atomicidade transacional e integridade de banco de dados. Cada alteração possui rollback diferencial garantido via backups tarball e dumps SQL antes da execução.
            </p>

            {/* 3 Inline Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 mt-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                <span className="material-symbols-outlined text-secondary text-2xl">verified</span>
                <div className="flex flex-col">
                  <span className="font-headline font-bold text-lg text-on-surface leading-tight">
                    {totalActions} Validadas
                  </span>
                  <span className="font-mono text-[10px] uppercase text-outline">
                    Ações Automáticas
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                <span className={`material-symbols-outlined text-2xl ${pendingManualCount > 0 ? 'text-amber-400' : 'text-secondary'}`}>
                  {pendingManualCount > 0 ? 'person_alert' : 'check_circle'}
                </span>
                <div className="flex flex-col">
                  <span className="font-headline font-bold text-lg text-on-surface leading-tight">
                    {pendingManualCount} Pendente{pendingManualCount !== 1 ? 's' : ''}
                  </span>
                  <span className="font-mono text-[10px] uppercase text-outline">
                    Revisão Humana (HITL)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                <span className="material-symbols-outlined text-primary text-2xl">history</span>
                <div className="flex flex-col">
                  <span className="font-headline font-bold text-lg text-on-surface leading-tight">
                    {backupsData.plans?.length || 0} Backups
                  </span>
                  <span className="font-mono text-[10px] uppercase text-outline">
                    Pontos de Restauração
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Group Buttons */}
          <div className="flex flex-col sm:flex-row xl:flex-col gap-3 items-stretch xl:items-end justify-center shrink-0">
            {/* Botão Executar Plano */}
            <button
              type="button"
              onClick={onExecuteClean}
              disabled={isExecuting || !plan || totalActions === 0}
              className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-headline font-bold text-sm transition-all cursor-pointer ${
                !isExecuting && plan && totalActions > 0
                  ? 'bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-[0_0_20px_rgba(245,158,11,0.4)] active:scale-[0.99]'
                  : 'bg-surface-container-high text-outline cursor-not-allowed opacity-50'
              }`}
            >
              <span className="material-symbols-outlined text-lg">cleaning_services</span>
              <span>Executar Plano de Limpeza</span>
            </button>

            {/* Botão Gerar Novo Plano */}
            <button
              type="button"
              onClick={onTriggerPlan}
              disabled={isExecuting}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-headline font-semibold text-xs border border-outline-variant/40 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-base text-primary">refresh</span>
              <span>Gerar Novo Plano</span>
            </button>

            {/* Botão Inspecionar JSON */}
            {plan && (
              <button
                type="button"
                onClick={() => setJsonModalOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface-variant hover:text-on-surface font-mono text-xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm text-tertiary">data_object</span>
                <span>Inspecionar last-cleanup-plan.json</span>
              </button>
            )}
          </div>
        </div>

        {/* Safety Backup Callout */}
        {recentBackup && (
          <div className="mt-6 p-4 rounded-lg bg-surface-container-high border border-outline-variant/30 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start md:items-center gap-3">
              <span className="material-symbols-outlined text-secondary text-xl shrink-0 mt-0.5 md:mt-0">
                shield_lock
              </span>
              <div className="font-sans text-xs text-on-surface">
                <strong className="font-semibold text-secondary">Último Backup Atômico Criado:</strong>{' '}
                <span className="font-mono text-primary font-semibold">
                  {recentBackup.items?.[0]?.name || recentBackup.planId}
                </span>{' '}
                <span className="text-outline-variant">•</span>{' '}
                <span className="text-on-surface-variant font-mono">
                  {formatBytes(recentBackup.bytes)} ({timeAgo(recentBackup.executedAt || recentBackup.lastModifiedAt)})
                </span>{' '}
                <span className="text-outline-variant">•</span>{' '}
                <span className="text-on-surface-variant">Dump MySQL e tarball de arquivos salvos em .monitor-data/backups/</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('backups-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-primary hover:underline font-mono text-xs font-semibold shrink-0 flex items-center gap-1 cursor-pointer"
            >
              <span>Ver Histórico de Backups</span>
              <span className="material-symbols-outlined text-sm">south</span>
            </button>
          </div>
        )}
      </div>

      {/* Main 2-Column Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ======================================================== */}
        {/* COLUNA ESQUERDA (8 colunas): Ações Automáticas + HITL    */}
        {/* ======================================================== */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Seção 1: Ações Automáticas Prontas */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <h2 className="font-headline font-bold text-lg text-on-surface">
                  Ações Automáticas Prontas
                </h2>
                <span className="px-2.5 py-0.5 rounded bg-surface-container-high text-primary font-mono text-xs font-semibold border border-outline-variant/30">
                  {totalActions} Ações Mapeadas
                </span>
              </div>

              {confirmationCode && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-outline hidden sm:inline">Chave de Autorização:</span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 px-2.5 py-1 bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-amber-400 font-mono text-xs rounded transition-colors cursor-pointer"
                    title="Copiar frase exigida para execução"
                  >
                    <span>{confirmationCode}</span>
                    <span className="material-symbols-outlined text-xs">
                      {copiedPhrase ? 'check' : 'content_copy'}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {totalActions === 0 ? (
              <div className="p-8 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-full bg-secondary/10 text-secondary flex items-center justify-center mb-3">
                  <span className="material-symbols-outlined text-2xl">task_alt</span>
                </div>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  Nenhuma Ação Automática Pendente
                </h3>
                <p className="font-sans text-xs text-on-surface-variant max-w-md mt-1 mb-4">
                  O plano vigente não contém webshells, spam ou marcadores que exijam remediação automática. O perímetro está conforme com a baseline.
                </p>
                <button
                  type="button"
                  onClick={onTriggerPlan}
                  disabled={isExecuting}
                  className="px-4 py-2 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-headline text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">sync</span>
                  <span>Recalcular Plano</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Ações de Banco de Dados */}
                {databaseActions.map((action, idx) => (
                  <div
                    key={`db-${action.site || ''}-${action.type}-${idx}`}
                    className="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 hover:border-outline-variant/50 transition-colors flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded bg-primary-container/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
                          <span className="material-symbols-outlined text-base">database</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-headline font-bold text-sm text-on-surface">
                              {action.type === 'elementor_meta' || action.metaKey === '_elementor_data'
                                ? 'Remoção Cirúrgica de Blocos Ocultos no Elementor'
                                : action.type === 'posts_revisions'
                                ? 'Purga de Revisões de Páginas com Spam'
                                : action.type === 'session_tokens'
                                ? 'Encerramento de Tokens de Sessão Anômalos'
                                : `Ação de Banco: ${action.type}`}
                            </span>
                            <span className="px-2 py-0.5 bg-secondary/15 text-secondary font-mono text-[10px] uppercase rounded border border-secondary/30">
                              Backup Prévio no Snapshot
                            </span>
                            {action.site && (
                              <span className="px-2 py-0.5 bg-surface-container text-outline font-mono text-[10px] uppercase rounded">
                                Site: {action.site}
                              </span>
                            )}
                          </div>
                          <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                            {action.description ||
                              `Sanitização na tabela ${action.table || 'wp_posts / wp_postmeta'} para neutralizar injeções sem impactar dados legítimos.`}
                          </p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-outline text-xl shrink-0">
                        view_quilt
                      </span>
                    </div>

                    {/* Detalhes da Ação */}
                    <div className="mt-2 p-2.5 rounded bg-surface-container font-mono text-xs text-on-surface-variant flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 truncate max-w-xl">
                        <span className="text-outline text-[11px]">Alvo:</span>
                        <code className="text-primary text-[11px] font-semibold truncate">
                          {action.query || action.target || action.metaKey || `Post ID: ${action.postId || 'N/A'}`}
                        </code>
                      </div>
                      <span className="text-secondary font-mono text-[10px] uppercase font-bold shrink-0">
                        Integridade Assegurada
                      </span>
                    </div>
                  </div>
                ))}

                {/* Ações de Arquivos */}
                {fileActions.map((action, idx) => (
                  <div
                    key={`file-${action.site || ''}-${action.path || idx}`}
                    className="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 hover:border-outline-variant/50 transition-colors flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded bg-error-container/20 text-error flex items-center justify-center shrink-0 mt-0.5">
                          <span className="material-symbols-outlined text-base">
                            {action.action === 'restore' ? 'settings_backup_restore' : 'delete_sweep'}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-headline font-bold text-sm text-on-surface">
                              {action.action === 'restore'
                                ? 'Restauração de Arquivo Canônico da Baseline'
                                : 'Exclusão de Marcadores de Malware e Arquivos Temporários'}
                            </span>
                            <span className="px-2 py-0.5 bg-error-container text-on-error-container font-mono text-[10px] uppercase rounded">
                              {action.action === 'restore' ? 'Restaurar' : 'Excluir'}
                            </span>
                            {action.site && (
                              <span className="px-2 py-0.5 bg-surface-container text-outline font-mono text-[10px] uppercase rounded">
                                Site: {action.site}
                              </span>
                            )}
                          </div>
                          <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                            {action.description ||
                              `Exclusão física do artefato não catalogado na baseline oficial do WordPress ou restauração do hash canônico.`}
                          </p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-outline text-xl shrink-0">
                        description
                      </span>
                    </div>

                    <div className="mt-2 p-2.5 rounded bg-surface-container font-mono text-xs text-on-surface-variant flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 truncate max-w-xl">
                        <span className="text-outline text-[11px]">Caminho:</span>
                        <code className="text-error font-semibold text-[11px] truncate">
                          {action.path}
                        </code>
                      </div>
                      <span className="text-outline text-[10px]">
                        Backup em .monitor-data/backups/
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Seção 2: Revisão Humana Obrigatória (HITL) */}
          <div className="flex flex-col gap-4 mt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <h2 className="font-headline font-bold text-lg text-on-surface">
                  Revisão Humana Obrigatória (HITL)
                </h2>
                <span
                  className={`px-2.5 py-0.5 rounded font-mono text-xs font-semibold ${
                    pendingManualCount > 0
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      : 'bg-secondary/20 text-secondary border border-secondary/30'
                  }`}
                >
                  {pendingManualCount} Pendente{pendingManualCount !== 1 ? 's' : ''} / {manualReview.length} Total
                </span>
              </div>
              <span className="font-sans text-xs text-on-surface-variant hidden sm:inline">
                Decisão do operador registrada no painel
              </span>
            </div>

            {manualReview.length === 0 ? (
              <div className="p-6 rounded-xl bg-surface-container-low border border-outline-variant/30 flex items-center gap-3">
                <span className="material-symbols-outlined text-secondary text-2xl">check_circle</span>
                <div className="flex flex-col">
                  <h4 className="font-headline font-bold text-sm text-on-surface">
                    Nenhum Item de Revisão Manual Pendente
                  </h4>
                  <p className="font-sans text-xs text-on-surface-variant">
                    Nenhum arquivo ambíguo fora da baseline requer intervenção manual neste plano.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {manualReview.map((item, idx) => {
                  const isMarking = markingKey === item.key;
                  return (
                    <div
                      key={item.key || `hitl-${idx}`}
                      className={`p-5 rounded-xl border transition-all flex flex-col gap-3 ${
                        item.reviewed
                          ? 'bg-surface-container-low/70 border-outline-variant/30 opacity-75'
                          : 'bg-surface-container-low border-amber-400/40 shadow-lg'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${
                              item.reviewed
                                ? 'bg-secondary/15 text-secondary'
                                : 'bg-amber-400/15 text-amber-400'
                            }`}
                          >
                            <span className="material-symbols-outlined text-lg">
                              {item.reviewed ? 'verified' : 'unknown_document'}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-headline font-bold text-sm text-on-surface">
                                {item.reason || 'Arquivo não catalogado na baseline canônica'}
                              </h3>
                              {item.reviewed && (
                                <span className="px-2 py-0.5 rounded bg-secondary/15 text-secondary font-mono text-[10px] uppercase font-bold">
                                  Revisado
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-xs text-primary truncate max-w-lg mt-0.5">
                              {item.path || item.key}
                            </p>
                          </div>
                        </div>

                        {item.site && (
                          <span className="px-2.5 py-1 bg-surface-container text-outline font-mono text-xs rounded self-start sm:self-auto">
                            Site: {item.site}
                          </span>
                        )}
                      </div>

                      {/* Ações de Revisão HITL */}
                      <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20 flex-wrap gap-2">
                        <span className="font-sans text-xs text-on-surface-variant">
                          {item.reviewed
                            ? 'Este item foi aprovado para permanência pela equipe de SecOps.'
                            : 'Analise o arquivo via SFTP antes de marcar como revisado.'}
                        </span>

                        <button
                          type="button"
                          disabled={isMarking}
                          onClick={() => handleToggleReview(item)}
                          className={`px-3 py-1.5 rounded-lg font-headline text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                            item.reviewed
                              ? 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                              : 'bg-secondary text-on-secondary hover:bg-secondary-fixed'
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">
                            {item.reviewed ? 'undo' : 'done'}
                          </span>
                          <span>
                            {isMarking
                              ? 'Gravando...'
                              : item.reviewed
                              ? 'Desmarcar Revisão'
                              : 'Marcar como Revisado'}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ======================================================== */}
        {/* COLUNA DIREITA (4 colunas): Resumo + Rollback Backups   */}
        {/* ======================================================== */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Card 1: Resumo de Impacto */}
          <div className="p-6 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="font-headline font-bold text-base text-on-surface">
                Resumo de Impacto
              </span>
              <span className="material-symbols-outlined text-primary text-xl">tune</span>
            </div>

            <div className="space-y-2 font-sans text-xs">
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-container border border-outline-variant/10">
                <span className="text-on-surface-variant">Downtime Estimado</span>
                <span className="text-secondary font-mono font-bold">0s (Hotfix Atômico)</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-container border border-outline-variant/10">
                <span className="text-on-surface-variant">Ações em Banco (MySQL)</span>
                <span className="text-on-surface font-mono font-semibold">
                  {databaseActions.length} ações mapeadas
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-container border border-outline-variant/10">
                <span className="text-on-surface-variant">Arquivos Afetados</span>
                <span className="text-on-surface font-mono font-semibold">
                  {fileActions.length} alvos
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded bg-surface-container border border-outline-variant/10">
                <span className="text-on-surface-variant">Verificação Pós-Ação</span>
                <span className="text-primary font-mono">Healthcheck HTTP Automático</span>
              </div>
            </div>

            <div className="p-3 rounded bg-surface-container-highest/40 border border-outline-variant/20 flex items-start gap-2.5">
              <span className="material-symbols-outlined text-tertiary text-base shrink-0 mt-0.5">
                info
              </span>
              <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                O motor do Sentinel cria um snapshot tarball e dump SQL prévio de cada site antes de aplicar qualquer alteração física.
              </p>
            </div>
          </div>

          {/* Card 2: Histórico de Backups da Limpeza por Plano */}
          <div
            id="backups-section"
            className="p-6 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col gap-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-2xl">
                  replay_circle_filled
                </span>
                <span className="font-headline font-bold text-base text-on-surface">
                  Backups da Limpeza
                </span>
              </div>
              <button
                type="button"
                onClick={loadBackups}
                disabled={backupsLoading}
                className="text-outline hover:text-on-surface transition-colors p-1"
                title="Recarregar backups"
              >
                <span className={`material-symbols-outlined text-sm ${backupsLoading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
              </button>
            </div>

            <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
              Pontos de recuperação completos salvos antes de cada ciclo de remediação.
            </p>

            {backupsLoading ? (
              <div className="p-6 text-center text-outline font-mono text-xs">
                Carregando histórico de backups...
              </div>
            ) : backupsData.plans?.length === 0 ? (
              <div className="p-6 text-center text-outline font-sans text-xs bg-surface-container rounded-lg">
                Nenhum backup de limpeza registrado em <code className="font-mono text-primary">.monitor-data/backups/</code>.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {backupsData.plans.map((bkp, idx) => (
                  <div
                    key={bkp.planId || idx}
                    className="p-3.5 rounded-lg bg-surface-container border border-outline-variant/20 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-on-surface">
                        <span className="w-2 h-2 rounded-full bg-secondary" />
                        <span>PLANO-{bkp.planId}</span>
                      </span>
                      <span className="font-mono text-[11px] text-outline">
                        {timeAgo(bkp.executedAt || bkp.lastModifiedAt)}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 font-mono text-[11px] text-on-surface-variant">
                      {bkp.items?.map((item) => (
                        <div key={item.name} className="flex items-center justify-between truncate">
                          <span className="truncate max-w-[200px]" title={item.name}>
                            {item.name}
                          </span>
                          <span className="text-outline shrink-0 ml-2">
                            {formatBytes(item.bytes)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-outline-variant/10 text-[10px] uppercase font-mono text-outline">
                      <span>Total: {formatBytes(bkp.bytes)}</span>
                      <span className="text-secondary font-semibold">Snapshot Atômico</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Card 3: Sentinel Live Guard Status */}
          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.8)]" />
              <div className="flex flex-col">
                <span className="font-headline font-bold text-xs text-on-surface">
                  Agent Integrity Sentinel
                </span>
                <span className="font-mono text-[11px] text-on-surface-variant">
                  Auto-Lock em caso de falha de I/O
                </span>
              </div>
            </div>
            <span className="font-mono text-xs font-bold text-secondary">ARMED</span>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODAL: INSPEÇÃO JSON DE LAST-CLEANUP-PLAN.JSON          */}
      {/* ======================================================== */}
      {jsonModalOpen && plan && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-xl w-full max-w-3xl p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">data_object</span>
                <h3 className="font-headline font-bold text-base text-on-surface">
                  last-cleanup-plan.json (Plano de Remediação)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="px-3 py-1 bg-surface-container hover:bg-surface-container-high rounded text-xs font-mono text-on-surface flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">
                    {copiedJson ? 'check' : 'content_copy'}
                  </span>
                  <span>{copiedJson ? 'Copiado!' : 'Copiar JSON'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setJsonModalOpen(false)}
                  className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-4 font-mono text-xs overflow-y-auto text-primary flex-1">
              <pre className="leading-relaxed whitespace-pre-wrap">
                {JSON.stringify(plan, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => setJsonModalOpen(false)}
                className="px-4 py-2 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg font-headline text-xs font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
