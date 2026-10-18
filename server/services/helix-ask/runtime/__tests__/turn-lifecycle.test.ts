import { describe, expect, it } from "vitest";
import { createHelixTurnLifecycleRecorder } from "../turn-lifecycle";
import { readVerifiedHelixTurnLifecycle } from "../turn-lifecycle";
import { readVerifiedHelixRuntimeLifecycleFromPayload } from "../turn-lifecycle";
import { resolveHelixRuntimeObservationReentry } from "../turn-lifecycle";
import { auditHelixTurnLifecycleProjection } from "../turn-lifecycle-projection-audit";
import { buildHelixTurnLifecycleDifferentialAudit } from "../turn-lifecycle-differential-audit";
import { refreshHelixTurnLifecycleDifferentialAudit } from "../../terminal-authority-single-writer";

const buildCompletedLifecycle = () => {
  const recorder = createHelixTurnLifecycleRecorder({
    turnId: "ask:test:lifecycle",
    now: () => 100,
  });
  const started = recorder.append({
    kind: "turn.started",
    producer: "helix_adapter",
    status: "started",
  });
  const route = recorder.append({
    kind: "route.committed",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: started.event_id,
    route_commit_id: "route:test",
    capability_ids: ["scholarly.fetch_full_text"],
  });
  recorder.append({
    kind: "capability.admitted",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: route.event_id,
    route_commit_id: "route:test",
    capability_id: "scholarly.fetch_full_text",
  });
  const call = recorder.append({
    kind: "tool.call.started",
    producer: "codex_runtime",
    status: "started",
    route_commit_id: "route:test",
    call_id: "call:paper",
    capability_id: "scholarly.fetch_full_text",
  });
  const completed = recorder.append({
    kind: "tool.call.completed",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: call.event_id,
    route_commit_id: "route:test",
    call_id: "call:paper",
    capability_id: "scholarly.fetch_full_text",
    observation_refs: ["paper:full-text:1"],
  });
  const reentered = recorder.append({
    kind: "observation.reentered",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: completed.event_id,
    route_commit_id: "route:test",
    call_id: "call:paper",
    capability_id: "scholarly.fetch_full_text",
    observation_refs: ["paper:full-text:1"],
  });
  const message = recorder.append({
    kind: "agent.message.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: reentered.event_id,
    native_item_id: "agent-message:1",
    message_sha256: "hash:test",
  });
  const runtime = recorder.append({
    kind: "runtime.turn.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: message.event_id,
    native_turn_id: "native-turn:1",
  });
  const eligibility = recorder.append({
    kind: "terminal.eligibility.checked",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: runtime.event_id,
    terminal_kind: "agent_provider_terminal_candidate",
    terminal_eligible: true,
  });
  recorder.append({
    kind: "turn.completed",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: eligibility.event_id,
    terminal_kind: "agent_provider_terminal_candidate",
    terminal_eligible: true,
  });
  return recorder.snapshot();
};

