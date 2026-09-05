// Dados de atividade por contato que o Pipeline usa pra ordenar e pra mostrar no card: quando vence
// a próxima tarefa aberta e quantas mensagens já foram trocadas.
//
// Vem como par de arrays (e não Map) porque atravessa a fronteira Server → Client Component, e Map
// não sobrevive à serialização — o board remonta os Maps do outro lado.
import type { createClient } from "@/lib/supabase/server";

export type ContactActivity = {
  nextTaskAt: [string, string][];
  interactions: [string, number][];
};

const PAGE_SIZE = 1000;

export async function getContactActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string
): Promise<ContactActivity> {
  const proximaTarefa = new Map<string, string>();
  const interacoes = new Map<string, number>();

  // ── Próxima tarefa aberta por contato ───────────────────────────────────
  // Ordenado por vencimento crescente, então a PRIMEIRA que aparecer de cada contato já é a próxima
  // — não precisa comparar depois. Tarefa sem data fica fora: "próxima tarefa" pressupõe quando.
  let offset = 0;
  for (;;) {
    const { data } = await supabase
      .from("tasks")
      .select("contact_id, due_at")
      .eq("workspace_id", workspaceId)
      .is("completed_at", null)
      .not("contact_id", "is", null)
      .not("due_at", "is", null)
      .order("due_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    for (const t of data) {
      if (t.contact_id && t.due_at && !proximaTarefa.has(t.contact_id)) proximaTarefa.set(t.contact_id, t.due_at);
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // ── Interações por contato ──────────────────────────────────────────────
  // Agregação feita no banco (função contact_message_counts, migration 0069): trazer uma linha por
  // mensagem pra contar aqui seriam dezenas de páginas num workspace com histórico grande.
  // Uma função que falha (ainda não aplicada, por exemplo) não pode derrubar o Pipeline inteiro —
  // sem ela, a ordenação por interações só fica sem efeito.
  offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .rpc("contact_message_counts", { ws: workspaceId })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error("contact_message_counts indisponível:", error.message);
      break;
    }
    const linhas = (data ?? []) as { contact_id: string; total: number }[];
    if (linhas.length === 0) break;
    for (const l of linhas) if (l.contact_id) interacoes.set(l.contact_id, Number(l.total) || 0);
    if (linhas.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { nextTaskAt: [...proximaTarefa.entries()], interactions: [...interacoes.entries()] };
}
