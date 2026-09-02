import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/evolution";
import { sendDialog360Text } from "@/lib/dialog360";
import { sendMetaCloudText } from "@/lib/metacloud";
import {
  interpolateVariables,
  type ActionConfig,
  type AudienceConfig,
  type ConditionConfig,
  type WaitConfig,
  type WorkflowRow,
  type WorkflowStepRow,
} from "@/lib/workflow-types";

type AdminClient = ReturnType<typeof createAdminClient>;

type Contact = {
  id: string;
  workspace_id: string;
  name: string | null;
  phone: string | null;
  stage: string;
  stage_changed_at: string;
  responsible_user_id: string | null;
  company_id: string | null;
  whatsapp_instance_id: string | null;
  created_at?: string;
  custom_fields?: Record<string, unknown> | null;
};

const CONTACT_SELECT = "id, workspace_id, name, phone, stage, stage_changed_at, responsible_user_id, company_id, whatsapp_instance_id, created_at, custom_fields";

// Resolve os campos que exigem 1 lookup extra (nome da empresa, nome do responsável) só quando o
// contato de fato tem esses ids — mensagem/tarefa/webhook usam isso pra interpolar {{empresa}} e
// {{responsavel}}.
async function resolveVariableContext(supabase: AdminClient, contact: Contact) {
  const [companyName, responsibleName] = await Promise.all([
    contact.company_id
      ? supabase.from("companies").select("name").eq("id", contact.company_id).maybeSingle().then((r) => r.data?.name ?? null)
      : Promise.resolve(null as string | null),
    contact.responsible_user_id
      ? supabase.from("profiles").select("full_name").eq("id", contact.responsible_user_id).maybeSingle().then((r) => r.data?.full_name ?? null)
      : Promise.resolve(null as string | null),
  ]);
  return {
    name: contact.name,
    phone: contact.phone,
    stage: contact.stage,
    company_name: companyName,
    responsible_name: responsibleName,
    created_at: contact.created_at ?? null,
    custom_fields: contact.custom_fields ?? null,
  };
}

const WEEKDAY_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const BUSINESS_DAYS = [1, 2, 3, 4, 5, 6];
const BUSINESS_HOUR_START = 9;
const BUSINESS_HOUR_END = 20;

// Janela sempre em horário de Brasília, igual ao motor de campanhas (dispatch-campaigns/route.ts) —
// mesmo critério, cópia local pra não acoplar os dois motores.
function isBusinessHoursNow(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = WEEKDAY_NUM[parts.find((p) => p.type === "weekday")?.value || ""] ?? new Date().getDay();
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
  return BUSINESS_DAYS.includes(weekday) && hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END;
}

function waitMs(cfg: WaitConfig): number {
  const amount = Math.max(1, Number(cfg.amount) || 1);
  if (cfg.unit === "minutes") return amount * 60_000;
  if (cfg.unit === "hours") return amount * 3_600_000;
  return amount * 86_400_000;
}

// ── Navegação no grafo de passos (Fase 2: 1 nível de ramificação) ──────────────────────────────
// Passos de topo (parent_step_id null) formam uma lista linear por `position`. Um passo 'condition'
// pode ter filhos (branch 'yes'/'no'), cada branch também uma lista linear por `position`. Ramo ou
// lista sem próximo passo = fim da execução (completed).
function firstStep(steps: WorkflowStepRow[]): WorkflowStepRow | null {
  const top = steps.filter((s) => !s.parent_step_id).sort((a, b) => a.position - b.position);
  return top[0] ?? null;
}
function nextSibling(steps: WorkflowStepRow[], step: WorkflowStepRow): WorkflowStepRow | null {
  const siblings = steps
    .filter((s) => s.parent_step_id === step.parent_step_id && s.branch === step.branch)
    .sort((a, b) => a.position - b.position);
  const idx = siblings.findIndex((s) => s.id === step.id);
  return idx >= 0 ? siblings[idx + 1] ?? null : null;
}
function firstChild(steps: WorkflowStepRow[], parentId: string, branch: "yes" | "no"): WorkflowStepRow | null {
  const children = steps.filter((s) => s.parent_step_id === parentId && s.branch === branch).sort((a, b) => a.position - b.position);
  return children[0] ?? null;
}

