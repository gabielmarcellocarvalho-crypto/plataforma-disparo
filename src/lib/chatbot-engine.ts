import type { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/evolution";
import { sendDialog360Text } from "@/lib/dialog360";
import { sendMetaCloudText } from "@/lib/metacloud";
import { brPhoneVariant } from "@/lib/import-contacts";
import { canAdvanceStage, type ContactStage } from "@/lib/crm-stages";
import { canonicalizeValue, type CustomFieldDef } from "@/lib/custom-fields";
import { mergeTags } from "@/lib/contact-tags";
import { normalizeCity } from "@/lib/territories";
import { conversationKey } from "@/lib/conversation-tickets";
import { interpolate, normalizeChatbotConfig, OPT_OUT_RE, parseMenuAnswer, planFrom, type ChatbotConfig } from "@/lib/chatbot";

// Motor do chatbot de mensagens iniciais (números SEM agente de IA). Chamado pelos dois webhooks antes
// do caminho normal de "só registra a mensagem". Devolve true quando cuidou da mensagem (o webhook para
// ali); false = não é caso de bot e o webhook segue como sempre foi.

type AdminClient = ReturnType<typeof createAdminClient>;

export type ChatbotInstance = {
  id: string;
  workspace_id: string;
  channel: string;
  instance_name: string | null;
  dialog360_api_key: string | null;
  phone_number_id: string | null;
  chatbot: unknown;
};

export type ChatbotInbound = {
  phone: string;
  pushName: string | null;
  // null = veio mídia (áudio, foto…) em vez de texto.
  text: string | null;
  externalId: string | null;
};

type Contact = { id: string; name: string | null; email: string | null; stage: string; team_member_id: string | null; custom_fields: Record<string, unknown> | null; tags: string[] | null };
const CONTACT_COLUMNS = "id, name, email, stage, team_member_id, custom_fields, tags";

type Session = { id: string; step_index: number; retries: number; answers: Record<string, string> };

const GAP_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendViaInstance(instance: ChatbotInstance, phone: string, text: string): Promise<void> {
  if (instance.channel === "360dialog") {
    if (!instance.dialog360_api_key) throw new Error("360dialog sem API key");
    await sendDialog360Text(instance.dialog360_api_key, phone, text);
  } else if (instance.channel === "metacloud") {
    if (!instance.phone_number_id) throw new Error("Meta sem phone_number_id");
    await sendMetaCloudText(instance.phone_number_id, phone, text);
  } else {
    if (!instance.instance_name) throw new Error("Evolution sem instância");
    await sendText(instance.instance_name, phone, text);
  }
}

// Envia em sequência (com intervalo, pra não chegar tudo de uma vez) e registra na conversa.
async function say(admin: AdminClient, instance: ChatbotInstance, phone: string, contact: Contact, texts: string[]) {
  for (let i = 0; i < texts.length; i++) {
    const text = interpolate(texts[i], { name: contact.name, customFields: contact.custom_fields || {} }).trim();
    if (!text) continue;
    if (i > 0) await sleep(GAP_MS);
    await sendViaInstance(instance, phone, text);
    await admin.from("messages").insert({ workspace_id: instance.workspace_id, contact_id: contact.id, role: "assistant", content: text });
  }
}

async function findContact(admin: AdminClient, workspaceId: string, phone: string): Promise<Contact | null> {
  const { data } = await admin.from("contacts").select(CONTACT_COLUMNS).eq("workspace_id", workspaceId).eq("phone", phone).maybeSingle();
  if (data) return data as Contact;
  const variant = brPhoneVariant(phone);
  if (!variant) return null;
  const { data: byVariant } = await admin.from("contacts").select(CONTACT_COLUMNS).eq("workspace_id", workspaceId).eq("phone", variant).maybeSingle();
  return (byVariant as Contact | null) ?? null;
}

async function reload(admin: AdminClient, contactId: string): Promise<Contact> {
  const { data } = await admin.from("contacts").select(CONTACT_COLUMNS).eq("id", contactId).single();
  return data as Contact;
}

async function saveInbound(admin: AdminClient, workspaceId: string, contactId: string, msg: ChatbotInbound): Promise<boolean> {
  if (msg.externalId) {
    const { data: dup } = await admin.from("messages").select("id").eq("workspace_id", workspaceId).eq("external_id", msg.externalId).maybeSingle();
    if (dup) return false; // retry/replay do webhook — já foi processada
  }
  await admin.from("messages").insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    role: "user",
    content: msg.text ?? "[o cliente enviou um arquivo]",
    external_id: msg.externalId,
  });
  return true;
}

