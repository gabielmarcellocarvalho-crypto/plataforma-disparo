import { describe, expect, it } from "vitest";
import { buildQaTools, qaPromptBlock, sameQuestion } from "@/lib/agent-qa";

describe("sameQuestion", () => {
  it("ignora acento, caixa e pontuação", () => {
    expect(sameQuestion("Vocês trocam produto?", "voces trocam produto")).toBe(true);
  });
  it("perguntas diferentes não batem", () => {
    expect(sameQuestion("Vocês trocam produto?", "Vocês entregam no domingo?")).toBe(false);
  });
  it("vazio nunca bate", () => {
    expect(sameQuestion("?", "!")).toBe(false);
  });
});

describe("qaPromptBlock", () => {
  it("manda perguntar à equipe em vez de inventar", () => {
    expect(qaPromptBlock(undefined)).toContain("perguntar_equipe");
  });
  it("desligado: não manda perguntar à equipe, mas ainda usa as respostas já cadastradas", () => {
    const off = qaPromptBlock("P: Trocam?\nR: Sim.", false);
    expect(off).not.toContain("perguntar_equipe");
    expect(off).toContain("R: Sim.");
    expect(qaPromptBlock(undefined, false)).toBe("");
  });
  it("inclui as respostas já dadas pela equipe", () => {
    const block = qaPromptBlock("P: Trocam?\nR: Sim, em 7 dias.");
    expect(block).toContain("R: Sim, em 7 dias.");
  });
});

describe("buildQaTools", () => {
  it("expõe a ferramenta perguntar_equipe com a pergunta obrigatória", () => {
    const [tool] = buildQaTools();
    expect(tool.name).toBe("perguntar_equipe");
    expect((tool.input_schema as { required?: string[] }).required).toEqual(["pergunta"]);
  });
});
