// KPIs de Volume/Conversão e funil de estágios da Visão geral — tudo derivado das tabelas que já
// existem (contacts, messages), sem schema novo. Duas simplificações conscientes, documentadas
// onde entram: (1) taxa de interesse/qualificação e o funil usam o ESTÁGIO ATUAL do contato, não um
// histórico de quando cada transição aconteceu (a tabela não guarda histórico, só a última
// mudança) — é uma leitura "onde ele está hoje", não "quando ele passou por ali"; (2) consultas que
// precisam varrer linha a linha (ex.: "primeira mensagem por contato", pra contar conversas
// iniciadas) param em MAX_ROWS — é um teto alto, mas não é ilimitado.
import { createClient } from "@/lib/supabase/server";
import { resolveHiddenStages, getVisibleStages, displayStageFor, resolveStageLabels, type ContactStage } from "@/lib/crm-stages";
import type { Range } from "@/lib/cost-monitor";
import { dayKeyBrt } from "@/lib/period";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// O Supabase tem "Max Rows" travado em 1000 na API: um `.limit(20000)` do client é silenciosamente
// IGNORADO e a resposta volta cortada em 1000 linhas, sem erro nenhum — a métrica sai errada pra
// baixo e ninguém percebe (era o caso de TB Rio e Hanoi, que já passam de 1000 contatos). Toda
// consulta "traz tudo e agrega em memória" aqui passa por fetchAllPaged, que pagina de 1000 em 1000
// até o teto real. Mesma abordagem já usada em /conversas.
const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

