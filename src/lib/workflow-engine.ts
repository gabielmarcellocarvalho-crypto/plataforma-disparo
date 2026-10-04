import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/evolution";
import { sendDialog360Text } from "@/lib/dialog360";
import { sendMetaCloudText, sendMetaCloudTemplate } from "@/lib/metacloud";
import { fieldValue } from "@/lib/template-send";
import {
  interpolateVariables,
  type ActionConfig,
  type AudienceConfig,
  type ConditionConfig,
  type SendMode,
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
  email?: string | null;
  pipeline_id?: string | null;
  pipeline_stage_id?: string | null;
  created_at?: string;
  custom_fields?: Record<string, unknown> | null;
};

const CONTACT_SELECT = "id, workspace_id, name, phone, email, stage, stage_changed_at, responsible_user_id, company_id, whatsapp_instance_id, pipeline_id, pipeline_stage_id, created_at, custom_fields";

// O PostgREST devolve no máximo 1000 linhas por resposta (teto do servidor, ignora .limit()), então
// toda busca "traz tudo" daqui pagina de verdade. `build` monta a query do zero a cada página, com
// ordem estável — sem ordem definida o PostgREST embaralha as linhas entre páginas. Erro vira exceção:
// antes a falha era engolida e o motor seguia com lista vazia, sem ninguém perceber.
const PAGE_SIZE = 1000;
type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
async function fetchAllPages<T>(build: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// Lista de ids vai na URL; em blocos pequenos ela fica curta. Um .in() com ~1000 uuids passava de 37KB
// de URL, o PostgREST devolvia 400 a cada minuto e cada falha gravava a URL inteira no log — sozinha,
// essa consulta era a maior fonte de log do projeto.
const ID_CHUNK = 50;
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

// ── Etapa exata de funil personalizado ────────────────────────────────────────────────────────
// O lead está na etapa X quando pipeline_stage_id = X, ou quando nunca foi movido num funil
// (pipeline_stage_id nulo) e X é a etapa que representa o sinal dele no funil padrão — mesma regra
// do Kanban (stageForSignal: primeira etapa do funil com aquele sinal).
export type StageRef = { id: string; pipeline_id: string; signal: string; position: number; isDefault: boolean };
const stageCache = new Map<string, Promise<StageRef[]>>();
function loadStages(supabase: AdminClient, workspaceId: string): Promise<StageRef[]> {
  if (!stageCache.has(workspaceId)) {
    stageCache.set(
      workspaceId,
      (async () => {
        const [{ data: stages }, { data: pipes }] = await Promise.all([
          supabase.from("pipeline_stages").select("id, pipeline_id, signal, position").eq("workspace_id", workspaceId),
          supabase.from("pipelines").select("id, is_default").eq("workspace_id", workspaceId),
        ]);
        const defaults = new Set((pipes || []).filter((p) => p.is_default).map((p) => p.id as string));
        return (stages || []).map((st) => ({ ...(st as Omit<StageRef, "isDefault">), isDefault: defaults.has(st.pipeline_id as string) }));
      })()
    );
  }
  return stageCache.get(workspaceId)!;
}
export function isInPipelineStage(contact: Contact, stageId: string, stages: StageRef[]): boolean {
  if (contact.pipeline_stage_id) return contact.pipeline_stage_id === stageId;
  const alvo = stages.find((st) => st.id === stageId);
  if (!alvo || !alvo.isDefault || contact.stage !== alvo.signal) return false;
  const primeira = stages.filter((st) => st.pipeline_id === alvo.pipeline_id && st.signal === alvo.signal).sort((a, b) => a.position - b.position)[0];
  return primeira?.id === stageId;
}

// Etapas marcadas num gatilho/público. null = sem filtro de etapa (todas). Lê o formato novo (lista
// `stageRefs`) e o antigo (um `stage` + `pipelineStageId` opcional) — workflow salvo antes da lista
// continua funcionando igual.
type Ref = { stage: string; pipelineStageId: string | null };
export function stageRefsOf(cfg: Record<string, unknown> | null | undefined): Ref[] | null {
  if (!cfg) return null;
  if (Array.isArray(cfg.stageRefs)) {
    const refs = (cfg.stageRefs as unknown[])
      .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null))
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r.stage === "string" && r.stage))
      .map((r) => ({ stage: String(r.stage), pipelineStageId: typeof r.pipelineStageId === "string" && r.pipelineStageId ? r.pipelineStageId : null }));
    if (refs.length) return refs;
  }
  if (typeof cfg.stage === "string" && cfg.stage) {
    return [{ stage: cfg.stage, pipelineStageId: typeof cfg.pipelineStageId === "string" && cfg.pipelineStageId ? cfg.pipelineStageId : null }];
  }
  return null;
}

// O lead está em alguma das etapas marcadas? Etapa exata de funil vence; senão compara o sinal.
export function matchesStageRefs(contact: Contact, refs: Ref[], stages: StageRef[]): boolean {
  return refs.some((r) => (r.pipelineStageId ? isInPipelineStage(contact, r.pipelineStageId, stages) : contact.stage === r.stage));
}

