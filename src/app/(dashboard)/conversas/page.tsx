import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { resolveStageLabels, getVisibleStages, resolveHiddenStages } from "@/lib/crm-stages";
import { resolveWorkspacePlan, planHasSdr } from "@/lib/workspace-plan";
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

  const [{ data: agents }, { data: messages }, { data: workspaceRow }] = await Promise.all([
    supabase
      .from("agents")
      .select("id, name, photo_url, evolution_instance_name")
      .eq("workspace_id", workspace.id),
    supabase
      .from("messages")
      .select("id, contact_id, agent_id, role, content, created_at")
      .eq("workspace_id", workspace.id)
      .not("agent_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
    supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages, plan").eq("id", workspace.id).maybeSingle(),
  ]);

  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const visibleStages = getVisibleStages(resolveHiddenStages(workspaceRow?.crm_hidden_stages));
  const plan = resolveWorkspacePlan(workspaceRow?.plan);
  const showResponsavel = planHasSdr(plan);

  const contactIds = Array.from(new Set((messages || []).map((m) => m.contact_id)));

  const [{ data: contacts }, { data: originRows }, vendors] = await Promise.all([
    contactIds.length > 0
      ? supabase
          .from("contacts")
          .select("id, name, phone, stage, needs_attention, attention_reason, flagged_reason, responsible_user_id")
          .in("id", contactIds)
      : Promise.resolve({ data: [] }),
    contactIds.length > 0
      ? supabase
          .from("campaign_recipients")
          .select("contact_id, sent_at, campaigns(name)")
          .in("contact_id", contactIds)
          .eq("status", "enviado")
          .order("sent_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    // Vendedores atribuíveis = pessoas com login de cliente vinculado a esse workspace (não é um
    // cargo separado). RLS de profiles só deixa ver o próprio perfil, então usa o client admin —
    // mesma técnica já usada em /acessos.
    showResponsavel
      ? createAdminClient()
          .from("workspace_members")
          .select("user_id, profiles(full_name)")
          .eq("workspace_id", workspace.id)
          .then(({ data }) => (data || []).map((m) => ({ id: m.user_id as string, name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name || "sem nome" })))
      : Promise.resolve([]),
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

  const conversationsByKey = new Map<string, Conversation>();
  for (const m of messages || []) {
    const key = `${m.contact_id}:${m.agent_id}`;
    let conv = conversationsByKey.get(key);
    if (!conv) {
      const contact = contactsById.get(m.contact_id);
      const agent = agentsById.get(m.agent_id!);
      if (!contact || !agent) continue;
      conv = {
        contact: { ...contact, origin_campaign: originByContact.get(contact.id) ?? null },
        agent,
        messages: [],
      };
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
