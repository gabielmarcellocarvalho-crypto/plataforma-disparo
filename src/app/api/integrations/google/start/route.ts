import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { signConnectToken } from "@/lib/calendar/connect-token";
import { buildAuthUrl } from "@/lib/calendar/google-oauth";

// "Conectar agora" na página de Integrações: quem está logado autoriza a agenda de uma pessoa da
// Equipe ali mesmo (normalmente o próprio closer sentado na frente do computador).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamMemberId = url.searchParams.get("member") || "";

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return NextResponse.redirect(new URL("/login", url.origin));

  // Cliente com a sessão do usuário: a RLS de team_members garante que a pessoa é do workspace dele.
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("team_members")
    .select("id, workspace_id")
    .eq("id", teamMemberId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!member) return NextResponse.redirect(new URL("/integracoes?erro=pessoa", url.origin));

  const state = signConnectToken({ workspaceId: workspace.id, teamMemberId: member.id, origin: "painel" });
  return NextResponse.redirect(buildAuthUrl(url.origin, state));
}
