import { createClient } from "@/lib/supabase/server";

type Range = { from: Date; to: Date };

export type AgentServiceRow = {
  agentId: string;
  name: string;
  conversations: number;
  // Conversas que precisaram de alguém da equipe (agente pausado/sinalizado pra revisão).
  escalated: number;
  resolutionRate: number; // 0-100
};

export type AgentServiceStats = {
  rows: AgentServiceRow[];
  totalConversations: number;
  totalEscalated: number;
  resolutionRate: number;
  reasons: { reason: string; count: number }[];
};

const PAGE = 1000; // teto do PostgREST por requisição
const MAX_PAGES = 30;
const CHUNK = 200; // ids por filtro "in" (URL não pode crescer demais)

// "Resolução sem humano" por agente: das conversas que o agente atendeu no período, quantas NÃO estão
// marcadas pra revisão da equipe (needs_attention ou sinalização). Usa o estado atual do contato — é
// uma aproximação boa o suficiente pra comparar agentes, sem precisar de histórico de alertas.
export function resolutionRate(conversations: number, escalated: number): number {
  if (conversations <= 0) return 0;
  return Math.round(((conversations - escalated) / conversations) * 100);
}

// Agrupa motivos parecidos ("Muitas mensagens em pouco tempo (…) — agente pausado…") pelo trecho antes do
// primeiro parêntese/travessão, pra o ranking não virar uma lista de frases quase iguais.
export function reasonKey(reason: string): string {
  return reason.split(/ — | \(/)[0].trim().replace(/[.:,]+$/, "") || reason.trim();
}

export async function getAgentServiceStats(workspaceId: string, range: Range): Promise<AgentServiceStats> {
  const supabase = await createClient();

  const pairs: { agent_id: string; contact_id: string }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await supabase
      .from("messages")
      .select("agent_id, contact_id")
      .eq("workspace_id", workspaceId)
      .eq("role", "assistant")
      .not("agent_id", "is", null)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    const rows = (data || []) as { agent_id: string; contact_id: string }[];
    pairs.push(...rows);
    if (rows.length < PAGE) break;
  }

  const byAgent = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.contact_id) continue;
    const set = byAgent.get(p.agent_id) || new Set<string>();
    set.add(p.contact_id);
    byAgent.set(p.agent_id, set);
  }
  const allContacts = [...new Set(pairs.map((p) => p.contact_id).filter(Boolean))];

  const escalatedIds = new Set<string>();
  const reasonCount = new Map<string, number>();
  for (let i = 0; i < allContacts.length; i += CHUNK) {
    const { data } = await supabase
      .from("contacts")
      .select("id, needs_attention, flagged_reason, attention_reason")
      .in("id", allContacts.slice(i, i + CHUNK));
    for (const c of data || []) {
      if (!c.needs_attention && !c.flagged_reason) continue;
      escalatedIds.add(c.id as string);
      const reason = (c.attention_reason as string | null) || (c.flagged_reason as string | null) || "Sem motivo informado";
      const key = reasonKey(reason);
      reasonCount.set(key, (reasonCount.get(key) || 0) + 1);
    }
  }

  const { data: agents } = await supabase.from("agents").select("id, name").eq("workspace_id", workspaceId);
  const nameById = new Map((agents || []).map((a) => [a.id as string, a.name as string]));

  const rows = [...byAgent.entries()]
    .map(([agentId, contacts]) => {
      const escalated = [...contacts].filter((id) => escalatedIds.has(id)).length;
      return {
        agentId,
        name: nameById.get(agentId) || "agente removido",
        conversations: contacts.size,
        escalated,
        resolutionRate: resolutionRate(contacts.size, escalated),
      };
    })
    .sort((a, b) => b.conversations - a.conversations);

  const totalConversations = allContacts.length;
  const totalEscalated = escalatedIds.size;
  return {
    rows,
    totalConversations,
    totalEscalated,
    resolutionRate: resolutionRate(totalConversations, totalEscalated),
    reasons: [...reasonCount.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 6),
  };
}
