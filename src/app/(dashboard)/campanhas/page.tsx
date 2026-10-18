import { Mail, MessageCircle } from "lucide-react";
import { hasRedesignColumns } from "@/lib/redesign-columns";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { resolveStageLabels, resolveHiddenStages, getVisibleStages } from "@/lib/crm-stages";
import { listWorkspaceTags } from "@/app/actions/contacts";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
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
        supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages, email_from, brand_color, logo_url").eq("id", workspace.id).maybeSingle(),
        supabase.from("whatsapp_instances").select("id, channel, department").eq("workspace_id", workspace.id).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: null }, { data: [] }];

  const rows = campaigns ?? [];

  // Tags existentes na base — viram as opções de segmentação na ativação do disparo ("mandar só pra
  // quem tem a tag Associado") e as sugestões ao marcar a campanha.
  const workspaceTags = workspace ? await listWorkspaceTags() : [];
  const tagOptions = workspaceTags.map((t) => ({ tag: t.tag, count: t.contacts_count }));

  // Mesma fonte de fases/labels do CRM — se o cliente renomear ou esconder uma fase lá, o filtro de
  // segmentação da campanha reflete na hora, sem precisar duplicar configuração.
  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const visibleStages = getVisibleStages(resolveHiddenStages(workspaceRow?.crm_hidden_stages));
  const stageOptions = visibleStages.map((s) => ({ value: s, label: stageLabels[s] }));

  const counts: Record<string, { pendente: number; enviado: number; falhou: number }> = {};
  const deliveryCounts: Record<string, { delivered: number; read: number }> = {};
  if (rows.length > 0) {
    // O projeto tem "Max Rows" travado em 1000 nas configurações de API do Supabase — isso é um teto
    // do SERVIDOR, aplicado por cima de qualquer .limit() que o client peça (mesmo pedindo 50000, a
    // resposta ainda vem cortada em 1000). Trazer as linhas pra contar no código nunca ia funcionar
    // direito pra uma base grande (ex.: TB Rio passa de 3600 destinatários somando as campanhas).
    // Contagem agregada (count exact, head: sem baixar linha nenhuma) não é afetada por esse teto —
    // por isso 1 query de count por campanha×status, em paralelo, em vez de somar no código.
    const statusGroups = [
      { key: "pendente" as const, statuses: ["pendente"] },
      { key: "enviado" as const, statuses: ["enviado"] },
      { key: "falhou" as const, statuses: ["falhou", "invalido"] },
    ];
    const results = await Promise.all(
      rows.flatMap((c) =>
        statusGroups.map(async (g) => {
          const { count } = await supabase
            .from("campaign_recipients")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", c.id)
            .in("status", g.statuses);
          return { campaignId: c.id, key: g.key, count: count ?? 0 };
        })
      )
    );
    for (const r of results) {
      counts[r.campaignId] ??= { pendente: 0, enviado: 0, falhou: 0 };
      counts[r.campaignId][r.key] = r.count;
    }

    // Entregues/lidas (webhook de status da Meta, migration 0089). Antes dela, as colunas não existem e
    // a tabela mostra "—".
    if (await hasRedesignColumns()) {
      const delivery = await Promise.all(
        rows.flatMap((c) =>
          (["delivered_at", "read_at"] as const).map(async (col) => {
            const { count } = await supabase.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).not(col, "is", null);
            return { campaignId: c.id, col, count: count ?? 0 };
          })
        )
      );
      for (const d of delivery) {
        deliveryCounts[d.campaignId] ??= { delivered: 0, read: 0 };
        deliveryCounts[d.campaignId][d.col === "delivered_at" ? "delivered" : "read"] = d.count;
      }
    }
  }

  const STATUS_TONE: Record<string, string> = {
    rascunho: "bg-surface-2 border border-border text-text-muted",
    ativa: "bg-info-soft text-info-text",
    agendada: "bg-warning-soft text-warning-text",
    pausada: "bg-warning-soft text-warning-text",
    concluida: "bg-success-soft text-success",
  };
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const Bar = ({ value, color }: { value: number; color: string }) => (
    <div className="h-1.5 w-24 rounded-full bg-surface-2 overflow-hidden mt-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Campanhas</h1>
          <p className="text-text-muted text-sm mt-1">
            Disparo de WhatsApp e e-mail em massa — mensagem fixa (disparo simples) ou conduzido por um agente de IA.
          </p>
        </div>
        <CreateCampaignForm
          agents={agents || []}
          whatsappInstances={(whatsappInstances || []).map((i) => ({ id: i.id, channel: i.channel as WhatsappChannel, department: i.department }))}
          availableTags={tagOptions.map((t) => t.tag)}
          fieldDefs={await listCustomFieldDefs()}
          emailFrom={workspaceRow?.email_from ?? null}
          brandColor={workspaceRow?.brand_color ?? null}
          logoUrl={workspaceRow?.logo_url ?? null}
        />
      </div>

      {/* Passo a passo do que a criação pede — quem abre a tela pela primeira vez entende o caminho. */}
      <div className="bg-surface border border-border rounded-lg shadow-sm p-4">
        <h2 className="text-sm font-bold mb-3">Como funciona</h2>
        <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            "Público: filtre por etapa, tag ou campo",
            "Canal e modo: WhatsApp/e-mail · simples ou agente",
            "Mensagem: template aprovado + variáveis",
            "Envio: agora ou agendado, com rampa anti-bloqueio",
          ].map((t, i) => (
            <li key={t} className="flex items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-xs text-text-muted">
              <span className="grid place-items-center w-5 h-5 rounded-full bg-primary-strong text-white text-[11px] font-bold shrink-0">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
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
              <tr className="border-b border-border text-left text-text-muted text-[11px] font-bold uppercase tracking-wide">
                <th className="px-4 py-3">Campanha</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Público</th>
                <th className="px-4 py-3">Enviados</th>
                <th className="px-4 py-3">Entregues</th>
                <th className="px-4 py-3">Lidas</th>
                <th className="px-4 py-3">Falhas</th>
                <th className="px-4 py-3">Na fila</th>
                <th className="px-4 py-3">Criada</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const count = counts[c.id] || { pendente: 0, enviado: 0, falhou: 0 };
                const total = count.pendente + count.enviado + count.falhou;
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid place-items-center w-7 h-7 rounded-full bg-surface-2 text-text-muted shrink-0" aria-hidden>
                          {c.channel === "email" ? <Mail size={14} /> : <MessageCircle size={14} />}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{c.name}</div>
                          <div className="text-[11px] text-text-muted">{c.mode === "agent" ? "conduzida por agente" : "disparo simples"} · {c.channel === "email" ? "e-mail" : "WhatsApp"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_TONE[c.status] || "bg-primary-soft text-primary-strong"}`}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{total.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {count.enviado.toLocaleString("pt-BR")} ({pct(count.enviado, total)}%)
                      <Bar value={pct(count.enviado, total)} color="bg-info-text" />
                    </td>
                    {(["delivered", "read"] as const).map((k) => {
                      const d = deliveryCounts[c.id];
                      if (!d || c.channel === "email") return <td key={k} className="px-4 py-3 text-xs text-text-muted">—</td>;
                      return (
                        <td key={k} className="px-4 py-3 text-xs tabular-nums">
                          {d[k].toLocaleString("pt-BR")} ({pct(d[k], count.enviado)}%)
                          <Bar value={pct(d[k], count.enviado)} color={k === "delivered" ? "bg-success" : "bg-primary-strong"} />
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {count.falhou.toLocaleString("pt-BR")}
                      <Bar value={pct(count.falhou, total)} color="bg-danger" />
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-text-muted">{count.pendente.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3 text-xs text-text-muted">{fmtDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <CampaignRowActions id={c.id} status={c.status} stages={stageOptions} tags={tagOptions} />
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
