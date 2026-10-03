"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { decryptToken } from "@/lib/calendar/crypto";
import { graphAll } from "@/lib/facebook/graph";

export type FacebookForm = { id: string; name: string; enabled: boolean; tag: string };
type Result<T = object> = ({ error: null } & T) | { error: string };

// Página só é mexida por quem é do workspace dela. Token fica no servidor.
async function pageOfWorkspace(pageId: string) {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("facebook_pages")
    .select("page_id, page_token_enc")
    .eq("workspace_id", workspace.id)
    .eq("page_id", pageId)
    .maybeSingle();
  return data ? { workspaceId: workspace.id, token: decryptToken(data.page_token_enc as string) } : null;
}

// Busca os formulários da página na Meta e junta com o que já foi escolhido (ligado/etiqueta).
export async function fetchFacebookForms(pageId: string): Promise<Result<{ forms: FacebookForm[] }>> {
  const page = await pageOfWorkspace(pageId);
  if (!page) return { error: "Página não encontrada." };

  let live: { id: string; name?: string }[];
  try {
    live = await graphAll<{ id: string; name?: string }>(`${pageId}/leadgen_forms`, page.token, { fields: "id,name" });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Não foi possível ler os formulários." };
  }

  const admin = createAdminClient();
  const { data: saved } = await admin.from("facebook_lead_forms").select("form_id, enabled, tag").eq("workspace_id", page.workspaceId).eq("page_id", pageId);
  const savedById = new Map((saved || []).map((s) => [s.form_id as string, s]));

  const rows = live.map((f) => ({
    workspace_id: page.workspaceId,
    page_id: pageId,
    form_id: f.id,
    form_name: f.name ?? f.id,
    enabled: savedById.get(f.id)?.enabled ?? false,
    tag: savedById.get(f.id)?.tag ?? null,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) await admin.from("facebook_lead_forms").upsert(rows, { onConflict: "workspace_id,form_id" });

  return {
    error: null,
    forms: rows.map((r) => ({ id: r.form_id, name: r.form_name, enabled: r.enabled, tag: r.tag ?? "" })),
  };
}

// Liga/desliga um formulário e define a etiqueta que os leads dele recebem.
export async function saveFacebookForm(pageId: string, formId: string, enabled: boolean, tag: string): Promise<Result> {
  const page = await pageOfWorkspace(pageId);
  if (!page) return { error: "Página não encontrada." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("facebook_lead_forms")
    .update({ enabled, tag: tag.trim().slice(0, 60) || null, updated_at: new Date().toISOString() })
    .eq("workspace_id", page.workspaceId)
    .eq("form_id", formId);
  if (error) return { error: "Não foi possível salvar o formulário." };
  revalidatePath("/integracoes");
  return { error: null };
}

// Desconecta a conta do Facebook: tira as páginas e os formulários dela. Os leads já recebidos ficam.
export async function disconnectFacebook(connectionId: string): Promise<Result> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  const admin = createAdminClient();
  const { data: conn } = await admin.from("facebook_connections").select("id").eq("id", connectionId).eq("workspace_id", workspace.id).maybeSingle();
  if (!conn) return { error: "Conexão não encontrada." };

  const { data: pages } = await admin.from("facebook_pages").select("page_id").eq("connection_id", connectionId);
  for (const p of pages || []) {
    await admin.from("facebook_lead_forms").delete().eq("workspace_id", workspace.id).eq("page_id", p.page_id as string);
  }
  await admin.from("facebook_connections").delete().eq("id", connectionId);
  revalidatePath("/integracoes");
  return { error: null };
}
