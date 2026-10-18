import { describe, expect, it } from "vitest";
import { aggregateTeam, winRate } from "@/lib/team-performance";

describe("team performance", () => {
  it("soma por pessoa e calcula a taxa de ganho", () => {
    const m = aggregateTeam([
      { team_member_id: "a", stage: "concluido" },
      { team_member_id: "a", stage: "descartado" },
      { team_member_id: "a", stage: "interessado" },
      { team_member_id: "a", stage: "concluido" },
      { team_member_id: "b", stage: "abordado" },
    ]);
    expect(m.get("a")).toEqual({ memberId: "a", total: 4, open: 1, won: 2, lost: 1, winRate: 67 });
    expect(m.get("b")?.winRate).toBeNull();
  });
  it("winRate sem desfecho", () => {
    expect(winRate(0, 0)).toBeNull();
    expect(winRate(1, 3)).toBe(25);
  });
});
