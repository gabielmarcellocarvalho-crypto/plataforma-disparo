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

  const { workspace, isColaborador, allWorkspaces } = await getCurrentWorkspace();

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

  return (
    <div className="flex min-h-screen">
      <Sidebar workspaceSlot={workspaceSlot} isColaborador={isColaborador} />
      <div className="flex-1 flex flex-col ml-[250px] min-w-0">
        <header className="h-16 border-b border-border bg-surface/80 backdrop-blur-sm flex items-center justify-between px-7 gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid place-items-center w-8 h-8 rounded-full bg-primary-soft text-primary-strong text-xs font-bold shrink-0" aria-hidden>
              {initial}
            </span>
            <span className="text-sm font-semibold text-text truncate">{user?.email}</span>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sair
            </button>
          </form>
        </header>
        <main className="flex-1 p-7 max-w-[1280px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
