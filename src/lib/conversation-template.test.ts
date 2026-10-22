import { describe, expect, it } from "vitest";
import { templateHeaderSupported, templateParamsFor } from "@/lib/conversation-template";

const contato = { name: "maria souza", phone: "5521999990000", email: null, custom_fields: { cidade: "Niterói" } };

describe("templateParamsFor", () => {
  it("sem variável não manda parâmetro", () => {
    expect(templateParamsFor(0, null, contato, null)).toEqual({ params: [], error: null });
  });

  it("usa o mapeamento salvo, com primeiro nome no lugar do nome completo", () => {
    expect(templateParamsFor(2, ["name", "cf:cidade"], contato, null)).toEqual({ params: ["Maria", "Niterói"], error: null });
  });

  it("sem mapeamento, template de uma variável recebe o primeiro nome", () => {
    expect(templateParamsFor(1, [], contato, null)).toEqual({ params: ["Maria"], error: null });
  });

  it("várias variáveis sem mapeamento ou dado faltando bloqueiam o envio", () => {
    expect(templateParamsFor(2, [], contato, null).error).toMatch(/Templates/);
    expect(templateParamsFor(1, ["company"], contato, null).error).toMatch(/\{\{1\}\}/);
  });
});

describe("templateHeaderSupported", () => {
  it("só sem cabeçalho ou cabeçalho de texto", () => {
    expect(templateHeaderSupported(null)).toBe(true);
    expect(templateHeaderSupported("TEXT")).toBe(true);
    expect(templateHeaderSupported("IMAGE")).toBe(false);
  });
});
