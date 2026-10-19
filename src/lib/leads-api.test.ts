import { describe, expect, it } from "vitest";
import { parseLeadsQuery, toApiLead, type LeadRow } from "@/lib/leads-api";
import { isMetaCampaignLead } from "@/lib/lead-origin";
import { DEFAULT_QUALIFICATION } from "@/lib/lead-qualification";

const q = (s: string) => parseLeadsQuery(new URLSearchParams(s));

describe("parseLeadsQuery", () => {
  it("usa página 1 e 100 por página sem parâmetros", () => {
    expect(q("")).toEqual({ query: { fromIso: null, toIso: null, page: 1, perPage: 100 } });
  });

  it("desde começa à meia-noite de Brasília e ate inclui o dia inteiro", () => {
    const r = q("desde=2026-10-01&ate=2026-10-01");
    expect("query" in r && r.query.fromIso).toBe("2026-10-01T03:00:00.000Z");
    expect("query" in r && r.query.toIso).toBe("2026-10-02T02:59:59.999Z");
  });

  it("recusa data inválida, intervalo invertido e página fora do limite", () => {
    expect(q("desde=01/10/2026")).toHaveProperty("error");
    expect(q("desde=2026-02-30")).toHaveProperty("error");
    expect(q("desde=2026-10-05&ate=2026-10-01")).toHaveProperty("error");
    expect(q("pagina=0")).toHaveProperty("error");
    expect(q("por_pagina=501")).toHaveProperty("error");
  });
});

const base: LeadRow = {
  id: "c1",
  name: "Ana",
  phone: "5521999990000",
  email: null,
  created_at: "2026-10-10T12:00:00Z",
  stage: "descartado",
  stage_changed_at: "2026-10-12T12:00:00Z",
  pipeline_stage_id: null,
  deal_value: "1500.00",
  lost_reason: "preço",
  custom_fields: { origem: "Facebook", campanha_meta: "Síndicos RJ", utm_source: "fb", cidade: "Rio" },
  tags: ["Feira"],
  ctwa_at: null,
};

describe("toApiLead", () => {
  const ctx = {
    stageLabels: { descartado: "Perdido" },
    pipelineStages: new Map([["ps1", { name: "Visita agendada", signal: "encaminhamento" }]]),
    qualification: DEFAULT_QUALIFICATION,
  };

  it("monta fase, resultado, valor e origem", () => {
    const lead = toApiLead(base, ctx);
    expect(lead.fase).toEqual({ codigo: "descartado", nome: "Perdido", desde: "2026-10-12T12:00:00Z" });
    expect(lead.resultado).toBe("perdido");
    expect(lead.valor_venda).toBe(1500);
    expect(lead.motivo_perda).toBe("preço");
    expect(lead.origem).toMatchObject({ source: "Facebook", campanha_meta: true, utms: { utm_source: "fb" }, tags: ["Feira"], facebook_campanha: "Síndicos RJ" });
  });

  it("usa o nome da etapa do funil próprio quando o lead está num", () => {
    const lead = toApiLead({ ...base, stage: "abordado", pipeline_stage_id: "ps1", lost_reason: null }, ctx);
    expect(lead.fase.nome).toBe("Visita agendada");
    expect(lead.fase.codigo).toBe("encaminhamento");
    expect(lead.qualificacao).toMatchObject({ nivel: "sql", mql: true, sql: true });
    expect(lead.resultado).toBeNull();
  });
});

describe("isMetaCampaignLead", () => {
  it("reconhece anúncio, Facebook Leads e clique Click-to-WhatsApp", () => {
    expect(isMetaCampaignLead({ custom_fields: { origem: "Anúncio Meta" } })).toBe(true);
    expect(isMetaCampaignLead({ custom_fields: { origem: "Facebook" } })).toBe(true);
    expect(isMetaCampaignLead({ custom_fields: {}, ctwa_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(isMetaCampaignLead({ custom_fields: { origem: "api" } })).toBe(false);
    expect(isMetaCampaignLead({ custom_fields: null })).toBe(false);
  });
});
