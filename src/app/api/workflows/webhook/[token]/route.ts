import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/import-contacts";
import { enrollWebhookContact } from "@/lib/workflow-engine";

// URL pública de gatilho de workflow (item 8 do pedido do usuário — "Entrada: Webhook"). O token em
// si é o segredo (padrão comum de webhook, tipo catch hook do Zapier) — sem header extra, pra
// qualquer sistema externo (formulário de site, outra ferramenta) conseguir chamar direto.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: workflow } = await supabase
    .from("workflows")
    .select("id, workspace_id, enabled")
    .eq("webhook_token", token)
    .eq("trigger_type", "webhook")
    .maybeSingle();
  if (!workflow) return NextResponse.json({ error: "workflow não encontrado" }, { status: 404 });
  if (!workflow.enabled) return NextResponse.json({ error: "workflow pausado" }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido, esperado JSON" }, { status: 400 });
  }

  const phone = normalizePhone(body.phone ?? body.telefone);
  if (!phone) return NextResponse.json({ error: "campo 'phone' obrigatório (com DDI)" }, { status: 400 });

  // Tetos de tamanho: o token é o único controle desta rota pública, então o que entra no contato é limitado.
  const rawName = typeof body.name === "string" ? body.name : typeof body.nome === "string" ? body.nome : null;
  const rawEmail = typeof body.email === "string" ? body.email : null;
  const name = rawName ? rawName.trim().slice(0, 200) : null;
  const email = rawEmail ? rawEmail.trim().slice(0, 254) : null;

  // Dados de agendamento (formulário + Google Agenda): ficam na ficha como campos personalizados, e daí
  // um template pode usá-los como variável ({{2}} = data, {{3}} = hora, {{4}} = link). Só entra o que veio,
  // e o link só se for http(s) — ele vai parar dentro de uma mensagem pro lead.
  const asText = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, 500) : "");
  const meet = asText(body.meet ?? body.link_meet);
  const extras: Record<string, string> = {};
  const data = asText(body.data ?? body.data_reuniao);
  const hora = asText(body.hora ?? body.hora_da_reuniao ?? body.hora_reuniao);
  if (data) extras.data_reuniao = data;
  if (hora) extras.hora_da_reuniao = hora;
  if (/^https?:\/\//i.test(meet)) extras.link_meet = meet;

  // O envio do workflow usa o número do próprio contato; um contato nascido por webhook não tem nenhum.
  // Mesma regra do cadastro por API (/api/v1/leads): só vale quando o workspace tem exatamente 1 número.
  const { data: instances } = await supabase.from("whatsapp_instances").select("id").eq("workspace_id", workflow.workspace_id);
  const instanceId = instances && instances.length === 1 ? (instances[0].id as string) : null;

  const { data: existing } = await supabase
    .from("contacts")
    .select("id, custom_fields, whatsapp_instance_id")
    .eq("workspace_id", workflow.workspace_id)
    .eq("phone", phone)
    .maybeSingle();
  let contactId = existing?.id as string | undefined;

  if (!contactId) {
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        workspace_id: workflow.workspace_id,
        phone,
        name,
        email,
        whatsapp_instance_id: instanceId,
        ...(Object.keys(extras).length ? { custom_fields: extras } : {}),
      })
      .select("id")
      .maybeSingle();
    if (error || !created) return NextResponse.json({ error: "não foi possível criar o contato" }, { status: 500 });
    contactId = created.id;
  } else {
    // Quem já existe pode agendar de novo: o horário novo substitui o anterior, o resto da ficha fica.
    // O número só é preenchido se estava vazio (nunca troca o de um contato que já conversa por outro).
    const atual = (existing?.custom_fields as Record<string, unknown> | null) ?? {};
    const update: Record<string, unknown> = {};
    if (Object.keys(extras).length) update.custom_fields = { ...atual, ...extras };
    if (instanceId && !existing?.whatsapp_instance_id) update.whatsapp_instance_id = instanceId;
    if (Object.keys(update).length) await supabase.from("contacts").update(update).eq("id", contactId);
  }
  if (!contactId) return NextResponse.json({ error: "erro interno" }, { status: 500 });

  const result = await enrollWebhookContact(workflow.id, contactId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, contact_id: contactId });
}
