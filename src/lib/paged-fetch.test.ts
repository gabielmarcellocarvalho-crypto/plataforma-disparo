import { describe, expect, it, vi } from "vitest";
import { fetchAllParallel } from "@/lib/paged-fetch";

type Row = { id: number };
const table = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i }));

// Simula o PostgREST: devolve o recorte [from, to] da tabela.
function server(rows: Row[], opts: { failFrom?: number } = {}) {
  return vi.fn(async (from: number, to: number) => {
    if (opts.failFrom !== undefined && from >= opts.failFrom) return { data: null };
    return { data: rows.slice(from, to + 1) };
  });
}

describe("fetchAllParallel", () => {
  it("devolve as mesmas linhas, na mesma ordem, que a busca em série", async () => {
    const rows = table(6005);
    const out = await fetchAllParallel({ total: 6005, page: server(rows), maxRows: 10000, key: (r) => String(r.id) });
    expect(out).toHaveLength(6005);
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("busca todas as páginas de uma vez (não uma depois da outra)", async () => {
    let running = 0;
    let peak = 0;
    const rows = table(6005);
    const page = vi.fn(async (from: number, to: number) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { data: rows.slice(from, to + 1) };
    });
    await fetchAllParallel({ total: 6005, page, maxRows: 10000 });
    expect(peak).toBeGreaterThan(1);
    expect(page).toHaveBeenCalledTimes(7);
  });

  it("respeita o teto maxRows", async () => {
    const out = await fetchAllParallel({ total: 9000, page: server(table(9000)), maxRows: 5000 });
    expect(out).toHaveLength(5000);
    expect(out[4999].id).toBe(4999);
  });

  it("base pequena: uma página só", async () => {
    const page = server(table(40));
    const out = await fetchAllParallel({ total: 40, page, maxRows: 10000 });
    expect(out).toHaveLength(40);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("base vazia", async () => {
    expect(await fetchAllParallel({ total: 0, page: server([]), maxRows: 10000 })).toEqual([]);
  });

  it("pega as linhas que entraram depois do count (cauda em série)", async () => {
    // o count dizia 2000, mas já existem 2500 quando as páginas são lidas
    const out = await fetchAllParallel({ total: 2000, page: server(table(2500)), maxRows: 10000 });
    expect(out).toHaveLength(2500);
  });

  it("sem total conhecido, cai pra série e ainda traz tudo", async () => {
    const out = await fetchAllParallel({ total: null, page: server(table(2300)), maxRows: 10000 });
    expect(out).toHaveLength(2300);
  });

  it("descarta repetidas quando as páginas se sobrepõem", async () => {
    const rows = table(1500);
    // página 2 volta repetindo a última linha da página 1 (uma linha nova entrou no topo)
    const page = vi.fn(async (from: number) => ({ data: from === 0 ? rows.slice(0, 1000) : rows.slice(999, 1500) }));
    const out = await fetchAllParallel({ total: 1500, page, maxRows: 10000, key: (r) => String(r.id) });
    expect(out).toHaveLength(1500);
    expect(new Set(out.map((r) => r.id)).size).toBe(1500);
  });

  it("página com erro: para ali, sem deixar buraco no meio (igual ao comportamento antigo)", async () => {
    const out = await fetchAllParallel({ total: 3000, page: server(table(3000), { failFrom: 2000 }), maxRows: 10000, concurrency: 1 });
    expect(out).toHaveLength(2000);
  });
});
