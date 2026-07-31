// KPIs de Volume/Conversão e funil de estágios da Visão geral — tudo derivado das tabelas que já
// existem (contacts, messages), sem schema novo. Duas simplificações conscientes, documentadas
// onde entram: (1) taxa de interesse/qualificação e o funil usam o ESTÁGIO ATUAL do contato, não um
// histórico de quando cada transição aconteceu (a tabela não guarda histórico, só a última
// mudança) — é uma leitura "onde ele está hoje", não "quando ele passou por ali"; (2) consultas que
// precisam de "primeira mensagem por contato" (conversas iniciadas) usam o mesmo limite de 20000
// linhas já usado em outras consultas do projeto — segue o padrão existente, não é ilimitado.
import { createClient } from "@/lib/supabase/server";
import { resolveHiddenStages, getVisibleStages, displayStageFor, resolveStageLabels, type ContactStage } from "@/lib/crm-stages";
import type { Range } from "@/lib/cost-monitor";

export type VolumeMetrics = {
  leadsRecebidos: number;
  leadsAbordados: number;
  mensagensEnviadas: number;
  conversasIniciadas: number;
};

export type ConversionMetrics = {
  taxaResposta: number | null; // null = sem base pra calcular (0 abordados)
  taxaInteresse: number | null;
  taxaQualificacao: number | null;
  taxaFechamento: number | null;
};

export type FunnelPoint = { stage: ContactStage; label: string; value: number };

// Estágios que compõem o funil "linha reta" de conversão — "descartado" fica de fora de propósito:
// é uma saída lateral (pode acontecer a partir de qualquer fase), não um degrau que se soma aos
// anteriores. Contagem de descartados aparece à parte, não dentro do funil.
export const FUNNEL_HAPPY_PATH: ContactStage[] = ["nao_abordado", "abordado", "interessado", "encaminhamento", "fechando_proposta", "concluido"];
const INTERESSE_OU_ALEM: ContactStage[] = ["interessado", "encaminhamento", "fechando_proposta", "concluido"];
const QUALIFICADO_OU_ALEM: ContactStage[] = ["encaminhamento", "fechando_proposta", "concluido"];
const FECHADO: ContactStage[] = ["concluido"];

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function getVolumeMetrics(workspaceId: string, range: Range): Promise<VolumeMetrics> {
  const supabase = await createClient();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [{ count: leadsRecebidos }, { data: abordadosRows }, { count: mensagensEnviadas }, { data: allMsgsAsc }] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", fromIso).lte("created_at", toIso),
    supabase.from("messages").select("contact_id").eq("workspace_id", workspaceId).eq("role", "assistant").gte("created_at", fromIso).lte("created_at", toIso).limit(20000),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("role", "assistant").gte("created_at", fromIso).lte("created_at", toIso),
    supabase
      .from("messages")
      .select("contact_id, agent_id, created_at")
      .eq("workspace_id", workspaceId)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .limit(20000),
  ]);

  const leadsAbordados = new Set((abordadosRows || []).map((r) => r.contact_id)).size;

  // "Conversa iniciada" = primeira mensagem (de qualquer papel) de um par contato+agente cai dentro
  // do período — ordenado ascendente, a primeira ocorrência de cada chave já é a mais antiga.
  const firstSeen = new Map<string, string>();
  for (const m of allMsgsAsc || []) {
    const key = `${m.contact_id}:${m.agent_id ?? "blast"}`;
    if (!firstSeen.has(key)) firstSeen.set(key, m.created_at as string);
  }
  let conversasIniciadas = 0;
  for (const createdAt of firstSeen.values()) {
    if (createdAt >= fromIso && createdAt <= toIso) conversasIniciadas++;
  }

  return { leadsRecebidos: leadsRecebidos ?? 0, leadsAbordados, mensagensEnviadas: mensagensEnviadas ?? 0, conversasIniciadas };
}

