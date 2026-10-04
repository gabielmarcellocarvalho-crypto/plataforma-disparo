// Custo oficial do WhatsApp por período (Meta, por mensagem entregue). Só conta números da API oficial
// (360dialog / Cloud API) — Evolution não tem cobrança por mensagem.
//  - Serviço: resposta do agente em texto livre. 1.000 grátis por número/mês, o resto a R$ 0,035.
//  - Template (utility / marketing / authentication): cobrado por entrega, com a tarifa da categoria.
//  - Quem clicou em anúncio Click-to-WhatsApp nas últimas 72h não paga nada (nem serviço, nem template).
import { createClient } from "@/lib/supabase/server";
import { dayKeyBrt } from "@/lib/period";
import { WHATSAPP_PRICE_BRL, SERVICE_FREE_PER_NUMBER_MONTH, SERVICE_CHARGE_FROM, CTWA_WINDOW_MS } from "@/lib/whatsapp-pricing";
import type { Range } from "@/lib/cost-monitor";

type TemplateCategory = "marketing" | "utility" | "authentication";
export type WhatsappCostSummary = {
  serviceMessages: number; // respostas de serviço do agente no período (inclui as grátis)
  serviceFree: number; // grátis: dentro da franquia mensal ou dentro da janela de anúncio
  serviceCharged: number;
  serviceCostBrl: number;
  templates: Record<TemplateCategory, { count: number; costBrl: number }>;
  totalBrl: number;
  byDay: Map<string, number>;
};

const PAGE = 1000;

// PostgREST devolve no máximo 1000 linhas por resposta (teto do servidor): pagina até acabar.
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function getWhatsappCostInRange(workspaceId: string, range: Range): Promise<WhatsappCostSummary> {
  const supabase = await createClient();
  const summary: WhatsappCostSummary = {
    serviceMessages: 0,
    serviceFree: 0,
    serviceCharged: 0,
    serviceCostBrl: 0,
    templates: {
      marketing: { count: 0, costBrl: 0 },
      utility: { count: 0, costBrl: 0 },
      authentication: { count: 0, costBrl: 0 },
    },
    totalBrl: 0,
    byDay: new Map<string, number>(),
  };

  // Agente -> instância oficial (só a oficial cobra).
  const [agents, instances] = await Promise.all([
    supabase.from("agents").select("id, whatsapp_instance_id").eq("workspace_id", workspaceId),
    supabase.from("whatsapp_instances").select("id, channel").eq("workspace_id", workspaceId),
  ]);
  const officialInstance = new Set((instances.data || []).filter((i) => i.channel !== "evolution").map((i) => i.id as string));
  const officialAgent = new Map(
    (agents.data || []).filter((a) => a.whatsapp_instance_id && officialInstance.has(a.whatsapp_instance_id as string)).map((a) => [a.id as string, a.whatsapp_instance_id as string])
  );

  // Contato -> último clique em anúncio que ainda cobre o período (começa 72h antes do período).
  const ctwaFrom = new Date(range.from.getTime() - CTWA_WINDOW_MS).toISOString();
  const ctwaRows = await fetchAll((f, t) =>
    supabase.from("contacts").select("id, ctwa_at").eq("workspace_id", workspaceId).not("ctwa_at", "is", null).gte("ctwa_at", ctwaFrom).lte("ctwa_at", range.to.toISOString()).order("id").range(f, t)
  );
  const ctwaByContact = new Map(ctwaRows.map((c) => [c.id as string, new Date(c.ctwa_at as string).getTime()]));
  const inCtwaWindow = (contactId: string, at: number) => {
    const start = ctwaByContact.get(contactId);
    return start !== undefined && at >= start && at < start + CTWA_WINDOW_MS;
  };

  const addDay = (createdAt: string, cost: number) => {
    const key = dayKeyBrt(createdAt);
    summary.byDay.set(key, (summary.byDay.get(key) || 0) + cost);
  };

  // Templates (campanha oficial) — cobrados pela categoria, grátis só dentro da janela de anúncio.
  const templateRows = await fetchAll((f, t) =>
    supabase
      .from("messages")
      .select("contact_id, billing_category, created_at")
      .eq("workspace_id", workspaceId)
      .not("billing_category", "is", null)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .order("created_at")
      .order("id")
      .range(f, t)
  );
  for (const row of templateRows) {
    const category = row.billing_category as TemplateCategory;
    const at = new Date(row.created_at as string).getTime();
    if (inCtwaWindow(row.contact_id as string, at)) continue;
    const cost = WHATSAPP_PRICE_BRL[category];
    summary.templates[category].count += 1;
    summary.templates[category].costBrl += cost;
    addDay(row.created_at as string, cost);
  }

  // Serviço (resposta do agente em texto livre) — só agente de número oficial, só a partir de 01/10/2026 cobra.
  const serviceRows = await fetchAll((f, t) =>
    supabase
      .from("messages")
      .select("agent_id, contact_id, created_at")
      .eq("workspace_id", workspaceId)
      .eq("role", "assistant")
      .not("agent_id", "is", null)
      .is("billing_category", null)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .order("created_at")
      .order("id")
      .range(f, t)
  );
  // Franquia: conta por número e por mês (BRT), em ordem cronológica.
  const usedByInstanceMonth = new Map<string, number>();
  for (const row of serviceRows) {
    const instanceId = officialAgent.get(row.agent_id as string);
    if (!instanceId) continue;
    summary.serviceMessages += 1;
    const at = new Date(row.created_at as string);
    if (inCtwaWindow(row.contact_id as string, at.getTime()) || at < SERVICE_CHARGE_FROM) {
      summary.serviceFree += 1;
      continue;
    }
    const monthKey = `${instanceId}|${dayKeyBrt(row.created_at as string).slice(0, 7)}`;
    const used = (usedByInstanceMonth.get(monthKey) || 0) + 1;
    usedByInstanceMonth.set(monthKey, used);
    if (used <= SERVICE_FREE_PER_NUMBER_MONTH) {
      summary.serviceFree += 1;
      continue;
    }
    summary.serviceCharged += 1;
    summary.serviceCostBrl += WHATSAPP_PRICE_BRL.service;
    addDay(row.created_at as string, WHATSAPP_PRICE_BRL.service);
  }

  const templateTotal = (Object.keys(summary.templates) as TemplateCategory[]).reduce((sum, k) => sum + summary.templates[k].costBrl, 0);
  summary.totalBrl = summary.serviceCostBrl + templateTotal;
  return summary;
}
