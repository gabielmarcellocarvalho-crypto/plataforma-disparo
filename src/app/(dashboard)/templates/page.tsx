import { listWorkspaceTemplates } from "@/app/actions/templates";
import { TemplatesManager } from "@/components/templates-manager";

// Templates aprovados e em análise da conta oficial. Lê direto da Meta (status e categoria sempre atuais).
export default async function TemplatesPage() {
  const r = await listWorkspaceTemplates();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Templates</h1>
        <p className="text-text-muted text-sm mt-1">Mensagens da conta oficial do WhatsApp usadas em automações e no follow-up do agente.</p>
      </div>
      <TemplatesManager templates={r.error === null ? r.templates : []} error={r.error} />
    </div>
  );
}
