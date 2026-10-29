// Mídia do cabeçalho de um template criado pela AutomaX. A Meta pede a mídia em CADA envio; guardamos o
// arquivo (bucket conversation-media) por template pra automações, follow-ups e conversas mandarem sozinhos.
import { createAdminClient } from "@/lib/supabase/admin";
import type { TemplateHeaderMedia } from "@/lib/metacloud";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function loadTemplateHeaderMedia(
  supabase: AdminClient,
  workspaceId: string,
  templateName: string,
  language: string
): Promise<TemplateHeaderMedia | null> {
  const { data } = await supabase
    .from("template_header_media")
    .select("format, media_path, media_name")
    .eq("workspace_id", workspaceId)
    .eq("template_name", templateName)
    .eq("language", language)
    .maybeSingle();
  if (!data) return null;
  const format = data.format as string;
  if (format !== "IMAGE" && format !== "DOCUMENT") return null;
  const { data: pub } = supabase.storage.from("conversation-media").getPublicUrl(data.media_path as string);
  return { format, url: pub.publicUrl, fileName: format === "DOCUMENT" ? ((data.media_name as string | null) || null) : null };
}
