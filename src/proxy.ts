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
  // Gatilho de workflow por webhook externo — mesma lógica: token na URL é a autenticação, não sessão.
  { prefix: "/api/workflows/webhook", limit: 30, windowMs: 60_000 },
  // Cron externo (VPS) bate a cada minuto — folga pra retry sem abrir demais.
  { prefix: "/api/cron", limit: 10, windowMs: 60_000 },
];
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 60_000 }; // só no POST (submit do form)

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = clientIp(request);

  const rule = RATE_LIMIT_RULES.find((r) => pathname.startsWith(r.prefix));
  const isLoginSubmit = pathname === "/login" && request.method === "POST";

  if (rule || isLoginSubmit) {
    const { limit, windowMs } = rule || LOGIN_RATE_LIMIT;
    const key = `${rule?.prefix || "/login"}:${ip}`;
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
