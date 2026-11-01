"use server";

import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { hitRateLimit } from "@/lib/rate-limit-db";

// Convite de usuário feito pelo próprio cliente, SEMPRE dentro do workspace ativo dele. Quem convida nunca
// escolhe papel nem workspace: o novo login nasce como "cliente", vinculado só a este workspace e com o mesmo
// tipo de acesso (plano) de quem convidou. Colaborador/developer continuam sendo criados só em /acessos.

export type WorkspaceUser = { id: string; email: string; name: string | null; isSelf: boolean };
export type InviteState = { error: string | null; ok?: boolean; email?: string; tempPassword?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function listWorkspaceUsers(): Promise<WorkspaceUser[]> {
  const { workspace } = await getCurrentWorkspace();
  const me = await currentUserId();
  if (!workspace || !me) return [];

  const admin = createAdminClient();
  const { data: members } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspace.id);
  const ids = (members || []).map((m) => m.user_id as string);
  if (ids.length === 0) return [];

  const [{ data: profiles }, usersList] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", ids),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const nameById = new Map((profiles || []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]));
  const emailById = new Map((usersList.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  return ids
    .map((id) => ({ id, email: emailById.get(id) ?? "", name: nameById.get(id) ?? null, isSelf: id === me }))
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || (a.name || a.email).localeCompare(b.name || b.email, "pt-BR"));
}

export async function inviteWorkspaceUser(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const { workspace, isStaff, accessType } = await getCurrentWorkspace();
  const me = await currentUserId();
  if (!workspace || !me) return { error: "Nenhum workspace ativo." };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") || "").trim().slice(0, 120);
  if (!EMAIL_RE.test(email) || email.length > 200) return { error: "Informe um e-mail válido." };

  // Limite por workspace: convite cria login de verdade, não pode virar fábrica de contas.
  const limit = await hitRateLimit(`invite:ws:${workspace.id}`, 10, 3600);
  if (!limit.allowed) return { error: "Muitos convites em pouco tempo. Tente de novo mais tarde." };

  const admin = createAdminClient();
  // Senha provisória forte, mostrada uma única vez a quem convidou. A pessoa pode trocar depois em "Esqueci minha senha".
  const tempPassword = randomBytes(12).toString("base64url");
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName || null },
  });
  if (createErr || !created?.user) {
    // Não revela de quem é o e-mail: só diz que já existe um login com ele.
    return { error: createErr?.message?.includes("already") ? "Já existe um login com esse e-mail. Peça ao suporte para vinculá-lo." : "Não foi possível criar o acesso." };
  }

  const userId = created.user.id;
  const { error: roleErr } = await admin
    .from("profiles")
    .update({ role: "cliente", full_name: fullName || null, access_type: isStaff ? null : accessType })
    .eq("id", userId);
  if (roleErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { error: "Não foi possível criar o acesso. Tente de novo." };
  }
  const { error: memberErr } = await admin.from("workspace_members").insert({ workspace_id: workspace.id, user_id: userId, role: "member" });
  if (memberErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { error: "Não foi possível vincular o usuário ao workspace. Tente de novo." };
  }

  return { error: null, ok: true, email, tempPassword };
}

// Tira o acesso de alguém DESTE workspace. Se o login não tiver mais nenhum workspace, é apagado junto.
export async function removeWorkspaceUser(userId: string): Promise<{ error: string | null }> {
  const { workspace } = await getCurrentWorkspace();
  const me = await currentUserId();
  if (!workspace || !me) return { error: "Nenhum workspace ativo." };
  if (userId === me) return { error: "Você não pode remover o seu próprio acesso." };

  const admin = createAdminClient();
  const { data: membership } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle();
  if (!membership) return { error: "Esse usuário não faz parte deste workspace." };

  // Só remove logins de cliente: equipe da agência (colaborador) é gerenciada em /acessos.
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profile?.role !== "cliente") return { error: "Esse acesso é da equipe da agência e só ela pode remover." };

  const { error } = await admin.from("workspace_members").delete().eq("workspace_id", workspace.id).eq("user_id", userId);
  if (error) return { error: "Não foi possível remover o acesso." };

  const { count } = await admin.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) === 0) await admin.auth.admin.deleteUser(userId).catch(() => {});
  return { error: null };
}
