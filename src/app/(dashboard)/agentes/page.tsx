import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AgentCard } from "@/components/agent-card";
import { AddAgentForm } from "@/components/add-agent-form";
import { AttentionPanel } from "@/components/attention-panel";

export default async function AgentesPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: agents }, { data: attentionContacts }] = workspace
    ? await Promise.all([
        supabase
          .from("agents")
          .select("id, name, system_prompt, evolution_instance_name, phone_number, photo_url, connection_status, status")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("contacts")
          .select("id, name, phone, attention_reason")
          .eq("workspace_id", workspace.id)
          .eq("needs_attention", true)
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Agentes</h1>
          <p className="text-text-muted text-sm mt-1">
            Cada agente atende por um número de WhatsApp próprio, com prompt próprio, respondendo sozinho os contatos desse workspace.
          </p>
        </div>
        <AddAgentForm />
      </div>

      <AttentionPanel contacts={attentionContacts || []} />

      {!agents?.length ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          <p className="font-semibold text-text">Nenhum agente ainda</p>
          <p className="text-sm mt-1">Clique em &quot;Adicionar agente&quot; pra conectar o primeiro número.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
