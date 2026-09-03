import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { resolveStageLabels, getVisibleStages, resolveHiddenStages } from "@/lib/crm-stages";
import { resolveWorkspacePlan, planHasSdr } from "@/lib/workspace-plan";
import { ConversationsPanel, type Conversation } from "@/components/conversations-panel";
import type { WhatsappChannel } from "@/lib/whatsapp-channel";
import { getConversationTickets } from "@/app/actions/conversation-tickets";
import { conversationKey } from "@/lib/conversation-tickets";

const DEPARTMENT_LABEL: Record<string, string> = { vendas: "Vendas", financeiro: "Financeiro" };

// Teto de mensagens recentes carregadas (não de conversas — várias mensagens podem ser da mesma
// conversa). O projeto tem "Max Rows" travado em 1000 na API do Supabase (teto do servidor, ignora
// qualquer .limit() do client) — por isso busca em páginas de até 1000 até bater esse teto, em vez de
// um único .limit() que nunca traria mais que 1000 de qualquer forma.
const MESSAGE_LIMIT = 5000;
const PAGE_SIZE = 1000;

async function fetchRecentMessages(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string) {
  const all: {
    id: string;
    contact_id: string;
    agent_id: string | null;
    role: string;
    content: string;
    media_url: string | null;
    media_type: "image" | "audio" | "document" | null;
    created_at: string;
  }[] = [];
  let offset = 0;
  while (all.length < MESSAGE_LIMIT) {
    const { data } = await supabase
      .from("messages")
      .select("id, contact_id, agent_id, role, content, media_url, media_type, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

type ContactRow = {
  id: string;
  name: string | null;
  phone: string | null;
  photo_url: string | null;
  stage: string;
  needs_attention: boolean;
  attention_reason: string | null;
  flagged_reason: string | null;
  responsible_user_id: string | null;
  whatsapp_instance_id: string | null;
};

// Mesma paginação de 1000 em 1000 de fetchRecentMessages — filtrar por workspace_id direto em vez de
// `.in("id", contactIds)` evita depender do tamanho da lista de ids (ver comentário mais abaixo).
async function fetchAllContacts(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string): Promise<ContactRow[]> {
  const all: ContactRow[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from("contacts")
      .select("id, name, phone, photo_url, stage, needs_attention, attention_reason, flagged_reason, responsible_user_id, whatsapp_instance_id")
      .eq("workspace_id", workspaceId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export default async function ConversasPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  if (!workspace) {
    return (
      <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
        <p className="font-semibold text-text">Nenhum workspace ativo</p>
      </div>
    );
  }

  const [{ data: agents }, { data: instances }, messages, { data: workspaceRow }, tickets] = await Promise.all([
    supabase
      .from("agents")
      .select("id, name, photo_url, evolution_instance_name")
      .eq("workspace_id", workspace.id),
    supabase
      .from("whatsapp_instances")
      .select("id, department, channel")
      .eq("workspace_id", workspace.id),
    fetchRecentMessages(supabase, workspace.id),
    supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages, plan").eq("id", workspace.id).maybeSingle(),
    getConversationTickets(workspace.id),
  ]);

  const ticketByKey = new Map(tickets.map((t) => [t.conversation_key, t]));

  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const visibleStages = getVisibleStages(resolveHiddenStages(workspaceRow?.crm_hidden_stages));
  const plan = resolveWorkspacePlan(workspaceRow?.plan);
  const showResponsavel = planHasSdr(plan);

  const contactIds = Array.from(new Set((messages || []).map((m) => m.contact_id)));

  // Antes filtrava por `.in("id", contactIds)`/`.in("contact_id", contactIds)` — com centenas de ids
  // (ex.: workspace com disparo em massa recente) isso vira uma URL gigante (cada uuid tem 36
  // caracteres) que estoura o limite de tamanho de URL do servidor e falha calada (o erro nunca era
  // checado), fazendo a lista de Conversas parecer vazia mesmo com mensagens reais no banco. Filtrar
  // direto por workspace_id evita esse teto por completo, com a mesma paginação de 1000 já usada pras
  // mensagens (Max Rows do Supabase).
  const [contacts, { data: originRows }, vendors] = await Promise.all([
    fetchAllContacts(supabase, workspace.id),
    contactIds.length > 0
      ? supabase
          .from("campaign_recipients")
          .select("contact_id, sent_at, campaigns!inner(name, workspace_id)")
          .eq("campaigns.workspace_id", workspace.id)
          .eq("status", "enviado")
          .order("sent_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    // Vendedores atribuíveis = pessoas com login de cliente vinculado a esse workspace (não é um
    // cargo separado). RLS de profiles só deixa ver o próprio perfil, então usa o client admin —
    // mesma técnica já usada em /acessos. Buscado sempre agora (não só quando showResponsavel):
    // a atribuição de responsável do TICKET de atendimento é liberada pra todo plano, diferente do
    // responsável do CONTATO/CRM (esse sim continua só em planos com SDR).
    createAdminClient()
      .from("workspace_members")
      .select("user_id, profiles(full_name)")
      .eq("workspace_id", workspace.id)
      .then(({ data }) => (data || []).map((m) => ({ id: m.user_id as string, name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name || "sem nome" }))),
  ]);

  // Primeira campanha (mais antiga) que efetivamente mandou mensagem pra esse contato — "origem".
  const originByContact = new Map<string, string>();
  for (const r of originRows || []) {
    if (originByContact.has(r.contact_id)) continue;
    const name = (r.campaigns as unknown as { name: string } | null)?.name;
    if (name) originByContact.set(r.contact_id, name);
  }

  const agentsById = new Map((agents || []).map((a) => [a.id, a]));
  const contactsById = new Map((contacts || []).map((c) => [c.id, c]));
  const instancesById = new Map(
    (instances || []).map((i) => [i.id, { id: i.id, name: DEPARTMENT_LABEL[i.department] || i.department, channel: i.channel as WhatsappChannel }])
  );

  const conversationsByKey = new Map<string, Conversation>();
  for (const m of messages || []) {
    // Com agente de IA: uma conversa por agente (um contato pode, em tese, falar com mais de um).
    // Sem agente (disparo avulso): uma conversa só por contato, ligada ao número/instância dele.
    const key = conversationKey(m.contact_id, m.agent_id);
    let conv = conversationsByKey.get(key);
    if (!conv) {
      const contact = contactsById.get(m.contact_id);
      if (!contact) continue;
      let agent = null;
      let instance = null;
      if (m.agent_id) {
        agent = agentsById.get(m.agent_id) ?? null;
        if (!agent) continue;
      } else {
        instance = contact.whatsapp_instance_id ? instancesById.get(contact.whatsapp_instance_id) ?? null : null;
        if (!instance) continue; // mensagem sem contexto de número (edge case raro) — sem como responder, ignora
      }
      const ticket = ticketByKey.get(key);
      conv = {
        contact: { ...contact, origin_campaign: originByContact.get(contact.id) ?? null },
        agent,
        instance,
        messages: [],
        ticket_status: ticket?.status ?? "aberto",
        ticket_responsible_user_id: ticket?.responsible_user_id ?? null,
      };
      conversationsByKey.set(key, conv);
    }
    conv.messages.push(m); // vem em ordem desc; a UI inverte pra exibir
  }

  // Disparo em massa sem agente (conv.instance preenchido, sem agent) só vira conversa de verdade se
  // o lead respondeu alguma vez — sem isso, a lista fica lotada de contatos que só receberam a
  // mensagem de saída e nunca disseram nada, escondendo quem de fato está numa conversa.
  const conversationsRaw = Array.from(conversationsByKey.values()).filter(
    (conv) => Boolean(conv.agent) || conv.messages.some((m) => m.role === "user")
  );

  const conversations = conversationsRaw.sort((a, b) => {
    if (a.contact.needs_attention !== b.contact.needs_attention) return a.contact.needs_attention ? -1 : 1;
    const aFlag = Boolean(a.contact.flagged_reason);
    const bFlag = Boolean(b.contact.flagged_reason);
    if (aFlag !== bFlag) return aFlag ? -1 : 1;
    return (b.messages[0]?.created_at || "").localeCompare(a.messages[0]?.created_at || "");
  });

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <ConversationsPanel
        conversations={conversations}
        stageLabels={stageLabels}
        visibleStages={visibleStages}
        vendors={vendors}
        showResponsavel={showResponsavel}
      />
    </div>
  );
}
