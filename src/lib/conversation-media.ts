import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/aac": "aac",
};

// Tipos que o bucket "conversation-media" aceita (allowlist configurada no próprio bucket, no Supabase).
// Espelhada aqui pra recusar antes de subir, com mensagem clara, em vez de o Storage devolver 4xx.
export const CONVERSATION_MEDIA_MIMES = new Set([...Object.keys(EXT_BY_MIME), "application/pdf"]);

// WhatsApp (e o MediaRecorder do navegador) manda áudio como "audio/ogg; codecs=opus", com parâmetro —
// o bucket compara mime type exato contra a allowlist, então precisa normalizar pra "tipo/subtipo".
export function normalizeMimetype(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase();
}

// Caminho do arquivo no bucket: sempre sob <workspace>/<contato>/ — é esse prefixo que o envio manual
// confere antes de mandar um arquivo pro WhatsApp de alguém.
export function conversationMediaPath(workspaceId: string, contactId: string, mimetype: string): string {
  const ext = EXT_BY_MIME[mimetype] || mimetype.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  return `${workspaceId}/${contactId}/${crypto.randomUUID()}.${ext}`;
}

// Sobe áudio/imagem recebido do contato pro bucket público "conversation-media", pra a tela de
// Conversas conseguir tocar/mostrar depois (antes disso a mídia só era usada na hora — transcrição ou
// visão pontual — e descartada). Best-effort: se falhar, a conversa continua funcionando normalmente,
// só sem o preview visual dessa mensagem específica.
export async function uploadConversationMedia(
  supabase: AdminClient,
  workspaceId: string,
  contactId: string,
  base64: string,
  rawMimetype: string
): Promise<string | null> {
  const mimetype = normalizeMimetype(rawMimetype);
  const path = conversationMediaPath(workspaceId, contactId, mimetype);
  const buffer = Buffer.from(base64, "base64");
  const { error } = await supabase.storage.from("conversation-media").upload(path, buffer, { contentType: mimetype, upsert: false });
  if (error) {
    console.error("Erro ao subir mídia da conversa:", error.message);
    return null;
  }
  const { data } = supabase.storage.from("conversation-media").getPublicUrl(path);
  return data.publicUrl;
}
