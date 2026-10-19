import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// Rate limit por IP (achado ALTA #4 de SECURITY_AUDIT.md) — só nas rotas sem sessão de usuário, onde a
// única defesa hoje é o segredo/chave em si (webhook, cron, captura pública de lead, login). Cada regra
// é (prefixo de rota, limite, janela) — a primeira que casar com o path decide.
const RATE_LIMIT_RULES: { prefix: string; limit: number; windowMs: number }[] = [
  // Webhooks (Evolution/360dialog/Meta) — poucas origens legítimas (os próprios provedores), mas em
  // rajada real (reconexão, backlog de eventos) — limite generoso pra não derrubar tráfego real.
  { prefix: "/api/webhook", limit: 120, windowMs: 60_000 },
  // Captura pública de lead — pode ser embarcado em site de cliente, tráfego real de visitante.
  { prefix: "/api/v1/leads", limit: 30, windowMs: 60_000 },
  { prefix: "/api/v1/funil", limit: 30, windowMs: 60_000 },
  // Gatilho de workflow por webhook externo — mesma lógica: token na URL é a autenticação, não sessão.
  { prefix: "/api/workflows/webhook", limit: 30, windowMs: 60_000 },
  // Cron externo (VPS) bate a cada minuto — folga pra retry sem abrir demais.
  { prefix: "/api/cron", limit: 10, windowMs: 60_000 },
  // Rotas públicas que não tinham limite. Folga grande em /api/e (abertura/clique de e-mail: proxies de
  // privacidade, como o da Apple, concentram muita gente num IP só) e em /api/integrations (inclui o
  // webhook do Facebook); apertado onde só humano chega (descadastro, retorno do login).
  { prefix: "/api/e/", limit: 300, windowMs: 60_000 },
  { prefix: "/api/unsubscribe", limit: 30, windowMs: 60_000 },
  { prefix: "/api/integrations", limit: 120, windowMs: 60_000 },
  { prefix: "/auth/callback", limit: 30, windowMs: 60_000 },
];
// Telas de login e "esqueci a senha" são Server Actions (POST na própria página). Este é só o freio
// grosso por instância; o limite que vale de verdade (por IP e por e-mail, compartilhado entre
// instâncias) está nas próprias ações, em src/lib/rate-limit-db.ts.
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 60_000 };
const AUTH_FORM_PATHS = ["/login", "/esqueci-senha"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = clientIp(request);

  const rule = RATE_LIMIT_RULES.find((r) => pathname.startsWith(r.prefix));
  const isLoginSubmit = AUTH_FORM_PATHS.includes(pathname) && request.method === "POST";

  if (rule || isLoginSubmit) {
    const { limit, windowMs } = rule || LOGIN_RATE_LIMIT;
    const key = `${rule?.prefix || pathname}:${ip}`;
    const result = checkRateLimit(key, limit, windowMs);
    if (!result.allowed) {
      return new NextResponse("Too Many Requests", { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
    }
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
