import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/api-keys";
import { hitRateLimit } from "@/lib/rate-limit-db";

export type ApiKeyScope = "completa" | "leitura";
export type AuthedKey = { id: string; workspace_id: string; scope: ApiKeyScope };

// Chave de API do header (Authorization: Bearer <chave> ou x-api-key) → workspace dono dela.
// `write`: rota que cria/altera dado; chave só de leitura (pra dashboard/BI) é recusada nela.
export async function authenticateApiKey(
  req: Request,
  supabase: ReturnType<typeof createAdminClient>,
  { write }: { write: boolean }
): Promise<{ key: AuthedKey } | { error: NextResponse }> {
  const auth = req.headers.get("authorization") || "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");
  if (!apiKey) {
    return { error: NextResponse.json({ error: "Chave de API ausente. Envie em Authorization: Bearer <chave>." }, { status: 401 }) };
  }
  const first = await supabase.from("api_keys").select("id, workspace_id, revoked_at, scope").eq("key_hash", hashApiKey(apiKey)).maybeSingle();
  let key = first.data;
  // Antes da migration 0091 a coluna scope não existe: toda chave era completa.
  if (first.error) {
    const retry = await supabase.from("api_keys").select("id, workspace_id, revoked_at").eq("key_hash", hashApiKey(apiKey)).maybeSingle();
    key = retry.data ? { ...retry.data, scope: "completa" } : null;
  }
  if (!key || key.revoked_at) {
    return { error: NextResponse.json({ error: "Chave de API inválida ou revogada." }, { status: 401 }) };
  }
  const scope: ApiKeyScope = key.scope === "leitura" ? "leitura" : "completa";
  if (write && scope === "leitura") {
    return { error: NextResponse.json({ error: "Essa chave é só de leitura: ela não envia leads, só consulta." }, { status: 403 }) };
  }
  return { key: { id: key.id as string, workspace_id: key.workspace_id as string, scope } };
}

// Leitura devolve dado pessoal em lote: limita por chave (120/min) pra uma chave vazada não virar exportação contínua.
export async function readRateLimit(keyId: string): Promise<NextResponse | null> {
  const limit = await hitRateLimit(`api-leads:${keyId}`, 120, 60);
  if (limit.allowed) return null;
  return NextResponse.json({ error: "Muitas requisições. Tente de novo em instantes." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
}
