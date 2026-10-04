import { describe, it, expect } from "vitest";
import { manualAdditions, regenerateKeepingManual } from "@/lib/agent-prompt";

const base = "Você é a Ana.\nVenda planos.\nProduto: Plano A";

describe("prompt do agente: edições manuais", () => {
  it("texto igual ao gerado não tem edição manual", () => {
    expect(manualAdditions(base, base)).toEqual([]);
    expect(regenerateKeepingManual(base, base, base)).toBe(base);
  });

  it("linha escrita à mão é reconhecida como adição", () => {
    const current = `${base}\nNunca passe desconto acima de 10%.`;
    expect(manualAdditions(current, base)).toEqual(["Nunca passe desconto acima de 10%."]);
  });

  it("regenerar com novo produto mantém a linha manual", () => {
    const current = `${base}\nNunca passe desconto acima de 10%.`;
    const regenerated = "Você é a Ana.\nVenda planos.\nProduto: Plano A\nProduto: Plano B";
    const merged = regenerateKeepingManual(regenerated, current, base);
    expect(merged).toContain("Produto: Plano B");
    expect(merged).toContain("Nunca passe desconto acima de 10%.");
  });

  it("duas regenerações seguidas não duplicam a linha manual", () => {
    const current = `${base}\nNunca passe desconto acima de 10%.`;
    const once = regenerateKeepingManual(base, current, base);
    const twice = regenerateKeepingManual(base, once, base);
    expect(twice.split("Nunca passe desconto acima de 10%.").length - 1).toBe(1);
  });
});
