import { createHmac } from "crypto";
import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secureEqual } from "@/lib/secure-compare";
import { decryptToken } from "@/lib/calendar/crypto";
import { graphGet } from "@/lib/facebook/graph";
import { mapFacebookFields, type FacebookField } from "@/lib/facebook/leads-map";
import { normalizePhone } from "@/lib/import-contacts";
import { mergeTags } from "@/lib/contact-tags";
import { normalizeCity } from "@/lib/territories";

// Webhook de leads do Facebook (Página → leadgen).
// GET: validação da URL pela Meta (devolve o desafio se o token de verificação confere).
// POST: aviso de lead novo. Confere a assinatura, responde na hora e grava o lead em segundo plano.

// Chamado uma vez pela Meta pra validar a URL: devolve o `hub.challenge` só com o token certo.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";

  const expected = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && secureEqual(token, expected) && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type LeadgenChange = { field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string } };
type WebhookBody = { entry?: { changes?: LeadgenChange[] }[] };

// Assinatura do corpo com o segredo do app (X-Hub-Signature-256). Sem ela, qualquer um poderia forjar lead.
function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return secureEqual(header, expected);
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.META_APP_SECRET;
  if (!secret || !validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  const leads: { leadgenId: string; pageId: string; formId: string }[] = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "leadgen") continue;
      const v = change.value;
      if (v?.leadgen_id && v.page_id && v.form_id) leads.push({ leadgenId: v.leadgen_id, pageId: v.page_id, formId: v.form_id });
    }
  }

  // Responde rápido: a Meta reenvia o aviso se demorar. O trabalho de verdade roda depois.
  if (leads.length) after(() => processLeads(leads).catch((err) => console.error("Lead do Facebook falhou:", err)));
  return NextResponse.json({ ok: true });
}

async function processLeads(leads: { leadgenId: string; pageId: string; formId: string }[]) {
  const admin = createAdminClient();
  for (const lead of leads) {
    // Uma página pertence a um workspace só (índice único no banco). Se por qualquer motivo houver mais de
    // uma linha ativa, o dono é ambíguo: não entrega pra ninguém, melhor perder o aviso do que mandar o
    // lead de um cliente pra outro.
    const { data: pages } = await admin.from("facebook_pages").select("workspace_id, page_token_enc").eq("page_id", lead.pageId).eq("status", "ativa");
    if ((pages || []).length > 1) {
      console.error(`Página ${lead.pageId} ativa em mais de um workspace; lead não entregue.`);
      continue;
    }
    for (const page of pages || []) {
      await saveLeadForWorkspace(admin, page.workspace_id as string, page.page_token_enc as string, lead.leadgenId, lead.formId).catch((err) =>
        console.error("Gravar lead do Facebook falhou:", err instanceof Error ? err.message : err)
      );
    }
  }
}

async function saveLeadForWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  pageTokenEnc: string,
  leadgenId: string,
  formId: string
) {
  // Só formulário que o workspace escolheu e ligou.
  const { data: form } = await admin.from("facebook_lead_forms").select("form_name, enabled, tag").eq("workspace_id", workspaceId).eq("form_id", formId).maybeSingle();
  if (!form?.enabled) return;

  // Dedupe: o mesmo aviso pode chegar mais de uma vez.
  const { data: done } = await admin.from("facebook_leads").select("id").eq("workspace_id", workspaceId).eq("leadgen_id", leadgenId).maybeSingle();
  if (done) return;

  const pageToken = decryptToken(pageTokenEnc);
  const data = await graphGet<{ created_time?: string; field_data?: FacebookField[]; campaign_name?: string; ad_name?: string }>(leadgenId, pageToken, {
    fields: "created_time,field_data,campaign_name,ad_name",
  });
  const mapped = mapFacebookFields(data.field_data || []);
  const phone = normalizePhone(mapped.phone ?? "");
  if (!phone && !mapped.email) return;

  const { data: ws } = await admin.from("workspaces").select("city_field_key").eq("id", workspaceId).maybeSingle();
  const cityKey = ws?.city_field_key ?? null;

  const { data: existing } = phone
    ? await admin.from("contacts").select("id, name, email, custom_fields, tags, team_member_id, branch_id").eq("workspace_id", workspaceId).eq("phone", phone).maybeSingle()
    : { data: null };

  // Campos do formulário + origem. Campo que o formulário não trouxe não apaga o que já existia.
  const custom: Record<string, string> = { ...mapped.custom, origem: "Facebook" };
  if (cityKey && mapped.city) custom[cityKey] = mapped.city;

  const formTag = (form.tag || form.form_name || "").trim();
  const campaignTag = (data.campaign_name || "").trim();
  const tags = mergeTags(existing?.tags ?? [], [formTag, campaignTag].filter(Boolean));

  const base = {
    name: mapped.name || existing?.name || null,
    email: mapped.email || existing?.email || null,
    custom_fields: { ...((existing?.custom_fields as Record<string, unknown> | null) ?? {}), ...custom },
    tags,
  };

  let contactId: string;
  if (existing) {
    await admin.from("contacts").update(base).eq("id", existing.id);
    contactId = existing.id;
  } else {
    const { data: created, error } = await admin
      .from("contacts")
      .insert({ ...base, workspace_id: workspaceId, phone })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "não foi possível criar o contato");
    contactId = created.id;
  }

  // Roteamento por cidade: só pra lead sem dono. Nunca troca quem já está com alguém.
  if (mapped.city && !existing?.team_member_id) {
    const { data: t } = await admin
      .from("territories")
      .select("team_member_id, branch_id")
      .eq("workspace_id", workspaceId)
      .eq("city_key", normalizeCity(mapped.city))
      .maybeSingle();
    if (t?.team_member_id) {
      await admin.from("contacts").update({ team_member_id: t.team_member_id, ...(t.branch_id ? { branch_id: t.branch_id } : {}) }).eq("id", contactId);
    }
  }

  await admin.from("facebook_leads").insert({ workspace_id: workspaceId, leadgen_id: leadgenId, form_id: formId, contact_id: contactId });
}
