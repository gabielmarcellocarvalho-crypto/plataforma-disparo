import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Ponto de retorno único pros dois fluxos que envolvem redirect externo: login via Google (OAuth) e
// o link de "esqueci minha senha" (recovery) — ambos mandam um `code` que precisa ser trocado por
// sessão aqui antes de seguir pra página final (`next`).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";
  const isPasswordRecovery = next === "/redefinir-senha";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    });
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Login (não recuperação de senha): o acesso é sempre criado antes pela agência em /acessos —
      // login social nunca pode autoprovisionar conta nova. O Supabase já cria o auth.users +
      // profile (via trigger) no primeiro OAuth de um e-mail desconhecido; se não for um acesso já
      // vinculado a um workspace (cliente) ou colaborador, desfaz na hora: desloga e apaga a conta
      // recém-criada, pra não acumular lixo em /acessos a cada pessoa que só testou o botão.
      if (!isPasswordRecovery) {
        const admin = createAdminClient();
        const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();

        let authorized = profile?.role === "colaborador";
        if (!authorized && profile?.role === "cliente") {
          const { data: membership } = await admin
            .from("workspace_members")
            .select("user_id")
            .eq("user_id", data.user.id)
            .limit(1)
            .maybeSingle();
          authorized = Boolean(membership);
        }

        if (!authorized) {
          await supabase.auth.signOut();
          await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
          return NextResponse.redirect(new URL("/login?erro=sem_acesso", url.origin));
        }
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?erro=auth", url.origin));
}
