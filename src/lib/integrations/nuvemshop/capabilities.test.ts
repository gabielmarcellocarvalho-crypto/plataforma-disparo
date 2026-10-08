import { describe, expect, it } from "vitest";
import { effectiveCapabilityIds, sanitizeCapabilityIds } from "@/lib/integrations/nuvemshop/capabilities";
import { normalizeIntegrations } from "@/lib/agent-prompt";

describe("sanitizeCapabilityIds", () => {
  it("descarta desconhecidas e as de escrita (travadas)", () => {
    expect(sanitizeCapabilityIds(["nuvemshop.pedidos.consultar", "nuvemshop.pedidos.cancelar", "inventada", 5, null])).toEqual([
      "nuvemshop.pedidos.consultar",
    ]);
  });
  it("aceita só lista", () => {
    expect(sanitizeCapabilityIds("nuvemshop.pedidos.consultar")).toEqual([]);
    expect(sanitizeCapabilityIds(undefined)).toEqual([]);
  });
});

describe("effectiveCapabilityIds", () => {
  it("só vale o que está ligado no workspace E no agente", () => {
    const ws = ["nuvemshop.pedidos.consultar"];
    const agent = ["nuvemshop.pedidos.consultar", "nuvemshop.produtos.consultar"];
    expect([...effectiveCapabilityIds(ws, agent)]).toEqual(["nuvemshop.pedidos.consultar"]);
  });
  it("desligar no workspace tira do agente", () => {
    expect(effectiveCapabilityIds([], ["nuvemshop.pedidos.consultar"]).size).toBe(0);
  });
  it("agente sem nada ligado não ganha nada", () => {
    expect(effectiveCapabilityIds(["nuvemshop.pedidos.consultar"], []).size).toBe(0);
  });
  it("escrita nunca é efetiva, mesmo ligada nos dois lados", () => {
    expect(effectiveCapabilityIds(["nuvemshop.pedidos.cancelar"], ["nuvemshop.pedidos.cancelar"]).size).toBe(0);
  });
});

describe("normalizeIntegrations", () => {
  it("limpa lixo e deduplica", () => {
    expect(normalizeIntegrations({ nuvemshop: ["a.b", "a.b", "", 3], "Inválido!": ["x"], vazio: [] })).toEqual({ nuvemshop: ["a.b", "3"] });
    expect(normalizeIntegrations(null)).toEqual({});
    expect(normalizeIntegrations([])).toEqual({});
  });
});
