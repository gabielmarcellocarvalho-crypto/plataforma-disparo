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
      // profile (via trigger) no primeiro OAuth de um e-mail desconhecido; se o e-mail não for de um
      // acesso legítimo, desfaz na hora: desloga e — só se a conta tiver nascido agora nesse OAuth —
      // apaga, pra não acumular lixo em /acessos a cada pessoa que só testou o botão.
      if (!isPasswordRecovery) {
        const admin = createAdminClient();
        const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
        const role = profile?.role;

        // developer entra sempre: enxerga todos os workspaces e por definição NÃO tem linha em
        // workspace_members (ver 0059_developer_role.sql). Esse caso faltava aqui desde que o nível
        // developer foi criado (esta rota é de 31/07, o developer é de 30/08): a checagem só aceitava
        // 'colaborador', então todo developer que entrava pelo Google caía no bloco de "sem acesso"
        // abaixo e tinha a conta apagada — o motivo real de "adicionei em developers e a pessoa não
        // consegue entrar".
        let authorized = role === "developer" || role === "colaborador";
        if (!authorized && role === "cliente") {
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
          // Só apaga a conta que ESTE login acabou de criar. Apagar incondicionalmente destruía o
          // acesso de quem já tinha login na plataforma e entrou pelo Google: o Supabase liga a
          // identidade Google ao usuário existente, então o id que chega aqui é o da conta antiga.
          const contaNascidaAgora = Date.now() - new Date(data.user.created_at).getTime() < 60_000;
          if (contaNascidaAgora) await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
          return NextResponse.redirect(new URL("/login?erro=sem_acesso", url.origin));
        }
      }

      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?erro=auth", url.origin));
}
