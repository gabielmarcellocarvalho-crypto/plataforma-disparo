"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText, sendMedia } from "@/lib/evolution";
import { sendDialog360Text, sendDialog360Media } from "@/lib/dialog360";
import { sendMetaCloudText, sendMetaCloudMedia } from "@/lib/metacloud";
import { agentSendText, agentSendMedia } from "@/lib/agent-channel";
import { resolveAgentChannel } from "@/lib/agent-handoff";
import { CONVERSATION_MEDIA_MIMES, conversationMediaPath, normalizeMimetype } from "@/lib/conversation-media";

const MAX_MANUAL_FILE_BYTES = 20 * 1024 * 1024; // 20MB — folga sobre o limite do bucket (25MB) e do WhatsApp

function mediaKindFromMime(mime: string): "image" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export type ActionResult = { error: string | null; ok?: boolean };

// "Falha ao enviar" sozinho não diz à equipe o que fazer. O motivo mais comum em número oficial é a
// janela de 24h da Meta (erro 131047): passou um dia da última mensagem do cliente e só template
// entra. Quem está com a conversa aberta na tela precisa saber que o problema não é a plataforma.
function mensagemDeFalha(e: unknown): string {
  const detalhe = e instanceof Error ? e.message : String(e);
  if (detalhe.includes("131047") || /re-?engagement/i.test(detalhe)) {
    return "Passaram mais de 24h desde a última mensagem do contato — a Meta só aceita template agora. Use um disparo com template pra reabrir a conversa.";
  }
  return `Falha ao enviar pelo WhatsApp: ${detalhe.slice(0, 300)}`;
}

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
    supabase.from("agents").select("evolution_instance_name, whatsapp_instance_id").eq("id", agentId).maybeSingle(),
  ]);
  if (!contact || !agent) return { error: "Conversa não encontrada." };
  if (!contact.needs_attention) return { error: "Assuma a conversa antes de mandar mensagem manual." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  // O agente pode falar por Evolution OU por número oficial (360dialog/metacloud) — mesma resolução
  // que o agente de IA usa. Mandar direto pelo Evolution aqui quebrava toda conversa de agente em
  // número oficial, que é exatamente onde a equipe mais assume a conversa na mão.
  const channel = await resolveAgentChannel(createAdminClient(), agent);
  if (!channel) return { error: "Esse agente não tem número de WhatsApp configurado." };

  try {
    await agentSendText(channel, contact.phone, trimmed);
  } catch (e) {
    return { error: mensagemDeFalha(e) };
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

// Arquivo que o navegador já subiu direto pro Storage (via prepareManualUpload) — o envio manual só
// recebe o caminho, nunca os bytes.
export type ManualUpload = { path: string; fileName: string; mimeType: string };

// O arquivo NÃO passa pelo server action: na Vercel, o corpo de qualquer requisição à função é cortado
// em ~4,5MB antes do nosso código rodar (o bodySizeLimit do next.config não vence esse teto), e o
// navegador recebia um 413 que derrubava a tela inteira ("This page couldn't load"). Aqui só se gera
// uma URL assinada de upload; o navegador sobe o arquivo direto pro bucket e depois chama o envio.
export async function prepareManualUpload(
  contactId: string,
  fileName: string,
  rawMimeType: string,
  size: number
): Promise<{ error: string | null; path?: string; token?: string }> {
  if (!size) return { error: "Selecione um arquivo." };
  if (size > MAX_MANUAL_FILE_BYTES) return { error: "Arquivo maior que 20MB." };
  const mimeType = normalizeMimetype(rawMimeType || "");
  if (!CONVERSATION_MEDIA_MIMES.has(mimeType)) {
    return { error: `Tipo de arquivo não suportado (${fileName}). Envie imagem, áudio ou PDF.` };
  }

  // Cliente com a sessão do usuário: a RLS garante que ele só prepara upload pra contato do próprio workspace.
  const supabase = await createClient();
  const { data: contact } = await supabase.from("contacts").select("id, workspace_id").eq("id", contactId).maybeSingle();
  if (!contact) return { error: "Conversa não encontrada." };

  const admin = createAdminClient();
  const path = conversationMediaPath(contact.workspace_id, contactId, mimeType);
  const { data, error } = await admin.storage.from("conversation-media").createSignedUploadUrl(path);
  if (error || !data) return { error: "Não foi possível preparar o envio do arquivo." };
  return { error: null, path: data.path, token: data.token };
}

// Confere que o arquivo é DESTE contato (prefixo <workspace>/<contato>/) antes de mandar pro WhatsApp —
// sem isso, um caminho forjado mandaria arquivo de outro cliente pra qualquer número.
function resolveUploadedMedia(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  contactId: string,
  upload: ManualUpload
): { error: string } | { url: string; kind: "image" | "audio" | "document"; fileName: string } {
  const prefix = `${workspaceId}/${contactId}/`;
  if (!upload?.path || !upload.path.startsWith(prefix) || upload.path.includes("..")) {
    return { error: "Arquivo inválido." };
  }
  const { data } = admin.storage.from("conversation-media").getPublicUrl(upload.path);
  const fileName = String(upload.fileName || "arquivo").slice(0, 200);
  return { url: data.publicUrl, kind: mediaKindFromMime(normalizeMimetype(upload.mimeType || "")), fileName };
}

// Envia áudio gravado ou arquivo anexado manualmente (equipe respondendo ao vivo) numa conversa com
// agente de IA — mesma trava de sendManualMessage (só com a conversa assumida).
export async function sendManualMedia(contactId: string, agentId: string, upload: ManualUpload): Promise<ActionResult> {
  const supabase = await createClient();
  const [{ data: contact }, { data: agent }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id, needs_attention").eq("id", contactId).maybeSingle(),
    supabase.from("agents").select("evolution_instance_name, whatsapp_instance_id").eq("id", agentId).maybeSingle(),
  ]);
  if (!contact || !agent) return { error: "Conversa não encontrada." };
  if (!contact.needs_attention) return { error: "Assuma a conversa antes de mandar mensagem manual." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  const admin = createAdminClient();
  const channel = await resolveAgentChannel(admin, agent);
  if (!channel) return { error: "Esse agente não tem número de WhatsApp configurado." };

  const media = resolveUploadedMedia(admin, contact.workspace_id, contactId, upload);
  if ("error" in media) return { error: media.error };

  try {
    await agentSendMedia(channel, contact.phone, media.url, { mediatype: media.kind, fileName: media.fileName });
  } catch (e) {
    return { error: mensagemDeFalha(e) };
  }

  await supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    agent_id: agentId,
    role: "assistant",
    content: `[arquivo enviado: ${media.fileName}]`,
    media_url: media.url,
    media_type: media.kind,
  });

  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Envio manual pro fluxo SEM agente de IA (número de disparo avulso) — diferente de sendManualMessage,
// não existe "agente pausado" pra assumir/devolver, então não tem trava de needs_attention: é sempre
// um humano respondendo. Escolhe o canal certo (Evolution, 360dialog ou Meta direta) pela whatsapp_instances.
export async function sendInstanceMessage(contactId: string, instanceId: string, text: string): Promise<ActionResult> {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Mensagem vazia." };

  const supabase = await createClient();
  const [{ data: contact }, { data: instance }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id").eq("id", contactId).maybeSingle(),
    supabase.from("whatsapp_instances").select("channel, instance_name, dialog360_api_key, phone_number_id").eq("id", instanceId).maybeSingle(),
  ]);
  if (!contact || !instance) return { error: "Conversa não encontrada." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  try {
    if (instance.channel === "360dialog") {
      if (!instance.dialog360_api_key) return { error: "Esse número ainda não tem a API key do 360dialog configurada." };
      await sendDialog360Text(instance.dialog360_api_key, contact.phone, trimmed);
    } else if (instance.channel === "metacloud") {
      if (!instance.phone_number_id) return { error: "Esse número ainda não tem o phone_number_id da Meta configurado." };
      await sendMetaCloudText(instance.phone_number_id, contact.phone, trimmed);
    } else {
      if (!instance.instance_name) return { error: "Esse número ainda não tem a instância Evolution configurada." };
      await sendText(instance.instance_name, contact.phone, trimmed);
    }
  } catch (e) {
    return { error: mensagemDeFalha(e) };
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
// (Evolution, 360dialog ou Meta direta) que sendInstanceMessage já faz pra texto. API oficial só
// entrega mídia dentro da janela de 24h (mesma regra de texto livre); fora da janela, a Meta rejeita.
export async function sendInstanceMedia(contactId: string, instanceId: string, upload: ManualUpload): Promise<ActionResult> {
  const supabase = await createClient();
  const [{ data: contact }, { data: instance }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id").eq("id", contactId).maybeSingle(),
    supabase.from("whatsapp_instances").select("channel, instance_name, dialog360_api_key, phone_number_id").eq("id", instanceId).maybeSingle(),
  ]);
  if (!contact || !instance) return { error: "Conversa não encontrada." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  const admin = createAdminClient();
  const media = resolveUploadedMedia(admin, contact.workspace_id, contactId, upload);
  if ("error" in media) return { error: media.error };
  const { url: mediaUrl, kind, fileName } = media;

  try {
    if (instance.channel === "360dialog") {
      if (!instance.dialog360_api_key) return { error: "Esse número ainda não tem a API key do 360dialog configurada." };
      await sendDialog360Media(instance.dialog360_api_key, contact.phone, kind, mediaUrl, undefined, fileName);
    } else if (instance.channel === "metacloud") {
      if (!instance.phone_number_id) return { error: "Esse número ainda não tem o phone_number_id da Meta configurado." };
      await sendMetaCloudMedia(instance.phone_number_id, contact.phone, kind, mediaUrl, undefined, fileName);
    } else {
      if (!instance.instance_name) return { error: "Esse número ainda não tem a instância Evolution configurada." };
      await sendMedia(instance.instance_name, contact.phone, mediaUrl, { mediatype: kind, fileName });
    }
  } catch (e) {
    return { error: mensagemDeFalha(e) };
  }

  await supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    agent_id: null,
    role: "assistant",
    content: `[arquivo enviado: ${fileName}]`,
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
