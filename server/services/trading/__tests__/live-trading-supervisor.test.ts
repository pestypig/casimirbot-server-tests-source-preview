import { describe, expect, it } from "vitest";
import { runLiveTradingSupervisorCycle } from
  "../live-trading-supervisor";

describe("live trading supervisor", () => {
  it("does nothing when disabled and never reports mutation authority", async () => {
    await expect(runLiveTradingSupervisorCycle({ enabled: false })).resolves
      .toEqual(expect.objectContaining({
        enabled: false,
        controls_checked: 0,
        deadman_relocks: 0,
        placed_orders: 0,
        cancelled_orders: 0,
        answer_authority: false,
        terminal_eligible: false,
      }));
  });
});
