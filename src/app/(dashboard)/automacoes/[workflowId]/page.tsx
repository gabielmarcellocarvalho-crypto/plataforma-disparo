import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getWorkflow } from "@/app/actions/workflows";
import { WorkflowBuilder } from "@/components/workflow-builder";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";

// Tela dedicada de edição/criação de workflow (não é um drawer/popup — o canvas 2D é o elemento
// principal da página, igual um editor de verdade de n8n/Make). "novo" é o sentinel de criação;
// "novo?template=<id>" pré-preenche a partir de um dos templates prontos.
export default async function WorkflowEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ workflowId: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { workflowId } = await params;
  const { template: templateId } = await searchParams;
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const isNew = workflowId === "novo";
  const existing = isNew ? null : await getWorkflow(workflowId);
  if (!isNew && !existing) notFound();

  const template = isNew ? WORKFLOW_TEMPLATES.find((t) => t.id === templateId)?.seed : undefined;

  const members = await createAdminClient()
    .from("workspace_members")
    .select("user_id, profiles(full_name)")
    .eq("workspace_id", workspace.id)
    .then(({ data }) => (data || []).map((m) => ({ id: m.user_id as string, name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name || "sem nome" })));

  return <WorkflowBuilder workspaceId={workspace.id} members={members} existing={existing} template={template} />;
}
