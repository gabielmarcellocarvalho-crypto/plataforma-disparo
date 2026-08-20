"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText, sendMedia } from "@/lib/evolution";
import { sendDialog360Text, sendDialog360Media } from "@/lib/dialog360";
import { uploadConversationMedia } from "@/lib/conversation-media";

const MAX_MANUAL_FILE_BYTES = 20 * 1024 * 1024; // 20MB — folga sobre o limite do bucket (25MB) e do WhatsApp

function mediaKindFromMime(mime: string): "image" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export type ActionResult = { error: string | null; ok?: boolean };

// Humano assume a conversa manualmente — agente para de responder esse contato até "devolver".
export async function takeOverConversation(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ needs_attention: true, attention_reason: "Conversa assumida manualmente." })
    .eq("id", contactId);
  if (error) return { error: "Não foi possível assumir a conversa." };
  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Devolve a conversa pro agente — mesma ação usada no painel de "precisa de atenção".
export async function resolveAttention(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ needs_attention: false, attention_reason: null })
    .eq("id", contactId);
  if (error) return { error: "Não foi possível devolver a conversa pro agente." };
  revalidatePath("/conversas");
  revalidatePath("/agentes");
  return { error: null, ok: true };
}

// Dispensa o alerta "pode precisar de atenção" (flagged_reason) sem mexer em needs_attention —
// o agente continua respondendo normalmente, isso só limpa o aviso na UI.
export async function dismissFlag(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").update({ flagged_reason: null }).eq("id", contactId);
  if (error) return { error: "Não foi possível dispensar o alerta." };
  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Apaga o histórico de mensagens desse contato com esse agente — é isso que vira contexto/"cache"
// mandado pro modelo a cada resposta. Útil pra testar do zero sem o agente carregar conversa antiga.
export async function clearConversationHistory(contactId: string, agentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("messages").delete().eq("contact_id", contactId).eq("agent_id", agentId);
  if (error) return { error: "Não foi possível limpar o histórico." };

  await supabase.from("contacts").update({ needs_attention: false, attention_reason: null }).eq("id", contactId);

  revalidatePath("/conversas");
  revalidatePath("/agentes");
  return { error: null, ok: true };
}

// Envio manual — só funciona com a conversa assumida (needs_attention = true), pra não brigar com o agente.
export async function sendManualMessage(contactId: string, agentId: string, text: string): Promise<ActionResult> {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Mensagem vazia." };

  const supabase = await createClient();
  const [{ data: contact }, { data: agent }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id, needs_attention").eq("id", contactId).maybeSingle(),
    supabase.from("agents").select("evolution_instance_name").eq("id", agentId).maybeSingle(),
  ]);
  if (!contact || !agent) return { error: "Conversa não encontrada." };
  if (!contact.needs_attention) return { error: "Assuma a conversa antes de mandar mensagem manual." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  try {
    await sendText(agent.evolution_instance_name, contact.phone, trimmed);
  } catch {
    return { error: "Falha ao enviar pelo WhatsApp." };
  }

  await supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    agent_id: agentId,
    role: "assistant",
    content: trimmed,
  });

  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Envia áudio gravado ou arquivo anexado manualmente (equipe respondendo ao vivo) numa conversa com
// agente de IA — mesma trava de sendManualMessage (só com a conversa assumida).
export async function sendManualMedia(contactId: string, agentId: string, formData: FormData): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Selecione um arquivo." };
  if (file.size > MAX_MANUAL_FILE_BYTES) return { error: "Arquivo maior que 20MB." };

  const supabase = await createClient();
  const [{ data: contact }, { data: agent }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id, needs_attention").eq("id", contactId).maybeSingle(),
    supabase.from("agents").select("evolution_instance_name").eq("id", agentId).maybeSingle(),
  ]);
  if (!contact || !agent) return { error: "Conversa não encontrada." };
  if (!contact.needs_attention) return { error: "Assuma a conversa antes de mandar mensagem manual." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  const admin = createAdminClient();
  const kind = mediaKindFromMime(file.type);
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mediaUrl = await uploadConversationMedia(admin, contact.workspace_id, contactId, base64, file.type || "application/octet-stream");
  if (!mediaUrl) return { error: "Falha ao subir o arquivo." };

  try {
    await sendMedia(agent.evolution_instance_name, contact.phone, mediaUrl, { mediatype: kind, fileName: file.name });
  } catch {
    return { error: "Falha ao enviar pelo WhatsApp." };
  }

  await supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    agent_id: agentId,
    role: "assistant",
    content: `[arquivo enviado: ${file.name}]`,
    media_url: mediaUrl,
    media_type: kind,
  });

  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Envio manual pro fluxo SEM agente de IA (número de disparo avulso) — diferente de sendManualMessage,
