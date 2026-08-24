import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { AgentCard } from "@/components/agent-card";
import { AddAgentForm } from "@/components/add-agent-form";
import { AttentionPanel } from "@/components/attention-panel";
import { estimateAnthropicCostUsd, estimateGeminiCostUsd } from "@/lib/pricing-calculator";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

export default async function AgentesPage() {
  await assertPageAccess("/agentes", { colaboradorOnly: true });
  const { workspace, isColaborador } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: agents, error: agentsError }, { data: attentionContacts }, { data: usageRows }, { data: officialInstances }] = workspace
    ? await Promise.all([
        supabase
          .from("agents")
          .select("id, name, evolution_instance_name, phone_number, photo_url, connection_status, status, llm_provider, whatsapp_instances(channel)")
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
        // Números já conectados em Configurações (API oficial) que nenhum agente usa ainda — oferecidos
        // no formulário de "Adicionar agente" como opção de reaproveitar em vez de conectar de novo.
        supabase
          .from("whatsapp_instances")
          .select("id, department, channel")
          .eq("workspace_id", workspace.id)
          .in("channel", ["360dialog", "metacloud"]),
      ])
    : [{ data: [], error: null }, { data: [] }, { data: [] }, { data: [] }];

  // Erro real de consulta (ex.: migration pendente) NUNCA deve virar "nenhum agente ainda" — isso
  // esconderia agentes de verdade, já conectados e respondendo, atrás de uma tela que parece vazia.
  if (agentsError) {
    return (
      <div className="bg-danger-soft border border-danger/30 rounded-lg p-6 text-danger">
        <p className="font-bold text-sm">Não foi possível carregar os agentes.</p>
        <p className="text-xs mt-1 font-mono">{agentsError.message}</p>
      </div>
    );
  }

  // whatsapp_instance_id não veio no select de `agents` acima (só o join de channel) — busca à parte
  // pra saber quais números oficiais já estão em uso por outro agente e tirar da lista de opções.
  const { data: linkedRows } = workspace
    ? await supabase.from("agents").select("whatsapp_instance_id").eq("workspace_id", workspace.id).not("whatsapp_instance_id", "is", null)
    : { data: [] };
  const usedInstanceIds = new Set((linkedRows || []).map((r) => r.whatsapp_instance_id as string));
  const availableInstances = (officialInstances || []).filter((i) => !usedInstanceIds.has(i.id));

  // Soma tokens por agente e converte pra custo estimado em USD, no preço do provider DESSE agente
  // (Gemini é bem mais barato por token que o Sonnet — usar o preço errado engana o custo mostrado).
  const providerByAgent = new Map((agents || []).map((a) => [a.id as string, (a.llm_provider as "claude" | "gemini") || "claude"]));
  const costByAgent = new Map<string, number>();
  for (const row of usageRows || []) {
    if (!row.agent_id) continue;
    const provider = providerByAgent.get(row.agent_id) || "claude";
    const cost =
      provider === "gemini"
        ? estimateGeminiCostUsd(GEMINI_MODEL, { inputTokens: row.input_tokens || 0, outputTokens: row.output_tokens || 0 })
        : estimateAnthropicCostUsd(ANTHROPIC_MODEL, {
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
        {isColaborador && (
          <AddAgentForm
            availableInstances={availableInstances.map((i) => ({
              id: i.id,
              department: i.department,
              channel: i.channel as "360dialog" | "metacloud",
            }))}
          />
        )}
      </div>

      <AttentionPanel contacts={attentionContacts || []} />

      {!agents?.length ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          <p className="font-semibold text-text">Nenhum agente ainda</p>
          <p className="text-sm mt-1">Clique em &quot;Adicionar agente&quot; pra conectar o primeiro número.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {agents.map((agent) => {
            const linkedInstance = agent.whatsapp_instances as unknown as { channel: string } | null;
            return (
              <AgentCard
                key={agent.id}
                agent={{ ...agent, whatsapp_instance_channel: (linkedInstance?.channel as "360dialog" | "metacloud" | undefined) ?? null }}
                totalCostUsd={costByAgent.get(agent.id) || 0}
                canManage={isColaborador}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
