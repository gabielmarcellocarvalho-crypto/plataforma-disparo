"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMetaCloudTemplates, sendMetaCloudTemplate, type TemplateHeaderMedia } from "@/lib/metacloud";
import { loadTemplateHeaderMedia } from "@/lib/template-header-media";
import { listDialog360Templates, sendDialog360Template } from "@/lib/dialog360";
import { variableCount } from "@/lib/template-variables";
import { fillTemplateBody } from "@/lib/template-log";
import { templateHeaderSupported, templateParamsFor } from "@/lib/conversation-template";
import { interruptChatbotForContact } from "@/lib/chatbot-engine";

type Result<T> = { error: string; data?: undefined } | { error: null; data: T };

export type ConversationTemplate = {
  name: string;
  language: string;
  category: string;
  // Texto já com os dados do contato (ou o motivo de não dar pra mandar pra ele).
  preview: string;
  blocked: string | null;
};

type ContactRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  custom_fields: Record<string, unknown> | null;
  workspace_id: string;
  needs_attention: boolean | null;
  companies: { name: string } | { name: string }[] | null;
};

// Número oficial dessa conversa (Meta direta ou 360dialog): o do agente (whatsapp_instance_id dele) ou o
// número do disparo avulso. As leituras de contato/agente/número passam pela RLS — quem não é do
// workspace não chega aqui.
type OfficialChannel = { kind: "metacloud"; phoneNumberId: string; wabaId: string } | { kind: "360dialog"; apiKey: string };
// Templates do workspace que têm mídia de cabeçalho guardada (criados pela AutomaX), no formato "nome|idioma".
async function templatesWithHeaderMedia(workspaceId: string): Promise<Set<string>> {
  const { data } = await createAdminClient().from("template_header_media").select("template_name, language").eq("workspace_id", workspaceId);
  return new Set((data || []).map((r) => `${r.template_name as string}|${r.language as string}`));
}

type ChannelTemplate = { name: string; language: string; category: string; bodyText: string | null; headerFormat: string | null };
async function officialTarget(contactId: string, agentId: string | null, instanceId: string | null) {
  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, phone, email, custom_fields, workspace_id, needs_attention, companies(name)")
    .eq("id", contactId)
    .maybeSingle<ContactRow>();
  if (!contact) return { error: "Conversa não encontrada." } as const;

  let numberId = instanceId;
  if (agentId) {
    const { data: agent } = await supabase.from("agents").select("evolution_instance_name, whatsapp_instance_id").eq("id", agentId).maybeSingle();
    if (!agent) return { error: "Conversa não encontrada." } as const;
    if (agent.evolution_instance_name || !agent.whatsapp_instance_id) return { error: "Template só existe no número oficial da Meta." } as const;
    numberId = agent.whatsapp_instance_id as string;
  }
  if (!numberId) return { error: "Conversa sem número de WhatsApp." } as const;

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("channel, phone_number_id, meta_waba_id, workspace_id")
    .eq("id", numberId)
    .maybeSingle();
  if (!instance || instance.workspace_id !== contact.workspace_id) return { error: "Número da conversa não encontrado." } as const;

  let channel: OfficialChannel;
  if (instance.channel === "metacloud") {
    if (!instance.phone_number_id || !instance.meta_waba_id) return { error: "Esse número não tem o WABA da Meta vinculado — reconecte em Configurações." } as const;
    channel = { kind: "metacloud", phoneNumberId: instance.phone_number_id as string, wabaId: instance.meta_waba_id as string };
  } else if (instance.channel === "360dialog") {
    // A API key é lida com o admin, e só depois de o número ter sido confirmado (pela RLS) como do
    // workspace do contato.
    const { data: key } = await createAdminClient().from("whatsapp_instances").select("dialog360_api_key").eq("id", numberId).maybeSingle();
    if (!key?.dialog360_api_key) return { error: "Esse número ainda não tem a API key do 360dialog configurada." } as const;
    channel = { kind: "360dialog", apiKey: key.dialog360_api_key as string };
  } else {
    return { error: "Template só existe no número oficial da Meta." } as const;
  }

  return { error: null, supabase, contact, channel } as const;
}

// Templates aprovados do número. Na 360dialog o cabeçalho não vem na listagem (mesmo comportamento das
// campanhas desse canal), então lá todo template aparece como mandável.
async function templatesOf(channel: OfficialChannel): Promise<ChannelTemplate[]> {
  if (channel.kind === "metacloud") return listMetaCloudTemplates(channel.wabaId);
  return (await listDialog360Templates(channel.apiKey)).map((t) => ({ ...t, headerFormat: t.headerFormat ?? null }));
}

function companyOf(contact: ContactRow): string | null {
  const c = contact.companies;
  return Array.isArray(c) ? c[0]?.name ?? null : c?.name ?? null;
}

