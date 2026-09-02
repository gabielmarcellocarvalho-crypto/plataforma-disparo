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

  const name = typeof body.name === "string" ? body.name : typeof body.nome === "string" ? body.nome : null;
  const email = typeof body.email === "string" ? body.email : null;

  const { data: existing } = await supabase.from("contacts").select("id").eq("workspace_id", workflow.workspace_id).eq("phone", phone).maybeSingle();
  let contactId = existing?.id as string | undefined;

  if (!contactId) {
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({ workspace_id: workflow.workspace_id, phone, name, email })
      .select("id")
      .maybeSingle();
    if (error || !created) return NextResponse.json({ error: "não foi possível criar o contato" }, { status: 500 });
    contactId = created.id;
  }
  if (!contactId) return NextResponse.json({ error: "erro interno" }, { status: 500 });

  const result = await enrollWebhookContact(workflow.id, contactId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, contact_id: contactId });
}
