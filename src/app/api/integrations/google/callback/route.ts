import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyConnectToken } from "@/lib/calendar/connect-token";
import { exchangeCode, revokeToken } from "@/lib/calendar/google-oauth";
import { saveConnection } from "@/lib/calendar/connections";

// Retorno do Google depois que o closer autoriza. Rota PÚBLICA (quem vem pelo link não tem sessão) —
// a segurança está no `state` assinado: só grava pra pessoa/workspace que estava dentro dele.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const payload = verifyConnectToken(url.searchParams.get("state") || "");
  const result = (status: string) => {
    const dest =
      payload?.origin === "painel"
        ? `/integracoes?agenda=${status}`
        : `/conectar-agenda/resultado?status=${status}`;
    return NextResponse.redirect(new URL(dest, url.origin));
  };

  if (!payload) return result("link-invalido");
  // A pessoa clicou em "Cancelar" na tela do Google.
  if (url.searchParams.get("error")) return result("cancelado");

  const code = url.searchParams.get("code");
  if (!code) return result("erro");

  const admin = createAdminClient();
  // A pessoa pode ter sido apagada ou trocado de workspace depois que o link foi gerado.
  const { data: member } = await admin
    .from("team_members")
    .select("id")
    .eq("id", payload.teamMemberId)
    .eq("workspace_id", payload.workspaceId)
    .maybeSingle();
  if (!member) return result("link-invalido");

  try {
    const tokens = await exchangeCode(url.origin, code);
    if (!tokens.grantedCalendar) {
      await revokeToken(tokens.refreshToken);
      return result("sem-permissao");
    }
    await saveConnection(admin, {
      workspaceId: payload.workspaceId,
      teamMemberId: payload.teamMemberId,
      email: tokens.email,
      refreshToken: tokens.refreshToken,
    });
  } catch (err) {
    console.error("Falha ao conectar Google Agenda:", err instanceof Error ? err.message : err);
    return result("erro");
  }

  return result("ok");
}
