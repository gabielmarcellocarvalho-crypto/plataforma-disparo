"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { generateApiKey } from "@/lib/api-keys";
import type { ApiKeyScope } from "@/lib/api-auth";
import { resolveQualification, validateQualification, type QualConfig } from "@/lib/lead-qualification";

export type ApiKeySummary = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  scope: ApiKeyScope;
};

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const cols = "id, name, key_prefix, created_at, last_used_at, revoked_at";
  const { data, error } = await supabase.from("api_keys").select(`${cols}, scope`).eq("workspace_id", workspace.id).order("created_at", { ascending: false });
  if (!error) return (data ?? []).map((k) => ({ ...k, scope: k.scope === "leitura" ? "leitura" : "completa" })) as ApiKeySummary[];
  // Antes da migration 0091 (sem a coluna scope) toda chave é completa.
  const { data: old } = await supabase.from("api_keys").select(cols).eq("workspace_id", workspace.id).order("created_at", { ascending: false });
  return (old ?? []).map((k) => ({ ...k, scope: "completa" as const }));
}

export type CreateApiKeyResult = { error: string | null; plainKey?: string };

// A chave em texto puro só existe nesse retorno — depois disso só o hash fica salvo, então não tem
// como recuperar de novo (mesma lógica de secret de API de qualquer plataforma).
// `scope`: "leitura" = chave pra dashboard/BI, que só consulta (não cria nem altera lead).
export async function createApiKey(name: string, scope: ApiKeyScope = "completa"): Promise<CreateApiKeyResult> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Dê um nome pra identificar essa chave (ex.: site institucional)." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const { plain, displayPrefix, hash } = generateApiKey();

  const supabase = await createClient();
  const { error } = await supabase.from("api_keys").insert({
    workspace_id: workspace.id,
    name: trimmed,
    key_prefix: displayPrefix,
    key_hash: hash,
    ...(scope === "leitura" ? { scope: "leitura" } : {}),
  });
  if (error) return { error: "Não foi possível gerar a chave." };

  revalidatePath("/configuracoes");
  return { error: null, plainKey: plain };
}

export async function revokeApiKey(id: string): Promise<{ error: string | null }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível revogar a chave." };

  revalidatePath("/configuracoes");
  return { error: null };
}

// Regras de MQL/SQL/oportunidade do workspace (lidas pela API de leitura e pelo resumo do funil).
export async function saveLeadQualification(raw: QualConfig): Promise<{ error: string | null }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  const cfg = resolveQualification(raw);
  const invalid = validateQualification(cfg);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ lead_qualification: cfg }).eq("id", workspace.id);
  if (error) return { error: "Não foi possível salvar as regras." };
  revalidatePath("/configuracoes");
  return { error: null };
}
