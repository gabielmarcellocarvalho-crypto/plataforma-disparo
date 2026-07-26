// Monitor de custo de IA por workspace: custo real do mês (tokens Anthropic) vs. orçamento definido.
// Usado na Visão geral (banner de alerta) e nas Métricas (card de orçamento). Colaborador-only.
import { createClient } from "@/lib/supabase/server";
import { estimateAnthropicCostUsd } from "@/lib/pricing-calculator";
import { COST_USD_TO_BRL, DEFAULT_DELIVERY_RATE_BRL } from "@/lib/cost-constants";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
export { COST_USD_TO_BRL };

function startOfMonthIso(): string {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

// Soma o custo de IA (respostas de agente) do mês corrente pra um workspace, em USD.
export async function getMonthToDateAgentCostUsd(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
    .eq("workspace_id", workspaceId)
    .eq("role", "assistant")
    .not("agent_id", "is", null)
    .gte("created_at", startOfMonthIso());

  let usd = 0;
  for (const row of data || []) {
    usd += estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
      cacheReadInputTokens: row.cache_read_input_tokens || 0,
    });
  }
  return usd;
}

export type AgentCostRow = { agentId: string; name: string; costUsd: number; messages: number; conversations: number };

// Custo de IA do mês corrente quebrado POR AGENTE (um workspace pode ter vários) — pra saber qual
// agente está puxando o custo, não só o total do cliente.
export async function getMonthToDateCostByAgent(workspaceId: string): Promise<AgentCostRow[]> {
  const supabase = await createClient();
  const [{ data: msgs }, { data: agents }] = await Promise.all([
    supabase
      .from("messages")
      .select("agent_id, contact_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
      .eq("workspace_id", workspaceId)
      .eq("role", "assistant")
      .not("agent_id", "is", null)
      .gte("created_at", startOfMonthIso()),
    supabase.from("agents").select("id, name").eq("workspace_id", workspaceId),
  ]);

  const nameById = new Map((agents || []).map((a) => [a.id as string, a.name as string]));
  const acc = new Map<string, { costUsd: number; messages: number; conv: Set<string> }>();

  for (const m of msgs || []) {
    const id = m.agent_id as string;
    const bucket = acc.get(id) || { costUsd: 0, messages: 0, conv: new Set<string>() };
    bucket.costUsd += estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
      inputTokens: m.input_tokens || 0,
      outputTokens: m.output_tokens || 0,
      cacheCreationInputTokens: m.cache_creation_input_tokens || 0,
      cacheReadInputTokens: m.cache_read_input_tokens || 0,
    });
    bucket.messages += 1;
    bucket.conv.add(m.contact_id as string);
    acc.set(id, bucket);
  }

  return [...acc.entries()]
    .map(([agentId, v]) => ({ agentId, name: nameById.get(agentId) || "agente removido", costUsd: v.costUsd, messages: v.messages, conversations: v.conv.size }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

export type DailyCostPoint = { date: string; ia: number; entrega: number };

// Custo por dia no mês corrente (workspace inteiro), quebrado em IA (medido) + entrega estimada
// (mensagens do dia × tarifa padrão da API oficial) — alimenta o gráfico de barras em Métricas.
export async function getMonthToDateDailyCost(workspaceId: string): Promise<DailyCostPoint[]> {
  const supabase = await createClient();
  const now = new Date();
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();

  const { data } = await supabase
    .from("messages")
    .select("created_at, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
    .eq("workspace_id", workspaceId)
    .eq("role", "assistant")
    .not("agent_id", "is", null)
    .gte("created_at", startOfMonthIso())
    .limit(20000);

  const perDayUsd = new Array(daysInMonth).fill(0);
  const perDayMessages = new Array(daysInMonth).fill(0);
  for (const row of data || []) {
    const day = new Date(row.created_at as string).getUTCDate();
    if (day < 1 || day > daysInMonth) continue;
    perDayUsd[day - 1] += estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
      cacheReadInputTokens: row.cache_read_input_tokens || 0,
    });
    perDayMessages[day - 1] += 1;
  }

  return perDayUsd.map((usd, idx) => ({
    date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), idx + 1)).toISOString(),
    ia: Math.round(usd * COST_USD_TO_BRL * 100) / 100,
    entrega: Math.round(perDayMessages[idx] * DEFAULT_DELIVERY_RATE_BRL * 100) / 100,
  }));
}

export type CostBudgetStatus = {
  costBrl: number;
  budgetBrl: number | null;
  thresholdPct: number;
  ratioPct: number | null; // custo / orçamento, em %; null se não há orçamento definido
  isOver: boolean; // passou do limite de alerta
};

// Puro (sem I/O) — avalia o custo do mês contra o orçamento e o limite de alerta.
export function evalCostBudget(costUsd: number, budgetBrl: number | null, thresholdPct: number): CostBudgetStatus {
  const costBrl = costUsd * COST_USD_TO_BRL;
  if (!budgetBrl || budgetBrl <= 0) {
    return { costBrl, budgetBrl: null, thresholdPct, ratioPct: null, isOver: false };
  }
  const ratioPct = (costBrl / budgetBrl) * 100;
  return { costBrl, budgetBrl, thresholdPct, ratioPct, isOver: ratioPct >= thresholdPct };
}
