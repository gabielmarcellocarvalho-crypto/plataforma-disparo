import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { getCostByAgentInRange, getDailyCostInRange, getConversationsInRange, getAiUsageCostInRange, COST_USD_TO_BRL } from "@/lib/cost-monitor";
import { AI_FEATURE_LABELS, type AiFeature } from "@/lib/ai-usage";
import { resolvePeriod, dayKeyBrt } from "@/lib/period";
import { getWhatsappCostInRange } from "@/lib/whatsapp-cost";
import { WHATSAPP_PRICE_BRL } from "@/lib/whatsapp-pricing";
import { PeriodFilterBar } from "@/components/period-filter-bar";
import { CostBudgetCard } from "@/components/cost-budget-card";
import { CostStackedBarChart } from "@/components/charts/cost-stacked-bar-chart";
import { LeadReportsSection } from "@/components/lead-reports";
import { getLeadReports } from "@/lib/lead-reports";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
import { listBranches, listTeamMembers } from "@/app/actions/team";
import { resolveStageLabels } from "@/lib/crm-stages";
import { getAgentServiceStats, type AgentServiceStats } from "@/lib/agent-service-stats";
import { SectionNav, type NavSection } from "@/components/section-nav";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await assertPageAccess("/metricas");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const { workspace, isStaff } = await getCurrentWorkspace();

  // Custo (por agente) e orçamento só fazem sentido pra colaborador — cliente nunca vê custo/margem.
  const showCost = Boolean(workspace && isStaff);

  const [agentCosts, budgetRow, dailyCost, conversationsInPeriod, whatsappCost, extraAiCosts] = showCost
    ? await Promise.all([
        getCostByAgentInRange(workspace!.id, period),
        createClient().then((s) =>
          s.from("workspaces").select("monthly_cost_budget_brl, cost_alert_pct").eq("id", workspace!.id).maybeSingle()
        ),
        getDailyCostInRange(workspace!.id, period),
        getConversationsInRange(workspace!.id, period),
        getWhatsappCostInRange(workspace!.id, period),
        getAiUsageCostInRange(workspace!.id, period),
      ])
    : [[], { data: null }, [], 0, null, []];

  // Gráfico: IA (Claude e Gemini) + WhatsApp oficial, empilhados por dia.
  const chartData = dailyCost.map((d) => ({
    ...d,
    whatsapp: Math.round((whatsappCost?.byDay.get(dayKeyBrt(d.date)) || 0) * 100) / 100,
  }));
  const claudeBrl = dailyCost.reduce((sum, d) => sum + d.claude, 0);
  const geminiBrl = dailyCost.reduce((sum, d) => sum + d.gemini, 0);
  const whatsappBrl = whatsappCost?.totalBrl || 0;
  const grandTotalBrl = claudeBrl + geminiBrl + whatsappBrl;

  // Custo de IA = respostas dos agentes + funções extras (análise de lead, insights, sugestões, testes).
  const extraAiUsd = extraAiCosts.reduce((sum, f) => sum + f.costUsd, 0);
  const totalCostUsd = agentCosts.reduce((sum, a) => sum + a.costUsd, 0) + extraAiUsd;
  const totalCostBrl = totalCostUsd * COST_USD_TO_BRL;
  const totalMessages = agentCosts.reduce((sum, a) => sum + a.messages, 0);
  const totalConversations = agentCosts.reduce((sum, a) => sum + a.conversations, 0);
  const avgCostPerConversationBrl = totalConversations > 0 ? totalCostBrl / totalConversations : 0;
  const budget = (budgetRow as { data: { monthly_cost_budget_brl: number | null; cost_alert_pct: number | null } | null }).data;

  // Relatórios de lead veem TODO MUNDO (diferente do custo de IA, que é margem da agência): são as
  // tabelas dinâmicas que o cliente já mantinha na mão e é justamente o que ele quer olhar.
  const leadReports = workspace
    ? await (async () => {
        const supabase = await createClient();
        const [fieldDefs, teamMembers, branches, { data: ws }] = await Promise.all([
          listCustomFieldDefs(),
          listTeamMembers(),
          listBranches(),
          supabase.from("workspaces").select("crm_stage_labels").eq("id", workspace.id).maybeSingle(),
        ]);
        return getLeadReports(workspace.id, period, {
          fieldDefs,
          stageLabels: resolveStageLabels(ws?.crm_stage_labels),
          teamNames: new Map(teamMembers.map((m) => [m.id, m.name])),
          branchNames: new Map(branches.map((b) => [b.id, b.name])),
        });
      })()
    : null;

  const service = workspace ? await getAgentServiceStats(workspace.id, period) : null;

  const sections: NavSection[] = [
    ...(leadReports ? [{ id: "vendas", label: "Vendas e leads", content: <LeadReportsSection reports={leadReports} periodLabel={period.label} /> }] : []),
    ...(service
      ? [
          {
            id: "atendimento",
            label: "Atendimento IA",
            content: <AgentServiceSection stats={service} periodLabel={period.label} />,
          },
        ]
      : []),
    ...(showCost
      ? [
          {
            id: "custos",
            label: "Custos",
            content: (
              <>
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">IA Claude ({period.label})</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">R$ {claudeBrl.toFixed(2)}</b>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">IA Gemini (estimado) ({period.label})</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">R$ {geminiBrl.toFixed(2)}</b>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">WhatsApp oficial ({period.label})</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">R$ {whatsappBrl.toFixed(2)}</b>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-semibold text-text-muted">Custo total ({period.label})</span>
            <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">R$ {grandTotalBrl.toFixed(2)}</b>
          </div>
        </div>
      )}

      {showCost && (
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-[15px] mb-1">Custo por dia ({period.label})</h3>
          <p className="text-xs text-text-muted mb-4">
            IA Claude e Gemini pelos tokens de cada agente, e WhatsApp oficial pela tarifa da Meta. Ajuda a ver de onde vem o gasto de cada dia.
          </p>
          <CostStackedBarChart data={chartData} />
        </div>
      )}

      {showCost && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-bold text-[15px]">Funções de IA além do agente ({period.label})</h3>
          <p className="text-xs text-text-muted mt-0.5 mb-4">
            Análise de lead, insights, sugestão de resposta e teste do agente. Já estão somadas no custo de IA e no orçamento do mês.
          </p>
          {extraAiCosts.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">Nenhum uso nesse período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                    <th className="px-3 py-2">Função</th>
                    <th className="px-3 py-2 text-right">Usos</th>
                    <th className="px-3 py-2 text-right">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {extraAiCosts.map((f) => (
                    <tr key={f.feature} className="border-b border-border last:border-0">
                      <td className="px-3 py-2.5 font-semibold">{AI_FEATURE_LABELS[f.feature as AiFeature] ?? f.feature}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{f.uses}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold">R$ {(f.costUsd * COST_USD_TO_BRL).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showCost && whatsappCost && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-bold text-[15px]">WhatsApp oficial — cobrança da Meta ({period.label})</h3>
          <p className="text-xs text-text-muted mt-0.5 mb-4">
            Serviço: 1.000 respostas grátis por número por mês, depois R$ {WHATSAPP_PRICE_BRL.service.toFixed(3)}. Quem clicou em anúncio nas últimas 72h não paga.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2 text-right">Mensagens</th>
                  <th className="px-3 py-2 text-right">Tarifa</th>
                  <th className="px-3 py-2 text-right">Custo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="px-3 py-2.5 font-semibold">Serviço (resposta do agente)</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {whatsappCost.serviceMessages} <span className="text-text-muted">({whatsappCost.serviceFree} grátis)</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">R$ {WHATSAPP_PRICE_BRL.service.toFixed(4)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">R$ {whatsappCost.serviceCostBrl.toFixed(2)}</td>
                </tr>
                {(["utility", "marketing", "authentication"] as const).map((k) => (
                  <tr key={k} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 font-semibold">{k === "utility" ? "Utilidade (template)" : k === "marketing" ? "Marketing (template)" : "Autenticação (template)"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{whatsappCost.templates[k].count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">R$ {WHATSAPP_PRICE_BRL[k].toFixed(4)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold">R$ {whatsappCost.templates[k].costBrl.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="relative flex flex-col gap-6">
      <PeriodFilterBar activePreset={period.preset} from={sp.from ?? ""} to={sp.to ?? ""} />
      <SectionNav sections={sections} param="aba" layout="tabs" />
    </div>
  );
}

function AgentServiceSection({ stats, periodLabel }: { stats: AgentServiceStats; periodLabel: string }) {
  const kpi = "bg-surface border border-border rounded-2xl p-5 shadow-sm";
  return (
    <>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className={kpi}>
          <span className="text-xs font-semibold text-text-muted">Conversas atendidas pela IA ({periodLabel})</span>
          <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">{stats.totalConversations}</b>
        </div>
        <div className={kpi}>
          <span className="text-xs font-semibold text-text-muted">Resolvidas sem humano</span>
          <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none text-success">{stats.resolutionRate}%</b>
        </div>
        <div className={kpi}>
          <span className="text-xs font-semibold text-text-muted">Precisaram da equipe</span>
          <b className="block text-[26px] font-extrabold tracking-tight mt-2 leading-none">{stats.totalEscalated}</b>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-bold text-[15px] mb-1">Por agente</h3>
          <p className="text-xs text-text-muted mb-4">Das conversas que cada agente atendeu no período, quantas não precisaram de alguém da equipe.</p>
          {stats.rows.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">Nenhuma conversa de agente nesse período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                    <th className="px-3 py-2">Agente</th>
                    <th className="px-3 py-2 text-right">Conversas</th>
                    <th className="px-3 py-2 text-right">Com a equipe</th>
                    <th className="px-3 py-2">Resolução sem humano</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.rows.map((r) => (
                    <tr key={r.agentId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2.5 font-semibold">{r.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.conversations}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.escalated}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 min-w-[80px] rounded-full bg-surface-2 overflow-hidden">
                            <div className="h-full bg-success rounded-full" style={{ width: `${r.resolutionRate}%` }} />
                          </div>
                          <span className="tabular-nums text-xs font-bold w-9 text-right">{r.resolutionRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-bold text-[15px] mb-1">Por que precisou da equipe</h3>
          <p className="text-xs text-text-muted mb-4">Motivos das conversas que estão aguardando alguém agora.</p>
          {stats.reasons.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">Nenhuma conversa aguardando a equipe.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {stats.reasons.map((r) => (
                <li key={r.reason}>
                  <div className="flex justify-between gap-3 text-xs mb-1">
                    <span className="font-semibold">{r.reason}</span>
                    <span className="tabular-nums text-text-muted">{r.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round((r.count / stats.reasons[0].count) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
