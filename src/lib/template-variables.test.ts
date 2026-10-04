import { describe, it, expect } from "vitest";
import { fieldOptionsFor, variableCount, previewText, mappingLegend, validateMapping, BUILTIN_FIELDS } from "@/lib/template-variables";
import type { CustomFieldDef } from "@/lib/custom-fields";

const defs = [{ key: "cidade", label: "Cidade", options: ["Rio", "SP"] }] as unknown as CustomFieldDef[];

describe("template variables", () => {
  it("opções do workspace: fixas + personalizadas com a chave cf:", () => {
    const options = fieldOptionsFor(defs);
    expect(options.slice(0, BUILTIN_FIELDS.length)).toEqual(BUILTIN_FIELDS);
    expect(options.at(-1)).toEqual({ value: "cf:cidade", label: "Cidade", example: "Rio" });
  });

  it("conta a maior variável usada", () => {
    expect(variableCount("Oi {{1}}, da {{2}}")).toBe(2);
    expect(variableCount("sem variável")).toBe(0);
  });

  it("prévia troca cada variável pelo exemplo do campo escolhido", () => {
    const options = fieldOptionsFor(defs);
    expect(previewText("Oi {{1}}, da {{2}}!", ["name", "company"], options)).toBe("Oi Maria, da Acme Ltda!");
  });

  it("variável sem campo fica como está na prévia", () => {
    expect(previewText("Oi {{1}} {{2}}", ["name"], fieldOptionsFor([]))).toBe("Oi Maria {{2}}");
  });

  it("legenda mostra o que cada variável significa", () => {
    expect(mappingLegend(["name", "company"], fieldOptionsFor([]))).toEqual(["{{1}} = Nome", "{{2}} = Empresa"]);
  });

  it("valida contra as opções reais do workspace", () => {
    const options = fieldOptionsFor(defs);
    expect(validateMapping(2, ["name", "cf:cidade"], options)).toBeNull();
    expect(validateMapping(2, ["name"], options)).toMatch(/um campo para cada/);
    expect(validateMapping(1, ["cf:inexistente"], options)).toMatch(/não corresponde/);
  });
});