// A query precisa ter `.order()` estável — sem ordem definida o Postgrest não garante que a página 2
// venha depois da 1, e linhas repetem/somem entre páginas.
async function fetchAllPaged<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (all.length < MAX_ROWS) {
    const { data } = await query(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// Estágio atual de todo contato do workspace, em um mapa. Substitui os `.in("id", [...centenas de
// ids])` que existiam aqui: além de estourarem o tamanho da URL com base grande (mesmo bug que
// esvaziou /conversas), eles vinham cortados em 1000 de qualquer forma.
async function fetchStageByContact(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string
): Promise<Map<string, ContactStage>> {
  const rows = await fetchAllPaged<{ id: string; stage: string }>((from, to) =>
    supabase.from("contacts").select("id, stage").eq("workspace_id", workspaceId).order("id", { ascending: true }).range(from, to)
  );
  return new Map(rows.map((c) => [c.id, c.stage as ContactStage]));
}

export type EmailClickMetrics = { sent: number; clicked: number; clickRatePct: number | null; failedNow: number };

// Enviados/clicados das sequências de e-mail (Dia 1/5/10/15/21...) — cada linha de email_clicks só
// existe depois de um envio CONFIRMADO pelo Resend (nunca de uma tentativa que falhou), então "sent"
// aqui já é entrega de verdade, não tentativa. clicked_at preenchido = converteu (clicou no CTA, foi
// pro WhatsApp).
export async function getEmailClickMetrics(workspaceId: string, range: Range): Promise<EmailClickMetrics> {
  const supabase = await createClient();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  // Só contagens: antes isso trazia cada linha de email_clicks (em páginas seguidas) só pra contar.
  const [{ count: sent }, { count: clicked }, { count: failedNow }] = await Promise.all([
    supabase.from("email_clicks").select("sent_at", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("sent_at", fromIso).lte("sent_at", toIso),
    supabase
      .from("email_clicks")
      .select("sent_at", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("sent_at", fromIso)
      .lte("sent_at", toIso)
      .not("clicked_at", "is", null),
    // Sem período aqui de propósito: campaign_recipients não guarda quando a falha aconteceu (só
    // sent_at, que fica nulo em falha), então "falhando agora" é o estado atual, não um recorte do
    // período selecionado — é um alerta de "tem algo travado", não uma métrica histórica.
    supabase
      .from("campaign_recipients")
      .select("id, campaigns!inner(workspace_id, channel)", { count: "exact", head: true })
      .eq("campaigns.workspace_id", workspaceId)
      .eq("campaigns.channel", "email")
      .eq("status", "falhou"),
  ]);

  const sentN = sent ?? 0;
  const clickedN = clicked ?? 0;
  return { sent: sentN, clicked: clickedN, clickRatePct: sentN > 0 ? Math.round((clickedN / sentN) * 1000) / 10 : null, failedNow: failedNow ?? 0 };
}

export type VolumeMetrics = {
  leadsRecebidos: number;
  leadsAbordados: number;
  mensagensEnviadas: number;
  mensagensRecebidas: number;
  conversasIniciadas: number;
  conversasEmAndamento: number;
};

export type ResponseMetrics = {
  tempoMedioRespostaMin: number | null; // null = nenhuma resposta no período pra calcular média
  conversasNaoRespondidas: number; // última mensagem foi nossa, contato ainda não respondeu
  maisTempoEsperandoMin: number | null; // maior espera atual entre as conversas ativas no período
};

export type LeadSource = { label: string; value: number };

const TERMINAL_STAGES: ContactStage[] = ["concluido", "descartado"];

export type ConversionMetrics = {
  taxaResposta: number | null; // null = sem base pra calcular (0 abordados)
  taxaInteresse: number | null;
  taxaQualificacao: number | null;
  taxaFechamento: number | null;
};

// value  = leitura cumulativa (quantos JÁ CHEGARAM nessa fase ou além) — é o que faz o desenho do
//           funil estreitar e o que dá sentido ao % de conversão entre fases.
// current = foto do momento (quantos estão NESSA fase agora) — é o número que bate 1:1 com a coluna
//           correspondente do Pipeline. Os dois convivem no gráfico de propósito: sem o cumulativo o
//           funil deixa de ser funil, sem o "agora" ninguém reconcilia com o Kanban (um contato em
//           Encaminhamento aparecia como "1 Abordado" mesmo com a coluna Abordado zerada no Pipeline).
export type FunnelPoint = { stage: ContactStage; label: string; value: number; current: number };

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

export async function legacyVolumeMetrics(workspaceId: string, range: Range, client?: unknown): Promise<VolumeMetrics> {
  const supabase = ((client as ServerClient | undefined) ?? (await createClient())) as ServerClient;
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [{ count: leadsRecebidos }, { count: mensagensEnviadas }, { count: mensagensRecebidas }, allMsgsAsc] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", fromIso).lte("created_at", toIso),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("role", "assistant").gte("created_at", fromIso).lte("created_at", toIso),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("role", "user").gte("created_at", fromIso).lte("created_at", toIso),
    // Precisa de TODA a mensagem até o fim do período (não só as do período) pra achar corretamente
    // a primeira mensagem de cada par contato+agente — uma conversa "iniciada" antes do período não
    // deveria contar como iniciada de novo só porque teve mensagem nova dentro dele.
    fetchAllPaged<{ contact_id: string; agent_id: string | null; role: string; created_at: string }>((from, to) =>
      supabase
        .from("messages")
        .select("contact_id, agent_id, role, created_at")
        .eq("workspace_id", workspaceId)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  ]);

  // "Conversa iniciada" = primeira mensagem (de qualquer papel) de um par contato+agente cai dentro
  // do período — ordenado ascendente, a primeira ocorrência de cada chave já é a mais antiga.
  const firstSeen = new Map<string, string>();
  const contactIdByPair = new Map<string, string>();
  const activeInPeriod = new Set<string>();
  for (const m of allMsgsAsc) {
    const key = `${m.contact_id}:${m.agent_id ?? "blast"}`;
    if (!firstSeen.has(key)) firstSeen.set(key, m.created_at);
    contactIdByPair.set(key, m.contact_id);
    if (m.created_at >= fromIso) activeInPeriod.add(key);
  }
  let conversasIniciadas = 0;
  for (const createdAt of firstSeen.values()) {
    if (createdAt >= fromIso && createdAt <= toIso) conversasIniciadas++;
  }

  // "Em andamento" = teve atividade no período E o lead ainda não chegou num estado terminal
  // (concluído/descartado) — precisa saber o estágio atual de cada contato envolvido.
  const stageByContact = await fetchStageByContact(supabase, workspaceId);

  let conversasEmAndamento = 0;
  for (const key of activeInPeriod) {
    const contactId = contactIdByPair.get(key);
    const stage = contactId ? stageByContact.get(contactId) : undefined;
    if (stage && !TERMINAL_STAGES.includes(stage)) conversasEmAndamento++;
  }

  const leadsAbordados = new Set(
    allMsgsAsc.filter((m) => m.role === "assistant" && m.created_at >= fromIso && m.created_at <= toIso).map((m) => m.contact_id)
  ).size;

  return {
    leadsRecebidos: leadsRecebidos ?? 0,
    leadsAbordados,
    mensagensEnviadas: mensagensEnviadas ?? 0,
    mensagensRecebidas: mensagensRecebidas ?? 0,
    conversasIniciadas,
    conversasEmAndamento,
  };
}

// Tempo de resposta (latência entre o contato mandar mensagem e o agente responder), conversas sem
// resposta nossa ainda pendente, e a maior espera atual — tudo dentro do período filtrado.
export async function legacyResponseMetrics(workspaceId: string, range: Range, client?: unknown): Promise<ResponseMetrics> {
  const supabase = ((client as ServerClient | undefined) ?? (await createClient())) as ServerClient;
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const msgs = await fetchAllPaged<{ contact_id: string; agent_id: string | null; role: string; created_at: string }>((from, to) =>
    supabase
      .from("messages")
      .select("contact_id, agent_id, role, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  const byPair = new Map<string, { role: string; created_at: string }[]>();
  for (const m of msgs) {
    const key = `${m.contact_id}:${m.agent_id ?? "blast"}`;
    const arr = byPair.get(key) || [];
    arr.push({ role: m.role, created_at: m.created_at });
    byPair.set(key, arr);
  }

  const latenciesMs: number[] = [];
  let conversasNaoRespondidas = 0;
  let maiorEsperaMs = 0;
  const now = Date.now();

  for (const arr of byPair.values()) {
    let pendingUserAt: number | null = null;
    for (const m of arr) {
      if (m.role === "user") {
        if (pendingUserAt === null) pendingUserAt = new Date(m.created_at).getTime();
      } else if (m.role === "assistant" && pendingUserAt !== null) {
        latenciesMs.push(new Date(m.created_at).getTime() - pendingUserAt);
        pendingUserAt = null;
      }
    }
    const last = arr[arr.length - 1];
    if (last?.role === "assistant") {
      conversasNaoRespondidas++;
      maiorEsperaMs = Math.max(maiorEsperaMs, now - new Date(last.created_at).getTime());
    }
  }

  const tempoMedioRespostaMin = latenciesMs.length > 0 ? Math.round((latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length / 60000) * 10) / 10 : null;
  const maisTempoEsperandoMin = conversasNaoRespondidas > 0 ? Math.round(maiorEsperaMs / 60000) : null;

  return { tempoMedioRespostaMin, conversasNaoRespondidas, maisTempoEsperandoMin };
}

// Fontes de lead (custom_fields.origem) entre os leads recebidos no período — quem entrou via
// /api/v1/leads já grava isso; quem chegou direto pelo WhatsApp (sem origem explícita) cai em
// "WhatsApp direto", pra o gráfico nunca ficar vazio/quebrado só por falta desse campo.
export async function legacyLeadSources(workspaceId: string, range: Range, client?: unknown): Promise<LeadSource[]> {
  const supabase = ((client as ServerClient | undefined) ?? (await createClient())) as ServerClient;
  const data = await fetchAllPaged<{ custom_fields: Record<string, unknown> | null }>((from, to) =>
    supabase
      .from("contacts")
      .select("custom_fields")
      .eq("workspace_id", workspaceId)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  const counts = new Map<string, number>();
  for (const c of data) {
    const origem = c.custom_fields?.origem;
    const label = typeof origem === "string" && origem.trim() ? origem.trim() : "WhatsApp direto";
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export async function legacyConversionMetrics(workspaceId: string, range: Range, client?: unknown): Promise<ConversionMetrics> {
  const supabase = ((client as ServerClient | undefined) ?? (await createClient())) as ServerClient;
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  // Busca as duas pontas por workspace_id + período e cruza em memória. Antes isso era um
  // `.in("contact_id", abordadosIds)` com a lista inteira de abordados — com base grande (TB Rio tem
  // ~900) a URL estourava e a query falhava calada, zerando as taxas.
  const [abordadosRows, responderamRows, stageByContact] = await Promise.all([
    fetchAllPaged<{ contact_id: string }>((from, to) =>
      supabase
        .from("messages")
        .select("contact_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "assistant")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
    fetchAllPaged<{ contact_id: string }>((from, to) =>
      supabase
        .from("messages")
        .select("contact_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "user")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
    fetchStageByContact(supabase, workspaceId),
  ]);

  const abordadosIds = new Set(abordadosRows.map((r) => r.contact_id));
  if (abordadosIds.size === 0) return { taxaResposta: null, taxaInteresse: null, taxaQualificacao: null, taxaFechamento: null };

  const responderam = new Set(responderamRows.map((r) => r.contact_id).filter((id) => abordadosIds.has(id))).size;
  const stages = [...abordadosIds].map((id) => stageByContact.get(id)).filter((s): s is ContactStage => Boolean(s));
  const interessados = stages.filter((s) => INTERESSE_OU_ALEM.includes(s)).length;
  const qualificados = stages.filter((s) => QUALIFICADO_OU_ALEM.includes(s)).length;
  const fechados = stages.filter((s) => FECHADO.includes(s)).length;

  return {
    taxaResposta: pct(responderam, abordadosIds.size),
    taxaInteresse: pct(interessados, abordadosIds.size),
    taxaQualificacao: pct(qualificados, abordadosIds.size),
    taxaFechamento: pct(fechados, abordadosIds.size),
  };
}

// Funil da coorte de leads recebidos no período: pra cada estágio "reto" (exceto descartado),
// quantos desses leads já chegaram ali (ou além) até agora — leitura cumulativa, igual todo funil de
// CRM (Pipedrive/HubSpot etc. fazem o mesmo: mostram o estágio mais avançado já alcançado, não
// exigem que o contato tenha passado por cada degrau em ordem perfeita).
export async function legacyFunnelData(
  workspaceId: string,
  range: Range,
  funnelEnd: ContactStage = "concluido",
  client?: unknown
): Promise<{ points: FunnelPoint[]; descartados: number }> {
  const supabase = ((client as ServerClient | undefined) ?? (await createClient())) as ServerClient;
  const [contacts, { data: workspaceRow }] = await Promise.all([
    fetchAllPaged<{ stage: string }>((from, to) =>
      supabase
        .from("contacts")
        .select("stage")
        .eq("workspace_id", workspaceId)
        .gte("created_at", range.from.toISOString())
        .lte("created_at", range.to.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
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
  const currentAtStage: number[] = new Array(funnelStages.length).fill(0);
  for (const c of contacts) {
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
    currentAtStage[idx]++; // mesma regra de exibição do Kanban (displayStageFor), pra bater com ele
  }

  const points: FunnelPoint[] = funnelStages.map((stage, i) => ({
    stage,
    label: stageLabels[stage],
    value: displayStageIndex[i],
    current: currentAtStage[i],
  }));
  return { points, descartados };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Cálculo no banco (migration 0085_overview_metrics.sql).
//
// Os `legacy*` acima puxam as linhas e somam em memória. Os `sql*` abaixo pedem o resultado pronto ao
// Postgres. As funções públicas (`get*`) tentam o SQL e, se a função não existir ou falhar, caem no
// cálculo antigo: aplicar (ou não) a migration nunca derruba a Visão geral.
// ───────────────────────────────────────────────────────────────────────────────────────────────

async function rpc<T>(supabase: ServerClient, fn: string, workspaceId: string, range: Range): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, {
    p_workspace: workspaceId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error || data === null || data === undefined) {
    console.warn(`Visão geral: ${fn} indisponível, usando o cálculo antigo (${error?.message ?? "sem retorno"}).`);
    return null;
  }
  return data as T;
}

const num = (v: unknown): number => Number(v) || 0;

async function clientOf(client?: unknown): Promise<ServerClient> {
  return ((client as ServerClient | undefined) ?? (await createClient())) as ServerClient;
}

export async function sqlVolumeMetrics(workspaceId: string, range: Range, client?: unknown): Promise<VolumeMetrics | null> {
  const r = await rpc<Record<string, unknown>>(await clientOf(client), "overview_volume", workspaceId, range);
  if (!r) return null;
  return {
    leadsRecebidos: num(r.leads_recebidos),
    leadsAbordados: num(r.leads_abordados),
    mensagensEnviadas: num(r.mensagens_enviadas),
    mensagensRecebidas: num(r.mensagens_recebidas),
    conversasIniciadas: num(r.conversas_iniciadas),
    conversasEmAndamento: num(r.conversas_em_andamento),
  };
}

export async function sqlResponseMetrics(workspaceId: string, range: Range, client?: unknown): Promise<ResponseMetrics | null> {
  const r = await rpc<Record<string, unknown>>(await clientOf(client), "overview_response", workspaceId, range);
  if (!r) return null;
  const latCount = num(r.lat_count);
  const unanswered = num(r.unanswered);
  const oldest = typeof r.oldest_unanswered_at === "string" ? new Date(r.oldest_unanswered_at).getTime() : null;
  return {
    // Mesmo arredondamento do cálculo antigo: soma em ms -> média em minutos, uma casa decimal.
    tempoMedioRespostaMin: latCount > 0 ? Math.round((num(r.lat_sum_ms) / latCount / 60000) * 10) / 10 : null,
    conversasNaoRespondidas: unanswered,
    maisTempoEsperandoMin: unanswered > 0 && oldest !== null ? Math.round((Date.now() - oldest) / 60000) : null,
  };
}

export async function sqlConversionMetrics(workspaceId: string, range: Range, client?: unknown): Promise<ConversionMetrics | null> {
  const r = await rpc<Record<string, unknown>>(await clientOf(client), "overview_conversion", workspaceId, range);
  if (!r) return null;
  const abordados = num(r.abordados);
  if (abordados === 0) return { taxaResposta: null, taxaInteresse: null, taxaQualificacao: null, taxaFechamento: null };
  return {
    taxaResposta: pct(num(r.responderam), abordados),
    taxaInteresse: pct(num(r.interessados), abordados),
    taxaQualificacao: pct(num(r.qualificados), abordados),
    taxaFechamento: pct(num(r.fechados), abordados),
  };
}

// A mesma regra do funil antigo (que percorria contato por contato), aplicada sobre "quantos contatos
// há em cada fase". Pura, pra poder ser testada sem banco.
export function buildFunnel(
  stageCounts: Record<string, number>,
  workspaceRow: { crm_stage_labels?: unknown; crm_hidden_stages?: unknown } | null,
  funnelEnd: ContactStage = "concluido"
): { points: FunnelPoint[]; descartados: number } {
  const stageLabels = resolveStageLabels(workspaceRow?.crm_stage_labels);
  const hiddenStages = resolveHiddenStages(workspaceRow?.crm_hidden_stages);
  const visibleStages = getVisibleStages(hiddenStages);
  const endIdx = FUNNEL_HAPPY_PATH.indexOf(funnelEnd);
  const happyPathForPlan = endIdx === -1 ? FUNNEL_HAPPY_PATH : FUNNEL_HAPPY_PATH.slice(0, endIdx + 1);
  const funnelStages = happyPathForPlan.filter((s) => visibleStages.includes(s));

  let descartados = 0;
  const cumulative: number[] = new Array(funnelStages.length).fill(0);
  const currentAtStage: number[] = new Array(funnelStages.length).fill(0);
  for (const [rawStage, count] of Object.entries(stageCounts)) {
    const stage = rawStage as ContactStage;
    if (stage === "descartado") {
      descartados += count;
      continue;
    }
    const display = displayStageFor(stage, visibleStages);
    let idx = funnelStages.indexOf(display as ContactStage);
    if (idx === -1) {
      if (FUNNEL_HAPPY_PATH.indexOf(display as ContactStage) === -1) continue;
      idx = funnelStages.length - 1;
    }
    for (let i = 0; i <= idx; i++) cumulative[i] += count;
    currentAtStage[idx] += count;
  }

  const points: FunnelPoint[] = funnelStages.map((stage, i) => ({ stage, label: stageLabels[stage], value: cumulative[i], current: currentAtStage[i] }));
  return { points, descartados };
}

export async function sqlFunnelData(
  workspaceId: string,
  range: Range,
  funnelEnd: ContactStage = "concluido",
  client?: unknown
): Promise<{ points: FunnelPoint[]; descartados: number } | null> {
  const supabase = await clientOf(client);
  const [counts, { data: workspaceRow }] = await Promise.all([
    rpc<Record<string, unknown>>(supabase, "overview_funnel", workspaceId, range),
    supabase.from("workspaces").select("crm_stage_labels, crm_hidden_stages").eq("id", workspaceId).maybeSingle(),
  ]);
  if (!counts) return null;
  const stageCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) stageCounts[k] = num(v);
  return buildFunnel(stageCounts, workspaceRow, funnelEnd);
}

export async function sqlLeadSources(workspaceId: string, range: Range, client?: unknown): Promise<LeadSource[] | null> {
  const r = await rpc<Array<{ label: string; value: unknown }>>(await clientOf(client), "overview_lead_sources", workspaceId, range);
  if (!r) return null;
  return r.map((x) => ({ label: x.label, value: num(x.value) }));
}

// Mensagens enviadas por dia (chave AAAA-MM-DD em Brasília). O cálculo antigo trazia no máximo 1000
// linhas (o servidor corta em 1000 mesmo com .limit(20000)), então o gráfico saía errado pra baixo em
// período com mais de mil mensagens. Aqui a contagem é completa.
export async function sqlMessagesByDay(workspaceId: string, range: Range, client?: unknown): Promise<Record<string, number> | null> {
  const r = await rpc<Record<string, unknown>>(await clientOf(client), "overview_messages_by_day", workspaceId, range);
  if (!r) return null;
  const out: Record<string, number> = {};
  for (const [day, n] of Object.entries(r)) out[day] = num(n);
  return out;
}

export async function legacyMessagesByDay(workspaceId: string, range: Range, client?: unknown): Promise<Record<string, number>> {
  const supabase = await clientOf(client);
  const { data } = await supabase
    .from("messages")
    .select("created_at")
    .eq("workspace_id", workspaceId)
    .eq("role", "assistant")
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString())
    .limit(20000);
  const out: Record<string, number> = {};
  for (const m of data || []) {
    const key = dayKeyBrt(m.created_at as string);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

// ── API pública: SQL primeiro, cálculo antigo como reserva ──────────────────────────────────────

export async function getVolumeMetrics(workspaceId: string, range: Range): Promise<VolumeMetrics> {
  return (await sqlVolumeMetrics(workspaceId, range)) ?? legacyVolumeMetrics(workspaceId, range);
}

export async function getResponseMetrics(workspaceId: string, range: Range): Promise<ResponseMetrics> {
  return (await sqlResponseMetrics(workspaceId, range)) ?? legacyResponseMetrics(workspaceId, range);
}

export async function getConversionMetrics(workspaceId: string, range: Range): Promise<ConversionMetrics> {
  return (await sqlConversionMetrics(workspaceId, range)) ?? legacyConversionMetrics(workspaceId, range);
}

export async function getFunnelData(
  workspaceId: string,
  range: Range,
  funnelEnd: ContactStage = "concluido"
): Promise<{ points: FunnelPoint[]; descartados: number }> {
  return (await sqlFunnelData(workspaceId, range, funnelEnd)) ?? legacyFunnelData(workspaceId, range, funnelEnd);
}

export async function getLeadSources(workspaceId: string, range: Range): Promise<LeadSource[]> {
  return (await sqlLeadSources(workspaceId, range)) ?? legacyLeadSources(workspaceId, range);
}

export async function getMessagesByDay(workspaceId: string, range: Range): Promise<Record<string, number>> {
  return (await sqlMessagesByDay(workspaceId, range)) ?? legacyMessagesByDay(workspaceId, range);
}
