import { describe, expect, it } from "vitest";
import { countSavedFilters, normalizeSavedFilters } from "@/lib/crm-saved-filters";

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
