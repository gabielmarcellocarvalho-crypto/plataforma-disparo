"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { generateApiKey } from "@/lib/api-keys";

export type ApiKeySummary = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return data ?? [];
}

export type CreateApiKeyResult = { error: string | null; plainKey?: string };

// A chave em texto puro só existe nesse retorno — depois disso só o hash fica salvo, então não tem
// como recuperar de novo (mesma lógica de secret de API de qualquer plataforma).
export async function createApiKey(name: string): Promise<CreateApiKeyResult> {
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