// Grava a resposta de uma pergunta aberta no campo configurado. Campo de lista casa com as opções
// (acento/caixa); valor novo entra nas opções, igual à importação — senão o filtro fica sem ele.
async function saveFieldAnswer(admin: AdminClient, workspaceId: string, contact: Contact, fieldKey: string, value: string): Promise<string> {
  if (!fieldKey || !value) return value;
  if (fieldKey === "nome") {
    await admin.from("contacts").update({ name: value.slice(0, 120) }).eq("id", contact.id);
    return value;
  }
  if (fieldKey === "email") {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) await admin.from("contacts").update({ email: value }).eq("id", contact.id);
    return value;
  }
  const { data: def } = await admin.from("custom_field_defs").select("id, key, type, options").eq("workspace_id", workspaceId).eq("key", fieldKey).maybeSingle();
  let finalValue = value;
  if (def && (def.type === "selecao" || def.type === "selecao_multipla")) {
    const options = ((def.options as string[] | null) || []) as string[];
    finalValue = canonicalizeValue({ type: def.type as CustomFieldDef["type"], options }, value);
    if (!options.includes(finalValue)) await admin.from("custom_field_defs").update({ options: [...options, finalValue] }).eq("id", def.id);
  }
  const custom = { ...(contact.custom_fields || {}), [fieldKey]: def?.type === "selecao_multipla" ? [finalValue] : finalValue };
  await admin.from("contacts").update({ custom_fields: custom }).eq("id", contact.id);

  // Campo de cidade do workspace: roteia pro vendedor/filial da praça. Nunca reatribui lead com dono.
  if (!contact.team_member_id) {
    const { data: ws } = await admin.from("workspaces").select("city_field_key").eq("id", workspaceId).maybeSingle();
    if (ws?.city_field_key === fieldKey) {
      const { data: t } = await admin
        .from("territories")
        .select("team_member_id, branch_id")
        .eq("workspace_id", workspaceId)
        .eq("city_key", normalizeCity(finalValue))
        .maybeSingle();
      if (t?.team_member_id) {
        await admin.from("contacts").update({ team_member_id: t.team_member_id, ...(t.branch_id ? { branch_id: t.branch_id } : {}) }).eq("id", contact.id);
      }
    }
  }
  return finalValue;
}

async function addTag(admin: AdminClient, contact: Contact, tag: string) {
  if (!tag) return;
  await admin.from("contacts").update({ tags: mergeTags(contact.tags, [tag]) }).eq("id", contact.id);
}

async function moveStage(admin: AdminClient, contact: Contact, stage: ContactStage) {
  if (!canAdvanceStage(contact.stage as ContactStage, stage)) return;
  await admin.from("contacts").update({ stage, stage_changed_at: new Date().toISOString() }).eq("id", contact.id);
}

// Avança a sessão só se ela ainda estiver na etapa que a gente leu — duas mensagens seguidas do lead
// não podem pular duas etapas.
async function advance(admin: AdminClient, session: Session, patch: Partial<Session> & { status?: string }): Promise<boolean> {
  const { data } = await admin
    .from("chatbot_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", session.id)
    .eq("step_index", session.step_index)
    .eq("status", "ativo")
    .select("id");
  return Boolean(data && data.length);
}

