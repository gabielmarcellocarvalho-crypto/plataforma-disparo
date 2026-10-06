// Tarefa na Agenda do vendedor: quando o lead chega na fase configurada no agente, cria uma tarefa
// com o resumo da conversa pra um vendedor (dono do lead, senão rodízio).
//
// Só entra em ação com `config.sellerTasks.enabled` — sem isso é no-op e o agente segue como sempre.
// Falha aqui nunca pode derrubar a resposta ao cliente: quem chama trata como melhor esforço.
import Anthropic from "@anthropic-ai/sdk";
import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizeAgentConfig } from "@/lib/agent-prompt";
import { atingiuGatilho } from "@/lib/agent-handoff";
import type { ContactStage } from "@/lib/crm-stages";

type AdminClient = ReturnType<typeof createAdminClient>;

type AgentLike = { id: string; workspace_id: string; config: unknown };
type ContactLike = { id: string; name: string | null; team_member_id?: string | null };

const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const SUMMARY_MESSAGES = 40;

// Dono do lead se estiver na lista; senão quem recebeu tarefa do agente há mais tempo (quem nunca
// recebeu vem primeiro). Lead com dono fora da lista cai no rodízio — não some pra ninguém.
export function pickSeller(
  memberIds: string[],
  ownerId: string | null,
  lastTaskAt: Map<string, string>
): string | null {
  if (memberIds.length === 0) return null;
  if (ownerId && memberIds.includes(ownerId)) return ownerId;
  return [...memberIds].sort((a, b) => (lastTaskAt.get(a) ?? "").localeCompare(lastTaskAt.get(b) ?? ""))[0];
}

async function summarize(admin: AdminClient, contactId: string): Promise<string | null> {
  const { data } = await admin
    .from("messages")
    .select("role, content")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(SUMMARY_MESSAGES);
  const lines = (data || [])
    .reverse()
    .filter((m) => typeof m.content === "string" && m.content.trim())
    .map((m) => `${m.role === "assistant" ? "Agente" : "Cliente"}: ${String(m.content).slice(0, 600)}`);
  if (lines.length === 0) return null;
  const transcript = lines.join("\n");

  try {
    const res = await new Anthropic().messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 400,
      system:
        "Você resume conversas de WhatsApp pra um vendedor que vai assumir o lead. Em português, até 5 linhas curtas: o que o cliente quer, o que já foi dito/combinado, objeções e o próximo passo sugerido. Sem saudação, sem inventar nada que não esteja na conversa.",
      messages: [{ role: "user", content: transcript }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (text) return text;
  } catch (err) {
    console.warn("seller-tasks: resumo falhou, usando trecho final da conversa:", (err as Error).message);
  }
  // Sem resumo do modelo, o vendedor ainda enxerga como a conversa terminou.
  return lines.slice(-6).join("\n");
}

// Cria a tarefa se este agente tem a função ligada, o lead alcançou a fase e ainda não há tarefa dele.
export async function createSellerTaskIfNeeded(
  admin: AdminClient,
  agent: AgentLike,
  contact: ContactLike,
  stage: ContactStage
): Promise<void> {
  const cfg = normalizeAgentConfig(agent.config).sellerTasks;
  if (!cfg.enabled || cfg.memberIds.length === 0) return;
  if (!atingiuGatilho(stage, cfg.signal)) return;

  const { data: existing } = await admin
    .from("tasks")
    .select("id")
    .eq("contact_id", contact.id)
    .eq("agent_id", agent.id)
    .eq("source", "agente")
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const { data: recent } = await admin
    .from("tasks")
    .select("team_member_id, created_at")
    .eq("agent_id", agent.id)
    .eq("source", "agente")
    .in("team_member_id", cfg.memberIds)
    .order("created_at", { ascending: false })
    .limit(200);
  const lastTaskAt = new Map<string, string>();
  for (const t of recent || []) if (!lastTaskAt.has(t.team_member_id as string)) lastTaskAt.set(t.team_member_id as string, t.created_at as string);

  const sellerId = pickSeller(cfg.memberIds, contact.team_member_id ?? null, lastTaskAt);
  if (!sellerId) return;

  const summary = await summarize(admin, contact.id);

  // O índice único (contact_id, agent_id) onde source='agente' fecha a corrida entre dois turnos.
  const { error } = await admin.from("tasks").insert({
    workspace_id: agent.workspace_id,
    title: `Atender lead: ${contact.name || "sem nome"}`,
    // due_at = agora: a Agenda ordena por data/hora e a tarefa entra no fim da fila de "hoje".
    due_at: new Date().toISOString(),
    contact_id: contact.id,
    team_member_id: sellerId,
    agent_id: agent.id,
    source: "agente",
    conversation_summary: summary,
  });
  if (error && error.code !== "23505") throw error;

  // Lead sem dono passa a ser do vendedor que recebeu. Lead com dono nunca é reatribuído.
  if (!contact.team_member_id) await admin.from("contacts").update({ team_member_id: sellerId }).eq("id", contact.id);
}
