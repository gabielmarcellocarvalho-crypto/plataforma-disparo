"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createWorkflow,
  updateWorkflow,
  getWorkflowSteps,
  type WorkflowInput,
} from "@/app/actions/workflows";
import type { WorkflowListRow } from "@/app/actions/workflows";
import type { WorkflowTemplateSeed } from "@/lib/workflow-templates";
import { STAGE_LABELS, STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import type { PipelineWithStages } from "@/app/actions/pipelines";
import { sortStages } from "@/lib/pipelines";
import { cn } from "@/lib/utils";
import { WorkflowSendConfig } from "@/components/workflow-send-config";
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
  type WorkflowStageRef,
} from "@/lib/workflow-types";
import { AlertTriangle, ArrowLeft, Clock, Filter, GitBranch, Globe, MessageCircle, Plus, Settings2, Trash2, Webhook, Workflow as WorkflowIcon, type LucideIcon } from "lucide-react";
import { WorkflowCanvas, NODE_W, NODE_H, type CanvasAddSlot, type CanvasEdgeSpec, type CanvasNodeSpec, type NodeKind } from "@/components/workflow-canvas";

type Member = { id: string; name: string };

const TRIGGER_TYPES: TriggerType[] = ["stage_enter", "stage_stale", "no_reply", "webhook"];
const ACTION_TYPES: ActionType[] = ["send_message", "create_task", "change_stage", "add_note", "http_request"];
const WAIT_UNITS: WaitUnit[] = ["minutes", "hours", "days"];
const CONDITION_TYPES: ConditionType[] = ["replied", "stage_is", "responsible_is", "days_in_stage_gte"];
const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE"];

// Layout automático do canvas: fluxo principal numa faixa do meio; ramo SIM de uma condição abre na
// faixa de cima e NÃO na de baixo (só quando existe condição). O usuário pode arrastar por cima.
const GAP_X = 84;
const ROW_H = 150;
const ADD_H = 44;

// Etapas que o workspace enxerga: as do(s) funil(is) personalizado(s) quando existem, senão as 7 fases
// com os nomes que o workspace deu (antes era sempre a lista fixa de fábrica, que não batia com o CRM).
type StageOptions = { pipelines: PipelineWithStages[]; labels: Record<ContactStage, string> };
const StageCtx = createContext<StageOptions>({ pipelines: [], labels: STAGE_LABELS });

function stageDisplayName(opts: StageOptions, stage: ContactStage | null | undefined, pipelineStageId?: string | null): string {
  if (pipelineStageId) {
    for (const p of opts.pipelines) {
      const st = p.stages.find((x) => x.id === pipelineStageId);
      if (st) return opts.pipelines.length > 1 ? `${st.name} (${p.name})` : st.name;
    }
  }
  return stage ? opts.labels[stage] ?? STAGE_LABELS[stage] : "";
}

// Um seletor só pra etapa em todo o editor. Valor codificado: "ps:<id>" (etapa de funil) ou
// "sig:<sinal>" (fase fixa). Escolher etapa de funil grava também o sinal dela — o motor antigo e as
// métricas continuam lendo o sinal.
function StageSelect({
  stage,
  pipelineStageId,
  onChange,
  emptyLabel,
}: {
  stage: ContactStage | "" | null | undefined;
  pipelineStageId?: string | null;
  onChange: (stage: ContactStage | "", pipelineStageId: string | null) => void;
  emptyLabel?: string;
}) {
  const opts = useContext(StageCtx);
  const hasPipelines = opts.pipelines.some((p) => p.stages.length > 0);
  const value = pipelineStageId ? `ps:${pipelineStageId}` : stage ? `sig:${stage}` : "";
  const cls = "border border-border rounded-md px-2.5 py-2 text-sm bg-surface outline-none focus:border-primary w-full min-w-0";
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return onChange("", null);
        if (v.startsWith("sig:")) return onChange(v.slice(4) as ContactStage, null);
        const id = v.slice(3);
        for (const p of opts.pipelines) {
          const st = p.stages.find((x) => x.id === id);
          if (st) return onChange(st.signal, st.id);
        }
      }}
      className={cls}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {hasPipelines
        ? opts.pipelines.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {sortStages(p.stages).map((st) => (
                <option key={st.id} value={`ps:${st.id}`}>
                  {st.name}
                </option>
              ))}
            </optgroup>
          ))
        : STAGE_ORDER.map((st) => (
            <option key={st} value={`sig:${st}`}>
              {opts.labels[st] ?? STAGE_LABELS[st]}
            </option>
          ))}
      {/* Valor antigo por sinal num workspace que hoje tem funil: continua visível e selecionado. */}
      {hasPipelines && stage && !pipelineStageId && <option value={`sig:${stage}`}>{opts.labels[stage] ?? STAGE_LABELS[stage]} (fase)</option>}
    </select>
  );
}

