import { describe, expect, it } from "vitest";
import { normalizeInsights } from "@/lib/ai-insights";

describe("normalizeInsights", () => {
  it("valida, traduz o link e limita a 3", () => {
    const out = normalizeInsights([
      { kind: "risco", title: "5 leads esfriando", detail: "Em Interessado.", link: "pipeline", action: "Ver leads" },
      { kind: "xpto", title: "Info", detail: "x", link: "lugar-nenhum" },
      { title: "" },
      { kind: "oportunidade", title: "Boné em alta", detail: "y", link: null },
      { kind: "info", title: "Quarto", detail: "z" },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: "risco", title: "5 leads esfriando", detail: "Em Interessado.", href: "/crm", action: "Ver leads" });
    expect(out[1]).toEqual({ kind: "info", title: "Info", detail: "x", href: null, action: null });
    expect(out[2].kind).toBe("oportunidade");
  });
  it("não-array vira lista vazia", () => {
    expect(normalizeInsights({ a: 1 })).toEqual([]);
  });
});
