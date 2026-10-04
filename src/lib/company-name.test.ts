import { describe, it, expect } from "vitest";
import { companyKey } from "@/lib/company-name";

describe("companyKey", () => {
  it("junta grafias diferentes da mesma empresa", () => {
    expect(companyKey("V4 Carvalho")).toBe(companyKey("v4 carvalho Ltda"));
    expect(companyKey("V4 CARVALHO ME")).toBe(companyKey("V4 Carvalho"));
    expect(companyKey("Café & Cia.")).toBe("cafe");
  });

  it("empresas diferentes continuam separadas", () => {
    expect(companyKey("V4 Carvalho")).not.toBe(companyKey("V4 Digital"));
  });

  it("nome só com sufixo não vira chave", () => {
    expect(companyKey("Ltda")).toBe("");
  });
});
