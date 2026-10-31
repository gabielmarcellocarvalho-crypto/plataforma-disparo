import { describe, expect, it } from "vitest";
import { buildPipelineFunnel, signalsLandingOn, type PipelineStage } from "@/lib/pipelines";

const etapa = (id: string, name: string, signal: PipelineStage["signal"], position: number): PipelineStage => ({ id, pipeline_id: "p", name, signal, position });

// Funil da Luchini: não tem "interessado".
const luchini = [
  etapa("a", "Novo contato", "nao_abordado", 0),
  etapa("b", "Encaminhado", "encaminhamento", 1),
  etapa("c", "Em atendimento", "abordado", 2),
  etapa("d", "Follow Up (D+1)", "encaminhamento", 3),
  etapa("e", "Requer fechamento (D+20)", "fechando_proposta", 4),
  etapa("f", "Ganho", "concluido", 5),
  etapa("g", "Perdido", "descartado", 6),
  etapa("h", "Sem resposta", "descartado", 7),
];

describe("buildPipelineFunnel", () => {
  it("mostra todas as etapas do cliente, na ordem dele, menos as de perda", () => {
    const { points } = buildPipelineFunnel(luchini, {});
    expect(points.map((p) => p.label)).toEqual(["Novo contato", "Encaminhado", "Em atendimento", "Follow Up (D+1)", "Requer fechamento (D+20)", "Ganho"]);
  });

  it("acumula de baixo pra cima e separa as perdas", () => {
    const { points, descartados } = buildPipelineFunnel(luchini, { a: 10, b: 5, c: 4, d: 3, e: 2, f: 1, g: 6, h: 2 });
    expect(points.map((p) => p.value)).toEqual([25, 15, 10, 6, 3, 1]);
    expect(points.map((p) => p.current)).toEqual([10, 5, 4, 3, 2, 1]);
    expect(descartados).toBe(8);
  });
});

describe("signalsLandingOn", () => {
  it("acha os sinais que o Pipeline mostra nas etapas escolhidas", () => {
    // "interessado" não existe no funil: cai em "Em atendimento" (abordado, a anterior mais próxima).
    expect(signalsLandingOn(["c"], luchini).sort()).toEqual(["abordado", "interessado"]);
    expect(signalsLandingOn(["b"], luchini)).toEqual(["encaminhamento"]);
  });
});
