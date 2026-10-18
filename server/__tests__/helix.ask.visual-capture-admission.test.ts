import { describe, expect, it } from "vitest";

import {
  buildHelixAccountCapabilityPolicy,
  resolveHelixWorkstationCapabilityAccess,
} from "@shared/helix-account-session";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import { buildStructuredAdmissionWorkstationGatewayCallRequests } from "../services/helix-ask/agent-providers/active-context-tool-requests";

describe("hard visual-capture admission", () => {
  const sourceTargetIntent = {
    schema: "helix.ask_source_target_intent.v1",
    turn_id: "ask:visual-capture-admission",
    thread_id: "helix-ask:test:visual-capture-admission",
    target_source: "visual_capture",
    target_kind: "visual_capture",
    strength: "hard",
  } as const;

  it("is available to the normal user account rather than developer-only", () => {
    expect(
      resolveHelixWorkstationCapabilityAccess(
        buildHelixAccountCapabilityPolicy("user"),
        {
          capability_id: "situation-room.describe_visual_capture",
          permission_profile_required: "read",
        },
      ),
    ).toEqual({ state: "available", reason: null });
  });

  it("admits the canonical bounded SituationRun observation capability", () => {
    const admission = buildToolCallAdmissionDecision({
      turnId: sourceTargetIntent.turn_id,
      sourceTargetIntent,
      promptText: "What is happening right now in the visual screen capture?",
    });

    expect(admission).toMatchObject({
      required: true,
      requested_capability: "image_lens.inspect",
      selected_capability: "situation-room.describe_visual_capture",
      admitted_capability: "situation-room.describe_visual_capture",
      requested_capability_source: "hard_source_target_policy",
      mandatory_capability_admitted: true,
      admitted_tool_families: ["situation_run"],
    });
  });

  it("projects that exact admission into one bounded gateway read", () => {
    const admission = buildToolCallAdmissionDecision({
      turnId: sourceTargetIntent.turn_id,
      sourceTargetIntent,
      promptText: "Review the current screen before I click Start.",
    });
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question: "Review the current screen before I click Start.",
      sessionId: sourceTargetIntent.thread_id,
      source_target_intent: sourceTargetIntent,
      tool_call_admission_decision: admission,
    });

    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_structured_source_target_admission",
        capability_id: "situation-room.describe_visual_capture",
        mode: "read",
        arguments: expect.objectContaining({
          thread_id: sourceTargetIntent.thread_id,
          source_target_intent: expect.objectContaining({
            target_source: "visual_capture",
            target_kind: "visual_capture",
            selected_capability: "situation-room.describe_visual_capture",
          }),
        }),
      }),
    ]);
  });
});