// não existe "agente pausado" pra assumir/devolver, então não tem trava de needs_attention: é sempre
// um humano respondendo. Escolhe o canal certo (Evolution ou 360dialog) pela whatsapp_instances.
export async function sendInstanceMessage(contactId: string, instanceId: string, text: string): Promise<ActionResult> {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Mensagem vazia." };

  const supabase = await createClient();
  const [{ data: contact }, { data: instance }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id").eq("id", contactId).maybeSingle(),
    supabase.from("whatsapp_instances").select("channel, instance_name, dialog360_api_key").eq("id", instanceId).maybeSingle(),
  ]);
  if (!contact || !instance) return { error: "Conversa não encontrada." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  try {
    if (instance.channel === "360dialog") {
      if (!instance.dialog360_api_key) return { error: "Esse número ainda não tem a API key do 360dialog configurada." };
      await sendDialog360Text(instance.dialog360_api_key, contact.phone, trimmed);
    } else {
      if (!instance.instance_name) return { error: "Esse número ainda não tem a instância Evolution configurada." };
      await sendText(instance.instance_name, contact.phone, trimmed);
    }
  } catch {
    return { error: "Falha ao enviar pelo WhatsApp." };
  }

  await supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    agent_id: null,
    role: "assistant",
    content: trimmed,
  });

  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Equivalente a sendManualMedia, mas pro fluxo sem agente (disparo avulso) — mesma escolha de canal
// (Evolution ou 360dialog) que sendInstanceMessage já faz pra texto. 360dialog só entrega mídia
// dentro da janela de 24h (mesma regra de texto livre); fora da janela, a Meta rejeita.
export async function sendInstanceMedia(contactId: string, instanceId: string, formData: FormData): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Selecione um arquivo." };
  if (file.size > MAX_MANUAL_FILE_BYTES) return { error: "Arquivo maior que 20MB." };

  const supabase = await createClient();
  const [{ data: contact }, { data: instance }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id").eq("id", contactId).maybeSingle(),
    supabase.from("whatsapp_instances").select("channel, instance_name, dialog360_api_key").eq("id", instanceId).maybeSingle(),
  ]);
  if (!contact || !instance) return { error: "Conversa não encontrada." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  const admin = createAdminClient();
  const kind = mediaKindFromMime(file.type);
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mediaUrl = await uploadConversationMedia(admin, contact.workspace_id, contactId, base64, file.type || "application/octet-stream");
  if (!mediaUrl) return { error: "Falha ao subir o arquivo." };

  try {
    if (instance.channel === "360dialog") {
      if (!instance.dialog360_api_key) return { error: "Esse número ainda não tem a API key do 360dialog configurada." };
      await sendDialog360Media(instance.dialog360_api_key, contact.phone, kind, mediaUrl);
    } else {
      if (!instance.instance_name) return { error: "Esse número ainda não tem a instância Evolution configurada." };
      await sendMedia(instance.instance_name, contact.phone, mediaUrl, { mediatype: kind, fileName: file.name });
    }
  } catch {
    return { error: "Falha ao enviar pelo WhatsApp." };
  }

  await supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    agent_id: null,
    role: "assistant",
    content: `[arquivo enviado: ${file.name}]`,
    media_url: mediaUrl,
    media_type: kind,
  });

  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Equivalente a clearConversationHistory, mas pro fluxo sem agente (agent_id IS NULL nessa conversa).
export async function clearInstanceConversationHistory(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("messages").delete().eq("contact_id", contactId).is("agent_id", null);
  if (error) return { error: "Não foi possível limpar o histórico." };
  revalidatePath("/conversas");
  return { error: null, ok: true };
}
