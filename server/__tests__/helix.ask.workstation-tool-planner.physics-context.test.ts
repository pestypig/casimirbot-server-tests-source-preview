import { describe, expect, it } from "vitest";
import { planWorkstationToolUse } from "../services/helix-ask/workstation-tool-planner";

describe("Helix Ask physics context workstation planning", () => {
  it("routes physics atlas calculation prompts to the theory badge graph planner", () => {
    const result = planWorkstationToolUse(
      "Estimate photon energy for a 656.28 nm H-alpha line and Doppler shift.",
    );

    expect(result.intent).toBe("physics_calculation_context");
    expect(result.action).toEqual({
      panel_id: "theory-badge-graph",
      action_id: "plan_calculation_context",
      args: expect.objectContaining({
        intent: "solve_scalar",
        overlay: true,
      }),
    });
    expect(result.tool_plan?.intent).toBe("physics_calculation_context");
  });
});
