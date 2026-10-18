// Insights da IA na Visão geral: 3 observações curtas sobre o funil, geradas a partir de números
// agregados (nunca dados pessoais crus) e dos resumos de análise de lead já existentes.

export type InsightKind = "risco" | "oportunidade" | "info";
export type AiInsight = { kind: InsightKind; title: string; detail: string; href: string | null; action: string | null };

export const INSIGHTS_SYSTEM =
  "Você é um consultor comercial olhando o CRM de uma empresa que vende pelo WhatsApp. A partir dos números, " +
  "aponte o que merece atenção hoje: riscos (leads esfriando, gargalos), oportunidades (leads quentes, produtos em alta) " +
  "e observações úteis. Português do Brasil, frases curtas, sem inventar números que não estão nos dados.";

const LINKS: Record<string, string> = { pipeline: "/crm", conversas: "/conversas", campanhas: "/campanhas", agentes: "/agentes", tarefas: "/agenda", automacoes: "/automacoes" };

export type InsightsInput = {
  total: number;
  byStage: Record<string, number>;
  staleByStage: Record<string, number>;
  attention: number;
  hot: number;
  topProducts: { name: string; count: number }[];
  summaries: string[];
  staleDays: number;
};

export function insightsPrompt(d: InsightsInput): string {
  return (
    `Total de leads: ${d.total}\nLeads por etapa: ${JSON.stringify(d.byStage)}\n` +
    `Parados há ${d.staleDays}+ dias, por etapa: ${JSON.stringify(d.staleByStage)}\n` +
    `Conversas aguardando a equipe: ${d.attention}\nLeads marcados como quentes pela IA: ${d.hot}\n` +
    `Produtos mais citados: ${JSON.stringify(d.topProducts)}\n` +
    (d.summaries.length ? `Resumos recentes de conversas:\n- ${d.summaries.join("\n- ")}\n` : "") +
    '\nDevolva um array com exatamente 3 itens: [{"kind": "risco"|"oportunidade"|"info", "title": "até 60 caracteres", ' +
    '"detail": "1 frase", "link": "pipeline"|"conversas"|"campanhas"|"agentes"|"tarefas"|"automacoes"|null, "action": "texto curto do botão ou null"}]'
  );
}

export function normalizeInsights(raw: unknown): AiInsight[] {
  if (!Array.isArray(raw)) return [];
  const out: AiInsight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = String(r.title || "").trim().slice(0, 90);
    const detail = String(r.detail || "").trim().slice(0, 240);
    if (!title) continue;
    const k = String(r.kind || "");
    const kind: InsightKind = k === "risco" || k === "oportunidade" ? k : "info";
    const link = typeof r.link === "string" ? LINKS[r.link] ?? null : typeof r.href === "string" && r.href.startsWith("/") ? r.href : null;
    const action = typeof r.action === "string" && r.action.trim() ? r.action.trim().slice(0, 30) : null;
    out.push({ kind, title, detail, href: link, action: link ? action || "Ver" : null });
  }
  return out.slice(0, 3);
}
