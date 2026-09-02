"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, type PanInfo } from "framer-motion";
import {
  createWorkflow,
  updateWorkflow,
  getWorkflowSteps,
  type WorkflowInput,
} from "@/app/actions/workflows";
import type { WorkflowListRow } from "@/app/actions/workflows";
import type { WorkflowTemplateSeed } from "@/lib/workflow-templates";
import { STAGE_LABELS, STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import {
  ACTION_LABELS,
  CONDITION_LABELS,
  TRIGGER_DESCRIPTIONS,
  TRIGGER_LABELS,
  WAIT_UNIT_LABELS,
  type ActionConfig,
  type ActionType,
  type ConditionConfig,
  type ConditionType,
  type HttpMethod,
  type LeafStepInput,
  type TriggerType,
  type WaitUnit,
  type WorkflowStepInput,
} from "@/lib/workflow-types";
import { ArrowLeft, Clock, Filter, GitBranch, Globe, MessageCircle, Plus, Trash2, Webhook, Workflow as WorkflowIcon, type LucideIcon } from "lucide-react";

type Member = { id: string; name: string };

const TRIGGER_TYPES: TriggerType[] = ["stage_enter", "stage_stale", "no_reply", "webhook"];
const ACTION_TYPES: ActionType[] = ["send_message", "create_task", "change_stage", "add_note", "http_request"];
const WAIT_UNITS: WaitUnit[] = ["minutes", "hours", "days"];
const CONDITION_TYPES: ConditionType[] = ["replied", "stage_is", "responsible_is", "days_in_stage_gte"];
const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE"];

// Canvas 2D (nós arrastáveis conectados por curva, tipo n8n/Make) — layout auto-calculado a partir
// do gatilho/público/passos; ramificação de uma condição abre pra cima (SIM) e pra baixo (NÃO).
const NODE_W = 168;
const NODE_H = 78;
const GAP_X = 60;
const ROW_H = 106;

type CanvasNode = { id: string; x: number; y: number; icon: LucideIcon; label: string; sublabel?: string; accent: string; active: boolean; onSelect?: () => void };
type CanvasEdge = { from: string; to: string };

function emptyActionConfig(type: ActionType) {
  if (type === "send_message") return { action_type: "send_message" as const, text: "" };
  if (type === "create_task") return { action_type: "create_task" as const, title: "" };
  if (type === "change_stage") return { action_type: "change_stage" as const, stage: "abordado" as ContactStage };
  if (type === "http_request") return { action_type: "http_request" as const, method: "POST" as HttpMethod, url: "", body: "" };
  return { action_type: "add_note" as const, text: "" };
}

function emptyConditionConfig(type: ConditionType): ConditionConfig {
  if (type === "stage_is") return { condition_type: "stage_is", stage: "interessado" };
  if (type === "responsible_is") return { condition_type: "responsible_is", responsibleUserId: "" };
  if (type === "days_in_stage_gte") return { condition_type: "days_in_stage_gte", days: 3 };
  return { condition_type: "replied" };
}

// Resumo curto de cada passo pro card do canvas — o mesmo dado que já aparece expandido no painel
// de edição, só condensado pra caber num node de ~150px.
function stepChipInfo(step: WorkflowStepInput): { icon: LucideIcon; label: string; sublabel: string; accent: string } {
  if (step.step_type === "wait") {
    return { icon: Clock, label: "Esperar", sublabel: `${step.config.amount} ${WAIT_UNIT_LABELS[step.config.unit]}`, accent: "border-border-strong bg-surface-2 text-text-muted" };
  }
  if (step.step_type === "condition") {
    return { icon: GitBranch, label: "Condição", sublabel: CONDITION_LABELS[step.config.condition_type], accent: "border-warning-text/30 bg-warning-soft text-warning-text" };
  }
  const a = step.config;
  const label = ACTION_LABELS[a.action_type];
  const sublabel =
    a.action_type === "send_message" || a.action_type === "add_note"
      ? a.text || "sem texto"
      : a.action_type === "create_task"
        ? a.title || "sem título"
        : a.action_type === "change_stage"
          ? STAGE_LABELS[a.stage]
          : a.url || "sem URL";
  return { icon: a.action_type === "http_request" ? Globe : MessageCircle, label, sublabel, accent: "border-primary-strong/30 bg-primary-soft text-primary-strong" };
}

export function WorkflowBuilder({
  workspaceId,
  members,
  existing,
  template,
}: {
  workspaceId: string;
  members: Member[];
  existing: WorkflowListRow | null;
  template?: WorkflowTemplateSeed;
}) {
  const router = useRouter();
  const isEditing = Boolean(existing);

  const [name, setName] = useState(existing?.name || template?.name || "");
  const [description, setDescription] = useState(existing?.description || template?.description || "");
  const [triggerType, setTriggerType] = useState<TriggerType>(existing?.trigger_type || template?.triggerType || "stage_enter");
  const [triggerStage, setTriggerStage] = useState<ContactStage>((existing?.trigger_config?.stage as ContactStage) || template?.triggerStage || "interessado");
  const [triggerDays, setTriggerDays] = useState<number>(Number(existing?.trigger_config?.days) || template?.triggerDays || 3);
  const [audienceStage, setAudienceStage] = useState<string>(existing?.audience_config?.stage || template?.audienceStage || "");
  const [audienceResponsible, setAudienceResponsible] = useState<string>(existing?.audience_config?.responsibleUserId || "");
  const [stopOnReply, setStopOnReply] = useState(existing?.stop_on_reply ?? template?.stopOnReply ?? true);
  const [stopOnStageChange, setStopOnStageChange] = useState(existing?.stop_on_stage_change ?? template?.stopOnStageChange ?? false);
  const [respectBusinessHours, setRespectBusinessHours] = useState(existing?.respect_business_hours ?? template?.respectBusinessHours ?? true);
  const [allowReentry, setAllowReentry] = useState(existing?.allow_reentry ?? template?.allowReentry ?? false);
  const [reentryCooldownHours, setReentryCooldownHours] = useState<number | null>(existing?.reentry_cooldown_hours ?? template?.reentryCooldownHours ?? null);
  const [enabledOnSave] = useState(true);
  const [steps, setSteps] = useState<WorkflowStepInput[]>(template?.steps ?? []);
  const [loadingSteps, setLoadingSteps] = useState(isEditing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<"trigger" | "audience" | number>("trigger");
  const [dragOffsets, setDragOffsets] = useState<Record<string, { x: number; y: number }>>({});

  function handleNodeDragEnd(id: string, info: PanInfo) {
    setDragOffsets((prev) => ({ ...prev, [id]: { x: (prev[id]?.x || 0) + info.offset.x, y: (prev[id]?.y || 0) + info.offset.y } }));
  }

  // Monta os nós/arestas do canvas a partir do estado atual — recalculado a cada render (barato:
  // é só geometria, nada de custo real), então arrastar um card não precisa mexer nessa árvore, só
  // no offset visual (dragOffsets) por cima da posição calculada.
  function buildCanvas(): { nodes: CanvasNode[]; edges: CanvasEdge[]; width: number; height: number } {
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];
    const mainY = ROW_H;
    let x = 0;
    let prevId = "trigger";

    nodes.push({
      id: "trigger",
      x: 0,
      y: mainY,
      icon: Webhook,
      label: TRIGGER_LABELS[triggerType],
      sublabel:
        triggerType === "webhook"
          ? "sistema externo"
          : triggerType === "no_reply"
            ? `${triggerDays} dia(s)`
            : triggerType === "stage_enter"
              ? STAGE_LABELS[triggerStage]
              : `${STAGE_LABELS[triggerStage]} · ${triggerDays}d`,
      accent: "border-success/40 bg-success-soft text-success",
      active: selected === "trigger",
      onSelect: () => setSelected("trigger"),
    });

    if (triggerType !== "webhook") {
      x += NODE_W + GAP_X;
      nodes.push({
        id: "audience",
        x,
        y: mainY,
        icon: Filter,
        label: "Público",
        sublabel: `${audienceStage ? STAGE_LABELS[audienceStage as ContactStage] : "qualquer etapa"} · ${audienceResponsible ? members.find((m) => m.id === audienceResponsible)?.name || "resp." : "qualquer resp."}`,
        accent: "border-info-text/30 bg-info-soft text-info-text",
        active: selected === "audience",
        onSelect: () => setSelected("audience"),
      });
      edges.push({ from: "trigger", to: "audience" });
      prevId = "audience";
    }

    steps.forEach((step, i) => {
      x += NODE_W + GAP_X;
      const id = `step-${i}`;
      const chip = stepChipInfo(step);
      nodes.push({ id, x, y: mainY, icon: chip.icon, label: chip.label, sublabel: chip.sublabel, accent: chip.accent, active: selected === i, onSelect: () => setSelected(i) });
      edges.push({ from: prevId, to: id });
      prevId = id;

      if (step.step_type === "condition") {
        let bx = x + NODE_W + GAP_X;
        let branchPrev = id;
        step.yesSteps.forEach((cs, ci) => {
          const cid = `${id}-yes-${ci}`;
          const cchip = stepChipInfo(cs);
          nodes.push({ id: cid, x: bx, y: 0, icon: cchip.icon, label: cchip.label, sublabel: cchip.sublabel, accent: "border-success/40 bg-success-soft text-success", active: selected === i, onSelect: () => setSelected(i) });
          edges.push({ from: branchPrev, to: cid });
          branchPrev = cid;
          bx += NODE_W + GAP_X;
        });
        bx = x + NODE_W + GAP_X;
        branchPrev = id;
        step.noSteps.forEach((cs, ci) => {
          const cid = `${id}-no-${ci}`;
          const cchip = stepChipInfo(cs);
          nodes.push({ id: cid, x: bx, y: 2 * ROW_H, icon: cchip.icon, label: cchip.label, sublabel: cchip.sublabel, accent: "border-danger/40 bg-danger-soft text-danger", active: selected === i, onSelect: () => setSelected(i) });
          edges.push({ from: branchPrev, to: cid });
          branchPrev = cid;
          bx += NODE_W + GAP_X;
        });
      }
    });

    const width = x + NODE_W + 40;
    const height = 2 * ROW_H + NODE_H + 20;
    return { nodes, edges, width, height };
  }

  useEffect(() => {
    // `existing` é fixo pra vida desse componente (WorkflowBuilder remonta do zero a cada vez que
    // o drawer abre — ver workflow-list.tsx), então esse efeito roda só uma vez no mount.
    if (!existing) return;
    getWorkflowSteps(existing.id).then((s) => {
      setSteps(s);
      setLoadingSteps(false);
    });
  }, [existing]);

  function addWaitStep() {
    setSteps((prev) => [...prev, { step_type: "wait", config: { amount: 1, unit: "days" } }]);
    setSelected(steps.length);
  }
  function addActionStep() {
    setSteps((prev) => [...prev, { step_type: "action", config: emptyActionConfig("send_message") }]);
    setSelected(steps.length);
  }
  function addConditionStep() {
    setSteps((prev) => [...prev, { step_type: "condition", config: emptyConditionConfig("replied"), yesSteps: [], noSteps: [] }]);
    setSelected(steps.length);
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }
  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function updateStep(index: number, step: WorkflowStepInput) {
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  }

  function handleSave() {
    setError(null);
    const triggerConfig =
      triggerType === "webhook"
        ? {}
        : triggerType === "no_reply"
          ? { days: triggerDays }
          : triggerType === "stage_enter"
            ? { stage: triggerStage }
            : { stage: triggerStage, days: triggerDays };

    const input: WorkflowInput = {
      name,
      description: description || null,
      triggerType,
      triggerConfig,
      audienceConfig: { stage: (audienceStage || null) as ContactStage | null, responsibleUserId: audienceResponsible || null },
      stopOnReply,
      stopOnStageChange,
      respectBusinessHours,
      allowReentry,
      reentryCooldownHours: allowReentry ? reentryCooldownHours : null,
      steps,
    };

    startTransition(async () => {
      const result = isEditing && existing ? await updateWorkflow(existing.id, input) : await createWorkflow(input);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/automacoes");
    });
  }

  void enabledOnSave;
  void workspaceId;

  const canvas = buildCanvas();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10 bg-bg -mx-4 lg:-mx-5 px-4 lg:px-5 py-3 -mt-4 lg:-mt-5 border-b border-border">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button type="button" onClick={() => router.push("/automacoes")} aria-label="Voltar" className="text-text-muted hover:text-text cursor-pointer p-1.5 rounded-md hover:bg-surface-2 shrink-0">
            <ArrowLeft size={20} />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do workflow (ex: Follow-up de proposta)"
            className="text-xl font-extrabold tracking-tight outline-none bg-transparent border-b-2 border-transparent focus:border-primary py-0.5 min-w-0 flex-1"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-xs text-danger font-medium">{error}</span>}
          <button type="button" onClick={() => router.push("/automacoes")} className="text-sm font-bold px-4 py-2 rounded-md border border-border hover:bg-surface-2 cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={pending} className="text-sm font-bold px-4 py-2 rounded-md bg-primary-strong text-white hover:brightness-95 disabled:opacity-60 cursor-pointer">
            {pending ? "Salvando…" : "Salvar workflow"}
          </button>
        </div>
      </div>

      {loadingSteps ? (
        <div className="text-text-muted text-sm">Carregando…</div>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 max-w-xl">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descrição (opcional)"
                  className="border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-primary"
                />
              </div>

              {/* Canvas 2D — nós arrastáveis conectados por curva (tipo n8n/Make). Clique num nó edita
                  ele no painel abaixo; arrastar só reposiciona visualmente (não muda a ordem real —
                  isso continua pelas setas ↑↓ no painel). Ramo SIM abre pra cima, NÃO pra baixo. */}
              <div className="rounded-2xl border border-border bg-bg p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                    <WorkflowIcon size={14} /> Fluxo
                    <span className="opacity-60 font-semibold normal-case">— {steps.length} passo(s)</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={addWaitStep} className="inline-flex items-center gap-1.5 text-[11px] font-bold border border-border rounded-md px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer bg-surface">
                      <Clock size={12} /> Esperar
                    </button>
                    <button type="button" onClick={addActionStep} className="inline-flex items-center gap-1.5 text-[11px] font-bold border border-border rounded-md px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer bg-surface">
                      <Plus size={12} /> Ação
                    </button>
                    <button type="button" onClick={addConditionStep} className="inline-flex items-center gap-1.5 text-[11px] font-bold border border-border rounded-md px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer bg-surface">
                      <GitBranch size={12} /> Condição
                    </button>
                  </div>
                </div>

                <div className="relative w-full overflow-auto rounded-xl border border-border/60 bg-surface" style={{ height: Math.min(Math.max(canvas.height, 320), 560) }}>
                  <div className="relative" style={{ width: canvas.width, height: canvas.height }}>
                    <svg className="absolute top-0 left-0 pointer-events-none" width={canvas.width} height={canvas.height} style={{ overflow: "visible" }} aria-hidden>
                      {canvas.edges.map((e, idx) => (
                        <CanvasConnector key={idx} from={e.from} to={e.to} nodes={canvas.nodes} />
                      ))}
                    </svg>
                    {canvas.nodes.map((node) => (
                      <CanvasNodeCard key={node.id} node={node} offset={dragOffsets[node.id]} onDragEnd={(info) => handleNodeDragEnd(node.id, info)} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Painel de edição do nó selecionado */}
              <div className="rounded-xl border border-border bg-surface-2 p-3.5 flex flex-col gap-2.5">
                {selected === "trigger" && (
                  <>
                    <div className="flex items-center gap-2 text-success text-xs font-bold uppercase tracking-wide">
                      <Webhook size={14} /> Gatilho — quando isso acontecer
                    </div>
                    <select
                      value={triggerType}
                      onChange={(e) => setTriggerType(e.target.value as TriggerType)}
                      className="border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary"
                    >
                      {TRIGGER_TYPES.map((t) => (
                        <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-text-muted">{TRIGGER_DESCRIPTIONS[triggerType]}</p>
                    {(triggerType === "stage_enter" || triggerType === "stage_stale") && (
                      <select value={triggerStage} onChange={(e) => setTriggerStage(e.target.value as ContactStage)} className="border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary">
                        {STAGE_ORDER.map((s) => (
                          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                        ))}
                      </select>
                    )}
                    {(triggerType === "stage_stale" || triggerType === "no_reply") && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-text-muted">Depois de</span>
                        <input type="number" min={1} value={triggerDays} onChange={(e) => setTriggerDays(Number(e.target.value) || 1)} className="w-16 border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary" />
                        <span className="text-text-muted">dia(s)</span>
                      </div>
                    )}
                    {triggerType === "webhook" && (
                      <div className="text-xs">
                        {existing?.webhook_token ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-text-muted">URL (POST, JSON com pelo menos <code>phone</code>):</span>
                            <code className="block bg-surface border border-border rounded-md px-2 py-1.5 break-all select-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/api/workflows/webhook/${existing.webhook_token}`}</code>
                          </div>
                        ) : (
                          <span className="text-text-muted">Salve o workflow pra gerar a URL do webhook.</span>
                        )}
                      </div>
                    )}
                  </>
                )}

                {selected === "audience" && triggerType !== "webhook" && (
                  <>
                    <div className="flex items-center gap-2 text-info-text text-xs font-bold uppercase tracking-wide">
                      <Filter size={14} /> Público — quem entra
                    </div>
                    <select value={audienceStage} onChange={(e) => setAudienceStage(e.target.value)} className="border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary">
                      <option value="">Qualquer etapa</option>
                      {STAGE_ORDER.map((s) => (
                        <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                      ))}
                    </select>
                    <select value={audienceResponsible} onChange={(e) => setAudienceResponsible(e.target.value)} className="border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary">
                      <option value="">Qualquer responsável</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </>
                )}

                {typeof selected === "number" && steps[selected] && (
                  <StepCard
                    step={steps[selected]}
                    index={selected}
                    total={steps.length}
                    members={members}
                    onChange={(s) => updateStep(selected, s)}
                    onRemove={() => {
                      removeStep(selected);
                      setSelected("trigger");
                    }}
                    onMove={(dir) => {
                      moveStep(selected, dir);
                      setSelected(selected + dir);
                    }}
                  />
                )}
              </div>

              {/* Regras */}
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <h3 className="text-sm font-bold">Regras de parada e segurança</h3>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} /> Parar quando o lead responder
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={stopOnStageChange} onChange={(e) => setStopOnStageChange(e.target.checked)} /> Parar quando o lead mudar de etapa
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={respectBusinessHours} onChange={(e) => setRespectBusinessHours(e.target.checked)} /> Só mandar mensagem em horário comercial (seg-sáb, 9h-20h)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={allowReentry} onChange={(e) => setAllowReentry(e.target.checked)} /> Permitir que o mesmo lead entre de novo depois de completar
                </label>
                {allowReentry && (
                  <div className="flex items-center gap-2 text-sm pl-6">
                    <span className="text-text-muted">Mas não antes de</span>
                    <input
                      type="number"
                      min={1}
                      value={reentryCooldownHours ?? ""}
                      placeholder="—"
                      onChange={(e) => setReentryCooldownHours(e.target.value ? Number(e.target.value) : null)}
                      className="w-16 border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <span className="text-text-muted">hora(s) desde a última vez</span>
                  </div>
                )}
              </div>
        </>
      )}
    </div>
  );
}

// Curva bézier entre 2 nós — mesma técnica do modelo de referência (n8n-style): sai da borda direita
// do nó de origem, entra pela esquerda do destino, com os pontos de controle na metade do caminho.
function CanvasConnector({ from, to, nodes }: { from: string; to: string; nodes: CanvasNode[] }) {
  const a = nodes.find((n) => n.id === from);
  const b = nodes.find((n) => n.id === to);
  if (!a || !b) return null;
  const startX = a.x + NODE_W;
  const startY = a.y + NODE_H / 2;
  const endX = b.x;
  const endY = b.y + NODE_H / 2;
  const cp1X = startX + (endX - startX) * 0.5;
  const cp2X = endX - (endX - startX) * 0.5;
  const path = `M${startX},${startY} C${cp1X},${startY} ${cp2X},${endY} ${endX},${endY}`;
  return <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="7,5" strokeLinecap="round" opacity={0.4} className="text-text-muted" />;
}

// Card do nó — arrastável (só cosmético, dragOffsets guarda o deslocamento por cima da posição
// calculada; a ordem real do fluxo continua vindo de `steps`) e clicável (onTap, pra não brigar com
// o gesto de arrastar) pra abrir a edição desse passo no painel abaixo do canvas.
function CanvasNodeCard({ node, offset, onDragEnd }: { node: CanvasNode; offset?: { x: number; y: number }; onDragEnd: (info: PanInfo) => void }) {
  const Icon = node.icon;
  const x = node.x + (offset?.x || 0);
  const y = node.y + (offset?.y || 0);
  return (
    <motion.button
      type="button"
      drag
      dragMomentum={false}
      onDragEnd={(_, info) => onDragEnd(info)}
      onTap={() => node.onSelect?.()}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1, x, y }}
      whileHover={{ scale: 1.02 }}
      whileDrag={{ scale: 1.05, zIndex: 30, cursor: "grabbing" }}
      transition={{ duration: 0.15 }}
      style={{ width: NODE_W, transformOrigin: "0 0" }}
      className={`absolute top-0 left-0 cursor-grab rounded-xl border-2 p-2.5 text-left bg-surface ${node.accent} ${node.active ? "ring-2 ring-primary shadow-md" : "shadow-sm"}`}
    >
      <span className="grid place-items-center w-7 h-7 rounded-lg bg-surface mb-1.5" aria-hidden>
        <Icon size={14} />
      </span>
      <span className="block text-xs font-bold truncate">{node.label}</span>
      {node.sublabel && <span className="block text-[10px] opacity-70 truncate mt-0.5">{node.sublabel}</span>}
    </motion.button>
  );
}

