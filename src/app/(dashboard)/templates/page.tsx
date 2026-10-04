import { listWorkspaceTemplates } from "@/app/actions/templates";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { TemplatesManager, type CategoryAlert } from "@/components/templates-manager";

// Templates aprovados e em análise da conta oficial. Lê direto da Meta (status e categoria sempre atuais).
export default async function TemplatesPage() {
  const r = await listWorkspaceTemplates();
  const { workspace } = await getCurrentWorkspace();
  const alerts: CategoryAlert[] = [];
  if (workspace) {
    const { data } = await createAdminClient()
      .from("template_category_alerts")
      .select("id, template_name, previous_category, new_category, correct_category, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(20);
    for (const a of data || []) {
      alerts.push({
        id: a.id as string,
        name: a.template_name as string,
        previous: (a.previous_category as string) || null,
        next: (a.new_category as string) || null,
        correct: (a.correct_category as string) || null,
        at: a.created_at as string,
      });
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Templates</h1>
        <p className="text-text-muted text-sm mt-1">Mensagens da conta oficial do WhatsApp usadas em automações e no follow-up do agente.</p>
      </div>
      <TemplatesManager
        templates={r.error === null ? r.templates : []}
        mappings={r.error === null ? r.mappings : {}}
        fields={r.error === null ? r.fields : []}
        error={r.error}
        alerts={alerts}
      />
    </div>
  );
}
