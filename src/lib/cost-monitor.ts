// Monitor de custo de IA por workspace: custo real do mês (tokens Anthropic) vs. orçamento definido.
// Usado na Visão geral (banner de alerta) e nas Métricas (card de orçamento). Colaborador-only.
import { createClient } from "@/lib/supabase/server";
import { estimateAnthropicCostUsd } from "@/lib/pricing-calculator";
import { COST_USD_TO_BRL, DEFAULT_DELIVERY_RATE_BRL } from "@/lib/cost-constants";
import { eachDayBrt, dayKeyBrt } from "@/lib/period";

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

  return (data || []).reduce((sum, row) => sum + costRowUsd(row), 0);
}

export type AgentCostRow = { agentId: string; name: string; costUsd: number; messages: number; conversations: number };
export type DailyCostPoint = { date: string; ia: number; entrega: number };
export type Range = { from: Date; to: Date };

function costRowUsd(row: {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}): number {
  return estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
    inputTokens: row.input_tokens || 0,
    outputTokens: row.output_tokens || 0,
    cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
    cacheReadInputTokens: row.cache_read_input_tokens || 0,
  });
}

// Versões com período arbitrário (filtro de Métricas/Visão geral) — as funções "MonthToDate" acima
// continuam existindo à parte porque o orçamento (`monthly_cost_budget_brl`) é um conceito
// inerentemente mensal, independente do período que o usuário está navegando na tela.
export async function getCostByAgentInRange(workspaceId: string, range: Range): Promise<AgentCostRow[]> {
  const supabase = await createClient();
  const [{ data: msgs }, { data: agents }] = await Promise.all([
    supabase
      .from("messages")
      .select("agent_id, contact_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
      .eq("workspace_id", workspaceId)
      .eq("role", "assistant")
      .not("agent_id", "is", null)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .limit(20000),
    supabase.from("agents").select("id, name").eq("workspace_id", workspaceId),
  ]);

  const nameById = new Map((agents || []).map((a) => [a.id as string, a.name as string]));
  const acc = new Map<string, { costUsd: number; messages: number; conv: Set<string> }>();

  for (const m of msgs || []) {
    const id = m.agent_id as string;
    const bucket = acc.get(id) || { costUsd: 0, messages: 0, conv: new Set<string>() };
    bucket.costUsd += costRowUsd(m);
    bucket.messages += 1;
    bucket.conv.add(m.contact_id as string);
    acc.set(id, bucket);
  }

  return [...acc.entries()]
    .map(([agentId, v]) => ({ agentId, name: nameById.get(agentId) || "agente removido", costUsd: v.costUsd, messages: v.messages, conversations: v.conv.size }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

// Custo por dia dentro do período (qualquer duração) — mesma decomposição IA medida + entrega
// estimada do gráfico de Métricas, só que sem travar em "mês corrente".
export async function getDailyCostInRange(workspaceId: string, range: Range): Promise<DailyCostPoint[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("created_at, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
    .eq("workspace_id", workspaceId)
    .eq("role", "assistant")
    .not("agent_id", "is", null)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString())
    .limit(20000);

  const days = eachDayBrt(range.from, range.to);
  const usdByDay = new Map(days.map((d) => [d, 0]));
  const msgByDay = new Map(days.map((d) => [d, 0]));

  for (const row of data || []) {
    const key = dayKeyBrt(row.created_at as string);
    if (!usdByDay.has(key)) continue;
    usdByDay.set(key, (usdByDay.get(key) || 0) + costRowUsd(row));
    msgByDay.set(key, (msgByDay.get(key) || 0) + 1);
  }

  return days.map((d) => ({
    date: `${d}T12:00:00.000Z`,
    ia: Math.round((usdByDay.get(d) || 0) * COST_USD_TO_BRL * 100) / 100,
    entrega: Math.round((msgByDay.get(d) || 0) * DEFAULT_DELIVERY_RATE_BRL * 100) / 100,
  }));
}

// Conversas (par único contato+agente) que tiveram resposta de agente dentro do período — mesma
// definição usada na tela de Conversas e na Visão geral.
export async function getConversationsInRange(workspaceId: string, range: Range): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("contact_id, agent_id")
    .eq("workspace_id", workspaceId)
    .not("agent_id", "is", null)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString())
    .limit(20000);

  return new Set((data || []).map((m) => `${m.contact_id}:${m.agent_id}`)).size;
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
