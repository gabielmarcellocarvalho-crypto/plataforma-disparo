import { describe, expect, it } from "vitest";
import { classifyLead, DEFAULT_QUALIFICATION, funnelTotals, resolveQualification, validateQualification } from "@/lib/lead-qualification";

describe("classifyLead", () => {
  it("classifica pelo padrão (MQL interessado, SQL encaminhamento, oportunidade proposta)", () => {
    expect(classifyLead("abordado", DEFAULT_QUALIFICATION)).toEqual({ nivel: "lead", mql: false, sql: false, oportunidade: false, cliente: false });
    expect(classifyLead("encaminhamento", DEFAULT_QUALIFICATION)).toMatchObject({ nivel: "sql", mql: true, sql: true, oportunidade: false });
    expect(classifyLead("concluido", DEFAULT_QUALIFICATION)).toMatchObject({ nivel: "cliente", mql: true, sql: true, oportunidade: true, cliente: true });
    expect(classifyLead("descartado", DEFAULT_QUALIFICATION)).toMatchObject({ nivel: "perdido", mql: false, cliente: false });
  });

  it("nível desligado some da resposta", () => {
    const cfg = resolveQualification({ sql: { enabled: false } });
    const r = classifyLead("encaminhamento", cfg);
    expect(r).not.toHaveProperty("sql");
    expect(r.nivel).toBe("mql");
  });
});

describe("resolveQualification / validateQualification", () => {
  it("usa o padrão pro que faltar ou vier inválido", () => {
    expect(resolveQualification({ mql: { stage: "xyz", enabled: "sim" } }).mql).toEqual(DEFAULT_QUALIFICATION.mql);
  });
  it("recusa SQL antes do MQL, ignorando níveis desligados", () => {
    expect(validateQualification(resolveQualification({ mql: { stage: "encaminhamento" }, sql: { stage: "interessado" } }))).toMatch(/SQL/);
    expect(validateQualification(resolveQualification({ mql: { stage: "encaminhamento" }, sql: { enabled: false, stage: "interessado" } }))).toBeNull();
  });
});

describe("funnelTotals", () => {
  it("soma cumulativa por nível, sem perdidos", () => {
    const t = funnelTotals({ nao_abordado: 10, abordado: 5, interessado: 4, encaminhamento: 3, fechando_proposta: 2, concluido: 1, descartado: 6 }, DEFAULT_QUALIFICATION);
    expect(t).toEqual({ leads: 31, mql: 10, sql: 6, oportunidade: 3, clientes: 1, perdidos: 6 });
  });
});