function StepHeader({ label, index, total, onRemove, onMove }: { label: string; index: number; total: number; onRemove: () => void; onMove: (dir: -1 | 1) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="text-text-muted hover:text-text disabled:opacity-30 cursor-pointer px-1" aria-label="Mover pra cima">↑</button>
        <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="text-text-muted hover:text-text disabled:opacity-30 cursor-pointer px-1" aria-label="Mover pra baixo">↓</button>
        <button type="button" onClick={onRemove} className="text-danger hover:brightness-90 cursor-pointer px-1" aria-label="Remover passo">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  members,
  onChange,
  onRemove,
  onMove,
}: {
  step: WorkflowStepInput;
  index: number;
  total: number;
  members: Member[];
  onChange: (step: WorkflowStepInput) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  if (step.step_type === "condition") {
    return (
      <div className="rounded-lg border border-border bg-surface-2 p-3 flex flex-col gap-2">
        <StepHeader label={`Passo ${index + 1}`} index={index} total={total} onRemove={onRemove} onMove={onMove} />
        <ConditionFields
          config={step.config}
          yesSteps={step.yesSteps}
          noSteps={step.noSteps}
          members={members}
          onChange={(config) => onChange({ ...step, config })}
          onYesChange={(yesSteps) => onChange({ ...step, yesSteps })}
          onNoChange={(noSteps) => onChange({ ...step, noSteps })}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3 flex flex-col gap-2">
      <StepHeader label={`Passo ${index + 1}`} index={index} total={total} onRemove={onRemove} onMove={onMove} />
      <LeafStepFields step={step} onChange={onChange} />
    </div>
  );
}

function LeafStepFields({ step, onChange }: { step: LeafStepInput; onChange: (step: LeafStepInput) => void }) {
  if (step.step_type === "wait") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Clock size={14} className="text-text-muted" />
        <span className="text-text-muted">Esperar</span>
        <input
          type="number"
          min={1}
          value={step.config.amount}
          onChange={(e) => onChange({ step_type: "wait", config: { ...step.config, amount: Number(e.target.value) || 1 } })}
          className="w-16 border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary bg-surface"
        />
        <select
          value={step.config.unit}
          onChange={(e) => onChange({ step_type: "wait", config: { ...step.config, unit: e.target.value as WaitUnit } })}
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface outline-none focus:border-primary"
        >
          {WAIT_UNITS.map((u) => (
            <option key={u} value={u}>{WAIT_UNIT_LABELS[u]}</option>
          ))}
        </select>
      </div>
    );
  }
  return <ActionStepFields config={step.config} onChange={(config) => onChange({ step_type: "action", config })} />;
}

