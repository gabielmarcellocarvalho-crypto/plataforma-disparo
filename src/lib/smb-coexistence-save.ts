import type { createAdminClient } from "@/lib/supabase/admin";
import type { CoexMessage } from "@/lib/smb-coexistence";
import { brPhoneVariant } from "@/lib/import-contacts";
import { createInboundLead } from "@/lib/inbound-lead";

type AdminClient = ReturnType<typeof createAdminClient>;

// Grava as mensagens de coexistência (enviadas pelo celular e histórico do app) na conversa certa.
// Mensagem do negócio entra como "assistant", do cliente como "user"; com agente de IA no número, entram
// na conversa do agente. Dedup por external_id (o wamid), igual às mensagens recebidas.
export async function saveCoexistenceMessages(supabase: AdminClient, items: CoexMessage[]): Promise<void> {
  const byNumber = new Map<string, CoexMessage[]>();
  for (const m of items) byNumber.set(m.phoneNumberId, [...(byNumber.get(m.phoneNumberId) ?? []), m]);

  for (const [phoneNumberId, msgs] of byNumber) {
    const { data: instance } = await supabase.from("whatsapp_instances").select("id, workspace_id, channel").eq("phone_number_id", phoneNumberId).maybeSingle();
    // Coexistência só existe na Meta direta.
    if (!instance || instance.channel !== "metacloud") continue;
    const { data: agent } = await supabase.from("agents").select("id").eq("whatsapp_instance_id", instance.id).maybeSingle();

    // Um contato por telefone do cliente (o histórico chega com muitas mensagens da mesma conversa).
    const contactByPhone = new Map<string, { id: string; needs_attention: boolean } | null>();
    for (const phone of new Set(msgs.map((m) => m.customerPhone))) {
      const variant = brPhoneVariant(phone);
      const { data: found } = await supabase
        .from("contacts")
        .select("id, needs_attention")
        .eq("workspace_id", instance.workspace_id)
        .in("phone", variant ? [phone, variant] : [phone])
        .limit(1)
        .maybeSingle();
      if (found) {
        contactByPhone.set(phone, found as { id: string; needs_attention: boolean });
        continue;
      }
      const created = await createInboundLead(supabase, { workspaceId: instance.workspace_id, instanceId: instance.id, phone, name: null, optOut: false });
      contactByPhone.set(phone, created ? { id: created.id, needs_attention: false } : null);
    }

    // Retry do webhook ou histórico que repete mensagem já recebida: não duplica.
    const seen = new Set<string>();
    const ids = msgs.map((m) => m.externalId);
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from("messages").select("external_id").eq("workspace_id", instance.workspace_id).in("external_id", ids.slice(i, i + 100));
      for (const r of data ?? []) if (r.external_id) seen.add(r.external_id as string);
    }

    // Proteção: se a Meta mandar como eco algo que a própria plataforma enviou (agente ou painel), a
    // mensagem já está gravada (sem wamid). Mesmo texto pro mesmo contato nos últimos 3 minutos = é nossa.
    for (const m of msgs) {
      if (m.kind !== "echo" || seen.has(m.externalId)) continue;
      const c = contactByPhone.get(m.customerPhone);
      if (!c) continue;
      const { data: recent } = await supabase
        .from("messages")
        .select("id")
        .eq("contact_id", c.id)
        .eq("role", "assistant")
        .eq("content", m.content)
        .gte("created_at", new Date(Date.now() - 3 * 60_000).toISOString())
        .limit(1);
      if (recent && recent.length > 0) seen.add(m.externalId);
    }

    const rows = msgs
      .filter((m) => !seen.has(m.externalId) && contactByPhone.get(m.customerPhone))
      .filter((m, i, all) => all.findIndex((x) => x.externalId === m.externalId) === i)
      .map((m) => ({
        workspace_id: instance.workspace_id,
        contact_id: contactByPhone.get(m.customerPhone)!.id,
        agent_id: agent?.id ?? null,
        role: m.fromBusiness ? "assistant" : "user",
        content: m.content,
        external_id: m.externalId,
        created_at: m.createdAt,
      }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("messages").insert(rows.slice(i, i + 200));
      if (error) console.error("Coexistência: falha ao gravar mensagens:", error.message);
    }

    // Alguém respondeu pelo celular: o agente de IA sai da conversa (mesmo efeito de "Assumir conversa"),
    // senão os dois respondem o cliente ao mesmo tempo. Só pra mensagem nova, não pro histórico.
    if (agent) {
      const atendidos = new Set(msgs.filter((m) => m.kind === "echo" && !seen.has(m.externalId)).map((m) => m.customerPhone));
      for (const phone of atendidos) {
        const c = contactByPhone.get(phone);
        if (!c || c.needs_attention) continue;
        await supabase.from("contacts").update({ needs_attention: true, attention_reason: "Respondido pelo celular (WhatsApp Business)." }).eq("id", c.id);
      }
    }
  }
}
