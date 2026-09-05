import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { resolveStageLabels, resolveHiddenStages } from "@/lib/crm-stages";
import { resolveLostReasons } from "@/lib/lost-reasons";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
import { listBranches, listTeamMembers } from "@/app/actions/team";
import { listPipelines } from "@/app/actions/pipelines";
import { CrmBoard } from "@/components/crm-board";

// O projeto tem "Max Rows" travado em 1000 na API do Supabase — um teto do SERVIDOR que ignora
// qualquer .limit() pedido pelo client. Um cliente com base grande (ex.: TB Rio, 2100+ contatos)
// batia nesse teto e o Kanban só mostrava os 500/1000 contatos mais recentes, sem indicar que tinha
// mais escondido. Só dá pra pegar tudo paginando de verdade, em blocos de até 1000.
const CONTACT_LIMIT = 10000;
const PAGE_SIZE = 1000;

type ContactRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  stage: string;
  stage_changed_at: string;
  custom_fields: Record<string, unknown> | null;
  needs_attention: boolean;
  flagged_reason: string | null;
  created_at: string;
  team_member_id: string | null;
  branch_id: string | null;
  lost_reason: string | null;
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
};

async function fetchAllContacts(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string): Promise<ContactRow[]> {
  const all: ContactRow[] = [];
  let offset = 0;
  while (all.length < CONTACT_LIMIT) {
    const { data } = await supabase
      .from("contacts")
      .select(
        "id, name, phone, email, photo_url, stage, stage_changed_at, custom_fields, needs_attention, flagged_reason, created_at, team_member_id, branch_id, lost_reason, pipeline_id, pipeline_stage_id"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as ContactRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export default async function CrmPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [rows, { data: workspaceRow }, fieldDefs, teamMembers, branches, pipelines] = workspace
    ? await Promise.all([
        fetchAllContacts(supabase, workspace.id),
        supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages, lost_reasons, ask_lost_reason").eq("id", workspace.id).maybeSingle(),
        listCustomFieldDefs(),
        listTeamMembers(),
        listBranches(),
        listPipelines(),
      ])
    : [[] as ContactRow[], { data: null }, [], [], [], []];

  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const hiddenStages = resolveHiddenStages(workspaceRow?.crm_hidden_stages);
  const lostReasons = resolveLostReasons(workspaceRow?.lost_reasons);
  // Coluna nova: workspace criado antes dela lê undefined, e o padrão é perguntar (mesmo
  // comportamento de quem já usava).
  const askLostReason = workspaceRow?.ask_lost_reason !== false;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <CrmBoard
        contacts={rows}
        stageLabels={stageLabels}
        hiddenStages={hiddenStages}
        workspaceId={workspace?.id ?? ""}
        fieldDefs={fieldDefs}
        teamMembers={teamMembers}
        branches={branches}
        lostReasons={lostReasons}
        askLostReason={askLostReason}
        pipelines={pipelines}
      />
    </div>
  );
}
