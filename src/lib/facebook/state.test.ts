import { describe, expect, it } from "vitest";
import { STATE_TTL_MS, signFacebookState, verifyFacebookState } from "./state";

const secret = "segredo-de-teste";
const now = 1_800_000_000_000;

describe("estado assinado do login do Facebook", () => {
  it("aceita o estado recém-assinado e devolve o workspace", () => {
    const token = signFacebookState("ws-1", secret, now);
    expect(verifyFacebookState(token, secret, now + 1000)).toEqual({ workspaceId: "ws-1" });
  });

  it("recusa depois de 15 minutos", () => {
    const token = signFacebookState("ws-1", secret, now);
    expect(verifyFacebookState(token, secret, now + STATE_TTL_MS + 1)).toBeNull();
  });

  it("recusa estado assinado com outro segredo", () => {
    const token = signFacebookState("ws-1", "outro", now);
    expect(verifyFacebookState(token, secret, now)).toBeNull();
  });

  it("recusa workspace trocado no meio", () => {
    const [, sig] = signFacebookState("ws-1", secret, now).split(".");
    const forged = Buffer.from(JSON.stringify({ w: "ws-outro", exp: now + 1e9, n: "x" })).toString("base64url");
    expect(verifyFacebookState(`${forged}.${sig}`, secret, now)).toBeNull();
  });
});
