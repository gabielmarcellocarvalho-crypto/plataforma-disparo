"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import {
  MAX_SAVED_FILTERS,
  countSavedFilters,
  normalizeSavedFilters,
  type SavedFilter,
} from "@/lib/crm-saved-filters";

// Os filtros salvos da pessoa logada, neste workspace. O RLS já restringe a quem criou; o filtro por
// user_id aqui é pra consulta usar o índice. Sem a tabela (migration pendente), lista vazia.
export async function listSavedFilters(): Promise<SavedFilter[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("crm_saved_filters")
    .select("id, name, filters")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({ id: r.id, name: r.name, filters: normalizeSavedFilters(r.filters) }));
}

export async function saveCrmFilter(name: string, raw: unknown): Promise<{ error: string | null; filter?: SavedFilter }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Workspace não encontrado." };
  const nome = String(name ?? "").trim().slice(0, 40);
  if (!nome) return { error: "Dê um nome ao filtro." };
  const filters = normalizeSavedFilters(raw);
  if (countSavedFilters(filters) === 0) return { error: "Escolha pelo menos um filtro antes de salvar." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre de novo." };

  const { count } = await supabase
    .from("crm_saved_filters")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_SAVED_FILTERS) return { error: `Limite de ${MAX_SAVED_FILTERS} filtros salvos. Apague um pra criar outro.` };

  const { data, error } = await supabase
    .from("crm_saved_filters")
    .insert({ workspace_id: workspace.id, user_id: user.id, name: nome, filters })
    .select("id, name, filters")
    .single();
  if (error || !data) return { error: "Não foi possível salvar o filtro." };
  return { error: null, filter: { id: data.id, name: data.name, filters: normalizeSavedFilters(data.filters) } };
}

export async function deleteCrmFilter(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("crm_saved_filters").delete().eq("id", id);
  return { error: error ? "Não foi possível apagar o filtro." : null };
}
