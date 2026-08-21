import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { PeriodFilterBar } from "@/components/period-filter-bar";
import { OverviewInsightsBox } from "@/components/overview-insights-box";
import { getMonthToDateAgentCostUsd, evalCostBudget } from "@/lib/cost-monitor";
import { getVolumeMetrics, getConversionMetrics, getFunnelData, getResponseMetrics, getLeadSources, getEmailClickMetrics } from "@/lib/overview-metrics";
import { resolvePeriod, eachDayBrt, dayKeyBrt } from "@/lib/period";
import { resolveWorkspacePlan, planFunnelEnd, planLabel, planHasConversion } from "@/lib/workspace-plan";
import { getAttentionAlerts } from "@/lib/attention-center";
import { AttentionCenterCard } from "@/components/attention-center-card";

function MiniStat({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 bg-surface border border-border rounded-xl px-3.5 py-2 shadow-sm">
      <span className="grid place-items-center w-7 h-7 rounded-lg bg-primary-soft text-primary-strong shrink-0" aria-hidden>
        {icon}
      </span>
      <div className="leading-tight">
        <b className="block text-base font-extrabold tabular-nums">{value}</b>
        <span className="text-[10px] font-semibold text-text-muted whitespace-nowrap">{label}</span>
      </div>
    </div>
  );
}

const PaperPlaneIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const { workspace, isColaborador } = await getCurrentWorkspace();
  const supabase = await createClient();

  // Precisa do plano ANTES de montar o funil (ele decide onde o funil termina) — por isso essa
  // consulta roda numa rodada separada, antes do Promise.all principal.
  const { data: workspacePlanRow } = workspace
    ? await supabase.from("workspaces").select("plan").eq("id", workspace.id).maybeSingle()
    : { data: null };
  const plan = resolveWorkspacePlan(workspacePlanRow?.plan);
  const funnelEnd = planFunnelEnd(plan);
  const hasConversion = planHasConversion(plan);

  const EMPTY_CONVERSION = { taxaResposta: null, taxaInteresse: null, taxaQualificacao: null, taxaFechamento: null };
  const EMPTY_FUNNEL = { points: [], descartados: 0 };
  const EMPTY_RESPONSE = { tempoMedioRespostaMin: null, conversasNaoRespondidas: 0, maisTempoEsperandoMin: null };

  const [{ count: contatos }, { count: campanhasAtivas }, { data: periodMsgs }, volume, conversion, funnel, response, leadSources] = workspace
    ? await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
        supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "ativa"),
        supabase
          .from("messages")
          .select("created_at")
          .eq("workspace_id", workspace.id)
          .eq("role", "assistant")
          .gte("created_at", period.from.toISOString())
          .lte("created_at", period.to.toISOString())
          .limit(20000),
        getVolumeMetrics(workspace.id, period),
        hasConversion ? getConversionMetrics(workspace.id, period) : Promise.resolve(EMPTY_CONVERSION),
        hasConversion ? getFunnelData(workspace.id, period, funnelEnd) : Promise.resolve(EMPTY_FUNNEL),
        hasConversion ? getResponseMetrics(workspace.id, period) : Promise.resolve(EMPTY_RESPONSE),
        hasConversion ? getLeadSources(workspace.id, period) : Promise.resolve([]),
      ])
    : [
        { count: 0 },
        { count: 0 },
        { data: [] },
        { leadsRecebidos: 0, leadsAbordados: 0, mensagensEnviadas: 0, mensagensRecebidas: 0, conversasIniciadas: 0, conversasEmAndamento: 0 },
        EMPTY_CONVERSION,
        EMPTY_FUNNEL,
        EMPTY_RESPONSE,
        [],
      ];

  // Distribui as mensagens do período por dia.
  const days = eachDayBrt(period.from, period.to);
  const msgByDay = new Map(days.map((d) => [d, 0]));
  for (const m of periodMsgs || []) {
    const key = dayKeyBrt(m.created_at as string);
    if (msgByDay.has(key)) msgByDay.set(key, (msgByDay.get(key) || 0) + 1);
  }
  const chartData = days.map((d) => ({ date: `${d}T12:00:00.000Z`, mensagens: msgByDay.get(d) || 0 }));

  // Alerta de custo — só pra colaborador (cliente nunca vê custo/margem) e só se houver orçamento definido.
  // Continua sempre "mês corrente", independente do período escolhido no filtro: orçamento é mensal por natureza.
  let costAlert: { ratioPct: number; costBrl: number; budgetBrl: number } | null = null;
  let attentionAlerts: Awaited<ReturnType<typeof getAttentionAlerts>> = [];
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
    attentionAlerts = await getAttentionAlerts(workspace.id);
  }

  const emailClicks = workspace ? await getEmailClickMetrics(workspace.id, period) : { sent: 0, clicked: 0, clickRatePct: null };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PeriodFilterBar activePreset={period.preset} from={sp.from ?? ""} to={sp.to ?? ""} />
        {isColaborador && <AttentionCenterCard alerts={attentionAlerts} />}
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

      <div className="flex items-center gap-3 flex-wrap">
        <MiniStat
          label="contatos (total)"
          value={contatos ?? 0}
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
          }
        />
        <MiniStat label="campanhas ativas" value={campanhasAtivas ?? 0} icon={<PaperPlaneIcon />} />
      </div>

      <OverviewInsightsBox
        periodLabel={period.label}
        volume={{ ...volume, chartData }}
        conversion={{ ...conversion, showFechamento: plan !== "sdr", ...response, leadSources }}
        hasConversion={hasConversion}
      />

      {emailClicks.sent > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-[15px] mb-1">Cliques de e-mail</h3>
          <p className="text-xs text-text-muted mb-4">Sequências de e-mail {period.label} — clique no CTA leva pro WhatsApp e conta como conversão.</p>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            <div className="bg-bg border border-border rounded-xl p-4">
              <b className="block text-xl font-extrabold tabular-nums">{emailClicks.sent}</b>
              <span className="text-xs font-semibold text-text-muted block mt-1.5">e-mails enviados</span>
            </div>
            <div className="bg-bg border border-border rounded-xl p-4">
              <b className="block text-xl font-extrabold tabular-nums">{emailClicks.clicked}</b>
              <span className="text-xs font-semibold text-text-muted block mt-1.5">cliques (conversão)</span>
            </div>
            <div className="bg-bg border border-border rounded-xl p-4">
              <b className="block text-xl font-extrabold tabular-nums">{emailClicks.clickRatePct === null ? "—" : `${emailClicks.clickRatePct}%`}</b>
              <span className="text-xs font-semibold text-text-muted block mt-1.5">taxa de clique</span>
            </div>
          </div>
        </div>
      )}

      {hasConversion && (
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
            <div>
              <h3 className="font-bold text-[15px]">Funil {planLabel(plan)}</h3>
              <p className="text-xs text-text-muted mt-0.5">
                Leads recebidos {period.label}, pela fase mais avançada já alcançada.
                {funnel.descartados > 0 ? ` ${funnel.descartados} descartado(s) nesse período, fora do funil.` : ""}
              </p>
            </div>
          </div>
          {funnel.points.length === 0 || funnel.points[0]?.value === 0 ? (
            <p className="text-sm text-text-muted text-center py-10">Nenhum lead recebido nesse período ainda.</p>
          ) : (
            <FunnelChart data={funnel.points.map((p) => ({ label: p.label, value: p.value }))} />
          )}
        </div>
      )}
    </div>
  );
}
