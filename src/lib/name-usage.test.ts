import { describe, expect, it } from "vitest";
import { nameRecentlyUsed, nameUsageNote } from "@/lib/name-usage";

const h = (...c: string[]) => c.map((content) => ({ role: "assistant", content }));

describe("nameRecentlyUsed", () => {
  it("detecta o nome nas últimas respostas, sem ligar pra acento ou caixa", () => {
    expect(nameRecentlyUsed("Lorenzo Silva", h("Entendi, LORENZO!"))).toBe(true);
    expect(nameRecentlyUsed("João", h("Fala, Joao"))).toBe(true);
  });
  it("não confunde com palavra maior", () => {
    expect(nameRecentlyUsed("Ana", h("Temos banana"))).toBe(false);
  });
  it("só olha as últimas respostas do agente", () => {
    expect(nameRecentlyUsed("Lorenzo", [...h("Oi Lorenzo"), ...h("a", "b", "c", "d")])).toBe(false);
  });
  it("ignora mensagens do cliente", () => {
    expect(nameRecentlyUsed("Lorenzo", [{ role: "user", content: "meu nome é Lorenzo" }])).toBe(false);
  });
});

describe("nameUsageNote", () => {
  it("proíbe o nome quando acabou de usar", () => {
    expect(nameUsageNote("Lorenzo", h("Show, Lorenzo"))).toContain("NÃO use");
  });
  it("pede moderação quando não usou", () => {
    expect(nameUsageNote("Lorenzo", h("Show"))).toContain("moderação");
  });
  it("sem nome, não diz nada", () => {
    expect(nameUsageNote(null, h("oi"))).toBe("");
  });
});
