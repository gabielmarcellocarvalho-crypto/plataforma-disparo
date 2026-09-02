import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getAutomationRules } from "@/app/actions/automation-rules";
import { getWorkflows } from "@/app/actions/workflows";
import { AutomationRulesForm } from "@/components/automation-rules-form";
import { WorkflowList } from "@/components/workflow-list";

export default async function AutomacoesPage() {
  const { workspace } = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-extrabold tracking-tight">Automações</h1>
      </div>
    );
  }

  const [rules, workflows, members] = await Promise.all([
    getAutomationRules(workspace.id),
    getWorkflows(),
    createAdminClient()
      .from("workspace_members")
      .select("user_id, profiles(full_name)")
      .eq("workspace_id", workspace.id)
      .then(({ data }) => (data || []).map((m) => ({ id: m.user_id as string, name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name || "sem nome" }))),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Automações</h1>
        <p className="text-text-muted text-sm mt-1">
          Workflows disparados por gatilho do CRM, e a regra simples de contato parado.
        </p>
      </div>

      <WorkflowList workspaceId={workspace.id} workflows={workflows} members={members} />

      <div className="flex flex-col gap-2 border-t border-border pt-6">
        <div>
          <h2 className="text-sm font-bold text-text">Regra simples</h2>
          <p className="text-xs text-text-muted mt-0.5">Regra fixa (sem passos): cria uma tarefa quando um contato fica parado.</p>
        </div>
        <AutomationRulesForm workspaceId={workspace.id} rules={rules} />
      </div>
    </div>
  );
}
