import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { getCurrentWorkspace } from "@/lib/workspace";
import { Sidebar } from "@/components/sidebar";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import Link from "next/link";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { workspace, isColaborador, allWorkspaces, accessType } = await getCurrentWorkspace();

  // Pontos de atenção (agente travado ou só sinalizando) desse workspace — vira o badge da aba Conversas.
  const { count: attentionCount } = workspace
    ? await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .or("needs_attention.eq.true,flagged_reason.not.is.null")
    : { count: 0 };

  // Nenhum workspace existe ainda: só um colaborador consegue criar o primeiro.
  if (!workspace) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4 gap-4">
        {isColaborador ? (
          <CreateWorkspaceForm />
        ) : (
          <p className="text-text-muted text-sm">
            Você ainda não foi adicionado a nenhum workspace. Peça pra agência te convidar.
          </p>
        )}
      </div>
    );
  }

  const workspaceSlot = isColaborador ? (
    <div className="flex flex-col gap-2">
      <WorkspaceSwitcher workspaces={allWorkspaces} currentId={workspace.id} />
      <Link href="/novo-cliente" className="text-xs font-bold text-sidebar-text hover:text-white transition-colors">
        + novo cliente
      </Link>
    </div>
  ) : (
    <div className="text-sm font-extrabold text-white truncate">{workspace.name}</div>
  );

  const initial = (user?.email || "?").charAt(0).toUpperCase();

  const userSlot = (
    <div className="flex items-center gap-2 px-1 pt-3 pb-1">
      <span className="grid place-items-center w-7 h-7 rounded-full bg-white/10 text-white text-[11px] font-bold shrink-0" aria-hidden>
        {initial}
      </span>
      <span className="text-xs font-semibold text-sidebar-text truncate flex-1 min-w-0" title={user?.email ?? ""}>
        {user?.email}
      </span>
      <form action={signOut}>
        <button
          type="submit"
          title="Sair"
          aria-label="Sair"
          className="grid place-items-center w-7 h-7 rounded-md text-sidebar-muted hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar workspaceSlot={workspaceSlot} userSlot={userSlot} isColaborador={isColaborador} accessType={accessType} attentionCount={attentionCount ?? 0} />
      <div className="flex-1 flex flex-col ml-[250px] min-w-0">
        <main className="flex-1 p-7 max-w-[1280px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