describe("Helix factual turn lifecycle", () => {
  it("reduces a tool observation and post-observation model completion without inference", () => {
    const lifecycle = buildCompletedLifecycle();

    expect(lifecycle).toMatchObject({
      authority: "runtime_event_log",
      scope: "helix_ask_turn",
      reduction: {
        route_commit_id: "route:test",
        admitted_capability_ids: ["scholarly.fetch_full_text"],
        observation_reentry_refs: ["paper:full-text:1"],
        post_observation_reasoning_completed: true,
        runtime_turn_completed: true,
        terminal_event_count: 1,
        terminal_outcome: "completed",
        complete: true,
      },
      integrity: {
        ok: true,
        violations: [],
      },
    });
  });

  it("recomputes authority from events instead of trusting stored projections", () => {
    const lifecycle = buildCompletedLifecycle();
    const verified = readVerifiedHelixTurnLifecycle({
      turnId: lifecycle.turn_id,
      value: {
        ...lifecycle,
        reduction: {
          ...lifecycle.reduction,
          runtime_turn_completed: false,
          post_observation_reasoning_completed: false,
          complete: false,
        },
        integrity: {
          ...lifecycle.integrity,
          ok: true,
          violations: [],
        },
      },
    });

    expect(verified?.reduction).toMatchObject({
      runtime_turn_completed: true,
      post_observation_reasoning_completed: true,
      complete: true,
    });
  });

  it("prefers the verified native Codex event log for runtime facts", () => {
    const nativeLifecycle = {
      ...buildCompletedLifecycle(),
      scope: "codex_native_provider_cycle" as const,
    };
    const invalidOuter = {
      ...buildCompletedLifecycle(),
      events: buildCompletedLifecycle().events.filter(
        (event) => event.kind !== "observation.reentered",
      ),
    };

    const selected = readVerifiedHelixRuntimeLifecycleFromPayload({
      turnId: nativeLifecycle.turn_id,
      payload: {
        turn_lifecycle: invalidOuter,
        native_provider_turn_lifecycle: nativeLifecycle,
      },
    });

    expect(selected).toMatchObject({
      scope: "codex_native_provider_cycle",
      reduction: {
        observation_reentry_refs: ["paper:full-text:1"],
        post_observation_reasoning_completed: true,
      },
    });
  });

  it("uses the verified canonical turn log when adapter gateway re-entry is outside the native cycle", () => {
    const canonicalLifecycle = buildCompletedLifecycle();
    const nativeRecorder = createHelixTurnLifecycleRecorder({
      turnId: canonicalLifecycle.turn_id,
      scope: "codex_native_provider_cycle",
      now: () => 100,
    });
    const started = nativeRecorder.append({
      kind: "turn.started",
      producer: "codex_runtime",
      status: "started",
    });
    const message = nativeRecorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: started.event_id,
      message_sha256: "hash:native-no-gateway-observation",
    });
    const completed = nativeRecorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });
    const eligibility = nativeRecorder.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_terminal_authority",
      status: "succeeded",
      causation_id: completed.event_id,
      terminal_kind: "model_synthesized_answer",
      terminal_eligible: true,
    });
    nativeRecorder.append({
      kind: "turn.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: eligibility.event_id,
      terminal_kind: "model_synthesized_answer",
      terminal_eligible: true,
    });

    const resolution = resolveHelixRuntimeObservationReentry({
      payload: {
        turn_lifecycle: canonicalLifecycle,
        native_provider_turn_lifecycle: nativeRecorder.snapshot(),
      },
      turnId: canonicalLifecycle.turn_id,
      candidateRefs: ["paper:full-text:1"],
      compatibilityProjected: true,
    });

    expect(resolution).toMatchObject({
      authority: "runtime_event_log",
      runtime_lifecycle_verified: true,
      reentered: true,
      matched_reentry_refs: ["paper:full-text:1"],
      runtime_observation_reentry_refs: ["paper:full-text:1"],
    });

    const selected = readVerifiedHelixRuntimeLifecycleFromPayload({
      payload: {
        turn_lifecycle: canonicalLifecycle,
        native_provider_turn_lifecycle: nativeRecorder.snapshot(),
      },
      turnId: canonicalLifecycle.turn_id,
    });
    expect(selected).toMatchObject({
      scope: "helix_ask_turn",
      reduction: {
        observation_reentry_refs: ["paper:full-text:1"],
        post_observation_reasoning_completed: true,
      },
    });
  });

  it("uses fixed canonical precedence instead of selecting a more complete competing snapshot", () => {
    const canonicalLifecycle = buildCompletedLifecycle();
    const nativeLifecycle = {
      ...buildCompletedLifecycle(),
      scope: "codex_native_provider_cycle" as const,
      events: buildCompletedLifecycle().events.map((event) =>
        event.kind === "observation.reentered"
          ? {
              ...event,
              observation_refs: ["paper:full-text:1", "poison:extra-observation"],
            }
          : event.kind === "tool.call.completed"
            ? {
                ...event,
                observation_refs: ["paper:full-text:1", "poison:extra-observation"],
              }
            : event,
      ),
    };

    const selected = readVerifiedHelixRuntimeLifecycleFromPayload({
      payload: {
        turn_lifecycle: canonicalLifecycle,
        native_provider_turn_lifecycle: nativeLifecycle,
      },
      turnId: canonicalLifecycle.turn_id,
    });

    expect(selected?.scope).toBe("helix_ask_turn");
    expect(selected?.reduction.observation_reentry_refs).toEqual([
      "paper:full-text:1",
    ]);
  });

  it("never promotes a debug-only lifecycle mirror to runtime authority", () => {
    const lifecycle = buildCompletedLifecycle();

    const selected = readVerifiedHelixRuntimeLifecycleFromPayload({
      payload: {
        debug: {
          turn_lifecycle: lifecycle,
          native_provider_turn_lifecycle: {
            ...lifecycle,
            scope: "codex_native_provider_cycle",
          },
        },
      },
      turnId: lifecycle.turn_id,
    });

    expect(selected).toBeNull();
  });

  it("exposes compatibility re-entry only as a diagnostic projection", () => {
    const resolution = resolveHelixRuntimeObservationReentry({
      payload: {},
      turnId: "ask:test:compatibility-only",
      candidateRefs: ["observation:compatibility-only"],
      compatibilityProjected: true,
    });

    expect(resolution).toEqual({
      authority: "compatibility_projection",
      runtime_lifecycle_verified: false,
      compatibility_projected: true,
      reentered: false,
      candidate_refs: ["observation:compatibility-only"],
      matched_reentry_refs: [],
      runtime_observation_reentry_refs: [],
    });
  });

  it("rejects a lifecycle whose event history fails recomputed integrity", () => {
    const lifecycle = buildCompletedLifecycle();
    const value = {
      ...lifecycle,
      events: lifecycle.events.filter((event) => event.kind !== "observation.reentered"),
      integrity: { ...lifecycle.integrity, ok: true, violations: [] },
    };

    expect(readVerifiedHelixTurnLifecycle({ turnId: lifecycle.turn_id, value })).toBeNull();
  });

  it("does not treat provider-cycle completion as global terminal authority", () => {
    const lifecycle = {
      ...buildCompletedLifecycle(),
      scope: "codex_native_provider_cycle" as const,
    };
    const audit = auditHelixTurnLifecycleProjection({
      lifecycle,
      projection: {
        evidence_reentry_completed: false,
        followup_reasoning_completed: false,
        terminal_error_code: "solver_continuation_pending",
      },
    });

    expect(audit.mismatches.map((mismatch) => mismatch.code)).toEqual([
      "legacy_evidence_reentry_disagrees_with_runtime",
      "legacy_followup_reasoning_disagrees_with_runtime",
    ]);
  });

  it("identifies legacy solver projections that contradict runtime facts", () => {
    const audit = auditHelixTurnLifecycleProjection({
      lifecycle: buildCompletedLifecycle(),
      projection: {
        evidence_reentry_completed: false,
        followup_reasoning_completed: false,
        provider_solver_completion_observed: true,
        terminal_error_code: "solver_continuation_pending",
        terminal_eligible: true,
        terminal_rejection_reason: null,
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.mismatches.map((mismatch) => mismatch.code)).toEqual([
      "legacy_evidence_reentry_disagrees_with_runtime",
      "legacy_followup_reasoning_disagrees_with_runtime",
      "continuation_pending_after_runtime_completion",
    ]);
  });

  it("flags a pending capability request projected as a terminal candidate", () => {
    const audit = auditHelixTurnLifecycleProjection({
      lifecycle: buildCompletedLifecycle(),
      projection: {
        provider_terminal_candidate_text:
          'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability_lane_call":{"capability":"scholarly-research.fetch_full_text","source_ref":"lookup:magnetar"}}',
      },
    });

    expect(audit).toMatchObject({
      ok: false,
      mismatches: [{
        code: "pending_lane_request_projected_as_terminal_candidate",
        projection_path: "provider_terminal_candidate.candidate_text_preview",
        lifecycle_value: "capability_lane_request",
        projection_value: "agent_provider_terminal_candidate",
      }],
    });
  });

  it("fails integrity when a completed turn never re-enters a tool observation", () => {
    const recorder = createHelixTurnLifecycleRecorder({ turnId: "ask:test:missing-reentry" });
    const started = recorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const admitted = recorder.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: started.event_id,
      capability_id: "scholarly.fetch_full_text",
    });
    const call = recorder.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: admitted.event_id,
      call_id: "call:missing-reentry",
      capability_id: "scholarly.fetch_full_text",
    });
    const completed = recorder.append({
      kind: "tool.call.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: call.event_id,
      call_id: "call:missing-reentry",
      capability_id: "scholarly.fetch_full_text",
      observation_refs: ["paper:missing-reentry"],
    });
    const message = recorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: completed.event_id,
      native_item_id: "agent-message:missing-reentry",
    });
    const runtime = recorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });
    const eligibility = recorder.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: runtime.event_id,
      terminal_eligible: true,
    });
    recorder.append({
      kind: "turn.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: eligibility.event_id,
      terminal_eligible: true,
    });

    const lifecycle = recorder.snapshot();
    expect(lifecycle.reduction.observation_reentry_refs).toEqual([]);
    expect(lifecycle.integrity.ok).toBe(false);
    expect(lifecycle.integrity.violations).toEqual([
      expect.objectContaining({
        code: "completed_tool_observation_not_reentered",
        call_id: "call:missing-reentry",
      }),
    ]);
  });

  it("rejects runtime completion recorded before the final agent message", () => {
    const recorder = createHelixTurnLifecycleRecorder({ turnId: "ask:test:completion-order" });
    const started = recorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const runtime = recorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: started.event_id,
    });
    const message = recorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: runtime.event_id,
      native_item_id: "agent-message:late",
    });
    const eligibility = recorder.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: message.event_id,
      terminal_eligible: true,
    });
    recorder.append({
      kind: "turn.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: eligibility.event_id,
      terminal_eligible: true,
    });

    const lifecycle = recorder.snapshot();
    expect(lifecycle.integrity.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "runtime_completion_without_prior_agent_message",
        event_id: runtime.event_id,
      }),
    ]));
    expect(readVerifiedHelixTurnLifecycle({
      turnId: lifecycle.turn_id,
      value: lifecycle,
    })).toBeNull();
  });

  it("rejects execution without prior capability admission", () => {
    const recorder = createHelixTurnLifecycleRecorder({ turnId: "ask:test:missing-admission" });
    const started = recorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    recorder.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: started.event_id,
      call_id: "call:unadmitted",
      capability_id: "visual_analysis.inspect_image_region",
    });

    expect(recorder.snapshot().integrity.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "tool_call_started_without_admission",
        call_id: "call:unadmitted",
      }),
    ]));
  });

  it("rejects re-entry under observation identities different from the tool result", () => {
    const recorder = createHelixTurnLifecycleRecorder({ turnId: "ask:test:ref-mismatch" });
    const started = recorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const admitted = recorder.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: started.event_id,
      capability_id: "scholarly-research.fetch_full_text",
    });
    const call = recorder.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: admitted.event_id,
      call_id: "call:paper",
      capability_id: "scholarly-research.fetch_full_text",
    });
    const completed = recorder.append({
      kind: "tool.call.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: call.event_id,
      call_id: "call:paper",
      capability_id: "scholarly-research.fetch_full_text",
      observation_refs: ["paper:expected"],
    });
    recorder.append({
      kind: "observation.reentered",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: completed.event_id,
      call_id: "call:paper",
      capability_id: "scholarly-research.fetch_full_text",
      observation_refs: ["paper:different"],
    });

    expect(recorder.snapshot().integrity.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "observation_reentry_ref_mismatch",
        call_id: "call:paper",
      }),
    ]));
  });
});

