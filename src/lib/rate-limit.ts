// Rate limit por IP em memória — proteção de defesa em profundidade contra brute-force de segredo
// de webhook/cron e abuso de rotas públicas sem sessão (achado ALTA #4 de SECURITY_AUDIT.md).
//
// Limitação conhecida: o middleware roda em runtime Edge, com várias instâncias isoladas (cada uma com
// sua própria memória) — um atacante distribuído entre regiões/instâncias pode, na teoria, contornar
// esse limite batendo em instâncias diferentes. Ainda assim eleva bastante a barra pro caso comum (1
// atacante, 1 origem), sem exigir conta/infra nova. Upstash Redis (limite compartilhado de verdade
// entre todas as instâncias) fica como upgrade de backlog quando fizer sentido.
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Evita crescimento sem fim da Map em uma instância de vida longa — nunca deveria chegar perto disso
// em uso normal (cada IP único gera 1 entrada, expira sozinha); é só um teto de segurança.
const MAX_TRACKED_KEYS = 5000;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear(); // teto de segurança — nunca deveria disparar em uso normal
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count++;
  if (existing.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// Vercel não expõe mais `request.ip` diretamente (removido do NextRequest) — o cabeçalho
// x-forwarded-for é a forma suportada de obter o IP de origem real por trás do proxy da Vercel.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
