import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { ConversationsPanel, type Conversation } from "@/components/conversations-panel";

const MESSAGE_LIMIT = 500;

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

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, photo_url, evolution_instance_name")
    .eq("workspace_id", workspace.id);

  const { data: messages } = await supabase
    .from("messages")
    .select("id, contact_id, agent_id, role, content, created_at")
    .eq("workspace_id", workspace.id)
    .not("agent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_LIMIT);

  const contactIds = Array.from(new Set((messages || []).map((m) => m.contact_id)));
  const { data: contacts } =
    contactIds.length > 0
      ? await supabase
          .from("contacts")
          .select("id, name, phone, needs_attention, attention_reason, flagged_reason")
          .in("id", contactIds)
      : { data: [] };

  const agentsById = new Map((agents || []).map((a) => [a.id, a]));
  const contactsById = new Map((contacts || []).map((c) => [c.id, c]));

  const conversationsByKey = new Map<string, Conversation>();
  for (const m of messages || []) {
    const key = `${m.contact_id}:${m.agent_id}`;
    let conv = conversationsByKey.get(key);
    if (!conv) {
      const contact = contactsById.get(m.contact_id);
      const agent = agentsById.get(m.agent_id!);
      if (!contact || !agent) continue;
      conv = { contact, agent, messages: [] };
      conversationsByKey.set(key, conv);
    }
    conv.messages.push(m); // vem em ordem desc; a UI inverte pra exibir
  }

  const conversations = Array.from(conversationsByKey.values()).sort((a, b) => {
    if (a.contact.needs_attention !== b.contact.needs_attention) return a.contact.needs_attention ? -1 : 1;
    const aFlag = Boolean(a.contact.flagged_reason);
    const bFlag = Boolean(b.contact.flagged_reason);
    if (aFlag !== bFlag) return aFlag ? -1 : 1;
    return (b.messages[0]?.created_at || "").localeCompare(a.messages[0]?.created_at || "");
  });

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7.5rem)] min-h-0">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Conversas</h1>
        <p className="text-text-muted text-sm mt-1">Acompanhe e assuma as conversas dos agentes em tempo real.</p>
      </div>
      <ConversationsPanel conversations={conversations} />
    </div>
  );
}
