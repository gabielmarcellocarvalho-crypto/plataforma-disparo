import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDialog360IncomingMessages, type Dialog360WebhookBody } from "@/lib/dialog360";

// Webhook do 360dialog (API oficial) — rota separada da do Evolution porque o formato do payload é
// completamente diferente (Cloud API da Meta, não o formato da Evolution/Baileys). Mesmo padrão de
// autenticação por segredo na URL (?secret=), reaproveitando WHATSAPP_WEBHOOK_SECRET.
export const maxDuration = 30;

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WHATSAPP_WEBHOOK_SECRET || secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Dialog360WebhookBody | null;
  after(() => processDialog360Webhook(body).catch((err) => console.error("Erro no webhook 360dialog:", err)));
  return NextResponse.json({ ok: true });
}

async function processDialog360Webhook(body: Dialog360WebhookBody | null) {
  if (!body) return;
  const incoming = parseDialog360IncomingMessages(body);
  if (incoming.length === 0) return;

  const supabase = createAdminClient();

  for (const msg of incoming) {
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("id, workspace_id")
      .eq("phone_number_id", msg.phoneNumberId)
      .maybeSingle();
    if (!instance) continue; // número não cadastrado em nenhum workspace — ignora

    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", instance.workspace_id)
      .eq("phone", msg.from)
      .maybeSingle();
    if (!contact) continue; // número fora da base — sem agente aqui, não há o que fazer

    await supabase.from("messages").insert({
      workspace_id: instance.workspace_id,
      contact_id: contact.id,
      role: "user",
      content: msg.text,
    });
  }
}
