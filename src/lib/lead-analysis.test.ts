import { describe, expect, it } from "vitest";
import { conversationTranscript, normalizeAnalysis, temperatureFor } from "@/lib/lead-analysis";
import { parseJsonLoose } from "@/lib/ai-light";

describe("normalizeAnalysis", () => {
  it("aceita e limita a nota", () => {
    expect(normalizeAnalysis({ score: 130, temperature: "QUENTE", summary: "Quer o boné", next_action: "Mandar link" })).toEqual({
      score: 100,
      temperature: "quente",
      summary: "Quer o boné",
      nextAction: "Mandar link",
    });
  });
  it("deduz a temperatura quando vem inválida", () => {
    expect(normalizeAnalysis({ score: 50, temperature: "x", summary: "ok" })?.temperature).toBe("morno");
  });
  it("recusa sem resumo ou sem nota", () => {
    expect(normalizeAnalysis({ score: 50 })).toBeNull();
    expect(normalizeAnalysis({ summary: "x", score: "abc" })).toBeNull();
    expect(normalizeAnalysis(null)).toBeNull();
  });
  it("faixas de temperatura", () => {
    expect(temperatureFor(70)).toBe("quente");
    expect(temperatureFor(39)).toBe("frio");
  });
});

describe("conversationTranscript", () => {
  it("mantém as mais recentes dentro do limite", () => {
    const t = conversationTranscript(
      [
        { role: "user", content: "a".repeat(50) },
        { role: "assistant", content: "oi" },
        { role: "user", content: "quero" },
      ],
      30
    );
    expect(t).toBe("Empresa: oi\nLead: quero");
  });
});

describe("parseJsonLoose", () => {
  it("lê JSON dentro de bloco de código", () => {
    expect(parseJsonLoose<{ a: number }>('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose<number[]>("Aqui: [1,2]")).toEqual([1, 2]);
    expect(parseJsonLoose("nada")).toBeNull();
  });
});
