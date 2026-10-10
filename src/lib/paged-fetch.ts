// Busca "tudo de um workspace" em páginas de até 1000 linhas (teto do servidor, ver
// supabase-max-rows-1000). Antes as páginas vinham uma depois da outra: 7 páginas = 7 esperas seguidas.
// Aqui, sabendo o total, as páginas saem juntas, em lotes. O resultado é o MESMO conjunto, na MESMA
// ordem, que a busca em série dava.
//
// A consulta de cada página precisa de `.order()` estável (de preferência com `id` no desempate): sem
// ordem definida o Postgrest não garante que a página 2 venha depois da 1.

type PageResult<T> = { data: T[] | null };

export type ParallelOptions<T> = {
  // Quantas linhas existem (count do servidor). Se vier nulo, a busca cai pra série.
  total: number | null;
  page: (from: number, to: number) => PromiseLike<PageResult<T>>;
  pageSize?: number;
  maxRows: number;
  concurrency?: number;
  // Identificador da linha. Se linhas entrarem entre uma página e outra, as páginas se sobrepõem;
  // com isso a repetição é descartada.
  key?: (row: T) => string;
};

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_CONCURRENCY = 6;

export async function fetchAllParallel<T>(opts: ParallelOptions<T>): Promise<T[]> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const rows: T[] = [];

  const known = opts.total !== null && opts.total >= 0 ? Math.min(opts.total, opts.maxRows) : null;
  let nextOffset = 0;
  let stopped = false;

  // Lotes de páginas em paralelo, até cobrir o total conhecido.
  if (known !== null) {
    const pages = Math.ceil(known / pageSize);
    for (let start = 0; start < pages && !stopped; start += concurrency) {
      const batch = Array.from({ length: Math.min(concurrency, pages - start) }, (_, i) => {
        const from = (start + i) * pageSize;
        return opts.page(from, from + pageSize - 1);
      });
      const results = await Promise.all(batch);
      for (const r of results) {
        // Página vazia ou com erro: para aqui, como a busca em série fazia (não deixa buraco no meio).
        if (!r.data || r.data.length === 0) {
          stopped = true;
          break;
        }
        rows.push(...r.data);
        nextOffset += pageSize;
        if (r.data.length < pageSize) {
          stopped = true;
          break;
        }
      }
    }
  }

  // Cauda em série: cobre linhas que entraram depois do count, ou o caso sem total conhecido.
  while (!stopped && rows.length < opts.maxRows) {
    const { data } = await opts.page(nextOffset, nextOffset + pageSize - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    nextOffset += pageSize;
  }

  const limited = rows.length > opts.maxRows ? rows.slice(0, opts.maxRows) : rows;
  if (!opts.key) return limited;
  const seen = new Set<string>();
  return limited.filter((row) => {
    const k = opts.key!(row);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
