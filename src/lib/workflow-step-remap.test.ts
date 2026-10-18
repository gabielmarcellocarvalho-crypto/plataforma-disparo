import { describe, expect, it } from "vitest";
import { remapStepIds } from "@/lib/workflow-step-remap";

describe("remapStepIds", () => {
  it("liga cada passo antigo ao novo na mesma posição, inclusive dentro dos ramos", () => {
    const oldRows = [
      { id: "a0", parent_step_id: null, branch: null, position: 0 },
      { id: "a1", parent_step_id: null, branch: null, position: 1 },
      { id: "a1y0", parent_step_id: "a1", branch: "yes", position: 0 },
      { id: "a1n0", parent_step_id: "a1", branch: "no", position: 0 },
    ];
    const newRows = [
      { id: "b0", parent_step_id: null, branch: null, position: 0 },
      { id: "b1", parent_step_id: null, branch: null, position: 1 },
      { id: "b1y0", parent_step_id: "b1", branch: "yes", position: 0 },
      { id: "b1n0", parent_step_id: "b1", branch: "no", position: 0 },
    ];
    const m = remapStepIds(oldRows, newRows);
    expect(m.get("a0")).toBe("b0");
    expect(m.get("a1")).toBe("b1");
    expect(m.get("a1y0")).toBe("b1y0");
    expect(m.get("a1n0")).toBe("b1n0");
  });
  it("posição que sumiu vira null", () => {
    const m = remapStepIds(
      [
        { id: "a0", parent_step_id: null, branch: null, position: 0 },
        { id: "a1", parent_step_id: null, branch: null, position: 1 },
      ],
      [{ id: "b0", parent_step_id: null, branch: null, position: 0 }]
    );
    expect(m.get("a0")).toBe("b0");
    expect(m.get("a1")).toBeNull();
  });
});
