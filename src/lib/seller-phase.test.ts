import { describe, expect, it } from "vitest";
import { inSellerPhase } from "./seller-phase";

// Funil tipo TB Rio: duas etapas com o mesmo sinal, só a segunda marcada.
const on = { enabled: true, stageIds: ["visita-realizada", "proposta"], signals: ["encaminhamento", "fechando_proposta"], farewell: "" };

describe("inSellerPhase", () => {
  it("desligado nunca trava", () => {
    expect(inSellerPhase({ stage: "fechando_proposta", pipeline_stage_id: "proposta" }, { ...on, enabled: false })).toBe(false);
  });

  it("lead no funil: vale a etapa exata, não o sinal", () => {
    expect(inSellerPhase({ stage: "encaminhamento", pipeline_stage_id: "visita-realizada" }, on)).toBe(true);
    expect(inSellerPhase({ stage: "encaminhamento", pipeline_stage_id: "visita-agendada" }, on)).toBe(false);
  });

  it("lead sem etapa de funil cai no sinal", () => {
    expect(inSellerPhase({ stage: "fechando_proposta", pipeline_stage_id: null }, on)).toBe(true);
    expect(inSellerPhase({ stage: "interessado" }, on)).toBe(false);
    expect(inSellerPhase({ stage: null }, on)).toBe(false);
  });

  it("workspace sem funil: só sinais marcados", () => {
    const semFunil = { ...on, stageIds: [], signals: ["concluido"] };
    expect(inSellerPhase({ stage: "concluido", pipeline_stage_id: "qualquer" }, semFunil)).toBe(true);
    expect(inSellerPhase({ stage: "fechando_proposta" }, semFunil)).toBe(false);
  });
});
