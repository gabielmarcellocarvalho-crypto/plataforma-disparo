import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AgentCard } from "@/components/agent-card";
import { AddAgentForm } from "@/components/add-agent-form";
import { AttentionPanel } from "@/components/attention-panel";
import { estimateAnthropicCostUsd } from "@/lib/pricing-calculator";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export default async function AgentesPage() {
  const { workspace, isColaborador } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: agents }, { data: attentionContacts }, { data: usageRows }] = workspace
    ? await Promise.all([
        supabase
          .from("agents")
          .select("id, name, evolution_instance_name, phone_number, photo_url, connection_status, status")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("contacts")
          .select("id, name, phone, attention_reason")
          .eq("workspace_id", workspace.id)
          .eq("needs_attention", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("messages")
          .select("agent_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
          .eq("workspace_id", workspace.id)
          .not("agent_id", "is", null),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  // Soma tokens por agente e converte pra custo estimado em USD (mesma tabela de preço da calculadora).
  const costByAgent = new Map<string, number>();
  for (const row of usageRows || []) {
    if (!row.agent_id) continue;
    const cost = estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
      cacheReadInputTokens: row.cache_read_input_tokens || 0,
    });
    costByAgent.set(row.agent_id, (costByAgent.get(row.agent_id) || 0) + cost);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Agentes</h1>
          <p className="text-text-muted text-sm mt-1">
            Cada agente atende por um número de WhatsApp próprio, com prompt próprio, respondendo sozinho os contatos desse workspace.
            Diferente de um número de disparo em massa (sem IA) — esse você conecta em Configurações.
          </p>
        </div>
        {isColaborador && <AddAgentForm />}
      </div>

      <AttentionPanel contacts={attentionContacts || []} />

      {!agents?.length ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          <p className="font-semibold text-text">Nenhum agente ainda</p>
          <p className="text-sm mt-1">Clique em &quot;Adicionar agente&quot; pra conectar o primeiro número.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              totalCostUsd={costByAgent.get(agent.id) || 0}
              canManage={isColaborador}
            />
          ))}
        </div>
      )}
    </div>
  );
}
