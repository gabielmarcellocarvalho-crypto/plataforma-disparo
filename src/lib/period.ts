// Resolve o período (intervalo de datas) escolhido no filtro de Visão geral/Métricas — mesma fonte
// pros dois, lida via query string pra ficar linkável/compartilhável (?preset=7d ou ?from=&to=).
//
// Tudo aqui trabalha no fuso de Brasília (fixo, sem horário de verão desde 2019 — mesma premissa já
// usada em isWithinBusinessHours), não em UTC puro: "hoje", "este mês" e o agrupamento por dia do
// gráfico precisam bater com o dia real do usuário no Brasil, não com o dia UTC do servidor. Sem
// isso, mensagem enviada às 21h-23h59 (horário de Brasília) cai no dia seguinte em UTC e "some" do
// dia certo no gráfico.
export type PeriodPreset = "hoje" | "7d" | "30d" | "mes_atual" | "mes_passado" | "custom";

export type Period = { from: Date; to: Date; preset: PeriodPreset; label: string };

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes_atual", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
];

const BRT_OFFSET_HOURS = 3; // America/Sao_Paulo = UTC-3, fixo (sem DST desde 2019)

// Y/M/D de uma data no fuso de Brasília (independente do fuso do servidor rodando o código).
function brtParts(d: Date): [number, number, number] {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  const [y, m, day] = s.split("-").map(Number);
  return [y, m, day];
}

// Meia-noite de um dia em Brasília, como instante UTC (ex.: 2026-07-29 00:00 BRT = 2026-07-29T03:00Z).
function startOfDayBrt(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, BRT_OFFSET_HOURS, 0, 0, 0));
}

// Último milissegundo de um dia em Brasília — calculado como "início do dia seguinte menos 1ms" pra
// rolar corretamente por cima de virada de mês/ano sem lógica extra.
function endOfDayBrt(y: number, m: number, d: number): Date {
  return new Date(startOfDayBrt(y, m, d + 1).getTime() - 1);
}

export function resolvePeriod(sp: { preset?: string; from?: string; to?: string }): Period {
  const now = new Date();
  const [ny, nm, nd] = brtParts(now);

  if (sp.from && sp.to) {
    const [fy, fm, fd] = sp.from.split("-").map(Number);
    const [ty, tm, td] = sp.to.split("-").map(Number);
    const from = startOfDayBrt(fy, fm, fd);
    const to = endOfDayBrt(ty, tm, td);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      return { from, to, preset: "custom", label: `${sp.from} a ${sp.to}` };
    }
  }

  const preset = (sp.preset as PeriodPreset) || "mes_atual";

  switch (preset) {
    case "hoje":
      return { from: startOfDayBrt(ny, nm, nd), to: now, preset, label: "hoje" };
    case "7d":
      return { from: new Date(startOfDayBrt(ny, nm, nd).getTime() - 6 * 86_400_000), to: now, preset, label: "últimos 7 dias" };
    case "30d":
      return { from: new Date(startOfDayBrt(ny, nm, nd).getTime() - 29 * 86_400_000), to: now, preset, label: "últimos 30 dias" };
    case "mes_passado": {
      const prevMonth = nm === 1 ? 12 : nm - 1;
      const prevYear = nm === 1 ? ny - 1 : ny;
      const from = startOfDayBrt(prevYear, prevMonth, 1);
      const to = endOfDayBrt(ny, nm, 0); // dia 0 do mês atual = último dia do mês anterior
      return { from, to, preset, label: "mês passado" };
    }
    case "mes_atual":
    default:
      return { from: startOfDayBrt(ny, nm, 1), to: now, preset: "mes_atual", label: "este mês" };
  }
}

// Chave de agrupamento por dia (YYYY-MM-DD, no fuso de Brasília) — usada pra montar os pontos do
// gráfico e o custo por dia dentro do período.
export function dayKeyBrt(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export function eachDayBrt(from: Date, to: Date): string[] {
  const [fy, fm, fd] = brtParts(from);
  const [ty, tm, td] = brtParts(to);
  const days: string[] = [];
  let cursor = startOfDayBrt(fy, fm, fd);
  const last = startOfDayBrt(ty, tm, td);
  while (cursor <= last) {
    days.push(dayKeyBrt(cursor.toISOString()));
    cursor = new Date(cursor.getTime() + 86_400_000); // +24h — seguro aqui pois BRT não tem DST
  }
  return days;
}
