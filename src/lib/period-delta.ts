// Período anterior com a mesma duração, terminando onde o atual começa (ex.: "últimos 7 dias" compara com
// os 7 dias antes deles; "este mês" com o mesmo número de dias antes do dia 1).
export function previousPeriod(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) };
}

// Variação % entre o período atual e o anterior. null quando não dá pra comparar (anterior zerado).
export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}
