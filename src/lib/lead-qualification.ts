// Classificação do lead pra dashboard/BI (lead → MQL → SQL → oportunidade → cliente). Cada cliente
// diz a partir de qual etapa do funil o lead vira MQL, SQL e oportunidade, e desliga o nível que não
// usa (quem não trabalha com SQL desmarca). Mesma leitura cumulativa do funil da Visão geral: conta
// quem está na etapa ou já passou dela. Cliente = ganho (concluído); perdido fica fora dos níveis,
// porque não guardamos até onde ele chegou antes de ser descartado.
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";

export const QUAL_LEVELS = ["mql", "sql", "oportunidade"] as const;
export type QualLevel = (typeof QUAL_LEVELS)[number];
export type QualConfig = Record<QualLevel, { enabled: boolean; stage: ContactStage }>;

export const QUAL_LABELS: Record<QualLevel, string> = { mql: "MQL", sql: "SQL", oportunidade: "Oportunidade" };

// Etapas que podem marcar um nível: as do meio do funil (não abordado é a entrada; perdido não é avanço).
export const QUAL_STAGE_OPTIONS: ContactStage[] = ["abordado", "interessado", "encaminhamento", "fechando_proposta", "concluido"];

export const DEFAULT_QUALIFICATION: QualConfig = {
  mql: { enabled: true, stage: "interessado" },
  sql: { enabled: true, stage: "encaminhamento" },
  oportunidade: { enabled: true, stage: "fechando_proposta" },
};

const rank = (s: ContactStage) => STAGE_ORDER.indexOf(s);

export function resolveQualification(raw: unknown): QualConfig {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as QualConfig;
  for (const level of QUAL_LEVELS) {
    const item = src[level] && typeof src[level] === "object" ? (src[level] as Record<string, unknown>) : {};
    const stage = QUAL_STAGE_OPTIONS.includes(item.stage as ContactStage) ? (item.stage as ContactStage) : DEFAULT_QUALIFICATION[level].stage;
    const enabled = typeof item.enabled === "boolean" ? item.enabled : DEFAULT_QUALIFICATION[level].enabled;
    out[level] = { enabled, stage };
  }
  return out;
}

// Os níveis ligados precisam subir no funil (MQL antes de SQL, SQL antes de oportunidade).
export function validateQualification(cfg: QualConfig): string | null {
  const on = QUAL_LEVELS.filter((l) => cfg[l].enabled);
  for (let i = 1; i < on.length; i++) {
    if (rank(cfg[on[i]].stage) <= rank(cfg[on[i - 1]].stage)) {
      return `${QUAL_LABELS[on[i]]} precisa começar numa etapa depois de ${QUAL_LABELS[on[i - 1]]}.`;
    }
  }
  return null;
}

export type LeadQualification = { nivel: "lead" | QualLevel | "cliente" | "perdido" } & Partial<Record<QualLevel | "cliente", boolean>>;

export function classifyLead(stage: ContactStage, cfg: QualConfig): LeadQualification {
  if (stage === "descartado") {
    const out: LeadQualification = { nivel: "perdido", cliente: false };
    for (const l of QUAL_LEVELS) if (cfg[l].enabled) out[l] = false;
    return out;
  }
  const out: LeadQualification = { nivel: "lead" };
  for (const l of QUAL_LEVELS) {
    if (!cfg[l].enabled) continue;
    out[l] = rank(stage) >= rank(cfg[l].stage);
    if (out[l]) out.nivel = l;
  }
  out.cliente = stage === "concluido";
  if (out.cliente) out.nivel = "cliente";
  return out;
}

// Totais do funil a partir da contagem por etapa: cada nível soma as etapas do limite dele em diante
// (sem contar perdidos). Nível desligado não aparece.
export function funnelTotals(byStage: Partial<Record<ContactStage, number>>, cfg: QualConfig) {
  const n = (s: ContactStage) => byStage[s] ?? 0;
  const ativos = STAGE_ORDER.filter((s) => s !== "descartado");
  const out: Record<string, number> = { leads: STAGE_ORDER.reduce((sum, s) => sum + n(s), 0) };
  for (const l of QUAL_LEVELS) {
    if (!cfg[l].enabled) continue;
    out[l] = ativos.filter((s) => rank(s) >= rank(cfg[l].stage)).reduce((sum, s) => sum + n(s), 0);
  }
  out.clientes = n("concluido");
  out.perdidos = n("descartado");
  return out;
}
