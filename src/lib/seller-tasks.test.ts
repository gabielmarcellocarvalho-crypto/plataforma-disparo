import { describe, expect, it } from "vitest";
import { pickSeller } from "./seller-tasks";

describe("pickSeller", () => {
  it("sem vendedores marcados não escolhe ninguém", () => {
    expect(pickSeller([], "a", new Map())).toBeNull();
  });

  it("dono do lead na lista leva a tarefa", () => {
    expect(pickSeller(["a", "b"], "b", new Map([["b", "2026-10-05"]]))).toBe("b");
  });

  it("dono fora da lista cai no rodízio", () => {
    expect(pickSeller(["a", "b"], "z", new Map([["a", "2026-10-05"]]))).toBe("b");
  });

  it("rodízio: quem nunca recebeu vem primeiro, depois o mais antigo", () => {
    expect(pickSeller(["a", "b", "c"], null, new Map([["a", "2026-10-03"], ["b", "2026-10-01"]]))).toBe("c");
    expect(pickSeller(["a", "b"], null, new Map([["a", "2026-10-03"], ["b", "2026-10-01"]]))).toBe("b");
  });
});