async function findTriggerCandidates(supabase: AdminClient, workflow: WorkflowRow): Promise<Contact[]> {
  const audience = (workflow.audience_config || {}) as Record<string, unknown>;
  const cfg = (workflow.trigger_config || {}) as Record<string, unknown>;
  const audienceRefs = stageRefsOf(audience);
  const usesStage = workflow.trigger_type === "stage_enter" || workflow.trigger_type === "stage_stale";
  const triggerRefs = usesStage && cfg.allStages !== true ? stageRefsOf(cfg) : null;
  // Gatilho de etapa sem nenhuma etapa marcada e sem "todas" = mal configurado, não dispara.
  if (usesStage && cfg.allStages !== true && !triggerRefs) return [];

  const signals = (refs: Ref[]) => [...new Set(refs.map((r) => r.stage))];

  const base = () => {
    let query = supabase.from("contacts").select(CONTACT_SELECT).eq("workspace_id", workflow.workspace_id);
    // Filtro grosso por sinal no banco; a etapa exata do funil é conferida depois, em memória.
    if (audienceRefs) query = query.in("stage", signals(audienceRefs));
    if (typeof audience.responsibleUserId === "string" && audience.responsibleUserId) query = query.eq("responsible_user_id", audience.responsibleUserId);
    return query;
  };

  let build: () => ReturnType<typeof base>;
  if (workflow.trigger_type === "stage_enter") {
    // Janela de captura precisa ser folgada o bastante pra cobrir o intervalo entre execuções do
    // cron externo — quem mudou de etapa nos últimos 30min é considerado "acabou de entrar".
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    build = () => (triggerRefs ? base().in("stage", signals(triggerRefs)) : base()).gte("stage_changed_at", cutoff);
  } else if (workflow.trigger_type === "stage_stale") {
    const days = Number(cfg.days) || 3;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    // "Todas as fases": ganho e perdido não contam como parado (mesma regra do selo do Pipeline).
    build = () => (triggerRefs ? base().in("stage", signals(triggerRefs)) : base().not("stage", "in", "(concluido,descartado)")).lte("stage_changed_at", cutoff);
  } else if (workflow.trigger_type === "no_reply") {
    build = () => base().not("stage", "in", "(concluido,descartado)");
  } else {
    return [];
  }

  let rows = await fetchAllPages<Contact>((from, to) => build().order("id").range(from, to) as unknown as PageResult<Contact>);
  const needsExact = [...(triggerRefs || []), ...(audienceRefs || [])].some((r) => r.pipelineStageId);
  if (triggerRefs || audienceRefs) {
    const stages = needsExact ? await loadStages(supabase, workflow.workspace_id) : [];
    rows = rows.filter((c) => (!triggerRefs || matchesStageRefs(c, triggerRefs, stages)) && (!audienceRefs || matchesStageRefs(c, audienceRefs, stages)));
  }
  return rows;
}

