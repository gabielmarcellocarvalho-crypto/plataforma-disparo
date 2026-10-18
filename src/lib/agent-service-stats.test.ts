import { describe, expect, it } from "vitest";
import { reasonKey, resolutionRate } from "@/lib/agent-service-stats";

describe("resolutionRate", () => {
  it("percentual sem humano", () => {
    expect(resolutionRate(10, 2)).toBe(80);
    expect(resolutionRate(3, 0)).toBe(100);
    expect(resolutionRate(0, 0)).toBe(0);
  });
});

describe("reasonKey", () => {
  it("agrupa pelo começo do motivo", () => {
    expect(reasonKey("Muitas mensagens em pouco tempo (possível loop ou abuso) — agente pausado pra esse contato até revisão.")).toBe(
      "Muitas mensagens em pouco tempo"
    );
    expect(reasonKey("Orçamento mensal de IA desse workspace foi atingido — agente pausado até revisão.")).toBe(
      "Orçamento mensal de IA desse workspace foi atingido"
    );
    expect(reasonKey("O agente não conseguiu responder automaticamente essa mensagem.")).toBe(
      "O agente não conseguiu responder automaticamente essa mensagem"
    );
  });
});
