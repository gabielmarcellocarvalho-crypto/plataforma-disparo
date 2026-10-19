// Formato da leitura de leads pela API pública (GET /api/v1/leads). Separado da rota pra dar pra testar
// sem banco: aqui só entram parâmetros da URL e linhas já lidas.
import { leadOriginDetail } from "@/lib/lead-origin";
import { STAGE_LABELS, type ContactStage } from "@/lib/crm-stages";
import { classifyLead, type QualConfig } from "@/lib/lead-qualification";

export const LEADS_API_MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type LeadsQuery = { fromIso: string | null; toIso: string | null; page: number; perPage: number };

function validDate(d: string) {
  if (!DATE_RE.test(d)) return false;
  // Recusa data que não existe (2026-02-30 viraria 2 de março sem essa volta).
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

// desde/ate em AAAA-MM-DD no horário de Brasília (dia inteiro: `ate` inclui o próprio dia).
export function parseLeadsQuery(params: URLSearchParams): { query: LeadsQuery } | { error: string } {
  const desde = params.get("desde")?.trim() || "";
  const ate = params.get("ate")?.trim() || "";
  if (desde && !validDate(desde)) return { error: "desde precisa estar no formato AAAA-MM-DD." };
  if (ate && !validDate(ate)) return { error: "ate precisa estar no formato AAAA-MM-DD." };
  if (desde && ate && ate < desde) return { error: "ate não pode ser antes de desde." };

  const pageRaw = params.get("pagina") ?? params.get("page");
  const perRaw = params.get("por_pagina") ?? params.get("per_page");
  const page = pageRaw == null ? 1 : Number(pageRaw);
  const perPage = perRaw == null ? DEFAULT_PAGE_SIZE : Number(perRaw);
  if (!Number.isInteger(page) || page < 1) return { error: "pagina precisa ser um número inteiro a partir de 1." };
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > LEADS_API_MAX_PAGE_SIZE) {
    return { error: `por_pagina precisa ser um número inteiro entre 1 e ${LEADS_API_MAX_PAGE_SIZE}.` };
  }

  const endOfDay = (d: string) => new Date(new Date(`${d}T00:00:00-03:00`).getTime() + 24 * 3600 * 1000 - 1).toISOString();
  return {
    query: {
      fromIso: desde ? new Date(`${desde}T00:00:00-03:00`).toISOString() : null,
      toIso: ate ? endOfDay(ate) : null,
      page,
      perPage,
    },
  };
}

export type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  stage: string;
  stage_changed_at: string | null;
  pipeline_stage_id: string | null;
  deal_value?: number | string | null;
  lost_reason: string | null;
  custom_fields: Record<string, unknown> | null;
  tags: string[] | null;
  ctwa_at: string | null;
};

export type LeadsApiContext = {
  stageLabels: Partial<Record<ContactStage, string>>;
  pipelineStages: Map<string, { name: string; signal: string }>;
  qualification: QualConfig;
};

// Uma linha do banco → o que a API devolve. A fase mostrada é a do funil próprio do cliente quando o lead
// está num (ex.: "Visita agendada"); senão, o nome da etapa padrão com o rótulo do workspace.
export function toApiLead(row: LeadRow, ctx: LeadsApiContext) {
  const ps = row.pipeline_stage_id ? ctx.pipelineStages.get(row.pipeline_stage_id) : undefined;
  const signal = (ps?.signal ?? row.stage) as ContactStage;
  const faseNome = ps?.name ?? ctx.stageLabels[signal] ?? STAGE_LABELS[signal] ?? row.stage;
  const resultado = signal === "concluido" ? "ganho" : signal === "descartado" ? "perdido" : null;
  const valor = row.deal_value == null || row.deal_value === "" ? null : Number(row.deal_value);
  return {
    id: row.id,
    nome: row.name,
    telefone: row.phone,
    email: row.email,
    data_entrada: row.created_at,
    fase: { codigo: signal, nome: faseNome, desde: row.stage_changed_at },
    resultado,
    valor_venda: Number.isFinite(valor) ? valor : null,
    motivo_perda: resultado === "perdido" ? row.lost_reason : null,
    qualificacao: classifyLead(signal, ctx.qualification),
    origem: leadOriginDetail(row),
    campos: row.custom_fields ?? {},
  };
}
