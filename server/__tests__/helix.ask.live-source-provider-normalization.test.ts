import { describe, expect, it } from "vitest";

import {
  admitCodexLockedLiveSourceContinuationCapability,
  buildCodexNormalizedObservationArtifacts,
  enforceCodexLockedLiveSourceContinuation,
} from "../services/helix-ask/agent-providers/codex-provider";
import {
  mandatoryToolForPhase,
  resolveLiveSourceTurnPhase,
} from "../services/helix-ask/live-source-turn-phase-resolver";

const gatewayResult = (
  capabilityId: string,
  observation: Record<string, unknown>,
) =>
  ({
    schema: "helix.workstation_tool_gateway.call_result.v1",
    manifest_version: "read-observe-act.v1",
    ok: true,
    agent_runtime: "codex",
    capability_id: capabilityId,
    mode: "read",
    gateway_admission: {
      admission_status: "admitted",
      requested_capability: capabilityId,
      assistant_answer: false,
      raw_content_included: false,
    },
    observation_packet: {
      schema: "helix.agent_step_observation_packet.v1",
      call_id: `call:${capabilityId}`,
      turn_id: "ask:g4-normalization",
      capability_key: capabilityId,
      status: "completed",
      observation_summary: "mailbox observation",
      executed_args: {},
      produced_artifact_refs: [],
      receipts: [],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    observation,
    artifact_refs: [],
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  }) as any;

describe("Codex live-source gateway observation normalization", () => {
  it("preserves a bounded processed packet and forces the decision phase", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:g4-normalization",
      gatewayCallResults: [
        gatewayResult("live_env.read_processed_live_source_mail", {
          schema: "helix.live_environment_tool_observation.v1",
          observation_id: "observation:g4",
          thread_id: "helix-ask:room:room:g4",
          tool_name: "live_env.read_processed_live_source_mail",
          ok: true,
          summary: "Read one packet.",
          observation: {
            schema: "stage_play_processed_live_source_mail_read_result/v1",
            packets: [
              {
                artifactId: "stage_play_processed_mail_packet",
                schemaVersion: "stage_play_processed_mail_packet/v1",
                packetId: "stage_play_processed_mail_packet:g4",
                sourceId: "source:g4",
                mailIds: ["stage_play_live_source_mail:g4"],
                observedFacts: ["The player entered water."],
                changedFacts: ["Air began decreasing."],
                inferredFacts: ["The route needs revision."],
                recommendedNext: "record_interpretation",
                salience: { level: "high", reasons: ["drowning risk"] },
                evidenceRefs: ["environment_situation_digest:g4"],
                microReasonerRows: ["raw-private-trace-must-not-copy"],
              },
            ],
            processedPacketRefs: ["stage_play_processed_mail_packet:g4"],
            missingRawMailIds: [],
          },
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        }),
      ],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: "live_environment_tool_observation",
      payload: {
        tool_name: "live_env.read_processed_live_source_mail",
        observation: {
          packets: [
            expect.objectContaining({
              packetId: "stage_play_processed_mail_packet:g4",
              mailIds: ["stage_play_live_source_mail:g4"],
              recommendedNext: "record_interpretation",
            }),
          ],
        },
      },
    });
    expect(JSON.stringify(result.artifacts)).not.toContain(
      "raw-private-trace-must-not-copy",
    );
    expect(JSON.stringify(result.artifacts).length).toBeLessThan(20_000);

    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the latest processed Minecraft mail and revise the plan.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
      latestToolReceipts: result.artifacts,
    });
    expect(phase.phase).toBe("record_decision");
    expect(phase.phaseLock.locked).toBe(true);
    expect(mandatoryToolForPhase(phase)).toBe(
      "live_env.record_live_source_mail_decision",
    );

    const continued = enforceCodexLockedLiveSourceContinuation({
      state: {
        schema: "helix.agent_continuation_state.v1",
        turn_id: "ask:g4-normalization",
        state_id: "state:g4",
        sequence: 2,
        trigger: "post_attempt",
        goal: {
          status: "satisfied",
          satisfied: true,
          terminal_product_allowed: true,
        },
        observation_refs: { all: [], existing: [], new: [] },
        missing_requirement_ids: [],
        last_attempt: null,
        next_admissible_affordances: [],
        capability_proposal: {
          allowed: false,
          admitted_capability_ids: [],
          authority: "helix_policy_admits_runtime_proposal",
        },
        tried_action_fingerprints: [],
        progress: {
          made_progress: true,
          new_observation_count: 1,
          resolved_requirement_ids: [],
          added_requirement_ids: [],
          new_affordance_count: 0,
          no_progress_repeat_count: 0,
          reason_codes: [],
        },
        budget: {} as any,
        allowed_decisions: ["answer"],
        authority: "runtime_agent_decides_within_admitted_boundaries",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      prompt: "Read the latest processed Minecraft mail and revise the plan.",
      currentTurnArtifacts: result.artifacts,
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
      admittedCapabilityIds: [
        "live_env.read_processed_live_source_mail",
        "live_env.record_live_source_mail_decision",
      ],
    });
    expect(continued.goal).toMatchObject({
      status: "in_progress",
      satisfied: false,
      terminal_product_allowed: false,
    });
    expect(continued.allowed_decisions).toEqual(["act"]);
    expect(continued.capability_proposal).toMatchObject({
      allowed: true,
      admitted_capability_ids: ["live_env.record_live_source_mail_decision"],
    });

    expect(
      admitCodexLockedLiveSourceContinuationCapability({
        prompt: "Read the latest processed Minecraft mail and revise the plan.",
        currentTurnArtifacts: result.artifacts,
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: "live_env.read_processed_live_source_mail",
        admittedCapabilityIds: ["live_env.read_processed_live_source_mail"],
        availableCapabilityIds: [
          "live_env.read_processed_live_source_mail",
          "live_env.record_live_source_mail_decision",
        ],
      }),
    ).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.record_live_source_mail_decision",
    ]);
  });

  it("does not admit a mailbox mutation from prompt text or an unavailable catalog entry", () => {
    const base = {
      prompt:
        "Read the latest processed Minecraft mail, record its decision, and revise the plan.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
      admittedCapabilityIds: ["live_env.read_processed_live_source_mail"],
    };
    expect(
      admitCodexLockedLiveSourceContinuationCapability({
        ...base,
        currentTurnArtifacts: [],
        availableCapabilityIds: [
          "live_env.read_processed_live_source_mail",
          "live_env.record_live_source_mail_decision",
        ],
      }),
    ).toEqual(["live_env.read_processed_live_source_mail"]);
    expect(
      admitCodexLockedLiveSourceContinuationCapability({
        ...base,
        currentTurnArtifacts: [
          {
            artifact_id: "unrelated:current-turn",
            kind: "live_environment_tool_observation",
            payload: { tool_name: "live_env.query_source_health" },
          },
        ],
        availableCapabilityIds: ["live_env.read_processed_live_source_mail"],
      }),
    ).toEqual(["live_env.read_processed_live_source_mail"]);
  });

  it("preserves the recorded decision and next loop state", () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:g4-normalization",
      gatewayCallResults: [
        gatewayResult("live_env.record_live_source_mail_decision", {
          schema: "helix.live_environment_tool_observation.v1",
          observation_id: "observation:g4-decision",
          thread_id: "helix-ask:room:room:g4",
          tool_name: "live_env.record_live_source_mail_decision",
          ok: true,
          summary: "Decision recorded.",
          observation: {
            artifactId: "stage_play_live_source_mail_decision",
            schemaVersion: "stage_play_live_source_mail_decision/v1",
            decisionId: "stage_play_live_source_mail_decision:g4",
            mailIds: ["stage_play_live_source_mail:g4"],
            decision: "record_interpretation",
            nextLoopState: "armed_for_next_summary",
            evidenceRefs: ["stage_play_processed_mail_packet:g4"],
          },
        }),
      ],
    });

    expect(result.artifacts[0]).toMatchObject({
      kind: "live_environment_tool_observation",
      payload: {
        tool_name: "live_env.record_live_source_mail_decision",
        observation: {
          decisionId: "stage_play_live_source_mail_decision:g4",
          decision: "record_interpretation",
          nextLoopState: "armed_for_next_summary",
        },
      },
    });
  });
});
