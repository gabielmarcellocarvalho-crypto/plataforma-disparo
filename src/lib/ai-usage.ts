import { createAdminClient } from "@/lib/supabase/admin";

// Consumo de IA das funções fora da conversa do agente (migration 0090). Gravado pelo servidor; entra no
// custo de IA de Métricas e no orçamento mensal do workspace (ver cost-monitor.ts).
export type AiFeature = "analise_lead" | "insights" | "sugestao_resposta" | "teste_agente";

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  analise_lead: "Análise de lead (IA)",
  insights: "Insights da Visão geral",
  sugestao_resposta: "Sugestão de resposta",
  teste_agente: "Testar agente",
};

export type AiUsageInput = {
  workspaceId: string;
  feature: AiFeature;
  provider: "claude" | "gemini";
  model?: string | null;
  agentId?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

// Nunca derruba a função por causa do registro (ex.: tabela ainda não criada): só loga.
export async function recordAiUsage(u: AiUsageInput): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("ai_usage")
      .insert({
        workspace_id: u.workspaceId,
        feature: u.feature,
        provider: u.provider,
        model: u.model ?? null,
        agent_id: u.agentId ?? null,
        input_tokens: Math.max(0, Math.round(u.inputTokens || 0)),
        output_tokens: Math.max(0, Math.round(u.outputTokens || 0)),
        cache_creation_input_tokens: Math.max(0, Math.round(u.cacheCreationInputTokens || 0)),
        cache_read_input_tokens: Math.max(0, Math.round(u.cacheReadInputTokens || 0)),
      });
    if (error) console.warn("ai_usage: não gravou o consumo", error.message);
  } catch (err) {
    console.warn("ai_usage: erro ao gravar o consumo", err);
  }
}
