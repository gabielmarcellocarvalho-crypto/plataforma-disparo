import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { PeriodFilterBar } from "@/components/period-filter-bar";
import { OverviewInsightsBox } from "@/components/overview-insights-box";
import { getMonthToDateAgentCostUsd, evalCostBudget } from "@/lib/cost-monitor";
import { getVolumeMetrics, getConversionMetrics, getFunnelData, getResponseMetrics, getLeadSources, getEmailClickMetrics, getMessagesByDay } from "@/lib/overview-metrics";
import { resolvePeriod, eachDayBrt } from "@/lib/period";
import { resolveWorkspacePlan, planFunnelEnd, planLabel, planHasConversion } from "@/lib/workspace-plan";
import { getAttentionAlerts } from "@/lib/attention-center";
import { AttentionCenterCard } from "@/components/attention-center-card";
import Link from "next/link";
import { deltaPct, previousPeriod } from "@/lib/period-delta";
import { getMyDay, getReceivedByDay } from "@/lib/my-day";
import { hasRedesignColumns } from "@/lib/redesign-columns";
import { normalizeInsights } from "@/lib/ai-insights";
import { AiInsightsCard } from "@/components/ai-insights-card";
import { AlertTriangle, ArrowRight, CalendarCheck, MessageSquare, UserPlus } from "lucide-react";

