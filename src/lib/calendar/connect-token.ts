import { createHmac } from "crypto";
import { secureEqual } from "@/lib/secure-compare";

// Token assinado que liga uma autorização do Google a UMA pessoa da Equipe de UM workspace. Usado em
// dois lugares: no link de conexão que vai pro WhatsApp do closer (ele não tem login) e no `state` do
// OAuth, pra o retorno do Google não poder ser redirecionado pra outra pessoa/workspace.

export const CONNECT_TOKEN_TTL_MS = 7 * 86_400_000;

export type ConnectPayload = {
  workspaceId: string;
  teamMemberId: string;
  // Só volta pra /integracoes quem iniciou logado; quem veio pelo link vê a tela pública de "conectado".
  origin: "painel" | "link";
  exp: number;
};

function secret(raw: string | undefined): string {
  if (!raw) throw new Error("CALENDAR_TOKEN_KEY ausente.");
  return raw;
}

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function signConnectToken(
  data: Omit<ConnectPayload, "exp">,
  now: number = Date.now(),
  rawKey: string | undefined = process.env.CALENDAR_TOKEN_KEY
): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: now + CONNECT_TOKEN_TTL_MS })).toString("base64url");
  return `${body}.${sign(body, secret(rawKey))}`;
}

// Devolve o conteúdo só se a assinatura bater e não tiver expirado; qualquer outra coisa é null.
export function verifyConnectToken(
  token: string,
  now: number = Date.now(),
  rawKey: string | undefined = process.env.CALENDAR_TOKEN_KEY
): ConnectPayload | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  if (!secureEqual(sig, sign(body, secret(rawKey)))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConnectPayload;
    if (typeof data.exp !== "number" || data.exp < now) return null;
    if (!data.workspaceId || !data.teamMemberId) return null;
    if (data.origin !== "painel" && data.origin !== "link") return null;
    return data;
  } catch {
    return null;
  }
}
