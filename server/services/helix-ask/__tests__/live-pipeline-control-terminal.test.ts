import { describe, expect, it } from "vitest";

import { buildLivePipelineControlTerminalProjection } from "../live-pipeline-control-terminal";

const turnId = "ask:test:live-pipeline-control-terminal";
const threadId = "helix-ask:test:live-pipeline-control-terminal";
const capability = "situation-room.live-source.set_rate";

const committedAskRoute = {
  schema: "helix.committed_ask_route.v1",
  route: {
    source_target: "live_pipeline",
    target_kind: "live_pipeline",
  },
  canonical_goal: {
    goal_kind: "live_pipeline_control",
    required_terminal_kind: "live_pipeline_receipt",
    allowed_terminal_artifact_kinds: ["live_pipeline_receipt"],
    forbidden_terminal_artifact_kinds: [],
  },
};

const sourceTargetIntent = {
  target_source: "live_pipeline",
  allow_client_shortcut: false,
  allow_no_tool_direct: false,
};

const toolCallAdmissionDecision = {
  source_target: "live_pipeline",
  required: true,
  requested_capability: capability,
  selected_capability: capability,
  admitted_capability: capability,
  admitted_tool_families: ["live_pipeline"],
};

const cadenceArtifact = {
  schema: "helix.current_turn_artifact.v1",
  artifact_id: `${turnId}:codex_normalized:visual_producer_cadence_receipt:1`,
  kind: "visual_producer_cadence_receipt",
  turn_id: turnId,
  source_scope: "current_turn_context",
  capability_key: capability,
  status: "succeeded",
  payload: {
    schema: "helix.visual_producer_cadence_receipt.v1",
    receipt_id: "visual_producer_cadence_receipt:test",
    action_id: capability,
    producer_id: "live_source_producer:test",
    cadence_ms: 10_000,
    cadence: {
      producer_id: "live_source_producer:test",
      status: "active",
    },
    ok: true,
    assistant_answer: false,
    raw_content_included: false,
  },
};

describe("live-pipeline control terminal materializer", () => {
  it("wraps a re-entered exact cadence observation in a bounded live-pipeline receipt", () => {
    const projection = buildLivePipelineControlTerminalProjection({
      turnId,
      threadId,
      promptText: "Set the visual capture interval to 10 seconds.",
      providerText: "Visual capture interval is now set to 10 seconds.",
      providerObservationReentered: true,
      providerSolverPathCompleted: true,
      committedAskRoute,
      sourceTargetIntent,
      toolCallAdmissionDecision,
      normalizedArtifacts: [cadenceArtifact],
    });

    expect(projection).toMatchObject({
      text: "Visual capture interval is now set to 10 seconds.",
      receipt: {
        schema: "helix.live_pipeline_turn_receipt.v1",
        action_id: capability,
        cadence_ms: 10_000,
        assistant_answer: false,
        raw_content_included: false,
      },
      receiptArtifact: {
        kind: "live_pipeline_receipt",
        capability_key: capability,
        status: "succeeded",
      },
      routeProductContract: {
        source_target: "live_pipeline",
        required_terminal_kind: "live_pipeline_receipt",
      },
      canonicalGoalFrame: {
        goal_kind: "live_pipeline_control",
      },
      terminalArtifactSelectionGuard: {
        allowed: true,
      },
      productAuthorityGuard: {
        allowed: true,
      },
      routeAuthorityAudit: {
        selected_route: "live_pipeline_control",
        terminal_artifact_kind: "live_pipeline_receipt",
        route_authority_ok: true,
        violation_codes: [],
      },
      authority: {
        final_answer_source: "live_pipeline_receipt",
        terminal_artifact_kind: "live_pipeline_receipt",
        terminal_eligible: true,
      },
    });
  });

  it("does not promote stale, failed, or unreentered observations", () => {
    const base = {
      turnId,
      threadId,
      promptText: "Set the visual capture interval to 10 seconds.",
      providerText: "Visual capture interval is now set to 10 seconds.",
      providerObservationReentered: true,
      providerSolverPathCompleted: true,
      committedAskRoute,
      sourceTargetIntent,
      toolCallAdmissionDecision,
      normalizedArtifacts: [cadenceArtifact],
    };

    expect(buildLivePipelineControlTerminalProjection({
      ...base,
      providerObservationReentered: false,
    })).toBeNull();
    expect(buildLivePipelineControlTerminalProjection({
      ...base,
      committedAskRoute: {
        ...committedAskRoute,
        canonical_goal: {
          ...committedAskRoute.canonical_goal,
          goal_kind: "visual_capture_describe",
        },
      },
    })).toBeNull();
    expect(buildLivePipelineControlTerminalProjection({
      ...base,
      normalizedArtifacts: [{
        ...cadenceArtifact,
        status: "failed",
      }],
    })).toBeNull();
  });
});
