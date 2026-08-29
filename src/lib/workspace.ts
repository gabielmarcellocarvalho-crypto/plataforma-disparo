import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAccessType, type AccessType } from "@/lib/access-types";

const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id";

export type WorkspaceSummary = { id: string; name: string };

export type CurrentWorkspace = {
  workspace: WorkspaceSummary | null;
  isColaborador: boolean;
  allWorkspaces: WorkspaceSummary[];
  // null pra colaborador (sem restrição) e pra cliente ainda não classificado — ver access-types.ts.
  accessType: AccessType | null;
};

// Resolve o workspace "ativo" da sessão atual:
// - cliente: sempre o único workspace do qual é membro.
// - colaborador (equipe da agência): o escolhido via cookie, ou o primeiro disponível, ou null se nenhum workspace existir ainda.
export async function getCurrentWorkspace(): Promise<CurrentWorkspace> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { workspace: null, isColaborador: false, allWorkspaces: [], accessType: null };

  const { data: profile } = await supabase.from("profiles").select("role, access_type").eq("id", user.id).maybeSingle();

  const isColaborador = profile?.role === "colaborador";
  const accessType = !isColaborador && isAccessType(profile?.access_type) ? profile.access_type : null;

  if (isColaborador) {
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, name")
      .order("created_at", { ascending: true });

    const all = workspaces ?? [];
    const cookieStore = await cookies();
    const activeId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    const active = all.find((w) => w.id === activeId) ?? all[0] ?? null;

    return { workspace: active, isColaborador: true, allWorkspaces: all, accessType: null };
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspaces(id, name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const workspace = (membership?.workspaces as unknown as WorkspaceSummary | null) ?? null;
  return { workspace, isColaborador: false, allWorkspaces: workspace ? [workspace] : [], accessType };
}

// Redireciona pra "/" se o cliente logado não tem esse path liberado no tipo de acesso dele
// (colaborador nunca é bloqueado). Chamar no topo das páginas restritas (Agentes, Configurações
// são colaborador-only; Campanhas/Métricas dependem do tipo de acesso do cliente).
export async function assertPageAccess(path: string, opts: { colaboradorOnly?: boolean } = {}): Promise<void> {
  const { redirect } = await import("next/navigation");
  const { canAccessPage } = await import("@/lib/access-types");
  const { isColaborador, accessType } = await getCurrentWorkspace();
  if (isColaborador) return;
  if (opts.colaboradorOnly || !canAccessPage(accessType, path)) redirect("/");
}

// Checagem rápida (sem precisar resolver o workspace ativo) — usada em telas internas
// como a calculadora, que não fazem sentido pra um usuário "cliente".
export async function isCurrentUserColaborador(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "colaborador";
}

// Wrapper único pra Server Actions colaborador-only (ex.: tudo em src/app/actions/agents.ts — nenhum
// tipo de acesso de cliente inclui "/agentes" em access-types.ts). `assertPageAccess` já bloqueia a
// PÁGINA, mas Server Actions são chamáveis diretamente (fetch pro endpoint da action, reproduzindo o
// payload) sem passar pela página — cada mutação sensível precisa checar de novo. Lança em vez de
// devolver boolean pra não ser esquecido por engano num `if` que não existe.
export async function requireColaborador(): Promise<void> {
  if (!(await isCurrentUserColaborador())) throw new Error("Sem permissão.");
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
