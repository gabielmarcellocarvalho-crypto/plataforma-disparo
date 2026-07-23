import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { MessagesAreaChart } from "@/components/charts/messages-area-chart";

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
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();

  const [{ count: contatos }, { count: campanhasAtivas }, { count: mensagensHoje }, { count: workspaces }, { data: monthMsgs }] =
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
          supabase.from("workspaces").select("id", { count: "exact", head: true }),
          supabase
            .from("messages")
            .select("created_at")
            .eq("workspace_id", workspace.id)
            .eq("role", "assistant")
            .gte("created_at", startOfMonth.toISOString())
            .limit(20000),
        ])
      : [{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { data: [] }];

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">Visão geral</h1>
        <p className="text-text-muted text-sm mt-1">Resumo de {workspace?.name ?? "—"}.</p>
      </div>

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
          label="workspaces"
          value={workspaces ?? 0}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
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
