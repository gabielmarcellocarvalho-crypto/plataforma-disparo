import type { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/calendar/crypto";
import { CalendarAuthError, refreshAccessToken } from "@/lib/calendar/google-oauth";

// Tudo que toca calendar_connections passa por aqui, sempre com o client de service role: a tabela
// tem RLS sem policy nenhuma justamente pra o token nunca sair do servidor.

type AdminClient = ReturnType<typeof createAdminClient>;

export type ConnectionStatus = "conectado" | "reconectar";

// O que a tela pode ver — sem o token.
export type ConnectionSummary = {
  team_member_id: string;
  account_email: string | null;
  status: ConnectionStatus;
  last_error: string | null;
  connected_at: string;
};

export async function listConnections(admin: AdminClient, workspaceId: string): Promise<ConnectionSummary[]> {
  const { data, error } = await admin
    .from("calendar_connections")
    .select("team_member_id, account_email, status, last_error, connected_at")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return (data || []) as ConnectionSummary[];
}

export async function saveConnection(
  admin: AdminClient,
  input: { workspaceId: string; teamMemberId: string; email: string | null; refreshToken: string }
): Promise<void> {
  const { error } = await admin.from("calendar_connections").upsert(
    {
      workspace_id: input.workspaceId,
      team_member_id: input.teamMemberId,
      provider: "google",
      account_email: input.email,
      refresh_token_enc: encryptToken(input.refreshToken),
      status: "conectado",
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_member_id" }
  );
  if (error) throw new Error(error.message);
}

// Refresh token decifrado — só pra revogar no Google ao desconectar.
export async function readRefreshToken(admin: AdminClient, teamMemberId: string): Promise<string | null> {
  const { data } = await admin.from("calendar_connections").select("refresh_token_enc").eq("team_member_id", teamMemberId).maybeSingle();
  return data ? decryptToken(data.refresh_token_enc) : null;
}

export async function deleteConnection(admin: AdminClient, teamMemberId: string): Promise<void> {
  const { error } = await admin.from("calendar_connections").delete().eq("team_member_id", teamMemberId);
  if (error) throw new Error(error.message);
}

// Access token novo a cada uso (volume baixo, e evita guardar mais um segredo). Autorização
// revogada/expirada vira status "reconectar" — o closer sai do rodízio até alguém reconectar.
export async function getAccessToken(admin: AdminClient, teamMemberId: string): Promise<string> {
  const { data } = await admin
    .from("calendar_connections")
    .select("refresh_token_enc, status")
    .eq("team_member_id", teamMemberId)
    .maybeSingle();
  if (!data || data.status !== "conectado") throw new CalendarAuthError("Agenda não conectada.");
  try {
    return await refreshAccessToken(decryptToken(data.refresh_token_enc));
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      await admin
        .from("calendar_connections")
        .update({ status: "reconectar", last_error: err.message.slice(0, 300), updated_at: new Date().toISOString() })
        .eq("team_member_id", teamMemberId);
    }
    throw err;
  }
}
