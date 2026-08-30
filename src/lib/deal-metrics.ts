// Relatórios de Negócios (Deals) pra /metricas — mesma organização de overview-metrics.ts, mas sobre
// a coorte de negócios CRIADOS no período (mesmo critério que getFunnelData usa pra contatos), não
// negócios movimentados nele.
import { createClient } from "@/lib/supabase/server";
import { getDefaultPipeline } from "@/app/actions/deals";
import type { Range } from "@/lib/cost-monitor";

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export type DealFunnelPoint = { stage: string; label: string; value: number; amountBrl: number };

export async function getDealsFunnel(workspaceId: string, range: Range): Promise<{ points: DealFunnelPoint[] }> {
  const pipeline = await getDefaultPipeline(workspaceId);
  if (!pipeline || pipeline.stages.length === 0) return { points: [] };

  const supabase = await createClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("stage_id, amount")
    .eq("workspace_id", workspaceId)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString())
    .limit(20000);

  const countByStage = new Map<string, number>();
  const amountByStage = new Map<string, number>();
  for (const d of deals || []) {
    countByStage.set(d.stage_id, (countByStage.get(d.stage_id) || 0) + 1);
    amountByStage.set(d.stage_id, (amountByStage.get(d.stage_id) || 0) + (d.amount || 0));
  }

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);
  const points: DealFunnelPoint[] = stages.map((s) => ({
    stage: s.id,
    label: s.name,
    value: countByStage.get(s.id) || 0,
    amountBrl: amountByStage.get(s.id) || 0,
  }));

  return { points };
}

export type VendorPerformance = {
  responsibleUserId: string | null;
  open: number;
  won: number;
  lost: number;
  wonAmountBrl: number;
  conversionRatePct: number | null;
};

export async function getVendorPerformance(workspaceId: string, range: Range): Promise<VendorPerformance[]> {
  const supabase = await createClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("responsible_user_id, status, amount")
    .eq("workspace_id", workspaceId)
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString())
    .limit(20000);

  const byResponsible = new Map<string | null, { open: number; won: number; lost: number; wonAmount: number }>();
  for (const d of deals || []) {
    const key = d.responsible_user_id;
    const entry = byResponsible.get(key) || { open: 0, won: 0, lost: 0, wonAmount: 0 };
    if (d.status === "open") entry.open++;
    else if (d.status === "won") {
      entry.won++;
      entry.wonAmount += d.amount || 0;
    } else if (d.status === "lost") entry.lost++;
    byResponsible.set(key, entry);
  }

  const rows: VendorPerformance[] = [...byResponsible.entries()].map(([responsibleUserId, e]) => ({
    responsibleUserId,
    open: e.open,
    won: e.won,
    lost: e.lost,
    wonAmountBrl: e.wonAmount,
    conversionRatePct: pct(e.won, e.won + e.lost),
  }));

  return rows.sort((a, b) => b.wonAmountBrl - a.wonAmountBrl);
}
