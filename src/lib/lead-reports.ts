// Relatórios de leads — as tabelas dinâmicas que o cliente mantinha na mão numa aba da planilha
// (leads por campanha, por produto, por filial, por mês, por vendedor, por motivo de perda), aqui
// calculadas a partir do dado vivo.
//
// Tudo sai de uma leitura só de `contacts` no período, agregada em memória: são centenas ou poucos
// milhares de linhas por workspace, e uma consulta por recorte multiplicaria ida e volta ao banco
// sem ganho nenhum.
import { createClient } from "@/lib/supabase/server";
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import { dayKeyBrt, eachDayBrt } from "@/lib/period";
import { formatFieldValue, readMultiValue, type CustomFieldDef } from "@/lib/custom-fields";

type Range = { from: Date; to: Date };

export type Slice = { label: string; value: number };
export type Breakdown = { key: string; label: string; slices: Slice[]; preenchidos: number };

export type LeadReports = {
  total: number;
  ganhos: number;
  perdidos: number;
  emAndamento: number;
  taxaConversaoPct: number | null;
  porEstagio: { stage: ContactStage; label: string; value: number }[];
  porMes: Slice[];
  porFilial: Breakdown | null;
  porResponsavel: Breakdown | null;
  porMotivoPerda: Breakdown | null;
  porCampo: Breakdown[];
  porTag: Breakdown | null;
  // Média de dias entre o lead entrar e virar ganho (só os ganhos do recorte).
  tempoMedioFechamentoDias: number | null;
  porDia: { labels: string[]; leads: number[]; ganhos: number[] };
  // Quem trouxe resultado: leads atribuídos, ganhos e taxa sobre o que já foi decidido.
  desempenhoResponsavel: { nome: string; leads: number; ganhos: number; perdidos: number; taxaPct: number | null }[];
};

type Row = {
  id: string;
  stage: string;
  created_at: string;
  team_member_id: string | null;
  branch_id: string | null;
  lost_reason: string | null;
  custom_fields: Record<string, unknown> | null;
  stage_changed_at: string | null;
  tags: string[] | null;
};

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

// O servidor corta qualquer resposta em 1000 linhas, ignorando `.limit()` maior — a única forma de
// pegar tudo é paginar de verdade. `.order()` estável é obrigatório: sem ordem definida o PostgREST
// não garante que a página 2 venha depois da 1, e linha repete ou some entre páginas.
async function fetchAllPaged(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, range: Range): Promise<Row[]> {
  const all: Row[] = [];
  let offset = 0;
  while (all.length < MAX_ROWS) {
    const { data } = await supabase
      .from("contacts")
      .select("id, stage, created_at, stage_changed_at, tags, team_member_id, branch_id, lost_reason, custom_fields")
      .eq("workspace_id", workspaceId)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// Ordena por volume (maior primeiro) — é como se lê uma tabela dinâmica: o que mais pesa no topo.
// "Outro"/"Outros" desce pro fim mesmo sendo grande, porque é balde, não categoria.
function paraSlices(contagem: Map<string, number>): Slice[] {
  const balde = /^outros?$/i;
  return [...contagem.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => {
      const aBalde = balde.test(a.label);
      const bBalde = balde.test(b.label);
      if (aBalde !== bBalde) return aBalde ? 1 : -1;
      return b.value - a.value || a.label.localeCompare(b.label, "pt-BR");
    });
}

function mesBr(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "America/Sao_Paulo" })
    .format(d)
    .replace(".", "");
}

