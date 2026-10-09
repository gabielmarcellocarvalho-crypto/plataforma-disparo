import { describe, expect, it } from "vitest";
import { inboundLeadFields } from "@/lib/inbound-lead";

const base = { workspaceId: "w1", instanceId: "i1", phone: "5511999990000", name: "  Maria  ", optOut: false };
const now = new Date("2026-10-09T12:00:00Z");

describe("inboundLeadFields", () => {
  it("lead novo que escreve primeiro nasce em andamento (abordado), ligado ao número que recebeu", () => {
    expect(inboundLeadFields(base, now)).toEqual({
      workspace_id: "w1",
      phone: "5511999990000",
      name: "Maria",
      whatsapp_instance_id: "i1",
      stage: "abordado",
      stage_changed_at: "2026-10-09T12:00:00.000Z",
    });
  });
  it("nome vazio vira null", () => {
    expect(inboundLeadFields({ ...base, name: "   " }, now).name).toBeNull();
    expect(inboundLeadFields({ ...base, name: null }, now).name).toBeNull();
  });
  it("quem já escreve pedindo pra sair não entra em andamento e fica em opt-out", () => {
    const f = inboundLeadFields({ ...base, optOut: true }, now);
    expect(f.opt_out_whatsapp).toBe(true);
    expect(f.stage).toBeUndefined();
  });
});