async function finish(admin: AdminClient, instance: ChatbotInstance, phone: string, contactId: string, cfg: ChatbotConfig, answers: Record<string, string>, reason: "concluido" | "interrompido") {
  const contact = await reload(admin, contactId);
  if (cfg.finalMessage) await say(admin, instance, phone, contact, [cfg.finalMessage]);
  // Respondeu = sinal de interesse (mesma regra do número sem IA de sempre); só avança.
  if (canAdvanceStage(contact.stage as ContactStage, "interessado")) {
    await admin.from("contacts").update({ stage: "interessado", stage_changed_at: new Date().toISOString() }).eq("id", contactId);
  }
  const resumo = Object.entries(answers).map(([k, v]) => `${k} = ${v}`).join(" · ");
  await admin.from("contact_notes").insert({
    contact_id: contactId,
    workspace_id: instance.workspace_id,
    author_name: "Mensagens iniciais",
    content: reason === "concluido" ? `Atendimento inicial concluído${resumo ? `: ${resumo}` : "."}` : `Atendimento inicial encerrado sem todas as respostas${resumo ? ` (${resumo})` : ""}.`,
  });
  // Conversa na fila da equipe como "aberta".
  await admin.from("conversation_tickets").upsert(
    { workspace_id: instance.workspace_id, contact_id: contactId, agent_id: null, conversation_key: conversationKey(contactId, null), status: "aberto", status_changed_at: new Date().toISOString() },
    { onConflict: "workspace_id,conversation_key" }
  );
}

