import { listDialog360WorkspaceTemplates, listWorkspaceTemplates } from "@/app/actions/templates";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { TemplatesManager, type CategoryAlert } from "@/components/templates-manager";

// Templates aprovados e em análise da conta oficial. Lê direto da Meta (status e categoria sempre atuais).
export default async function TemplatesPage() {
  const meta = await listWorkspaceTemplates();
  // Sem número direto pela Meta, cai nos templates aprovados do 360dialog (só leitura).
  const d360 = meta.error !== null ? await listDialog360WorkspaceTemplates() : null;
  const viaDialog360 = d360 !== null && d360.error === null;
  const r = viaDialog360 ? { error: null, templates: d360.templates, mappings: {}, fields: [] } : meta;
  const { workspace } = await getCurrentWorkspace();
  const alerts: CategoryAlert[] = [];
  // Em quantas automações cada template é usado (nome do template → nº de automações).
  const usage: Record<string, number> = {};
  if (workspace) {
    const { data: steps } = await createAdminClient()
      .from("workflow_steps")
      .select("workflow_id, config")
      .eq("workspace_id", workspace.id)
      .not("config->template->>name", "is", null);
    const seen = new Set<string>();
    for (const st of steps || []) {
      const tplName = (st.config as { template?: { name?: string } | null })?.template?.name;
      if (!tplName || seen.has(`${tplName}|${st.workflow_id}`)) continue;
      seen.add(`${tplName}|${st.workflow_id}`);
      usage[tplName] = (usage[tplName] || 0) + 1;
    }
  }
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
        usage={usage}
        readOnly={viaDialog360}
      />
    </div>
  );
}
