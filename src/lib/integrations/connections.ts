import type { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/calendar/crypto";

// Tudo que toca integration_connections passa por aqui, sempre com o client de service role: a tabela
// tem RLS sem policy justamente pra o token nunca sair do servidor. Toda leitura filtra por workspace.

type AdminClient = ReturnType<typeof createAdminClient>;

export type IntegrationStatus = "conectado" | "reconectar";

// O que a tela pode ver — sem o token.
export type IntegrationSummary = {
  provider: string;
  external_id: string;
  display_name: string | null;
  enabled_capabilities: string[];
  status: IntegrationStatus;
  last_error: string | null;
  connected_at: string;
};

const SUMMARY_COLUMNS = "provider, external_id, display_name, enabled_capabilities, status, last_error, connected_at";

export async function getIntegration(admin: AdminClient, workspaceId: string, provider: string): Promise<IntegrationSummary | null> {
  const { data, error } = await admin
    .from("integration_connections")
    .select(SUMMARY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as IntegrationSummary | null) ?? null;
}

export async function listIntegrations(admin: AdminClient, workspaceId: string): Promise<IntegrationSummary[]> {
  const { data, error } = await admin.from("integration_connections").select(SUMMARY_COLUMNS).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return (data || []) as IntegrationSummary[];
}

// Salva (ou troca) a conexão do provedor. Trocar de loja zera as permissões liberadas: o dono liga de
// novo de propósito, nada herda da loja anterior.
export async function saveIntegration(
  admin: AdminClient,
  input: { workspaceId: string; provider: string; externalId: string; displayName: string | null; token: string }
): Promise<void> {
  const current = await getIntegration(admin, input.workspaceId, input.provider);
  const sameAccount = current?.external_id === input.externalId;
  const { error } = await admin.from("integration_connections").upsert(
    {
      workspace_id: input.workspaceId,
      provider: input.provider,
      external_id: input.externalId,
      display_name: input.displayName,
      credentials_enc: encryptToken(input.token),
      enabled_capabilities: sameAccount ? current?.enabled_capabilities ?? [] : [],
      status: "conectado",
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,provider" }
  );
  if (error) throw new Error(error.message);
}

export async function setCapabilities(admin: AdminClient, workspaceId: string, provider: string, ids: string[]): Promise<void> {
  const { error } = await admin
    .from("integration_connections")
    .update({ enabled_capabilities: ids, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
  if (error) throw new Error(error.message);
}

export async function setStatus(
  admin: AdminClient,
  workspaceId: string,
  provider: string,
  status: IntegrationStatus,
  lastError: string | null
): Promise<void> {
  await admin
    .from("integration_connections")
    .update({ status, last_error: lastError ? lastError.slice(0, 300) : null, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
}

export async function deleteIntegration(admin: AdminClient, workspaceId: string, provider: string): Promise<void> {
  const { error } = await admin.from("integration_connections").delete().eq("workspace_id", workspaceId).eq("provider", provider);
  if (error) throw new Error(error.message);
}

// Credencial decifrada — só pra chamar a API do provedor, no servidor. Nunca devolver à tela.
export async function readCredentials(
  admin: AdminClient,
  workspaceId: string,
  provider: string
): Promise<{ externalId: string; token: string; status: IntegrationStatus; enabledCapabilities: string[] } | null> {
  const { data } = await admin
    .from("integration_connections")
    .select("external_id, credentials_enc, status, enabled_capabilities")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) return null;
  return {
    externalId: data.external_id,
    token: decryptToken(data.credentials_enc),
    status: data.status as IntegrationStatus,
    enabledCapabilities: data.enabled_capabilities || [],
  };
}
