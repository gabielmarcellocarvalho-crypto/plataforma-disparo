import { describe, expect, it } from "vitest";
import { fillTemplateBody } from "@/lib/template-log";

describe("fillTemplateBody", () => {
  it("preenche as variáveis do template", () => {
    expect(fillTemplateBody("Oi {{1}}, seu {{2}} chegou", ["Ana", "boné"])).toBe("Oi Ana, seu boné chegou");
  });
  it("deixa a variável sem valor como está", () => {
    expect(fillTemplateBody("Oi {{1}} {{2}}", ["Ana"])).toBe("Oi Ana {{2}}");
  });
});
