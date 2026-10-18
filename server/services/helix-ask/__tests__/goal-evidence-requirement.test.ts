import { describe, expect, it } from "vitest";

import { readHelixGoalEvidenceRequirementKind } from "../goal-evidence-requirement";

describe("goal evidence requirement boundary", () => {
  it("retains a valid kind", () => {
    expect(readHelixGoalEvidenceRequirementKind("direct_answer_text")).toBe("direct_answer_text");
  });

  it.each([undefined, null, "", "   ", { kind: "direct_answer_text" }, ["direct_answer_text"]])(
    "rejects a non-string or blank kind: %s",
    (value) => {
      expect(readHelixGoalEvidenceRequirementKind(value)).toBeNull();
    },
  );
});
