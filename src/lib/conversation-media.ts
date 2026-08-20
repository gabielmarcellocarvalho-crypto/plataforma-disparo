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
  // WhatsApp manda áudio como "audio/ogg; codecs=opus" (com parâmetro) — o bucket compara mime type
  // exato contra a allowlist, então precisa normalizar (só "tipo/subtipo") antes de subir/checar extensão.
  const mimetype = rawMimetype.split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[mimetype] || mimetype.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  const path = `${workspaceId}/${contactId}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(base64, "base64");
  const { error } = await supabase.storage.from("conversation-media").upload(path, buffer, { contentType: mimetype, upsert: false });
  if (error) {
    console.error("Erro ao subir mídia da conversa:", error.message);
    return null;
  }
  const { data } = supabase.storage.from("conversation-media").getPublicUrl(path);
  return data.publicUrl;
}
