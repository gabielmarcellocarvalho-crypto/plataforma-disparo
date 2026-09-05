"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { isContactStage, type ContactStage } from "@/lib/crm-stages";
import { validateStages, stageForSignal, type Pipeline, type PipelineStage } from "@/lib/pipelines";

export type ActionResult = { error: string | null; ok?: boolean };

export type PipelineWithStages = Pipeline & { stages: PipelineStage[] };

export async function listPipelines(): Promise<PipelineWithStages[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const [{ data: funis }, { data: etapas }] = await Promise.all([
    supabase.from("pipelines").select("id, name, position, is_default").eq("workspace_id", workspace.id).order("position"),
    supabase
      .from("pipeline_stages")
      .select("id, pipeline_id, name, signal, position")
      .eq("workspace_id", workspace.id)
      .order("position"),
  ]);

  const porFunil = new Map<string, PipelineStage[]>();
  for (const e of etapas ?? []) {
    const stage: PipelineStage = {
      id: e.id,
      pipeline_id: e.pipeline_id,
      name: e.name,
      signal: isContactStage(e.signal) ? e.signal : "abordado",
      position: e.position,
    };
    if (!porFunil.has(e.pipeline_id)) porFunil.set(e.pipeline_id, []);
    porFunil.get(e.pipeline_id)!.push(stage);
  }

  return (funis ?? []).map((f) => ({ ...f, stages: porFunil.get(f.id) ?? [] }));
}

export type StageDraft = { id?: string; name: string; signal: string };

function limparEtapas(draft: StageDraft[]): { name: string; signal: ContactStage; id?: string }[] {
  return draft
    .map((e) => ({
      id: e.id,
      name: String(e.name ?? "").trim().slice(0, 40),
      signal: (isContactStage(e.signal) ? e.signal : "abordado") as ContactStage,
    }))
    .filter((e) => e.name);
}

// Cria ou reescreve um funil inteiro (nome + etapas), porque é assim que se edita um funil na tela:
// mexe-se em várias etapas e salva de uma vez.
export async function savePipeline(
  id: string | null,
  fields: { name: string; isDefault: boolean; stages: StageDraft[] }
): Promise<ActionResult & { id?: string }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = fields.name.trim().slice(0, 60);
  if (!name) return { error: "Dê um nome ao funil." };

  const etapas = limparEtapas(fields.stages);
  const invalido = validateStages(etapas);
  if (invalido) return { error: invalido };

  const supabase = await createClient();

  // Só um funil padrão por workspace (índice único no banco) — tirar a marca dos outros antes evita
  // que o insert/update esbarre na constraint.
  if (fields.isDefault) {
    await supabase.from("pipelines").update({ is_default: false }).eq("workspace_id", workspace.id);
  }

  let pipelineId = id;
  if (pipelineId) {
    const { error } = await supabase
      .from("pipelines")
      .update({ name, is_default: fields.isDefault })
      .eq("id", pipelineId)
      .eq("workspace_id", workspace.id);
    if (error) return { error: "Não foi possível salvar o funil." };
  } else {
    const { count } = await supabase
      .from("pipelines")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id);
    const { data, error } = await supabase
      .from("pipelines")
      // O primeiro funil do workspace nasce padrão: sem isso, lead novo não teria onde cair.
      .insert({ workspace_id: workspace.id, name, position: count ?? 0, is_default: fields.isDefault || (count ?? 0) === 0 })
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: "Não foi possível criar o funil." };
    pipelineId = data.id;
  }

  // Etapa que sumiu da tela é removida; os leads que estavam nela caem pra `pipeline_stage_id` null
  // (FK on delete set null) e o board os recoloca pelo SINAL, que nunca se perde.
  const mantidas = etapas.map((e) => e.id).filter(Boolean) as string[];
  let apagar = supabase.from("pipeline_stages").delete().eq("pipeline_id", pipelineId).eq("workspace_id", workspace.id);
  if (mantidas.length > 0) apagar = apagar.not("id", "in", `(${mantidas.join(",")})`);
  await apagar;

  for (let i = 0; i < etapas.length; i++) {
    const e = etapas[i];
    if (e.id) {
      await supabase
        .from("pipeline_stages")
        .update({ name: e.name, signal: e.signal, position: i })
        .eq("id", e.id)
        .eq("workspace_id", workspace.id);
    } else {
      await supabase.from("pipeline_stages").insert({
        workspace_id: workspace.id,
        pipeline_id: pipelineId,
        name: e.name,
        signal: e.signal,
        position: i,
      });
    }
  }

  revalidatePath("/crm");
  return { error: null, ok: true, id: pipelineId ?? undefined };
}

// Apagar o funil não apaga lead: as FKs são `on delete set null`, e o board volta a mostrar esses
// leads no modo de 7 fases, cada um na fase do seu sinal.
export async function deletePipeline(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("pipelines").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível remover o funil." };

  revalidatePath("/crm");
  return { error: null, ok: true };
}

// Mover o card dentro de um funil. Grava as DUAS coisas: a etapa visível e o sinal por trás dela —
// é o sinal que mantém agente, métricas e workflows funcionando sem saber que funil existe.
export async function moveContactToStage(contactId: string, stageId: string, lostReason?: string | null): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data: etapa } = await supabase
    .from("pipeline_stages")
    .select("id, pipeline_id, signal")
    .eq("id", stageId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!etapa || !isContactStage(etapa.signal)) return { error: "Etapa inválida." };

  const { error } = await supabase
    .from("contacts")
    .update({
      pipeline_id: etapa.pipeline_id,
      pipeline_stage_id: etapa.id,
      stage: etapa.signal,
      stage_changed_at: new Date().toISOString(),
      lost_reason: etapa.signal === "descartado" ? lostReason?.trim() || null : null,
    })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível mover o contato." };

  for (const path of ["/crm", "/conversas", "/metricas"]) revalidatePath(path);
  return { error: null, ok: true };
}

// Passa o lead pra outro funil, colocando-o na etapa que corresponde ao sinal que ele já tem —
// quem estava "em proposta" continua "em proposta" no funil novo, e não volta pro começo.
export async function moveContactToPipeline(contactId: string, pipelineId: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const [{ data: contato }, { data: etapas }] = await Promise.all([
    supabase.from("contacts").select("stage").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
    supabase
      .from("pipeline_stages")
      .select("id, pipeline_id, name, signal, position")
      .eq("pipeline_id", pipelineId)
      .eq("workspace_id", workspace.id)
      .order("position"),
  ]);
  if (!contato) return { error: "Contato não encontrado." };

  const lista: PipelineStage[] = (etapas ?? []).map((e) => ({
    id: e.id,
    pipeline_id: e.pipeline_id,
    name: e.name,
    signal: isContactStage(e.signal) ? e.signal : "abordado",
    position: e.position,
  }));
  const alvo = stageForSignal(isContactStage(contato.stage) ? contato.stage : "nao_abordado", lista);
  if (!alvo) return { error: "Esse funil ainda não tem etapas." };

  const { error } = await supabase
    .from("contacts")
    .update({ pipeline_id: pipelineId, pipeline_stage_id: alvo.id, stage_changed_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível mudar o funil." };

  revalidatePath("/crm");
  return { error: null, ok: true };
}