// Atalho do "Seu dia" (estilo home do HubSpot): ícone, número e o que fazer com ele.
function TodayTile({ href, icon, value, label, tone }: { href: string; icon: React.ReactNode; value: React.ReactNode; label: string; tone: "info" | "primary" | "danger" | "success" }) {
  const toneCls = { info: "bg-info-soft text-info-text", primary: "bg-primary-soft text-primary-strong", danger: "bg-danger-soft text-danger", success: "bg-success-soft text-success" }[tone];
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm transition hover:shadow-md hover:border-primary-soft">
      <span className={`grid place-items-center w-10 h-10 rounded-md shrink-0 ${toneCls}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-extrabold tracking-tight tabular-nums">{value}</span>
        <span className="block truncate text-xs text-text-muted">{label}</span>
      </span>
      <ArrowRight size={16} className="text-text-muted transition group-hover:translate-x-0.5 group-hover:text-text" aria-hidden />
    </Link>
  );
}

function CardHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="font-bold text-[15px]">{title}</h3>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// Funil horizontal com a taxa de passagem entre etapas (relatório de funil do HubSpot).
function FunnelBars({ rows }: { rows: { label: string; value: number; current: number }[] }) {
  const top = Math.max(1, rows[0]?.value ?? 1);
  return (
    <ol className="flex flex-col gap-2.5">
      {rows.map((r, i) => {
        const pct = Math.round((r.value / top) * 100);
        const prev = rows[i - 1];
        const step = prev ? Math.round((r.value / Math.max(1, prev.value)) * 100) : 100;
        return (
          <li key={r.label} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{r.label}</div>
              <div className="text-[11px] text-text-muted">{r.current.toLocaleString("pt-BR")} aqui agora</div>
            </div>
            <div className="relative h-8 overflow-hidden rounded bg-surface-2">
              <div
                className="flex h-full items-center rounded px-2.5 text-xs font-bold text-white"
                style={{ width: `${Math.max(pct, 6)}%`, background: `color-mix(in srgb, var(--color-primary) ${100 - i * 11}%, #450c14)` }}
              >
                {r.value.toLocaleString("pt-BR")}
              </div>
            </div>
            <div className="text-right w-24">
              <div className="text-sm font-bold">{pct}%</div>
              {prev && <div className="text-[11px] text-text-muted leading-tight">{step}% da etapa anterior</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function fmtDue(iso: string | null) {
  if (!iso) return "sem data";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const { workspace, isStaff } = await getCurrentWorkspace();
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

  const [{ count: contatos }, { count: campanhasAtivas }, msgByDayRaw, volume, conversion, funnel, response, leadSources] = workspace
    ? await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
        supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "ativa"),
        getMessagesByDay(workspace.id, period),
        getVolumeMetrics(workspace.id, period),
        hasConversion ? getConversionMetrics(workspace.id, period) : Promise.resolve(EMPTY_CONVERSION),
        hasConversion ? getFunnelData(workspace.id, period, funnelEnd) : Promise.resolve(EMPTY_FUNNEL),
        hasConversion ? getResponseMetrics(workspace.id, period) : Promise.resolve(EMPTY_RESPONSE),
        hasConversion ? getLeadSources(workspace.id, period) : Promise.resolve([]),
      ])
    : [
        { count: 0 },
        { count: 0 },
        {} as Record<string, number>,
        { leadsRecebidos: 0, leadsAbordados: 0, mensagensEnviadas: 0, mensagensRecebidas: 0, conversasIniciadas: 0, conversasEmAndamento: 0 },
        EMPTY_CONVERSION,
        EMPTY_FUNNEL,
        EMPTY_RESPONSE,
        [],
      ];

  // Período sem nenhum lead novo (ex.: dias em que não houve disparo): em vez de um funil vazio, mostra
  // o funil de todos os leads, como está no Pipeline. Só roda quando o do período veio zerado, então
  // nos períodos com leads nada muda.
  const periodFunnelEmpty = funnel.points.length === 0 || funnel.points[0]?.value === 0;
  const showingPipelineFunnel = Boolean(workspace) && hasConversion && periodFunnelEmpty;
  const shownFunnel =
    showingPipelineFunnel && workspace ? await getFunnelData(workspace.id, { from: new Date(0), to: new Date() }, funnelEnd) : funnel;

  // Distribui as mensagens do período por dia.
  const days = eachDayBrt(period.from, period.to);
  const msgByDay = new Map(days.map((d) => [d, msgByDayRaw[d] || 0]));
  const receivedByDay = workspace ? await getReceivedByDay(workspace.id, period) : {};
  const chartData = days.map((d) => ({ date: `${d}T12:00:00.000Z`, mensagens: msgByDay.get(d) || 0, recebidas: receivedByDay[d] || 0 }));

  // Alerta de custo — só pra colaborador (cliente nunca vê custo/margem) e só se houver orçamento definido.
  // Continua sempre "mês corrente", independente do período escolhido no filtro: orçamento é mensal por natureza.
  let costAlert: { ratioPct: number; costBrl: number; budgetBrl: number } | null = null;
  let attentionAlerts: Awaited<ReturnType<typeof getAttentionAlerts>> = [];
  if (workspace && isStaff) {
    const { data: budgetRow } = await supabase
      .from("workspaces")
      .select("monthly_cost_budget_brl, cost_alert_pct")
      .eq("id", workspace.id)
      .maybeSingle();
    if (budgetRow?.monthly_cost_budget_brl) {
      const costUsd = await getMonthToDateAgentCostUsd(supabase, workspace.id);
      const status = evalCostBudget(costUsd, budgetRow.monthly_cost_budget_brl, budgetRow.cost_alert_pct ?? 80);
      if (status.isOver && status.ratioPct !== null && status.budgetBrl !== null) {
        costAlert = { ratioPct: status.ratioPct, costBrl: status.costBrl, budgetBrl: status.budgetBrl };
      }
    }
    attentionAlerts = await getAttentionAlerts(workspace.id);
  }

  // Mesmo período imediatamente anterior, pra mostrar ▲/▼ nos números de volume. "Tudo" não tem anterior.
  const prevVolume = workspace && period.preset !== "tudo" ? await getVolumeMetrics(workspace.id, previousPeriod(period)) : null;
  const deltas = prevVolume
    ? {
        leadsRecebidos: deltaPct(volume.leadsRecebidos, prevVolume.leadsRecebidos),
        leadsAbordados: deltaPct(volume.leadsAbordados, prevVolume.leadsAbordados),
        mensagensEnviadas: deltaPct(volume.mensagensEnviadas, prevVolume.mensagensEnviadas),
        mensagensRecebidas: deltaPct(volume.mensagensRecebidas, prevVolume.mensagensRecebidas),
        conversasIniciadas: deltaPct(volume.conversasIniciadas, prevVolume.conversasIniciadas),
      }
    : {};

  // "Seu dia": o que precisa de ação agora, independente do período do filtro.
  const myDay = workspace ? await getMyDay(workspace.id) : null;

  const emailClicks = workspace ? await getEmailClickMetrics(workspace.id, period) : { sent: 0, clicked: 0, clickRatePct: null, failedNow: 0 };

  // Insights da IA guardados no workspace (colunas da migration 0089; antes dela, o card fica desligado).
  const insightsAvailable = await hasRedesignColumns();
  const { data: insightsRow } =
    workspace && insightsAvailable
      ? await supabase.from("workspaces").select("ai_insights, ai_insights_at").eq("id", workspace.id).maybeSingle()
      : { data: null };
  const savedInsights = normalizeInsights(insightsRow?.ai_insights);

  const funnelRows = shownFunnel.points.map((p) => ({ label: p.label, value: p.value, current: p.current }));

  // "Precisam de você": sem funil (workspace só de disparo/e-mail) ele vai pra coluna da esquerda, que
  // senão ficava vazia embaixo do Volume.
  const attentionCard = (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
      <CardHeader
        title="Precisam de você"
        description="Alertas do agente e conversas assumidas"
        action={<Link href="/conversas" className="text-xs font-bold text-text-muted hover:text-text whitespace-nowrap">Abrir conversas</Link>}
      />
      {!myDay || myDay.attentionList.length === 0 ? (
        <p className="text-sm text-text-muted py-6 text-center">Nada pendente.</p>
      ) : (
        <ul className="divide-y divide-border">
          {myDay.attentionList.map((c) => (
            <li key={c.id}>
              <Link href={`/conversas?contact=${c.id}`} className="flex items-center gap-3 py-2.5 group">
                <span className="grid place-items-center w-8 h-8 rounded-full bg-primary-soft text-primary-strong text-[11px] font-bold shrink-0" aria-hidden>
                  {c.name.trim().slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold group-hover:text-primary-strong">{c.name}</span>
                  <span className="block truncate text-xs text-text-muted">{c.reason}</span>
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${c.kind === "atencao" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning-text"}`}>
                  {c.kind === "atencao" ? "atenção" : "alerta"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="relative flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {myDay?.greeting ?? "Olá"}
            {myDay?.firstName ? `, ${myDay.firstName}` : ""} 👋
          </h1>
          <p className="mt-1 text-sm text-text-muted">Aqui está o que precisa de você hoje em {workspace?.name}.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isStaff && <AttentionCenterCard alerts={attentionAlerts} />}
          <PeriodFilterBar activePreset={period.preset} from={sp.from ?? ""} to={sp.to ?? ""} align="end" />
        </div>
      </div>

      {costAlert && (
        <a
          href="/metricas"
          className={`flex items-center gap-3 rounded-lg px-5 py-4 border ${
            costAlert.ratioPct >= 100 ? "bg-danger-soft border-danger/30" : "bg-warning-soft border-warning-text/20"
          }`}
        >
          <AlertTriangle size={20} className={costAlert.ratioPct >= 100 ? "text-danger" : "text-warning-text"} aria-hidden />
          <div className={costAlert.ratioPct >= 100 ? "text-danger" : "text-warning-text"}>
            <p className="text-sm font-bold">Custo de IA em {costAlert.ratioPct.toFixed(0)}% do orçamento do mês</p>
            <p className="text-xs font-semibold opacity-80">
              R$ {costAlert.costBrl.toFixed(2)} de R$ {costAlert.budgetBrl.toFixed(2)} — ver detalhes em Métricas.
            </p>
          </div>
        </a>
      )}

      {myDay && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TodayTile href="/agenda" icon={<CalendarCheck size={18} />} value={myDay.tasksPending} label="tarefas pendentes" tone="info" />
          <TodayTile href="/conversas" icon={<AlertTriangle size={18} />} value={myDay.attention} label="precisam de você" tone="danger" />
          <TodayTile href="/crm" icon={<UserPlus size={18} />} value={volume.leadsRecebidos.toLocaleString("pt-BR")} label={`leads recebidos · ${period.label}`} tone="primary" />
          <TodayTile href="/conversas" icon={<MessageSquare size={18} />} value={volume.conversasEmAndamento.toLocaleString("pt-BR")} label="conversas em andamento" tone="success" />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <OverviewInsightsBox
          periodLabel={period.label}
          volume={{ ...volume, chartData }}
          conversion={{ ...conversion, showFechamento: plan !== "sdr", ...response, leadSources }}
          hasConversion={hasConversion}
          deltas={deltas}
        />

        {/* A coluna da direita tem a altura do Volume (absolute no xl): gerar insights não estica a
            linha e não abre vão embaixo do gráfico — o conteúdo a mais rola dentro do card. */}
        <div className="relative min-h-[280px]">
          <div className="xl:absolute xl:inset-0 flex flex-col">
            <AiInsightsCard initial={savedInsights} generatedAt={(insightsRow?.ai_insights_at as string | null) ?? null} available={insightsAvailable} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2 items-start">
        {hasConversion ? (
          <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
            <CardHeader
              title={`Funil ${planLabel(plan)}`}
              description={
                (showingPipelineFunnel ? `Nenhum lead novo ${period.label}: mostrando todos os leads, como está no Pipeline. ` : "") +
                "Número na barra = cumulativo (chegou ou passou da fase). Abaixo do nome, quantos estão nela agora."
              }
              action={
                shownFunnel.descartados > 0 ? (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger whitespace-nowrap">
                    {shownFunnel.descartados} descartados fora do funil
                  </span>
                ) : undefined
              }
            />
            {funnelRows.length === 0 || funnelRows[0]?.value === 0 ? (
              <p className="text-sm text-text-muted text-center py-10">Nenhum lead recebido ainda.</p>
            ) : (
              <FunnelBars rows={funnelRows} />
            )}
          </div>
        ) : (
          attentionCard
        )}

        <div className="flex flex-col gap-5">
          {hasConversion && attentionCard}
          <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
            <CardHeader title="Tarefas de hoje" action={<Link href="/agenda" className="text-xs font-bold text-text-muted hover:text-text">Ver todas</Link>} />
            {!myDay || myDay.tasks.length === 0 ? (
              <p className="text-sm text-text-muted py-6 text-center">Nenhuma tarefa pra hoje.</p>
            ) : (
              <ul className="divide-y divide-border">
                {myDay.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${t.overdue ? "bg-danger" : "bg-primary"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{t.title}</p>
                      {t.contact_name && t.contact_id && (
                        <Link href={`/crm/${t.contact_id}`} className="text-xs text-text-muted hover:text-primary-strong">
                          {t.contact_name}
                        </Link>
                      )}
                    </div>
                    <span className={`text-xs whitespace-nowrap ${t.overdue ? "text-danger font-semibold" : "text-text-muted"}`}>{fmtDue(t.due_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(emailClicks.sent > 0 || emailClicks.failedNow > 0) && (
            <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
              <CardHeader title="Cliques de e-mail" description={`Sequências de e-mail ${period.label} — clique no CTA leva pro WhatsApp e conta como conversão.`} />
              <div className={`grid gap-3 ${emailClicks.failedNow > 0 ? "grid-cols-4" : "grid-cols-3"}`}>
                <div className="bg-surface-2 border border-border rounded-lg p-3">
                  <b className="block text-xl font-extrabold tabular-nums">{emailClicks.sent}</b>
                  <span className="text-xs text-text-muted block mt-1">enviados</span>
                </div>
                <div className="bg-surface-2 border border-border rounded-lg p-3">
                  <b className="block text-xl font-extrabold tabular-nums">{emailClicks.clicked}</b>
                  <span className="text-xs text-text-muted block mt-1">cliques</span>
                </div>
                <div className="bg-surface-2 border border-border rounded-lg p-3">
                  <b className="block text-xl font-extrabold tabular-nums">{emailClicks.clickRatePct === null ? "—" : `${emailClicks.clickRatePct}%`}</b>
                  <span className="text-xs text-text-muted block mt-1">taxa de clique</span>
                </div>
                {emailClicks.failedNow > 0 && (
                  <div className="bg-danger-soft border border-danger/30 rounded-lg p-3">
                    <b className="block text-xl font-extrabold tabular-nums text-danger">{emailClicks.failedNow}</b>
                    <span className="text-xs text-danger block mt-1">com falha</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
