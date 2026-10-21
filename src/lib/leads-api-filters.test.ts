import { describe, expect, it } from "vitest";
import { leadFilterOps, parseLeadFilters, type LeadFilters } from "@/lib/leads-api-filters";
import { DEFAULT_QUALIFICATION } from "@/lib/lead-qualification";

const parse = (s: string) => parseLeadFilters(new URLSearchParams(s));
const filters = (s: string) => {
  const r = parse(s);
  if ("error" in r) throw new Error(r.error);
  return r.filters;
};
const ops = (s: string, tags: string[] = []) => leadFilterOps(filters(s), DEFAULT_QUALIFICATION, tags);
const stageOp = (s: string) => ops(s).find((o): o is { op: "in"; col: string; val: string[] } => o.op === "in" && o.col === "stage");

describe("parseLeadFilters", () => {
  it("sem parâmetros não filtra nada", () => {
    expect(ops("")).toEqual([]);
  });

  it("recusa etapa, resultado e qualificação desconhecidos", () => {
    expect(parse("etapa=qualquer")).toHaveProperty("error");
    expect(parse("resultado=talvez")).toHaveProperty("error");
    expect(parse("qualificacao=xql")).toHaveProperty("error");
  });
});

describe("leadFilterOps", () => {
  it("origem=meta usa a mesma regra do selo da Meta (anúncio, formulário ou campanha)", () => {
    const [o] = ops("origem=meta");
    expect(o.op).toBe("or");
    const expr = (o as { expr: string }).expr;
    expect(expr).toContain("ctwa_at.not.is.null");
    expect(expr).toContain('custom_fields->>origem.in.("Anúncio Meta","Facebook")');
    expect(expr).toContain("custom_fields->>campanha_meta.not.is.null");
  });

  it("origem=google_ads usa a mesma regra do selo do Google (gclid, utm_source ou origem)", () => {
    const [o] = ops("origem=google_ads");
    const expr = (o as { expr: string }).expr;
    expect(expr).toContain("custom_fields->>gclid.not.is.null");
    expect(expr).toContain("custom_fields->>utm_source.ilike.*google*");
    expect(ops("origem=google")).toEqual(ops("origem=google_ads"));
  });

  it("whatsapp_direto = nada de Meta e sem origem gravada", () => {
    const list = ops("origem=whatsapp_direto");
    expect(list).toContainEqual({ op: "is_null", col: "ctwa_at" });
    expect(list).toContainEqual({ op: "is_null", col: "custom_fields->>origem" });
    expect(list.some((o) => o.op === "or")).toBe(false);
  });

  it("outra origem compara o texto sem diferenciar maiúscula; curinga vira igualdade exata", () => {
    expect(ops("origem=Site")).toEqual([{ op: "ilike", col: "custom_fields->>origem", val: "Site" }]);
    expect(ops("origem=a%25b")).toEqual([{ op: "eq", col: "custom_fields->>origem", val: "a%b" }]);
  });

  it("tag usa a grafia gravada no workspace", () => {
    expect(ops("tag=feira,vip", ["Feira"])).toEqual([{ op: "overlaps", col: "tags", val: ["Feira", "vip"] }]);
  });

  it("qualificacao=sql pega a etapa do SQL em diante, sem perdidos", () => {
    expect(stageOp("qualificacao=sql")).toEqual({ op: "in", col: "stage", val: ["encaminhamento", "fechando_proposta", "concluido"] });
  });

  it("nível desligado não devolve ninguém", () => {
    const cfg = { ...DEFAULT_QUALIFICATION, sql: { ...DEFAULT_QUALIFICATION.sql, enabled: false } };
    const f = filters("qualificacao=sql") as LeadFilters;
    expect(leadFilterOps(f, cfg)).toEqual([{ op: "in", col: "stage", val: [] }]);
  });

  it("etapa, resultado e qualificação se cruzam", () => {
    expect(stageOp("resultado=aberto&qualificacao=mql")?.val).not.toContain("concluido");
    expect(stageOp("resultado=ganho&etapa=abordado")?.val).toEqual([]);
  });

  it("campanha e UTMs filtram os campos gravados no lead", () => {
    expect(ops("campanha=Black Friday&utm_source=google")).toEqual([
      { op: "ilike", col: "custom_fields->>campanha_meta", val: "Black Friday" },
      { op: "ilike", col: "custom_fields->>utm_source", val: "google" },
    ]);
  });
});
