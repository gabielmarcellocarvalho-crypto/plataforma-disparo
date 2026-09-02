"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, requireStaff } from "@/lib/workspace";
import type { AudienceConfig, LeafStepInput, TriggerType, WorkflowStepInput } from "@/lib/workflow-types";

export type ActionResult = { error: string | null; ok?: boolean; id?: string };

export type WorkflowInput = {
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  audienceConfig: AudienceConfig;
  stopOnReply: boolean;
  stopOnStageChange: boolean;
  respectBusinessHours: boolean;
  allowReentry: boolean;
  reentryCooldownHours: number | null;
  steps: WorkflowStepInput[];
};

export type WorkflowListRow = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  audience_config: AudienceConfig;
  stop_on_reply: boolean;
  stop_on_stage_change: boolean;
  respect_business_hours: boolean;
  allow_reentry: boolean;
  reentry_cooldown_hours: number | null;
  webhook_token: string | null;
  step_count: number;
  running_count: number;
  completed_count: number;
};

export async function getWorkflows(): Promise<WorkflowListRow[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name, description, enabled, trigger_type, trigger_config, audience_config, stop_on_reply, stop_on_stage_change, respect_business_hours, allow_reentry, reentry_cooldown_hours, webhook_token")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });
  if (!workflows || workflows.length === 0) return [];

  const ids = workflows.map((w) => w.id);
  const [{ data: steps }, { data: runs }] = await Promise.all([
    supabase.from("workflow_steps").select("workflow_id").in("workflow_id", ids),
    supabase.from("workflow_runs").select("workflow_id, status").in("workflow_id", ids),
  ]);

  const stepCount = new Map<string, number>();
  for (const s of steps || []) stepCount.set(s.workflow_id, (stepCount.get(s.workflow_id) || 0) + 1);
  const runningCount = new Map<string, number>();
  const completedCount = new Map<string, number>();
  for (const r of runs || []) {
    if (r.status === "running" || r.status === "waiting") runningCount.set(r.workflow_id, (runningCount.get(r.workflow_id) || 0) + 1);
    if (r.status === "completed") completedCount.set(r.workflow_id, (completedCount.get(r.workflow_id) || 0) + 1);
  }

  return workflows.map((w) => ({
    ...w,
    audience_config: (w.audience_config || {}) as AudienceConfig,
    step_count: stepCount.get(w.id) || 0,
    running_count: runningCount.get(w.id) || 0,
    completed_count: completedCount.get(w.id) || 0,
  }));
}

type StepRow = { id: string; parent_step_id: string | null; branch: "yes" | "no" | null; position: number; step_type: WorkflowStepInput["step_type"]; config: unknown };

// Reconstrói a árvore (passos de topo, com filhos SIM/NÃO embutidos nos de tipo 'condition') a
// partir das linhas achatadas do banco — inverso de replaceSteps.
export async function getWorkflowSteps(workflowId: string): Promise<WorkflowStepInput[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workflow_steps")
    .select("id, parent_step_id, branch, position, step_type, config")
    .eq("workflow_id", workflowId)
    .order("position", { ascending: true });
  const rows = (data || []) as StepRow[];

  const top = rows.filter((r) => !r.parent_step_id).sort((a, b) => a.position - b.position);
  const childrenOf = (parentId: string, branch: "yes" | "no") =>
    rows
      .filter((r) => r.parent_step_id === parentId && r.branch === branch)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ step_type: r.step_type, config: r.config }) as LeafStepInput);

  return top.map((r) => {
    if (r.step_type === "condition") {
      return { step_type: "condition", config: r.config, yesSteps: childrenOf(r.id, "yes"), noSteps: childrenOf(r.id, "no") } as WorkflowStepInput;
    }
    return { step_type: r.step_type, config: r.config } as WorkflowStepInput;
  });
}

// Achata a árvore em linhas de workflow_steps: passos de topo primeiro (pra ter os ids reais dos
// passos 'condition'), depois os filhos de cada branch referenciando esses ids via parent_step_id.
async function replaceSteps(supabase: Awaited<ReturnType<typeof createClient>>, workflowId: string, workspaceId: string, steps: WorkflowStepInput[]) {
  await supabase.from("workflow_steps").delete().eq("workflow_id", workflowId);
  if (steps.length === 0) return;

  const topRows = steps.map((s, i) => ({
    workflow_id: workflowId,
    workspace_id: workspaceId,
    position: i,
    step_type: s.step_type,
    config: s.config,
  }));
  const { data: inserted } = await supabase.from("workflow_steps").insert(topRows).select("id, position");
  if (!inserted) return;
  const idByPosition = new Map(inserted.map((r) => [r.position, r.id]));

  const childRows: { workflow_id: string; workspace_id: string; parent_step_id: string; branch: "yes" | "no"; position: number; step_type: string; config: unknown }[] = [];
  steps.forEach((s, i) => {
    if (s.step_type !== "condition") return;
    const parentId = idByPosition.get(i);
    if (!parentId) return;
    s.yesSteps.forEach((cs, ci) => childRows.push({ workflow_id: workflowId, workspace_id: workspaceId, parent_step_id: parentId, branch: "yes", position: ci, step_type: cs.step_type, config: cs.config }));
    s.noSteps.forEach((cs, ci) => childRows.push({ workflow_id: workflowId, workspace_id: workspaceId, parent_step_id: parentId, branch: "no", position: ci, step_type: cs.step_type, config: cs.config }));
  });
  if (childRows.length > 0) await supabase.from("workflow_steps").insert(childRows);
}

