import { describe, expect, it } from "vitest";
import { CONNECT_TOKEN_TTL_MS, signConnectToken, verifyConnectToken } from "./connect-token";

const key = "chave-de-teste";
const data = { workspaceId: "ws-1", teamMemberId: "tm-1", origin: "link" as const };
const now = 1_800_000_000_000;

describe("token de conexão da agenda", () => {
  it("aceita o token que acabou de assinar", () => {
    const token = signConnectToken(data, now, key);
    expect(verifyConnectToken(token, now + 1000, key)).toMatchObject(data);
  });

  it("recusa depois de 7 dias", () => {
    const token = signConnectToken(data, now, key);
    expect(verifyConnectToken(token, now + CONNECT_TOKEN_TTL_MS + 1, key)).toBeNull();
  });

  it("recusa se trocarem a pessoa dentro do token", () => {
    const [, sig] = signConnectToken(data, now, key).split(".");
    const forged = Buffer.from(JSON.stringify({ ...data, teamMemberId: "outra-pessoa", exp: now + 1e9 })).toString("base64url");
    expect(verifyConnectToken(`${forged}.${sig}`, now, key)).toBeNull();
  });

  it("recusa token assinado com outro segredo", () => {
    const token = signConnectToken(data, now, "outro-segredo");
    expect(verifyConnectToken(token, now, key)).toBeNull();
  });

  it("recusa lixo", () => {
    expect(verifyConnectToken("", now, key)).toBeNull();
    expect(verifyConnectToken("abc", now, key)).toBeNull();
    expect(verifyConnectToken("abc.def", now, key)).toBeNull();
  });
});
