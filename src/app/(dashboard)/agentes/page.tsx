import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { AgentsList, type AgentListItem } from "@/components/agents-list";
import { AddAgentForm } from "@/components/add-agent-form";
import { AttentionPanel } from "@/components/attention-panel";
import { estimateAnthropicCostUsd, estimateGeminiCostUsd } from "@/lib/pricing-calculator";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

export default async function AgentesPage() {
  await assertPageAccess("/agentes", { staffOnly: true });
  const { workspace, isStaff } = await getCurrentWorkspace();
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

  // Métricas do card (conversas hoje, leads atendidos, última atividade, tokens) agregadas no banco —
  // ver migration 0076. "Hoje" = desde a meia-noite de Brasília. Se a função ainda não existir, o card
  // mostra "—" nas métricas e o custo cai no cálculo antigo por linha, logo abaixo.
  const todayBrt = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { data: statsRows, error: statsError } = workspace
    ? await supabase.rpc("agent_list_stats", { ws_id: workspace.id, day_start: `${todayBrt}T00:00:00-03:00` })
    : { data: [], error: null };
  type StatsRow = {
    agent_id: string;
    conversations_today: number;
    leads_total: number;
    last_activity: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  const statsByAgent = new Map(((statsRows as StatsRow[] | null) || []).map((r) => [r.agent_id, r]));

  // Soma tokens por agente e converte pra custo estimado em USD, no preço do provider DESSE agente
  // (Gemini é bem mais barato por token que o Sonnet — usar o preço errado engana o custo mostrado).
  // Com a função disponível, soma os totais agregados (sem o teto de 1000 linhas); sem ela, cai nas
  // linhas de `usageRows` como sempre foi.
  const providerByAgent = new Map((agents || []).map((a) => [a.id as string, (a.llm_provider as "claude" | "gemini") || "claude"]));
  const costByAgent = new Map<string, number>();
  const usageSource = statsError ? usageRows || [] : ((statsRows as StatsRow[] | null) || []);
  for (const row of usageSource) {
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

  const items: AgentListItem[] = (agents || []).map((agent) => {
    const linkedInstance = agent.whatsapp_instances as unknown as { channel: string } | null;
    const st = statsByAgent.get(agent.id);
    return {
      agent: { ...agent, whatsapp_instance_channel: (linkedInstance?.channel as "360dialog" | "metacloud" | undefined) ?? null },
      stats: statsError
        ? { conversationsToday: null, leadsTotal: null, lastActivity: null }
        : { conversationsToday: Number(st?.conversations_today ?? 0), leadsTotal: Number(st?.leads_total ?? 0), lastActivity: st?.last_activity ?? null },
      totalCostUsd: costByAgent.get(agent.id) || 0,
    };
  });

  return (
    <AgentsList
      items={items}
      canManage={isStaff}
      attention={<AttentionPanel contacts={attentionContacts || []} />}
      addAgent={
        <AddAgentForm
          availableInstances={availableInstances.map((i) => ({
            id: i.id,
            department: i.department,
            channel: i.channel as "360dialog" | "metacloud",
          }))}
        />
      }
    />
  );
}
