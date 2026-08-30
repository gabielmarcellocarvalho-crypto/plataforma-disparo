"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getCurrentUserName } from "@/lib/workspace";
import { isDealStatus, type DealStage } from "@/lib/deal-stages";

export type ActionResult = { error: string | null; ok?: boolean };

export type DealRow = {
  id: string;
  name: string;
  amount: number | null;
  close_date: string | null;
  status: string;
  stage_id: string;
  stage_changed_at: string;
  created_at: string;
  company_id: string | null;
  contact_id: string | null;
  responsible_user_id: string | null;
};

// Pipeline + estágios ordenados do workspace — usado pela page /negocios pra montar as colunas do Kanban.
export async function getDefaultPipeline(workspaceId: string): Promise<{ pipelineId: string; stages: DealStage[] } | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return null;

  const supabase = await createClient();
  const { data: pipeline } = await supabase
    .from("deal_pipelines")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();
  if (!pipeline) return null;

  const { data: stages } = await supabase
    .from("deal_stages")
    .select("id, name, position, color, is_won, is_lost")
    .eq("pipeline_id", pipeline.id)
    .order("position", { ascending: true });

  return { pipelineId: pipeline.id, stages: stages || [] };
}

export async function addDeal(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Informe o nome do negócio." };

  const amountRaw = String(formData.get("amount") || "").trim();
  const amount = amountRaw ? Number(amountRaw.replace(",", ".")) : null;
  if (amountRaw && Number.isNaN(amount)) return { error: "Valor inválido." };

  const companyId = String(formData.get("companyId") || "").trim() || null;
  const contactId = String(formData.get("contactId") || "").trim() || null;
  let stageId = String(formData.get("stageId") || "").trim() || null;

  const supabase = await createClient();
  const pipeline = await getDefaultPipeline(workspace.id);
  if (!pipeline || pipeline.stages.length === 0) return { error: "Nenhum pipeline configurado neste workspace." };
  if (!stageId) stageId = pipeline.stages[0].id;

  const { error } = await supabase.from("deals").insert({
    workspace_id: workspace.id,
    pipeline_id: pipeline.pipelineId,
    stage_id: stageId,
    name,
    amount,
    company_id: companyId,
    contact_id: contactId,
  });
  if (error) return { error: "Não foi possível criar o negócio." };

  revalidatePath("/negocios");
  return { error: null, ok: true };
}

// Drag-drop do Kanban — espelha updateContactStage. Marca status won/lost automaticamente se o
// estágio de destino tiver is_won/is_lost, senão mantém 'open' (permite reabrir um negócio ganho/
// perdido movendo de volta pra um estágio do meio).
export async function updateDealStage(dealId: string, stageId: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("deal_stages")
    .select("is_won, is_lost")
    .eq("id", stageId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!stage) return { error: "Estágio inválido." };

  const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";

  const { error } = await supabase
    .from("deals")
    .update({ stage_id: stageId, status, stage_changed_at: new Date().toISOString() })
    .eq("id", dealId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível mover o negócio." };

  revalidatePath("/negocios");
  return { error: null, ok: true };
}

export async function updateDealInfo(
  dealId: string,
  fields: {
    name: string;
    amount: string;
    closeDate: string;
    companyId: string;
    contactId: string;
    responsibleUserId: string;
    customFields: Record<string, string>;
  }
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = fields.name.trim();
  if (!name) return { error: "Informe o nome do negócio." };

  const amountRaw = fields.amount.trim();
  const amount = amountRaw ? Number(amountRaw.replace(",", ".")) : null;
  if (amountRaw && Number.isNaN(amount)) return { error: "Valor inválido." };

  const cleanFields = Object.fromEntries(
    Object.entries(fields.customFields)
      .map(([k, v]) => [k.trim(), v.trim()])
      .filter(([k, v]) => k && v)
  );

  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({
      name,
      amount,
      close_date: fields.closeDate.trim() || null,
      company_id: fields.companyId.trim() || null,
      contact_id: fields.contactId.trim() || null,
      responsible_user_id: fields.responsibleUserId.trim() || null,
      custom_fields: cleanFields,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível salvar." };

  revalidatePath("/negocios");
  return { error: null, ok: true };
}

export type DealNote = { id: string; author_name: string | null; content: string; created_at: string };
export type DealDetail = DealRow & { custom_fields: Record<string, unknown> | null };

export async function getDealDetail(dealId: string): Promise<{ deal: DealDetail; notes: DealNote[] } | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const supabase = await createClient();
  const [{ data: deal }, { data: notes }] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, name, amount, close_date, status, stage_id, stage_changed_at, created_at, company_id, contact_id, responsible_user_id, custom_fields"
      )
      .eq("id", dealId)
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase.from("deal_notes").select("id, author_name, content, created_at").eq("deal_id", dealId).order("created_at", { ascending: false }),
  ]);
  if (!deal) return null;
  if (!isDealStatus(deal.status)) return null;

  return { deal, notes: notes || [] };
}

