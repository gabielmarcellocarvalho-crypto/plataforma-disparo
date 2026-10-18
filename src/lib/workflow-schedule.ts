// Agenda de uma automação: dias da semana e janela de horário (Brasília) em que as mensagens dela saem.
export type WorkflowSchedule = { days: number[]; start: string; end: string };

export const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DEFAULT_SCHEDULE: WorkflowSchedule = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "20:00" };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// Aceita o que vier do banco/formulário; devolve null se não for uma agenda válida.
export function normalizeSchedule(raw: unknown): WorkflowSchedule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  const start = typeof r.start === "string" ? r.start : "";
  const end = typeof r.end === "string" ? r.end : "";
  if (days.length === 0 || !TIME_RE.test(start) || !TIME_RE.test(end) || toMinutes(end) <= toMinutes(start)) return null;
  return { days, start, end };
}

export function scheduleError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
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
  return schedule.days.includes(day) && minutes >= toMinutes(schedule.start) && minutes < toMinutes(schedule.end);
}

export function describeSchedule(s: WorkflowSchedule): string {
  const days = s.days;
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const label = days.length === 7 ? "todos os dias" : consecutive && days.length > 2 ? `${DAY_LABELS[days[0]]} a ${DAY_LABELS[days[days.length - 1]]}` : days.map((d) => DAY_LABELS[d]).join(", ");
  return `${label}, ${s.start} às ${s.end}`;
}
