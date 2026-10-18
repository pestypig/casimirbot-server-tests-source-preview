import { beforeEach, describe, expect, it } from "vitest";

import { auditHelixAskContextForPoison } from "../services/helix-ask/ask-context-poison-audit";
import {
  evaluateLiveLineToolRequest,
  hasLineConfidenceAuthority,
} from "../services/helix-ask/live-line-tool-evaluator";
import {
  planLiveLineToolRequest,
  planLiveLineToolRequests,
} from "../services/helix-ask/live-line-tool-request-planner";
import { buildHelixTurnTerminalAuthority } from "../services/helix-ask/turn-terminal-authority";
import { clearLiveLineToolRequestStoreForTest } from "../services/situation-room/live-line-tool-request-store";

describe("Helix Ask live line tool requests", () => {
  beforeEach(() => {
    clearLiveLineToolRequestStoreForTest();
  });

  it("routes missing lava evidence lines to the Minecraft event window tool", () => {
    const request = planLiveLineToolRequest({
      threadId: "helix-ask:desktop",
      environmentId: "live-env:minecraft",
      line: {
        key: "next_check",
        label: "Next check",
        value: "Watch for bucket-empty events, lava placement, and light-level increase.",
        evidence_refs: ["evidence:stair-trench"],
      },
      autoRecord: false,
    });

    expect(request?.schema).toBe("helix.live_line_tool_request.v1");
    expect(request?.requested_tool).toBe("minecraft.query_event_window");
    expect(request?.reason).toBe("query_event_window");
    expect(request?.expected_evidence_kind).toBe("missing_evidence");
    expect(request?.assistant_answer).toBe(false);
    expect(request?.raw_content_included).toBe(false);
  });

  it("routes entity/farm ambiguity through semantic and world-sense checks", () => {
    const requests = planLiveLineToolRequests({
      threadId: "helix-ask:desktop",
      environmentId: "live-env:minecraft",
      lines: [{
        key: "farm_hypothesis",
        label: "Farm hypothesis",
        value: "Possible chicken farm, but egg pickup and containment evidence are still ambiguous.",
        evidence_refs: ["evidence:chicken-cluster"],
      }],
      autoRecord: false,
    });

    expect(requests.map((request) => request.requested_tool)).toEqual(
      expect.arrayContaining([
        "minecraft.lookup_semantics",
        "minecraft.query_world_sense_window",
      ]),
    );
    expect(requests.every((request) => request.assistant_answer === false)).toBe(true);
  });

  it("routes calculator hypotheses to solve-with-steps before confidence changes", () => {
    const request = planLiveLineToolRequest({
      threadId: "helix-ask:desktop",
      line: {
        key: "equation",
        label: "Equation",
        value: "Equation result may support the equilibrium claim; solve x^2 - 4 = 0.",
        evidence_refs: [],
      },
      autoRecord: false,
    });

    expect(request?.requested_tool).toBe("scientific-calculator.solve_with_steps");
    expect(request?.expected_evidence_kind).toBe("calculation");

    const noReceiptEvaluation = evaluateLiveLineToolRequest({
      request: request!,
      autoRecord: false,
    });
    expect(noReceiptEvaluation.supports_line).toBe("unknown");
    expect(noReceiptEvaluation.confidence_delta).toBe(0);
    expect(noReceiptEvaluation.summary).toMatch(/confidence is unchanged/i);

    const receiptEvaluation = evaluateLiveLineToolRequest({
      request: request!,
      tool_receipt_refs: ["receipt:calculator:1"],
      receipts: [{ ok: true, result: "x = -2, 2", trace_id: "trace:calculator:1" }],
      autoRecord: false,
    });
    expect(receiptEvaluation.supports_line).toBe("supports");
    expect(receiptEvaluation.confidence_delta).toBeGreaterThan(0);
    expect(receiptEvaluation.assistant_answer).toBe(false);
  });

  it("allows confidence changes only with receipt, state, steering, or model-reviewed validation authority", () => {
    expect(hasLineConfidenceAuthority({})).toBe(false);
    expect(hasLineConfidenceAuthority({ tool_receipt_refs: ["receipt:1"] })).toBe(true);
    expect(hasLineConfidenceAuthority({ state_observation_refs: ["state:1"] })).toBe(true);
    expect(hasLineConfidenceAuthority({ user_steering_evidence_refs: ["steering:1"] })).toBe(true);
    expect(hasLineConfidenceAuthority({ model_review_validation_refs: ["validation:1"] })).toBe(true);

    const request = planLiveLineToolRequest({
      threadId: "helix-ask:desktop",
      line: {
        key: "intent",
        label: "Intent",
        value: "Possible chicken farm.",
        evidence_refs: ["evidence:cluster"],
      },
      autoRecord: false,
    });
    const steeringEvaluation = evaluateLiveLineToolRequest({
      request: request!,
      supports_line: "supports",
      user_steering_evidence_refs: ["steering:user-confirmed-intent"],
      autoRecord: false,
    });
    expect(steeringEvaluation.confidence_delta).toBeGreaterThan(0);
    expect(steeringEvaluation.tool_receipt_refs).toContain("steering:user-confirmed-intent");
  });

  it("routes large-context storage lines to notes instead of raw Ask context", () => {
    const request = planLiveLineToolRequest({
      threadId: "helix-ask:desktop",
      line: {
        key: "context_transport",
        label: "Context transport",
        value: "Store this large transcript in notes and preserve only compact note refs.",
        evidence_refs: ["evidence:transcript-window"],
      },
      autoRecord: false,
    });

    expect(request?.requested_tool).toBe("workstation-notes.append_to_note");
    expect(request?.expected_evidence_kind).toBe("storage");
    expect(request?.raw_content_included).toBe(false);
  });

  it("does not mistake Minecraft source-event lines for document lookups", () => {
    const request = planLiveLineToolRequest({
      threadId: "helix-ask:desktop",
      environmentId: "live-env:minecraft",
      line: {
        key: "next_check",
        label: "Next check",
        value: "Watch for source events that affect the requested Minecraft categories.",
        evidence_refs: ["source:source:minecraft-server"],
      },
      autoRecord: false,
    });

    expect(request?.requested_tool).toBe("minecraft.query_event_window");
    expect(request?.expected_evidence_kind).toBe("missing_evidence");
  });

  it("fails poison audit when a line tool evaluation is marked as an assistant answer", () => {
    const request = planLiveLineToolRequest({
      threadId: "helix-ask:desktop",
      line: {
        key: "structure",
        label: "Structure",
        value: "possible lava-lit stair mine",
        evidence_refs: ["evidence:structure"],
      },
      autoRecord: false,
    });
    const poisonedEvaluation = {
      ...evaluateLiveLineToolRequest({
        request: request!,
        tool_receipt_refs: ["receipt:bad"],
        supports_line: "supports",
        autoRecord: false,
      }),
      assistant_answer: true,
    };
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e609-poison",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "situation_context_pack",
      terminal_text: "Normal answer text.",
    });

    const audit = auditHelixAskContextForPoison({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e609-poison",
      terminal_authority: authority,
      payload: {
        turn_id: "turn:e609-poison",
        answer: "Normal answer text.",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "situation_context_pack",
        live_line_tool_evaluations: [poisonedEvaluation],
      },
      client_visible_text: "Normal answer text.",
    });

    expect(audit.ok).toBe(false);
    expect(audit.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "deterministic_as_answer" })]),
    );
  });

  it("counts request-user-input artifacts without treating them as answers", () => {
    const authority = buildHelixTurnTerminalAuthority({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e609-request-input",
      final_answer_source: "request_user_input",
      terminal_artifact_kind: "request_user_input",
      terminal_text: "Is this chicken pit intended as a farm or temporary storage?",
    });

    const audit = auditHelixAskContextForPoison({
      thread_id: "helix-ask:desktop",
      turn_id: "turn:e609-request-input",
      terminal_authority: authority,
      payload: {
        turn_id: "turn:e609-request-input",
        answer: "Is this chicken pit intended as a farm or temporary storage?",
        final_answer_source: "request_user_input",
        terminal_artifact_kind: "request_user_input",
        pending_server_request: {
          schema: "helix.clarification_question_proposal.v1",
          kind: "request_user_input",
          question: "Is this chicken pit intended as a farm or temporary storage?",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      client_visible_text: "Is this chicken pit intended as a farm or temporary storage?",
    });

    expect(audit.ok).toBe(true);
    expect(audit.artifact_role_counts.request_user_input).toBe(1);
    expect(audit.artifact_role_counts.assistant_answer).toBe(0);
  });
});
