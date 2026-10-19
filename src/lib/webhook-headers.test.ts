import { describe, expect, it, beforeAll } from "vitest";
import { randomBytes } from "crypto";
import { maskHeaders, openHeaders, sealHeaders, validateHeaders } from "@/lib/webhook-headers";
import { interpolateVariables, jsonStringEscape } from "@/lib/workflow-types";

beforeAll(() => {
  process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("base64");
});

describe("cabeçalhos do webhook", () => {
  it("cifra ao salvar, abre na chamada e nunca devolve o valor pra tela", () => {
    const sealed = sealHeaders([{ name: "token_exact", value: "segredo-123" }]);
    expect(sealed[0].value).toBeUndefined();
    expect(sealed[0].value_enc).not.toContain("segredo");
    expect(openHeaders(sealed)).toEqual({ token_exact: "segredo-123" });
    expect(maskHeaders(sealed)).toEqual([{ name: "token_exact", value_enc: "salvo" }]);
  });

  it("valida nome, valor e cabeçalhos reservados", () => {
    expect(validateHeaders([{ name: "token_exact", value: "x" }])).toBeNull();
    expect(validateHeaders([{ name: "token exact", value: "x" }])).toMatch(/inválido/);
    expect(validateHeaders([{ name: "Content-Type", value: "x" }])).toMatch(/automaticamente/);
    expect(validateHeaders([{ name: "Authorization" }])).toMatch(/valor/);
  });
});

describe("variáveis no corpo JSON", () => {
  it("escapa aspas e quebra de linha e inclui {{email}}", () => {
    const body = interpolateVariables('{"nome":"{{nome}}","email":"{{email}}","produto":"{{campo:produto}}"}', {
      name: 'Ana "Lu"',
      phone: null,
      email: "ana@x.com",
      custom_fields: { produto: "linha 1\nlinha 2" },
    }, jsonStringEscape);
    expect(JSON.parse(body)).toEqual({ nome: 'Ana "Lu"', email: "ana@x.com", produto: "linha 1\nlinha 2" });
  });
});