// Condição — 2 ramos (SIM/NÃO), cada um uma mini-lista de passos wait/action (sem condição
// aninhada, de propósito: só 1 nível de ramificação por enquanto).
function ConditionFields({
  config,
  yesSteps,
  noSteps,
  members,
  onChange,
  onYesChange,
  onNoChange,
}: {
  config: ConditionConfig;
  yesSteps: LeafStepInput[];
  noSteps: LeafStepInput[];
  members: Member[];
  onChange: (config: ConditionConfig) => void;
  onYesChange: (steps: LeafStepInput[]) => void;
  onNoChange: (steps: LeafStepInput[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <GitBranch size={14} className="text-text-muted shrink-0" />
        <select
          value={config.condition_type}
          onChange={(e) => onChange(emptyConditionConfig(e.target.value as ConditionType))}
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface outline-none focus:border-primary flex-1"
        >
          {CONDITION_TYPES.map((c) => (
            <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
          ))}
        </select>
      </div>

      {config.condition_type === "stage_is" && (
        <select value={config.stage} onChange={(e) => onChange({ ...config, stage: e.target.value as ContactStage })} className="border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary">
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
      )}
      {config.condition_type === "responsible_is" && (
        <select value={config.responsibleUserId} onChange={(e) => onChange({ ...config, responsibleUserId: e.target.value })} className="border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary">
          <option value="">Selecione…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      )}
      {config.condition_type === "days_in_stage_gte" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-muted">Pelo menos</span>
          <input type="number" min={1} value={config.days} onChange={(e) => onChange({ ...config, days: Number(e.target.value) || 1 })} className="w-16 border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary bg-surface" />
          <span className="text-text-muted">dia(s)</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <BranchList label="SIM" accent="border-success/40 bg-success-soft" steps={yesSteps} onChange={onYesChange} />
        <BranchList label="NÃO" accent="border-danger/40 bg-danger-soft" steps={noSteps} onChange={onNoChange} />
      </div>
    </div>
  );
}

function BranchList({ label, accent, steps, onChange }: { label: string; accent: string; steps: LeafStepInput[]; onChange: (steps: LeafStepInput[]) => void }) {
  function add(stepType: "wait" | "action") {
    onChange([...steps, stepType === "wait" ? { step_type: "wait", config: { amount: 1, unit: "days" } } : { step_type: "action", config: emptyActionConfig("send_message") }]);
  }
  function update(i: number, step: LeafStepInput) {
    onChange(steps.map((s, idx) => (idx === i ? step : s)));
  }
  function remove(i: number) {
    onChange(steps.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const target = i + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  }

  return (
    <div className={`rounded-lg border p-2.5 flex flex-col gap-2 ${accent}`}>
      <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
      {steps.length === 0 && <p className="text-[11px] opacity-70">Vazio = para o workflow aqui.</p>}
      <div className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <div key={i} className="rounded-md border border-border bg-surface p-2 flex flex-col gap-1.5">
            <StepHeader label={`${i + 1}`} index={i} total={steps.length} onRemove={() => remove(i)} onMove={(dir) => move(i, dir)} />
            <LeafStepFields step={s} onChange={(step) => update(i, step)} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => add("wait")} className="inline-flex items-center gap-1 text-[11px] font-bold border border-border rounded-md px-2 py-1 bg-surface hover:brightness-95 cursor-pointer">
          <Clock size={11} /> Esperar
        </button>
        <button type="button" onClick={() => add("action")} className="inline-flex items-center gap-1 text-[11px] font-bold border border-border rounded-md px-2 py-1 bg-surface hover:brightness-95 cursor-pointer">
          <Plus size={11} /> Ação
        </button>
      </div>
    </div>
  );
}

// Componente à parte (em vez de inline no StepCard) de propósito: narrowing de `config.action_type`
// só sobrevive dentro dos closures dos onChange quando `config` é o próprio parâmetro da função, não
// uma leitura de propriedade aninhada (`step.config`) — limitação conhecida do TS.
function ActionStepFields({ config, onChange }: { config: ActionConfig; onChange: (config: ActionConfig) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <MessageCircle size={14} className="text-text-muted shrink-0" />
        <select
          value={config.action_type}
          onChange={(e) => onChange(emptyActionConfig(e.target.value as ActionType))}
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface outline-none focus:border-primary flex-1"
        >
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a]}</option>
          ))}
        </select>
      </div>

      {(config.action_type === "send_message" || config.action_type === "add_note") && (
        <textarea
          value={config.text}
          onChange={(e) => onChange({ ...config, text: e.target.value })}
          placeholder="Use {{nome}}, {{primeiro_nome}}, {{sobrenome}}, {{telefone}}, {{empresa}}, {{etapa}}, {{responsavel}}, {{data_criacao}}, {{campo:chave}}"
          rows={2}
          className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface resize-none"
        />
      )}
      {config.action_type === "create_task" && (
        <input
          value={config.title}
          onChange={(e) => onChange({ ...config, title: e.target.value })}
          placeholder="Título da tarefa (ex: Ligar pra {{primeiro_nome}})"
          className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface"
        />
      )}
      {config.action_type === "change_stage" && (
        <select
          value={config.stage}
          onChange={(e) => onChange({ ...config, stage: e.target.value as ContactStage })}
          className="border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary"
        >
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
      )}
      {config.action_type === "http_request" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-text-muted shrink-0" />
            <select value={config.method} onChange={(e) => onChange({ ...config, method: e.target.value as HttpMethod })} className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface outline-none focus:border-primary">
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              value={config.url}
              onChange={(e) => onChange({ ...config, url: e.target.value })}
              placeholder="https://exemplo.com/webhook"
              className="flex-1 border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary bg-surface"
            />
          </div>
          {config.method !== "GET" && (
            <textarea
              value={config.body}
              onChange={(e) => onChange({ ...config, body: e.target.value })}
              placeholder={'Corpo JSON (opcional) — ex: {"nome": "{{nome}}", "telefone": "{{telefone}}"}'}
              rows={2}
              className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface resize-none font-mono"
            />
          )}
        </div>
      )}
    </div>
  );
}
