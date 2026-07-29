// Resolve o período (intervalo de datas) escolhido no filtro de Visão geral/Métricas — mesma fonte
// pros dois, lida via query string pra ficar linkável/compartilhável (?preset=7d ou ?from=&to=).
export type PeriodPreset = "hoje" | "7d" | "30d" | "mes_atual" | "mes_passado" | "custom";

export type Period = { from: Date; to: Date; preset: PeriodPreset; label: string };

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes_atual", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
];

function startOfDayUtc(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function endOfDayUtc(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(23, 59, 59, 999);
  return r;
}

function daysAgoUtc(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return startOfDayUtc(d);
}

export function resolvePeriod(sp: { preset?: string; from?: string; to?: string }): Period {
  const now = new Date();

  if (sp.from && sp.to) {
    const from = new Date(`${sp.from}T00:00:00.000Z`);
    const to = new Date(`${sp.to}T23:59:59.999Z`);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      return { from, to, preset: "custom", label: `${sp.from} a ${sp.to}` };
    }
  }

  const preset = (sp.preset as PeriodPreset) || "mes_atual";

  switch (preset) {
    case "hoje":
      return { from: startOfDayUtc(now), to: now, preset, label: "hoje" };
    case "7d":
      return { from: daysAgoUtc(6), to: now, preset, label: "últimos 7 dias" };
    case "30d":
      return { from: daysAgoUtc(29), to: now, preset, label: "últimos 30 dias" };
    case "mes_passado": {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const to = endOfDayUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
      return { from, to, preset, label: "mês passado" };
    }
    case "mes_atual":
    default: {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from, to: now, preset: "mes_atual", label: "este mês" };
    }
  }
}

// Chave de agrupamento por dia (YYYY-MM-DD, UTC) — usada pra montar os pontos do gráfico dentro do período.
export function dayKeyUtc(iso: string): string {
  return iso.slice(0, 10);
}

export function eachDayUtc(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = startOfDayUtc(from);
  const last = startOfDayUtc(to);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
