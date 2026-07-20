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
      <Link href="/novo-cliente" className="text-xs font-bold text-primary-strong hover:underline">
        + novo cliente
      </Link>
    </div>
  ) : (
    <div className="text-sm font-extrabold truncate">{workspace.name}</div>
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar workspaceSlot={workspaceSlot} isColaborador={isColaborador} />
      <div className="flex-1 flex flex-col ml-[250px] min-w-0">
        <header className="h-16 border-b border-border bg-surface flex items-center justify-between px-7 gap-4">
          <span className="text-sm font-semibold text-text-muted">{user?.email}</span>
          <form action={signOut}>
            <button type="submit" className="text-sm font-semibold text-text-muted hover:text-text">
              Sair
            </button>
          </form>
        </header>
        <main className="flex-1 p-7 max-w-[1280px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
