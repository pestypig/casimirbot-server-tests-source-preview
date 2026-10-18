import { describe, expect, it } from "vitest";

import { buildSolverRetryPolicies } from "../services/helix-ask/solver-retry-policy";

const failedSubgoal = (kind: string) => ({
  schema: "helix.solver_subgoal.v1",
  subgoal_id: `ask:test:solver_subgoal:${kind}`,
  turn_id: "ask:test",
  kind,
  status: "blocked",
  success_criteria: [],
  evidence_refs: [],
  capability_plan_refs: [],
  capability_result_refs: [],
  retrieval_result_refs: [],
  evaluation: {
    ok: false,
    reasons: ["blocked"],
    missing: ["evidence"],
    retry_recommended: true,
  },
  assistant_answer: false,
  raw_content_included: false,
});

const payloadWithFailedSubgoal = (kind: string) => ({
  solver_subgoal_ledger: {
    schema: "helix.solver_subgoal_ledger.v1",
    turn_id: "ask:test",
    subgoals: [failedSubgoal(kind)],
    ok: false,
    failed_subgoal_ids: [],
    blocked_subgoal_ids: [`ask:test:solver_subgoal:${kind}`],
    assistant_answer: false,
    raw_content_included: false,
  },
});

describe("Helix solver retry policy", () => {
  it("retries empty retrieval once when an alternate source exists", () => {
    const policies = buildSolverRetryPolicies({
      turnId: "ask:test",
      payload: {
        ...payloadWithFailedSubgoal("retrieve_evidence"),
        alternate_source_refs: ["visual_source:backup"],
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          selected_current_refs: [],
          selected_prior_refs: [],
          selected_epoch_refs: [],
          selected_field_evaluation_refs: [],
          selected_interpretation_refs: [],
          selected_probe_refs: [],
        },
      },
    });

    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      schema: "helix.solver_retry_policy.v1",
      retry_allowed: true,
      retry_kind: "alternate_source",
      max_attempts: 1,
      attempt_count: 0,
      reason: "retrieval_result_empty_alternate_source_available",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("uses repair binding when a fresh visual source is unbound", () => {
    const policies = buildSolverRetryPolicies({
      turnId: "ask:test",
      payload: {
        ...payloadWithFailedSubgoal("retrieve_evidence"),
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          selected_current_refs: [],
          selected_prior_refs: [],
          selected_epoch_refs: [],
          selected_field_evaluation_refs: [],
          selected_interpretation_refs: [],
          selected_probe_refs: [],
        },
        source_binding_statuses: [
          {
            schema: "helix.source_binding_status.v1",
            source_kind: "visual_frame",
            status: "unbound",
            stale: false,
            freshness_ms: 1200,
          },
        ],
        source_binding_repair_candidates: [
          {
            schema: "helix.source_binding_repair_candidate.v1",
            candidate_id: "repair:visual",
          },
        ],
      },
    });

    expect(policies[0]).toMatchObject({
      retry_allowed: true,
      retry_kind: "repair_binding",
      reason: "fresh_visual_source_unbound_repair_candidate_available",
    });
  });

  it("tries next doc candidate after candidate validation failure", () => {
    const policies = buildSolverRetryPolicies({
      turnId: "ask:test",
      payload: {
        ...payloadWithFailedSubgoal("execute_capability"),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: "ask:test",
          capability_family: "docs",
          requested_action: "open_or_validate_document",
          mutating: true,
          operator_command_required: true,
          operator_command_present: true,
          admission_status: "admitted",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: "doc-candidate:nhm2",
            kind: "doc_candidate_validation",
            payload: {
              selected_doc_path: "/docs/research/wrong.md",
              opened_path: "/docs/research/nhm2-current-status-whitepaper.md",
              next_candidate_path: "/docs/research/nhm2-current-status-whitepaper.md",
            },
          },
        ],
      },
    });

    expect(policies[0]).toMatchObject({
      retry_allowed: true,
      retry_kind: "validate_candidate",
      max_attempts: 1,
      reason: "doc_candidate_validation_failed_try_next_candidate",
    });
  });

  it("does not retry mutating actions without an operator command", () => {
    const policies = buildSolverRetryPolicies({
      turnId: "ask:test",
      payload: {
        ...payloadWithFailedSubgoal("execute_capability"),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: "ask:test",
          capability_family: "workstation_action",
          requested_action: "click_or_activate_control",
          mutating: true,
          operator_command_required: true,
          operator_command_present: false,
          admission_status: "needs_user_confirmation",
          rejection_reason: "mutating_capability_requires_operator_command",
        },
      },
    });

    expect(policies[0]).toMatchObject({
      retry_allowed: false,
      retry_kind: "ask_user",
      max_attempts: 0,
      reason: "mutating_action_requires_operator_command",
    });
  });
});
