import { describe, expect, it } from "vitest";
import { buildLeadShareText } from "./lead-share-text";

const base = {
  name: "Maria Souza",
  phone: "5535999998888",
  email: "",
  stageName: "Encaminhado",
  teamMemberName: "Carlos",
  branchName: "Lavras",
  tags: ["Tratores Usados"],
  lostReason: null,
  fieldDefs: [
    { key: "cidade", label: "Cidade", type: "selecao" as const },
    { key: "produto", label: "Produto", type: "selecao" as const },
  ],
  values: { cidade: "Lavras", produto: "" },
  extras: [{ key: "origem", value: "Instagram" }],
};

describe("buildLeadShareText", () => {
  it("monta o texto pro WhatsApp só com o que está preenchido", () => {
    expect(buildLeadShareText(base)).toBe(
      [
        "*Maria Souza*",
        "Telefone: +55 (35) 99999-8888",
        "WhatsApp: https://wa.me/5535999998888",
        "Etapa: Encaminhado",
        "Vendedor: Carlos",
        "Filial: Lavras",
        "Etiquetas: Tratores Usados",
        "Cidade: Lavras",
        "origem: Instagram",
      ].join("\n")
    );
  });

  it("lead sem nome e sem telefone não quebra", () => {
    const t = buildLeadShareText({ ...base, name: " ", phone: "", tags: [], extras: [], values: {} });
    expect(t.split("\n")[0]).toBe("*Lead sem nome*");
    expect(t).not.toContain("WhatsApp:");
  });
});
