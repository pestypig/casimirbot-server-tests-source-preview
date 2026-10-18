import { describe, expect, it } from "vitest";

import { buildSolverArtifactReentryAudit } from "../services/helix-ask/solver-artifact-reentry-audit";
import { createHelixTurnLifecycleRecorder } from "../services/helix-ask/runtime/turn-lifecycle";

const buildVerifiedLifecycleWithoutObservations = (turnId: string) => {
  const recorder = createHelixTurnLifecycleRecorder({
    turnId,
    scope: "codex_native_provider_cycle",
    now: () => 100,
  });
  const started = recorder.append({
    kind: "turn.started",
    producer: "helix_adapter",
    status: "started",
  });
  const message = recorder.append({
    kind: "agent.message.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: started.event_id,
    native_item_id: "agent-message:no-observation",
    message_sha256: "hash:no-observation",
  });
  const runtime = recorder.append({
    kind: "runtime.turn.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: message.event_id,
    native_turn_id: "native-turn:no-observation",
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

const basePayload = () => ({
  canonical_goal_frame: {
    goal_kind: "situation_context_question",
    required_terminal_kind: "situation_context_pack",
  },
  route_product_contract: {
    schema: "helix.route_product_contract.v1",
    allowed_terminal_artifact_kinds: ["situation_context_pack", "typed_failure"],
    forbidden_terminal_artifact_kinds: ["live_pipeline_receipt", "client_projection"],
  },
  terminal_answer_authority: {
    schema: "helix.turn_terminal_authority.v1",
    server_authoritative: true,
    terminal_artifact_kind: "situation_context_pack",
  },
  ask_turn_solver_trace: {
    schema: "helix.ask_turn_solver_trace.v1",
    completed_solver_path: true,
    evidence_reentry_gate: {
      selected_evidence_refs: ["obs:visual"],
      receipts_reentered: [],
      projections_reentered: [],
      rejected_evidence_refs: [],
    },
  },
  loop_parity_trace: {
    evidence_selected_for_answer: ["obs:visual"],
    evidence_rejected_for_answer: [],
  },
});

describe("Helix solver artifact re-entry audit", () => {
  it("does not let selected projections override a verified runtime event log", () => {
    const turnId = "ask:verified-no-reentry";
    const audit = buildSolverArtifactReentryAudit({
      turnId,
      terminalArtifactKind: "situation_context_pack",
      terminalArtifactId: "artifact:terminal",
      finalAnswerSource: "artifact_synthesis",
      payload: {
        ...basePayload(),
        native_provider_turn_lifecycle: buildVerifiedLifecycleWithoutObservations(turnId),
        current_turn_artifact_ledger: [
          {
            artifact_id: "artifact:evidence",
            kind: "doc_candidate_validation",
            payload: { evidence_refs: ["obs:selected-only"] },
          },
        ],
        capability_result: {
          schema: "helix.capability_result.v1",
          turn_id: turnId,
          capability_plan_id: "capability_plan:selected-only",
          status: "succeeded",
          receipt_refs: [],
          evidence_refs: ["obs:selected-only"],
          selected_for_answer: true,
          reentered_solver: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        loop_parity_trace: {
          evidence_selected_for_answer: ["artifact:evidence"],
          evidence_rejected_for_answer: [],
        },
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          completed_solver_path: true,
          evidence_reentry_gate: {
            selected_evidence_refs: ["obs:selected-only"],
            receipts_reentered: [],
            projections_reentered: [],
            rejected_evidence_refs: [],
          },
        },
      },
    });

    expect(audit).toMatchObject({
      ok: false,
      reentry_authority: "runtime_event_log",
      runtime_lifecycle_verified: true,
    });
    expect(audit.failure_codes).toEqual(expect.arrayContaining([
      "artifact_not_reentered",
      "capability_result_not_reentered",
    ]));
    expect(audit.terminal_relevant_artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: "artifact:evidence",
        selected_as_support: true,
        reentered_solver: false,
      }),
      expect.objectContaining({
        kind: "capability_result",
        reentered_solver: false,
        failure_codes: expect.arrayContaining(["capability_result_not_reentered"]),
      }),
    ]));
  });

  it("flags selected artifacts that never re-entered the solver", () => {
    const audit = buildSolverArtifactReentryAudit({
      turnId: "ask:not-reentered",
      terminalArtifactKind: "situation_context_pack",
      terminalArtifactId: "artifact:terminal",
      finalAnswerSource: "artifact_synthesis",
      payload: {
        ...basePayload(),
        current_turn_artifact_ledger: [
          {
            artifact_id: "artifact:evidence",
            kind: "doc_candidate_validation",
            payload: { evidence_refs: ["doc:nhm2"] },
          },
        ],
        loop_parity_trace: {
          evidence_selected_for_answer: ["artifact:evidence"],
          evidence_rejected_for_answer: [],
        },
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          completed_solver_path: true,
          evidence_reentry_gate: {
            selected_evidence_refs: [],
            receipts_reentered: [],
            projections_reentered: [],
            rejected_evidence_refs: [],
          },
        },
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.failure_codes).toContain("artifact_not_reentered");
    expect(audit.terminal_relevant_artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "artifact:evidence",
          selected_for_answer: false,
          selected_as_support: true,
          reentered_solver: false,
          failure_codes: expect.arrayContaining(["artifact_not_reentered"]),
        }),
      ]),
    );
  });

  it("flags receipt terminals selected without canonical goal authority", () => {
    const audit = buildSolverArtifactReentryAudit({
      turnId: "ask:receipt",
      terminalArtifactKind: "live_pipeline_receipt",
      terminalArtifactId: "receipt:cadence",
      finalAnswerSource: "live_pipeline_receipt",
      payload: {
        ...basePayload(),
        current_turn_artifact_ledger: [
          {
            artifact_id: "receipt:cadence",
            kind: "live_pipeline_receipt",
            payload: { receipt_id: "receipt:cadence" },
          },
        ],
        loop_parity_trace: {
          evidence_selected_for_answer: ["receipt:cadence"],
          evidence_rejected_for_answer: [],
        },
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          completed_solver_path: true,
          evidence_reentry_gate: {
            selected_evidence_refs: ["receipt:cadence"],
            receipts_reentered: ["receipt:cadence"],
            projections_reentered: [],
            rejected_evidence_refs: [],
          },
        },
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.failure_codes).toContain("receipt_selected_without_goal_authority");
  });

  it("does not treat support receipts as terminal answer selections", () => {
    const audit = buildSolverArtifactReentryAudit({
      turnId: "ask:calculator-support-receipt",
      terminalArtifactKind: "workstation_tool_evaluation",
      terminalArtifactId: "artifact:workstation-eval",
      finalAnswerSource: "workstation_tool_evaluation",
      payload: {
        ...basePayload(),
        canonical_goal_frame: {
          goal_kind: "calculator_solve",
          required_terminal_kind: "workstation_tool_evaluation",
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
          forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          server_authoritative: true,
          terminal_artifact_kind: "workstation_tool_evaluation",
          terminal_artifact_id: "artifact:workstation-eval",
          support_refs: ["receipt:calculator"],
        },
        terminal_authority_single_writer: {
          schema: "helix.terminal_authority_single_writer_result.v1",
          selected_terminal_artifact_kind: "workstation_tool_evaluation",
          selected_terminal_artifact_id: "artifact:workstation-eval",
          support_refs: ["receipt:calculator"],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: "receipt:calculator",
            kind: "calculator_receipt",
            payload: { receipt_id: "receipt:calculator" },
          },
          {
            artifact_id: "artifact:workstation-eval",
            kind: "workstation_tool_evaluation",
            payload: { evaluation_id: "artifact:workstation-eval" },
          },
        ],
        capability_result: {
          schema: "helix.capability_result.v1",
          turn_id: "ask:calculator-support-receipt",
          status: "succeeded",
          receipt_refs: ["receipt:calculator"],
          evidence_refs: ["artifact:workstation-eval"],
          selected_for_answer: true,
          reentered_solver: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        loop_parity_trace: {
          evidence_selected_for_answer: ["artifact:workstation-eval"],
          evidence_rejected_for_answer: [],
        },
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          completed_solver_path: true,
          evidence_reentry_gate: {
            selected_evidence_refs: ["artifact:workstation-eval"],
            receipts_reentered: ["receipt:calculator"],
            projections_reentered: [],
            rejected_evidence_refs: [],
          },
        },
      },
    });

    expect(audit.failure_codes).not.toContain("receipt_selected_without_goal_authority");
    expect(audit.terminal_relevant_artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: "receipt:calculator",
        selected_for_answer: false,
        selected_as_support: true,
        failure_codes: [],
      }),
    ]));
  });

  it("flags projection answers selected without evidence", () => {
    const audit = buildSolverArtifactReentryAudit({
      turnId: "ask:projection",
      terminalArtifactKind: "client_projection",
      terminalArtifactId: "client_projection",
      finalAnswerSource: "client_projection",
      payload: {
        ...basePayload(),
        current_turn_artifact_ledger: [
          {
            artifact_id: "client_projection",
            kind: "client_projection",
            payload: {},
          },
        ],
        loop_parity_trace: {
          evidence_selected_for_answer: [],
          evidence_rejected_for_answer: [],
        },
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          completed_solver_path: true,
          evidence_reentry_gate: {
            selected_evidence_refs: [],
            receipts_reentered: [],
            projections_reentered: [],
            rejected_evidence_refs: [],
          },
        },
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.failure_codes).toContain("projection_selected_without_evidence");
  });

  it("flags capability and retrieval artifacts that never re-entered or arbitrated", () => {
    const audit = buildSolverArtifactReentryAudit({
      turnId: "ask:capability-retrieval",
      terminalArtifactKind: "repo_code_evidence_answer",
      terminalArtifactId: "repo:answer",
      finalAnswerSource: "artifact_synthesis",
      payload: {
        ...basePayload(),
        canonical_goal_frame: {
          goal_kind: "debug_diagnosis",
          required_terminal_kind: "repo_code_evidence_answer",
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["repo_code_evidence_answer", "typed_failure"],
          forbidden_terminal_artifact_kinds: ["live_pipeline_receipt"],
        },
        capability_result: {
          schema: "helix.capability_result.v1",
          turn_id: "ask:capability-retrieval",
          capability_plan_id: "capability_plan:debug",
          status: "succeeded",
          receipt_refs: [],
          evidence_refs: ["debug:export"],
          selected_for_answer: true,
          reentered_solver: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        procedure_evidence_retrieval_plan: {
          schema: "helix.procedure_evidence_retrieval_plan.v1",
          turn_id: "ask:capability-retrieval",
          prompt_hash: "abc",
          task: "debug_diagnosis",
          anchor: "debug_export",
          requested_facets: ["terminal_authority"],
          source_targets: ["runtime_evidence"],
          evidence_required: true,
          why_needed: "diagnose",
          assistant_answer: false,
          raw_content_included: false,
        },
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          turn_id: "ask:capability-retrieval",
          retrieval_plan_id: "abc",
          selected_current_refs: ["debug:export"],
          selected_prior_refs: [],
          selected_epoch_refs: [],
          selected_field_evaluation_refs: [],
          selected_interpretation_refs: [],
          selected_probe_refs: [],
          changed_facts: [],
          stable_facts: [],
          uncertainty: [],
          rejected_refs: [],
          answerability: "answerable",
          assistant_answer: false,
          raw_content_included: false,
        },
        loop_parity_trace: {
          evidence_selected_for_answer: [],
          evidence_rejected_for_answer: [],
        },
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          completed_solver_path: true,
          evidence_reentry_gate: {
            selected_evidence_refs: [],
            receipts_reentered: [],
            projections_reentered: [],
            rejected_evidence_refs: [],
          },
        },
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.failure_codes).toContain("capability_result_not_reentered");
    expect(audit.failure_codes).toContain("retrieval_result_not_arbitrated");
  });

  it("flags retrieval plans that have no retrieval result", () => {
    const audit = buildSolverArtifactReentryAudit({
      turnId: "ask:missing-result",
      terminalArtifactKind: "typed_failure",
      terminalArtifactId: "typed_failure",
      finalAnswerSource: "typed_failure",
      payload: {
        ...basePayload(),
        procedure_evidence_retrieval_plan: {
          schema: "helix.procedure_evidence_retrieval_plan.v1",
          turn_id: "ask:missing-result",
          prompt_hash: "abc",
          task: "comparison",
          anchor: "latest_visual_epoch",
          requested_facets: ["scene"],
          source_targets: ["visual_capture"],
          evidence_required: true,
          why_needed: "compare",
          assistant_answer: false,
          raw_content_included: false,
        },
        procedure_evidence_retrieval_result: null,
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.failure_codes).toContain("retrieval_plan_without_result");
  });

  it("flags terminal authority recorded before solver completion", () => {
    const audit = buildSolverArtifactReentryAudit({
      turnId: "ask:early-terminal",
      terminalArtifactKind: "situation_context_pack",
      terminalArtifactId: "artifact:terminal",
      finalAnswerSource: "artifact_synthesis",
      payload: {
        ...basePayload(),
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          completed_solver_path: false,
          evidence_reentry_gate: {
            selected_evidence_refs: ["obs:visual"],
            receipts_reentered: [],
            projections_reentered: [],
            rejected_evidence_refs: [],
          },
        },
      },
    });

    expect(audit.ok).toBe(false);
    expect(audit.failure_codes).toContain("terminal_answer_before_solver_completion");
  });
});
