import { describe, expect, it } from "vitest";
import { inSellerPhase } from "./seller-phase";

const on = { enabled: true, signal: "fechando_proposta", farewell: "" };

describe("inSellerPhase", () => {
  it("desligado nunca trava", () => {
    expect(inSellerPhase("concluido", { ...on, enabled: false })).toBe(false);
  });

  it("trava a partir da fase escolhida, inclusive no ganho", () => {
    expect(inSellerPhase("encaminhamento", on)).toBe(false);
    expect(inSellerPhase("fechando_proposta", on)).toBe(true);
    expect(inSellerPhase("concluido", on)).toBe(true);
  });

  it("lead perdido ou sem estágio volta pra IA", () => {
    expect(inSellerPhase("descartado", on)).toBe(false);
    expect(inSellerPhase(null, on)).toBe(false);
  });
});
