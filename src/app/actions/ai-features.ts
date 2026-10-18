"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { askJson, LIGHT_MODEL } from "@/lib/ai-light";
import { recordAiUsage } from "@/lib/ai-usage";
import { getMonthToDateAgentCostUsd, COST_USD_TO_BRL } from "@/lib/cost-monitor";
import { ANALYSIS_SYSTEM, analysisPrompt, conversationTranscript, normalizeAnalysis, type LeadAnalysis } from "@/lib/lead-analysis";
import { INSIGHTS_SYSTEM, insightsPrompt, normalizeInsights, type AiInsight } from "@/lib/ai-insights";
import { resolveStageLabels, isContactStage, STALE_AFTER_DAYS, daysSince } from "@/lib/crm-stages";
import { generateReply, type ConversationMessage } from "@/lib/agent-reply";
import { generateReplyGemini } from "@/lib/agent-reply-gemini";
import { normalizeAgentConfig } from "@/lib/agent-prompt";
import { HUMANIZADO_CONVERSATION_BLOCK } from "@/lib/conversation-closing";

type Result<T> = { error: string; data?: undefined } | { error: null; data: T };

// Coluna nova (migration 0089) ainda não criada: erro do Postgres "column ... does not exist".
const missingColumn = (msg: string | undefined) => Boolean(msg && /column .* does not exist|schema cache/i.test(msg));
const MIGRATION_HINT = "Rode a migração 0089 no Supabase pra liberar essa função.";

// Mesmo teto do agente (workspaces.monthly_cost_budget_brl): com o orçamento do mês estourado, as funções
// extras de IA também param — elas somam no mesmo custo.
const BUDGET_HINT = "Orçamento mensal de IA desse workspace foi atingido. Ajuste em Métricas pra usar de novo.";
async function overBudget(workspaceId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("workspaces").select("monthly_cost_budget_brl").eq("id", workspaceId).maybeSingle();
  if (!data?.monthly_cost_budget_brl) return false;
  return (await getMonthToDateAgentCostUsd(admin, workspaceId)) * COST_USD_TO_BRL >= data.monthly_cost_budget_brl;
}

// ── Valor do negócio ──────────────────────────────────────────────────────────────────────────────

export async function updateDealValue(contactId: string, value: number | null): Promise<Result<true>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1e11)) return { error: "Valor inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ deal_value: value === null ? null : Math.round(value * 100) / 100 })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: missingColumn(error.message) ? MIGRATION_HINT : "Não foi possível salvar o valor." };
  revalidatePath("/crm");
  revalidatePath("/");
  return { error: null, data: true };
}

// ── Análise de lead pela IA ───────────────────────────────────────────────────────────────────────

async function analyzeOne(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, contactId: string, labels: Record<string, string>): Promise<Result<LeadAnalysis>> {
  const [{ data: contact }, { data: msgs }] = await Promise.all([
    supabase.from("contacts").select("id, stage, custom_fields").eq("id", contactId).eq("workspace_id", workspaceId).maybeSingle(),
    supabase
      .from("messages")
      .select("role, content")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  if (!contact) return { error: "Lead não encontrado." };
  const history = (msgs || []).reverse().map((m) => ({ role: m.role as string, content: (m.content as string) || "" }));
  if (history.length === 0) return { error: "Esse lead ainda não tem conversa pra analisar." };

  const raw = await askJson<unknown>(ANALYSIS_SYSTEM, analysisPrompt(conversationTranscript(history), labels[contact.stage as string] || (contact.stage as string), contact.custom_fields as Record<string, unknown> | null));
  await recordAiUsage({ workspaceId, feature: "analise_lead", provider: "gemini", model: LIGHT_MODEL, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens });
  const analysis = normalizeAnalysis(raw.data);
  if (!analysis) return { error: "A IA não devolveu uma análise válida. Tente de novo." };

  const { error } = await supabase
    .from("contacts")
    .update({
      ai_score: analysis.score,
      ai_temperature: analysis.temperature,
      ai_summary: analysis.summary,
      ai_next_action: analysis.nextAction,
      ai_scored_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .eq("workspace_id", workspaceId);
  if (error) return { error: missingColumn(error.message) ? MIGRATION_HINT : "Não foi possível salvar a análise." };
  return { error: null, data: analysis };
}

export async function analyzeLead(contactId: string): Promise<Result<LeadAnalysis>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (await overBudget(workspace.id)) return { error: BUDGET_HINT };
  const supabase = await createClient();
  const { data: ws } = await supabase.from("workspaces").select("crm_stage_labels").eq("id", workspace.id).maybeSingle();
  try {
    const r = await analyzeOne(supabase, workspace.id, contactId, resolveStageLabels(ws?.crm_stage_labels));
    if (!r.error) revalidatePath("/crm");
    return r;
  } catch {
    return { error: "A IA não respondeu agora. Tente de novo em instantes." };
  }
}

// Análise em lote (botão no Pipeline): teto baixo de propósito — cada lead é uma chamada de IA.
const MAX_BULK_ANALYSIS = 25;

export async function analyzeLeads(ids: string[]): Promise<Result<{ done: number; failed: number }>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (ids.length === 0) return { error: "Selecione ao menos um lead." };
  if (ids.length > MAX_BULK_ANALYSIS) return { error: `Analise no máximo ${MAX_BULK_ANALYSIS} leads por vez.` };
  if (await overBudget(workspace.id)) return { error: BUDGET_HINT };
  const supabase = await createClient();
  const { data: ws } = await supabase.from("workspaces").select("crm_stage_labels").eq("id", workspace.id).maybeSingle();
  const labels = resolveStageLabels(ws?.crm_stage_labels);
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await analyzeOne(supabase, workspace.id, id, labels);
      if (r.error === MIGRATION_HINT) return { error: MIGRATION_HINT };
      if (r.error) failed++;
      else done++;
    } catch {
      failed++;
    }
  }
  revalidatePath("/crm");
  return { error: null, data: { done, failed } };
}

