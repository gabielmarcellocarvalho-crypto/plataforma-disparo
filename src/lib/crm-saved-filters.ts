// Filtros salvos do Pipeline — o formato gravado e a leitura defensiva dele (sem banco, pra testar).
// A busca por texto e o período de entrada ficam de fora de propósito: busca é pontual e data fixa
// envelhece ("entrou em outubro" deixa de servir em novembro).
import { STALE_AFTER_DAYS, daysSince } from "@/lib/crm-stages";
import { readMultiValue } from "@/lib/custom-fields";
import { isMetaCampaignLead } from "@/lib/lead-origin";

export type SavedFilterValues = {
  quickView: string;
  stage: string;
  team: string;
  branch: string;
  channel: "" | "whatsapp" | "email";
  lostReason: string;
  includeTags: string[];
  excludeTags: string[];
  fields: { key: string; value: string }[];
  // Funil em que o filtro foi salvo (só quando há mais de um); aplicar volta pra ele.
  pipelineId: string | null;
};

export type SavedFilter = { id: string; name: string; filters: SavedFilterValues };

export const MAX_SAVED_FILTERS = 20;

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown, max = 30) =>
  (Array.isArray(v) ? v : []).map((t) => str(t, 60).trim().toLowerCase()).filter(Boolean).slice(0, max);

export function normalizeSavedFilters(raw: unknown): SavedFilterValues {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const channel = r.channel === "whatsapp" || r.channel === "email" ? r.channel : "";
  const fields = (Array.isArray(r.fields) ? r.fields : [])
    .map((f) => {
      const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      return { key: str(o.key, 60), value: str(o.value) };
    })
    .filter((f) => f.key && f.value)
    .slice(0, 20);
  return {
    quickView: str(r.quickView, 20) || "todos",
    stage: str(r.stage, 40),
    team: str(r.team, 60),
    branch: str(r.branch, 60),
    channel,
    lostReason: str(r.lostReason),
    includeTags: strList(r.includeTags),
    excludeTags: strList(r.excludeTags),
    fields,
    pipelineId: str(r.pipelineId, 60) || null,
  };
}

// Quantos filtros o atalho aplica — filtro salvo vazio não serve pra nada.
export function countSavedFilters(f: SavedFilterValues): number {
  return (
    (f.quickView !== "todos" ? 1 : 0) +
    (f.stage ? 1 : 0) +
    (f.team ? 1 : 0) +
    (f.branch ? 1 : 0) +
    (f.channel ? 1 : 0) +
    (f.lostReason ? 1 : 0) +
    f.includeTags.length +
    f.excludeTags.length +
    f.fields.length
  );
}

// Mesmo critério do Pipeline, pra aplicar o filtro salvo fora dele (ex.: na tela de Conversas). Quem
// chama precisa trazer do contato as colunas abaixo — campo ausente conta como vazio.
export type MatchableContact = {
  stage: string;
  stage_changed_at?: string | null;
  phone: string | null;
  tags: string[] | null;
  needs_attention?: boolean;
  flagged_reason?: string | null;
  ai_temperature?: string | null;
  team_member_id?: string | null;
  branch_id?: string | null;
  lost_reason?: string | null;
  pipeline_id?: string | null;
  custom_fields?: Record<string, unknown> | null;
  ctwa_at?: string | null;
};

export function matchesSavedFilter(c: MatchableContact, f: SavedFilterValues, defaultPipelineId: string | null): boolean {
  const fechado = c.stage === "concluido" || c.stage === "descartado";
  if (f.quickView === "atencao" && !c.needs_attention && !c.flagged_reason) return false;
  if (f.quickView === "quentes" && c.ai_temperature !== "quente") return false;
  if (f.quickView === "campanha" && !isMetaCampaignLead(c)) return false;
  if (f.quickView === "ganhos" && c.stage !== "concluido") return false;
  if (f.quickView === "perdidos" && c.stage !== "descartado") return false;
  if (f.quickView === "parados" && (fechado || !c.stage_changed_at || daysSince(c.stage_changed_at) < STALE_AFTER_DAYS)) return false;
  if (f.stage && c.stage !== f.stage) return false;
  if (f.team && (f.team === "__nenhum__" ? c.team_member_id : c.team_member_id !== f.team)) return false;
  if (f.branch && (f.branch === "__nenhum__" ? c.branch_id : c.branch_id !== f.branch)) return false;
  if (f.channel === "whatsapp" && !c.phone) return false;
  if (f.channel === "email" && c.phone) return false;
  if (f.lostReason && (f.lostReason === "__nenhum__" ? c.stage !== "descartado" || c.lost_reason : c.lost_reason !== f.lostReason)) return false;
  const tags = (c.tags ?? []).map((t) => t.toLowerCase());
  if (f.excludeTags.some((t) => tags.includes(t))) return false;
  if (f.includeTags.length > 0 && !f.includeTags.some((t) => tags.includes(t))) return false;
  for (const ff of f.fields) {
    const raw = (c.custom_fields || {})[ff.key];
    const ok = Array.isArray(raw) ? readMultiValue(raw).includes(ff.value) : String(raw ?? "") === ff.value;
    if (!ok) return false;
  }
  // Lead que nunca mudou de funil está no padrão (mesma regra do Pipeline).
  if (f.pipelineId && (c.pipeline_id ?? defaultPipelineId) !== f.pipelineId) return false;
  return true;
}
