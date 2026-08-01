import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/webhook: chamado pela Evolution API/provedores externos, sem sessão de usuário.
// /auth/callback: troca o code do OAuth (Google) ou do link de recuperação de senha por sessão —
// roda antes de existir usuário logado. /esqueci-senha: pedido de reset, sem sessão ainda.
// /redefinir-senha NÃO é público de propósito: só chega lá com sessão de recovery já criada pelo callback.
// /api/cron: chamado por cron externo (Vercel Cron ou VPS), sem sessão — protegido pelo próprio
// CRON_SECRET dentro de cada rota, não pela sessão do middleware.
const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/auth/callback", "/api/webhook", "/api/v1/leads", "/api/cron"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
