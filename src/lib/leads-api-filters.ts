// Filtros da API de leitura (GET /api/v1/leads e /api/v1/funil): o dashboard pede só a fatia que quer —
// "só leads da Meta", "só a tag Feira", "só SQLs da campanha X". Aqui os parâmetros da URL viram uma lista
// de condições (sem banco, pra dar pra testar); a rota aplica cada uma na consulta.
//
// Valor que vem da URL nunca entra num .or() montado à mão: só nos filtros simples (eq/ilike/overlaps/in),
// que o cliente do Supabase codifica. Os .or() abaixo são texto fixo.
import { GOOGLE_CLICK_IDS, META_ORIGINS } from "@/lib/lead-origin";
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import { normalizeTags } from "@/lib/contact-tags";
import { QUAL_LEVELS, type QualConfig } from "@/lib/lead-qualification";

export type LeadFilterOp =
  | { op: "eq"; col: string; val: string }
  | { op: "ilike"; col: string; val: string }
  | { op: "is_null"; col: string }
  | { op: "or"; expr: string }
  | { op: "overlaps"; col: string; val: string[] }
  | { op: "in"; col: string; val: string[] };

export type LeadFilters = {
  origem: string | null;
  tags: string[];
  etapas: ContactStage[] | null;
  resultado: "ganho" | "perdido" | "aberto" | null;
  qualificacao: string | null;
  campanha: string | null;
  utms: Record<string, string>;
};

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const QUAL_VALUES = [...QUAL_LEVELS, "cliente", "perdido"] as const;
const META_LIST = `(${META_ORIGINS.map((o) => `"${o}"`).join(",")})`;
// Mesma regra de isMetaCampaignLead (src/lib/lead-origin.ts), escrita como filtro do banco.
const META_MARKERS = ["campanha_meta", "anuncio_titulo", "anuncio_link"];
const META_OR = ["ctwa_at.not.is.null", `custom_fields->>origem.in.${META_LIST}`, ...META_MARKERS.map((k) => `custom_fields->>${k}.not.is.null`)].join(",");

// Mesma regra de isGoogleAdsLead (src/lib/lead-origin.ts): id de clique do Google, utm_source do Google
// ou origem com "google".
const GOOGLE_OR = [
  ...GOOGLE_CLICK_IDS.map((k) => `custom_fields->>${k}.not.is.null`),
  "custom_fields->>utm_source.ilike.*google*",
  "custom_fields->>utm_source.ilike.*adwords*",
  "custom_fields->>origem.ilike.*google*",
].join(",");

export function parseLeadFilters(params: URLSearchParams): { filters: LeadFilters } | { error: string } {
  const get = (k: string) => params.get(k)?.trim() || "";

  let etapas: ContactStage[] | null = null;
  const etapaRaw = get("etapa");
  if (etapaRaw) {
    const list = etapaRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const invalid = list.filter((s) => !(STAGE_ORDER as string[]).includes(s));
    if (invalid.length) return { error: `etapa inválida: ${invalid.join(", ")}. Use: ${STAGE_ORDER.join(", ")}.` };
    etapas = list as ContactStage[];
  }

  const resultado = get("resultado");
  if (resultado && !["ganho", "perdido", "aberto"].includes(resultado)) return { error: "resultado precisa ser ganho, perdido ou aberto." };

  const qualificacao = get("qualificacao");
  if (qualificacao && !(QUAL_VALUES as readonly string[]).includes(qualificacao)) {
    return { error: `qualificacao precisa ser ${QUAL_VALUES.join(", ")}.` };
  }

  const utms: Record<string, string> = {};
  for (const k of UTM_KEYS) if (get(k)) utms[k] = get(k);

  return {
    filters: {
      origem: get("origem") || null,
      tags: normalizeTags(get("tag")),
      etapas,
      resultado: (resultado || null) as LeadFilters["resultado"],
      qualificacao: qualificacao || null,
      campanha: get("campanha") || null,
      utms,
    },
  };
}

// Texto igual sem diferenciar maiúscula; com caractere curinga no valor, cai pra igualdade exata (o
// curinga do usuário não pode virar "qualquer coisa").
function sameText(col: string, val: string): LeadFilterOp {
  return /[%_*\\]/.test(val) ? { op: "eq", col, val } : { op: "ilike", col, val };
}