export async function addDealNote(dealId: string, content: string): Promise<ActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { error: "Escreva alguma coisa." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const authorName = await getCurrentUserName();
  const supabase = await createClient();
  const { error } = await supabase.from("deal_notes").insert({
    deal_id: dealId,
    workspace_id: workspace.id,
    author_name: authorName,
    content: trimmed,
  });
  if (error) return { error: "Não foi possível salvar a observação." };

  revalidatePath("/negocios");
  return { error: null, ok: true };
}

export type ContactDealRef = { id: string; name: string; amount: number | null; status: string; stage_id: string };

// Negócios vinculados a um contato — usado na seção "Negócios" do drawer de contato (crm-lead-drawer.tsx).
export async function getDealsForContact(contactId: string): Promise<ContactDealRef[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("deals")
    .select("id, name, amount, status, stage_id")
    .eq("contact_id", contactId)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });
  return data || [];
}

// Criação rápida de negócio a partir do drawer de contato — pré-preenche contact_id (e company_id,
// se o contato já tiver empresa vinculada).
export async function quickCreateDealForContact(contactId: string, name: string): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Informe o nome do negócio." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const [{ data: contact }, pipeline] = await Promise.all([
    supabase.from("contacts").select("company_id").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
    getDefaultPipeline(workspace.id),
  ]);
  if (!pipeline || pipeline.stages.length === 0) return { error: "Nenhum pipeline configurado neste workspace." };

  const { error } = await supabase.from("deals").insert({
    workspace_id: workspace.id,
    pipeline_id: pipeline.pipelineId,
    stage_id: pipeline.stages[0].id,
    name: trimmed,
    contact_id: contactId,
    company_id: contact?.company_id ?? null,
  });
  if (error) return { error: "Não foi possível criar o negócio." };

  revalidatePath("/negocios");
  revalidatePath("/crm");
  return { error: null, ok: true };
}

export async function deleteDeal(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("deals").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível excluir o negócio." };

  revalidatePath("/negocios");
  return { error: null, ok: true };
}

// Editor de estágios do pipeline (nome/ordem/cor/won/lost) — permite adicionar/remover estágio,
// diferente do StageLabelsEditor de contatos (que só renomeia as 7 fases fixas).
export async function updateDealStagesConfig(
  pipelineId: string,
  stages: { id?: string; name: string; position: number; color: string | null; is_won: boolean; is_lost: boolean }[]
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data: pipeline } = await supabase
    .from("deal_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!pipeline) return { error: "Pipeline inválido." };

  const keepIds = stages.filter((s) => s.id).map((s) => s.id as string);
  const { error: deleteError } = await supabase
    .from("deal_stages")
    .delete()
    .eq("pipeline_id", pipelineId)
    .eq("workspace_id", workspace.id)
    .not("id", "in", `(${keepIds.length > 0 ? keepIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
  if (deleteError) {
    if (deleteError.code === "23503") return { error: "Existem negócios nesse estágio, mova-os antes de excluir." };
    return { error: "Não foi possível remover estágios antigos." };
  }

  for (const stage of stages) {
    const name = stage.name.trim();
    if (!name) continue;
    if (stage.id) {
      await supabase
        .from("deal_stages")
        .update({ name, position: stage.position, color: stage.color, is_won: stage.is_won, is_lost: stage.is_lost })
        .eq("id", stage.id)
        .eq("workspace_id", workspace.id);
    } else {
      await supabase.from("deal_stages").insert({
        pipeline_id: pipelineId,
        workspace_id: workspace.id,
        name,
        position: stage.position,
        color: stage.color,
        is_won: stage.is_won,
        is_lost: stage.is_lost,
      });
    }
  }

  revalidatePath("/negocios");
  return { error: null, ok: true };
}
