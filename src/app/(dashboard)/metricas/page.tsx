import { getCurrentWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { getMonthToDateCostByAgent, COST_USD_TO_BRL } from "@/lib/cost-monitor";
import { CostBudgetCard } from "@/components/cost-budget-card";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export default async function MetricasPage() {
  const { workspace, isColaborador } = await getCurrentWorkspace();

  // Custo (por agente) e orçamento só fazem sentido pra colaborador — cliente nunca vê custo/margem.
  const showCost = Boolean(workspace && isColaborador);

  const [agentCosts, budgetRow] = showCost
    ? await Promise.all([
        getMonthToDateCostByAgent(workspace!.id),
        createClient().then((s) =>
          s.from("workspaces").select("monthly_cost_budget_brl, cost_alert_pct").eq("id", workspace!.id).maybeSingle()
        ),
      ])
    : [[], { data: null }];

  const totalCostUsd = agentCosts.reduce((sum, a) => sum + a.costUsd, 0);
  const totalMessages = agentCosts.reduce((sum, a) => sum + a.messages, 0);
  const totalConversations = agentCosts.reduce((sum, a) => sum + a.conversations, 0);
  const budget = (budgetRow as { data: { monthly_cost_budget_brl: number | null; cost_alert_pct: number | null } | null }).data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Métricas</h1>
        <p className="text-text-muted text-sm mt-1">Custo e desempenho do workspace atual — custos referem-se ao mês corrente.</p>
      </div>

      {showCost && (
        <CostBudgetCard
          workspaceId={workspace!.id}
          costBrl={totalCostUsd * COST_USD_TO_BRL}
          initialBudgetBrl={budget?.monthly_cost_budget_brl ?? null}
          initialThresholdPct={budget?.cost_alert_pct ?? 80}
        />
      )}

      {showCost && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <h3 className="font-bold text-[15px]">Custo de IA por agente (mês)</h3>
              <p className="text-xs text-text-muted mt-0.5">
                {totalMessages} resposta(s) em {totalConversations} conversa(s) — modelo {ANTHROPIC_MODEL}.
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-extrabold">R$ {(totalCostUsd * COST_USD_TO_BRL).toFixed(2)}</div>
              <div className="text-xs text-text-muted">total do mês</div>
            </div>
          </div>

          {agentCosts.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">Nenhuma resposta de agente este mês ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                    <th className="px-3 py-2">Agente</th>
                    <th className="px-3 py-2 text-right">Mensagens</th>
                    <th className="px-3 py-2 text-right">Conversas</th>
                    <th className="px-3 py-2 text-right">Custo (mês)</th>
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
