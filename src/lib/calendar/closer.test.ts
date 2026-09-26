import { describe, expect, it } from "vitest";
import { pickCloser, type CloserCandidate } from "./closer";

const c = (id: string, over: Partial<CloserCandidate> = {}): CloserCandidate => ({ id, connected: true, hasSlots: true, lastMeetingAt: null, ...over });

describe("pickCloser", () => {
  it("reunião ativa manda: remarcar é sempre com o mesmo closer", () => {
    expect(pickCloser({ closerIds: ["a", "b"], ownerId: "b", activeMeetingCloserId: "a", candidates: [c("a"), c("b")] })).toBe("a");
  });

  it("dono do lead tem prioridade quando está apto", () => {
    expect(pickCloser({ closerIds: ["a", "b"], ownerId: "b", activeMeetingCloserId: null, candidates: [c("a"), c("b", { lastMeetingAt: "2026-09-25T10:00:00Z" })] })).toBe("b");
  });

  it("dono fora da lista do agente cai no rodízio", () => {
    expect(pickCloser({ closerIds: ["a"], ownerId: "x", activeMeetingCloserId: null, candidates: [c("a"), c("x")] })).toBe("a");
  });

  it("dono desconectado ou sem horário cai no rodízio", () => {
    const cands = [c("a"), c("b", { connected: false })];
    expect(pickCloser({ closerIds: ["a", "b"], ownerId: "b", activeMeetingCloserId: null, candidates: cands })).toBe("a");
    const semHorario = [c("a"), c("b", { hasSlots: false })];
    expect(pickCloser({ closerIds: ["a", "b"], ownerId: "b", activeMeetingCloserId: null, candidates: semHorario })).toBe("a");
  });

  it("rodízio: quem recebeu há mais tempo, e quem nunca recebeu antes de todos", () => {
    const cands = [c("a", { lastMeetingAt: "2026-09-25T10:00:00Z" }), c("b", { lastMeetingAt: "2026-09-20T10:00:00Z" }), c("c")];
    expect(pickCloser({ closerIds: ["a", "b", "c"], ownerId: null, activeMeetingCloserId: null, candidates: cands })).toBe("c");
    expect(pickCloser({ closerIds: ["a", "b"], ownerId: null, activeMeetingCloserId: null, candidates: cands })).toBe("b");
  });

  it("empate segue a ordem configurada no agente", () => {
    expect(pickCloser({ closerIds: ["b", "a"], ownerId: null, activeMeetingCloserId: null, candidates: [c("a"), c("b")] })).toBe("b");
  });

  it("ninguém apto devolve null", () => {
    expect(pickCloser({ closerIds: ["a"], ownerId: null, activeMeetingCloserId: null, candidates: [c("a", { hasSlots: false })] })).toBeNull();
    expect(pickCloser({ closerIds: [], ownerId: null, activeMeetingCloserId: null, candidates: [c("a")] })).toBeNull();
  });
});
