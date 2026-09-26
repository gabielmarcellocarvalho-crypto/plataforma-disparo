"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { signConnectToken } from "@/lib/calendar/connect-token";
import { revokeToken } from "@/lib/calendar/google-oauth";
import { deleteConnection, readRefreshToken } from "@/lib/calendar/connections";

type Result<T = object> = ({ error: null } & T) | { error: string };

// Confere, com a sessão do usuário (RLS), que a pessoa é do workspace ativo.
async function memberOfCurrentWorkspace(teamMemberId: string): Promise<{ workspaceId: string } | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("team_members").select("id").eq("id", teamMemberId).eq("workspace_id", workspace.id).maybeSingle();
  return data ? { workspaceId: workspace.id } : null;
}

async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Link pra mandar ao closer (normalmente sem login): vale 7 dias e só conecta a agenda DESSA pessoa.
export async function createConnectLink(teamMemberId: string): Promise<Result<{ url: string }>> {
  const ok = await memberOfCurrentWorkspace(teamMemberId);
  if (!ok) return { error: "Pessoa não encontrada." };
  const token = signConnectToken({ workspaceId: ok.workspaceId, teamMemberId, origin: "link" });
  return { error: null, url: `${await currentOrigin()}/conectar-agenda/${token}` };
}

export async function disconnectCalendar(teamMemberId: string): Promise<Result> {
  const ok = await memberOfCurrentWorkspace(teamMemberId);
  if (!ok) return { error: "Pessoa não encontrada." };
  const admin = createAdminClient();
  try {
    const refreshToken = await readRefreshToken(admin, teamMemberId);
    if (refreshToken) await revokeToken(refreshToken);
    await deleteConnection(admin, teamMemberId);
  } catch {
    return { error: "Não foi possível desconectar a agenda." };
  }
  revalidatePath("/integracoes");
  return { error: null };
}
