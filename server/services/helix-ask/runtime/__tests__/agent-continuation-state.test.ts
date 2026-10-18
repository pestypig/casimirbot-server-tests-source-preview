import { describe, expect, it } from "vitest";

import {
  appendHelixAgentContinuationStateToPayload,
  appendHelixTerminalRejectionObservationToPayload,
  buildHelixAgentContinuationState,
  buildHelixTerminalRejectionObservation,
  formatHelixAgentContinuationStateForRuntime,
  resolveHelixContinuationBudgetExtension,
} from "../agent-continuation-state";

const artifact = (args: {
  id: string;
  kind: string;
  payload?: Record<string, unknown>;
}): Record<string, unknown> => ({
  artifact_id: args.id,
  turn_id: "ask:continuation",
  kind: args.kind,
  source_scope: "current_turn",
  payload: args.payload ?? {},
});

const budget = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schema: "helix.agent_loop_budget.v1",
  max_iterations: 3,
  max_tool_calls: 2,
  max_llm_decisions: 3,
  hard_max_iterations: 8,
  hard_max_tool_calls: 6,
  hard_max_llm_decisions: 8,
  consumed_iterations: 3,
  consumed_tool_calls: 1,
  consumed_llm_decisions: 3,
  budget_extension_count: 0,
  max_extensions: 3,
  ...overrides,
});

