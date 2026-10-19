// Origem do lead: de onde ele veio (campanha da Meta, API, WhatsApp direto). A origem fica em
// custom_fields.origem, gravada por quem criou o lead:
//   - "Anúncio Meta": clicou num anúncio Click-to-WhatsApp (src/lib/ad-referral.ts), com ctwa_at;
//   - "Facebook": formulário do Facebook Leads (webhook da integração), com a campanha em campanha_meta;
//   - o `source` de quem chamou POST /api/v1/leads (padrão "api").
// Lead sem origem gravada escreveu direto no WhatsApp ou foi importado.

export const META_ORIGINS = ["Anúncio Meta", "Facebook"] as const;

type OriginInput = { custom_fields?: Record<string, unknown> | null; ctwa_at?: string | null };

// Veio de campanha paga da Meta (anúncio Click-to-WhatsApp ou formulário do Facebook Leads).
export function isMetaCampaignLead(c: OriginInput): boolean {
  if (c.ctwa_at) return true;
  const f = c.custom_fields || {};
  const origem = typeof f.origem === "string" ? f.origem.trim() : "";
  if ((META_ORIGINS as readonly string[]).includes(origem)) return true;
  return Boolean(f.anuncio_titulo || f.anuncio_link || f.campanha_meta);
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

// Origem detalhada pra API de leitura: source, UTMs (qualquer campo utm_*), tags e campanha da Meta.
export function leadOriginDetail(c: OriginInput & { tags?: string[] | null }) {
  const f = c.custom_fields || {};
  const utms: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    const s = str(v);
    if (s && /^utm_/i.test(k)) utms[k.toLowerCase()] = s;
  }
  return {
    source: str(f.origem) ?? (c.ctwa_at ? "Anúncio Meta" : "WhatsApp direto"),
    campanha_meta: isMetaCampaignLead(c),
    utms,
    tags: c.tags ?? [],
    facebook_campanha: str(f.campanha_meta),
    facebook_anuncio: str(f.anuncio_meta) ?? str(f.anuncio_titulo),
    facebook_formulario: str(f.formulario_meta),
  };
}