describe("Helix turn lifecycle differential audit", () => {
  const buildProviderProjectionPayload = () => {
    const lifecycle = buildCompletedLifecycle();
    const turnId = lifecycle.turn_id;
    const answerText =
      "The fresh observation supports the bounded Minecraft fireplace candidate.";
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:test`;
    const routeProductRef = `${candidateRef}:route_product:model_synthesized_answer`;
    const observationRef = "paper:full-text:1";
    const routeProduct = {
      schema: "helix.provider_route_product.v1",
      artifact_id: routeProductRef,
      turn_id: turnId,
      answer_text: answerText,
      text: answerText,
      support_refs: [observationRef],
      selected_observation_refs: [observationRef],
      provider_terminal_candidate_ref: candidateRef,
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      turn_lifecycle: lifecycle,
      canonical_goal_frame: {
        required_terminal_kind: "model_synthesized_answer",
      },
      route_evidence_authority: { terminal_product_allowed: true },
      provider_terminal_candidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        candidate_id: candidateRef,
        candidate_text: answerText,
        grounded_in_observation_refs: [observationRef],
        normalized_observation_refs: [observationRef],
        assistant_answer: false,
        raw_content_included: false,
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        provider_terminal_candidate_ref: candidateRef,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
      },
      provider_route_product_materialization: {
        schema: "helix.provider_route_product_materialization.v1",
        turn_id: turnId,
        provider_terminal_candidate_ref: candidateRef,
        materialized_terminal_artifact_kind: "model_synthesized_answer",
        materialized_terminal_artifact_ref: routeProductRef,
        selected_observation_refs: [observationRef],
        status: "materialized",
        assistant_answer: false,
        raw_content_included: false,
      },
      provider_route_product_quality_gate: {
        schema: "helix.final_answer_draft_quality_gate.v1",
        ok: true,
        violations: [],
      },
      model_synthesized_answer: routeProduct,
      current_turn_artifact_ledger: [
        {
          artifact_id: observationRef,
          kind: "provider_gateway_observation_packet",
          payload: { turn_id: turnId, status: "succeeded" },
        },
        {
          artifact_id: routeProductRef,
          kind: "model_synthesized_answer",
          payload: routeProduct,
        },
      ],
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        turn_id: turnId,
        selected_terminal_artifact_kind: "model_synthesized_answer",
        selected_terminal_artifact_ref: routeProductRef,
        selected_terminal_support_refs: [observationRef],
        visible_text: answerText,
        integrity: { single_writer_applied: true },
      },
      terminal_artifact_id: routeProductRef,
      selected_final_answer: answerText,
      answer: answerText,
      text: answerText,
    };
    return {
      payload,
      turnId,
      answerText,
      candidateRef,
      routeProductRef,
      observationRef,
    };
  };

  it("proves provider text and evidence continuity through the visible answer", () => {
    const fixture = buildProviderProjectionPayload();
    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit).toMatchObject({
      ok: true,
      first_divergence_stage: null,
      scientific_evidence_disposition: "passed",
      mismatches: [],
    });
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "provider_candidate_materialized",
          status: "passed",
        }),
        expect.objectContaining({
          check: "provider_candidate_text_preserved",
          status: "passed",
        }),
        expect.objectContaining({
          check: "materialized_text_preserved_by_terminal_writer",
          status: "passed",
        }),
        expect.objectContaining({
          check: "terminal_writer_text_preserved_in_visible_projection",
          status: "passed",
        }),
      ]),
    );
  });

  it("reports a provider observation that re-entered after a blocked tool call when the runtime log drops it", () => {
    const recorder = createHelixTurnLifecycleRecorder({
      turnId: "ask:test:blocked-reentry-projection",
      now: () => 100,
    });
    const started = recorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const rejectedCapability = recorder.append({
      kind: "capability.rejected",
      producer: "helix_policy",
      status: "blocked",
      causation_id: started.event_id,
      capability_id: "com.casimirbot.minecraft.command.catalog",
      reason_code: "wrong_environment",
    });
    const rejectedCall = recorder.append({
      kind: "tool.call.rejected",
      producer: "helix_policy",
      status: "blocked",
      causation_id: rejectedCapability.event_id,
      call_id: "call:minecraft-catalog",
      capability_id: "com.casimirbot.minecraft.command.catalog",
      observation_refs: ["observation:minecraft:wrong-environment"],
      reason_code: "wrong_environment",
    });
    const message = recorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: rejectedCall.event_id,
      message_sha256: "hash:blocked-observation-answer",
    });
    const runtime = recorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });
    const eligibility = recorder.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_terminal_authority",
      status: "succeeded",
      causation_id: runtime.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: true,
    });
    recorder.append({
      kind: "turn.failed",
      producer: "helix_adapter",
      status: "failed",
      causation_id: eligibility.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: true,
      reason_code: "wrong_environment",
    });

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      turnId: "ask:test:blocked-reentry-projection",
      payload: {
        turn_lifecycle: recorder.snapshot(),
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          observation_reentered: true,
          reentered_observation_refs: [
            "observation:minecraft:wrong-environment",
          ],
          evidence_reentered: false,
          provider_terminal_candidate_ref: "candidate:blocked-observation",
        },
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("evidence_reentry");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "provider_observation_reentry_disagrees_with_runtime",
    );
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "provider_observation_reentry",
          status: "failed",
          missing_support_refs: [
            "observation:minecraft:wrong-environment",
          ],
        }),
      ]),
    );
  });

  it("fails the audit when a capability lane records re-entry but provider and runtime projections drop it", () => {
    const turnId = "ask:test:lane-reentry-projection";
    const observationRef = "observation:minecraft:catalog-unavailable";
    const recorder = createHelixTurnLifecycleRecorder({
      turnId,
      now: () => 100,
    });
    const started = recorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const rejectedCapability = recorder.append({
      kind: "capability.rejected",
      producer: "helix_policy",
      status: "blocked",
      causation_id: started.event_id,
      capability_id: "com.casimirbot.minecraft.command.catalog",
      reason_code: "command_catalog_changed",
    });
    const rejectedCall = recorder.append({
      kind: "tool.call.rejected",
      producer: "helix_policy",
      status: "blocked",
      causation_id: rejectedCapability.event_id,
      call_id: "call:minecraft-catalog",
      capability_id: "com.casimirbot.minecraft.command.catalog",
      observation_refs: [observationRef],
      reason_code: "command_catalog_changed",
    });
    const message = recorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: rejectedCall.event_id,
      message_sha256: "hash:catalog-unavailable",
    });
    recorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      turnId,
      payload: {
        turn_lifecycle: recorder.snapshot(),
        capability_lane_turn_timeline: [
          {
            schema: "helix.capability_lane.provider_timeline_event.v1",
            stage: "lane_reentered",
            observation_reentered: true,
            observation_ref: observationRef,
          },
        ],
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          observation_reentered: false,
          reentered_observation_refs: [],
          evidence_reentered: false,
          provider_terminal_candidate_ref: null,
        },
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("evidence_reentry");
    expect(audit.mismatches.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "capability_lane_reentry_disagrees_with_provider",
        "capability_lane_reentry_disagrees_with_runtime",
      ]),
    );
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "capability_lane_observation_reentry",
          status: "failed",
          missing_support_refs: [observationRef],
        }),
      ]),
    );
  });

  it("finds the first adapter contradiction when execution regresses at observation re-entry", () => {
    const fixture = buildProviderProjectionPayload();
    fixture.payload.capability_lane_turn_timeline = [
      {
        schema: "helix.capability_lane.provider_timeline_event.v1",
        stage: "lane_observation",
        lane_executed: true,
        observation_reentered: false,
        observation_ref: fixture.observationRef,
      },
      {
        schema: "helix.capability_lane.provider_timeline_event.v1",
        stage: "lane_reentered",
        lane_executed: false,
        observation_reentered: true,
        observation_ref: fixture.observationRef,
      },
    ];
    fixture.payload.provider_reasoning_reentry = {
      schema: "helix.provider_reasoning_reentry.v1",
      observation_reentered: true,
      reentered_observation_refs: [fixture.observationRef],
      evidence_reentered: true,
      provider_terminal_candidate_ref: fixture.candidateRef,
    };

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("evidence_reentry");
    expect(audit.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "capability_lane_execution_regressed_at_reentry",
          projection_value: false,
        }),
      ]),
    );
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "capability_lane_execution_continuity",
          status: "failed",
          missing_support_refs: [fixture.observationRef],
        }),
      ]),
    );
  });

  it("refreshes an early writer audit after the canonical runtime lifecycle is attached", () => {
    const fixture = buildProviderProjectionPayload();
    const lifecycle = fixture.payload.turn_lifecycle;
    delete fixture.payload.turn_lifecycle;

    const early = refreshHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });
    expect(early.continuity_checks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "runtime_observation_reentry",
          status: "passed",
        }),
      ]),
    );

    fixture.payload.turn_lifecycle = lifecycle;
    const refreshed = refreshHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });
    expect(refreshed.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "runtime_observation_reentry",
          status: "passed",
        }),
        expect.objectContaining({
          check: "runtime_followup_reasoning",
          status: "passed",
        }),
      ]),
    );
    expect(
      (fixture.payload.terminal_authority_single_writer as Record<string, any>)
        .integrity.lifecycle_differential_audit,
    ).toEqual(refreshed);
  });

  it("locates the old fireplace failure at downstream materialization", () => {
    const fixture = buildProviderProjectionPayload();
    delete fixture.payload.provider_route_product_materialization;
    delete fixture.payload.model_synthesized_answer;
    fixture.payload.terminal_authority_single_writer = {
      schema: "helix.terminal_authority_single_writer_result.v1",
      turn_id: fixture.turnId,
      selected_terminal_artifact_kind: "typed_failure",
      selected_terminal_artifact_ref: `${fixture.turnId}:typed_failure`,
      selected_terminal_support_refs: [],
      visible_text: "The lifecycle was incorrectly classified as not executed.",
      integrity: { single_writer_applied: true },
    };
    fixture.payload.selected_final_answer =
      "The lifecycle was incorrectly classified as not executed.";

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("terminal_materialization");
    expect(audit.mismatches.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "authorized_provider_candidate_not_materialized",
        "typed_failure_selected_after_authorized_provider_candidate",
      ]),
    );
  });

  it("preserves a scientific evidence rejection as an explicit fail-closed boundary", () => {
    const fixture = buildProviderProjectionPayload();
    delete fixture.payload.provider_route_product_materialization;
    delete fixture.payload.model_synthesized_answer;
    fixture.payload.provider_route_product_quality_gate = {
      schema: "helix.final_answer_draft_quality_gate.v1",
      ok: false,
      violations: ["invalid_page_evidence_links"],
    };
    fixture.payload.provider_route_product_materialization_diagnostic = {
      quality_gate_ok: false,
      quality_gate_violations: ["invalid_page_evidence_links"],
    };
    fixture.payload.terminal_authority_single_writer = {
      schema: "helix.terminal_authority_single_writer_result.v1",
      turn_id: fixture.turnId,
      selected_terminal_artifact_kind: "typed_failure",
      selected_terminal_artifact_ref: `${fixture.turnId}:typed_failure`,
      selected_terminal_support_refs: [],
      visible_text: "The evidence link failed validation.",
      integrity: { single_writer_applied: true },
    };
    fixture.payload.selected_final_answer =
      "The evidence link failed validation.";

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(true);
    expect(audit.first_divergence_stage).toBeNull();
    expect(audit.scientific_evidence_disposition).toBe("failed_closed");
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "evidence_quality_gate",
          status: "failed_closed",
          disposition: "hard_evidence_boundary",
          reason_codes: ["invalid_page_evidence_links"],
        }),
      ]),
    );
  });

  it("keeps a repairable answer-quality rejection in Codex dialogue instead of calling it a hard scientific boundary", () => {
    const fixture = buildProviderProjectionPayload();
    delete fixture.payload.provider_route_product_materialization;
    delete fixture.payload.model_synthesized_answer;
    fixture.payload.provider_route_product_quality_gate = {
      schema: "helix.final_answer_draft_quality_gate.v1",
      ok: false,
      violations: ["invalid_page_evidence_links"],
    };
    fixture.payload.provider_route_product_materialization_diagnostic = {
      quality_gate_ok: false,
      quality_gate_violations: ["invalid_page_evidence_links"],
      quality_gate_rejection_classification: "recoverable_synthesis_rejection",
    };
    fixture.payload.terminal_rejection_observations = [
      {
        schema: "helix.terminal_rejection_observation.v1",
        turn_id: fixture.turnId,
        observation_id: `${fixture.turnId}:terminal_rejection_observation:quality`,
        rejected_candidate_kind: "model_synthesized_answer",
        rejected_candidate_ref: fixture.routeProductRef,
        rejection_reason: "route_requires_synthesis",
        gate: "provider_route_product_quality_gate",
        reason_codes: ["invalid_page_evidence_links"],
        evidence_refs: [fixture.observationRef],
        recoverable: true,
        failure_class: "terminal_authority",
        retryability: "retryable",
        next_affordances: [],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ];
    fixture.payload.agent_continuation_state = {
      schema: "helix.agent_continuation_state.v1",
      allowed_decisions: ["retry"],
      budget: { hard: { exhausted: false } },
    };
    fixture.payload.terminal_authority_single_writer = {
      schema: "helix.terminal_authority_single_writer_result.v1",
      turn_id: fixture.turnId,
      selected_terminal_artifact_kind: "typed_failure",
      selected_terminal_artifact_ref: `${fixture.turnId}:typed_failure`,
      selected_terminal_support_refs: [],
      visible_text: "The first synthesis needs evidence-link repair.",
      integrity: { single_writer_applied: true },
    };
    fixture.payload.selected_final_answer =
      "The first synthesis needs evidence-link repair.";

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("followup_reasoning");
    expect(audit.scientific_evidence_disposition).toBe("repair_pending");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "recoverable_rejection_terminalized_before_reentry",
    );
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "evidence_quality_gate",
          status: "failed",
          disposition: "informational",
          reason_codes: ["invalid_page_evidence_links"],
        }),
        expect.objectContaining({
          check: "recoverable_rejection_reentered",
          status: "failed",
          disposition: "adapter_projection_contradiction",
        }),
      ]),
    );
  });

  it("detects changed candidate text without exporting the raw answer", () => {
    const fixture = buildProviderProjectionPayload();
    const routeProduct = fixture.payload
      .model_synthesized_answer as Record<string, unknown>;
    routeProduct.answer_text = "A deterministic rail substituted different text.";
    routeProduct.text = "A deterministic rail substituted different text.";
    const writer = fixture.payload
      .terminal_authority_single_writer as Record<string, unknown>;
    writer.visible_text = "A deterministic rail substituted different text.";
    fixture.payload.selected_final_answer =
      "A deterministic rail substituted different text.";

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "provider_candidate_text_changed_during_materialization",
    );
    expect(JSON.stringify(audit)).not.toContain(fixture.answerText);
    expect(JSON.stringify(audit)).not.toContain(
      "A deterministic rail substituted different text.",
    );
  });

  it("detects support references dropped after materialization", () => {
    const fixture = buildProviderProjectionPayload();
    const writer = fixture.payload
      .terminal_authority_single_writer as Record<string, unknown>;
    writer.selected_terminal_support_refs = [];

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "materialized_evidence_refs_dropped_by_terminal_writer",
    );
    expect(audit.first_divergence_stage).toBe("terminal_authority");
  });

  it("locates duplicate physical execution before evidence re-entry or terminal materialization", () => {
    const fixture = buildProviderProjectionPayload();
    fixture.payload.question =
      'Run exactly one command in the paired Minecraft Fabric environment. Use com.casimirbot.minecraft.command with command "time query daytime", category "query", and effect "read_only". Do not run any other command or tool.';
    const commandResult = (callId: string, executionRef: string) => ({
      ok: true,
      capability_id: "com.casimirbot.minecraft.command",
      gateway_admission: {
        requested_capability: "com.casimirbot.minecraft.command",
      },
      observation_packet: { call_id: callId },
      observation: {
        command_execution_ref: executionRef,
        command_hash: `sha256:${"a".repeat(64)}`,
      },
    });
    fixture.payload.workstation_gateway_call_results = [
      commandResult("call:command:1", "command_execution:1"),
      commandResult("call:command:2", "command_execution:2"),
      {
        ok: true,
        capability_id: "com.casimirbot.minecraft.command.catalog",
        gateway_admission: {
          requested_capability: "com.casimirbot.minecraft.command.catalog",
        },
        observation_packet: { call_id: "call:catalog:1" },
        observation: {},
      },
    ];

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("tool_execution");
    expect(audit.mismatches.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "exact_tool_cardinality_violated",
        "forbidden_extra_tool_executed",
      ]),
    );
  });

  it("reports executable runtime artifacts under a record-only admission", () => {
    const fixture = buildProviderProjectionPayload();
    fixture.payload.agent_runtime_loop_admission = {
      schema: "helix.agent_runtime_loop_admission.v1",
      turn_id: fixture.turnId,
      admitted: true,
      mode: "record_only",
      reason:
        "source_or_capability_terminal_failure_requires_runtime_loop_record",
      assistant_answer: false,
      raw_content_included: false,
    };
    (fixture.payload.current_turn_artifact_ledger as unknown[]).push({
      artifact_id: `${fixture.turnId}:runtime_tool_call:unexpected`,
      kind: "runtime_tool_call",
      payload: { capability_id: "repo-code.search_concept" },
    });

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("tool_execution");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "record_only_admission_executed_runtime_steps",
    );
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "record_only_admission_did_not_execute",
          status: "failed",
          observed_support_ref_count: 1,
        }),
      ]),
    );
  });

  it("treats an idempotent command replay as one physical execution", () => {
    const fixture = buildProviderProjectionPayload();
    fixture.payload.question =
      'Run exactly one command in the paired Minecraft Fabric environment. Use com.casimirbot.minecraft.command with command "time query daytime", category "query", and effect "read_only". Do not run any other command or tool.';
    fixture.payload.workstation_gateway_call_results = [1, 2].map((ordinal) => ({
      ok: true,
      capability_id: "com.casimirbot.minecraft.command",
      gateway_admission: {
        requested_capability: "com.casimirbot.minecraft.command",
      },
      observation_packet: {
        call_id: `call:command:${ordinal}`,
        executed_args: {
          idempotent_replay: ordinal === 2,
          physical_execution_performed: ordinal === 1,
        },
      },
      observation: {
        command_execution_ref: "command_execution:stable",
        command_hash: `sha256:${"a".repeat(64)}`,
      },
    }));

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(true);
    expect(audit.continuity_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "requested_tool_cardinality",
          status: "passed",
          expected_support_ref_count: 1,
          observed_support_ref_count: 1,
        }),
      ]),
    );
  });

  it("reports even a failed helper attempt outside an exclusive command contract", () => {
    const fixture = buildProviderProjectionPayload();
    fixture.payload.question =
      'Ignite the surveyed hearth in my paired Minecraft Fabric world. Run exactly one command: use com.casimirbot.minecraft.command with command "setblock -50 68 -2 minecraft:fire", category "world_build", and effect "world_mutation". Do not run any other command or tool.';
    fixture.payload.workstation_gateway_call_results = [
      {
        ok: true,
        capability_id: "com.casimirbot.minecraft.command",
        gateway_admission: {
          requested_capability: "com.casimirbot.minecraft.command",
        },
        observation_packet: { call_id: "call:command:exclusive" },
        observation: {
          command_execution_ref: "command_execution:exclusive",
          command_hash: `sha256:${"b".repeat(64)}`,
        },
      },
      {
        ok: false,
        capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
        gateway_admission: {
          requested_capability:
            "com.casimirbot.minecraft.spatial_region.inspect",
        },
        typed_failure: { code: "producer_epoch_mismatch" },
      },
    ];

    const audit = buildHelixTurnLifecycleDifferentialAudit({
      payload: fixture.payload,
      turnId: fixture.turnId,
    });

    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("tool_execution");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "forbidden_extra_tool_executed",
    );
  });
});