// ── Insights da IA (Visão geral) ──────────────────────────────────────────────────────────────────

const INSIGHTS_COOLDOWN_MS = 60 * 60 * 1000;

export async function generateInsights(): Promise<Result<AiInsight[]>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  const supabase = await createClient();
  const { data: ws, error: wsErr } = await supabase.from("workspaces").select("crm_stage_labels, ai_insights, ai_insights_at").eq("id", workspace.id).maybeSingle();
  if (wsErr) return { error: missingColumn(wsErr.message) ? MIGRATION_HINT : "Não foi possível ler o workspace." };
  if (ws?.ai_insights_at && Date.now() - new Date(ws.ai_insights_at as string).getTime() < INSIGHTS_COOLDOWN_MS) {
    return { error: null, data: normalizeInsights(ws.ai_insights) };
  }
  if (await overBudget(workspace.id)) return { error: BUDGET_HINT };

  // Retrato do funil agora: contagem por etapa, parados, atenção, quentes sem resposta e resumos recentes.
  const labels = resolveStageLabels(ws?.crm_stage_labels);
  const rows: { stage: string; stage_changed_at: string; needs_attention: boolean; ai_temperature: string | null; ai_summary: string | null; custom_fields: Record<string, unknown> | null }[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await supabase
      .from("contacts")
      .select("stage, stage_changed_at, needs_attention, ai_temperature, ai_summary, custom_fields")
      .eq("workspace_id", workspace.id)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) return { error: missingColumn(error.message) ? MIGRATION_HINT : "Não foi possível ler os leads." };
    rows.push(...((data || []) as typeof rows));
    if ((data || []).length < 1000) break;
  }

  const byStage: Record<string, number> = {};
  const staleByStage: Record<string, number> = {};
  let attention = 0;
  let hot = 0;
  const productCount: Record<string, number> = {};
  for (const r of rows) {
    const label = isContactStage(r.stage) ? labels[r.stage] : r.stage;
    byStage[label] = (byStage[label] || 0) + 1;
    if (r.stage !== "concluido" && r.stage !== "descartado" && daysSince(r.stage_changed_at) >= STALE_AFTER_DAYS) staleByStage[label] = (staleByStage[label] || 0) + 1;
    if (r.needs_attention) attention++;
    if (r.ai_temperature === "quente") hot++;
    const produto = r.custom_fields?.produto ?? r.custom_fields?.anuncio_titulo;
    if (typeof produto === "string" && produto.trim()) productCount[produto.trim()] = (productCount[produto.trim()] || 0) + 1;
  }
  const topProducts = Object.entries(productCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  const summaries = rows.filter((r) => r.ai_summary).slice(0, 15).map((r) => r.ai_summary as string);

  let insights: AiInsight[] = [];
  try {
    const raw = await askJson<unknown>(INSIGHTS_SYSTEM, insightsPrompt({ total: rows.length, byStage, staleByStage, attention, hot, topProducts, summaries, staleDays: STALE_AFTER_DAYS }));
    await recordAiUsage({ workspaceId: workspace.id, feature: "insights", provider: "gemini", model: LIGHT_MODEL, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens });
    insights = normalizeInsights(raw.data);
  } catch {
    return { error: "A IA não respondeu agora. Tente de novo em instantes." };
  }
  if (insights.length === 0) return { error: "A IA não devolveu insights válidos. Tente de novo." };

  await createAdminClient().from("workspaces").update({ ai_insights: insights, ai_insights_at: new Date().toISOString() }).eq("id", workspace.id);
  revalidatePath("/");
  return { error: null, data: insights };
}

