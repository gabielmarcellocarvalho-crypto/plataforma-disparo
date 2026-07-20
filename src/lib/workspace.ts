import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const ACTIVE_WORKSPACE_COOKIE = "active_workspace_id";

export type WorkspaceSummary = { id: string; name: string };

export type CurrentWorkspace = {
  workspace: WorkspaceSummary | null;
  isColaborador: boolean;
  allWorkspaces: WorkspaceSummary[];
};

// Resolve o workspace "ativo" da sessão atual:
// - cliente: sempre o único workspace do qual é membro.
// - colaborador (equipe da agência): o escolhido via cookie, ou o primeiro disponível, ou null se nenhum workspace existir ainda.
export async function getCurrentWorkspace(): Promise<CurrentWorkspace> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { workspace: null, isColaborador: false, allWorkspaces: [] };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();

  const isColaborador = profile?.role === "colaborador";

  if (isColaborador) {
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, name")
      .order("created_at", { ascending: true });

    const all = workspaces ?? [];
    const cookieStore = await cookies();
    const activeId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    const active = all.find((w) => w.id === activeId) ?? all[0] ?? null;

    return { workspace: active, isColaborador: true, allWorkspaces: all };
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspaces(id, name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const workspace = (membership?.workspaces as unknown as WorkspaceSummary | null) ?? null;
  return { workspace, isColaborador: false, allWorkspaces: workspace ? [workspace] : [] };
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

export { ACTIVE_WORKSPACE_COOKIE };