export async function createWorkflow(input: WorkflowInput): Promise<ActionResult> {
  await requireStaff();
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (!input.name.trim()) return { error: "Dê um nome pro workflow." };
  if (input.steps.length === 0) return { error: "Adicione pelo menos um passo." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: workflow, error } = await supabase
    .from("workflows")
    .insert({
      workspace_id: workspace.id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig,
      audience_config: input.audienceConfig,
      stop_on_reply: input.stopOnReply,
      stop_on_stage_change: input.stopOnStageChange,
      respect_business_hours: input.respectBusinessHours,
      allow_reentry: input.allowReentry,
      reentry_cooldown_hours: input.reentryCooldownHours,
      webhook_token: input.triggerType === "webhook" ? randomBytes(24).toString("hex") : null,
      created_by: user?.id || null,
    })
    .select("id")
    .maybeSingle();
  if (error || !workflow) {
    console.error("createWorkflow insert error", error);
    return { error: "Não foi possível criar o workflow." };
  }

  await replaceSteps(supabase, workflow.id, workspace.id, input.steps);

  revalidatePath("/automacoes");
  return { error: null, ok: true, id: workflow.id };
}

export async function updateWorkflow(workflowId: string, input: WorkflowInput): Promise<ActionResult> {
  await requireStaff();
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (!input.name.trim()) return { error: "Dê um nome pro workflow." };
  if (input.steps.length === 0) return { error: "Adicione pelo menos um passo." };

  const supabase = await createClient();

  let webhookToken: string | null | undefined;
  if (input.triggerType === "webhook") {
    const { data: current } = await supabase.from("workflows").select("webhook_token").eq("id", workflowId).maybeSingle();
    webhookToken = current?.webhook_token || randomBytes(24).toString("hex");
  } else {
    webhookToken = null;
  }

  const { error } = await supabase
    .from("workflows")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig,
      audience_config: input.audienceConfig,
      stop_on_reply: input.stopOnReply,
      stop_on_stage_change: input.stopOnStageChange,
      respect_business_hours: input.respectBusinessHours,
      allow_reentry: input.allowReentry,
      reentry_cooldown_hours: input.reentryCooldownHours,
      webhook_token: webhookToken,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflowId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível salvar o workflow." };

  await replaceSteps(supabase, workflowId, workspace.id, input.steps);

  revalidatePath("/automacoes");
  return { error: null, ok: true };
}

export async function toggleWorkflow(workflowId: string, enabled: boolean): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("workflows").update({ enabled }).eq("id", workflowId);
  if (error) return { error: "Não foi possível atualizar o workflow." };
  revalidatePath("/automacoes");
  return { error: null, ok: true };
}

export async function deleteWorkflow(workflowId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("workflows").delete().eq("id", workflowId);
  if (error) return { error: "Não foi possível excluir o workflow." };
  revalidatePath("/automacoes");
  return { error: null, ok: true };
}

export type WorkflowRunStatus = "running" | "waiting" | "completed" | "stopped" | "error";

export type WorkflowRunEvent = { id: string; step_id: string | null; event_type: string; detail: Record<string, unknown>; created_at: string };

export type WorkflowRunRow = {
  id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  status: WorkflowRunStatus;
  stop_reason: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  events: WorkflowRunEvent[];
};

// Histórico de execução (item 10 do pedido do usuário) — as 50 execuções mais recentes desse
// workflow, com a timeline de eventos que o motor já grava desde a Fase 1 (workflow_run_events).
export async function getWorkflowRuns(workflowId: string): Promise<WorkflowRunRow[]> {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("workflow_runs")
    .select("id, contact_id, status, stop_reason, started_at, updated_at, completed_at, contacts(name, phone)")
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false })
    .limit(50);
  const rows = runs || [];
  if (rows.length === 0) return [];

  const { data: events } = await supabase
    .from("workflow_run_events")
    .select("id, run_id, step_id, event_type, detail, created_at")
    .in(
      "run_id",
      rows.map((r) => r.id)
    )
    .order("created_at", { ascending: true });

  const eventsByRun = new Map<string, WorkflowRunEvent[]>();
  for (const e of events || []) {
    const list = eventsByRun.get(e.run_id) || [];
    list.push({ id: e.id, step_id: e.step_id, event_type: e.event_type, detail: (e.detail || {}) as Record<string, unknown>, created_at: e.created_at });
    eventsByRun.set(e.run_id, list);
  }

  return rows.map((r) => {
    const contact = r.contacts as unknown as { name: string | null; phone: string | null } | null;
    return {
      id: r.id,
      contact_id: r.contact_id,
      contact_name: contact?.name ?? null,
      contact_phone: contact?.phone ?? null,
      status: r.status as WorkflowRunStatus,
      stop_reason: r.stop_reason,
      started_at: r.started_at,
      updated_at: r.updated_at,
      completed_at: r.completed_at,
      events: eventsByRun.get(r.id) || [],
    };
  });
}
