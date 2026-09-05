// Motivo de perda — lista por workspace (workspaces.lost_reasons) com um padrão de fábrica.
//
// O padrão existe pra que o motivo já funcione no dia 1, sem ninguém configurar nada: uma lista
// vazia na tela é a forma mais rápida de a informação nunca ser coletada. O cliente edita depois,
// no mesmo painel onde renomeia as fases.
export const DEFAULT_LOST_REASONS = [
  "Preço",
  "Comprou do concorrente",
  "Sem interesse",
  "Sem retorno do cliente",
  "Produto indisponível",
  "Fora da região de atendimento",
  "Outro",
];

export function resolveLostReasons(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_LOST_REASONS;
  const limpos: string[] = [];
  const vistos = new Set<string>();
  for (const v of raw) {
    const s = String(v ?? "").trim().slice(0, 60);
    if (!s || vistos.has(s)) continue;
    vistos.add(s);
    limpos.push(s);
  }
  return limpos.length > 0 ? limpos : DEFAULT_LOST_REASONS;
}

// A fase de perda é `descartado` (a chave interna não muda; o cliente só renomeia o rótulo exibido).
// Centralizado aqui pra que board, drawer e relatório concordem sobre quando pedir o motivo.
export const LOST_STAGE = "descartado";
