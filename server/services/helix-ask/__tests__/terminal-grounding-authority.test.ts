import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildHelixTerminalGroundingAuthority } from "../terminal-grounding-authority";

const terminalPayload = (input: {
  turnId?: string;
  answer?: string;
  groundingRequired?: boolean;
  evidenceRefs?: string[];
}) => {
  const turnId = input.turnId ?? "ask:grounding:1";
  const answer = input.answer ?? "The canonical answer.";
  const groundingRequired = input.groundingRequired ?? false;
  const evidenceRefs = input.evidenceRefs ?? [];
  const terminalArtifactRef = `${turnId}:model_synthesized_answer:1`;
  const terminalTextHash = crypto
    .createHash("sha256")
    .update(answer)
    .digest("hex");
  return {
    turn_id: turnId,
    selected_final_answer: answer,
    final_answer_source: "final_answer_draft",
    terminal_artifact_kind: "model_synthesized_answer",
    selected_terminal_support_refs: evidenceRefs,
    terminal_synthesis_support_refs: evidenceRefs,
    terminal_answer_authority: {
      turn_id: turnId,
      terminal_artifact_ref: terminalArtifactRef,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_text_hash: terminalTextHash,
      server_authoritative: true,
      terminal_eligible: true,
    },
    terminal_presentation: {
      turn_id: turnId,
      terminal_authority_ref: terminalArtifactRef,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      concise_text: answer,
      selected_observation_refs: evidenceRefs,
      support_refs: evidenceRefs,
    },
    ask_turn_procedure_trace: {
      turn_id: turnId,
      selected_terminal_product: {
        kind: "model_synthesized_answer",
        ref: terminalArtifactRef,
        allowed_by_route: true,
      },
    },
    ask_turn_solver_trace: {
      turn_id: turnId,
      completed_solver_path: true,
      route_authority_ok: true,
      poison_audit_ok: true,
      terminal_authority_ok: true,
      evidence_reentry_gate: {
        schema: "helix.evidence_reentry_gate.v1",
        turn_id: turnId,
        required: groundingRequired,
        completed: true,
        reentry_authority: groundingRequired
          ? "runtime_event_log"
          : "compatibility_projection",
        runtime_lifecycle_verified: groundingRequired,
        selected_evidence_refs: evidenceRefs,
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        current_turn_only: true,
        admitted_tools: groundingRequired
          ? [{ capability_id: "docs.search", family: "docs" }]
          : [{ capability_id: "model_only", family: "model_only" }],
        supporting_evidence_refs: evidenceRefs,
        terminal_product_allowed: true,
      },
      final_arbitration: {
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
      },
    },
    solver_artifact_reentry_audit: {
      schema: "helix.solver_artifact_reentry_audit.v1",
      turn_id: turnId,
      ok: true,
      terminal_relevant_artifacts: evidenceRefs.map((ref) => ({
        ref,
        selected_as_support: true,
        reentered_solver: true,
      })),
    },
    poison_audit: {
      turn_id: turnId,
      ok: true,
    },
  };
};

