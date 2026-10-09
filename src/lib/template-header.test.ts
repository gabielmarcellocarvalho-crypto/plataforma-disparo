import { describe, expect, it } from "vitest";
import { buildTemplatePayload } from "@/lib/metacloud";
import { campaignHeaderPath, headerSupport, isOwnHeaderPath, validateHeaderFile } from "@/lib/template-header";

describe("buildTemplatePayload", () => {
  it("template sem cabeçalho e sem variável não manda components", () => {
    const p = buildTemplatePayload("5511999990000", "disparo_01", "pt_BR");
    expect(p.template).toEqual({ name: "disparo_01", language: { code: "pt_BR" } });
  });
  it("só corpo: igual ao formato que já funcionava", () => {
    const p = buildTemplatePayload("5511999990000", "disparo_01", "pt_BR", ["Maria"]);
    expect(p.template.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "Maria" }] }]);
  });
  it("cabeçalho de imagem vai ANTES do corpo, com link", () => {
    const p = buildTemplatePayload("5511999990000", "disparo_outubro_rosa", "pt_BR", ["Maria"], { format: "IMAGE", url: "https://x/y.png" });
    expect(p.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://x/y.png" } }] },
      { type: "body", parameters: [{ type: "text", text: "Maria" }] },
    ]);
  });
  it("imagem sem variável no corpo manda só o cabeçalho", () => {
    const p = buildTemplatePayload("5511999990000", "t", "pt_BR", [], { format: "IMAGE", url: "https://x/y.png" });
    expect(p.template.components).toEqual([{ type: "header", parameters: [{ type: "image", image: { link: "https://x/y.png" } }] }]);
  });
  it("documento leva o nome do arquivo", () => {
    const p = buildTemplatePayload("5511999990000", "t", "pt_BR", [], { format: "DOCUMENT", url: "https://x/a.pdf", fileName: "catalogo.pdf" });
    expect(p.template.components).toEqual([
      { type: "header", parameters: [{ type: "document", document: { link: "https://x/a.pdf", filename: "catalogo.pdf" } }] },
    ]);
  });
});

describe("headerSupport", () => {
  it("sem cabeçalho ou texto não pede arquivo", () => {
    expect(headerSupport(null)).toEqual({ kind: "none" });
    expect(headerSupport(undefined)).toEqual({ kind: "none" });
    expect(headerSupport("TEXT")).toEqual({ kind: "none" });
  });
  it("imagem e documento pedem arquivo", () => {
    expect(headerSupport("IMAGE")).toEqual({ kind: "media", format: "IMAGE" });
    expect(headerSupport("DOCUMENT")).toEqual({ kind: "media", format: "DOCUMENT" });
  });
  it("vídeo e outros não são suportados", () => {
    expect(headerSupport("VIDEO")).toEqual({ kind: "unsupported", format: "VIDEO" });
    expect(headerSupport("LOCATION")).toEqual({ kind: "unsupported", format: "LOCATION" });
  });
});

describe("validateHeaderFile", () => {
  it("imagem aceita JPG e PNG até 5MB", () => {
    expect(validateHeaderFile("IMAGE", "image/png", 1000)).toBeNull();
    expect(validateHeaderFile("IMAGE", "image/jpeg", 5 * 1024 * 1024)).toBeNull();
  });
  it("recusa webp, pdf no lugar de imagem, vazio e grande demais", () => {
    expect(validateHeaderFile("IMAGE", "image/webp", 1000)).toMatch(/imagem/);
    expect(validateHeaderFile("IMAGE", "application/pdf", 1000)).toMatch(/imagem/);
    expect(validateHeaderFile("IMAGE", "image/png", 0)).toMatch(/Selecione/);
    expect(validateHeaderFile("IMAGE", "image/png", 5 * 1024 * 1024 + 1)).toMatch(/grande/);
  });
  it("documento aceita só PDF", () => {
    expect(validateHeaderFile("DOCUMENT", "application/pdf", 1000)).toBeNull();
    expect(validateHeaderFile("DOCUMENT", "image/png", 1000)).toMatch(/documento/);
  });
});

describe("isOwnHeaderPath", () => {
  it("aceita só o caminho gerado para o próprio workspace", () => {
    const path = campaignHeaderPath("ws-1", "image/png");
    expect(path).toMatch(/^ws-1\/campaign-headers\/[0-9a-f-]{36}\.png$/);
    expect(isOwnHeaderPath("ws-1", path)).toBe(true);
    expect(isOwnHeaderPath("ws-2", path)).toBe(false);
  });
  it("recusa caminho forjado", () => {
    expect(isOwnHeaderPath("ws-1", "ws-1/campaign-headers/../../ws-2/x.png")).toBe(false);
    expect(isOwnHeaderPath("ws-1", "ws-1/campaign-headers/sub/abc.png")).toBe(false);
    expect(isOwnHeaderPath("ws-1", "ws-1/outro/00000000-0000-0000-0000-000000000000.png")).toBe(false);
    expect(isOwnHeaderPath("ws-1", "")).toBe(false);
  });
});
