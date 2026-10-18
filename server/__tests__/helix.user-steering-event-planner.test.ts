import { describe, expect, it } from "vitest";
import { inferUserSteeringEffect } from "../services/helix-ask/user-steering-event-planner";

describe("user steering event planner", () => {
  it("does not treat direct situation questions as steering", () => {
    expect(inferUserSteeringEffect("Is this a chicken farm? Use the Minecraft world-sense evidence.")).toBe("raise_relevance");
    expect(inferUserSteeringEffect("What am I building in Minecraft?")).toBe("raise_relevance");
  });

  it("keeps corrective statements and explicit live policies as steering", () => {
    expect(inferUserSteeringEffect("I am actually building a lava-lit stair mine.")).toBe("correct_hypothesis");
    expect(inferUserSteeringEffect("Keep quiet unless there is danger.")).toBe("change_delivery_policy");
    expect(inferUserSteeringEffect("Watch for egg pickup and hopper context.")).toBe("set_missing_evidence_target");
  });
});
