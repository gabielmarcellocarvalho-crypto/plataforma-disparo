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
  // Documentos de escritório (planilha, texto, apresentação) — os formatos que o WhatsApp aceita como documento.
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "text/plain": "txt",
};

// Navegador (principalmente no Windows) às vezes entrega o arquivo sem tipo, ou como octet-stream, ou
// tipa .csv como "application/vnd.ms-excel". Quando o tipo não diz nada, vale a extensão do nome.
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME)
    .filter(([mime]) => mime !== "audio/webm")
    .map(([mime, ext]) => [ext, mime])
);
MIME_BY_EXT.pdf = "application/pdf";
MIME_BY_EXT.jpeg = "image/jpeg";

export function resolveFileMime(fileName: string, rawMime: string): string {
  const mime = normalizeMimetype(rawMime || "");
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") return "text/csv"; // o Windows tipa .csv como "vnd.ms-excel": mandado assim, chegaria como xls corrompido
  if (mime && mime !== "application/octet-stream") return mime;
  return MIME_BY_EXT[ext] || mime;
}

// Tipos que o bucket "conversation-media" aceita (allowlist configurada no próprio bucket, no Supabase).
// Espelhada aqui pra recusar antes de subir, com mensagem clara, em vez de o Storage devolver 4xx.
export const CONVERSATION_MEDIA_MIMES = new Set([...Object.keys(EXT_BY_MIME), "application/pdf"]);

// Mesma lista, pro campo de upload do navegador e pro `allowed_mime_types` do bucket.
export const CONVERSATION_MEDIA_ACCEPT = [...CONVERSATION_MEDIA_MIMES].join(",");

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
