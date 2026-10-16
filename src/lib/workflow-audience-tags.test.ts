import { describe, expect, it } from "vitest";
import { matchesTagAudience } from "@/lib/workflow-audience-tags";

describe("matchesTagAudience", () => {
  it("sem tag configurada, todo mundo entra", () => {
    expect(matchesTagAudience(null, {})).toBe(true);
    expect(matchesTagAudience(["A"], { tags: [] })).toBe(true);
  });
  it("any: basta uma das tags", () => {
    expect(matchesTagAudience(["Feira"], { tags: ["Feira", "Sócio"] })).toBe(true);
    expect(matchesTagAudience(["Outra"], { tags: ["Feira", "Sócio"] })).toBe(false);
    expect(matchesTagAudience(null, { tags: ["Feira"] })).toBe(false);
  });
  it("all: precisa ter todas", () => {
    expect(matchesTagAudience(["Feira", "Sócio"], { tags: ["Feira", "Sócio"], tagMode: "all" })).toBe(true);
    expect(matchesTagAudience(["Feira"], { tags: ["Feira", "Sócio"], tagMode: "all" })).toBe(false);
  });
  it("exclude: quem tem a tag sai, mesmo se bater com as incluídas", () => {
    expect(matchesTagAudience(["Feira", "Cliente"], { tags: ["Feira"], excludeTags: ["Cliente"] })).toBe(false);
    expect(matchesTagAudience(["Feira"], { excludeTags: ["Cliente"] })).toBe(true);
  });
  it("ignora acento e caixa", () => {
    expect(matchesTagAudience(["socio"], { tags: ["Sócio"] })).toBe(true);
  });
});
