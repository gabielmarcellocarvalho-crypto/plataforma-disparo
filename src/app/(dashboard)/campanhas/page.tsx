import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { resolveStageLabels, resolveHiddenStages, getVisibleStages } from "@/lib/crm-stages";
import { CreateCampaignForm } from "@/components/create-campaign-form";
import { CampaignRowActions } from "@/components/campaign-row-actions";
import type { WhatsappChannel } from "@/lib/whatsapp-channel";

const STATUS_LABEL: Record<string, string> = {
  rascunho: "rascunho",
  ativa: "ativa",
  pausada: "pausada",
  concluida: "concluída",
};

export default async function CampanhasPage() {
  await assertPageAccess("/campanhas");
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: campaigns }, { data: agents }, { data: workspaceRow }, { data: whatsappInstances }] = workspace
    ? await Promise.all([
        supabase
          .from("campaigns")
          .select("id, name, channel, mode, status, created_at")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("agents")
          .select("id, name, connection_status")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: true }),
        supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages").eq("id", workspace.id).maybeSingle(),
        supabase.from("whatsapp_instances").select("id, channel, department").eq("workspace_id", workspace.id).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: null }, { data: [] }];

  const rows = campaigns ?? [];

  // Mesma fonte de fases/labels do CRM — se o cliente renomear ou esconder uma fase lá, o filtro de
  // segmentação da campanha reflete na hora, sem precisar duplicar configuração.
  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const visibleStages = getVisibleStages(resolveHiddenStages(workspaceRow?.crm_hidden_stages));
  const stageOptions = visibleStages.map((s) => ({ value: s, label: stageLabels[s] }));

  const counts: Record<string, { pendente: number; enviado: number; falhou: number }> = {};
  if (rows.length > 0) {
    // Sem .limit() explícito, o Supabase corta em 1000 linhas por padrão — com a base de um cliente
    // somando mais que isso entre as campanhas (ex.: TB Rio passou de 2500 destinatários no total),
    // a contagem virava uma fatia arbitrária, fazendo parecer que destinatários "sumiam" de uma
    // campanha e apareciam errado em outra, quando na verdade só uma pá dessas linhas conta.
    const { data: recipients } = await supabase
      .from("campaign_recipients")
      .select("campaign_id, status")
      .in("campaign_id", rows.map((c) => c.id))
      .limit(50000);
    for (const r of recipients ?? []) {
      counts[r.campaign_id] ??= { pendente: 0, enviado: 0, falhou: 0 };
      if (r.status === "pendente") counts[r.campaign_id].pendente++;
      else if (r.status === "enviado") counts[r.campaign_id].enviado++;
      else if (r.status === "falhou" || r.status === "invalido") counts[r.campaign_id].falhou++;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Campanhas</h1>
          <p className="text-text-muted text-sm mt-1">
            Disparo de WhatsApp e e-mail em massa — mensagem fixa (disparo simples) ou conduzido por um agente de IA.
          </p>
        </div>
        <CreateCampaignForm
          agents={agents || []}
          whatsappInstances={(whatsappInstances || []).map((i) => ({ id: i.id, channel: i.channel as WhatsappChannel, department: i.department }))}
        />
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          <p className="font-semibold text-text">Nenhuma campanha criada</p>
          <p className="text-sm mt-1">Crie a primeira campanha pra começar o disparo em massa.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Modo</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Fila</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const count = counts[c.id] || { pendente: 0, enviado: 0, falhou: 0 };
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-semibold">{c.name}</td>
                    <td className="px-4 py-3 capitalize">{c.channel}</td>
                    <td className="px-4 py-3">{c.mode === "agent" ? "Agente de IA" : "Disparo simples"}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold px-2 py-1 rounded-full bg-primary-soft text-primary-strong">
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {count.pendente} pendente · {count.enviado} enviado · {count.falhou} falhou
                    </td>
                    <td className="px-4 py-3 text-right">
                      <CampaignRowActions id={c.id} status={c.status} stages={stageOptions} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