describe("terminal grounding authority", () => {
  it("marks a completed model-direct terminal as not requiring grounding", () => {
    const authority = buildHelixTerminalGroundingAuthority({
      payload: terminalPayload({ groundingRequired: false }),
    });

    expect(authority).toMatchObject({
      schema: "helix.terminal_grounding_authority.v1",
      status: "not_required",
      grounding_required: false,
      completed_solver_path: true,
      route_authority_ok: true,
      poison_audit_ok: true,
      terminal_authority_ok: true,
      selected_evidence_refs: [],
      failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("accepts a completed model-only route when the compatibility payload omits the reentry gate", () => {
    const payload = terminalPayload({ groundingRequired: false });
    delete (payload.ask_turn_solver_trace as Record<string, unknown>).evidence_reentry_gate;

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority).toMatchObject({
      status: "not_required",
      grounding_required: false,
      selected_evidence_refs: [],
      failure_code: null,
    });
  });

  it("rejects a model-only route that selects tool evidence without a reentry declaration", () => {
    const evidenceRef = "ask:grounding:1:observation:docs:1";
    const payload = terminalPayload({
      groundingRequired: false,
      evidenceRefs: [evidenceRef],
    });
    delete (payload.ask_turn_solver_trace as Record<string, unknown>).evidence_reentry_gate;

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toContain("grounding_mode_ambiguous");
  });

  it("does not mistake model-only lifecycle artifacts for grounding evidence", () => {
    const payload = terminalPayload({ groundingRequired: false });
    delete (payload.ask_turn_solver_trace as Record<string, unknown>).evidence_reentry_gate;
    payload.ask_turn_solver_trace.route_evidence_authority.supporting_evidence_refs = [
      "ask:grounding:1:agent_continuation_state:1",
      "ask:grounding:1:provider_terminal_authority_bridge:initial",
      "ask:grounding:1:runtime_intent_packet",
    ];

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority).toMatchObject({
      status: "not_required",
      grounding_required: false,
      failure_code: null,
    });
  });

  it("validates current-turn selected evidence without knowing the tool", () => {
    const evidenceRef = "ask:grounding:1:observation:docs:1";
    const authority = buildHelixTerminalGroundingAuthority({
      payload: terminalPayload({
        groundingRequired: true,
        evidenceRefs: [evidenceRef],
      }),
    });

    expect(authority).toMatchObject({
      status: "validated",
      grounding_required: true,
      selected_evidence_refs: [evidenceRef],
      evidence_reentry_authority: "runtime_event_log",
      runtime_lifecycle_verified: true,
      current_turn_only: true,
      support_coverage_complete: true,
      failure_code: null,
    });
  });

  it("rejects compatibility-only re-entry for a grounded terminal", () => {
    const evidenceRef = "ask:grounding:1:observation:docs:compatibility";
    const payload = terminalPayload({
      groundingRequired: true,
      evidenceRefs: [evidenceRef],
    });
    payload.ask_turn_solver_trace.evidence_reentry_gate = {
      ...payload.ask_turn_solver_trace.evidence_reentry_gate,
      reentry_authority: "compatibility_projection",
      runtime_lifecycle_verified: false,
    };
    payload.ask_turn_procedure_trace = {
      ...payload.ask_turn_procedure_trace,
      evidence_reentry_status: "reentered",
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toContain(
      "evidence_reentry_not_completed",
    );
    expect(authority.evidence_reentry_authority).toBeNull();
  });

  it("accepts an exact self-terminal route product without claiming Codex re-entry", () => {
    const evidenceRef = "ask:grounding:1:live_environment_binding_diagnosis:1";
    const payload = terminalPayload({
      groundingRequired: true,
      evidenceRefs: [evidenceRef],
    }) as ReturnType<typeof terminalPayload> & Record<string, unknown>;
    const terminalKind = "live_environment_binding_diagnosis";
    const terminalRef = evidenceRef;
    payload.final_answer_source = terminalKind;
    payload.terminal_artifact_kind = terminalKind;
    payload.terminal_answer_authority = {
      ...payload.terminal_answer_authority,
      terminal_artifact_ref: terminalRef,
      terminal_artifact_kind: terminalKind,
      final_answer_source: terminalKind,
    };
    payload.terminal_presentation = {
      ...payload.terminal_presentation,
      terminal_authority_ref: terminalRef,
      terminal_artifact_kind: terminalKind,
      final_answer_source: terminalKind,
    };
    payload.ask_turn_procedure_trace = {
      ...payload.ask_turn_procedure_trace,
      selected_terminal_product: {
        kind: terminalKind,
        ref: terminalRef,
        allowed_by_route: true,
      },
    };
    payload.ask_turn_solver_trace = {
      ...payload.ask_turn_solver_trace,
      evidence_reentry_gate: {
        ...payload.ask_turn_solver_trace.evidence_reentry_gate,
        reentry_authority: "compatibility_projection",
        runtime_lifecycle_verified: false,
      },
      final_arbitration: {
        terminal_artifact_kind: terminalKind,
        final_answer_source: terminalKind,
      },
    };
    payload.route_product_contract = {
      schema: "helix.route_product_contract.v1",
      turn_id: payload.turn_id,
      required_terminal_kind: terminalKind,
      allowed_terminal_artifact_kinds: [terminalKind, "typed_failure"],
      forbidden_terminal_artifact_kinds: [],
    };
    payload.live_environment_binding_diagnosis = {
      schema: "helix.live_environment_binding_diagnosis.v2",
      diagnosis_id: terminalRef,
      assistant_answer: false,
      raw_content_included: false,
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority).toMatchObject({
      status: "validated",
      grounding_required: true,
      evidence_reentry_authority: "route_self_terminal",
      runtime_lifecycle_verified: false,
      selected_evidence_refs: [evidenceRef],
      failure_code: null,
    });
  });

  it("uses the exact route-product contract when route evidence is an unresolved projection", () => {
    const evidenceRef = "ask:grounding:1:observation:scientific-closure:1";
    const payload = terminalPayload({
      groundingRequired: true,
      evidenceRefs: [evidenceRef],
    }) as ReturnType<typeof terminalPayload> & Record<string, unknown>;
    payload.route_product_contract = {
      schema: "helix.route_product_contract.v1",
      turn_id: payload.turn_id,
      required_terminal_kind: "model_synthesized_answer",
      allowed_terminal_artifact_kinds: [
        "model_synthesized_answer",
        "typed_failure",
      ],
    };
    payload.ask_turn_solver_trace.route_evidence_authority = {
      ...payload.ask_turn_solver_trace.route_evidence_authority,
      required_terminal_kind: "unknown",
      allowed_terminal_artifact_kinds: [],
      forbidden_terminal_artifact_kinds: [],
      terminal_product_allowed: false,
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority).toMatchObject({
      status: "validated",
      route_authority_ok: true,
      failure_code: null,
    });
  });

  it("preserves an explicit route-evidence rejection over the route-product contract", () => {
    const evidenceRef = "ask:grounding:1:observation:scientific-closure:1";
    const payload = terminalPayload({
      groundingRequired: true,
      evidenceRefs: [evidenceRef],
    }) as ReturnType<typeof terminalPayload> & Record<string, unknown>;
    payload.route_product_contract = {
      schema: "helix.route_product_contract.v1",
      turn_id: payload.turn_id,
      required_terminal_kind: "model_synthesized_answer",
      allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
    };
    payload.ask_turn_solver_trace.route_evidence_authority = {
      ...payload.ask_turn_solver_trace.route_evidence_authority,
      required_terminal_kind: "typed_failure",
      allowed_terminal_artifact_kinds: ["typed_failure"],
      forbidden_terminal_artifact_kinds: ["model_synthesized_answer"],
      terminal_product_allowed: false,
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toContain("route_authority_rejected");
  });

  it("rejects current-turn evidence claimed only by the provider terminal bridge", () => {
    const turnId = "ask:grounding:provider-bridge";
    const evidenceRef = `${turnId}:workstation_gateway:scholarly-research.lookup_papers:1`;
    const normalizedRef = `${turnId}:codex_normalized:scholarly_research_observation:1`;
    const observationAlias = `${turnId}:workstation_gateway:scholarly-research.lookup_papers:1:scholarly_research_observation`;
    const payload = terminalPayload({
      turnId,
      groundingRequired: true,
      evidenceRefs: [evidenceRef, normalizedRef, observationAlias],
    });
    payload.ask_turn_solver_trace.evidence_reentry_gate = {
      ...payload.ask_turn_solver_trace.evidence_reentry_gate,
      reentry_authority: "provider_terminal_authority_bridge",
      runtime_lifecycle_verified: false,
    };
    payload.provider_reasoning_reentry = {
      schema: "helix.provider_reasoning_reentry.v1",
      turn_id: turnId,
      status: "completed",
      evidence_reentered: true,
      solver_completed: true,
      goal_satisfaction_compatible: true,
      normalized_observation_refs: [evidenceRef, normalizedRef],
    };
    payload.provider_terminal_authority_bridge = {
      schema: "helix.provider_terminal_authority_bridge.v1",
      turn_id: turnId,
      successful_gateway_observation_refs: [evidenceRef],
      normalized_observation_refs: [evidenceRef, normalizedRef],
      all_observations_succeeded: true,
      normalized_observations_ready: true,
      terminal_authority_granted: true,
      final_visible_answer_authorized: true,
    };
    payload.current_turn_artifact_ledger = [{
      artifact_id: normalizedRef,
      turn_id: turnId,
      kind: "scholarly_research_observation",
      status: "succeeded",
      provider_gateway_observation_ref: evidenceRef,
      payload: {
        artifact_id: observationAlias,
        turn_id: turnId,
        status: "succeeded",
        provider_gateway_observation_ref: evidenceRef,
      },
    }];

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority).toMatchObject({
      status: "rejected",
      grounding_required: true,
      selected_evidence_refs: [evidenceRef, normalizedRef, observationAlias],
      evidence_reentry_authority: null,
      runtime_lifecycle_verified: false,
      current_turn_only: true,
      failure_code: "evidence_reentry_not_completed",
    });
  });

  it("rejects provider-bridge grounding when selected evidence is not bridge-supported", () => {
    const turnId = "ask:grounding:provider-bridge-mismatch";
    const evidenceRef = `${turnId}:observation:selected`;
    const payload = terminalPayload({
      turnId,
      groundingRequired: true,
      evidenceRefs: [evidenceRef],
    });
    payload.ask_turn_solver_trace.evidence_reentry_gate = {
      ...payload.ask_turn_solver_trace.evidence_reentry_gate,
      reentry_authority: "provider_terminal_authority_bridge",
      runtime_lifecycle_verified: false,
    };
    payload.provider_reasoning_reentry = {
      schema: "helix.provider_reasoning_reentry.v1",
      turn_id: turnId,
      status: "completed",
      evidence_reentered: true,
      solver_completed: true,
      goal_satisfaction_compatible: true,
      normalized_observation_refs: [`${turnId}:observation:different`],
    };
    payload.provider_terminal_authority_bridge = {
      schema: "helix.provider_terminal_authority_bridge.v1",
      turn_id: turnId,
      successful_gateway_observation_refs: [`${turnId}:observation:different`],
      normalized_observation_refs: [`${turnId}:observation:different`],
      all_observations_succeeded: true,
      normalized_observations_ready: true,
      terminal_authority_granted: true,
      final_visible_answer_authorized: true,
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toContain("evidence_reentry_not_completed");
  });

  it("rejects a grounded terminal with no selected evidence", () => {
    const authority = buildHelixTerminalGroundingAuthority({
      payload: terminalPayload({ groundingRequired: true }),
    });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toContain("selected_evidence_missing");
  });

  it("rejects selected support that did not re-enter the solver", () => {
    const evidenceRef = "ask:grounding:1:observation:docs:1";
    const payload = terminalPayload({
      groundingRequired: true,
      evidenceRefs: [evidenceRef],
    });
    payload.solver_artifact_reentry_audit = {
      ...payload.solver_artifact_reentry_audit,
      ok: false,
      terminal_relevant_artifacts: [{
        ref: evidenceRef,
        selected_as_support: true,
        reentered_solver: false,
      }],
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toEqual(expect.arrayContaining([
      "selected_evidence_support_incomplete",
      "solver_artifact_reentry_rejected",
    ]));
  });

  it("rejects stale turn and terminal text bindings", () => {
    const payload = terminalPayload({ groundingRequired: false });
    payload.ask_turn_solver_trace = {
      ...payload.ask_turn_solver_trace,
      turn_id: "ask:stale:1",
    };
    payload.terminal_answer_authority = {
      ...payload.terminal_answer_authority,
      terminal_text_hash: crypto
        .createHash("sha256")
        .update("Different answer.")
        .digest("hex"),
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toEqual(expect.arrayContaining([
      "terminal_turn_binding_mismatch",
      "terminal_text_hash_mismatch",
    ]));
  });

  it("rejects a model-direct declaration that still selects tool evidence", () => {
    const evidenceRef = "ask:grounding:1:observation:docs:1";
    const payload = terminalPayload({
      groundingRequired: true,
      evidenceRefs: [evidenceRef],
    });
    payload.ask_turn_solver_trace.evidence_reentry_gate = {
      ...payload.ask_turn_solver_trace.evidence_reentry_gate,
      required: false,
    };

    const authority = buildHelixTerminalGroundingAuthority({ payload });

    expect(authority.status).toBe("rejected");
    expect(authority.failure_codes).toContain("grounding_mode_ambiguous");
  });
});
