import { describe, expect, it } from "vitest";
import { countSavedFilters, matchesSavedFilter, normalizeSavedFilters } from "@/lib/crm-saved-filters";

describe("normalizeSavedFilters", () => {
  it("gravação inválida vira filtro vazio", () => {
    const f = normalizeSavedFilters(null);
    expect(f.quickView).toBe("todos");
    expect(countSavedFilters(f)).toBe(0);
  });

  it("tags em minúsculas e campos sem valor descartados", () => {
    const f = normalizeSavedFilters({
      includeTags: ["Comercial", ""],
      channel: "fax",
      fields: [{ key: "cidade", value: "Campinas" }, { key: "produto", value: "" }],
    });
    expect(f.includeTags).toEqual(["comercial"]);
    expect(f.channel).toBe("");
    expect(f.fields).toEqual([{ key: "cidade", value: "Campinas" }]);
    expect(countSavedFilters(f)).toBe(2);
  });

  it("o mesmo filtro normalizado duas vezes dá o mesmo texto (é assim que o atalho ativo é reconhecido)", () => {
    const raw = { quickView: "parados", team: "abc", includeTags: ["vip"], pipelineId: null };
    expect(JSON.stringify(normalizeSavedFilters(normalizeSavedFilters(raw)))).toBe(JSON.stringify(normalizeSavedFilters(raw)));
  });
});

describe("matchesSavedFilter", () => {
  const lead = { stage: "abordado", phone: "5511999999999", tags: ["Comercial"], custom_fields: { cidade: "Campinas" }, pipeline_id: null };

  it("tag do departamento e campo do lead", () => {
    expect(matchesSavedFilter(lead, normalizeSavedFilters({ includeTags: ["comercial"], fields: [{ key: "cidade", value: "Campinas" }] }), null)).toBe(true);
    expect(matchesSavedFilter(lead, normalizeSavedFilters({ includeTags: ["financeiro"] }), null)).toBe(false);
    expect(matchesSavedFilter(lead, normalizeSavedFilters({ excludeTags: ["comercial"] }), null)).toBe(false);
  });

  it("visão Campanha Meta usa a regra do selo", () => {
    const f = normalizeSavedFilters({ quickView: "campanha" });
    expect(matchesSavedFilter(lead, f, null)).toBe(false);
    expect(matchesSavedFilter({ ...lead, ctwa_at: "2026-10-01T00:00:00Z" }, f, null)).toBe(true);
  });

  it("lead sem funil conta como do funil padrão", () => {
    const f = normalizeSavedFilters({ includeTags: ["comercial"], pipelineId: "p1" });
    expect(matchesSavedFilter(lead, f, "p1")).toBe(true);
    expect(matchesSavedFilter(lead, f, "p2")).toBe(false);
  });
});
