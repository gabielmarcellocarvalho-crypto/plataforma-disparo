import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { resolveStageLabels, resolveHiddenStages } from "@/lib/crm-stages";
import { CrmBoard } from "@/components/crm-board";

const CONTACT_LIMIT = 500;

export default async function CrmPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: contacts }, { data: workspaceRow }] = workspace
    ? await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, email, photo_url, stage, stage_changed_at, custom_fields, needs_attention, flagged_reason, created_at")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
          .limit(CONTACT_LIMIT),
        supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages").eq("id", workspace.id).maybeSingle(),
      ])
    : [{ data: [] }, { data: null }];

  const rows = contacts ?? [];
  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const hiddenStages = resolveHiddenStages(workspaceRow?.crm_hidden_stages);

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <CrmBoard contacts={rows} stageLabels={stageLabels} hiddenStages={hiddenStages} workspaceId={workspace?.id ?? ""} />
    </div>
  );
}