async function mappingsOf(workspaceId: string): Promise<Map<string, string[]>> {
  const { data } = await createAdminClient().from("template_variable_maps").select("template_name, language, variables").eq("workspace_id", workspaceId);
  return new Map((data || []).map((m) => [`${m.template_name}|${m.language}`, (m.variables as string[]) || []]));
}

// Templates aprovados do número da conversa, cada um com a prévia já preenchida pra esse contato.
export async function listConversationTemplates(contactId: string, agentId: string | null, instanceId: string | null): Promise<Result<ConversationTemplate[]>> {
  const t = await officialTarget(contactId, agentId, instanceId);
  if (t.error !== null) return { error: t.error };
  try {
    const [templates, mappings, withMedia] = await Promise.all([templatesOf(t.channel), mappingsOf(t.contact.workspace_id), templatesWithHeaderMedia(t.contact.workspace_id)]);
    const company = companyOf(t.contact);
    const data = templates.map((tpl): ConversationTemplate => {
      const body = tpl.bodyText || "";
      const p = templateParamsFor(variableCount(body), mappings.get(`${tpl.name}|${tpl.language}`), t.contact, company);
      // Cabeçalho de imagem/PDF: dá pra mandar daqui se o template foi criado pela AutomaX (a mídia fica guardada).
      const mediaOk = t.channel.kind === "metacloud" && withMedia.has(`${tpl.name}|${tpl.language}`);
      const blocked = !templateHeaderSupported(tpl.headerFormat) && !mediaOk
        ? "Tem imagem/arquivo no cabeçalho — mande por uma campanha, que tem o envio da mídia."
        : p.error;
      return { name: tpl.name, language: tpl.language, category: tpl.category, preview: p.params ? fillTemplateBody(body, p.params) : body, blocked };
    });
    data.sort((a, b) => Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) || a.name.localeCompare(b.name));
    return { error: null, data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Não foi possível ler os templates do número." };
  }
}

// Dispara um template aprovado só pra esse contato. Serve principalmente pra reabrir a conversa depois
// das 24h, quando texto livre não entra mais.
export async function sendConversationTemplate(
  contactId: string,
  agentId: string | null,
  instanceId: string | null,
  template: { name: string; language: string }
): Promise<{ error: string | null }> {
  const t = await officialTarget(contactId, agentId, instanceId);
  if (t.error !== null) return { error: t.error };
  const { contact } = t;
  if (!contact.phone) return { error: "Contato sem telefone." };
  // Mesma regra do envio manual: com agente de IA, só depois de assumir a conversa (senão os dois falam).
  if (agentId && !contact.needs_attention) return { error: "Assuma a conversa antes de mandar mensagem manual." };

  let tpl: ChannelTemplate | undefined;
  try {
    tpl = (await templatesOf(t.channel)).find((x) => x.name === template.name && x.language === template.language);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Não foi possível ler os templates do número." };
  }
  if (!tpl) return { error: "Template não encontrado ou não está mais aprovado pela Meta." };
  let header: TemplateHeaderMedia | null = null;
  if (!templateHeaderSupported(tpl.headerFormat)) {
    header = t.channel.kind === "metacloud" ? await loadTemplateHeaderMedia(createAdminClient(), contact.workspace_id, tpl.name, tpl.language) : null;
    if (!header) return { error: "Template com mídia no cabeçalho: mande por uma campanha." };
  }

  const mappings = await mappingsOf(contact.workspace_id);
  const p = templateParamsFor(variableCount(tpl.bodyText || ""), mappings.get(`${tpl.name}|${tpl.language}`), contact, companyOf(contact));
  if (p.error !== null) return { error: p.error };

  let externalId: string | null = null;
  try {
    const sent =
      t.channel.kind === "metacloud"
        ? await sendMetaCloudTemplate(t.channel.phoneNumberId, contact.phone, tpl.name, tpl.language, p.params, header)
        : await sendDialog360Template(t.channel.apiKey, contact.phone, tpl.name, tpl.language, p.params);
    externalId = sent?.id ?? null;
  } catch (err) {
    return { error: `Falha ao enviar o template: ${err instanceof Error ? err.message.slice(0, 300) : "erro desconhecido"}` };
  }

  // Na conversa fica o texto que o contato recebeu (o agente de IA lê esse histórico).
  const content = tpl.bodyText ? `[Template: ${tpl.name}]\n${fillTemplateBody(tpl.bodyText, p.params)}` : `[Template: ${tpl.name}]`;
  const { error: logError } = await t.supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contact.id,
    agent_id: agentId,
    role: "assistant",
    content,
    external_id: externalId,
    // A coluna só aceita minúsculas (check de messages.billing_category).
    billing_category: (tpl.category || "marketing").toLowerCase(),
  });
  if (logError) console.error("Template da conversa enviado mas não registrado:", logError.code, logError.message);
  if (!agentId) await interruptChatbotForContact(createAdminClient(), contact.id);

  revalidatePath("/conversas");
  return { error: null };
}
