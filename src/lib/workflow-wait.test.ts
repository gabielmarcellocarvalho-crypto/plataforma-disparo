import { describe, expect, it } from "vitest";
import { formatWaitUntil, isValidWaitUntil, waitDueAt } from "@/lib/workflow-types";

const AGORA = Date.parse("2026-11-01T12:00:00Z");

describe("waitDueAt", () => {
  it("tempo relativo soma ao agora", () => {
    expect(waitDueAt({ amount: 2, unit: "days" }, AGORA)).toBe(AGORA + 2 * 86_400_000);
    expect(waitDueAt({ amount: 30, unit: "minutes" }, AGORA)).toBe(AGORA + 30 * 60_000);
  });

  it("data fixa vale no horário de Brasília (-03:00)", () => {
    expect(waitDueAt({ amount: 1, unit: "days", until: "2026-11-05T09:00" }, AGORA)).toBe(Date.parse("2026-11-05T12:00:00Z"));
  });

  it("data que já passou segue na hora", () => {
    expect(waitDueAt({ amount: 1, unit: "days", until: "2026-10-01T09:00" }, AGORA)).toBe(AGORA);
  });

  it("data vazia ou inválida cai no tempo relativo", () => {
    expect(waitDueAt({ amount: 1, unit: "hours", until: "" }, AGORA)).toBe(AGORA + 3_600_000);
    expect(waitDueAt({ amount: 1, unit: "hours", until: "amanhã" }, AGORA)).toBe(AGORA + 3_600_000);
  });
});

describe("isValidWaitUntil / formatWaitUntil", () => {
  it("só aceita AAAA-MM-DDTHH:mm", () => {
    expect(isValidWaitUntil("2026-11-05T09:00")).toBe(true);
    expect(isValidWaitUntil("")).toBe(false);
    expect(isValidWaitUntil(null)).toBe(false);
    expect(isValidWaitUntil("2026-13-45T25:99")).toBe(false);
  });

  it("mostra dia/mês e hora", () => {
    expect(formatWaitUntil("2026-11-05T09:00")).toBe("05/11 09:00");
  });
});
