// Imagem do cabeçalho do template de uma campanha (ex.: convite de evento). O disparo registra na conversa
// o texto do template e um marcador com o link da imagem; quando o lead responde, o agente de IA lê o
// texto e enxerga a imagem (data, local e horário costumam estar só nela).
import type { AgentImage } from "@/lib/agent-reply";

const MARKER_RE = /\[Imagem do cabeçalho: (https:\/\/[^\]\s]+)\]/;
const MAX_BYTES = 5 * 1024 * 1024;

export function headerImageMarker(url: string): string {
  return `[Imagem do cabeçalho: ${url}]`;
}

// Link da imagem mais recente entre as mensagens (a última abertura enviada ao lead).
export function lastHeaderImageUrl(contents: string[]): string | null {
  for (let i = contents.length - 1; i >= 0; i--) {
    const m = contents[i].match(MARKER_RE);
    if (m) return m[1];
  }
  return null;
}

// Pro modelo: o link some e fica o aviso de que a imagem está anexada.
export function stripHeaderImageMarker(content: string): string {
  return content.replace(MARKER_RE, "[Imagem do convite enviada junto com essa mensagem: veja a imagem anexada]");
}

// Só baixa do armazenamento da própria plataforma (link vem do histórico, não de quem manda mensagem).
export async function fetchHeaderImage(url: string): Promise<AgentImage | null> {
  try {
    const allowed = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
    const u = new URL(url);
    if (!allowed || u.protocol !== "https:" || u.host !== allowed) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (mime !== "image/jpeg" && mime !== "image/png") return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return { base64: bytes.toString("base64"), mediaType: mime };
  } catch {
    return null;
  }
}
