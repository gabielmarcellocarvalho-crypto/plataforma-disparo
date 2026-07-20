import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { estimateAnthropicCostUsd } from "@/lib/pricing-calculator";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const USD_TO_BRL = 5.4;

export default async function MetricasPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const { data: agentMessages } = workspace
    ? await supabase
        .from("messages")
        .select("contact_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
        .eq("workspace_id", workspace.id)
        .eq("role", "assistant")
        .not("agent_id", "is", null)
    : { data: [] };

  const rows = agentMessages || [];
  let totalCostUsd = 0;
  const conversations = new Set<string>();
  for (const row of rows) {
    totalCostUsd += estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
      cacheReadInputTokens: row.cache_read_input_tokens || 0,
    });
    conversations.add(row.contact_id);
  }

  const totalMessages = rows.length;
  const totalConversations = conversations.size;
  const avgCostPerMessageUsd = totalMessages > 0 ? totalCostUsd / totalMessages : 0;
  const avgCostPerConversationUsd = totalConversations > 0 ? totalCostUsd / totalConversations : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Métricas</h1>
        <p className="text-text-muted text-sm mt-1">Funil e desempenho das campanhas do workspace atual.</p>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
        <h3 className="font-bold text-[15px] mb-1">Custo dos agentes de IA (WhatsApp)</h3>
        <p className="text-xs text-text-muted mb-4">
          {totalMessages} resposta(s) de agente em {totalConversations} conversa(s) — modelo {ANTHROPIC_MODEL}.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="border border-border rounded-md p-3.5">
            <div className="text-xs text-text-muted font-semibold mb-1">Custo total</div>
            <div className="text-lg font-extrabold">
              US$ {totalCostUsd.toFixed(4)} <span className="text-sm font-semibold text-text-muted">(~R$ {(totalCostUsd * USD_TO_BRL).toFixed(2)})</span>
            </div>
          </div>
          <div className="border border-border rounded-md p-3.5">
            <div className="text-xs text-text-muted font-semibold mb-1">Custo médio por mensagem</div>
            <div className="text-lg font-extrabold">
              US$ {avgCostPerMessageUsd.toFixed(5)}{" "}
              <span className="text-sm font-semibold text-text-muted">(~R$ {(avgCostPerMessageUsd * USD_TO_BRL).toFixed(4)})</span>
            </div>
          </div>
          <div className="border border-border rounded-md p-3.5">
            <div className="text-xs text-text-muted font-semibold mb-1">Custo médio por conversa</div>
            <div className="text-lg font-extrabold">
              US$ {avgCostPerConversationUsd.toFixed(4)}{" "}
              <span className="text-sm font-semibold text-text-muted">(~R$ {(avgCostPerConversationUsd * USD_TO_BRL).toFixed(2)})</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
        <p className="font-semibold text-text">Funil de campanhas — sem dados ainda</p>
        <p className="text-sm mt-1">Aparece assim que a primeira campanha for disparada.</p>
      </div>
    </div>
  );
}
