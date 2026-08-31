import { getCurrentWorkspace } from "@/lib/workspace";
import { getAutomationRules } from "@/app/actions/automation-rules";
import { AutomationRulesForm } from "@/components/automation-rules-form";

export default async function AutomacoesPage() {
  const { workspace } = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-extrabold tracking-tight">Automações</h1>
      </div>
    );
  }

  const rules = await getAutomationRules(workspace.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Automações</h1>
        <p className="text-text-muted text-sm mt-1">
          Regras prontas que criam tarefas automaticamente quando um contato fica parado.
        </p>
      </div>

      <AutomationRulesForm workspaceId={workspace.id} rules={rules} />
    </div>
  );
}
