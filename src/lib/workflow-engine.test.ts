import { describe, expect, it, vi } from "vitest";

// O motor importa o client do Supabase e canais de envio — irrelevantes pra regra pura testada aqui.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { isInPipelineStage } = await import("./workflow-engine");
type Stage = Parameters<typeof isInPipelineStage>[2][number];

// Funil padrão parecido com o da Luchini: duas etapas com o mesmo sinal (encaminhamento).
const stages: Stage[] = [
  { id: "novo", pipeline_id: "crm", signal: "nao_abordado", position: 0, isDefault: true },
  { id: "encaminhado", pipeline_id: "crm", signal: "encaminhamento", position: 1, isDefault: true },
  { id: "atendimento", pipeline_id: "crm", signal: "abordado", position: 2, isDefault: true },
  { id: "followup", pipeline_id: "crm", signal: "encaminhamento", position: 3, isDefault: true },
  { id: "outro-funil", pipeline_id: "pos-venda", signal: "encaminhamento", position: 0, isDefault: false },
];

const lead = (over: Record<string, unknown>) =>
  ({ id: "c", workspace_id: "w", name: null, phone: null, stage: "encaminhamento", stage_changed_at: "", responsible_user_id: null, company_id: null, whatsapp_instance_id: null, ...over }) as Parameters<typeof isInPipelineStage>[0];

describe("isInPipelineStage", () => {
  it("lead movido no funil: vale a etapa gravada, mesmo com sinal repetido", () => {
    expect(isInPipelineStage(lead({ pipeline_stage_id: "followup" }), "followup", stages)).toBe(true);
    expect(isInPipelineStage(lead({ pipeline_stage_id: "followup" }), "encaminhado", stages)).toBe(false);
  });

  it("lead nunca movido: cai na PRIMEIRA etapa do funil padrão com o sinal dele", () => {
    expect(isInPipelineStage(lead({ pipeline_stage_id: null }), "encaminhado", stages)).toBe(true);
    expect(isInPipelineStage(lead({ pipeline_stage_id: null }), "followup", stages)).toBe(false);
  });

  it("lead nunca movido não conta em funil que não é o padrão", () => {
    expect(isInPipelineStage(lead({ pipeline_stage_id: null }), "outro-funil", stages)).toBe(false);
  });

  it("sinal diferente não bate", () => {
    expect(isInPipelineStage(lead({ pipeline_stage_id: null, stage: "abordado" }), "encaminhado", stages)).toBe(false);
    expect(isInPipelineStage(lead({ pipeline_stage_id: null, stage: "abordado" }), "atendimento", stages)).toBe(true);
  });
});