async function findTriggerCandidates(supabase: AdminClient, workflow: WorkflowRow): Promise<Contact[]> {
  const audience = (workflow.audience_config || {}) as AudienceConfig;
  const cfg = workflow.trigger_config as Record<string, unknown>;

  let query = supabase.from("contacts").select(CONTACT_SELECT).eq("workspace_id", workflow.workspace_id);

  if (audience.stage) query = query.eq("stage", audience.stage);
  if (audience.responsibleUserId) query = query.eq("responsible_user_id", audience.responsibleUserId);

  if (workflow.trigger_type === "stage_enter") {
    const stage = String(cfg.stage || "");
    if (!stage) return [];
    // Janela de captura precisa ser folgada o bastante pra cobrir o intervalo entre execuções do
    // cron externo — quem mudou de etapa nos últimos 30min é considerado "acabou de entrar".
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    query = query.eq("stage", stage).gte("stage_changed_at", cutoff);
  } else if (workflow.trigger_type === "stage_stale") {
    const stage = String(cfg.stage || "");
    const days = Number(cfg.days) || 3;
    if (!stage) return [];
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    query = query.eq("stage", stage).lte("stage_changed_at", cutoff);
  } else if (workflow.trigger_type === "no_reply") {
    query = query.not("stage", "in", "(concluido,descartado)");
  } else {
    return [];
  }

  const { data } = await query;
  return (data || []) as Contact[];
}

// "Ficou X dias sem responder": pega a última mensagem enviada (assistant) e a última recebida
// (user) por contato — só qualifica quem tem outbound mais recente que o inbound (ou nunca respondeu)
// e isso já passou do prazo configurado.
async function filterNoReplyCandidates(supabase: AdminClient, workflow: WorkflowRow, contacts: Contact[]): Promise<Contact[]> {
  if (contacts.length === 0) return [];
  const days = Number((workflow.trigger_config as Record<string, unknown>).days) || 3;
  const cutoff = Date.now() - days * 86_400_000;
  const contactIds = contacts.map((c) => c.id);

  const { data: messages } = await supabase
    .from("messages")
    .select("contact_id, role, created_at")
    .in("contact_id", contactIds)
    .order("created_at", { ascending: false });

  const lastOutbound = new Map<string, number>();
  const lastInbound = new Map<string, number>();
  for (const m of messages || []) {
    const t = new Date(m.created_at as string).getTime();
    if (m.role === "assistant" && !lastOutbound.has(m.contact_id as string)) lastOutbound.set(m.contact_id as string, t);
    if (m.role === "user" && !lastInbound.has(m.contact_id as string)) lastInbound.set(m.contact_id as string, t);
  }

  return contacts.filter((c) => {
    const out = lastOutbound.get(c.id);
    if (!out) return false;
    const inb = lastInbound.get(c.id);
    if (inb && inb > out) return false;
    return out <= cutoff;
  });
}

async function hasActiveOrCompletedRun(supabase: AdminClient, workflowId: string, contactId: string, allowReentry: boolean): Promise<boolean> {
  const statuses = allowReentry ? ["running", "waiting"] : ["running", "waiting", "completed"];
  const { count } = await supabase
    .from("workflow_runs")
    .select("id", { count: "exact", head: true })
    .eq("workflow_id", workflowId)
    .eq("contact_id", contactId)
    .in("status", statuses);
  return (count ?? 0) > 0;
}