describe("agent continuation state", () => {
  it("publishes a non-terminal initial state and preserves it in the current-turn ledger", () => {
    const payload: Record<string, unknown> = {
      debug: {},
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["doc_evidence"],
      },
      agent_loop_budget: budget({
        consumed_iterations: 0,
        consumed_llm_decisions: 0,
      }),
      current_turn_artifact_ledger: [],
      runtime_continuation_hints: [
        {
          schema: "helix.runtime_continuation_hint.v1",
          turn_id: "ask:continuation",
          hint_id: "ask:continuation:hint:docs",
          suggested_capability: "docs.read_current",
          suggested_args: { path: "docs/current.md" },
          reason: "The current document is required.",
        },
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "initial",
    });
    appendHelixAgentContinuationStateToPayload({ payload, state });

    expect(state).toMatchObject({
      schema: "helix.agent_continuation_state.v1",
      sequence: 1,
      trigger: "initial",
      goal: { status: "in_progress", satisfied: false },
      missing_requirement_ids: ["doc_evidence"],
      allowed_decisions: ["act", "answer"],
      authority: "runtime_agent_decides_within_admitted_boundaries",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(state.next_admissible_affordances[0]).toMatchObject({
      capability_id: "docs.read_current",
      tried: false,
      admissible: true,
    });
    expect(payload.agent_continuation_state).toBe(state);
    expect(
      (
        payload.current_turn_artifact_ledger as Array<Record<string, unknown>>
      ).at(-1),
    ).toMatchObject({
      kind: "agent_continuation_state",
      payload: { terminal_eligible: false, assistant_answer: false },
    });
  });

  it("lets the runtime propose an initial manifest capability without granting execution authority", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        goal_satisfaction_evaluation: { satisfaction: "unknown" },
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation",
      trigger: "initial",
      capabilityProposal: {
        allowed: true,
        admittedCapabilityIds: [
          "live_translation.translate_text",
          "visual_analysis.inspect_image_region",
        ],
      },
    });

    expect(state).toMatchObject({
      allowed_decisions: ["act", "answer"],
      next_admissible_affordances: [],
      capability_proposal: {
        allowed: true,
        admitted_capability_ids: [
          "live_translation.translate_text",
          "visual_analysis.inspect_image_region",
        ],
        authority: "helix_policy_admits_runtime_proposal",
      },
    });
    expect(formatHelixAgentContinuationStateForRuntime(state)).toContain(
      "This is a proposal, not admission: Helix independently validates",
    );
  });

  it("keeps a bounded admitted capability proposal open when non-partial compound coverage is incomplete", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        goal_satisfaction_evaluation: { satisfaction: "satisfied" },
        compound_prompt_coverage_gate: {
          schema: "helix.compound_prompt_coverage_gate.v1",
          applies: true,
          passed: false,
          unresolved_requirement_ids: ["R2"],
          non_visible_blocked_requirement_ids: [],
        },
        current_turn_artifact_ledger: [
          artifact({
            id: "ask:continuation:minecraft-observation",
            kind: "provider_gateway_observation_packet",
          }),
        ],
      },
      turnId: "ask:continuation",
      trigger: "post_attempt",
      capabilityProposal: {
        allowed: true,
        admittedCapabilityIds: ["com.casimirbot.minecraft.command"],
      },
      lastAttempt: {
        capability_id: "com.casimirbot.minecraft.command",
        args: { command: "gamerule doDaylightCycle true" },
        status: "succeeded",
      },
    });

    expect(state).toMatchObject({
      goal: { status: "in_progress", satisfied: false },
      missing_requirement_ids: ["R2"],
      allowed_decisions: ["act"],
      capability_proposal: {
        allowed: true,
        admitted_capability_ids: ["com.casimirbot.minecraft.command"],
      },
    });
    expect(formatHelixAgentContinuationStateForRuntime(state)).toContain(
      "This is a proposal, not admission",
    );
    expect(formatHelixAgentContinuationStateForRuntime(state)).toContain(
      "If answer is absent from allowed_decisions",
    );
  });

  it("settles an authoritative source typed failure instead of advertising unrelated recovery actions", () => {
    const typedFailure = {
      schema: "helix.typed_failure.v1",
      error_code: "procedure_epoch_previous_unavailable",
      next_required_action: "wait_for_scene_memory_index",
      message:
        "Previous visual observation evidence is unavailable for comparison.",
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      question: "What changed since the previous visual capture?",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "procedure_epoch_previous_unavailable",
      typed_failure: typedFailure,
      terminal_answer_authority: { server_authoritative: true },
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "procedure_memory",
        target_kind: "situation_epoch",
        strength: "hard",
        must_enter_backend_ask: true,
        allow_client_shortcut: false,
        allow_no_tool_direct: false,
      },
      loop_parity_trace: {
        schema: "helix.loop_parity_trace.v1",
        selected_route: "procedure_epoch_replay_question",
        observations_created: [
          { observation_id: "ask:continuation:source-observation" },
        ],
        actual_tool_calls: [],
        route_authority_ok: false,
      },
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:source-observation",
          kind: "source_observation",
          payload: { status: "observed" },
        }),
        artifact({
          id: "ask:continuation:typed-failure",
          kind: "typed_failure",
          payload: typedFailure,
        }),
      ],
      runtime_continuation_hints: [
        {
          hint_id: "ask:continuation:unrelated",
          suggested_capability: "repo-code.search_concept",
          suggested_args: { query: "previous visual capture" },
        },
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "initial",
      capabilityProposal: {
        allowed: true,
        admittedCapabilityIds: ["repo-code.search_concept"],
      },
    });

    expect(state).toMatchObject({
      goal: {
        status: "blocked",
        satisfied: false,
        terminal_product_allowed: true,
      },
      next_admissible_affordances: [],
      capability_proposal: { allowed: false },
      allowed_decisions: ["fail"],
      progress: {
        reason_codes: expect.arrayContaining([
          "authoritative_typed_failure_settled",
        ]),
      },
    });
    expect(payload.route_product_contract).toMatchObject({
      schema: "helix.route_product_contract.v1",
      source_target: "procedure_memory",
      allowed_terminal_artifact_kinds: expect.arrayContaining([
        "typed_failure",
      ]),
    });
    expect(payload.canonical_goal_frame).toMatchObject({
      authoritative_source_observation_typed_failure: true,
    });
  });

  it("keeps a docs continuation in progress until its terminal artifact exists", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        final_status: "final_answer",
        docs_continuation_contract: {
          schema: "helix.docs_continuation_contract.v1",
          current_docs_phase: "candidate_validation_required",
          required_next_capability: "docs-viewer.validate_doc_candidates",
          terminal_block_reason: "doc_candidate_validation missing",
        },
        runtime_continuation_hints: [
          {
            hint_id: "ask:continuation:provider_docs_continuation",
            capability_id: "docs-viewer.validate_doc_candidates",
            suggested_action: {
              action: "run_panel_action",
              panel_id: "docs-viewer",
              action_id: "validate_doc_candidates",
              args: { query: "Casimir Dp Quantum Foam Study" },
            },
          },
        ],
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        capability_id: "docs.search",
        status: "succeeded",
      },
    });

    expect(state.goal).toEqual({
      status: "in_progress",
      satisfied: false,
      terminal_product_allowed: null,
    });
    expect(state.missing_requirement_ids).toContain(
      "doc_candidate_validation missing",
    );
    expect(state.next_admissible_affordances[0]).toMatchObject({
      capability_id: "docs-viewer.validate_doc_candidates",
      admissible: true,
      tried: false,
    });
    expect(state.allowed_decisions).toContain("act");
    expect(state.allowed_decisions).not.toContain("answer");
  });

  it("does not mark a provider answer satisfied while a required capability itinerary is incomplete", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        final_status: "final_answer",
        goal_satisfaction_evaluation: {
          satisfaction: "satisfied",
        },
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          required_observation_families: ["visual_capture"],
          observed_families: [],
          missing_observation_families: ["visual_capture"],
          complete: false,
        },
        runtime_continuation_hints: [
          {
            hint_id: "ask:continuation:required_visual_capture",
            capability_id: "situation-room.describe_visual_capture",
            lane_request: {
              capability: "situation-room.describe_visual_capture",
              thread_id: "helix-ask:continuation",
              prompt: "What is happening in the current visual capture?",
            },
            reason:
              "The hard visual route requires a current-turn observation.",
          },
        ],
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation",
      trigger: "final_review",
    });

    expect(state.goal).toEqual({
      status: "in_progress",
      satisfied: false,
      terminal_product_allowed: false,
    });
    expect(state.next_admissible_affordances[0]).toMatchObject({
      capability_id: "situation-room.describe_visual_capture",
      admissible: true,
      tried: false,
    });
    expect(state.allowed_decisions).toContain("act");
    expect(state.allowed_decisions).not.toContain("answer");
  });

  it("does not authorize an answer when an incomplete itinerary has no concrete recovery affordance", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        final_status: "completed",
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          complete: false,
          required_capabilities: [
            "com.casimirbot.minecraft.spatial_region.inspect",
            "com.casimirbot.minecraft.command.catalog",
            "com.casimirbot.minecraft.command",
          ],
          missing_required_capabilities: [
            "com.casimirbot.minecraft.command",
          ],
          missing_compound_subgoal_ids: [
            "ask:continuation:compound:command",
          ],
        },
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation:incomplete-action",
      trigger: "final_review",
      lastAttempt: {
        attempt_id: "ask:continuation:catalog:1",
        capability_id: "com.casimirbot.minecraft.command.catalog",
        status: "succeeded",
        retryability: "not_applicable",
      },
    });

    expect(state.goal).toMatchObject({
      status: "in_progress",
      satisfied: false,
      terminal_product_allowed: false,
    });
    expect(state.missing_requirement_ids).toEqual(
      expect.arrayContaining([
        "com.casimirbot.minecraft.command",
        "ask:continuation:compound:command",
      ]),
    );
    expect(state.allowed_decisions).not.toContain("answer");
  });

  it("continues Codex repair when a guardian transport settled but semantic action evidence remains missing", () => {
    const capability = "com.casimirbot.minecraft.player.guardian.execute";
    const subgoalId = "ask:continuation:guardian:semantic-action";
    const state = buildHelixAgentContinuationState({
      payload: {
        final_status: "final_answer",
        goal_satisfaction_evaluation: {
          satisfaction: "satisfied",
        },
        capability_itinerary_execution_state: {
          schema: "helix.capability_itinerary_execution_state.v1",
          applies: true,
          required_observation_families: ["live_environment"],
          observed_families: ["live_environment"],
          missing_observation_families: [],
          required_capabilities: [],
          missing_required_capabilities: [capability],
          missing_compound_subgoal_ids: [subgoalId],
          missing_required_capability_any_of_groups: [{
            group_id: "minecraft.player_embodiment.action",
            satisfied: false,
          }],
          compound_subgoal_ledger: [{
            subgoal_id: subgoalId,
            requested_capability: capability,
            runtime_capability: capability,
            selected_args: {},
            satisfaction: "pending",
            rail_status: "pending",
            rail_failure_code: "subgoal_observation_missing",
          }],
          complete: false,
        },
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation:guardian-transport-settlement",
      trigger: "post_attempt",
      lastAttempt: {
        capability_id: capability,
        status: "succeeded",
        failure_code: "gateway_observation_requires_provider_reasoning_reentry",
      },
      capabilityProposal: {
        allowed: true,
        admittedCapabilityIds: [capability],
      },
    });

    expect(state.goal).toMatchObject({
      status: "in_progress",
      satisfied: false,
      terminal_product_allowed: false,
    });
    expect(state.missing_requirement_ids).toEqual(
      expect.arrayContaining([capability, subgoalId]),
    );
    expect(state.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: capability,
        admissible: true,
        // The no-op transport occurrence is retained in provenance. Codex may
        // still author a repaired call with new arguments while the semantic
        // requirement remains unresolved.
        tried: true,
      }),
    ]);
    expect(state.allowed_decisions).toContain("act");
    expect(state.allowed_decisions).not.toContain("answer");
  });

  it("marks new observations and resolved requirements as progress after an attempt", () => {
    const firstPayload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["doc_evidence", "terminal_answer"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const first = buildHelixAgentContinuationState({
      payload: firstPayload,
      turnId: "ask:continuation",
      trigger: "pre_decision",
    });
    const secondPayload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["terminal_answer"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:doc_evidence:1",
          kind: "doc_evidence_observation",
          payload: { ok: true },
        }),
      ],
    };

    const second = buildHelixAgentContinuationState({
      payload: secondPayload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      previousState: first,
      lastAttempt: {
        attempt_id: "attempt:docs",
        capability_id: "docs.read_current",
        status: "succeeded",
        observation_refs: ["ask:continuation:doc_evidence:1"],
      },
    });

    expect(second.observation_refs.new).toEqual([
      "ask:continuation:doc_evidence:1",
    ]);
    expect(second.progress).toMatchObject({
      made_progress: true,
      new_observation_count: 1,
      resolved_requirement_ids: ["doc_evidence"],
      no_progress_repeat_count: 0,
    });
  });

  it("preserves inline scholarly recovery arguments as an executable lane request", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["semantic_scholar_http_429"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:scholarly-lookup:1",
          kind: "scholarly_research_observation",
          payload: {
            next_affordances: [
              {
                capability: "scholarly-research.lookup_papers",
                reason: "semantic_scholar_http_429",
                query: "magnetar primary research observations",
              },
            ],
          },
        }),
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:scholarly-lookup",
        capability_id: "scholarly-research.lookup_papers",
        args: { query: "magnetar primary research" },
        status: "failed",
        failure_code: "semantic_scholar_http_429",
        retryability: "retryable",
      },
    });

    expect(state.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: "scholarly-research.lookup_papers",
        args: { query: "magnetar primary research observations" },
        lane_request: {
          capability: "scholarly-research.lookup_papers",
          query: "magnetar primary research observations",
        },
        admissible: true,
        tried: false,
      }),
    ]);
    expect(state.allowed_decisions).toEqual(
      expect.arrayContaining(["act", "retry"]),
    );
    expect(state.allowed_decisions).not.toContain("answer");
    const runtimeText = formatHelixAgentContinuationStateForRuntime(state);
    expect(runtimeText).toContain("they are not semantic conclusions");
    expect(runtimeText).toContain(
      "you may instead propose exactly one different scholarly-research.lookup_papers query",
    );
    expect(runtimeText).toContain(
      "Helix independently validates the proposed query",
    );
  });

  it("preserves the exact normalized Lanyon request reference in the admission lane request", () => {
    const requestArtifactRef =
      "ask:continuation:codex_normalized:theory_artifact_producer_lanyon_request_observation:1";
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["lanyon_artifact_generation_receipt"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: requestArtifactRef,
          kind: "theory_artifact_producer_lanyon_request_observation",
          payload: {
            next_affordances: [
              {
                schema: "helix.provider_next_affordance.v1",
                affordance_id:
                  "theory-artifact-producer:admit-lanyon:lanyon-request:test",
                capability: "theory-artifact-producer.admit_lanyon_snapshot",
                mode: "read",
                reason:
                  "exact_current_turn_lanyon_request_ready_for_pinned_source_admission",
                requires_confirmation: false,
                executes_automatically: false,
                lane_request: {
                  capability: "theory-artifact-producer.admit_lanyon_snapshot",
                  request_artifact_ref: requestArtifactRef,
                  case_id: "advection_diffusion_1d_periodic",
                },
                terminal_eligible: false,
                assistant_answer: false,
                raw_content_included: false,
              },
            ],
          },
        }),
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:lanyon-request",
        capability_id: "theory-artifact-producer.prepare_lanyon_request",
        status: "succeeded",
        observation_refs: [requestArtifactRef],
      },
    });

    expect(state.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: "theory-artifact-producer.admit_lanyon_snapshot",
        args: {
          request_artifact_ref: requestArtifactRef,
          case_id: "advection_diffusion_1d_periodic",
        },
        lane_request: {
          capability: "theory-artifact-producer.admit_lanyon_snapshot",
          request_artifact_ref: requestArtifactRef,
          case_id: "advection_diffusion_1d_periodic",
          mode: "read",
        },
        admissible: true,
        tried: false,
      }),
    ]);
    expect(state.allowed_decisions).toContain("act");
    expect(state.allowed_decisions).not.toContain("answer");
  });

  it("keeps post-Lanyon formal and revision-bound closure requests exact and replay-distinct", () => {
    const procedureArgs = {
      prompt: "Evaluate execution closure for the selected procedure.",
      procedure_artifact_ref: "ask:continuation:procedure",
      procedure_id: "procedure:continuation",
      procedure_sha256: "a".repeat(64),
    };
    const originalClosureAffordance = {
      schema: "helix.provider_next_affordance.v1",
      affordance_id: "procedure:continuation:evaluate-closure",
      capability: "theory-experiment-procedure.evaluate_closure",
      mode: "read",
      requires_confirmation: false,
      executes_automatically: false,
      lane_request: {
        capability: "theory-experiment-procedure.evaluate_closure",
        ...procedureArgs,
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    };
    const procedureArtifact = artifact({
      id: "ask:continuation:procedure",
      kind: "theory_experiment_procedure_observation",
      payload: {
        next_affordances: [originalClosureAffordance],
      },
    });
    const beforeReceiptPayload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: [
          "artifact_generation_receipt_required",
          "formal_certificate_required",
        ],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [procedureArtifact],
    };
    const beforeReceipt = buildHelixAgentContinuationState({
      payload: beforeReceiptPayload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:initial-closure",
        capability_id: "theory-experiment-procedure.evaluate_closure",
        args: procedureArgs,
        status: "succeeded",
      },
    });
    const originalClosure = beforeReceipt.next_admissible_affordances.find(
      (affordance) =>
        affordance.capability_id ===
        "theory-experiment-procedure.evaluate_closure",
    );
    expect(originalClosure).toMatchObject({ tried: true });

    const admissionArtifactRef =
      "ask:continuation:lanyon-admission-continuation";
    const receiptEvidenceArtifactRef =
      "ask:continuation:artifact-generation-receipt";
    const evidenceRevisionSha256 = "b".repeat(64);
    const revisionIntent = {
      schema: "helix.theory_execution_closure_evidence_revision.v1",
      source_capability_id: "theory-artifact-producer.admit_lanyon_snapshot",
      admission_observation_ref: admissionArtifactRef,
      evidence_revision_ref: receiptEvidenceArtifactRef,
      evidence_revision_sha256: evidenceRevisionSha256,
    };
    const continuationArtifact = artifact({
      id: admissionArtifactRef,
      kind: "theory_artifact_producer_lanyon_continuation_observation",
      payload: {
        next_affordances: [
          {
            schema: "helix.provider_next_affordance.v1",
            affordance_id: "theory-formal-verifier:prepare-after-lanyon",
            capability: "theory-formal-verifier.prepare_request",
            mode: "read",
            requires_confirmation: false,
            executes_automatically: false,
            lane_request: {
              capability: "theory-formal-verifier.prepare_request",
              procedure_artifact_ref: procedureArgs.procedure_artifact_ref,
              procedure_id: procedureArgs.procedure_id,
              procedure_sha256: procedureArgs.procedure_sha256,
              semantic_admission_artifact_ref:
                "ask:continuation:semantic-admission",
              artifact_generation_artifact_ref: admissionArtifactRef,
            },
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
          {
            schema: "helix.provider_next_affordance.v1",
            affordance_id:
              "theory-experiment-procedure:evaluate-closure-after-lanyon",
            capability: "theory-experiment-procedure.evaluate_closure",
            mode: "read",
            requires_confirmation: false,
            executes_automatically: false,
            lane_request: {
              capability: "theory-experiment-procedure.evaluate_closure",
              ...procedureArgs,
              source_target_intent: revisionIntent,
            },
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      },
    });
    const afterReceipt = buildHelixAgentContinuationState({
      payload: {
        ...beforeReceiptPayload,
        current_turn_artifact_ledger: [
          procedureArtifact,
          artifact({
            id: receiptEvidenceArtifactRef,
            kind: "artifact_generation_receipt",
          }),
          continuationArtifact,
        ],
      },
      turnId: "ask:continuation",
      trigger: "post_attempt",
      previousState: beforeReceipt,
      lastAttempt: {
        attempt_id: "attempt:lanyon-admission",
        capability_id: "theory-artifact-producer.admit_lanyon_snapshot",
        args: {
          request_artifact_ref: "ask:continuation:lanyon-request",
          case_id: "advection_diffusion_full_1d",
        },
        status: "succeeded",
        observation_refs: [receiptEvidenceArtifactRef, admissionArtifactRef],
      },
    });
    const formalPrepare = afterReceipt.next_admissible_affordances.find(
      (affordance) =>
        affordance.capability_id === "theory-formal-verifier.prepare_request",
    );
    const closureAffordances = afterReceipt.next_admissible_affordances.filter(
      (affordance) =>
        affordance.capability_id ===
        "theory-experiment-procedure.evaluate_closure",
    );
    const revisionClosure = closureAffordances.find(
      (affordance) =>
        (
          affordance.args.source_target_intent as
            Record<string, unknown> | undefined
        )?.evidence_revision_ref === receiptEvidenceArtifactRef,
    );
    expect(formalPrepare).toMatchObject({
      tried: false,
      admissible: true,
      args: {
        procedure_artifact_ref: procedureArgs.procedure_artifact_ref,
        procedure_id: procedureArgs.procedure_id,
        procedure_sha256: procedureArgs.procedure_sha256,
        semantic_admission_artifact_ref: "ask:continuation:semantic-admission",
        artifact_generation_artifact_ref: admissionArtifactRef,
      },
      lane_request: {
        capability: "theory-formal-verifier.prepare_request",
        mode: "read",
      },
    });
    expect(revisionClosure).toMatchObject({
      tried: false,
      admissible: true,
      args: {
        source_target_intent: revisionIntent,
      },
      lane_request: {
        capability: "theory-experiment-procedure.evaluate_closure",
        mode: "read",
        source_target_intent: revisionIntent,
      },
    });
    expect(revisionClosure?.action_fingerprint).not.toBe(
      originalClosure?.action_fingerprint,
    );
    expect(
      afterReceipt.next_admissible_affordances.some((affordance) =>
        affordance.capability_id.includes("independent-numerical"),
      ),
    ).toBe(false);
    expect(afterReceipt.allowed_decisions).toContain("act");
    expect(afterReceipt.allowed_decisions).not.toContain("answer");
  });

  it("includes nested lane request arguments in affordance identity", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["full_text_evidence"],
      },
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:full-text-affordance",
          kind: "scholarly_full_text_observation",
          payload: {
            next_admissible_affordances: [
              {
                affordance_id: "affordance:fetch-selected-paper",
                lane_request: {
                  capability: "scholarly-research.fetch_full_text",
                  paper_result_id: "paper:magnetar:1",
                  source_url: "https://example.test/magnetar.pdf",
                },
                reason: "selected_paper_requires_full_text",
              },
            ],
          },
        }),
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
    });

    expect(state.next_admissible_affordances[0]).toMatchObject({
      capability_id: "scholarly-research.fetch_full_text",
      args: {
        paper_result_id: "paper:magnetar:1",
        source_url: "https://example.test/magnetar.pdf",
      },
      lane_request: {
        capability: "scholarly-research.fetch_full_text",
        paper_result_id: "paper:magnetar:1",
        source_url: "https://example.test/magnetar.pdf",
      },
    });
    const alternatePayload = structuredClone(payload);
    const alternateLedger =
      alternatePayload.current_turn_artifact_ledger as Array<
        Record<string, unknown>
      >;
    const alternateArtifactPayload = alternateLedger[0]?.payload as Record<
      string,
      unknown
    >;
    const alternateAffordance = (
      alternateArtifactPayload.next_admissible_affordances as Array<
        Record<string, unknown>
      >
    )[0];
    expect(alternateAffordance).toBeDefined();
    if (!alternateAffordance)
      throw new Error("expected alternate scholarly affordance fixture");
    (
      alternateAffordance.lane_request as Record<string, unknown>
    ).paper_result_id = "paper:magnetar:2";
    const alternateState = buildHelixAgentContinuationState({
      payload: alternatePayload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
    });
    expect(
      alternateState.next_admissible_affordances[0]?.action_fingerprint,
    ).not.toBe(state.next_admissible_affordances[0]?.action_fingerprint);
  });

  it("keeps confirmation metadata out of exact verifier lane arguments and distinguishes poll attempts", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["formal_certificate"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:formal-poll:3",
          kind: "theory_formal_verifier_result_observation",
          payload: {
            next_affordances: [
              {
                capability: "theory-formal-verifier.read_result",
                mode: "read",
                requires_confirmation: false,
                executes_automatically: false,
                output_role: "evidence_for_bounded_synthesis",
                lane_request: {
                  capability: "theory-formal-verifier.read_result",
                  job_id: "formal-job:test",
                  poll_attempt: 3,
                },
                terminal_eligible: false,
                assistant_answer: false,
                raw_content_included: false,
              },
            ],
          },
        }),
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:formal-poll:2",
        capability_id: "theory-formal-verifier.read_result",
        args: { job_id: "formal-job:test", poll_attempt: 2 },
        status: "client_pending",
        failure_code: null,
        retryability: "retryable",
      },
    });

    expect(state.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: "theory-formal-verifier.read_result",
        args: {
          job_id: "formal-job:test",
          poll_attempt: 3,
        },
        lane_request: {
          capability: "theory-formal-verifier.read_result",
          job_id: "formal-job:test",
          mode: "read",
          poll_attempt: 3,
        },
        admissible: true,
        tried: false,
      }),
    ]);
    expect(state.next_admissible_affordances[0]?.args).not.toHaveProperty(
      "requires_confirmation",
    );
    expect(state.next_admissible_affordances[0]?.args).not.toHaveProperty(
      "executes_automatically",
    );
    expect(state.allowed_decisions).toContain("act");
    expect(state.allowed_decisions).not.toContain("answer");
  });

  it.each([
    "docs.read_current",
    "visual_analysis.inspect_image_region",
    "scientific-calculator.solve_expression",
    "moral-graph.reflect_context",
    "scholarly-research.lookup_papers",
    "workstation-notes.create_note",
  ])("uses the same retry and budget rule for %s", (capabilityId) => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["evidence"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
      runtime_continuation_hints: [
        {
          schema: "helix.runtime_continuation_hint.v1",
          turn_id: "ask:continuation",
          hint_id: `hint:${capabilityId}`,
          suggested_capability: capabilityId,
          suggested_args: { target: "current" },
          reason: "An admitted attempt remains available.",
        },
      ],
    };
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: `attempt:${capabilityId}`,
        capability_id: capabilityId,
        status: "failed",
        failure_code: "temporary_backend_unavailable",
        retryability: "retryable",
      },
    });
    const extension = resolveHelixContinuationBudgetExtension({
      state,
      current: { iterations: 3, tool_calls: 2, model_decisions: 3 },
      hard: { iterations: 8, tool_calls: 6, model_decisions: 8 },
    });

    expect(state.allowed_decisions).toEqual(
      expect.arrayContaining(["act", "retry"]),
    );
    expect(state.allowed_decisions).not.toContain("answer");
    expect(extension).toEqual({
      extend: true,
      reason: "progress_under_soft_budget_pressure",
      increments: { iterations: 2, tool_calls: 1, model_decisions: 2 },
    });
  });

  it("stops extending after repeated attempts make no progress", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["evidence"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const first = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:1",
        capability_id: "docs.read_current",
        action_fingerprint: "same-action",
        status: "failed",
        failure_code: "temporary_backend_unavailable",
        retryability: "retryable",
      },
    });
    const second = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      previousState: first,
      lastAttempt: {
        attempt_id: "attempt:2",
        capability_id: "docs.read_current",
        action_fingerprint: "same-action",
        status: "failed",
        failure_code: "temporary_backend_unavailable",
        retryability: "retryable",
      },
    });
    const third = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      previousState: second,
      lastAttempt: {
        attempt_id: "attempt:3",
        capability_id: "docs.read_current",
        action_fingerprint: "same-action",
        status: "failed",
        failure_code: "temporary_backend_unavailable",
        retryability: "retryable",
      },
    });

    expect(third.progress.no_progress_repeat_count).toBe(2);
    expect(
      resolveHelixContinuationBudgetExtension({
        state: third,
        current: { iterations: 3, tool_calls: 2, model_decisions: 3 },
        hard: { iterations: 8, tool_calls: 6, model_decisions: 8 },
      }),
    ).toMatchObject({
      extend: false,
      reason: "repeated_no_progress_boundary_reached",
    });
  });

  it("does not count repeated state publication for the same call as a new failed attempt", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["wall_not_built"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const attempt = {
      attempt_id: "call:spatial:3",
      capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
      action_fingerprint: "same-spatial-read",
      status: "succeeded" as const,
      observation_refs: ["observation:spatial:3"],
    };
    const first = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: attempt,
    });
    const bookkeeping = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      previousState: first,
      lastAttempt: attempt,
    });
    const finalReview = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "final_review",
      previousState: bookkeeping,
      lastAttempt: attempt,
    });

    expect(bookkeeping.progress.no_progress_repeat_count).toBe(0);
    expect(finalReview.progress.no_progress_repeat_count).toBe(0);
    expect(finalReview.progress.reason_codes).not.toContain(
      "repeated_action_without_progress",
    );
  });

  it("preserves a schema-repair affordance projected through observation state_delta", () => {
    const capability = "com.casimirbot.minecraft.spatial_region.inspect";
    const repairedArgs = {
      target: "current_actor",
      purpose: "build_planning",
    };
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["schema_validation_failed"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:spatial-schema-repair",
          kind: "provider_gateway_observation_packet",
          payload: {
            status: "failed",
            state_delta: {
              next_affordances: [
                {
                  affordance_id: "environment_probe_schema_repair:spatial",
                  capability_id: capability,
                  args: repairedArgs,
                  lane_request: {
                    capability,
                    ...repairedArgs,
                  },
                  admissible: true,
                  reason: "Retry using only frozen-schema fields.",
                },
              ],
            },
          },
        }),
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:invalid-spatial-scope",
        capability_id: capability,
        action_fingerprint: "invalid-spatial-scope",
        status: "failed",
        failure_class: "invalid_args",
        failure_code: "schema_validation_failed",
        failure_message: "The probe arguments failed at $.scope.",
        retryability: "retryable",
      },
    });

    expect(state.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: capability,
        args: repairedArgs,
        lane_request: { capability, ...repairedArgs },
        admissible: true,
        tried: false,
      }),
    ]);
    expect(state.allowed_decisions).toEqual(
      expect.arrayContaining(["act", "retry"]),
    );
    expect(state.allowed_decisions).not.toContain("answer");
  });

  it("retires a schema-repair affordance after the repaired capability succeeds", () => {
    const capability = "com.casimirbot.minecraft.local_map.inspect";
    const repairedArgs = { target: "current_actor" };
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: [],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:local-map-schema-repair",
          kind: "provider_gateway_observation_packet",
          payload: {
            status: "failed",
            state_delta: {
              next_affordances: [
                {
                  affordance_id: "environment_probe_schema_repair:local-map",
                  capability_id: capability,
                  args: repairedArgs,
                  lane_request: { capability, ...repairedArgs },
                  admissible: true,
                  reason: "Retry using only frozen-schema fields.",
                },
              ],
            },
          },
        }),
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:repaired-local-map",
        capability_id: capability,
        action_fingerprint: "runtime-normalized-success-fingerprint",
        status: "succeeded",
        observation_refs: ["observation:local-map:1"],
      },
    });

    expect(state.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: capability,
        tried: true,
      }),
    ]);
    expect(
      state.next_admissible_affordances.some(
        (affordance) => affordance.admissible && !affordance.tried,
      ),
    ).toBe(false);

    const laterState = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      previousState: state,
      lastAttempt: {
        attempt_id: "attempt:later-spatial-read",
        capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
        action_fingerprint: "later-spatial-read-fingerprint",
        status: "succeeded",
        observation_refs: ["observation:spatial:later"],
      },
    });

    expect(laterState.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: capability,
        tried: true,
      }),
    ]);
    expect(laterState.tried_action_fingerprints).toContain(
      state.next_admissible_affordances[0]?.action_fingerprint,
    );
  });

  it("keeps a successful capability and its exact pending occurrence resolved after a later failed probe", () => {
    const createCapability =
      "com.casimirbot.environment.durable_goal.create";
    const createSubgoal =
      "ask:g5:create:compound_capability_subgoal:1:durable_goal_create";
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: [createCapability, createSubgoal],
      },
      capability_itinerary_execution_state: {
        complete: false,
        missing_required_capabilities: [createCapability],
        missing_compound_subgoal_ids: [createSubgoal],
        compound_subgoal_ledger: [
          {
            subgoal_id: createSubgoal,
            order: 1,
            requested_capability: createCapability,
            runtime_capability: createCapability,
            satisfaction: "failed",
            rail_failure_code: "missing_required_arg:objective",
          },
        ],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:g5:create:durable-goal-observation",
          kind: "provider_gateway_observation_packet",
        }),
      ],
    };
    const afterCreate = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:g5:create",
      trigger: "post_attempt",
      capabilityProposal: {
        allowed: true,
        admittedCapabilityIds: [createCapability],
      },
      lastAttempt: {
        attempt_id: "call:durable-goal:create",
        capability_id: createCapability,
        status: "succeeded",
        observation_refs: ["ask:g5:create:durable-goal-observation"],
      },
    });

    expect(afterCreate.missing_requirement_ids).toEqual([]);
    expect(afterCreate.progress.resolved_requirement_ids).toEqual(
      expect.arrayContaining([createCapability, createSubgoal]),
    );
    expect(
      afterCreate.next_admissible_affordances.some(
        (affordance) =>
          affordance.source_ref === createSubgoal && !affordance.tried,
      ),
    ).toBe(false);

    const afterFailedProbe = buildHelixAgentContinuationState({
      payload: {
        ...payload,
        current_turn_artifact_ledger: [
          ...(payload.current_turn_artifact_ledger as unknown[]),
          artifact({
            id: "ask:g5:create:workflow-status-failure",
            kind: "provider_gateway_observation_packet",
          }),
        ],
      },
      turnId: "ask:g5:create",
      trigger: "post_attempt",
      previousState: afterCreate,
      lastAttempt: {
        attempt_id: "call:workflow:status",
        capability_id: "com.casimirbot.minecraft.player.workflow.status",
        status: "failed",
        failure_class: "invalid_args",
        failure_code: "action_policy_denied",
        retryability: "retryable",
      },
    });

    expect(afterFailedProbe.missing_requirement_ids).toEqual([]);
    expect(afterFailedProbe.progress.resolved_requirement_ids).toEqual(
      expect.arrayContaining([createCapability, createSubgoal]),
    );
    expect(afterFailedProbe.progress.added_requirement_ids).toEqual([]);
    expect(afterFailedProbe.progress.reason_codes).not.toContain(
      "requirements_resolved",
    );
  });

  it("treats tool-policy rejection as non-retryable bookkeeping rather than progress", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["evidence"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:policy-rejection",
          kind: "runtime_tool_observation",
          payload: { status: "invalid_args" },
        }),
      ],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "invalid_tool_call_observation",
      capabilityProposal: {
        allowed: true,
        admittedCapabilityIds: ["live_env.read_processed_live_source_mail"],
      },
      lastAttempt: {
        attempt_id: "attempt:policy-rejection",
        capability_id: "live_env.read_processed_live_source_mail",
        status: "failed",
        failure_class: "permission",
        failure_code: "invalid_args",
        failure_message:
          "runtime_capability_not_admitted_by_tool_policy:live_env.read_processed_live_source_mail:live_environment, runtime_tool_forbidden_by_tool_policy:live_env.read_processed_live_source_mail",
        retryability: "retryable",
      },
    });

    expect(state.last_attempt?.retryability).toBe("non_retryable");
    expect(state.progress).toMatchObject({
      made_progress: false,
      new_observation_count: 1,
      reason_codes: expect.arrayContaining(["failed_attempt_observation_only"]),
    });
    expect(state.allowed_decisions).not.toContain("retry");
    expect(state.allowed_decisions).not.toContain("act");
    expect(state.allowed_decisions).toContain("fail");
  });

  it("tracks compound observations and remaining subgoals without privileging a tool order", () => {
    const firstPayload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: [
          "docs_observation",
          "calculator_observation",
          "synthesis",
        ],
      },
      agent_loop_budget: budget({
        consumed_iterations: 1,
        consumed_llm_decisions: 1,
      }),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:docs:1",
          kind: "doc_evidence_observation",
        }),
      ],
    };
    const first = buildHelixAgentContinuationState({
      payload: firstPayload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
    });
    const secondPayload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["synthesis"],
      },
      agent_loop_budget: budget({
        consumed_iterations: 2,
        consumed_tool_calls: 2,
        consumed_llm_decisions: 2,
      }),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:docs:1",
          kind: "doc_evidence_observation",
        }),
        artifact({
          id: "ask:continuation:calculator:1",
          kind: "calculator_receipt",
        }),
      ],
      runtime_continuation_hints: [
        {
          hint_id: "ask:continuation:hint:synthesis",
          suggested_capability: "model.synthesize_current_evidence",
          suggested_args: {},
          reason:
            "All required tool observations are present; synthesize them.",
        },
      ],
    };
    const second = buildHelixAgentContinuationState({
      payload: secondPayload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      previousState: first,
    });

    expect(second.observation_refs.existing).toEqual([
      "ask:continuation:docs:1",
    ]);
    expect(second.observation_refs.new).toEqual([
      "ask:continuation:calculator:1",
    ]);
    expect(second.progress.resolved_requirement_ids).toEqual([
      "docs_observation",
      "calculator_observation",
    ]);
    expect(second.missing_requirement_ids).toEqual(["synthesis"]);
    expect(second.next_admissible_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_id: "model.synthesize_current_evidence",
          tried: false,
        }),
      ]),
    );
    expect(second.allowed_decisions).toEqual(
      expect.arrayContaining(["act", "answer"]),
    );
  });

  it("offers the next admitted pending compound subgoal after an observation re-enters", () => {
    const actorObservation = artifact({
      id: "ask:continuation:minecraft:actor",
      kind: "provider_gateway_observation_packet",
    });
    const payload: Record<string, unknown> = {
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        required_observation_families: ["live_environment"],
        required_capabilities: [
          "com.casimirbot.minecraft.actor.status.read",
          "com.casimirbot.minecraft.inventory.check",
        ],
        missing_required_capabilities: [
          "com.casimirbot.minecraft.inventory.check",
        ],
        missing_compound_subgoal_ids: ["minecraft:inventory"],
        compound_subgoal_ledger: [
          {
            subgoal_id: "minecraft:actor",
            requested_capability: "com.casimirbot.minecraft.actor.status.read",
            runtime_capability: "com.casimirbot.minecraft.actor.status.read",
            satisfaction: "satisfied",
            rail_failure_code: null,
          },
          {
            subgoal_id: "minecraft:inventory",
            requested_capability: "com.casimirbot.minecraft.inventory.check",
            runtime_capability: "com.casimirbot.minecraft.inventory.check",
            selected_args: {},
            satisfaction: "pending",
            rail_failure_code: "subgoal_observation_missing",
          },
        ],
        complete: false,
      },
      current_turn_artifact_ledger: [actorObservation],
    };

    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        capability_id: "com.casimirbot.minecraft.actor.status.read",
        status: "succeeded",
      },
      capabilityProposal: {
        allowed: false,
        admittedCapabilityIds: [
          "com.casimirbot.minecraft.actor.status.read",
          "com.casimirbot.minecraft.inventory.check",
        ],
      },
    });

    expect(state.missing_requirement_ids).toEqual(
      expect.arrayContaining([
        "com.casimirbot.minecraft.inventory.check",
        "minecraft:inventory",
      ]),
    );
    expect(state.next_admissible_affordances).toEqual([
      expect.objectContaining({
        capability_id: "com.casimirbot.minecraft.inventory.check",
        tried: false,
        lane_request: {
          capability: "com.casimirbot.minecraft.inventory.check",
        },
      }),
    ]);
    expect(state.allowed_decisions).toEqual(["act"]);
  });

  it("exposes permission failures for user input or grounded failure instead of blind retry", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "blocked",
        missing_requirement_ids: ["user_authorization"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        capability_id: "workstation-notes.create_note",
        status: "blocked",
        failure_code: "permission_required",
      },
    });

    expect(state.last_attempt).toMatchObject({
      failure_class: "permission",
      retryability: "requires_user_input",
    });
    expect(state.allowed_decisions).toEqual(
      expect.arrayContaining(["ask_user", "answer", "fail"]),
    );
    expect(state.allowed_decisions).not.toContain("retry");
  });

  it("keeps model-authored Minecraft command metadata repair inside the bounded retry loop", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["com.casimirbot.minecraft.command"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        capability_id: "com.casimirbot.minecraft.command",
        status: "failed",
        failure_code: "command_category_mismatch",
        failure_message:
          "Unknown installed-mod commands require an explicit category and effect.",
        retryability: "requires_user_input",
      },
    });

    expect(state.last_attempt).toMatchObject({
      failure_code: "command_category_mismatch",
      retryability: "retryable",
    });
    expect(state.allowed_decisions).toContain("retry");
    expect(state.allowed_decisions).not.toContain("ask_user");
  });

  it("classifies a frozen input-schema rejection as repairable invalid arguments", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: [
          "com.casimirbot.minecraft.player.guardian.execute",
        ],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        capability_id:
          "com.casimirbot.minecraft.player.guardian.execute",
        status: "failed",
        failure_code: "precondition_failed",
        failure_message:
          "Minecraft player-action arguments did not satisfy the admitted input schema: $.program_schema: Missing required property program_schema.; $.target_entity_selector: Property target_entity_selector is not admitted by the frozen schema.",
      },
    });

    expect(state.last_attempt).toMatchObject({
      failure_class: "invalid_args",
      failure_code: "precondition_failed",
      retryability: "retryable",
    });
    expect(state.allowed_decisions).toContain("retry");
  });

  it("classifies a trusted semantic-contract rejection as repairable invalid arguments", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: [
          "com.casimirbot.minecraft.player.guardian.execute",
        ],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        capability_id:
          "com.casimirbot.minecraft.player.guardian.execute",
        status: "failed",
        failure_code: "precondition_failed",
        failure_message:
          "The concurrent Minecraft guardian program failed its trusted contract: interrupts.0.activate_lane_id: An interrupt must activate an interrupt-only lane.",
      },
    });

    expect(state.last_attempt).toMatchObject({
      failure_class: "invalid_args",
      failure_code: "precondition_failed",
      retryability: "retryable",
    });
    expect(state.allowed_decisions).toContain("retry");
  });

  it("turns a recoverable terminal rejection into another non-terminal observation", () => {
    const payload: Record<string, unknown> = {
      debug: {},
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["agent_authored_terminal_answer"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const observation = buildHelixTerminalRejectionObservation({
      turnId: "ask:continuation",
      candidateKind: "tool_observation",
      candidateRef: "ask:continuation:tool_observation:1",
      reason: "missing_post_tool_model_step",
    });
    appendHelixTerminalRejectionObservationToPayload({ payload, observation });
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "terminal_rejection",
      lastAttempt: observation,
    });

    expect(observation).toMatchObject({
      recoverable: true,
      retryability: "retryable",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(state.observation_refs.new).toContain(observation.observation_id);
    expect(state.last_attempt).toMatchObject({
      failure_class: "terminal_authority",
      failure_code: "missing_post_tool_model_step",
      retryability: "retryable",
    });
    expect(state.allowed_decisions).toEqual(["retry"]);
  });

  it("reopens a previously satisfied goal when terminal authority rejects the answer", () => {
    const payload: Record<string, unknown> = {
      debug: {},
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        missing_requirement_ids: [],
      },
      final_status: "completed",
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [],
    };
    const observation = buildHelixTerminalRejectionObservation({
      turnId: "ask:continuation",
      candidateKind: "scholarly_research_answer",
      candidateRef: "ask:continuation:scholarly_research_answer:1",
      reason: "route_requires_synthesis",
      gate: "provider_route_product_quality_gate",
      reasonCodes: ["invalid_page_evidence_links"],
      evidenceRefs: ["ask:continuation:scholarly_full_text:1"],
    });
    appendHelixTerminalRejectionObservationToPayload({ payload, observation });
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "terminal_rejection",
      lastAttempt: observation,
    });

    expect(state.goal).toEqual({
      status: "in_progress",
      satisfied: false,
      terminal_product_allowed: false,
    });
    expect(observation).toMatchObject({
      gate: "provider_route_product_quality_gate",
      reason_codes: ["invalid_page_evidence_links"],
      evidence_refs: ["ask:continuation:scholarly_full_text:1"],
      recoverable: true,
      retryability: "retryable",
    });
    expect(state.last_attempt).toMatchObject({
      failure_class: "terminal_authority",
      failure_code: "route_requires_synthesis",
      retryability: "retryable",
    });
    expect(state.allowed_decisions).toEqual(["retry"]);
  });

  it("treats incomplete non-partial compound coverage as a recoverable terminal rejection", () => {
    const observation = buildHelixTerminalRejectionObservation({
      turnId: "ask:continuation",
      candidateKind: "model_synthesized_answer",
      candidateRef: "ask:continuation:partial-compound-answer",
      reason: "compound_prompt_coverage_incomplete",
    });

    expect(observation).toMatchObject({
      rejection_reason: "compound_prompt_coverage_incomplete",
      recoverable: true,
      retryability: "retryable",
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("lets the runtime propose one bounded recovery when retry is allowed without a concrete affordance", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        goal_satisfaction_evaluation: {
          satisfaction: "unsatisfied",
          missing_requirement_ids: ["scholarly_pdf_cache_unavailable"],
        },
        agent_loop_budget: budget(),
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation",
      trigger: "post_attempt",
      lastAttempt: {
        attempt_id: "attempt:image-lens-page-2",
        capability_id: "visual_analysis.inspect_image_region",
        status: "failed",
        failure_class: "missing_evidence",
        failure_code: "scholarly_pdf_cache_unavailable",
        failure_message:
          "Fetch the exact paper full text before rendering page 2.",
        retryability: "retryable",
      },
    });

    expect(state.allowed_decisions).toEqual(["retry"]);
    expect(state.next_admissible_affordances).toEqual([]);
    const runtimeText = formatHelixAgentContinuationStateForRuntime(state);
    expect(runtimeText).toContain(
      "propose exactly one bounded recovery capability",
    );
    expect(runtimeText).toContain(
      "Helix must independently admit the capability and arguments",
    );
    expect(runtimeText).not.toContain(
      "Tools and retries require an admitted affordance",
    );
  });

  it("treats the hard boundary as a resource stop while retaining answer authority", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["more_evidence"],
      },
      agent_loop_budget: budget({
        hard_max_iterations: 3,
        hard_max_tool_calls: 1,
        hard_max_llm_decisions: 3,
        consumed_iterations: 3,
        consumed_tool_calls: 1,
        consumed_llm_decisions: 3,
      }),
      current_turn_artifact_ledger: [],
    };
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "final_review",
    });

    expect(state.budget.hard.exhausted).toBe(true);
    expect(state.allowed_decisions).toEqual(
      expect.arrayContaining(["answer", "fail"]),
    );
    expect(
      resolveHelixContinuationBudgetExtension({
        state,
        current: { iterations: 3, tool_calls: 1, model_decisions: 3 },
        hard: { iterations: 3, tool_calls: 1, model_decisions: 3 },
      }),
    ).toMatchObject({
      extend: false,
      reason: "hard_resource_boundary_exhausted",
    });
  });

  it("does not advertise a retry after the bounded provider continuation exhausted its hard step budget", () => {
    const payload: Record<string, unknown> = {
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["R3", "R4"],
      },
      runtime_lane_request_loop: {
        generic_provider_continuation: {
          schema: "helix.generic_provider_selected_continuation.v1",
          max_steps: 12,
          step_count: 10,
          stop_reason: "budget_exhausted",
          pending_request: {
            capability_id: "com.casimirbot.minecraft.player.sequence.execute",
          },
        },
      },
      current_turn_artifact_ledger: [],
    };
    const rejection = buildHelixTerminalRejectionObservation({
      turnId: "ask:continuation",
      candidateKind: "direct_answer_text",
      reason: "solver_continuation_pending",
    });
    const state = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "terminal_rejection",
      lastAttempt: rejection,
    });

    expect(state.budget.hard).toMatchObject({
      exhausted: true,
      tool_calls: { max: 12, consumed: 12, remaining: 0 },
    });
    expect(state.allowed_decisions).toContain("fail");
    expect(state.allowed_decisions).not.toContain("retry");
    expect(state.progress.reason_codes).toContain(
      "hard_resource_boundary_exhausted",
    );
  });

  it("does not advertise a retry after the provider exhausted bounded terminal repair reviews", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        goal_satisfaction_evaluation: {
          satisfaction: "unsatisfied",
          missing_requirement_ids: ["R3", "R4"],
        },
        runtime_lane_request_loop: {
          generic_provider_continuation: {
            schema: "helix.generic_provider_selected_continuation.v1",
            max_steps: 12,
            step_count: 10,
            stop_reason: "no_next_request",
            pending_request: null,
            terminal_reviewed: true,
            terminal_review_count: 6,
            max_terminal_reviews: 2,
            terminal_review_limit_exhausted: true,
          },
        },
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation",
      trigger: "terminal_rejection",
      lastAttempt: buildHelixTerminalRejectionObservation({
        turnId: "ask:continuation",
        candidateKind: "direct_answer_text",
        reason: "solver_continuation_pending",
      }),
    });

    expect(state.budget.hard.exhausted).toBe(true);
    expect(state.allowed_decisions).toContain("fail");
    expect(state.allowed_decisions).not.toContain("retry");
    expect(state.progress.reason_codes).toContain(
      "hard_resource_boundary_exhausted",
    );
  });

  it("mirrors an authorized provider route product as terminal-product allowed", () => {
    const state = buildHelixAgentContinuationState({
      payload: {
        final_status: "final_answer",
        route_evidence_authority: {
          terminal_product_allowed: false,
        },
        provider_terminal_authority_bridge: {
          schema: "helix.provider_terminal_authority_bridge.v1",
          terminal_authority_granted: true,
          final_visible_answer_authorized: true,
        },
        current_turn_artifact_ledger: [],
      },
      turnId: "ask:continuation",
      trigger: "final_review",
    });

    expect(state.goal).toEqual({
      status: "satisfied",
      satisfied: true,
      terminal_product_allowed: true,
    });
  });

  it("bounds continuation and rejection histories without dropping domain observations", () => {
    const payload: Record<string, unknown> = {
      debug: {},
      goal_satisfaction_evaluation: {
        satisfaction: "unsatisfied",
        missing_requirement_ids: ["answer"],
      },
      agent_loop_budget: budget(),
      current_turn_artifact_ledger: [
        artifact({
          id: "ask:continuation:domain:1",
          kind: "doc_evidence_observation",
        }),
      ],
    };
    const seed = buildHelixAgentContinuationState({
      payload,
      turnId: "ask:continuation",
      trigger: "initial",
    });

    for (let index = 0; index < 30; index += 1) {
      appendHelixAgentContinuationStateToPayload({
        payload,
        state: {
          ...seed,
          state_id: `ask:continuation:agent_continuation_state:${index + 1}`,
          sequence: index + 1,
        },
      });
    }
    for (let index = 0; index < 15; index += 1) {
      appendHelixTerminalRejectionObservationToPayload({
        payload,
        observation: buildHelixTerminalRejectionObservation({
          turnId: "ask:continuation",
          candidateKind: "provider_terminal_candidate",
          candidateRef: `candidate:${index + 1}`,
          reason: "missing_post_tool_model_step",
        }),
      });
    }

    const states = payload.agent_continuation_states as Array<
      Record<string, unknown>
    >;
    const rejections = payload.terminal_rejection_observations as Array<
      Record<string, unknown>
    >;
    const ledger = payload.current_turn_artifact_ledger as Array<
      Record<string, unknown>
    >;
    expect(states).toHaveLength(24);
    expect(states[0]?.sequence).toBe(7);
    expect(rejections).toHaveLength(12);
    expect(
      ledger.filter((entry) => entry.kind === "agent_continuation_state"),
    ).toHaveLength(24);
    expect(
      ledger.filter((entry) => entry.kind === "terminal_rejection_observation"),
    ).toHaveLength(12);
    expect(ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifact_id: "ask:continuation:domain:1" }),
      ]),
    );
  });
});
