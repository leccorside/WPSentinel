import React from 'react';
import { KpiCard } from '../components/common/KpiCard';

export function CleanupView({ planData, onTriggerPlan, onExecuteClean, isExecuting = false }) {
  const plan = planData?.plan;
  const summary = planData?.summary || {};
  const actionCount = summary.actions || 0;
  const manualCount = summary.manualReview || 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-on-surface-variant font-mono text-[11px] uppercase tracking-wider mb-1">
            <span>Remediação & Quarentena</span>
            <span>/</span>
            <span className="text-amber-400">Dupla Checagem Obrigatória</span>
          </div>
          <h1 className="font-headline font-bold text-2xl text-on-surface tracking-tight flex items-center gap-3">
            Central de Limpeza
            {plan?.id && (
              <span className="font-mono text-xs px-2 py-0.5 bg-surface-container-high rounded text-outline border border-outline-variant/30">
                Plano: {plan.id}
              </span>
            )}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTriggerPlan}
            disabled={isExecuting}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 rounded-lg text-xs font-headline font-semibold text-on-surface transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            <span>Gerar Novo Plano</span>
          </button>
          <button
            type="button"
            onClick={onExecuteClean}
            disabled={isExecuting}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-amber-950 rounded-lg text-xs font-headline font-semibold transition-all shadow-[0_0_14px_rgba(245,158,11,0.35)] cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">cleaning_services</span>
            <span>Executar Plano de Limpeza</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          title="Ações Automáticas Prontas"
          value={actionCount}
          subtext="Remoção de webshells, spam e marcadores"
          icon="auto_fix_high"
          badgeText={actionCount > 0 ? 'Ações Pendentes' : 'Limpo'}
          badgeColor={actionCount > 0 ? 'warning' : 'secondary'}
        />
        <KpiCard
          title="Itens para Revisão Manual"
          value={manualCount}
          subtext="Caminhos existentes na baseline ou bancos offline"
          icon="rate_review"
          badgeText={manualCount > 0 ? 'Atenção' : 'Nenhum'}
          badgeColor={manualCount > 0 ? 'error' : 'secondary'}
        />
        <KpiCard
          title="ID da Confirmação Exigida"
          value={plan?.id ? `LIMPAR-${plan.id}` : 'NENHUM'}
          subtext="Código único gerado via hash do plano"
          icon="fingerprint"
          badgeText="Token Único"
          badgeColor="primary"
        />
      </div>

      {/* Summary Box */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6">
        <h3 className="font-headline font-bold text-base text-on-surface mb-2">Resumo do Plano Vigente</h3>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          O motor de limpeza (<code className="text-primary font-mono">src/clean.mjs</code>) gera um plano atômico
          antes de qualquer execução. Nenhum arquivo ou banco é alterado sem confirmação explícita da frase no modal de
          dupla checagem.
        </p>
      </div>
    </div>
  );
}
