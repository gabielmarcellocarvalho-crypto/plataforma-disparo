import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/api-keys";
import { normalizePhone } from "@/lib/import-contacts";
import { mergeTags, normalizeTags, reuseExistingTags } from "@/lib/contact-tags";
import { hitRateLimit } from "@/lib/rate-limit-db";
import { resolveStageLabels } from "@/lib/crm-stages";
import { parseLeadsQuery, toApiLead, type LeadRow } from "@/lib/leads-api";

// Endpoint público pra plataforma terceira (form de site, outro CRM, Zapier/Make): POST joga lead direto
// na lista de contatos, sem passar pelo WhatsApp; GET lê os leads de volta. Autenticado por chave de API (gerada em
// /configuracoes), não por sessão — por isso usa o client admin (service role) pra gravar.
// Chave de API do header (Authorization: Bearer <chave> ou x-api-key) → workspace dono dela.
async function authenticate(req: Request, supabase: ReturnType<typeof createAdminClient>) {
  const auth = req.headers.get("authorization") || "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");
  if (!apiKey) {
    return { error: NextResponse.json({ error: "Chave de API ausente. Envie em Authorization: Bearer <chave>." }, { status: 401 }) };
  }
  const { data: key } = await supabase
    .from("api_keys")
    .select("id, workspace_id, revoked_at")
    .eq("key_hash", hashApiKey(apiKey))
    .maybeSingle();
  if (!key || key.revoked_at) {
    return { error: NextResponse.json({ error: "Chave de API inválida ou revogada." }, { status: 401 }) };
  }
  return { key: key as { id: string; workspace_id: string } };
}

// Leitura dos leads pra BI/planilha/outro CRM: dados, fase atual, ganho/perdido com valor e origem.
// Paginado e com filtro pela data de entrada; ordem fixa (entrada, id) pra a paginação não pular lead.
export async function GET(req: Request) {
  const supabase = createAdminClient();
  const authed = await authenticate(req, supabase);
  if ("error" in authed) return authed.error;
  const { key } = authed;

  // Devolve dado pessoal em lote: limita por chave (120/min) pra uma chave vazada não virar exportação contínua.
  const limit = await hitRateLimit(`api-leads:${key.id}`, 120, 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Muitas requisições. Tente de novo em instantes." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const parsed = parseLeadsQuery(new URL(req.url).searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { fromIso, toIso, page, perPage } = parsed.query;

  let q = supabase
    .from("contacts")
    .select(
      "id, name, phone, email, created_at, stage, stage_changed_at, pipeline_stage_id, lost_reason, custom_fields, tags, ctwa_at, deal_value",
      { count: "exact" }
    )
    .eq("workspace_id", key.workspace_id);
  if (fromIso) q = q.gte("created_at", fromIso);
  if (toIso) q = q.lte("created_at", toIso);
  const from = (page - 1) * perPage;
  const [{ data: rows, count, error }, { data: ws }, { data: stages }] = await Promise.all([
    q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + perPage - 1),
    supabase.from("workspaces").select("crm_stage_labels").eq("id", key.workspace_id).maybeSingle(),
    supabase.from("pipeline_stages").select("id, name, signal, pipelines!inner(workspace_id)").eq("pipelines.workspace_id", key.workspace_id),
  ]);
  if (error) return NextResponse.json({ error: "Não foi possível ler os leads." }, { status: 500 });

  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);

  const ctx = {
    stageLabels: resolveStageLabels(ws?.crm_stage_labels),
    pipelineStages: new Map((stages ?? []).map((st) => [st.id as string, { name: st.name as string, signal: st.signal as string }])),
  };
  const total = count ?? 0;
  return NextResponse.json({
    data: ((rows ?? []) as unknown as LeadRow[]).map((r) => toApiLead(r, ctx)),
    paginacao: { pagina: page, por_pagina: perPage, total, total_paginas: Math.ceil(total / perPage) },
  });
}

