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

describe("período contínuo (sexta 18:30 até domingo 19:00)", () => {
  const p = { mode: "periodo" as const, fromDay: 5, fromTime: "18:30", toDay: 0, toTime: "19:00" };
  // 2026-10-23 é sexta, 24 sábado, 25 domingo, 26 segunda. Brasília = UTC-3.
  it.each([
    ["2026-10-23T21:30:00Z", true], // sex 18:30 BRT (início inclusivo)
    ["2026-10-23T21:29:00Z", false], // sex 18:29
    ["2026-10-24T15:00:00Z", true], // sáb 12:00
    ["2026-10-25T21:59:00Z", true], // dom 18:59
    ["2026-10-25T22:00:00Z", false], // dom 19:00 (fim exclusivo)
    ["2026-10-26T15:00:00Z", false], // seg
    ["2026-10-21T15:00:00Z", false], // qua
  ])("%s => %s", (utc, expected) => expect(isWithinSchedule(p, new Date(utc))).toBe(expected));

  it("período no mesmo dia e que vira a semana", () => {
    const sameDay = { mode: "periodo" as const, fromDay: 1, fromTime: "09:00", toDay: 1, toTime: "12:00" };
    expect(isWithinSchedule(sameDay, new Date("2026-10-26T13:00:00Z"))).toBe(true); // seg 10:00
    expect(isWithinSchedule(sameDay, new Date("2026-10-26T16:00:00Z"))).toBe(false); // seg 13:00
    const wrap = { mode: "periodo" as const, fromDay: 6, fromTime: "20:00", toDay: 1, toTime: "08:00" };
    expect(isWithinSchedule(wrap, new Date("2026-10-25T15:00:00Z"))).toBe(true); // dom 12:00
    expect(isWithinSchedule(wrap, new Date("2026-10-27T15:00:00Z"))).toBe(false); // ter 12:00
  });
  it("valida e descreve", () => {
    expect(normalizeSchedule(p)).toEqual(p);
    expect(normalizeSchedule({ ...p, toDay: 5, toTime: "18:30" })).toBeNull();
    expect(scheduleError({ ...p, toDay: 5, toTime: "18:30" })).toContain("mesmo momento");
    expect(describeSchedule(p)).toBe("de Sex às 18:30 até Dom às 19:00");
  });
});

describe("período com horário de silêncio (sem madrugada)", () => {
  const p = { mode: "periodo" as const, fromDay: 5, fromTime: "18:30", toDay: 0, toTime: "19:00", quietFrom: "00:00", quietTo: "08:00" };
  it.each([
    ["2026-10-23T22:00:00Z", true], // sex 19:00
    ["2026-10-24T03:00:00Z", false], // sex 00:00 -> sáb 00:00 BRT (madrugada)
    ["2026-10-24T08:00:00Z", false], // sáb 05:00 BRT
    ["2026-10-24T11:00:00Z", true], // sáb 08:00 BRT (fim do silêncio exclusivo)
    ["2026-10-24T15:00:00Z", true], // sáb 12:00
    ["2026-10-25T05:00:00Z", false], // dom 02:00 BRT
    ["2026-10-25T20:00:00Z", true], // dom 17:00
    ["2026-10-25T22:30:00Z", false], // dom 19:30: fora do período
  ])("%s => %s", (utc, expected) => expect(isWithinSchedule(p, new Date(utc))).toBe(expected));

  it("silêncio que atravessa a meia-noite", () => {
    const night = { ...p, quietFrom: "22:00", quietTo: "08:00" };
    expect(isWithinSchedule(night, new Date("2026-10-24T01:30:00Z"))).toBe(false); // sex 22:30 BRT
    expect(isWithinSchedule(night, new Date("2026-10-24T15:00:00Z"))).toBe(true); // sáb 12:00
  });
  it("valida e descreve", () => {
    expect(normalizeSchedule(p)).toEqual(p);
    expect(normalizeSchedule({ ...p, quietFrom: "08:00", quietTo: "08:00" })).toEqual({ mode: "periodo", fromDay: 5, fromTime: "18:30", toDay: 0, toTime: "19:00" });
    expect(scheduleError({ ...p, quietFrom: "08:00", quietTo: "08:00" })).toContain("silêncio");
    expect(describeSchedule(p)).toBe("de Sex às 18:30 até Dom às 19:00, sem enviar das 00:00 às 08:00");
  });
});
