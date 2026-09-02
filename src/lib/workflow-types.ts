import type { ContactStage } from "@/lib/crm-stages";

// Catálogo Fase 1 (linear, sem ramificação SIM/NÃO — isso é Fase 2). Cada tipo aqui tem um shape de
// config específico guardado em jsonb; os campos abaixo documentam o que cada um espera.

export type TriggerType = "stage_enter" | "stage_stale" | "no_reply" | "webhook";

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  stage_enter: "Lead entrou em uma etapa",
  stage_stale: "Lead está parado numa etapa",
  no_reply: "Lead ficou sem responder",
  webhook: "Webhook (sistema externo)",
};

export const TRIGGER_DESCRIPTIONS: Record<TriggerType, string> = {
  stage_enter: "Dispara pro lead assim que ele muda pra essa etapa (não pega quem já estava lá antes).",
  stage_stale: "Dispara pro lead que está numa etapa há X dias, mesmo que já estivesse lá antes de o workflow existir.",
  no_reply: "Dispara quando mandamos uma mensagem e o lead ficou X dias sem responder.",
  webhook: "Dispara quando um sistema externo chama a URL do webhook desse workflow (ex: formulário de site, outra ferramenta).",
};

export type TriggerConfig =
  | { type: "stage_enter"; stage: ContactStage }
  | { type: "stage_stale"; stage: ContactStage; days: number }
  | { type: "no_reply"; days: number };

export type AudienceConfig = {
  stage?: ContactStage | null;
  responsibleUserId?: string | null;
};

export type ActionType = "send_message" | "create_task" | "change_stage" | "add_note" | "http_request";

export const ACTION_LABELS: Record<ActionType, string> = {
  send_message: "Enviar mensagem (WhatsApp)",
  create_task: "Criar tarefa",
  change_stage: "Mudar de etapa",
  add_note: "Adicionar observação",
  http_request: "Chamar webhook (HTTP)",
};

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type ActionConfig =
  | { action_type: "send_message"; text: string }
  | { action_type: "create_task"; title: string }
  | { action_type: "change_stage"; stage: ContactStage }
  | { action_type: "add_note"; text: string }
  | { action_type: "http_request"; method: HttpMethod; url: string; body: string };

export type WaitUnit = "minutes" | "hours" | "days";

export const WAIT_UNIT_LABELS: Record<WaitUnit, string> = {
  minutes: "minuto(s)",
  hours: "hora(s)",
  days: "dia(s)",
};

export type WaitConfig = { amount: number; unit: WaitUnit };

// Condição (Fase 2) — só 1 nível de ramificação: um passo 'condition' tem dois ramos (yes/no), cada
// um com sua própria lista linear de passos wait/action. Ramo vazio = "Parar" nesse desfecho.
export type ConditionType = "replied" | "stage_is" | "responsible_is" | "days_in_stage_gte";

export const CONDITION_LABELS: Record<ConditionType, string> = {
  replied: "Lead respondeu desde que entrou no workflow?",
  stage_is: "A etapa atual é...?",
  responsible_is: "O responsável é...?",
  days_in_stage_gte: "Está na etapa atual há pelo menos X dias?",
};

export type ConditionConfig =
  | { condition_type: "replied" }
  | { condition_type: "stage_is"; stage: ContactStage }
  | { condition_type: "responsible_is"; responsibleUserId: string }
  | { condition_type: "days_in_stage_gte"; days: number };

export type StepType = "wait" | "action" | "condition";

export type WorkflowStepRow = {
  id: string;
  workflow_id: string;
  parent_step_id: string | null;
  branch: "yes" | "no" | null;
  position: number;
  step_type: StepType;
  config: WaitConfig | ActionConfig | ConditionConfig;
};

// Formato usado pelo builder (client) e pelas actions (server) pra ler/gravar a árvore de passos —
// um passo 'condition' carrega os dois ramos embutidos (yesSteps/noSteps), só 1 nível de profundidade
// (nada de condição dentro de ramo, por enquanto). O server achata isso em linhas de workflow_steps
// com parent_step_id/branch (ver replaceSteps em app/actions/workflows.ts).
export type LeafStepInput = { step_type: "wait"; config: WaitConfig } | { step_type: "action"; config: ActionConfig };
export type WorkflowStepInput = LeafStepInput | { step_type: "condition"; config: ConditionConfig; yesSteps: LeafStepInput[]; noSteps: LeafStepInput[] };

export type WorkflowRow = {
  id: string;
  workspace_id: string;
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
  created_at: string;
  updated_at: string;
};

// Variáveis disponíveis pra interpolar em texto de mensagem/tarefa/observação/URL/corpo de webhook —
// {{nome}}, {{telefone}} etc. `campo:chave` acessa contacts.custom_fields (ex: {{campo:origem}}).
export type InterpolationContact = {
  name: string | null;
  phone: string | null;
  company_name?: string | null;
  stage?: string | null;
  responsible_name?: string | null;
  created_at?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

export function interpolateVariables(template: string, contact: InterpolationContact): string {
  const parts = (contact.name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ");
  const createdAt = contact.created_at ? new Date(contact.created_at).toLocaleDateString("pt-BR") : "";

  let result = template
    .replaceAll("{{nome}}", contact.name || "")
    .replaceAll("{{primeiro_nome}}", firstName)
    .replaceAll("{{sobrenome}}", lastName)
    .replaceAll("{{telefone}}", contact.phone || "")
    .replaceAll("{{empresa}}", contact.company_name || "")
    .replaceAll("{{etapa}}", contact.stage || "")
    .replaceAll("{{responsavel}}", contact.responsible_name || "")
    .replaceAll("{{data_criacao}}", createdAt);

  result = result.replace(/\{\{campo:([a-zA-Z0-9_-]+)\}\}/g, (_, key: string) => {
    const value = contact.custom_fields?.[key];
    return value == null ? "" : String(value);
  });

  return result;
}
