import { describe, expect, it } from "vitest";
import { describeSchedule, isWithinSchedule, normalizeSchedule, scheduleError } from "@/lib/workflow-schedule";

// 2026-10-19 é segunda-feira. Brasília = UTC-3.
const at = (utc: string) => new Date(utc);

describe("isWithinSchedule", () => {
  const s = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  it("dentro do dia e do horário", () => {
    expect(isWithinSchedule(s, at("2026-10-19T15:00:00Z"))).toBe(true); // seg 12:00 BRT
  });
  it("antes e depois da janela", () => {
    expect(isWithinSchedule(s, at("2026-10-19T11:59:00Z"))).toBe(false); // seg 08:59 BRT
    expect(isWithinSchedule(s, at("2026-10-19T21:00:00Z"))).toBe(false); // seg 18:00 BRT (fim exclusivo)
  });
  it("início inclusivo", () => {
    expect(isWithinSchedule(s, at("2026-10-19T12:00:00Z"))).toBe(true); // seg 09:00 BRT
  });
  it("dia fora da agenda", () => {
    expect(isWithinSchedule(s, at("2026-10-24T15:00:00Z"))).toBe(false); // sábado
  });
  it("usa o dia de Brasília, não o de UTC", () => {
    expect(isWithinSchedule({ days: [1], start: "00:00", end: "23:59" }, at("2026-10-20T01:00:00Z"))).toBe(true); // ter 01:00 UTC = seg 22:00 BRT
  });
});

describe("normalizeSchedule / scheduleError", () => {
  it("aceita agenda válida e ordena os dias", () => {
    expect(normalizeSchedule({ days: [3, 1, 1], start: "09:00", end: "12:30" })).toEqual({ days: [1, 3], start: "09:00", end: "12:30" });
  });
  it("recusa agenda inválida", () => {
    expect(normalizeSchedule({ days: [], start: "09:00", end: "18:00" })).toBeNull();
    expect(normalizeSchedule({ days: [1], start: "18:00", end: "09:00" })).toBeNull();
    expect(normalizeSchedule({ days: [1], start: "9h", end: "18:00" })).toBeNull();
    expect(normalizeSchedule(null)).toBeNull();
  });
  it("explica o erro", () => {
    expect(scheduleError({ days: [], start: "09:00", end: "18:00" })).toContain("dia");
    expect(scheduleError({ days: [1], start: "18:00", end: "09:00" })).toContain("depois");
    expect(scheduleError({ days: [1], start: "09:00", end: "18:00" })).toBeNull();
  });
});

describe("describeSchedule", () => {
  it("resume a agenda", () => {
    expect(describeSchedule({ days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" })).toBe("Seg a Sex, 09:00 às 18:00");
    expect(describeSchedule({ days: [1, 3], start: "10:00", end: "12:00" })).toBe("Seg, Qua, 10:00 às 12:00");
    expect(describeSchedule({ days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "22:00" })).toBe("todos os dias, 08:00 às 22:00");
  });
});
