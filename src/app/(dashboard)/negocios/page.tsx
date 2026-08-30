import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getDefaultPipeline } from "@/app/actions/deals";
import { AddDealForm } from "@/components/add-deal-form";
import { DealsBoard } from "@/components/deals-board";

// Mesmo teto de "Max Rows" do Supabase que já afeta /crm e /contatos.
const LIMIT = 10000;
const PAGE_SIZE = 1000;

type DealJoinRow = {
  id: string;
  name: string;
  amount: number | null;
  close_date: string | null;
  status: string;
  stage_id: string;
  stage_changed_at: string;
  created_at: string;
  company_id: string | null;
  contact_id: string | null;
  responsible_user_id: string | null;
  companies: { name: string } | null;
  contacts: { name: string | null } | null;
};

async function fetchAllDeals(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string): Promise<DealJoinRow[]> {
  const all: DealJoinRow[] = [];
  let offset = 0;
  while (all.length < LIMIT) {
    const { data } = await supabase
      .from("deals")
      .select(
        "id, name, amount, close_date, status, stage_id, stage_changed_at, created_at, company_id, contact_id, responsible_user_id, companies(name), contacts(name)"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as DealJoinRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export default async function NegociosPage() {
  const { workspace } = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <div className="flex flex-col gap-3 h-full min-h-0">
        <h1 className="text-2xl font-extrabold tracking-tight">Negócios</h1>
      </div>
    );
  }

  const supabase = await createClient();
  const [pipeline, rows, members] = await Promise.all([
    getDefaultPipeline(workspace.id),
    fetchAllDeals(supabase, workspace.id),
    createAdminClient()
      .from("workspace_members")
      .select("user_id, profiles(full_name)")
      .eq("workspace_id", workspace.id)
      .then(({ data }) => (data || []).map((m) => ({ id: m.user_id as string, name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name || "sem nome" }))),
  ]);

  if (!pipeline) {
    return (
      <div className="flex flex-col gap-3 h-full min-h-0">
        <h1 className="text-2xl font-extrabold tracking-tight">Negócios</h1>
        <p className="text-text-muted text-sm">Nenhum pipeline configurado neste workspace ainda.</p>
      </div>
    );
  }

  const deals = rows.map((d) => ({
    id: d.id,
    name: d.name,
    amount: d.amount,
    close_date: d.close_date,
    status: d.status,
    stage_id: d.stage_id,
    stage_changed_at: d.stage_changed_at,
    created_at: d.created_at,
    company_id: d.company_id,
    company_name: d.companies?.name ?? null,
    contact_id: d.contact_id,
    contact_name: d.contacts?.name ?? null,
    responsible_user_id: d.responsible_user_id,
  }));

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Negócios</h1>
          <p className="text-text-muted text-sm mt-1">{deals.length} negócio(s) em {workspace.name}.</p>
        </div>
        <AddDealForm stages={pipeline.stages} />
      </div>

      <DealsBoard deals={deals} stages={pipeline.stages} pipelineId={pipeline.pipelineId} workspaceId={workspace.id} responsibles={members} />
    </div>
  );
}