export async function POST(req: Request) {
  const supabase = createAdminClient();
  const authed = await authenticate(req, supabase);
  if ("error" in authed) return authed.error;
  const { key } = authed;

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

  // `custom_fields` como TEXTO com JSON dentro é o erro mais comum de quem integra (a ferramenta do
  // outro lado pede "body" como string e o JSON acaba escapado duas vezes). Antes isso era descartado
  // em silêncio e a resposta vinha `ok: true` — o integrador só descobria olhando o lead na tela.
  let rawCustom: unknown = body.custom_fields;
  if (typeof rawCustom === "string" && rawCustom.trim().startsWith("{")) {
    try {
      rawCustom = JSON.parse(rawCustom);
    } catch {
      rawCustom = null;
    }
  }

  // Valor aceito é o que cabe num campo de texto do lead: texto, número ou booleano (vira "sim"/"não",
  // que é o que a pessoa lê na ficha). Objeto/lista aninhados não têm como ser exibidos nem filtrados,
  // então são recusados — e agora a resposta DIZ quais chaves ficaram de fora, em vez de fingir sucesso.
  const customFields: Record<string, string> = {};
  const ignorados: string[] = [];
  if (rawCustom && typeof rawCustom === "object" && !Array.isArray(rawCustom)) {
    for (const [k, v] of Object.entries(rawCustom as Record<string, unknown>)) {
      const key = String(k).trim().slice(0, 60);
      if (!key) continue;
      if (typeof v === "string" || typeof v === "number") customFields[key] = String(v).slice(0, 500);
      else if (typeof v === "boolean") customFields[key] = v ? "sim" : "não";
      else if (v === null || v === undefined || v === "") continue; // ausência de valor não é erro
      else ignorados.push(key);
    }
  } else if (body.custom_fields != null) {
    return NextResponse.json(
      { error: "custom_fields precisa ser um objeto JSON (ex.: {\"faturamento\": \"1200000\"}), não texto nem lista." },
      { status: 400 }
    );
  }

  // Tags do lead: lista (["Associado","Feira"]) ou texto separado por vírgula. Tag que o workspace já usa é
  // reaproveitada com a grafia dele; as que o lead já tinha ficam (a chamada só acrescenta).
  if (body.tags != null && !Array.isArray(body.tags) && typeof body.tags !== "string") {
    return NextResponse.json({ error: "tags precisa ser uma lista (ex.: [\"Feira\"]) ou texto separado por vírgula." }, { status: 400 });
  }
  let incomingTags = normalizeTags(body.tags);
  if (incomingTags.length > 0) {
    const { data: ws } = await supabase.rpc("workspace_tags", { ws_id: key.workspace_id });
    incomingTags = reuseExistingTags(incomingTags, ((ws as { tag: string }[] | null) ?? []).map((t) => t.tag));
  }

  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 60) : "api";
  customFields.origem = customFields.origem || source;

  // Awaited (não fire-and-forget): em função serverless a invocação pode ser encerrada assim que a
  // resposta é montada, matando promise pendente no meio — mesma pegadinha já vista no webhook do WhatsApp.
  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);

  // Só marca o número de origem quando o workspace tem exatamente 1 número de disparo (mesma regra
  // do formulário/importação manual em src/app/actions/contacts.ts) — com 0 ou 2+, fica sem contexto.
  const { data: instances } = await supabase.from("whatsapp_instances").select("id").eq("workspace_id", key.workspace_id);
  const whatsappInstanceId = instances && instances.length === 1 ? instances[0].id : null;

  // Telefone que já existe = mesma pessoa chegando de novo (o agente reimportando a planilha, um
  // segundo formulário). O upsert cru SUBSTITUÍA a linha: os campos que o agente de IA coletou na
  // conversa sumiam, e uma chamada sem `name` apagava o nome. Agora a chamada só acrescenta:
  // o que ela manda vence, o que ela não manda fica como estava.
  const { data: existente } = phone
    ? await supabase
        .from("contacts")
        .select("id, name, email, custom_fields, tags")
        .eq("workspace_id", key.workspace_id)
        .eq("phone", phone)
        .maybeSingle()
    : { data: null };

  const camposFinais = { ...((existente?.custom_fields as Record<string, string> | null) ?? {}), ...customFields };
  const payload = {
    workspace_id: key.workspace_id,
    name: name || existente?.name || null,
    phone,
    email: email || existente?.email || null,
    custom_fields: camposFinais,
    // Sem `tags` na chamada, não mexe nas do lead (e lead novo nasce sem tag).
    ...(incomingTags.length > 0 ? { tags: mergeTags(existente?.tags, incomingTags) } : {}),
    whatsapp_instance_id: whatsappInstanceId,
  };

  const { data: contact, error } = existente
    ? await supabase.from("contacts").update(payload).eq("id", existente.id).select("id").maybeSingle()
    : await supabase.from("contacts").insert(payload).select("id").maybeSingle();

  if (error || !contact) {
    return NextResponse.json({ error: "Não foi possível criar o contato." }, { status: 500 });
  }

  // Devolve o que ficou gravado: sem isso, campo descartado por formato errado passava despercebido
  // (a resposta dizia `ok: true` e o lead entrava sem nada).
  return NextResponse.json(
    {
      ok: true,
      contact_id: contact.id,
      created: !existente,
      custom_fields: camposFinais,
      ...(incomingTags.length > 0 ? { tags: mergeTags(existente?.tags, incomingTags) } : {}),
      ...(ignorados.length > 0
        ? { ignored_fields: ignorados, warning: "Campos ignorados: só texto, número ou verdadeiro/falso são aceitos." }
        : {}),
    },
    { status: existente ? 200 : 201 }
  );
}