// "Ficou X dias sem responder": pega a última mensagem enviada (assistant) e a última recebida
// (user) por contato — só qualifica quem tem outbound mais recente que o inbound (ou nunca respondeu)
// e isso já passou do prazo configurado.
//
// REGRA: só entra quem JÁ ABRIU CONVERSA (respondeu pelo menos uma vez). Lead que só recebeu disparo
// não é "conversa parada", é base fria — e sem essa trava um workspace com milhares de leads de disparo
// mandaria texto livre pra todos de uma vez (que a API oficial ainda recusa fora da janela de 24h).
type MessageStamp = { contact_id: string; created_at: string };
async function filterNoReplyCandidates(supabase: AdminClient, workflow: WorkflowRow, contacts: Contact[]): Promise<Contact[]> {
  if (contacts.length === 0) return [];
  const days = Number((workflow.trigger_config as Record<string, unknown>).days) || 3;
  const cutoff = Date.now() - days * 86_400_000;

  // Última resposta de cada lead do workspace. Resposta é bem mais rara que envio (disparo gera
  // milhares de linhas), então partir das respostas mantém a busca pequena.
  const inbound = await fetchAllPages<MessageStamp>((from, to) =>
    supabase
      .from("messages")
      .select("contact_id, created_at")
      .eq("workspace_id", workflow.workspace_id)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to) as unknown as PageResult<MessageStamp>
  );
  const lastInbound = new Map<string, number>();
  for (const m of inbound) {
    if (!lastInbound.has(m.contact_id)) lastInbound.set(m.contact_id, new Date(m.created_at).getTime());
  }

  const opened = contacts.filter((c) => lastInbound.has(c.id));
  if (opened.length === 0) return [];

  // Último envio nosso DEPOIS da última resposta — só isso interessa, então a busca começa na resposta
  // mais antiga do bloco em vez de trazer o histórico inteiro de disparo de cada lead.
  const lastOutbound = new Map<string, number>();
  for (const ids of chunk(opened.map((c) => c.id), ID_CHUNK)) {
    const since = new Date(Math.min(...ids.map((id) => lastInbound.get(id)!))).toISOString();
    const outbound = await fetchAllPages<MessageStamp>((from, to) =>
      supabase
        .from("messages")
        .select("contact_id, created_at")
        .in("contact_id", ids)
        .eq("role", "assistant")
        .gt("created_at", since)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to) as unknown as PageResult<MessageStamp>
    );
    for (const m of outbound) {
      if (!lastOutbound.has(m.contact_id)) lastOutbound.set(m.contact_id, new Date(m.created_at).getTime());
    }
  }

  return opened.filter((c) => {
    const out = lastOutbound.get(c.id);
    if (!out) return false; // a última palavra foi do lead: quem está devendo resposta somos nós
    return out > lastInbound.get(c.id)! && out <= cutoff;
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
  if (cond.condition_type === "stage_is") {
    if (cond.pipelineStageId) return isInPipelineStage(contact, cond.pipelineStageId, await loadStages(supabase, contact.workspace_id));
    return contact.stage === cond.stage;
  }
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

    const mode: SendMode = action.mode ?? "free";
    const official = instance.channel !== "evolution";
    if (mode === "template" && !official) return { ok: false, detail: { error: "template só existe na conexão oficial da Meta" } };

    // Texto livre na API oficial: a Meta só aceita dentro de 24h da última mensagem do lead. Sem essa
    // checagem, a mensagem sumia (a Meta recusava e o histórico nem registrava o motivo).
    if (official && mode === "free") {
      const { data: last } = await supabase
        .from("messages")
        .select("created_at")
        .eq("contact_id", contact.id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const dentroDaJanela = last && Date.now() - new Date(last.created_at as string).getTime() < 24 * 60 * 60 * 1000;
      if (!dentroDaJanela) {
        return { ok: false, detail: { error: "fora da janela de 24h: o lead não falou nas últimas 24h. Use um template aprovado nesse passo." } };
      }
    }

    let content: string;
    let billing: string | null = null;
    try {
      if (mode === "template") {
        const tpl = action.template;
        if (!tpl?.name) return { ok: false, detail: { error: "nenhum template escolhido nesse passo" } };
        if (!instance.phone_number_id) return { ok: false, detail: { error: "número sem phone_number_id" } };
        const params = tpl.variables.map((field) => fieldValue(field, contact, vars.company_name));
        const empty = params.findIndex((v) => !v);
        if (empty >= 0) return { ok: false, detail: { error: `o lead não tem o campo da variável {{${empty + 1}}} (${tpl.variables[empty]})` } };
        await sendMetaCloudTemplate(instance.phone_number_id, contact.phone, tpl.name, tpl.language || "pt_BR", params);
        content = `[Template: ${tpl.name}]`;
        billing = tpl.category || "MARKETING";
      } else {
        content = interpolateVariables(action.text, vars);
        if (instance.channel === "360dialog") {
          if (!instance.dialog360_api_key) return { ok: false, detail: { error: "sem api key 360dialog" } };
          await sendDialog360Text(instance.dialog360_api_key, contact.phone, content);
        } else if (instance.channel === "metacloud") {
          if (!instance.phone_number_id) return { ok: false, detail: { error: "sem phone_number_id" } };
          await sendMetaCloudText(instance.phone_number_id, contact.phone, content);
        } else {
          if (!instance.instance_name) return { ok: false, detail: { error: "sem instância evolution" } };
          await sendText(instance.instance_name, contact.phone, content);
        }
      }
    } catch (err) {
      return { ok: false, detail: { error: `falha ao enviar: ${err instanceof Error ? err.message.slice(0, 300) : "erro desconhecido"}` } };
    }

    await supabase.from("messages").insert({
      workspace_id: contact.workspace_id,
      contact_id: contact.id,
      agent_id: null,
      role: "assistant",
      content,
      billing_category: billing,
    });
    return { ok: true, detail: { text: content, mode } };
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
    // Etapa exata do funil: grava etapa + funil + sinal juntos (igual arrastar no Kanban).
    if (action.pipelineStageId) {
      const etapa = (await loadStages(supabase, contact.workspace_id)).find((st) => st.id === action.pipelineStageId);
      if (etapa) {
        const { error } = await supabase
          .from("contacts")
          .update({ stage: etapa.signal, pipeline_id: etapa.pipeline_id, pipeline_stage_id: etapa.id, stage_changed_at: new Date().toISOString() })
          .eq("id", contact.id);
        return { ok: !error, detail: { stage: etapa.signal, pipelineStageId: etapa.id } };
      }
    }
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
  stageCache.clear();
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

    // Um workflow com problema não pode travar os outros do mesmo tick.
    try {
      enrolled += await enrollCandidates(supabase, workflow, stepRows);
      processed += await processDueRuns(supabase, workflow, stepRows);
    } catch (err) {
      console.error(`Workflow ${workflow.id} falhou neste tick:`, err instanceof Error ? err.message : err);
    }
  }
  return { enrolled, processed };
}
