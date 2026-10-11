import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { metaSignatureMode, verifyMetaSignature } from "@/lib/meta-signature";

const SECRET = "app-secret-de-teste";
const body = JSON.stringify({ entry: [{ id: "1", changes: [] }], texto: "olá, ação" });
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

describe("verifyMetaSignature", () => {
  it("aceita a assinatura correta do corpo bruto", () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });
  it("recusa corpo alterado", () => {
    expect(verifyMetaSignature(body + " ", sign(body), SECRET)).toBe(false);
  });
  it("recusa assinatura feita com outro segredo", () => {
    expect(verifyMetaSignature(body, sign(body, "outro"), SECRET)).toBe(false);
  });
  it("recusa cabeçalho ausente, vazio ou sem o prefixo sha256=", () => {
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body).replace("sha256=", ""), SECRET)).toBe(false);
  });
  it("recusa quando o App Secret não está configurado", () => {
    expect(verifyMetaSignature(body, sign(body), undefined)).toBe(false);
  });
  it("não quebra com cabeçalho de tamanho diferente", () => {
    expect(verifyMetaSignature(body, "sha256=abc", SECRET)).toBe(false);
  });
});

describe("metaSignatureMode", () => {
  it("só exige quando o valor é exatamente 'enforce'", () => {
    expect(metaSignatureMode("enforce")).toBe("enforce");
    expect(metaSignatureMode("observe")).toBe("observe");
    expect(metaSignatureMode(undefined)).toBe("observe");
    expect(metaSignatureMode("true")).toBe("observe");
  });
});
