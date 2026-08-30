import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCostByAgentInRange, getDailyCostInRange, getConversationsInRange, COST_USD_TO_BRL } from "@/lib/cost-monitor";
import { getDealsFunnel, getVendorPerformance } from "@/lib/deal-metrics";
import { formatDealAmount } from "@/lib/deal-stages";
import { resolvePeriod } from "@/lib/period";
import { PeriodFilterBar } from "@/components/period-filter-bar";
import { CostBudgetCard } from "@/components/cost-budget-card";
import { CostStackedBarChart } from "@/components/charts/cost-stacked-bar-chart";
import { FunnelChart } from "@/components/charts/funnel-chart";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await assertPageAccess("/metricas");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const { workspace, isColaborador } = await getCurrentWorkspace();

  // Custo (por agente) e orçamento só fazem sentido pra colaborador — cliente nunca vê custo/margem.
  const showCost = Boolean(workspace && isColaborador);

  const [agentCosts, budgetRow, dailyCost, conversationsInPeriod] = showCost
    ? await Promise.all([
        getCostByAgentInRange(workspace!.id, period),
        createClient().then((s) =>
          s.from("workspaces").select("monthly_cost_budget_brl, cost_alert_pct").eq("id", workspace!.id).maybeSingle()
        ),
        getDailyCostInRange(workspace!.id, period),
        getConversationsInRange(workspace!.id, period),
      ])
    : [[], { data: null }, [], 0];

  const totalCostUsd = agentCosts.reduce((sum, a) => sum + a.costUsd, 0);
  const totalCostBrl = totalCostUsd * COST_USD_TO_BRL;
  const totalMessages = agentCosts.reduce((sum, a) => sum + a.messages, 0);
  const totalConversations = agentCosts.reduce((sum, a) => sum + a.conversations, 0);
  const avgCostPerConversationBrl = totalConversations > 0 ? totalCostBrl / totalConversations : 0;
  const budget = (budgetRow as { data: { monthly_cost_budget_brl: number | null; cost_alert_pct: number | null } | null }).data;

  // Funil de negócios e performance por vendedor: dado do próprio time do cliente, não margem da
  // agência — visível a todo mundo que acessa /metricas, sem gate de showCost/isColaborador.
  const [dealsFunnel, vendorPerformance, vendorNames] = workspace
    ? await Promise.all([
        getDealsFunnel(workspace.id, period),
        getVendorPerformance(workspace.id, period),
        createAdminClient()
          .from("workspace_members")
          .select("user_id, profiles(full_name)")
          .eq("workspace_id", workspace.id)
          .then(({ data }) => new Map((data || []).map((m) => [m.user_id as string, (m.profiles as unknown as { full_name: string | null } | null)?.full_name || "sem nome"]))),
      ])
    : [{ points: [] }, [], new Map<string, string>()];

  return (
    <div className="flex flex-col gap-6">
      <PeriodFilterBar activePreset={period.preset} from={sp.from ?? ""} to={sp.to ?? ""} />

      {showCost && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">Custo de IA ({period.label})</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">R$ {totalCostBrl.toFixed(2)}</b>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">Custo médio de IA por conversa</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">R$ {avgCostPerConversationBrl.toFixed(3)}</b>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">Mensagens de agente ({period.label})</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">{totalMessages}</b>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">Conversas ({period.label})</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">{conversationsInPeriod}</b>
          </div>
        </div>
      )}

      {showCost && (
        <CostBudgetCard
          workspaceId={workspace!.id}
          costBrl={totalCostBrl}
          initialBudgetBrl={budget?.monthly_cost_budget_brl ?? null}
          initialThresholdPct={budget?.cost_alert_pct ?? 80}
        />
      )}

      {showCost && (
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-[15px] mb-1">Custo por dia ({period.label})</h3>
          <p className="text-xs text-text-muted mb-4">
            Custo de IA medido de verdade (tokens Anthropic) — ajuda a ver se algum dia teve pico fora do padrão.
          </p>
          <CostStackedBarChart data={dailyCost} />
        </div>
      )}

      {showCost && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <h3 className="font-bold text-[15px]">Custo de IA por agente ({period.label})</h3>
              <p className="text-xs text-text-muted mt-0.5">
                {totalMessages} resposta(s) em {totalConversations} conversa(s) — modelo {ANTHROPIC_MODEL}.
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-extrabold">R$ {totalCostBrl.toFixed(2)}</div>
              <div className="text-xs text-text-muted">total do período</div>
            </div>
          </div>

          {agentCosts.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">Nenhuma resposta de agente nesse período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                    <th className="px-3 py-2">Agente</th>
                    <th className="px-3 py-2 text-right">Mensagens</th>
                    <th className="px-3 py-2 text-right">Conversas</th>
                    <th className="px-3 py-2 text-right">Custo</th>
                    <th className="px-3 py-2 text-right">Média/conversa</th>
                  </tr>
                </thead>
                <tbody>
                  {agentCosts.map((a) => {
                    const costBrl = a.costUsd * COST_USD_TO_BRL;
                    const perConvBrl = a.conversations > 0 ? costBrl / a.conversations : 0;
                    return (
                      <tr key={a.agentId} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 font-semibold">{a.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.messages}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.conversations}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold">R$ {costBrl.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">R$ {perConvBrl.toFixed(3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <h3 className="font-bold text-[15px] mb-1">Funil de negócios ({period.label})</h3>
        <p className="text-xs text-text-muted mb-4">Negócios criados nesse período, por estágio atual do pipeline.</p>
        {dealsFunnel.points.length === 0 || dealsFunnel.points.every((p) => p.value === 0) ? (
          <p className="text-sm text-text-muted text-center py-10">Nenhum negócio criado nesse período ainda.</p>
        ) : (
          <>
            <FunnelChart data={dealsFunnel.points.map((p) => ({ label: p.label, value: p.value }))} />
            <div className="flex items-center gap-3 flex-wrap mt-4 pt-4 border-t border-border">
              {dealsFunnel.points.map((p) => (
                <span key={p.stage} className="text-xs text-text-muted">
                  <b className="text-text">{p.label}:</b> {formatDealAmount(p.amountBrl)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
        <h3 className="font-bold text-[15px] mb-1">Performance por vendedor ({period.label})</h3>
        <p className="text-xs text-text-muted mb-4">Negócios criados nesse período, agrupados pelo responsável atribuído.</p>
        {vendorPerformance.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-6">Nenhum negócio criado nesse período ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                  <th className="px-3 py-2">Vendedor</th>
                  <th className="px-3 py-2 text-right">Abertos</th>
                  <th className="px-3 py-2 text-right">Ganhos</th>
                  <th className="px-3 py-2 text-right">Perdidos</th>
                  <th className="px-3 py-2 text-right">Valor ganho</th>
                  <th className="px-3 py-2 text-right">Taxa de conversão</th>
                </tr>
              </thead>
              <tbody>
                {vendorPerformance.map((v) => (
                  <tr key={v.responsibleUserId ?? "sem_responsavel"} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 font-semibold">
                      {v.responsibleUserId ? vendorNames.get(v.responsibleUserId) || "sem nome" : "Sem responsável"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{v.open}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{v.won}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{v.lost}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold">{formatDealAmount(v.wonAmountBrl)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">
                      {v.conversionRatePct === null ? "—" : `${v.conversionRatePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
        <p className="font-semibold text-text">Funil de campanhas — sem dados ainda</p>
        <p className="text-sm mt-1">Aparece assim que a primeira campanha for disparada.</p>
      </div>
    </div>
  );
}
