"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";

export type ActionResult = { error: string | null; ok?: boolean };

export type BranchRow = { id: string; name: string; city: string | null; phone: string | null; position: number };
export type TeamMemberRow = {
  id: string;
  name: string;
  role: string | null;
  branch_id: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

function revalidateAll() {
  for (const path of ["/equipe", "/crm", "/contatos", "/conversas", "/metricas"]) revalidatePath(path);
}

export async function listBranches(): Promise<BranchRow[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("branches")
    .select("id, name, city, phone, position")
    .eq("workspace_id", workspace.id)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data as BranchRow[] | null) ?? [];
}

export async function listTeamMembers(): Promise<TeamMemberRow[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("id, name, role, branch_id, phone, email, active")
    .eq("workspace_id", workspace.id)
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data as TeamMemberRow[] | null) ?? [];
}

// ── Filiais ───────────────────────────────────────────────────────────────

export async function saveBranch(
  id: string | null,
  fields: { name: string; city: string; phone: string }
): Promise<ActionResult & { id?: string }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = fields.name.trim().slice(0, 60);
  if (!name) return { error: "Dê um nome à filial." };

  const payload = { name, city: fields.city.trim() || null, phone: fields.phone.trim() || null };
  const supabase = await createClient();

  if (id) {
    const { error } = await supabase.from("branches").update(payload).eq("id", id).eq("workspace_id", workspace.id);
    if (error) return { error: error.code === "23505" ? "Já existe uma filial com esse nome." : "Não foi possível salvar a filial." };
    revalidateAll();
    return { error: null, ok: true, id };
  }

  const { count } = await supabase.from("branches").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id);
  const { data, error } = await supabase
    .from("branches")
    .insert({ ...payload, workspace_id: workspace.id, position: count ?? 0 })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.code === "23505" ? "Já existe uma filial com esse nome." : "Não foi possível criar a filial." };

  revalidateAll();
  return { error: null, ok: true, id: data?.id };
}

// Apagar filial não apaga lead nem pessoa — as FKs são `on delete set null`, os dois só ficam sem
// filial. Dito na UI antes de confirmar.
export async function deleteBranch(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("branches").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível remover a filial." };

  revalidateAll();
  return { error: null, ok: true };
}

// ── Pessoas ───────────────────────────────────────────────────────────────

export async function saveTeamMember(
  id: string | null,
  fields: { name: string; role: string; branchId: string; phone: string; email: string; active: boolean }
): Promise<ActionResult & { id?: string }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = fields.name.trim().slice(0, 80);
  if (!name) return { error: "Dê um nome à pessoa." };

  const payload = {
    name,
    role: fields.role.trim() || null,
    branch_id: fields.branchId || null,
    phone: fields.phone.trim() || null,
    email: fields.email.trim() || null,
    active: fields.active,
  };
  const supabase = await createClient();

  if (id) {
    const { error } = await supabase
      .from("team_members")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspace.id);
    if (error) return { error: error.code === "23505" ? "Já existe alguém com esse nome na equipe." : "Não foi possível salvar." };
    revalidateAll();
    return { error: null, ok: true, id };
  }

  const { data, error } = await supabase
    .from("team_members")
    .insert({ ...payload, workspace_id: workspace.id })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.code === "23505" ? "Já existe alguém com esse nome na equipe." : "Não foi possível criar." };

  revalidateAll();
  return { error: null, ok: true, id: data?.id };
}

// Preferir inativar a apagar: o histórico de "leads por vendedor" depende do registro continuar
// existindo. Apagar é oferecido só pra corrigir cadastro errado, e os leads dele ficam sem dono.
export async function deleteTeamMember(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("team_members").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível remover a pessoa." };

  revalidateAll();
  return { error: null, ok: true };
}

// ── Atribuição do lead ────────────────────────────────────────────────────

// Quem ficou com o lead na rede do cliente (vendedor/gerente sem login) e em qual filial. Não
// confundir com `updateContactResponsible`, que aponta pra uma CONTA da plataforma.
export async function updateContactAssignment(
  contactId: string,
  fields: { teamMemberId: string | null; branchId: string | null }
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ team_member_id: fields.teamMemberId || null, branch_id: fields.branchId || null })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível salvar a atribuição." };

  for (const path of ["/crm", "/contatos", "/conversas"]) revalidatePath(path);
  return { error: null, ok: true };
}
