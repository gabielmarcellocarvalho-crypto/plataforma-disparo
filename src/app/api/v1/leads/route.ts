import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/api-keys";
import { normalizePhone } from "@/lib/import-contacts";

// Endpoint público pra plataforma terceira (form de site, outro CRM, Zapier/Make) jogar lead direto
// na lista de contatos, sem passar pelo WhatsApp. Autenticado por chave de API (gerada em
// /configuracoes), não por sessão — por isso usa o client admin (service role) pra gravar.
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "Chave de API ausente. Envie em Authorization: Bearer <chave>." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: key } = await supabase
    .from("api_keys")
    .select("id, workspace_id, revoked_at")
    .eq("key_hash", hashApiKey(apiKey))
    .maybeSingle();

  if (!key || key.revoked_at) {
    return NextResponse.json({ error: "Chave de API inválida ou revogada." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição precisa ser JSON." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const phone = body.phone != null ? normalizePhone(body.phone) : null;
  const email = emailRaw || null;
  if (!phone && !email) {
    return NextResponse.json({ error: "Envie ao menos um telefone válido (com DDI) ou e-mail." }, { status: 400 });
  }

  const customFields =
    body.custom_fields && typeof body.custom_fields === "object" && !Array.isArray(body.custom_fields)
      ? Object.fromEntries(
          Object.entries(body.custom_fields as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" || typeof v === "number")
            .map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 500)])
        )
      : {};
  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 60) : "api";
  customFields.origem = customFields.origem || source;

  // Awaited (não fire-and-forget): em função serverless a invocação pode ser encerrada assim que a
  // resposta é montada, matando promise pendente no meio — mesma pegadinha já vista no webhook do WhatsApp.
  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);

  // Só marca o número de origem quando o workspace tem exatamente 1 número de disparo (mesma regra
  // do formulário/importação manual em src/app/actions/contacts.ts) — com 0 ou 2+, fica sem contexto.
  const { data: instances } = await supabase.from("whatsapp_instances").select("id").eq("workspace_id", key.workspace_id);
  const whatsappInstanceId = instances && instances.length === 1 ? instances[0].id : null;

  const { data: contact, error } = await supabase
    .from("contacts")
    .upsert(
      { workspace_id: key.workspace_id, name: name || null, phone, email, custom_fields: customFields, whatsapp_instance_id: whatsappInstanceId },
      { onConflict: "workspace_id,phone", ignoreDuplicates: false }
    )
    .select("id")
    .maybeSingle();

  if (error || !contact) {
    return NextResponse.json({ error: "Não foi possível criar o contato." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, contact_id: contact.id }, { status: 201 });
}
