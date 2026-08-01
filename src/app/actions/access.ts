"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserColaborador } from "@/lib/workspace";
import { isAccessType } from "@/lib/access-types";

export type CreateAccessState = { error: string | null; ok?: boolean };

// Cria um acesso (login) novo — cliente (restrito a um workspace) ou colaborador (equipe da
// agência, vê tudo). Usa o Auth admin do Supabase: o usuário já nasce confirmado, com senha
// definida aqui (a agência repassa pro cliente). Só colaborador pode criar acessos.
export async function createAccess(_prev: CreateAccessState, formData: FormData): Promise<CreateAccessState> {
  if (!(await isCurrentUserColaborador())) return { error: "Sem permissão." };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const fullName = String(formData.get("full_name") || "").trim();
  const role = String(formData.get("role") || "cliente");
  const workspaceId = String(formData.get("workspace_id") || "");
  const accessType = String(formData.get("access_type") || "");

  if (!email || !password) return { error: "E-mail e senha são obrigatórios." };
  if (password.length < 6) return { error: "A senha precisa de pelo menos 6 caracteres." };
  if (role !== "cliente" && role !== "colaborador") return { error: "Tipo de acesso inválido." };
  if (role === "cliente" && !workspaceId) return { error: "Escolha o cliente (workspace) desse acesso." };
  if (role === "cliente" && !isAccessType(accessType)) return { error: "Escolha o plano/tipo de acesso desse cliente." };

  const admin = createAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || null },
  });
  if (createErr || !created?.user) {
    return { error: createErr?.message?.includes("already") ? "Já existe um acesso com esse e-mail." : "Não foi possível criar o acesso." };
  }

  const userId = created.user.id;
  // O trigger handle_new_user já criou o profile (role padrão 'cliente'); aqui ajusta o papel/nome.
  await admin
    .from("profiles")
    .update({ role, full_name: fullName || null, access_type: role === "cliente" ? accessType : null })
    .eq("id", userId);

  // Cliente é vinculado a um workspace específico (colaborador enxerga todos, não precisa de vínculo).
  if (role === "cliente") {
    await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "member" });
  }

  revalidatePath("/acessos");
  return { error: null, ok: true };
}

// Reclassifica o plano/tipo de acesso de um cliente já existente (ex.: quem foi criado antes desse
// campo existir, ou mudou de plano) — só se aplica a role 'cliente'.
export async function updateAccessType(userId: string, accessType: string): Promise<{ error: string | null }> {
  if (!(await isCurrentUserColaborador())) return { error: "Sem permissão." };
  if (!isAccessType(accessType)) return { error: "Tipo de acesso inválido." };

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ access_type: accessType }).eq("id", userId).eq("role", "cliente");
  if (error) return { error: "Não foi possível atualizar o tipo de acesso." };

  revalidatePath("/acessos");
  return { error: null };
}

export async function deleteAccess(userId: string): Promise<{ error: string | null }> {
  if (!(await isCurrentUserColaborador())) return { error: "Sem permissão." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) return { error: "Não é possível remover o próprio acesso." };

  const admin = createAdminClient();

  // Se o alvo é colaborador, impede apagar o último — sem isso a agência fica sem ninguém com
  // acesso administrativo, e ninguém consegue mais criar acessos novos pra corrigir.
  const { data: target } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (target?.role === "colaborador") {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "colaborador");
    if ((count ?? 0) <= 1) return { error: "Não é possível remover o último colaborador com acesso administrativo." };
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: "Não foi possível remover o acesso." };
  revalidatePath("/acessos");
  return { error: null };
}
