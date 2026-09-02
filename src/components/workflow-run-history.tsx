"use client";

import { useEffect, useState } from "react";
import { getWorkflowRuns, type WorkflowRunEvent, type WorkflowRunRow, type WorkflowRunStatus } from "@/app/actions/workflows";
import { X } from "lucide-react";

const STATUS_BADGE: Record<WorkflowRunStatus, { label: string; dot: string; className: string }> = {
  running: { label: "Em andamento", dot: "🟢", className: "bg-success-soft text-success" },
  waiting: { label: "Aguardando", dot: "🟡", className: "bg-warning-soft text-warning-text" },
  completed: { label: "Concluído", dot: "🟢", className: "bg-success-soft text-success" },
  stopped: { label: "Parado", dot: "⚪", className: "bg-surface-2 text-text-muted" },
  error: { label: "Erro", dot: "🔴", className: "bg-danger-soft text-danger" },
};

const EVENT_LABEL: Record<string, string> = {
  enrolled: "Entrou no workflow",
  waited: "Esperou",
  action_executed: "Ação executada",
  condition_evaluated: "Condição avaliada",
  stopped: "Parou",
  completed: "Concluiu",
  error: "Erro",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function eventDetailText(e: WorkflowRunEvent): string | null {
  const d = e.detail;
  if (e.event_type === "waited" && typeof d.until === "string") return `até ${formatDateTime(d.until)}`;
  if (e.event_type === "action_executed" && typeof d.action_type === "string") {
    if (d.action_type === "send_message" && typeof d.text === "string") return `mensagem: "${d.text}"`;
    if (d.action_type === "create_task" && typeof d.title === "string") return `tarefa: "${d.title}"`;
    if (d.action_type === "change_stage" && typeof d.stage === "string") return `nova etapa: ${d.stage}`;
    if (d.action_type === "add_note") return "observação adicionada";
    return String(d.action_type);
  }
  if (e.event_type === "condition_evaluated") return `${String(d.condition_type)} → ${d.result ? "SIM" : "NÃO"}`;
  if (e.event_type === "stopped" && typeof d.reason === "string") return d.reason;
  if (e.event_type === "error" && typeof d.error === "string") return d.error;
  return null;
}

export function WorkflowRunHistory({ workflowId, workflowName, onClose }: { workflowId: string; workflowName: string; onClose: () => void }) {
  const [runs, setRuns] = useState<WorkflowRunRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getWorkflowRuns(workflowId).then(setRuns);
  }, [workflowId]);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 opacity-100" aria-hidden />
      <div className="fixed top-0 right-0 h-full w-full max-w-xl bg-surface z-50 shadow-2xl flex flex-col translate-x-0 transition-transform duration-300 ease-out" role="dialog" aria-label="Execuções do workflow">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-extrabold">Execuções</h2>
            <p className="text-xs text-text-muted mt-0.5">{workflowName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2">
          {runs === null ? (
            <p className="text-sm text-text-muted">Carregando…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhuma execução ainda — assim que um lead bater no gatilho, aparece aqui.</p>
          ) : (
            runs.map((run) => {
              const badge = STATUS_BADGE[run.status];
              const isOpen = expanded === run.id;
              return (
                <div key={run.id} className="border border-border rounded-lg bg-surface-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : run.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-semibold truncate block">{run.contact_name || run.contact_phone || "Contato sem nome"}</span>
                      <span className="text-[11px] text-text-muted">Iniciou {formatDateTime(run.started_at)}</span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badge.className}`}>
                      {badge.dot} {badge.label}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 flex flex-col gap-1.5 border-t border-border pt-2.5">
                      {run.stop_reason && <p className="text-xs text-text-muted">Motivo: {run.stop_reason}</p>}
                      {run.events.length === 0 && <p className="text-xs text-text-muted">Sem eventos registrados ainda.</p>}
                      {run.events.map((e) => {
                        const detail = eventDetailText(e);
                        return (
                          <div key={e.id} className="flex items-start gap-2 text-xs">
                            <span className="text-text-muted shrink-0">{formatDateTime(e.created_at)}</span>
                            <span className="font-semibold">{EVENT_LABEL[e.event_type] || e.event_type}</span>
                            {detail && <span className="text-text-muted truncate">— {detail}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
