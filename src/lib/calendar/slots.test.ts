import { describe, expect, it } from "vitest";
import { availableSlots, isSlotTitle, pickSlots, type CalendarEvent } from "./slots";

// Sexta, 25/09/2026, 09:00 em Brasília (12:00 UTC).
const now = new Date("2026-09-25T12:00:00Z");
const rules = { slotTitle: "Marque aqui", minNoticeHours: 2, daysAhead: 7, now };

let n = 0;
function ev(startBrt: string, summary = "Marque aqui", minutes = 30, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = new Date(`${startBrt}-03:00`);
  const end = new Date(start.getTime() + minutes * 60_000);
  return { id: `e${++n}`, summary, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, ...extra };
}

describe("isSlotTitle", () => {
  it("ignora caixa, acento e espaço sobrando", () => {
    expect(isSlotTitle("marque aqui")).toBe(true);
    expect(isSlotTitle("  MARQUE   AQUÍ ")).toBe(true);
  });
  it("não aceita título que já virou reunião ou é outro evento", () => {
    expect(isSlotTitle("Reunião: João")).toBe(false);
    expect(isSlotTitle("Marque aqui - João")).toBe(false);
    expect(isSlotTitle(null)).toBe(false);
  });
  it("usa o título configurado no agente", () => {
    expect(isSlotTitle("Horário livre", "Horário livre")).toBe(true);
    expect(isSlotTitle("Marque aqui", "Horário livre")).toBe(false);
  });
});

describe("availableSlots", () => {
  it("respeita a antecedência mínima", () => {
    const slots = availableSlots([ev("2026-09-25T10:00:00"), ev("2026-09-25T11:30:00")], rules);
    expect(slots.map((s) => s.start)).toEqual([new Date("2026-09-25T11:30:00-03:00").toISOString()]);
  });
  it("não passa do limite de dias", () => {
    expect(availableSlots([ev("2026-10-03T10:00:00")], rules)).toHaveLength(0);
  });
  it("ignora cancelado, dia inteiro e evento com outro título", () => {
    const allDay: CalendarEvent = { id: "x", summary: "Marque aqui", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } };
    const slots = availableSlots(
      [ev("2026-09-28T10:00:00", "Marque aqui", 30, { status: "cancelled" }), allDay, ev("2026-09-28T11:00:00", "Almoço")],
      rules
    );
    expect(slots).toHaveLength(0);
  });
  it("devolve em ordem de início", () => {
    const slots = availableSlots([ev("2026-09-29T15:00:00"), ev("2026-09-28T10:00:00")], rules);
    expect(slots[0].start < slots[1].start).toBe(true);
  });
});

describe("pickSlots", () => {
  it("espalha por dias diferentes antes de repetir o dia", () => {
    const events = [
      ev("2026-09-28T09:00:00"),
      ev("2026-09-28T10:00:00"),
      ev("2026-09-28T11:00:00"),
      ev("2026-09-29T14:00:00"),
      ev("2026-09-30T16:00:00"),
    ];
    const days = pickSlots(events, rules, 3).map((s) => new Date(s.start).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
    expect(days).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
  });
  it("completa com o mesmo dia quando faltam dias", () => {
    const events = [ev("2026-09-28T09:00:00"), ev("2026-09-28T10:00:00"), ev("2026-09-29T14:00:00")];
    expect(pickSlots(events, rules, 4)).toHaveLength(3);
  });
  it("agrupa pelo dia de Brasília, não pelo de UTC", () => {
    // 22:30 em Brasília já é o dia seguinte em UTC.
    const events = [ev("2026-09-28T22:30:00"), ev("2026-09-28T09:00:00"), ev("2026-09-29T09:00:00")];
    const picked = pickSlots(events, rules, 2);
    expect(picked.map((s) => new Date(s.start).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }))).toEqual([
      "2026-09-28",
      "2026-09-29",
    ]);
  });
  it("sem horário nenhum devolve vazio", () => {
    expect(pickSlots([], rules)).toEqual([]);
  });
});
