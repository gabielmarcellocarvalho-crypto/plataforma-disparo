// Agenda de uma automação (horário de Brasília). Dois jeitos de escolher quando as mensagens saem:
// - diário: os dias marcados, sempre na mesma janela de horário (ex.: Seg a Sex, 9h às 18h);
// - período: um intervalo contínuo de um dia/hora até outro (ex.: sexta 18:30 até domingo 19:00).
export type DailySchedule = { mode?: "diario"; days: number[]; start: string; end: string };
// quietFrom/quietTo (opcionais): horário de silêncio todo dia dentro do período (ex.: 00:00 às 08:00 = sem madrugada).
// Pode atravessar a meia-noite (22:00 às 08:00).
export type PeriodSchedule = { mode: "periodo"; fromDay: number; fromTime: string; toDay: number; toTime: string; quietFrom?: string; quietTo?: string };
export type WorkflowSchedule = DailySchedule | PeriodSchedule;

export const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DEFAULT_SCHEDULE: DailySchedule = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "20:00" };
export const DEFAULT_PERIOD: PeriodSchedule = { mode: "periodo", fromDay: 5, fromTime: "18:30", toDay: 0, toTime: "19:00", quietFrom: "00:00", quietTo: "08:00" };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const validDay = (d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6;

export function isPeriod(s: WorkflowSchedule): s is PeriodSchedule {
  return s.mode === "periodo";
}

// Aceita o que vier do banco/formulário; devolve null se não for uma agenda válida.
export function normalizeSchedule(raw: unknown): WorkflowSchedule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.mode === "periodo") {
    const fromDay = Number(r.fromDay);
    const toDay = Number(r.toDay);
    const fromTime = String(r.fromTime ?? "");
    const toTime = String(r.toTime ?? "");
    if (!validDay(fromDay) || !validDay(toDay) || !TIME_RE.test(fromTime) || !TIME_RE.test(toTime)) return null;
    if (fromDay * DAY_MIN + toMinutes(fromTime) === toDay * DAY_MIN + toMinutes(toTime)) return null;
    const quietFrom = String(r.quietFrom ?? "");
    const quietTo = String(r.quietTo ?? "");
    const quiet = TIME_RE.test(quietFrom) && TIME_RE.test(quietTo) && quietFrom !== quietTo ? { quietFrom, quietTo } : {};
    return { mode: "periodo", fromDay, fromTime, toDay, toTime, ...quiet };
  }
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter(validDay))].sort() : [];
  const start = typeof r.start === "string" ? r.start : "";
  const end = typeof r.end === "string" ? r.end : "";
  if (days.length === 0 || !TIME_RE.test(start) || !TIME_RE.test(end) || toMinutes(end) <= toMinutes(start)) return null;
  return { days, start, end };
}

export function scheduleError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.mode === "periodo") {
    if (!validDay(Number(r.fromDay)) || !validDay(Number(r.toDay))) return "Escolha o dia de início e o dia de fim do período.";
    if (!TIME_RE.test(String(r.fromTime)) || !TIME_RE.test(String(r.toTime))) return "Informe a hora de início e a hora de fim do período.";
    if (Number(r.fromDay) * DAY_MIN + toMinutes(String(r.fromTime)) === Number(r.toDay) * DAY_MIN + toMinutes(String(r.toTime))) {
      return "O início e o fim do período não podem ser o mesmo momento.";
    }
    const hasQuiet = r.quietFrom != null || r.quietTo != null;
    if (hasQuiet && (!TIME_RE.test(String(r.quietFrom)) || !TIME_RE.test(String(r.quietTo)) || r.quietFrom === r.quietTo)) {
      return "Informe o início e o fim do horário de silêncio (precisam ser diferentes).";
    }
    return null;
  }
  if (!Array.isArray(r.days) || r.days.length === 0) return "Marque pelo menos um dia da semana na agenda.";
  if (!TIME_RE.test(String(r.start)) || !TIME_RE.test(String(r.end))) return "Informe o horário de início e de fim da agenda.";
  if (toMinutes(String(r.end)) <= toMinutes(String(r.start))) return "O horário de fim da agenda precisa ser depois do início.";
  return null;
}

const WEEKDAY_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Dia da semana e minutos do dia em Brasília.
function brazilNow(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { day: WEEKDAY_NUM[get("weekday")] ?? now.getDay(), minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export function isWithinSchedule(schedule: WorkflowSchedule, now: Date = new Date()): boolean {
  const { day, minutes } = brazilNow(now);
  if (isPeriod(schedule)) {
    // Posição na semana (minutos desde domingo 00:00). Período que "vira" a semana (ex.: sáb → seg) é tratado somando 7 dias ao fim.
    const from = schedule.fromDay * DAY_MIN + toMinutes(schedule.fromTime);
    let to = schedule.toDay * DAY_MIN + toMinutes(schedule.toTime);
    if (to <= from) to += WEEK_MIN;
    const at = day * DAY_MIN + minutes;
    const inPeriod = (at >= from && at < to) || (at + WEEK_MIN >= from && at + WEEK_MIN < to);
    if (!inPeriod) return false;
    if (schedule.quietFrom && schedule.quietTo) {
      const qf = toMinutes(schedule.quietFrom);
      const qt = toMinutes(schedule.quietTo);
      const inQuiet = qf < qt ? minutes >= qf && minutes < qt : minutes >= qf || minutes < qt;
      if (inQuiet) return false;
    }
    return true;
  }
  return schedule.days.includes(day) && minutes >= toMinutes(schedule.start) && minutes < toMinutes(schedule.end);
}

export function describeSchedule(s: WorkflowSchedule): string {
  if (isPeriod(s)) {
    const base = `de ${DAY_LABELS[s.fromDay]} às ${s.fromTime} até ${DAY_LABELS[s.toDay]} às ${s.toTime}`;
    return s.quietFrom && s.quietTo ? `${base}, sem enviar das ${s.quietFrom} às ${s.quietTo}` : base;
  }
  const days = s.days;
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const label = days.length === 7 ? "todos os dias" : consecutive && days.length > 2 ? `${DAY_LABELS[days[0]]} a ${DAY_LABELS[days[days.length - 1]]}` : days.map((d) => DAY_LABELS[d]).join(", ");
  return `${label}, ${s.start} às ${s.end}`;
}
