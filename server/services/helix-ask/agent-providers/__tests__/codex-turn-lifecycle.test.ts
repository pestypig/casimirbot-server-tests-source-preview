import { describe, expect, it } from "vitest";
import { buildCodexProviderTurnLifecycle } from "../codex-turn-lifecycle";
import { createHelixTurnLifecycleRecorder } from "../../runtime/turn-lifecycle";

const gatewayResult = (capabilityId: string, index: number) => ({
  ok: true,
  capability_id: capabilityId,
  gateway_admission: {
    requested_capability: capabilityId,
    admission_status: "admitted",
  },
  tool_lifecycle_trace: {
    tool_call_id: `call:${index}`,
    observation_refs: [`observation:${index}`],
  },
  observation_packet: {
    produced_artifact_refs: [`artifact:${index}`],
  },
  artifact_refs: [],
}) as any;

describe("Codex provider outer turn lifecycle", () => {
  it("preserves the provider candidate identity when Helix later presents a typed failure", () => {
    const providerMessageSha256 = "a".repeat(64);
    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:provider-message-identity",
      gatewayCallResults: [],
      providerReasoningReentry: {
        observation_reentered: false,
        evidence_reentered: false,
      },
      providerText: "A later Helix typed-failure presentation.",
      providerMessageSha256,
      terminalArtifactKind: "typed_failure",
      terminalEligible: true,
      ok: false,
    });

    expect(
      lifecycle.events.find(
        (event) => event.kind === "agent.message.completed",
      )?.message_sha256,
    ).toBe(providerMessageSha256);
  });

  it("materializes runtime facts before terminal authority without inventing a terminal outcome", () => {
    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:pre-terminal",
      routeCommitId: "route:test",
      gatewayCallResults: [],
      providerReasoningReentry: {
        observation_reentered: false,
        evidence_reentered: false,
      },
      providerText: "A provider-authored candidate.",
      terminalArtifactKind: null,
      terminalEligible: false,
      ok: false,
      settleTerminal: false,
    });

    expect(lifecycle.reduction).toMatchObject({
      runtime_turn_completed: true,
      final_agent_message_event_id: expect.any(String),
      terminal_eligibility_event_id: null,
      terminal_outcome: null,
      terminal_event_count: 0,
      complete: false,
    });
    expect(lifecycle.integrity).toMatchObject({ ok: true, violations: [] });
  });

  it("records compatibility gateway calls, re-entry, reasoning, and terminal completion", () => {
    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:compatibility-lifecycle",
      routeCommitId: "route:test:scholarly",
      gatewayCallResults: [
        gatewayResult("scholarly-research.lookup_papers", 1),
        gatewayResult("scholarly-research.fetch_full_text", 2),
      ],
      providerReasoningReentry: {
        evidence_reentered: true,
        input_observation_refs: [
          "observation:1",
          "artifact:1",
          "observation:2",
          "artifact:2",
        ],
      },
      providerText: "Selected one paper from the fetched full text.",
      terminalArtifactKind: "scholarly_research_answer",
      terminalEligible: true,
      ok: true,
    });

    expect(lifecycle).toMatchObject({
      scope: "helix_ask_turn",
      reduction: {
        route_commit_id: "route:test:scholarly",
        admitted_capability_ids: [
          "scholarly-research.lookup_papers",
          "scholarly-research.fetch_full_text",
        ],
        observation_reentry_refs: expect.arrayContaining([
          "observation:1",
          "observation:2",
        ]),
        post_observation_reasoning_completed: true,
        runtime_turn_completed: true,
        terminal_outcome: "completed",
        complete: true,
      },
      integrity: { ok: true, violations: [] },
    });
    expect(lifecycle.events.map((event) => event.kind)).toEqual([
      "turn.started",
      "route.committed",
      "capability.admitted",
      "tool.call.started",
      "tool.call.completed",
      "observation.reentered",
      "capability.admitted",
      "tool.call.started",
      "tool.call.completed",
      "observation.reentered",
      "agent.message.completed",
      "runtime.turn.completed",
      "terminal.eligibility.checked",
      "turn.completed",
    ]);
  });

  it("records model-requested capability-lane observations in the same lifecycle", () => {
    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:capability-lane-lifecycle",
      routeCommitId: "route:test:image-lens",
      gatewayCallResults: [],
      capabilityLaneObservationPackets: [{
        turn_id: "ask:test:capability-lane-lifecycle",
        call_id: "call:image-lens:1",
        decision_id: "decision:image-lens:1",
        capability_key: "visual_analysis.inspect_image_region",
        status: "succeeded",
        produced_artifact_refs: ["artifact:image-lens:page-2"],
      } as any],
      providerReasoningReentry: {
        evidence_reentered: true,
        input_observation_refs: ["artifact:image-lens:page-2"],
      },
      providerText: "The observed page contains a usable field-strength equation.",
      terminalArtifactKind: "agent_provider_terminal_candidate",
      terminalEligible: true,
      ok: true,
    });

    expect(lifecycle.reduction).toMatchObject({
      admitted_capability_ids: ["visual_analysis.inspect_image_region"],
      observation_reentry_refs: ["artifact:image-lens:page-2"],
      post_observation_reasoning_completed: true,
      complete: true,
    });
    expect(lifecycle.integrity).toEqual(expect.objectContaining({ ok: true }));
  });

  it("records a delegated lane gateway call once when both projections are present", () => {
    const delegated = gatewayResult("helix_ask.reflect_theory_context", 1);
    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:delegated-lane-lifecycle",
      routeCommitId: "route:test:theory",
      gatewayCallResults: [delegated],
      capabilityLaneObservationPackets: [{
        turn_id: "ask:test:delegated-lane-lifecycle",
        call_id: "call:1",
        decision_id: "decision:theory:1",
        capability_key: "helix_ask.reflect_theory_context",
        status: "succeeded",
        produced_artifact_refs: ["artifact:theory:1"],
      } as any],
      providerReasoningReentry: {
        evidence_reentered: true,
        input_observation_refs: ["observation:1", "artifact:1", "artifact:theory:1"],
      },
      providerText: "The graph has no exact match; the mechanism remains unresolved.",
      terminalArtifactKind: "agent_provider_terminal_candidate",
      terminalEligible: true,
      ok: true,
    });

    expect(lifecycle.reduction.tool_calls).toHaveLength(1);
    expect(lifecycle.reduction.tool_calls[0]).toMatchObject({
      call_id: "call:1",
      reentered: true,
      observation_refs: expect.arrayContaining([
        "observation:1",
        "artifact:1",
        "artifact:theory:1",
      ]),
    });
    expect(lifecycle.integrity).toEqual(expect.objectContaining({ ok: true }));
  });

  it("does not project a global re-entry flag onto an unmatched tool call", () => {
    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:partial-reentry",
      routeCommitId: "route:test:partial-reentry",
      gatewayCallResults: [
        gatewayResult("scholarly-research.lookup_papers", 1),
        gatewayResult("scholarly-research.fetch_full_text", 2),
      ],
      providerReasoningReentry: {
        evidence_reentered: true,
        input_observation_refs: ["observation:1", "artifact:1"],
      },
      providerText: "I only observed the lookup result.",
      terminalArtifactKind: "scholarly_research_answer",
      terminalEligible: true,
      ok: true,
    });

    expect(lifecycle.reduction.tool_calls).toEqual([
      expect.objectContaining({ call_id: "call:1", reentered: true }),
      expect.objectContaining({ call_id: "call:2", reentered: false }),
    ]);
    expect(lifecycle.integrity).toMatchObject({
      ok: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: "completed_tool_observation_not_reentered",
          call_id: "call:2",
        }),
      ]),
    });
  });

  it("records blocked gateway admission as rejection rather than admitted execution", () => {
    const blocked = gatewayResult("visual_analysis.inspect_image_region", 1);
    blocked.ok = false;
    blocked.gateway_admission.admission_status = "blocked";
    blocked.gateway_admission.blocked_reason = "active_image_lens_source_missing";

    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:blocked-admission",
      routeCommitId: "route:test:image-lens",
      gatewayCallResults: [blocked],
      providerReasoningReentry: { evidence_reentered: false },
      providerText: "The active image source is unavailable.",
      terminalArtifactKind: "typed_failure",
      terminalEligible: true,
      ok: false,
      terminalReasonCode: "active_image_lens_source_missing",
    });

    expect(lifecycle.reduction.admitted_capability_ids).toEqual([]);
    expect(lifecycle.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "capability.rejected",
      "tool.call.rejected",
      "turn.failed",
    ]));
    expect(lifecycle.events.map((event) => event.kind)).not.toContain("tool.call.started");
  });

  it("records a blocked observation re-entering Codex without recasting it as successful execution", () => {
    const blocked = gatewayResult("com.casimirbot.minecraft.command.catalog", 1);
    blocked.ok = false;
    blocked.gateway_admission.admission_status = "blocked";
    blocked.gateway_admission.blocked_reason = "wrong_environment";

    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId: "ask:test:blocked-observation-reentry",
      routeCommitId: "route:test:minecraft",
      gatewayCallResults: [blocked],
      providerReasoningReentry: {
        observation_reentered: true,
        reentered_observation_refs: ["observation:1", "artifact:1"],
        evidence_reentered: false,
      },
      providerText:
        "The catalog request was blocked because its label did not resolve to the active environment.",
      terminalArtifactKind: "typed_failure",
      terminalEligible: true,
      ok: false,
      terminalReasonCode: "wrong_environment",
    });

    expect(lifecycle.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "capability.rejected",
        "tool.call.rejected",
        "observation.reentered",
        "agent.message.completed",
      ]),
    );
    expect(lifecycle.events.map((event) => event.kind)).not.toContain(
      "tool.call.started",
    );
    expect(lifecycle.reduction.tool_calls[0]).toMatchObject({
      completion_kind: "tool.call.rejected",
      reentered: true,
      reentry_observation_refs: expect.arrayContaining([
        "observation:1",
        "artifact:1",
      ]),
    });
    expect(lifecycle.integrity).toMatchObject({ ok: true, violations: [] });
  });

  it("continues the native fact stream instead of rebuilding it from poisoned projections", () => {
    const turnId = "ask:test:native-lifecycle-continuity";
    const native = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "codex_native_provider_cycle",
      now: () => 100,
    });
    const started = native.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const route = native.append({
      kind: "route.committed",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: started.event_id,
      route_commit_id: "route:native",
      capability_ids: ["com.casimirbot.minecraft.player.observe"],
    });
    const admitted = native.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: route.event_id,
      route_commit_id: "route:native",
      capability_id: "com.casimirbot.minecraft.player.observe",
    });
    const call = native.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: admitted.event_id,
      route_commit_id: "route:native",
      call_id: "call:native",
      capability_id: "com.casimirbot.minecraft.player.observe",
    });
    const completed = native.append({
      kind: "tool.call.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: call.event_id,
      route_commit_id: "route:native",
      call_id: "call:native",
      capability_id: "com.casimirbot.minecraft.player.observe",
      observation_refs: ["observation:native:1"],
    });
    const reentered = native.append({
      kind: "observation.reentered",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: completed.event_id,
      route_commit_id: "route:native",
      call_id: "call:native",
      capability_id: "com.casimirbot.minecraft.player.observe",
      observation_refs: ["observation:native:1"],
    });
    const message = native.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: reentered.event_id,
      message_sha256: "native-message-hash",
    });
    const runtime = native.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });
    const nativeEligibility = native.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: runtime.event_id,
      terminal_kind: "agent_provider_terminal_candidate",
      terminal_eligible: true,
    });
    native.append({
      kind: "turn.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: nativeEligibility.event_id,
      terminal_kind: "agent_provider_terminal_candidate",
      terminal_eligible: true,
    });

    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId,
      gatewayCallResults: [],
      providerReasoningReentry: {
        evidence_reentered: false,
        solver_completed: false,
        normalized_observation_refs: ["observation:poisoned"],
      },
      providerText: "The current observation supports the answer.",
      terminalArtifactKind: "model_synthesized_answer",
      terminalEligible: true,
      ok: true,
      nativeProviderLifecycle: native.snapshot(),
    });

    expect(lifecycle.scope).toBe("helix_ask_turn");
    expect(lifecycle.reduction.observation_reentry_refs).toEqual([
      "observation:native:1",
    ]);
    expect(lifecycle.reduction.runtime_turn_completed).toBe(true);
    expect(lifecycle.reduction.terminal_outcome).toBe("completed");
    expect(
      lifecycle.events.filter(
        (event) => event.kind === "terminal.eligibility.checked",
      ),
    ).toHaveLength(1);
    expect(lifecycle.events.at(-2)?.producer).toBe(
      "helix_terminal_authority",
    );
    expect(lifecycle.integrity).toMatchObject({ ok: true, violations: [] });
  });

  it("merges compatibility continuation facts after an earlier native provider cycle completed", () => {
    const turnId = "ask:test:native-cycle-then-gateway-continuation";
    const native = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "codex_native_provider_cycle",
      now: () => 100,
    });
    const started = native.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const earlyMessage = native.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: started.event_id,
      message_sha256: "early-tool-request-marker",
    });
    native.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: earlyMessage.event_id,
    });

    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId,
      routeCommitId: "route:bound-room-report",
      gatewayCallResults: [gatewayResult("room.evidence.read_bound", 1)],
      providerReasoningReentry: {
        observation_reentered: true,
        reentered_observation_refs: ["observation:1", "artifact:1"],
      },
      providerText: "The canonical durable goal completed.",
      terminalArtifactKind: "model_synthesized_answer",
      terminalEligible: true,
      ok: true,
      nativeProviderLifecycle: native.snapshot(),
    });

    expect(lifecycle.events.map((event) => event.kind)).toEqual([
      "turn.started",
      "route.committed",
      "capability.admitted",
      "tool.call.started",
      "tool.call.completed",
      "observation.reentered",
      "agent.message.completed",
      "runtime.turn.completed",
      "terminal.eligibility.checked",
      "turn.completed",
    ]);
    expect(lifecycle.reduction).toMatchObject({
      observation_reentry_refs: expect.arrayContaining([
        "observation:1",
        "artifact:1",
      ]),
      post_observation_reasoning_completed: true,
      terminal_outcome: "completed",
      complete: true,
    });
    expect(lifecycle.integrity).toMatchObject({ ok: true, violations: [] });
  });

  it("preserves a failed native attempt and records a strictly later compatibility recovery", () => {
    const turnId = "ask:test:native-failure-compatibility-recovery";
    const native = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "codex_native_provider_cycle",
      now: () => 100,
    });
    const started = native.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const nativeFailure = native.append({
      kind: "runtime.turn.failed",
      producer: "codex_runtime",
      status: "failed",
      causation_id: started.event_id,
      reason_code: "provider_quota_exhausted",
    });
    const nativeEligibility = native.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_policy",
      status: "blocked",
      causation_id: nativeFailure.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: false,
      reason_code: "provider_quota_exhausted",
    });
    native.append({
      kind: "turn.failed",
      producer: "helix_adapter",
      status: "failed",
      causation_id: nativeEligibility.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: false,
      reason_code: "provider_quota_exhausted",
    });

    const lifecycle = buildCodexProviderTurnLifecycle({
      turnId,
      routeCommitId: "route:compatibility-recovery",
      gatewayCallResults: [gatewayResult("docs.search", 1)],
      providerReasoningReentry: {
        evidence_reentered: true,
        input_observation_refs: ["observation:1", "artifact:1"],
      },
      providerText: "The recovered Docs observation supports the answer.",
      terminalArtifactKind: "model_synthesized_answer",
      terminalEligible: true,
      ok: true,
      nativeProviderLifecycle: native.snapshot(),
    });

    expect(lifecycle.events.map((event) => event.kind)).toEqual([
      "turn.started",
      "runtime.turn.failed",
      "route.committed",
      "capability.admitted",
      "tool.call.started",
      "tool.call.completed",
      "observation.reentered",
      "agent.message.completed",
      "runtime.turn.completed",
      "terminal.eligibility.checked",
      "turn.completed",
    ]);
    expect(lifecycle.reduction).toMatchObject({
      observation_reentry_refs: expect.arrayContaining([
        "observation:1",
        "artifact:1",
      ]),
      runtime_turn_completed: true,
      post_observation_reasoning_completed: true,
      terminal_outcome: "completed",
      complete: true,
    });
    expect(lifecycle.integrity).toMatchObject({ ok: true, violations: [] });
  });
});
