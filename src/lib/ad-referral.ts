import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Origem de um lead que clicou num anúncio Click-to-WhatsApp. A Meta manda no `referral` da 1ª mensagem
// o título, o texto e o link do anúncio; a mensagem pré-pronta ("quero esse produto") não diz qual.
export type AdReferral = { headline: string; body: string; sourceUrl: string; sourceType: string };

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseReferral(raw: unknown): AdReferral | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ad = { headline: clip(r.headline, 200), body: clip(r.body, 500), sourceUrl: clip(r.source_url, 300), sourceType: clip(r.source_type, 20) };
  return ad.headline || ad.body || ad.sourceUrl ? ad : null;
}

const KEYS = ["anuncio_titulo", "anuncio_texto", "anuncio_link"] as const;

// Grava a origem no contato (custom_fields) e marca o início da janela grátis de 72h. Roda só depois de o
// contato existir. O anúncio mais recente vence: quem volta por outro anúncio troca o produto de interesse.
export async function saveAdReferral(supabase: AdminClient, contactId: string, ad: AdReferral | null): Promise<Record<string, unknown> | null> {
  const patch: Record<string, unknown> = { ctwa_at: new Date().toISOString() };
  let merged: Record<string, unknown> | null = null;
  if (ad) {
    const { data } = await supabase.from("contacts").select("custom_fields").eq("id", contactId).maybeSingle();
    merged = { ...((data?.custom_fields as Record<string, unknown>) || {}) };
    for (const k of KEYS) delete merged[k];
    if (ad.headline) merged.anuncio_titulo = ad.headline;
    if (ad.body) merged.anuncio_texto = ad.body;
    if (ad.sourceUrl) merged.anuncio_link = ad.sourceUrl;
    patch.custom_fields = merged;
  }
  await supabase.from("contacts").update(patch).eq("id", contactId);
  return merged;
}

// Aviso pro agente: sem isso ele pergunta "qual produto?" a quem acabou de clicar no anúncio dele.
export function adContextNote(customFields: Record<string, unknown> | null | undefined): string {
  const f = customFields || {};
  const titulo = typeof f.anuncio_titulo === "string" ? f.anuncio_titulo : "";
  const texto = typeof f.anuncio_texto === "string" ? f.anuncio_texto : "";
  const link = typeof f.anuncio_link === "string" ? f.anuncio_link : "";
  if (!titulo && !texto && !link) return "";
  const partes = [titulo && `título "${titulo}"`, texto && `texto "${texto}"`, link && `link ${link}`].filter(Boolean).join("; ");
  return (
    ` O cliente chegou clicando num anúncio seu (${partes}). Se a mensagem dele for genérica ("quero esse produto", "tenho interesse"), ` +
    "o produto é o do anúncio: não pergunte do zero qual produto. Identifique-o pelo anúncio (use a ferramenta de consultar produto, se tiver), " +
    "confirme em uma frase e siga. Se o anúncio não deixar claro qual é, aí sim pergunte."
  );
}
