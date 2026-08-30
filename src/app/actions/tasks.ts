"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";

export type ActionResult = { error: string | null; ok?: boolean };

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  completed_at: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  responsible_user_id: string | null;
  created_at: string;
};

function revalidateTaskPaths() {
  revalidatePath("/agenda");
  revalidatePath("/crm");
  revalidatePath("/empresas");
  revalidatePath("/negocios");
}

export async function addTask(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const title = String(formData.get("title") || "").trim();
  if (!title) return { error: "Informe o título da tarefa." };

  const dueAt = String(formData.get("dueAt") || "").trim() || null;
  const contactId = String(formData.get("contactId") || "").trim() || null;
  const companyId = String(formData.get("companyId") || "").trim() || null;
  const dealId = String(formData.get("dealId") || "").trim() || null;
  const responsibleUserId = String(formData.get("responsibleUserId") || "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspace.id,
    title,
    due_at: dueAt,
    contact_id: contactId,
    company_id: companyId,
    deal_id: dealId,
    responsible_user_id: responsibleUserId,
  });
  if (error) return { error: "Não foi possível criar a tarefa." };

  revalidateTaskPaths();
  return { error: null, ok: true };
}

// Criação rápida a partir de um drawer (contato/empresa/negócio) — só título + o vínculo já
// conhecido, sem passar por formulário completo.
export async function quickCreateTask(
  title: string,
  links: { contactId?: string | null; companyId?: string | null; dealId?: string | null }
): Promise<ActionResult> {
  const trimmed = title.trim();
  if (!trimmed) return { error: "Informe o título da tarefa." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspace.id,
    title: trimmed,
    contact_id: links.contactId || null,
    company_id: links.companyId || null,
    deal_id: links.dealId || null,
  });
  if (error) return { error: "Não foi possível criar a tarefa." };

  revalidateTaskPaths();
  return { error: null, ok: true };
}

// Lista de tarefas do workspace inteiro (com nomes dos vínculos, via join) — usada em /agenda.
export async function getTasksForOwner(responsibleUserId?: string): Promise<
  (TaskRow & { contact_name: string | null; company_name: string | null; deal_name: string | null })[]
> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  let query = supabase
    .from("tasks")
    .select(
      "id, title, description, due_at, completed_at, contact_id, company_id, deal_id, responsible_user_id, created_at, contacts(name), companies(name), deals(name)"
    )
    .eq("workspace_id", workspace.id)
    .order("due_at", { ascending: true, nullsFirst: false });

  if (responsibleUserId) query = query.eq("responsible_user_id", responsibleUserId);

  const { data } = await query;
  return (data || []).map((t) => {
    const { contacts, companies, deals, ...rest } = t as typeof t & {
      contacts: { name: string | null } | null;
      companies: { name: string } | null;
      deals: { name: string } | null;
    };
    return { ...rest, contact_name: contacts?.name ?? null, company_name: companies?.name ?? null, deal_name: deals?.name ?? null };
  });
}

// Tarefas vinculadas a um registro específico — usada nos drawers de contato/empresa/negócio.
export async function getTasksForRecord(kind: "contact" | "company" | "deal", id: string): Promise<TaskRow[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const column = kind === "contact" ? "contact_id" : kind === "company" ? "company_id" : "deal_id";
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, description, due_at, completed_at, contact_id, company_id, deal_id, responsible_user_id, created_at")
    .eq(column, id)
    .eq("workspace_id", workspace.id)
    .order("due_at", { ascending: true, nullsFirst: false });
  return data || [];
}

export async function toggleTaskCompleted(taskId: string, completed: boolean): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível atualizar a tarefa." };

  revalidateTaskPaths();
  return { error: null, ok: true };
}

export async function updateTaskInfo(
  taskId: string,
  fields: { title: string; description: string; dueAt: string; responsibleUserId: string }
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const title = fields.title.trim();
  if (!title) return { error: "Informe o título da tarefa." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      description: fields.description.trim() || null,
      due_at: fields.dueAt.trim() || null,
      responsible_user_id: fields.responsibleUserId.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível salvar." };

  revalidateTaskPaths();
  return { error: null, ok: true };
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível excluir a tarefa." };

  revalidateTaskPaths();
  return { error: null, ok: true };
}
