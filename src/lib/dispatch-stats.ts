import { createClient } from "@/lib/supabase/server";

// Conta destinatários (fila de campanha) de um workspace específico, por canal.
async function countRecipients(supabase: Awaited<ReturnType<typeof createClient>>, channel: "whatsapp" | "email", workspaceId: string) {
  const { count } = await supabase
    .from("campaign_recipients")
    .select("id, campaigns!inner(workspace_id, channel)", { count: "exact", head: true })
    .eq("campaigns.channel", channel)
    .eq("campaigns.workspace_id", workspaceId);
  return count ?? 0;
}

export type DispatchStats = {
  emailsCliente: number;
  emailsTotalTodosClientes: number;
  whatsappCliente: number;
  hasSavedEstimate: boolean;
};

// "Volume de um workspace" = a estimativa salva manualmente (se existir), senão o volume real
// da fila de campanhas. Isso deixa entrar na conta tanto cliente já rodando quanto cliente ainda
// em fase de orçamento/projeção.
async function workspaceVolume(
  supabase: Awaited<ReturnType<typeof createClient>>,
  channel: "whatsapp" | "email",
  workspaceId: string,
  estimate: number | null
) {
  if (estimate !== null) return estimate;
  return countRecipients(supabase, channel, workspaceId);
}

export async function getDispatchStats(workspaceId: string | null): Promise<DispatchStats> {
  const supabase = await createClient();

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, estimated_email_volume, estimated_whatsapp_volume");

  const all = workspaces ?? [];

  const volumesEmail = await Promise.all(
    all.map((w) => workspaceVolume(supabase, "email", w.id, w.estimated_email_volume))
  );
  const emailsTotalTodosClientes = volumesEmail.reduce((sum, v) => sum + v, 0);

  const atual = all.find((w) => w.id === workspaceId);
  const emailsCliente = workspaceId
    ? await workspaceVolume(supabase, "email", workspaceId, atual?.estimated_email_volume ?? null)
    : 0;
  const whatsappCliente = workspaceId
    ? await workspaceVolume(supabase, "whatsapp", workspaceId, atual?.estimated_whatsapp_volume ?? null)
    : 0;

  const hasSavedEstimate = Boolean(
    atual && (atual.estimated_email_volume !== null || atual.estimated_whatsapp_volume !== null)
  );

  return { emailsCliente, emailsTotalTodosClientes, whatsappCliente, hasSavedEstimate };
}
