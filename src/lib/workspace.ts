import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAccessType, type AccessType } from "@/lib/access-types";

const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id";

export type WorkspaceSummary = { id: string; name: string };

export type CurrentWorkspace = {
  workspace: WorkspaceSummary | null;
  // Staff = colaborador OU developer: acesso completo (agentes, custo, config) aos workspaces em que
  // atua — nunca restrito por access_type como cliente. Não confundir com "vê todos os workspaces",
  // isso é só isDeveloper (colaborador é escopado a workspace(s) específico(s)).
  isStaff: boolean;
  // Developer = topo da hierarquia: enxerga/opera TODOS os workspaces, único que acessa Acessos,
  // Calculadora, cria ou remove cliente. colaborador não é developer (ver migration 0059).
  isDeveloper: boolean;
  allWorkspaces: WorkspaceSummary[];
  // null pra staff (sem restrição) e pra cliente ainda não classificado — ver access-types.ts.
  accessType: AccessType | null;
};

// Resolve o workspace "ativo" da sessão atual:
// - cliente: sempre o único workspace do qual é membro.
// - colaborador: escolhido via cookie (ou o primeiro), dentre só os workspaces em que foi adicionado
//   via workspace_members — pode ter mais de um, mesmo mecanismo de cliente, sem o limite de 1.
// - developer: escolhido via cookie (ou o primeiro), dentre TODOS os workspaces existentes.
export async function getCurrentWorkspace(): Promise<CurrentWorkspace> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { workspace: null, isStaff: false, isDeveloper: false, allWorkspaces: [], accessType: null };

  const { data: profile } = await supabase.from("profiles").select("role, access_type").eq("id", user.id).maybeSingle();
  const role = profile?.role ?? "cliente";
  const isDeveloper = role === "developer";
  const isStaff = isDeveloper || role === "colaborador";
  const accessType = !isStaff && isAccessType(profile?.access_type) ? profile.access_type : null;

  if (isDeveloper) {
    const { data: workspaces } = await supabase.from("workspaces").select("id, name").order("created_at", { ascending: true });
    const all = workspaces ?? [];
    const cookieStore = await cookies();
    const activeId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    const active = all.find((w) => w.id === activeId) ?? all[0] ?? null;
    return { workspace: active, isStaff: true, isDeveloper: true, allWorkspaces: all, accessType: null };
  }

  // colaborador (escopado) e cliente compartilham a mesma fonte — workspace_members — a diferença é
  // só que colaborador pode ter mais de 1 vínculo (com cookie pra escolher qual está ativo) e cliente
  // sempre tem exatamente 1.
  const { data: memberships } = await supabase.from("workspace_members").select("workspaces(id, name)").eq("user_id", user.id);
  const all = (memberships || []).map((m) => m.workspaces as unknown as WorkspaceSummary).filter(Boolean);

  if (isStaff) {
    const cookieStore = await cookies();
    const activeId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    const active = all.find((w) => w.id === activeId) ?? all[0] ?? null;
    return { workspace: active, isStaff: true, isDeveloper: false, allWorkspaces: all, accessType: null };
  }

  const workspace = all[0] ?? null;
  return { workspace, isStaff: false, isDeveloper: false, allWorkspaces: workspace ? [workspace] : [], accessType };
}

// Redireciona pra "/" se o cliente logado não tem esse path liberado no tipo de acesso dele (staff
// nunca é bloqueado). Chamar no topo das páginas restritas (Agentes é staffOnly; Campanhas/Métricas
// dependem do tipo de acesso do cliente).
export async function assertPageAccess(path: string, opts: { staffOnly?: boolean } = {}): Promise<void> {
  const { redirect } = await import("next/navigation");
  const { canAccessPage } = await import("@/lib/access-types");
  const { isStaff, accessType } = await getCurrentWorkspace();
  if (isStaff) return;
  if (opts.staffOnly || !canAccessPage(accessType, path)) redirect("/");
}

// Checagens rápidas (sem precisar resolver o workspace ativo) — usadas em telas internas e Server
// Actions que precisam confirmar o papel de quem chama antes de mutar algo.
export async function isCurrentUserStaff(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "colaborador" || profile?.role === "developer";
}

export async function isCurrentUserDeveloper(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "developer";
}

// Wrappers únicos pra Server Actions restritas — lançam em vez de devolver boolean pra não serem
// esquecidos por engano num `if` que não existe. `requireStaff` cobre mutação de um workspace
// específico (agentes, config); `requireDeveloper` cobre ação agência-wide (criar acesso, apagar
// cliente) — Server Actions são chamáveis direto (fetch reproduzindo o payload) sem passar pela
// página, então cada mutação sensível precisa checar de novo, a página sozinha não basta.
export async function requireStaff(): Promise<void> {
  if (!(await isCurrentUserStaff())) throw new Error("Sem permissão.");
}

export async function requireDeveloper(): Promise<void> {
  if (!(await isCurrentUserDeveloper())) throw new Error("Sem permissão.");
}

// Nome de quem está logado agora — usado pra assinar observações deixadas num lead do CRM.
export async function getCurrentUserName(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "alguém";
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return profile?.full_name || user.email || "alguém";
}

export { ACTIVE_WORKSPACE_COOKIE };
