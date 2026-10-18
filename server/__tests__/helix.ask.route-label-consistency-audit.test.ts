import { describe, expect, it } from "vitest";

import { buildHelixRouteLabelConsistencyAudit } from "../services/helix-ask/route-label-consistency-audit";

describe("Helix route label consistency audit", () => {
  it("marks stale clarify route labels superseded when an answer terminal succeeds", () => {
    const audit = buildHelixRouteLabelConsistencyAudit({
      turnId: "turn:route-label:stale",
      payload: {
        route_reason_code: "clarify:missing_args",
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_direct_answer",
        solver_controller_decision: {
          decision: "allow_terminal",
        },
        goal_satisfaction_evaluation: {
          satisfaction: "satisfied",
        },
      },
    });

    expect(audit.stale_route_label_detected).toBe(true);
    expect(audit.route_label_superseded).toBe(true);
    expect(audit.superseded_by).toBe("terminal_artifact_selected:direct_answer_text");
  });

  it("does not mark clarify stale when request-user-input is the terminal product", () => {
    const audit = buildHelixRouteLabelConsistencyAudit({
      turnId: "turn:route-label:request-input",
      payload: {
        route_reason_code: "clarify:missing_args",
        terminal_artifact_kind: "request_user_input",
        solver_controller_decision: {
          decision: "allow_terminal",
        },
        goal_satisfaction_evaluation: {
          satisfaction: "satisfied",
        },
      },
    });

    expect(audit.stale_route_label_detected).toBe(false);
    expect(audit.route_label_superseded).toBe(false);
  });
});