export async function getConversionMetrics(workspaceId: string, range: Range): Promise<ConversionMetrics> {
  const supabase = await createClient();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const { data: abordadosRows } = await supabase
    .from("messages")
    .select("contact_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "assistant")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .limit(20000);
  const abordadosIds = [...new Set((abordadosRows || []).map((r) => r.contact_id as string))];
  if (abordadosIds.length === 0) return { taxaResposta: null, taxaInteresse: null, taxaQualificacao: null, taxaFechamento: null };

  const [{ data: responderamRows }, { data: contactStages }] = await Promise.all([
    supabase.from("messages").select("contact_id").eq("workspace_id", workspaceId).eq("role", "user").in("contact_id", abordadosIds).gte("created_at", fromIso).lte("created_at", toIso).limit(20000),
    supabase.from("contacts").select("stage").in("id", abordadosIds),
  ]);

  const responderam = new Set((responderamRows || []).map((r) => r.contact_id)).size;
  const stages = (contactStages || []).map((c) => c.stage as ContactStage);
  const interessados = stages.filter((s) => INTERESSE_OU_ALEM.includes(s)).length;
  const qualificados = stages.filter((s) => QUALIFICADO_OU_ALEM.includes(s)).length;
  const fechados = stages.filter((s) => FECHADO.includes(s)).length;

  return {
    taxaResposta: pct(responderam, abordadosIds.length),
    taxaInteresse: pct(interessados, abordadosIds.length),
    taxaQualificacao: pct(qualificados, abordadosIds.length),
    taxaFechamento: pct(fechados, abordadosIds.length),
  };
}

// Funil da coorte de leads recebidos no período: pra cada estágio "reto" (exceto descartado),
// quantos desses leads já chegaram ali (ou além) até agora — leitura cumulativa, igual todo funil de
// CRM (Pipedrive/HubSpot etc. fazem o mesmo: mostram o estágio mais avançado já alcançado, não
// exigem que o contato tenha passado por cada degrau em ordem perfeita).
export async function getFunnelData(
  workspaceId: string,
  range: Range,
  funnelEnd: ContactStage = "concluido"
): Promise<{ points: FunnelPoint[]; descartados: number }> {
  const supabase = await createClient();
  const [{ data: contacts }, { data: workspaceRow }] = await Promise.all([
    supabase
      .from("contacts")
      .select("stage")
      .eq("workspace_id", workspaceId)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .limit(20000),
    supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages").eq("id", workspaceId).maybeSingle(),
  ]);

  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const hiddenStages = resolveHiddenStages(workspaceRow?.crm_hidden_stages);
  const visibleStages = getVisibleStages(hiddenStages);
  // Corta o funil no fim que o plano do workspace prevê (SDR para em "encaminhamento" — não faz
  // sentido mostrar fase de fechamento de quem não fecha) e ainda respeita as fases escondidas do
  // Kanban desse cliente especificamente (os dois filtros são independentes).
  const endIdx = FUNNEL_HAPPY_PATH.indexOf(funnelEnd);
  const happyPathForPlan = endIdx === -1 ? FUNNEL_HAPPY_PATH : FUNNEL_HAPPY_PATH.slice(0, endIdx + 1);
  const funnelStages = happyPathForPlan.filter((s) => visibleStages.includes(s));

  let descartados = 0;
  const displayStageIndex: number[] = new Array(funnelStages.length).fill(0);
  for (const c of contacts || []) {
    const stage = c.stage as ContactStage;
    if (stage === "descartado") {
      descartados++;
      continue;
    }
    const display = displayStageFor(stage, visibleStages);
    let idx = funnelStages.indexOf(display as ContactStage);
    if (idx === -1) {
      // Passou do fim do funil desse plano (ex.: contato "concluido" num workspace plano "sdr", de
      // antes da mudança de plano) — ainda conta como tendo alcançado o último degrau mostrado.
      if (FUNNEL_HAPPY_PATH.indexOf(display as ContactStage) === -1) continue; // não deveria acontecer
      idx = funnelStages.length - 1;
    }
    for (let i = 0; i <= idx; i++) displayStageIndex[i]++;
  }

  const points: FunnelPoint[] = funnelStages.map((stage, i) => ({ stage, label: stageLabels[stage], value: displayStageIndex[i] }));
  return { points, descartados };
}
