import { describe, expect, it } from "vitest";

import { __testHelixGoalSatisfaction } from "../routes/agi.plan";

describe("goal satisfaction at the external route boundary", () => {
  it.each([
    ["object-valued", { kind: "direct_answer_text" }],
    ["undefined", undefined],
  ])("returns an unsatisfied evidence requirement for a %s terminal kind", (_label, requiredTerminalKind) => {
    const turnId = "ask:malformed-terminal-kind";
    const prompt = "Explain the result in one sentence.";
    const canonicalGoalFrame = __testHelixGoalSatisfaction.buildAskTurnCanonicalGoalFrame({
      turnId,
      goalFrame: {
        schema: "helix.ask.universal_goal_frame.v1",
        turn_id: turnId,
        user_goal: {
          raw: prompt,
          normalized: prompt,
          goal_kind: "unknown",
          goal_hash: "malformed-terminal-kind-test",
        },
        requested_outputs: [],
        evidence_requirements: [],
        constraints: [],
        risks: [],
        confidence: "medium",
        assistant_answer: false,
        raw_content_included: false,
      } as any,
    });
    const malformedFrame = {
      ...canonicalGoalFrame,
      required_terminal_kind: requiredTerminalKind,
    } as any;

    const evaluation = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId,
      transcript: prompt,
      canonicalGoalFrame: malformedFrame,
      currentTurnArtifacts: [],
      satisfactionReport: {
        satisfied: false,
        terminal_kind: "final_failure",
        terminal_artifact_id: null,
        terminal_artifact_kind: null,
        terminal_source: null,
        missing_artifacts: [],
        confidence: "low",
      },
      selectedAction: null,
    });

    expect(evaluation.required_evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ required: true, satisfied: false }),
    ]));
    expect(evaluation.satisfaction).not.toBe("satisfied");
  });
});
