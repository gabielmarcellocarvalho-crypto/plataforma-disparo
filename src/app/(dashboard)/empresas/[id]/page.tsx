import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertPageAccess, getCurrentWorkspace } from "@/lib/workspace";
import { getCompanyDetail } from "@/app/actions/companies";
import { getTasksForRecord } from "@/app/actions/tasks";
import { listTeamMembers } from "@/app/actions/team";
import { resolveStageLabels } from "@/lib/crm-stages";
import { CompanyProfile, type CompanyLead } from "@/components/company-profile";

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  stage: string;
  deal_value: number | string | null;
  team_member_id: string | null;
  created_at: string;
  stage_changed_at: string | null;
};

const DAY_MS = 86_400_000;

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  await assertPageAccess("/empresas");
  const { id } = await params;
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) notFound();

  const detail = await getCompanyDetail(id);
  if (!detail) notFound();

  const supabase = await createClient();
  const [{ data: leadRows }, { data: wsRow }, tasks, members] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, phone, stage, deal_value, team_member_id, created_at, stage_changed_at")
      .eq("workspace_id", workspace.id)
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("workspaces").select("crm_stage_labels").eq("id", workspace.id).maybeSingle(),
    getTasksForRecord("company", id),
    listTeamMembers(),
  ]);

  const stageLabels = resolveStageLabels(wsRow?.crm_stage_labels);
  const memberName = new Map(members.map((m) => [m.id, m.name]));

  // Cada contato da empresa é uma negociação (lead no pipeline): "concluido" = vendido, "descartado" = perdido.
  const leads: CompanyLead[] = ((leadRows || []) as LeadRow[]).map((r) => ({
    id: r.id,
    name: r.name || r.phone || "sem nome",
    phone: r.phone,
    stageLabel: stageLabels[r.stage as keyof typeof stageLabels] ?? r.stage,
    status: r.stage === "concluido" ? "won" : r.stage === "descartado" ? "lost" : "open",
    value: Number(r.deal_value) || 0,
    responsible: r.team_member_id ? (memberName.get(r.team_member_id) ?? null) : null,
    createdAt: r.created_at,
  }));

  const sum = (status: CompanyLead["status"]) => leads.filter((l) => l.status === status).reduce((acc, l) => acc + l.value, 0);
  const won = leads.filter((l) => l.status === "won");
  const wonDurations = ((leadRows || []) as LeadRow[])
    .filter((r) => r.stage === "concluido" && r.stage_changed_at)
    .map((r) => (new Date(r.stage_changed_at as string).getTime() - new Date(r.created_at).getTime()) / DAY_MS);

  const metrics = {
    open: sum("open"),
    won: sum("won"),
    lost: sum("lost"),
    total: leads.length,
    ticket: won.length > 0 ? sum("won") / won.length : null,
    daysToSale: wonDurations.length > 0 ? wonDurations.reduce((a, b) => a + b, 0) / wonDurations.length : null,
  };

  const contacts = detail.contacts.map((c) => ({ id: c.id, label: c.name || c.phone || c.email || "sem nome", phone: c.phone }));

  return (
    <CompanyProfile
      company={detail.company}
      notes={detail.notes}
      contacts={contacts}
      leads={leads}
      metrics={metrics}
      tasks={tasks}
    />
  );
}
