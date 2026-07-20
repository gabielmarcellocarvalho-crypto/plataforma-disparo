import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";

export default async function OverviewPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [{ count: contatos }, { count: campanhasAtivas }, { count: mensagensHoje }, { count: workspaces }] = workspace
    ? await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
        supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "ativa"),
        // "Mensagens enviadas" conta toda resposta (role=assistant) do workspace, seja de campanha
        // em massa ou de agente de IA conversando 1:1 — ambas já caem na mesma tabela `messages`.
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspace.id)
          .eq("role", "assistant")
          .gte("created_at", startOfDay.toISOString()),
        supabase.from("workspaces").select("id", { count: "exact", head: true }),
      ])
    : [{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }];

  const statCards = [
    { label: "contatos", value: contatos ?? 0 },
    { label: "campanhas ativas", value: campanhasAtivas ?? 0 },
    { label: "mensagens enviadas hoje", value: mensagensHoje ?? 0 },
    { label: "workspaces", value: workspaces ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Visão geral</h1>
        <p className="text-text-muted text-sm mt-1">Resumo de {workspace?.name ?? "—"}.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((c) => (
          <div key={c.label} className="bg-surface border border-border rounded-lg p-4 shadow-sm">
            <b className="block text-2xl tracking-tight">{c.value}</b>
            <span className="text-xs font-semibold text-text-muted">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
