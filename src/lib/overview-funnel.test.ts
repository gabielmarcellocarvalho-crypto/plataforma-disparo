import { describe, expect, it, vi } from "vitest";

// overview-metrics importa o client do servidor (next/headers); aqui só se testa a parte pura.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { buildFunnel, FUNNEL_HAPPY_PATH, type FunnelPoint } from "@/lib/overview-metrics";
import { displayStageFor, getVisibleStages, resolveHiddenStages, resolveStageLabels, type ContactStage } from "@/lib/crm-stages";

// Cópia fiel do laço que existia em getFunnelData, que percorria contato por contato. Serve de
// referência: buildFunnel (que recebe "quantos contatos há em cada fase") tem que dar o mesmo resultado.
function referenceFunnel(
  stages: string[],
  workspaceRow: { crm_stage_labels?: unknown; crm_hidden_stages?: unknown } | null,
  funnelEnd: ContactStage = "concluido"
): { points: FunnelPoint[]; descartados: number } {
  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const hiddenStages = resolveHiddenStages(workspaceRow?.crm_hidden_stages);
  const visibleStages = getVisibleStages(hiddenStages);
  const endIdx = FUNNEL_HAPPY_PATH.indexOf(funnelEnd);
  const happyPathForPlan = endIdx === -1 ? FUNNEL_HAPPY_PATH : FUNNEL_HAPPY_PATH.slice(0, endIdx + 1);
  const funnelStages = happyPathForPlan.filter((s) => visibleStages.includes(s));

  let descartados = 0;
  const displayStageIndex: number[] = new Array(funnelStages.length).fill(0);
  const currentAtStage: number[] = new Array(funnelStages.length).fill(0);
  for (const raw of stages) {
    const stage = raw as ContactStage;
    if (stage === "descartado") {
      descartados++;
      continue;
    }
    const display = displayStageFor(stage, visibleStages);
    let idx = funnelStages.indexOf(display as ContactStage);
    if (idx === -1) {
      if (FUNNEL_HAPPY_PATH.indexOf(display as ContactStage) === -1) continue;
      idx = funnelStages.length - 1;
    }
    for (let i = 0; i <= idx; i++) displayStageIndex[i]++;
    currentAtStage[idx]++;
  }
  const points: FunnelPoint[] = funnelStages.map((stage, i) => ({ stage, label: stageLabels[stage], value: displayStageIndex[i], current: currentAtStage[i] }));
  return { points, descartados };
}

const ALL: ContactStage[] = ["nao_abordado", "abordado", "interessado", "encaminhamento", "fechando_proposta", "concluido", "descartado"];

// Gerador pseudo-aleatório fixo, pra o teste ser repetível.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CONFIGS: { name: string; row: { crm_stage_labels?: unknown; crm_hidden_stages?: unknown } | null; end: ContactStage }[] = [
  { name: "sem personalização", row: null, end: "concluido" },
  { name: "plano que termina em encaminhamento", row: null, end: "encaminhamento" },
  { name: "fases do meio ocultas (como a Luchini)", row: { crm_hidden_stages: ["interessado", "encaminhamento", "fechando_proposta"], crm_stage_labels: { abordado: "Em andamento", nao_abordado: "Não respondeu" } }, end: "concluido" },
  { name: "só uma fase do meio oculta", row: { crm_hidden_stages: ["encaminhamento"] }, end: "concluido" },
  { name: "oculta e plano curto", row: { crm_hidden_stages: ["interessado", "encaminhamento"] }, end: "encaminhamento" },
];

describe("buildFunnel (contagens por fase) == regra antiga (contato por contato)", () => {
  for (const cfg of CONFIGS) {
    it(`${cfg.name}`, () => {
      const rand = rng(42);
      for (let round = 0; round < 40; round++) {
        const n = Math.floor(rand() * 300);
        const stages = Array.from({ length: n }, () => ALL[Math.floor(rand() * ALL.length)]);
        const counts: Record<string, number> = {};
        for (const s of stages) counts[s] = (counts[s] || 0) + 1;
        expect(buildFunnel(counts, cfg.row, cfg.end)).toEqual(referenceFunnel(stages, cfg.row, cfg.end));
      }
    });
  }

  it("sem nenhum contato: funil zerado", () => {
    const out = buildFunnel({}, null);
    expect(out.descartados).toBe(0);
    expect(out.points.every((p) => p.value === 0 && p.current === 0)).toBe(true);
  });

  it("ignora fase desconhecida em vez de quebrar", () => {
    expect(() => buildFunnel({ fase_inventada: 3, abordado: 2 }, null)).not.toThrow();
  });
});