// Lista de etapas com caixinhas (gatilho e público). Nenhuma marcada + `allChecked` = todas.
// Mesmas opções do StageSelect: etapas do funil quando existem, senão as 7 fases com o nome do workspace.
function refKey(r: { stage: string; pipelineStageId: string | null }) {
  return r.pipelineStageId ? `ps:${r.pipelineStageId}` : `sig:${r.stage}`;
}
function StageChecklist({
  refs,
  allChecked,
  allLabel,
  onChange,
}: {
  refs: WorkflowStageRef[];
  allChecked: boolean;
  allLabel: string;
  onChange: (refs: WorkflowStageRef[], all: boolean) => void;
}) {
  const opts = useContext(StageCtx);
  const hasPipelines = opts.pipelines.some((p) => p.stages.length > 0);
  const options: { key: string; ref: WorkflowStageRef; label: string; group?: string }[] = hasPipelines
    ? opts.pipelines.flatMap((p) => sortStages(p.stages).map((st) => ({ key: `ps:${st.id}`, ref: { stage: st.signal, pipelineStageId: st.id }, label: st.name, group: opts.pipelines.length > 1 ? p.name : undefined })))
    : STAGE_ORDER.map((st) => ({ key: `sig:${st}`, ref: { stage: st, pipelineStageId: null }, label: opts.labels[st] ?? STAGE_LABELS[st] }));
  // Etapa antiga (só pelo sinal) num workspace que hoje tem funil: continua aparecendo, marcada.
  for (const r of refs) {
    if (!options.some((o) => o.key === refKey(r))) options.push({ key: refKey(r), ref: r, label: `${opts.labels[r.stage] ?? STAGE_LABELS[r.stage]} (fase)` });
  }
  const checked = new Set(refs.map(refKey));
  const toggle = (o: (typeof options)[number]) => {
    const next = checked.has(o.key) ? refs.filter((r) => refKey(r) !== o.key) : [...refs, o.ref];
    onChange(next, next.length === 0);
  };
  const row = "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm cursor-pointer hover:bg-surface-2";
  let lastGroup: string | undefined;
  return (
    <div className="border border-border rounded-lg bg-surface p-1 max-h-64 overflow-y-auto" role="group" aria-label="Etapas">
      <label className={cn(row, "font-semibold border-b border-border rounded-b-none mb-1")}>
        <input type="checkbox" checked={allChecked} onChange={() => onChange([], true)} className="cursor-pointer accent-[var(--color-primary-strong)]" />
        {allLabel}
      </label>
      {options.map((o) => {
        const header = o.group && o.group !== lastGroup ? o.group : null;
        lastGroup = o.group;
        return (
          <div key={o.key}>
            {header && <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">{header}</div>}
            <label className={row}>
              <input type="checkbox" checked={!allChecked && checked.has(o.key)} onChange={() => toggle(o)} className="cursor-pointer accent-[var(--color-primary-strong)]" />
              {o.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}

function refsSummary(opts: StageOptions, refs: WorkflowStageRef[], empty: string): string {
  if (refs.length === 0) return empty;
  if (refs.length > 2) return `${refs.length} etapas`;
  return refs.map((r) => stageDisplayName(opts, r.stage, r.pipelineStageId)).join(", ");
}

// Lê a lista salva (novo) ou a etapa única (antigo).
function initialRefs(cfg: Record<string, unknown> | null | undefined, fallbackStage?: ContactStage | null): WorkflowStageRef[] {
  if (cfg && Array.isArray(cfg.stageRefs) && cfg.stageRefs.length) {
    return (cfg.stageRefs as WorkflowStageRef[]).filter((r) => r && r.stage).map((r) => ({ stage: r.stage, pipelineStageId: r.pipelineStageId || null }));
  }
  const stage = (cfg?.stage as ContactStage | undefined) || fallbackStage;
  if (!stage) return [];
  return [{ stage, pipelineStageId: (cfg?.pipelineStageId as string | undefined) || null }];
}

function emptyActionConfig(type: ActionType) {
  if (type === "send_message") return { action_type: "send_message" as const, text: "", mode: "free" as const, template: null };
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

// Resumo curto de cada passo pro nó do canvas — o mesmo dado que aparece expandido no painel de
// edição, só condensado pra caber no card.
function stepChipInfo(step: WorkflowStepInput, opts: StageOptions): { icon: LucideIcon; label: string; sublabel: string; kind: NodeKind } {
  if (step.step_type === "wait") {
    return { icon: Clock, label: "Esperar", sublabel: `${step.config.amount} ${WAIT_UNIT_LABELS[step.config.unit]}`, kind: "wait" };
  }
  if (step.step_type === "condition") {
    const c = step.config;
    const sub = c.condition_type === "stage_is" ? `Etapa é ${stageDisplayName(opts, c.stage, c.pipelineStageId)}` : CONDITION_LABELS[c.condition_type];
    return { icon: GitBranch, label: "Condição", sublabel: sub, kind: "condition" };
  }
  const a = step.config;
  const label = ACTION_LABELS[a.action_type];
  const sublabel =
    a.action_type === "send_message" || a.action_type === "add_note"
      ? a.text || "sem texto"
      : a.action_type === "create_task"
        ? a.title || "sem título"
        : a.action_type === "change_stage"
          ? stageDisplayName(opts, a.stage, a.pipelineStageId)
          : a.url || "sem URL";
  return { icon: a.action_type === "http_request" ? Globe : MessageCircle, label, sublabel, kind: "action" };
}

export function WorkflowBuilder({
  workspaceId,
  members,
  existing,
  template,
  pipelines = [],
  stageLabels = STAGE_LABELS,
}: {
  workspaceId: string;
  members: Member[];
  existing: WorkflowListRow | null;
  template?: WorkflowTemplateSeed;
  pipelines?: PipelineWithStages[];
  stageLabels?: Record<ContactStage, string>;
}) {
  const router = useRouter();
  const stageOpts: StageOptions = { pipelines, labels: stageLabels };
  const isEditing = Boolean(existing);

  const [name, setName] = useState(existing?.name || template?.name || "");
  const [description, setDescription] = useState(existing?.description || template?.description || "");
  const [triggerType, setTriggerType] = useState<TriggerType>(existing?.trigger_type || template?.triggerType || "stage_enter");
  const [triggerRefs, setTriggerRefs] = useState<WorkflowStageRef[]>(() =>
    existing?.trigger_config?.allStages === true ? [] : initialRefs(existing?.trigger_config, existing ? null : template?.triggerStage || "interessado")
  );
  const [triggerDays, setTriggerDays] = useState<number>(Number(existing?.trigger_config?.days) || template?.triggerDays || 3);
  const [triggerAllStages, setTriggerAllStages] = useState<boolean>(existing?.trigger_config?.allStages === true);
  const [audienceRefs, setAudienceRefs] = useState<WorkflowStageRef[]>(() =>
    initialRefs(existing?.audience_config as Record<string, unknown> | undefined, existing ? null : (template?.audienceStage as ContactStage | undefined) || null)
  );
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
  const [panelTab, setPanelTab] = useState<"no" | "regras">("no");

  // Monta nós, ligações e "+" do canvas a partir do estado atual. Tudo que existe no fluxo sai daqui
  // ligado a alguém — não há nó solto. Recalculado a cada render (é só geometria).
  function buildCanvas(): { nodes: CanvasNodeSpec[]; edges: CanvasEdgeSpec[]; addSlots: CanvasAddSlot[] } {
    const nodes: CanvasNodeSpec[] = [];
    const edges: CanvasEdgeSpec[] = [];
    const addSlots: CanvasAddSlot[] = [];
    const hasCondition = steps.some((st) => st.step_type === "condition");
    const mainY = hasCondition ? ROW_H : 0;
    const addDy = (NODE_H - ADD_H) / 2;
    let x = 0;
    let prevId = "trigger";
    let prevPort: "out" | "yes" | "no" = "out";
    // Depois de uma condição o motor segue só pelo ramo e termina nele — passo de topo que venha
    // depois nunca executa (workflow-engine: fim do ramo = completed).
    let afterCondition = false;

    const selectFixed = (which: "trigger" | "audience") => () => {
      setSelected(which);
      setPanelTab("no");
    };
    const selectStep = (i: number) => () => {
      setSelected(i);
      setPanelTab("no");
    };

    nodes.push({
      id: "trigger",
      kind: "trigger",
      x: 0,
      y: mainY,
      icon: Webhook,
      title: TRIGGER_LABELS[triggerType],
      subtitle:
        triggerType === "webhook"
          ? "sistema externo"
          : triggerType === "no_reply"
            ? `${triggerDays} dia(s) sem resposta`
            : triggerType === "stage_enter"
              ? triggerAllStages
                ? "Todas as fases"
                : refsSummary(stageOpts, triggerRefs, "nenhuma etapa")
              : `${triggerAllStages ? "Todas as fases" : refsSummary(stageOpts, triggerRefs, "nenhuma etapa")} · ${triggerDays}d`,
      active: selected === "trigger",
      onSelect: selectFixed("trigger"),
    });

    if (triggerType !== "webhook") {
      x += NODE_W + GAP_X;
      nodes.push({
        id: "audience",
        kind: "audience",
        x,
        y: mainY,
        icon: Filter,
        title: "Público",
        subtitle: `${refsSummary(stageOpts, audienceRefs, "qualquer etapa")} · ${audienceResponsible ? members.find((m) => m.id === audienceResponsible)?.name || "resp." : "qualquer resp."}`,
        active: selected === "audience",
        onSelect: selectFixed("audience"),
      });
      edges.push({ from: "trigger", to: "audience" });
      prevId = "audience";
    }

    steps.forEach((step, i) => {
      x += NODE_W + GAP_X;
      const id = `step-${i}`;
      const chip = stepChipInfo(step, stageOpts);
      nodes.push({
        id,
        kind: chip.kind,
        x,
        y: mainY,
        icon: afterCondition ? AlertTriangle : chip.icon,
        title: chip.label,
        subtitle: afterCondition ? "Nunca executa: vem depois de uma condição" : chip.sublabel,
        active: selected === i,
        onSelect: selectStep(i),
      });
      edges.push({ from: prevId, to: id, port: prevPort });
      prevId = id;
      prevPort = "out";

      if (step.step_type === "condition") {
        afterCondition = true;
        for (const branch of ["yes", "no"] as const) {
          const list = branch === "yes" ? step.yesSteps : step.noSteps;
          const laneY = branch === "yes" ? 0 : 2 * ROW_H;
          let bx = x + NODE_W + GAP_X;
          let bPrev = id;
          let bPort: "out" | "yes" | "no" = branch;
          list.forEach((cs, ci) => {
            const cid = `${id}-${branch}-${ci}`;
            const cchip = stepChipInfo(cs, stageOpts);
            nodes.push({ id: cid, kind: cchip.kind, x: bx, y: laneY, icon: cchip.icon, title: cchip.label, subtitle: cchip.sublabel, active: selected === i, onSelect: selectStep(i) });
            edges.push({ from: bPrev, to: cid, port: bPort });
            bPrev = cid;
            bPort = "out";
            bx += NODE_W + GAP_X;
          });
          addSlots.push({
            id: `add-${id}-${branch}`,
            after: bPrev,
            port: bPort,
            x: bx,
            y: laneY + addDy,
            label: list.length ? "Passo" : branch === "yes" ? "Se SIM" : "Se NÃO",
            options: [
              { key: "wait", label: "Esperar", icon: Clock, onPick: () => addBranchStep(i, branch, "wait") },
              { key: "action", label: "Ação", icon: Plus, onPick: () => addBranchStep(i, branch, "action") },
            ],
          });
        }
        // Os ramos ocupam as faixas de cima/baixo; o próximo nó da faixa do meio vai pra depois deles.
        x += Math.max(step.yesSteps.length, step.noSteps.length) * (NODE_W + GAP_X);
      }
    });

    // "+" do fluxo principal — some depois de uma condição, porque dali o caminho segue pelos ramos.
    if (!afterCondition) {
      addSlots.push({
        id: "add-main",
        after: prevId,
        port: prevPort,
        x: x + NODE_W + GAP_X,
        y: mainY + addDy,
        label: steps.length ? "Passo" : "Primeiro passo",
        options: [
          { key: "wait", label: "Esperar", icon: Clock, onPick: addWaitStep },
          { key: "action", label: "Ação", icon: Plus, onPick: addActionStep },
          { key: "condition", label: "Condição (SIM/NÃO)", icon: GitBranch, onPick: addConditionStep },
        ],
      });
    }

    return { nodes, edges, addSlots };
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
  function addBranchStep(index: number, branch: "yes" | "no", type: "wait" | "action") {
    const leaf: LeafStepInput = type === "wait" ? { step_type: "wait", config: { amount: 1, unit: "days" } } : { step_type: "action", config: emptyActionConfig("send_message") };
    setSteps((prev) =>
      prev.map((st, i) => {
        if (i !== index || st.step_type !== "condition") return st;
        return branch === "yes" ? { ...st, yesSteps: [...st.yesSteps, leaf] } : { ...st, noSteps: [...st.noSteps, leaf] };
      })
    );
    setSelected(index);
    setPanelTab("no");
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
    if ((triggerType === "stage_enter" || triggerType === "stage_stale") && !triggerAllStages && triggerRefs.length === 0) {
      setError("Marque pelo menos uma etapa no gatilho (ou Todas as fases).");
      return;
    }
    // `stage`/`pipelineStageId` = primeira da lista, só pra compatibilidade; quem manda é `stageRefs`.
    const firstTrigger = triggerRefs[0];
    const triggerConfig =
      triggerType === "webhook"
        ? {}
        : triggerType === "no_reply"
          ? { days: triggerDays }
          : triggerType === "stage_enter"
            ? { stage: firstTrigger?.stage ?? "interessado", pipelineStageId: triggerAllStages ? null : firstTrigger?.pipelineStageId ?? null, allStages: triggerAllStages, stageRefs: triggerAllStages ? [] : triggerRefs }
            : { stage: firstTrigger?.stage ?? "interessado", days: triggerDays, pipelineStageId: triggerAllStages ? null : firstTrigger?.pipelineStageId ?? null, allStages: triggerAllStages, stageRefs: triggerAllStages ? [] : triggerRefs };

    const input: WorkflowInput = {
      name,
      description: description || null,
      triggerType,
      triggerConfig,
      audienceConfig: {
        stage: audienceRefs[0]?.stage ?? null,
        pipelineStageId: audienceRefs[0]?.pipelineStageId ?? null,
        stageRefs: audienceRefs,
        responsibleUserId: audienceResponsible || null,
      },
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
  // Chave da ESTRUTURA do fluxo: quando um passo entra, sai ou muda de lugar, o canvas volta ao
  // layout automático (deslocamentos manuais ficam presos a ids que agora apontam pra outro passo).
  const layoutKey = `${triggerType}|${steps.map((st) => (st.step_type === "condition" ? `c${st.yesSteps.length}.${st.noSteps.length}` : st.step_type[0])).join("")}`;

  const tabBtn = (active: boolean) =>
    `flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-md cursor-pointer transition-colors ${
      active ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text"
    }`;

  return (
    // Ocupa a área inteira do <main> (desfaz o padding dele), como o editor de um n8n/Make.
    <StageCtx.Provider value={stageOpts}>
    <div className="flex flex-col -m-4 lg:-m-5 h-[calc(100%+2rem)] lg:h-[calc(100%+2.5rem)] min-h-[560px]">
      <div className="flex items-center justify-between gap-3 flex-wrap bg-surface px-4 lg:px-5 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button type="button" onClick={() => router.push("/automacoes")} aria-label="Voltar" className="text-text-muted hover:text-text cursor-pointer p-1.5 rounded-md hover:bg-surface-2 shrink-0">
            <ArrowLeft size={20} />
          </button>
          <span className="hidden sm:grid place-items-center w-8 h-8 rounded-lg bg-primary-soft text-primary-strong shrink-0" aria-hidden>
            <WorkflowIcon size={16} />
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do workflow (ex: Follow-up de proposta)"
            aria-label="Nome do workflow"
            className="text-lg font-extrabold tracking-tight outline-none bg-transparent border-b-2 border-transparent focus:border-primary py-0.5 min-w-0 flex-1"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {error && <span className="text-xs text-danger font-medium">{error}</span>}
          <button type="button" onClick={() => router.push("/automacoes")} className="text-sm font-bold px-4 py-2 rounded-lg border border-border hover:bg-surface-2 cursor-pointer">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={pending} className="text-sm font-bold px-4 py-2 rounded-lg bg-primary-strong text-white hover:brightness-95 disabled:opacity-60 cursor-pointer">
            {pending ? "Salvando…" : "Salvar workflow"}
          </button>
        </div>
      </div>

      {loadingSteps ? (
        <div className="p-6 text-text-muted text-sm">Carregando…</div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Canvas: nós ligados por pontilhado, "+" no fim do fluxo e de cada ramo. */}
          <div className="flex-1 min-h-[420px] min-w-0">
            <WorkflowCanvas nodes={canvas.nodes} edges={canvas.edges} addSlots={canvas.addSlots} layoutKey={layoutKey} />
          </div>

          {/* Painel de propriedades (lado direito, como no n8n) */}
          <aside className="w-full lg:w-[380px] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface flex flex-col min-h-0">
            <div className="p-3 border-b border-border">
              <div className="flex gap-1 bg-surface-2 rounded-lg p-1" role="tablist">
                <button type="button" role="tab" aria-selected={panelTab === "no"} onClick={() => setPanelTab("no")} className={tabBtn(panelTab === "no")}>
                  <GitBranch size={13} /> Nó selecionado
                </button>
                <button type="button" role="tab" aria-selected={panelTab === "regras"} onClick={() => setPanelTab("regras")} className={tabBtn(panelTab === "regras")}>
                  <Settings2 size={13} /> Regras
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 flex flex-col gap-3 [&_textarea]:w-full [&_select]:max-w-full">
              {panelTab === "no" && (
                <>
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
                        <StageChecklist
                          refs={triggerRefs}
                          allChecked={triggerAllStages}
                          allLabel="Todas as fases"
                          onChange={(refs, all) => {
                            setTriggerRefs(refs);
                            setTriggerAllStages(all);
                          }}
                        />
                      )}
                      {(triggerType === "stage_enter" || triggerType === "stage_stale") && triggerAllStages && (
                        <p className="text-[11px] text-text-muted">
                          {triggerType === "stage_enter"
                            ? "Dispara sempre que o lead mudar de etapa, pra qualquer uma."
                            : "Dispara quando o lead fica esse tempo sem mudar de etapa, em qualquer uma — menos ganho e perdido, que não contam como parado."}
                        </p>
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
                              <code className="block bg-surface-2 border border-border rounded-md px-2 py-1.5 break-all select-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/api/workflows/webhook/${existing.webhook_token}`}</code>
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
                      <StageChecklist
                        refs={audienceRefs}
                        allChecked={audienceRefs.length === 0}
                        allLabel="Qualquer etapa"
                        onChange={(refs) => setAudienceRefs(refs)}
                      />
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

                  <p className="text-[11px] text-text-muted mt-auto pt-2 border-t border-border">
                    Clique num nó pra editar. Use o <strong className="text-text">+</strong> no fim do fluxo ou de cada ramo pra adicionar passos.
                  </p>
                </>
              )}

              {panelTab === "regras" && (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-text-muted">Descrição</span>
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Descrição (opcional)"
                      className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </label>
                  <h3 className="text-sm font-bold mt-1">Regras de parada e segurança</h3>
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
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
    </StageCtx.Provider>
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
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
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface outline-none focus:border-primary flex-1 min-w-0"
        >
          {CONDITION_TYPES.map((c) => (
            <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
          ))}
        </select>
      </div>

      {config.condition_type === "stage_is" && (
        <StageSelect stage={config.stage} pipelineStageId={config.pipelineStageId} onChange={(st, id) => st && onChange({ ...config, stage: st, pipelineStageId: id })} />
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

      <div className="grid gap-2">
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
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface outline-none focus:border-primary flex-1 min-w-0"
        >
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a]}</option>
          ))}
        </select>
      </div>

      {config.action_type === "send_message" && (
        <WorkflowSendConfig
          config={config}
          onChange={(next) => onChange({ ...config, ...next })}
          textPlaceholder="Use {{nome}}, {{primeiro_nome}}, {{sobrenome}}, {{telefone}}, {{empresa}}, {{etapa}}, {{responsavel}}, {{data_criacao}}, {{campo:chave}}"
        />
      )}
      {config.action_type === "add_note" && (
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
        <StageSelect stage={config.stage} pipelineStageId={config.pipelineStageId} onChange={(st, id) => st && onChange({ ...config, stage: st, pipelineStageId: id })} />
      )}
      {config.action_type === "http_request" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
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
              className="flex-1 min-w-0 border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary bg-surface"
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
