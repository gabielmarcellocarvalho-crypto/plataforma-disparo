// Leads do período por dia e por tag — alimenta os cards com mini gráfico e o gráfico "Leads por tag"
// da Visão geral. Uma leitura paginada de `contacts` (teto de 1000 linhas por requisição no servidor),
// agregada em memória: o filtro de tag é aplicado aqui, em cima do que já veio, pra o gráfico de tags
// continuar mostrando TODAS as tags mesmo com uma selecionada (senão não dá pra trocar de tag).
import { createClient } from "@/lib/supabase/server";
import { dayKeyBrt } from "@/lib/period";

type Range = { from: Date; to: Date };
type Row = { id: string; created_at: string; stage_changed_at: string | null; tags: string[] | null };

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

export type TagCount = { label: string; value: number };

export type OverviewLeads = {
  leadsByDay: number[];
  wonByDay: number[];
  totalLeads: number;
  totalWon: number;
  tagCounts: TagCount[];
  // Leads do período sem nenhuma tag — o gráfico mostra "Sem tag" pra a soma bater com o total.
  untagged: number;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function fetchPaged(supabase: Supabase, workspaceId: string, range: Range, mode: "created" | "won"): Promise<Row[]> {
  const all: Row[] = [];
  let offset = 0;
  while (all.length < MAX_ROWS) {
    let q = supabase.from("contacts").select("id, created_at, stage_changed_at, tags").eq("workspace_id", workspaceId);
    q =
      mode === "created"
        ? q.gte("created_at", range.from.toISOString()).lte("created_at", range.to.toISOString())
        : q.eq("stage", "concluido").gte("stage_changed_at", range.from.toISOString()).lte("stage_changed_at", range.to.toISOString());
    const { data } = await q.order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export async function getOverviewLeads(workspaceId: string, range: Range, days: string[], tag: string | null): Promise<OverviewLeads> {
  const supabase = await createClient();
  const [created, won] = await Promise.all([fetchPaged(supabase, workspaceId, range, "created"), fetchPaged(supabase, workspaceId, range, "won")]);

  const tagMap = new Map<string, number>();
  let untagged = 0;
  for (const r of created) {
    const tags = r.tags ?? [];
    if (tags.length === 0) untagged++;
    for (const t of tags) tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
  }

  const has = (r: Row) => !tag || (r.tags ?? []).includes(tag);
  const index = new Map(days.map((d, i) => [d, i]));
  const leadsByDay = days.map(() => 0);
  const wonByDay = days.map(() => 0);
  let totalLeads = 0;
  let totalWon = 0;
  for (const r of created) {
    if (!has(r)) continue;
    totalLeads++;
    const i = index.get(dayKeyBrt(r.created_at));
    if (i !== undefined) leadsByDay[i]++;
  }
  for (const r of won) {
    if (!has(r) || !r.stage_changed_at) continue;
    totalWon++;
    const i = index.get(dayKeyBrt(r.stage_changed_at));
    if (i !== undefined) wonByDay[i]++;
  }

  return {
    leadsByDay,
    wonByDay,
    totalLeads,
    totalWon,
    tagCounts: [...tagMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR")),
    untagged,
  };
}

// Mensagens enviadas (role assistant) e recebidas (role user) por dia, só das conversas de leads com a tag.
// O filtro vai no join (contacts!inner) pra o banco devolver só o que interessa, sem listar os ids da tag.
type TagMsgQuery = {
  contains: (col: string, v: string[]) => {
    order: (c: string, o: { ascending: boolean }) => {
      range: (a: number, b: number) => Promise<{ data: { created_at: string; role: string }[] | null }>;
    };
  };
};

export async function getTagMessagesByDay(workspaceId: string, range: Range, days: string[], tag: string): Promise<{ sent: number[]; received: number[] }> {
  const supabase = await createClient();
  const index = new Map(days.map((d, i) => [d, i]));
  const sent = days.map(() => 0);
  const received = days.map(() => 0);
  let offset = 0;
  for (let n = 0; n < 40; n++) {
    const q = supabase
      .from("messages")
      .select("created_at, role, contacts!inner(tags)")
      .eq("workspace_id", workspaceId)
      .in("role", ["assistant", "user"])
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString()) as unknown as TagMsgQuery;
    const { data } = await q.contains("contacts.tags", [tag]).order("created_at", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    for (const m of data) {
      const i = index.get(dayKeyBrt(m.created_at));
      if (i === undefined) continue;
      if (m.role === "assistant") sent[i]++;
      else received[i]++;
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { sent, received };
}