export async function handleChatbotInbound(admin: AdminClient, instance: ChatbotInstance, msg: ChatbotInbound): Promise<boolean> {
  const cfg = normalizeChatbotConfig(instance.chatbot);
  if (!cfg.enabled) return false;

  let contact = await findContact(admin, instance.workspace_id, msg.phone);

  // ── Primeiro contato: cria o lead e começa ──
  if (!contact) {
    const { data: created } = await admin
      .from("contacts")
      .insert({ workspace_id: instance.workspace_id, phone: msg.phone, name: msg.pushName, whatsapp_instance_id: instance.id })
      .select(CONTACT_COLUMNS)
      .single();
    if (!created) return false;
    contact = created as Contact;
    const { data: session } = await admin
      .from("chatbot_sessions")
      .insert({ workspace_id: instance.workspace_id, instance_id: instance.id, contact_id: contact.id, step_index: 0 })
      .select("id, step_index, retries, answers")
      .single();
    await saveInbound(admin, instance.workspace_id, contact.id, msg);
    if (!session) return true;
    const plan = planFrom(cfg.steps, 0);
    await say(admin, instance, msg.phone, contact, plan.texts);
    if (plan.waitingIndex === null) await finishAndClose(admin, instance, msg.phone, contact.id, cfg, session as Session, "concluido");
    else if (plan.waitingIndex !== 0) await admin.from("chatbot_sessions").update({ step_index: plan.waitingIndex }).eq("id", session.id);
    return true;
  }

  // ── Lead já existe: só é caso de bot se houver sessão ativa ──
  const { data: sessionRow } = await admin
    .from("chatbot_sessions")
    .select("id, step_index, retries, answers")
    .eq("instance_id", instance.id)
    .eq("contact_id", contact.id)
    .eq("status", "ativo")
    .maybeSingle();
  if (!sessionRow) return false;
  const session = sessionRow as Session;

  if (!(await saveInbound(admin, instance.workspace_id, contact.id, msg))) return true;

  if (msg.text && OPT_OUT_RE.test(msg.text)) {
    await admin.from("contacts").update({ opt_out_whatsapp: true }).eq("id", contact.id);
    await admin.from("chatbot_sessions").update({ status: "interrompido", updated_at: new Date().toISOString() }).eq("id", session.id);
    return true;
  }

  const step = cfg.steps[session.step_index];
  if (!step) {
    await finishAndClose(admin, instance, msg.phone, contact.id, cfg, session, "concluido");
    return true;
  }

  const answers = { ...(session.answers || {}) };
  let resolved = false; // etapa respondida (ou pulada) → vai pra próxima

  if (step.type === "question") {
    if (msg.text && msg.text.trim()) {
      const value = await saveFieldAnswer(admin, instance.workspace_id, contact, step.fieldKey, msg.text.trim());
      if (step.saveAsTag) await addTag(admin, await reload(admin, contact.id), value);
      answers[labelFor(step.fieldKey)] = value;
      resolved = true;
    } else if (session.retries < 1) {
      if (await advance(admin, session, { retries: session.retries + 1 })) {
        await say(admin, instance, msg.phone, contact, ["Consegue me escrever por mensagem de texto? 🙂"]);
      }
      return true;
    } else {
      resolved = true; // segunda mídia seguida: pula a pergunta
    }
  } else if (step.type === "menu") {
    const idx = msg.text ? parseMenuAnswer(msg.text, step.options) : null;
    if (idx === null) {
      if (session.retries < 1) {
        if (await advance(admin, session, { retries: session.retries + 1 })) {
          await say(admin, instance, msg.phone, contact, ["Não entendi 😅 responde com o número da opção, por favor."]);
        }
        return true;
      }
      // Segunda resposta que não bate: encerra e passa pra equipe.
      if (await advance(admin, session, { status: "interrompido" })) {
        await finish(admin, instance, msg.phone, contact.id, cfg, answers, "interrompido");
      }
      return true;
    }
    const option = step.options[idx];
    await addTag(admin, contact, option.tag);
    if (option.fieldKey && option.fieldValue) await saveFieldAnswer(admin, instance.workspace_id, await reload(admin, contact.id), option.fieldKey, option.fieldValue);
    if (option.stage) await moveStage(admin, await reload(admin, contact.id), option.stage);
    // Com mais de um menu, cada escolha fica registrada separada ("Escolha", "Escolha 2"…).
    const menuNumber = cfg.steps.slice(0, session.step_index + 1).filter((s) => s.type === "menu").length;
    answers[menuNumber > 1 ? `Escolha ${menuNumber}` : "Escolha"] = option.label;
    resolved = true;
  } else {
    resolved = true;
  }

  if (!resolved) return true;

  const plan = planFrom(cfg.steps, session.step_index + 1);
  const next = plan.waitingIndex === null ? cfg.steps.length : plan.waitingIndex;
  if (!(await advance(admin, session, { step_index: next, retries: 0, answers }))) return true;
  contact = await reload(admin, contact.id);
  await say(admin, instance, msg.phone, contact, plan.texts);
  if (plan.waitingIndex === null) {
    await admin.from("chatbot_sessions").update({ status: "concluido", updated_at: new Date().toISOString() }).eq("id", session.id);
    await finish(admin, instance, msg.phone, contact.id, cfg, answers, "concluido");
  }
  return true;
}

async function finishAndClose(admin: AdminClient, instance: ChatbotInstance, phone: string, contactId: string, cfg: ChatbotConfig, session: Session, reason: "concluido" | "interrompido") {
  await admin.from("chatbot_sessions").update({ status: reason, updated_at: new Date().toISOString() }).eq("id", session.id);
  await finish(admin, instance, phone, contactId, cfg, session.answers || {}, reason);
}

function labelFor(fieldKey: string): string {
  if (!fieldKey) return "Resposta";
  if (fieldKey === "nome") return "Nome";
  if (fieldKey === "email") return "E-mail";
  return fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1).replace(/_/g, " ");
}

// Chamado pelo envio manual: alguém da equipe respondeu, o bot sai da conversa.
export async function interruptChatbotForContact(supabase: { from: AdminClient["from"] }, contactId: string) {
  await supabase.from("chatbot_sessions").update({ status: "interrompido", updated_at: new Date().toISOString() }).eq("contact_id", contactId).eq("status", "ativo");
}
