import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { MessagesAreaChart } from "@/components/charts/messages-area-chart";
import { getMonthToDateAgentCostUsd, evalCostBudget } from "@/lib/cost-monitor";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary-soft text-primary-strong" aria-hidden>
          {icon}
        </span>
      </div>
      <b className="block text-[26px] font-extrabold tracking-tight mt-3 leading-none">{value}</b>
      <span className="text-xs font-semibold text-text-muted">{label}</span>
    </div>
  );
}

export default async function OverviewPage() {
  const { workspace, isColaborador } = await getCurrentWorkspace();
  const supabase = await createClient();

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();

  const [{ count: contatos }, { count: campanhasAtivas }, { count: mensagensHoje }, { data: conversationPairs }, { data: monthMsgs }] =
    workspace
      ? await Promise.all([
          supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
          supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "ativa"),
          supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspace.id)
            .eq("role", "assistant")
            .gte("created_at", startOfDay.toISOString()),
          supabase
            .from("messages")
            .select("contact_id, agent_id")
            .eq("workspace_id", workspace.id)
            .not("agent_id", "is", null)
            .limit(20000),
          supabase
            .from("messages")
            .select("created_at")
            .eq("workspace_id", workspace.id)
            .eq("role", "assistant")
            .gte("created_at", startOfMonth.toISOString())
            .limit(20000),
        ])
      : [{ count: 0 }, { count: 0 }, { count: 0 }, { data: [] }, { data: [] }];

  // Conversa = par único contato+agente (mesma definição usada em Conversas).
  const totalConversas = new Set((conversationPairs || []).map((m) => `${m.contact_id}:${m.agent_id}`)).size;

  // Distribui as mensagens do mês por dia.
  const counts = new Array(daysInMonth).fill(0);
  for (const m of monthMsgs || []) {
    const d = new Date(m.created_at as string);
    const day = d.getUTCDate();
    if (day >= 1 && day <= daysInMonth) counts[day - 1] += 1;
  }
  const totalMes = counts.reduce((a, b) => a + b, 0);
  const chartData = counts.map((c, idx) => ({
    date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), idx + 1)).toISOString(),
    mensagens: c,
  }));

  // Alerta de custo — só pra colaborador (cliente nunca vê custo/margem) e só se houver orçamento definido.
  let costAlert: { ratioPct: number; costBrl: number; budgetBrl: number } | null = null;
  if (workspace && isColaborador) {
    const { data: budgetRow } = await supabase
      .from("workspaces")
      .select("monthly_cost_budget_brl, cost_alert_pct")
      .eq("id", workspace.id)
      .maybeSingle();
    if (budgetRow?.monthly_cost_budget_brl) {
      const costUsd = await getMonthToDateAgentCostUsd(workspace.id);
      const status = evalCostBudget(costUsd, budgetRow.monthly_cost_budget_brl, budgetRow.cost_alert_pct ?? 80);
      if (status.isOver && status.ratioPct !== null && status.budgetBrl !== null) {
        costAlert = { ratioPct: status.ratioPct, costBrl: status.costBrl, budgetBrl: status.budgetBrl };
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">Visão geral</h1>
        <p className="text-text-muted text-sm mt-1">Resumo de {workspace?.name ?? "—"}.</p>
      </div>

      {costAlert && (
        <a
          href="/metricas"
          className={`flex items-center gap-3 rounded-2xl px-5 py-4 border ${
            costAlert.ratioPct >= 100 ? "bg-danger-soft border-danger/30" : "bg-warning-soft border-warning-text/20"
          }`}
        >
          <span className={`grid place-items-center w-9 h-9 rounded-xl shrink-0 ${costAlert.ratioPct >= 100 ? "text-danger" : "text-warning-text"}`} aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12" y2="17" />
            </svg>
          </span>
          <div className={costAlert.ratioPct >= 100 ? "text-danger" : "text-warning-text"}>
            <p className="text-sm font-bold">
              Custo de IA em {costAlert.ratioPct.toFixed(0)}% do orçamento do mês
            </p>
            <p className="text-xs font-semibold opacity-80">
              R$ {costAlert.costBrl.toFixed(2)} de R$ {costAlert.budgetBrl.toFixed(2)} — ver detalhes em Métricas.
            </p>
          </div>
        </a>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="contatos"
          value={contatos ?? 0}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
          }
        />
        <StatCard
          label="campanhas ativas"
          value={campanhasAtivas ?? 0}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          }
        />
        <StatCard
          label="mensagens hoje"
          value={mensagensHoje ?? 0}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
        />
        <StatCard
          label="conversas"
          value={totalConversas}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 8h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v3l-3-3h-5a1 1 0 0 1-1-1v-1" />
              <path d="M14 3H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1v3l3-3h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z" />
            </svg>
          }
        />
      </div>

      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
          <div>
            <h3 className="font-bold text-[15px]">Mensagens enviadas por dia</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {MESES[now.getUTCMonth()]} de {now.getUTCFullYear()}
            </p>
          </div>
          <div className="text-right">
            <b className="block text-2xl font-extrabold tracking-tight leading-none text-primary-strong">{totalMes}</b>
            <span className="text-xs font-semibold text-text-muted">no mês</span>
          </div>
        </div>
        <MessagesAreaChart data={chartData} />
      </div>
    </div>
  );
}