// Etapas que passam no nível pedido, pelas regras de MQL/SQL do workspace (mesma leitura de classifyLead).
function stagesForLevel(level: string, cfg: QualConfig): ContactStage[] {
  if (level === "cliente") return ["concluido"];
  if (level === "perdido") return ["descartado"];
  const c = cfg[level as (typeof QUAL_LEVELS)[number]];
  if (!c?.enabled) return [];
  const from = STAGE_ORDER.indexOf(c.stage);
  return STAGE_ORDER.filter((s) => s !== "descartado" && STAGE_ORDER.indexOf(s) >= from);
}

// `tagsDoWorkspace`: pra achar a tag com a grafia gravada ("feira" encontra "Feira").
export function leadFilterOps(f: LeadFilters, cfg: QualConfig, tagsDoWorkspace: string[] = []): LeadFilterOp[] {
  const ops: LeadFilterOp[] = [];

  const origem = f.origem?.toLowerCase();
  if (origem === "meta") ops.push({ op: "or", expr: META_OR });
  else if (origem === "google_ads" || origem === "google") ops.push({ op: "or", expr: GOOGLE_OR });
  else if (origem === "nao_meta" || origem === "whatsapp_direto") {
    ops.push({ op: "is_null", col: "ctwa_at" });
    for (const k of META_MARKERS) ops.push({ op: "is_null", col: `custom_fields->>${k}` });
    if (origem === "whatsapp_direto") {
      ops.push({ op: "is_null", col: "custom_fields->>origem" });
      for (const k of GOOGLE_CLICK_IDS) ops.push({ op: "is_null", col: `custom_fields->>${k}` });
      ops.push({ op: "is_null", col: "custom_fields->>utm_source" });
    }
    else ops.push({ op: "or", expr: `custom_fields->>origem.is.null,custom_fields->>origem.not.in.${META_LIST}` });
  } else if (f.origem) ops.push(sameText("custom_fields->>origem", f.origem));

  if (f.tags.length) {
    const byKey = new Map(tagsDoWorkspace.map((t) => [t.toLowerCase(), t]));
    ops.push({ op: "overlaps", col: "tags", val: f.tags.map((t) => byKey.get(t.toLowerCase()) ?? t) });
  }

  // Etapa, resultado e qualificação restringem a mesma coluna: vale a interseção dos três.
  let stages: ContactStage[] | null = f.etapas;
  const narrow = (allowed: ContactStage[]) => {
    stages = (stages ?? STAGE_ORDER).filter((s) => allowed.includes(s));
  };
  if (f.resultado === "ganho") narrow(["concluido"]);
  if (f.resultado === "perdido") narrow(["descartado"]);
  if (f.resultado === "aberto") narrow(STAGE_ORDER.filter((s) => s !== "concluido" && s !== "descartado"));
  if (f.qualificacao) narrow(stagesForLevel(f.qualificacao, cfg));
  if (stages) ops.push({ op: "in", col: "stage", val: stages });

  if (f.campanha) ops.push(sameText("custom_fields->>campanha_meta", f.campanha));
  for (const [k, v] of Object.entries(f.utms)) ops.push(sameText(`custom_fields->>${k}`, v));
  return ops;
}

// Aplica as condições numa consulta do Supabase (qualquer select de contacts).
type Filterable<Q> = {
  eq(col: string, val: string): Q;
  ilike(col: string, val: string): Q;
  is(col: string, val: null): Q;
  or(expr: string): Q;
  overlaps(col: string, val: string[]): Q;
  in(col: string, val: string[]): Q;
};
export function applyLeadFilterOps<Q extends Filterable<Q>>(q: Q, ops: LeadFilterOp[]): Q {
  for (const o of ops) {
    if (o.op === "eq") q = q.eq(o.col, o.val);
    else if (o.op === "ilike") q = q.ilike(o.col, o.val);
    else if (o.op === "is_null") q = q.is(o.col, null);
    else if (o.op === "or") q = q.or(o.expr);
    else if (o.op === "overlaps") q = q.overlaps(o.col, o.val);
    // Lista vazia (filtros que não se cruzam, ex.: resultado=ganho&etapa=abordado) = nenhum lead.
    else q = q.in(o.col, o.val.length ? o.val : ["__nenhum__"]);
  }
  return q;
}

// Filtros que vieram, pra devolver na resposta (quem integra confere o que foi aplicado).
export function describeFilters(f: LeadFilters) {
  const out: Record<string, string | string[]> = {};
  if (f.origem) out.origem = f.origem;
  if (f.tags.length) out.tag = f.tags;
  if (f.etapas) out.etapa = f.etapas;
  if (f.resultado) out.resultado = f.resultado;
  if (f.qualificacao) out.qualificacao = f.qualificacao;
  if (f.campanha) out.campanha = f.campanha;
  Object.assign(out, f.utms);
  return out;
}
