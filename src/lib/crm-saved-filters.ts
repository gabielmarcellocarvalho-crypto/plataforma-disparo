// Filtros salvos do Pipeline — o formato gravado e a leitura defensiva dele (sem banco, pra testar).
// A busca por texto e o período de entrada ficam de fora de propósito: busca é pontual e data fixa
// envelhece ("entrou em outubro" deixa de servir em novembro).

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
