import { describe, expect, it } from "vitest";
import { mapFacebookFields } from "./leads-map";

describe("mapFacebookFields", () => {
  it("separa nome, telefone e e-mail dos campos padrão", () => {
    const m = mapFacebookFields([
      { name: "full_name", values: ["Maria Souza"] },
      { name: "phone_number", values: ["+5535999998888"] },
      { name: "email", values: ["maria@x.com"] },
    ]);
    expect(m).toMatchObject({ name: "Maria Souza", phone: "+5535999998888", email: "maria@x.com", custom: {}, city: null });
  });

  it("monta o nome com primeiro e último quando não vem o nome completo", () => {
    expect(mapFacebookFields([{ name: "first_name", values: ["Ana"] }, { name: "last_name", values: ["Lima"] }]).name).toBe("Ana Lima");
  });

  it("perguntas do formulário viram campos personalizados e cidade é reconhecida", () => {
    const m = mapFacebookFields([
      { name: "full_name", values: ["João"] },
      { name: "Qual sua cidade?", values: ["Lavras"] },
      { name: "Qual produto você procura?", values: ["Trator"] },
    ]);
    expect(m.city).toBe("Lavras");
    expect(m.custom["qual_sua_cidade"]).toBe("Lavras");
    expect(m.custom["qual_produto_voce_procura"]).toBe("Trator");
  });

  it("campo sem valor é ignorado", () => {
    const m = mapFacebookFields([{ name: "email", values: [""] }, { name: "phone_number", values: [] }]);
    expect(m.email).toBeNull();
    expect(m.phone).toBeNull();
  });
});
