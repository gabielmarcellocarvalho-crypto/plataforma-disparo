import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getTasksForOwner } from "@/app/actions/tasks";
import { AddTaskForm } from "@/components/add-task-form";
import { AgendaList } from "@/components/agenda-list";
import type { CustomFieldType } from "@/lib/custom-fields";

export default async function AgendaPage() {
  const { workspace } = await getCurrentWorkspace();

  if (!workspace) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-extrabold tracking-tight">Agenda</h1>
      </div>
    );
  }

  const admin = createAdminClient();
  const [tasks, sellers, defs, members] = await Promise.all([
    getTasksForOwner(),
    admin
      .from("team_members")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .order("name")
      .then(({ data }) => (data || []).map((m) => ({ id: m.id as string, name: m.name as string }))),
    admin
      .from("custom_field_defs")
      .select("key, label, type")
      .eq("workspace_id", workspace.id)
      .then(({ data }) => (data || []) as { key: string; label: string; type: CustomFieldType }[]),
    admin
      .from("workspace_members")
      .select("user_id, profiles(full_name)")
      .eq("workspace_id", workspace.id)
      .then(({ data }) => (data || []).map((m) => ({ id: m.user_id as string, name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name || "sem nome" }))),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Agenda</h1>
          <p className="text-text-muted text-sm mt-1">{tasks.filter((t) => !t.completed_at).length} tarefa(s) pendente(s) em {workspace.name}.</p>
        </div>
        <AddTaskForm workspaceId={workspace.id} responsibles={members} />
      </div>

      <AgendaList tasks={tasks} responsibles={members} sellers={sellers} fieldDefs={defs} />
    </div>
  );
}
