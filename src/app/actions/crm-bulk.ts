"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { isContactStage } from "@/lib/crm-stages";

export type BulkResult = { error: string | null; updated?: number };

// Teto por operação: uma seleção acidental de "todos" não vira milhares de updates de uma vez.
const MAX_BULK = 500;
// ids por update: o filtro "in" vai na URL, e 500 UUIDs passariam do tamanho seguro dela.
const CHUNK = 150;

async function updateInChunks(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: { id: string }[] | null; error: unknown }>) {
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await run(ids.slice(i, i + CHUNK));
    if (error) return { updated, failed: true };
    updated += data?.length ?? 0;
  }
  return { updated, failed: false };
}

// Ações em lote do Pipeline (selecionar vários cards e aplicar a mesma mudança). Mesmas regras das
// ações de um lead só: mover grava etapa + sinal + stage_changed_at e limpa motivo de perda.
export async function bulkMoveContacts(ids: string[], target: { stage?: string; stageId?: string }): Promise<BulkResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (ids.length === 0) return { error: "Selecione ao menos um lead." };
  if (ids.length > MAX_BULK) return { error: `Selecione no máximo ${MAX_BULK} leads por vez.` };

  const supabase = await createClient();
  let patch: Record<string, unknown>;
  if (target.stageId) {
    const { data: etapa } = await supabase
      .from("pipeline_stages")
      .select("id, pipeline_id, signal")
      .eq("id", target.stageId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!etapa || !isContactStage(etapa.signal)) return { error: "Etapa inválida." };
    patch = { pipeline_id: etapa.pipeline_id, pipeline_stage_id: etapa.id, stage: etapa.signal };
  } else if (target.stage && isContactStage(target.stage)) {
    patch = { stage: target.stage };
  } else {
    return { error: "Etapa inválida." };
  }
  patch.stage_changed_at = new Date().toISOString();
  patch.lost_reason = null;

  const r = await updateInChunks(ids, (chunk) => supabase.from("contacts").update(patch).eq("workspace_id", workspace.id).in("id", chunk).select("id"));

  for (const path of ["/crm", "/conversas", "/metricas"]) revalidatePath(path);
  if (r.failed) return { error: `Só ${r.updated} lead(s) foram movidos; o resto deu erro.`, updated: r.updated };
  return { error: null, updated: r.updated };
}

// Atribui o mesmo responsável (pessoa da equipe, sem login) a vários leads. Só mexe no responsável —
// a filial de cada lead continua a que estava.
export async function bulkAssignTeamMember(ids: string[], teamMemberId: string | null): Promise<BulkResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };
  if (ids.length === 0) return { error: "Selecione ao menos um lead." };
  if (ids.length > MAX_BULK) return { error: `Selecione no máximo ${MAX_BULK} leads por vez.` };

  const supabase = await createClient();
  if (teamMemberId) {
    const { data: member } = await supabase.from("team_members").select("id").eq("id", teamMemberId).eq("workspace_id", workspace.id).maybeSingle();
    if (!member) return { error: "Pessoa da equipe não encontrada." };
  }
  const r = await updateInChunks(ids, (chunk) =>
    supabase.from("contacts").update({ team_member_id: teamMemberId }).eq("workspace_id", workspace.id).in("id", chunk).select("id")
  );

  for (const path of ["/crm", "/contatos", "/conversas"]) revalidatePath(path);
  if (r.failed) return { error: `Só ${r.updated} lead(s) foram atribuídos; o resto deu erro.`, updated: r.updated };
  return { error: null, updated: r.updated };
}