// "Não executar mais de 1x por lead a cada X horas" (item 11) — vale mesmo com reentrada permitida.
async function isWithinReentryCooldown(supabase: AdminClient, workflowId: string, contactId: string, cooldownHours: number | null): Promise<boolean> {
  if (!cooldownHours) return false;
  const { data } = await supabase
    .from("workflow_runs")
    .select("started_at")
    .eq("workflow_id", workflowId)
    .eq("contact_id", contactId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return new Date(data.started_at).getTime() > Date.now() - cooldownHours * 3_600_000;
}

async function enrollCandidates(supabase: AdminClient, workflow: WorkflowRow, steps: WorkflowStepRow[]) {
  let candidates = await findTriggerCandidates(supabase, workflow);
  if (workflow.trigger_type === "no_reply") {
    candidates = await filterNoReplyCandidates(supabase, workflow, candidates);
  }
  const start = firstStep(steps);

  let enrolled = 0;
  for (const contact of candidates) {
    if (await hasActiveOrCompletedRun(supabase, workflow.id, contact.id, workflow.allow_reentry)) continue;
    if (await isWithinReentryCooldown(supabase, workflow.id, contact.id, workflow.reentry_cooldown_hours)) continue;

    const { data: run, error } = await supabase
      .from("workflow_runs")
      .insert({ workflow_id: workflow.id, workspace_id: workflow.workspace_id, contact_id: contact.id, current_step_id: start?.id ?? null, status: start ? "running" : "completed", completed_at: start ? null : new Date().toISOString() })
      .select("id")
      .maybeSingle();
    if (error || !run) continue; // índice único parcial pode rejeitar corrida concorrente — ok, ignora

    await supabase.from("workflow_run_events").insert({
      run_id: run.id,
      workspace_id: workflow.workspace_id,
      step_id: null,
      event_type: "enrolled",
      detail: { trigger_type: workflow.trigger_type },
    });
    enrolled++;
  }
  return enrolled;
}

async function contactHasStoppingReply(supabase: AdminClient, contactId: string, sinceIso: string): Promise<boolean> {
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("role", "user")
    .gt("created_at", sinceIso);
  return (count ?? 0) > 0;
}

async function evaluateCondition(supabase: AdminClient, contact: Contact, run: { started_at: string }, cond: ConditionConfig): Promise<boolean> {
  if (cond.condition_type === "replied") return contactHasStoppingReply(supabase, contact.id, run.started_at);
  if (cond.condition_type === "stage_is") return contact.stage === cond.stage;
  if (cond.condition_type === "responsible_is") return contact.responsible_user_id === cond.responsibleUserId;
  if (cond.condition_type === "days_in_stage_gte") {
    const days = (Date.now() - new Date(contact.stage_changed_at).getTime()) / 86_400_000;
    return days >= cond.days;
  }
  return false;
}

async function executeAction(supabase: AdminClient, contact: Contact, action: ActionConfig): Promise<{ ok: boolean; detail: Record<string, unknown> }> {
  const vars = await resolveVariableContext(supabase, contact);

  if (action.action_type === "send_message") {
    if (!contact.phone) return { ok: false, detail: { error: "contato sem telefone" } };
    if (!contact.whatsapp_instance_id) return { ok: false, detail: { error: "contato sem instância de WhatsApp" } };
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("channel, instance_name, dialog360_api_key, phone_number_id")
      .eq("id", contact.whatsapp_instance_id)
      .maybeSingle();
    if (!instance) return { ok: false, detail: { error: "instância não encontrada" } };

    const text = interpolateVariables(action.text, vars);
    try {
      if (instance.channel === "360dialog") {
        if (!instance.dialog360_api_key) return { ok: false, detail: { error: "sem api key 360dialog" } };
        await sendDialog360Text(instance.dialog360_api_key, contact.phone, text);
      } else if (instance.channel === "metacloud") {
        if (!instance.phone_number_id) return { ok: false, detail: { error: "sem phone_number_id" } };
        await sendMetaCloudText(instance.phone_number_id, contact.phone, text);
      } else {
        if (!instance.instance_name) return { ok: false, detail: { error: "sem instância evolution" } };
        await sendText(instance.instance_name, contact.phone, text);
      }
    } catch {
      return { ok: false, detail: { error: "falha ao enviar" } };
    }

    await supabase.from("messages").insert({
      workspace_id: contact.workspace_id,
      contact_id: contact.id,
      agent_id: null,
      role: "assistant",
      content: text,
    });
    return { ok: true, detail: { text } };
  }

  if (action.action_type === "create_task") {
    const title = interpolateVariables(action.title, vars);
    const { error } = await supabase.from("tasks").insert({
      workspace_id: contact.workspace_id,
      title,
      contact_id: contact.id,
      company_id: contact.company_id,
      responsible_user_id: contact.responsible_user_id,
    });
    return { ok: !error, detail: { title } };
  }

  if (action.action_type === "change_stage") {
    const { error } = await supabase
      .from("contacts")
      .update({ stage: action.stage, stage_changed_at: new Date().toISOString() })
      .eq("id", contact.id);
    return { ok: !error, detail: { stage: action.stage } };
  }

  if (action.action_type === "add_note") {
    const content = interpolateVariables(action.text, vars);
    const { error } = await supabase.from("contact_notes").insert({
      contact_id: contact.id,
      workspace_id: contact.workspace_id,
      author_name: "Workflow",
      content,
    });
    return { ok: !error, detail: { content } };
  }

  if (action.action_type === "http_request") {
    const url = interpolateVariables(action.url, vars);
    const body = action.method === "GET" ? undefined : interpolateVariables(action.body, vars);
    try {
      const res = await fetch(url, {
        method: action.method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, detail: { url, method: action.method, status: res.status } };
    } catch {
      return { ok: false, detail: { error: "falha ao chamar o webhook", url } };
    }
  }

  return { ok: false, detail: { error: "tipo de ação desconhecido" } };
}

async function processDueRuns(supabase: AdminClient, workflow: WorkflowRow, steps: WorkflowStepRow[]) {
  const stepsById = new Map(steps.map((s) => [s.id, s]));

  const { data: runs } = await supabase
    .from("workflow_runs")
    .select("id, contact_id, current_step_id, started_at")
    .eq("workflow_id", workflow.id)
    .in("status", ["running", "waiting"])
    .lte("next_run_at", new Date().toISOString());

  let processed = 0;
  for (const run of runs || []) {
    const { data: contact } = await supabase.from("contacts").select(CONTACT_SELECT).eq("id", run.contact_id).maybeSingle();
    if (!contact) {
      await supabase.from("workflow_runs").update({ status: "error", stop_reason: "contato não encontrado" }).eq("id", run.id);
      continue;
    }

    if (workflow.stop_on_reply && (await contactHasStoppingReply(supabase, contact.id, run.started_at))) {
      await supabase.from("workflow_runs").update({ status: "stopped", stop_reason: "lead respondeu" }).eq("id", run.id);
      await supabase.from("workflow_run_events").insert({ run_id: run.id, workspace_id: workflow.workspace_id, step_id: run.current_step_id, event_type: "stopped", detail: { reason: "lead respondeu" } });
      continue;
    }
    if (workflow.stop_on_stage_change && new Date(contact.stage_changed_at).getTime() > new Date(run.started_at).getTime()) {
      await supabase.from("workflow_runs").update({ status: "stopped", stop_reason: "lead mudou de etapa" }).eq("id", run.id);
      await supabase.from("workflow_run_events").insert({ run_id: run.id, workspace_id: workflow.workspace_id, step_id: run.current_step_id, event_type: "stopped", detail: { reason: "lead mudou de etapa" } });
      continue;
    }

    if (!run.current_step_id) {
      await supabase.from("workflow_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", run.id);
      await supabase.from("workflow_run_events").insert({ run_id: run.id, workspace_id: workflow.workspace_id, step_id: null, event_type: "completed", detail: {} });
      continue;
    }

    const step = stepsById.get(run.current_step_id);
    if (!step) {
      await supabase.from("workflow_runs").update({ status: "error", stop_reason: "passo não encontrado" }).eq("id", run.id);
      continue;
    }

    if (step.step_type === "wait") {
      const nextAt = new Date(Date.now() + waitMs(step.config as WaitConfig)).toISOString();
      const next = nextSibling(steps, step);
      await supabase.from("workflow_runs").update({ status: "waiting", current_step_id: next?.id ?? null, next_run_at: nextAt }).eq("id", run.id);
      await supabase.from("workflow_run_events").insert({ run_id: run.id, workspace_id: workflow.workspace_id, step_id: step.id, event_type: "waited", detail: { until: nextAt } });
      processed++;
      continue;
    }

    if (step.step_type === "condition") {
      const result = await evaluateCondition(supabase, contact, run, step.config as ConditionConfig);
      const branch = result ? "yes" : "no";
      const target = firstChild(steps, step.id, branch);
      await supabase
        .from("workflow_runs")
        .update({ status: target ? "running" : "completed", current_step_id: target?.id ?? null, next_run_at: new Date().toISOString(), completed_at: target ? null : new Date().toISOString() })
        .eq("id", run.id);
      await supabase.from("workflow_run_events").insert({
        run_id: run.id,
        workspace_id: workflow.workspace_id,
        step_id: step.id,
        event_type: "condition_evaluated",
        detail: { condition_type: (step.config as ConditionConfig).condition_type, result, branch },
      });
      processed++;
      continue;
    }

    // step_type === "action"
    const action = step.config as ActionConfig;
    if (action.action_type === "send_message" && workflow.respect_business_hours && !isBusinessHoursNow()) {
      continue; // fora do horário comercial — tenta de novo no próximo tick, sem avançar o passo
    }

    const result = await executeAction(supabase, contact, action);
    const next = nextSibling(steps, step);
    await supabase
      .from("workflow_runs")
      .update({
        status: next ? "running" : "completed",
        current_step_id: next?.id ?? null,
        next_run_at: new Date().toISOString(),
        completed_at: next ? null : new Date().toISOString(),
      })
      .eq("id", run.id);
    await supabase.from("workflow_run_events").insert({
      run_id: run.id,
      workspace_id: workflow.workspace_id,
      step_id: step.id,
      event_type: result.ok ? "action_executed" : "error",
      detail: { action_type: action.action_type, ...result.detail },
    });
    processed++;
  }
  return processed;
}

// Matricula 1 contato específico num workflow de gatilho 'webhook' — chamado pela rota pública
// /api/workflows/webhook/[token], fora do polling normal do tick (mesmas travas de duplicidade e
// cooldown, só que disparado sob demanda em vez de descoberto por query).
export async function enrollWebhookContact(workflowId: string, contactId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { data: workflow } = await supabase.from("workflows").select("*").eq("id", workflowId).maybeSingle();
  if (!workflow || !workflow.enabled) return { ok: false, error: "workflow inativo" };

  const workflowRow = workflow as WorkflowRow;
  if (await hasActiveOrCompletedRun(supabase, workflowId, contactId, workflowRow.allow_reentry)) return { ok: false, error: "contato já está nesse workflow" };
  if (await isWithinReentryCooldown(supabase, workflowId, contactId, workflowRow.reentry_cooldown_hours)) return { ok: false, error: "dentro do prazo de espera pra reentrada" };

  const { data: steps } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id, parent_step_id, branch, position, step_type, config")
    .eq("workflow_id", workflowId)
    .order("position", { ascending: true });
  const start = firstStep((steps || []) as WorkflowStepRow[]);

  const { data: run, error } = await supabase
    .from("workflow_runs")
    .insert({ workflow_id: workflowId, workspace_id: workflowRow.workspace_id, contact_id: contactId, current_step_id: start?.id ?? null, status: start ? "running" : "completed", completed_at: start ? null : new Date().toISOString() })
    .select("id")
    .maybeSingle();
  if (error || !run) return { ok: false, error: "não foi possível matricular" };

  await supabase.from("workflow_run_events").insert({
    run_id: run.id,
    workspace_id: workflowRow.workspace_id,
    step_id: null,
    event_type: "enrolled",
    detail: { trigger_type: "webhook" },
  });
  return { ok: true };
}

export async function runWorkflowsTick(): Promise<{ enrolled: number; processed: number }> {
  const supabase = createAdminClient();
  const { data: workflows } = await supabase.from("workflows").select("*").eq("enabled", true);

  let enrolled = 0;
  let processed = 0;
  for (const workflow of (workflows || []) as WorkflowRow[]) {
    const { data: steps } = await supabase
      .from("workflow_steps")
      .select("id, workflow_id, parent_step_id, branch, position, step_type, config")
      .eq("workflow_id", workflow.id)
      .order("position", { ascending: true });
    const stepRows = (steps || []) as WorkflowStepRow[];

    enrolled += await enrollCandidates(supabase, workflow, stepRows);
    processed += await processDueRuns(supabase, workflow, stepRows);
  }
  return { enrolled, processed };
}
