import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { DashboardShell } from "@/components/dashboard-shell";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import Link from "next/link";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { workspace, isStaff, isDeveloper, allWorkspaces, accessType, hiddenPages } = await getCurrentWorkspace();

  // Pontos de atenção (agente travado ou só sinalizando) desse workspace — vira o badge da aba Conversas.
  const { count: attentionCount } = workspace
    ? await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .or("needs_attention.eq.true,flagged_reason.not.is.null")
    : { count: 0 };

  // Tarefas abertas vencidas ou que vencem até o fim de hoje (Brasília) — contador de "Tarefas" no menu.
  const fimDeHoje = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })}T23:59:59-03:00`).toISOString();
  const { count: tasksCount } = workspace
    ? await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .is("completed_at", null)
        .lte("due_at", fimDeHoje)
    : { count: 0 };

  // Nenhum workspace existe ainda: só developer consegue criar o primeiro (RLS de "workspaces"
  // exige is_agency_admin() — colaborador escopado não consegue mesmo se tentasse).
  if (!workspace) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4 gap-4">
        {isDeveloper ? (
          <CreateWorkspaceForm />
        ) : (
          <p className="text-text-muted text-sm">
            Você ainda não foi adicionado a nenhum workspace. Peça pra agência te convidar.
          </p>
        )}
      </div>
    );
  }

  // Switcher aparece pra qualquer staff com mais de 1 workspace vinculado (colaborador pode ter mais
  // de um, developer sempre vê todos) — "+ novo cliente" só developer (mesma trava do RLS acima).
  const workspaceSlot = isStaff ? (
    <div className="flex flex-col gap-2">
      <WorkspaceSwitcher workspaces={allWorkspaces} currentId={workspace.id} canDelete={isDeveloper} />
      {isDeveloper && (
        <Link href="/novo-cliente" className="text-xs font-bold text-sidebar-text hover:text-white transition-colors">
          + novo cliente
        </Link>
      )}
    </div>
  ) : (
    <div className="text-sm font-extrabold text-white truncate">{workspace.name}</div>
  );

  // Versão compacta do workspace, pro estado recolhido do menu. Montada aqui (Server Component) porque
  // depende do nome do workspace, que a sidebar não tem.
  const workspaceCompact = (
    <div
      className="grid place-items-center w-9 h-9 mx-auto rounded-lg bg-white/10 text-white text-xs font-extrabold"
      title={workspace.name}
      aria-label={`Workspace atual: ${workspace.name}`}
    >
      {workspace.name.trim().slice(0, 2).toUpperCase()}
    </div>
  );

  return (
    <DashboardShell
      workspaceSlot={workspaceSlot}
      workspaceCompact={workspaceCompact}
      userEmail={user?.email ?? ""}
      isStaff={isStaff}
      isDeveloper={isDeveloper}
      accessType={accessType}
      hiddenPages={hiddenPages}
      attentionCount={attentionCount ?? 0}
      tasksCount={tasksCount ?? 0}
      workspaceName={workspace.name}
    >
      {children}
    </DashboardShell>
  );
}