// ── Resposta do agente sem enviar (sugestão na conversa e "Testar agente") ────────────────────────

async function dryReply(
  agentId: string,
  workspaceId: string,
  history: ConversationMessage[],
  contact: { name: string | null; custom_fields: Record<string, unknown> | null },
  feature: "sugestao_resposta" | "teste_agente"
): Promise<Result<string>> {
  if (await overBudget(workspaceId)) return { error: BUDGET_HINT };
  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("id, system_prompt, config, llm_provider").eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!agent) return { error: "Agente não encontrado." };
  if (!agent.system_prompt) return { error: "Esse agente ainda não tem prompt configurado." };
  const { data: knowledgeRows } = await supabase.from("agent_knowledge").select("file_name, content").eq("agent_id", agent.id);
  const knowledgeText = knowledgeRows?.length ? knowledgeRows.map((k) => `### ${k.file_name}\n${k.content}`).join("\n\n---\n\n") : undefined;
  const config = normalizeAgentConfig(agent.config);
  const prompt = (agent.system_prompt as string) + (config.tone === "humanizado" ? HUMANIZADO_CONVERSATION_BLOCK : "");
  // Sem ferramentas: nada é enviado nem gravado (sem foto, link de pagamento, agendamento ou pergunta pra equipe).
  const fn = agent.llm_provider === "gemini" ? generateReplyGemini : generateReply;
  try {
    const gen = await fn(prompt, contact, history, [], [], undefined, knowledgeText);
    const isGemini = agent.llm_provider === "gemini";
    await recordAiUsage({
      workspaceId,
      feature,
      provider: isGemini ? "gemini" : "claude",
      model: isGemini ? process.env.GEMINI_MODEL || "gemini-3-flash-preview" : process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      agentId: agent.id as string,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      cacheCreationInputTokens: gen.cacheCreationInputTokens,
      cacheReadInputTokens: gen.cacheReadInputTokens,
    });
    const text = gen.replyParts.join("\n\n").trim();
    return text ? { error: null, data: text } : { error: "O agente não gerou resposta." };
  } catch {
    return { error: "A IA não respondeu agora. Tente de novo em instantes." };
  }
}

// Sugestão de resposta na tela de Conversas: o agente do contato escreve como responderia agora; a
// pessoa revisa no campo de mensagem antes de enviar.
export async function suggestReply(contactId: string, agentId: string | null): Promise<Result<string>> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  const supabase = await createClient();
  let useAgent = agentId;
  if (!useAgent) {
    const { data: first } = await supabase.from("agents").select("id").eq("workspace_id", workspace.id).limit(1).maybeSingle();
    useAgent = (first?.id as string | undefined) ?? null;
  }
  if (!useAgent) return { error: "Crie um agente de IA pra usar a sugestão de resposta." };
  const [{ data: contact }, { data: msgs }] = await Promise.all([
    supabase.from("contacts").select("name, custom_fields").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("messages").select("role, content").eq("contact_id", contactId).eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (!contact) return { error: "Contato não encontrado." };
  const history = (msgs || [])
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: (m.content as string) || "" }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return { error: "A última mensagem não é do lead — não há o que responder agora." };
  }
  return dryReply(useAgent, workspace.id, history, { name: contact.name as string | null, custom_fields: contact.custom_fields as Record<string, unknown> | null }, "sugestao_resposta");
}

// Playground do agente (tela do agente): conversa de teste, nada vai pro WhatsApp nem fica salvo.
export async function testAgentReply(agentId: string, history: ConversationMessage[]): Promise<Result<string>> {
  const { workspace, isStaff } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (!isStaff) return { error: "Só a equipe da agência pode testar o agente." };
  const clean = history.filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim()).slice(-30);
  if (clean.length === 0 || clean[clean.length - 1].role !== "user") return { error: "Escreva uma mensagem como se fosse o cliente." };
  return dryReply(agentId, workspace.id, clean, { name: null, custom_fields: null }, "teste_agente");
}
