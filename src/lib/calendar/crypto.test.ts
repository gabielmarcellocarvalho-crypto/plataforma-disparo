import { describe, expect, it } from "vitest";
import { randomBytes } from "crypto";
import { decryptToken, encryptToken } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("crypto do token do Google", () => {
  it("cifra e decifra de volta o mesmo texto", () => {
    const stored = encryptToken("1//refresh-token-de-teste", key);
    expect(stored).not.toContain("refresh-token");
    expect(decryptToken(stored, key)).toBe("1//refresh-token-de-teste");
  });

  it("gera um cifrado diferente a cada vez (iv aleatório)", () => {
    expect(encryptToken("abc", key)).not.toBe(encryptToken("abc", key));
  });

  it("falha com a chave errada", () => {
    const stored = encryptToken("abc", key);
    expect(() => decryptToken(stored, randomBytes(32).toString("base64"))).toThrow();
  });

  it("falha se o cifrado for adulterado", () => {
    const [iv, tag, enc] = encryptToken("abc", key).split(".");
    const tampered = [iv, tag, Buffer.from("xyz").toString("base64url") + enc].join(".");
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it("recusa chave com tamanho errado", () => {
    expect(() => encryptToken("abc", Buffer.from("curta").toString("base64"))).toThrow(/CALENDAR_TOKEN_KEY/);
  });
});
