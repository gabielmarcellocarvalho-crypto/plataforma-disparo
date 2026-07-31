import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { getCostByAgentInRange, getDailyCostInRange, getConversationsInRange, COST_USD_TO_BRL } from "@/lib/cost-monitor";
import { resolvePeriod } from "@/lib/period";
import { PeriodFilterBar } from "@/components/period-filter-bar";
import { CostBudgetCard } from "@/components/cost-budget-card";
import { CostStackedBarChart } from "@/components/charts/cost-stacked-bar-chart";

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

      <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
        <p className="font-semibold text-text">Funil de campanhas — sem dados ainda</p>
        <p className="text-sm mt-1">Aparece assim que a primeira campanha for disparada.</p>
      </div>
    </div>
  );
}
