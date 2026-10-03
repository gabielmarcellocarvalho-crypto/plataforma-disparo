import { createHmac, randomBytes } from "crypto";
import { secureEqual } from "@/lib/secure-compare";

// Estado assinado do login do Facebook: prova que o retorno veio do início de uma conexão feita por
// um workspace, e impede que outra pessoa redirecione a autorização pra um workspace que não é dele.
// Vale 15 minutos, tempo suficiente pra tela de login da Meta.

export const STATE_TTL_MS = 15 * 60_000;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signFacebookState(workspaceId: string, secret: string, now: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ w: workspaceId, exp: now + STATE_TTL_MS, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyFacebookState(token: string, secret: string, now: number = Date.now()): { workspaceId: string } | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  if (!secureEqual(sig, sign(body, secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { w?: string; exp?: number };
    if (typeof data.exp !== "number" || data.exp < now || !data.w) return null;
    return { workspaceId: data.w };
  } catch {
    return null;
  }
}
