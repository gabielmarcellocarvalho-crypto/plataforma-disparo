"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteWorkflow, toggleWorkflow, type WorkflowListRow } from "@/app/actions/workflows";
import { WorkflowRunHistory } from "@/components/workflow-run-history";
import { STAGE_LABELS, type ContactStage } from "@/lib/crm-stages";
import { TRIGGER_LABELS } from "@/lib/workflow-types";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";
import { History, Pencil, Plus, Sparkles, Trash2, Workflow as WorkflowIcon, X } from "lucide-react";

type Member = { id: string; name: string };

function triggerSummary(w: WorkflowListRow): string {
  const cfg = w.trigger_config;
  const label = TRIGGER_LABELS[w.trigger_type];
  const stage = cfg.stage ? STAGE_LABELS[cfg.stage as ContactStage] : null;
  const days = cfg.days ? `${cfg.days}d` : null;
  return [label, stage, days].filter(Boolean).join(" · ");
}

function audienceSummary(w: WorkflowListRow, members: Member[]): string {
  const stage = w.audience_config.stage ? STAGE_LABELS[w.audience_config.stage as ContactStage] : "qualquer etapa";
  const respId = w.audience_config.responsibleUserId;
  const resp = respId ? members.find((m) => m.id === respId)?.name || "responsável específico" : "qualquer responsável";
  return `${stage} · ${resp}`;
}

export function WorkflowList({ workflows, members }: { workflows: WorkflowListRow[]; members: Member[] }) {
  const router = useRouter();
  const [viewingRuns, setViewingRuns] = useState<WorkflowListRow | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [pending, startTransition] = useTransition();

  function startFromTemplate(templateId?: string) {
    router.push(templateId ? `/automacoes/novo?template=${templateId}` : "/automacoes/novo");
  }

  function handleToggle(w: WorkflowListRow) {
    startTransition(async () => {
      await toggleWorkflow(w.id, !w.enabled);
    });
  }

  function handleDelete(w: WorkflowListRow) {
    if (!confirm(`Excluir o workflow "${w.name}"? Isso não afeta execuções já feitas, só para as futuras.`)) return;
    startTransition(async () => {
      await deleteWorkflow(w.id);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-text">Workflows</h2>
          <p className="text-xs text-text-muted mt-0.5">Gatilho → público → passos, executado automaticamente.</p>
        </div>
        <button
          type="button"
          onClick={() => setPickingTemplate(true)}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-md bg-primary-strong text-white hover:brightness-95 cursor-pointer"
        >
          <Plus size={14} /> Criar workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-8 flex flex-col items-center text-center gap-2">
          <span className="grid place-items-center w-12 h-12 rounded-full bg-primary-faint text-primary-strong" aria-hidden>
            <WorkflowIcon size={22} />
          </span>
          <p className="font-semibold text-text">Nenhum workflow criado ainda</p>
          <p className="text-sm text-text-muted max-w-xs">
            Crie o primeiro com o botão &quot;Criar workflow&quot; acima — ex: follow-up automático pra lead parado numa etapa.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {workflows.map((w) => (
            <div key={w.id} className="bg-surface border border-border rounded-lg shadow-sm p-4 flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold truncate">{w.name}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${w.enabled ? "bg-success-soft text-success" : "bg-surface-2 text-text-muted"}`}>
                      {w.enabled ? "Ativo" : "Pausado"}
                    </span>
                  </div>
                  {w.description && <p className="text-xs text-text-muted mt-0.5">{w.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setViewingRuns(w)} className="text-text-muted hover:text-text cursor-pointer p-1.5 rounded-md hover:bg-surface-2" aria-label="Ver execuções">
                    <History size={14} />
                  </button>
                  <button type="button" onClick={() => router.push(`/automacoes/${w.id}`)} className="text-text-muted hover:text-text cursor-pointer p-1.5 rounded-md hover:bg-surface-2" aria-label="Editar">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => handleDelete(w)} disabled={pending} className="text-danger hover:brightness-90 cursor-pointer p-1.5 rounded-md hover:bg-surface-2" aria-label="Excluir">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                <span className="bg-success-soft text-success px-2 py-0.5 rounded-full font-semibold">{triggerSummary(w)}</span>
                {w.trigger_type !== "webhook" && <span className="bg-info-soft text-info-text px-2 py-0.5 rounded-full font-semibold">{audienceSummary(w, members)}</span>}
                <span>{w.step_count} passo(s)</span>
                <span>·</span>
                <span>{w.running_count} em andamento</span>
                <span>·</span>
                <span>{w.completed_count} concluído(s)</span>
              </div>

              <label className="flex items-center gap-2 text-xs cursor-pointer w-fit">
                <input type="checkbox" checked={w.enabled} onChange={() => handleToggle(w)} disabled={pending} />
                {w.enabled ? "Desativar" : "Ativar"}
              </label>
            </div>
          ))}
        </div>
      )}

      {pickingTemplate && (
        <>
          <div onClick={() => setPickingTemplate(false)} className="fixed inset-0 bg-black/30 z-40" aria-hidden />
          <div className="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none">
            <div className="bg-surface rounded-xl shadow-2xl border border-border w-full max-w-lg max-h-[85vh] overflow-y-auto pointer-events-auto" role="dialog" aria-label="Escolher template de workflow">
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-surface">
                <h2 className="text-base font-extrabold">Criar workflow</h2>
                <button type="button" onClick={() => setPickingTemplate(false)} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => startFromTemplate(undefined)}
                  className="text-left border border-dashed border-border rounded-lg p-3 hover:bg-surface-2 cursor-pointer"
                >
                  <span className="text-sm font-bold">Em branco</span>
                  <p className="text-xs text-text-muted mt-0.5">Monta tudo do zero.</p>
                </button>
                {WORKFLOW_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => startFromTemplate(t.id)}
                    className="text-left border border-border rounded-lg p-3 hover:border-primary-soft hover:bg-surface-2 cursor-pointer flex items-start gap-2.5"
                  >
                    <span className="grid place-items-center w-8 h-8 rounded-lg bg-primary-soft text-primary-strong shrink-0" aria-hidden>
                      <Sparkles size={15} />
                    </span>
                    <span>
                      <span className="text-sm font-bold block">{t.title}</span>
                      <span className="text-xs text-text-muted">{t.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {viewingRuns && <WorkflowRunHistory workflowId={viewingRuns.id} workflowName={viewingRuns.name} onClose={() => setViewingRuns(null)} />}
    </div>
  );
}