export async function getLeadReports(
  workspaceId: string,
  range: Range,
  opts: { fieldDefs: CustomFieldDef[]; stageLabels: Record<ContactStage, string>; teamNames: Map<string, string>; branchNames: Map<string, string> }
): Promise<LeadReports> {
  const supabase = await createClient();
  const rows = await fetchAllPaged(supabase, workspaceId, range);

  const porEstagioMap = new Map<string, number>();
  const porMesMap = new Map<string, { chave: string; n: number }>();
  const porFilial = new Map<string, number>();
  const porResponsavel = new Map<string, number>();
  const porMotivo = new Map<string, number>();
  const porCampo = new Map<string, Map<string, number>>();
  const porTag = new Map<string, number>();
  const dias = eachDayBrt(range.from, range.to);
  const diaIdx = new Map(dias.map((d, i) => [d, i]));
  const leadsDia = dias.map(() => 0);
  const ganhosDia = dias.map(() => 0);
  let somaFechamentoMs = 0;
  let nFechamento = 0;
  const equipe = new Map<string, { leads: number; ganhos: number; perdidos: number }>();

  // Só campo de lista entra em relatório: texto livre gera uma categoria por lead e não agrega nada.
  const camposAgregaveis = opts.fieldDefs.filter((d) => d.type === "selecao" || d.type === "selecao_multipla");
  for (const def of camposAgregaveis) porCampo.set(def.key, new Map());

  for (const r of rows) {
    porEstagioMap.set(r.stage, (porEstagioMap.get(r.stage) ?? 0) + 1);

    const rotulo = mesBr(r.created_at);
    const chaveOrdem = r.created_at.slice(0, 7); // ordena por AAAA-MM, exibe "set 2026"
    const mes = porMesMap.get(rotulo);
    if (mes) mes.n++;
    else porMesMap.set(rotulo, { chave: chaveOrdem, n: 1 });

    if (r.branch_id) {
      const nome = opts.branchNames.get(r.branch_id);
      if (nome) porFilial.set(nome, (porFilial.get(nome) ?? 0) + 1);
    }
    if (r.team_member_id) {
      const nome = opts.teamNames.get(r.team_member_id);
      if (nome) porResponsavel.set(nome, (porResponsavel.get(nome) ?? 0) + 1);
    }
    for (const t of r.tags ?? []) porTag.set(t, (porTag.get(t) ?? 0) + 1);

    const iLead = diaIdx.get(dayKeyBrt(r.created_at));
    if (iLead !== undefined) leadsDia[iLead]++;
    if (r.stage === "concluido" && r.stage_changed_at) {
      const iGanho = diaIdx.get(dayKeyBrt(r.stage_changed_at));
      if (iGanho !== undefined) ganhosDia[iGanho]++;
      const ms = new Date(r.stage_changed_at).getTime() - new Date(r.created_at).getTime();
      if (ms >= 0) {
        somaFechamentoMs += ms;
        nFechamento++;
      }
    }
    if (r.team_member_id) {
      const nome = opts.teamNames.get(r.team_member_id);
      if (nome) {
        const e = equipe.get(nome) ?? { leads: 0, ganhos: 0, perdidos: 0 };
        e.leads++;
        if (r.stage === "concluido") e.ganhos++;
        if (r.stage === "descartado") e.perdidos++;
        equipe.set(nome, e);
      }
    }
    if (r.lost_reason) porMotivo.set(r.lost_reason, (porMotivo.get(r.lost_reason) ?? 0) + 1);

    for (const def of camposAgregaveis) {
      const bruto = (r.custom_fields || {})[def.key];
      if (bruto === null || bruto === undefined || bruto === "") continue;
      const alvo = porCampo.get(def.key)!;
      // Multi-seleção conta o lead uma vez por opção marcada — o total do recorte passa do total de
      // leads de propósito, é assim que uma tabela dinâmica de múltipla escolha funciona.
      const valores = def.type === "selecao_multipla" ? readMultiValue(bruto) : [formatFieldValue(def, bruto)];
      for (const v of valores) if (v) alvo.set(v, (alvo.get(v) ?? 0) + 1);
    }
  }

  const ganhos = porEstagioMap.get("concluido") ?? 0;
  const perdidos = porEstagioMap.get("descartado") ?? 0;
  const total = rows.length;
  // Conversão sobre o que já foi DECIDIDO (ganho + perdido), não sobre a base toda: com 370 leads
  // ainda sem resposta, dividir pelo total mede o quanto a base é nova, não o quanto o time fecha.
  const decididos = ganhos + perdidos;

  const breakdown = (key: string, label: string, mapa: Map<string, number>): Breakdown | null =>
    mapa.size === 0 ? null : { key, label, slices: paraSlices(mapa), preenchidos: [...mapa.values()].reduce((s, n) => s + n, 0) };

  return {
    total,
    ganhos,
    perdidos,
    emAndamento: total - ganhos - perdidos,
    taxaConversaoPct: decididos > 0 ? (ganhos / decididos) * 100 : null,
    porEstagio: STAGE_ORDER.map((stage) => ({ stage, label: opts.stageLabels[stage], value: porEstagioMap.get(stage) ?? 0 })).filter(
      (p) => p.value > 0
    ),
    porMes: [...porMesMap.entries()]
      .sort((a, b) => a[1].chave.localeCompare(b[1].chave))
      .map(([label, { n }]) => ({ label, value: n })),
    porFilial: breakdown("filial", "Filial", porFilial),
    porResponsavel: breakdown("responsavel", "Responsável", porResponsavel),
    porMotivoPerda: breakdown("motivo", "Motivo da perda", porMotivo),
    porTag: breakdown("tag", "Tag", porTag),
    tempoMedioFechamentoDias: nFechamento > 0 ? somaFechamentoMs / nFechamento / 86_400_000 : null,
    porDia: { labels: dias.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`), leads: leadsDia, ganhos: ganhosDia },
    desempenhoResponsavel: [...equipe.entries()]
      .map(([nome, e]) => ({ nome, ...e, taxaPct: e.ganhos + e.perdidos > 0 ? (e.ganhos / (e.ganhos + e.perdidos)) * 100 : null }))
      .sort((a, b) => b.ganhos - a.ganhos || b.leads - a.leads),
    porCampo: camposAgregaveis
      .map((def) => breakdown(def.key, def.label, porCampo.get(def.key)!))
      .filter((b): b is Breakdown => b !== null),
  };
}
