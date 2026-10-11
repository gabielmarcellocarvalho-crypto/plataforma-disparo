import { createHash } from "crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Limite compartilhado entre instâncias (tabela rate_limits, migration 0086). Usado onde o ataque
// acontece de verdade: login e recuperação de senha. Se o banco falhar, libera (fail-open): um limite
// nunca pode derrubar o login de quem é legítimo.
export type DbRateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const OPEN: DbRateLimitResult = { allowed: true, retryAfterSeconds: 0 };
const TIMEOUT_MS = 1500;

type Row = { allowed: boolean; retry_after: number };

async function callRpc(fn: string, args: Record<string, unknown>): Promise<DbRateLimitResult> {
  try {
    const call = createAdminClient().rpc(fn, args);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS));
    const { data, error } = await Promise.race([call, timeout]);
    if (error) return OPEN;
    const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    if (!row) return OPEN;
    return { allowed: row.allowed, retryAfterSeconds: row.retry_after };
  } catch {
    return OPEN;
  }
}

/** Conta +1 na chave. `allowed: false` quando passou do limite dentro da janela. */
export function hitRateLimit(key: string, limit: number, windowSeconds: number) {
  return callRpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
}

/** Só consulta, não conta. Bloqueado se a chave já atingiu o limite e a janela não venceu. */
export function peekRateLimit(key: string, limit: number) {
  return callRpc("rate_limit_peek", { p_key: key, p_limit: limit });
}

export async function resetRateLimit(key: string): Promise<void> {
  try {
    await createAdminClient().rpc("rate_limit_reset", { p_key: key });
  } catch {
    // ignora: limpar a chave é só conveniência
  }
}

/** Chave por e-mail: hash do e-mail normalizado, pra não guardar o e-mail em texto no banco. */
export function emailKey(scope: string, email: string): string {
  return `${scope}:e:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}

export function ipKey(scope: string, ip: string): string {
  return `${scope}:ip:${ip}`;
}

/** IP de origem a partir dos cabeçalhos da requisição atual (Server Actions). */
export async function currentIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

export function waitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Muitas tentativas. Aguarde ${minutes} minuto${minutes > 1 ? "s" : ""} e tente de novo.`;
}
