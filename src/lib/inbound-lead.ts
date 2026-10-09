import type { createAdminClient } from "@/lib/supabase/admin";

// Lead que escreve primeiro num número SEM agente de IA (CRM + atendimento humano). Antes o webhook
// ignorava quem não estava na base ("número fora da base"), então a mensagem sumia e o contato nem
// aparecia em Conversas. Agora vira contato novo já em "abordado" (a fase "em andamento" do funil): a
// conversa já está acontecendo e a equipe atende. Não avança sozinho pra "interessado": sem um agente
// lendo a conversa, não há como saber se o lead demonstrou interesse.

type AdminClient = ReturnType<typeof createAdminClient>;

export type InboundContact = { id: string; stage: string; photo_url: string | null };

type Fields = Record<string, unknown>;

// Campos do contato novo. Quem já chega pedindo pra sair não entra em andamento: nasce no começo
// do funil e já marcado como opt-out.
export function inboundLeadFields(input: { workspaceId: string; instanceId: string | null; phone: string; name: string | null; optOut: boolean }, now = new Date()): Fields {
  const base: Fields = {
    workspace_id: input.workspaceId,
    phone: input.phone,
    name: input.name?.trim() || null,
    whatsapp_instance_id: input.instanceId,
  };
  if (input.optOut) return { ...base, opt_out_whatsapp: true };
  return { ...base, stage: "abordado", stage_changed_at: now.toISOString() };
}

export async function createInboundLead(
  admin: AdminClient,
  input: { workspaceId: string; instanceId: string | null; phone: string; name: string | null; optOut: boolean }
): Promise<InboundContact | null> {
  const columns = "id, stage, photo_url";
  const { data, error } = await admin.from("contacts").insert(inboundLeadFields(input)).select(columns).maybeSingle();
  if (data) return data as InboundContact;
  // 23505 = (workspace, phone) já existe: outra mensagem do mesmo número criou o contato neste instante.
  if (error?.code === "23505") {
    const { data: existing } = await admin.from("contacts").select(columns).eq("workspace_id", input.workspaceId).eq("phone", input.phone).maybeSingle();
    return (existing as InboundContact | null) ?? null;
  }
  if (error) console.error("Lead novo (mensagem direta) não foi criado:", error.message);
  return null;
}
