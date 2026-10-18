import { describe, expect, it } from "vitest";
import { deltaPct, previousPeriod } from "@/lib/period-delta";

describe("previousPeriod", () => {
  it("mesma duração, logo antes", () => {
    const p = previousPeriod({ from: new Date("2026-10-11T03:00:00Z"), to: new Date("2026-10-18T03:00:00Z") });
    expect(p.from.toISOString()).toBe("2026-10-04T03:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-11T03:00:00.000Z");
  });
});

describe("deltaPct", () => {
  it("calcula a variação", () => {
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(10, 0)).toBeNull();
  });
});
