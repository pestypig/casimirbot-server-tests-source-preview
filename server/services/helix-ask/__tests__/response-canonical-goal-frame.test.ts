import { describe, expect, it, vi } from "vitest";
import { selectHelixAskResponseCanonicalGoalFrame } from "../response-canonical-goal-frame";

describe("Ask response canonical goal frame", () => {
  const turnId = "ask:r120-source-free-arithmetic";
  const canonical = {
    turn_id: turnId,
    goal_kind: "model_only_concept",
    answer_scope: "model_only",
    required_terminal_kind: "direct_answer_text",
  };

  it("rebuilds a current-turn partial frame before runtime satisfaction", () => {
    const build = vi.fn(() => canonical);
    const result = selectHelixAskResponseCanonicalGoalFrame({
      candidate: { turn_id: turnId, goal_kind: "model_only_concept", answer_scope: "model_only" },
      turnId,
      build,
    });
    expect(result).toEqual({ frame: canonical, rebuilt: true });
    expect(build).toHaveBeenCalledOnce();
  });

  it("rebuilds a one-key frame like the R122 diagnostic observed", () => {
    const result = selectHelixAskResponseCanonicalGoalFrame({
      candidate: { turn_id: turnId },
      turnId,
      build: () => canonical,
    });
    expect(result).toEqual({ frame: canonical, rebuilt: true });
  });

  it("rejects a prior-turn frame even when its terminal kind is present", () => {
    const result = selectHelixAskResponseCanonicalGoalFrame({
      candidate: { ...canonical, turn_id: "ask:previous" },
      turnId,
      build: () => canonical,
    });
    expect(result).toEqual({ frame: canonical, rebuilt: true });
  });

  it("preserves a complete current-turn frame", () => {
    const build = vi.fn(() => canonical);
    const result = selectHelixAskResponseCanonicalGoalFrame({
      candidate: canonical,
      turnId,
      build,
    });
    expect(result).toEqual({ frame: canonical, rebuilt: false });
    expect(build).not.toHaveBeenCalled();
  });
});
