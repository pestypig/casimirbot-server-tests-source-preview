import { describe, expect, it } from "vitest";

import { buildArtifactQueryIndex } from "../artifact-query-index";
import { createHelixTurnLifecycleRecorder } from "../runtime/turn-lifecycle";

const buildVerifiedLifecycle = (
  turnId: string,
  observationRef: string,
  capability: string,
) => {
  const routeCommitId = `route:${capability}`;
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
  const route = recorder.append({
    kind: "route.committed",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: started.event_id,
    route_commit_id: routeCommitId,
    capability_ids: [capability],
  });
  const admitted = recorder.append({
    kind: "capability.admitted",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: route.event_id,
    route_commit_id: routeCommitId,
    capability_id: capability,
  });
  const call = recorder.append({
    kind: "tool.call.started",
    producer: "codex_runtime",
    status: "started",
    causation_id: admitted.event_id,
    route_commit_id: routeCommitId,
    call_id: `call:${capability}`,
    capability_id: capability,
  });
  const completed = recorder.append({
    kind: "tool.call.completed",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: call.event_id,
    route_commit_id: routeCommitId,
    call_id: `call:${capability}`,
    capability_id: capability,
    observation_refs: [observationRef],
  });
  const reentered = recorder.append({
    kind: "observation.reentered",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: completed.event_id,
    route_commit_id: routeCommitId,
    call_id: `call:${capability}`,
    capability_id: capability,
    observation_refs: [observationRef],
  });
  const message = recorder.append({
    kind: "agent.message.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: reentered.event_id,
    native_item_id: "agent-message:docs",
    message_sha256: "hash:docs",
  });
  const runtime = recorder.append({
    kind: "runtime.turn.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: message.event_id,
    native_turn_id: "native-turn:docs",
  });
  const eligibility = recorder.append({
    kind: "terminal.eligibility.checked",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: runtime.event_id,
    terminal_kind: "model_synthesized_answer",
    terminal_eligible: true,
  });
  recorder.append({
    kind: "turn.completed",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: eligibility.event_id,
    terminal_kind: "model_synthesized_answer",
    terminal_eligible: true,
  });
  return recorder.snapshot();
};

describe("artifact query index runtime re-entry authority", () => {
  it("keeps a runtime-verified connector-offline typed failure off the terminal-materializer rail", () => {
    const turnId = "ask:test:connector-offline-typed-failure-rail";
    const capability = "com.casimirbot.minecraft.inventory.check";
    const observationRef = `${turnId}:workstation_gateway:${capability}:1`;
    const lifecycle = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "codex_native_provider_cycle",
      now: () => 200,
    });
    const started = lifecycle.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const route = lifecycle.append({
      kind: "route.committed",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: started.event_id,
      route_commit_id: "route:live_environment",
      capability_ids: [capability],
    });
    const rejected = lifecycle.append({
      kind: "tool.call.rejected",
      producer: "helix_policy",
      status: "blocked",
      causation_id: route.event_id,
      route_commit_id: "route:live_environment",
      call_id: `call:${capability}`,
      capability_id: capability,
      observation_refs: [observationRef],
      reason_code: "connector_offline",
    });
    const reentered = lifecycle.append({
      kind: "observation.reentered",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: rejected.event_id,
      route_commit_id: "route:live_environment",
      call_id: `call:${capability}`,
      capability_id: capability,
      observation_refs: [observationRef],
    });
    const message = lifecycle.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: reentered.event_id,
      message_sha256: "hash:connector-offline",
    });
    const completed = lifecycle.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });
    const eligibility = lifecycle.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_terminal_authority",
      status: "succeeded",
      causation_id: completed.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: true,
    });
    lifecycle.append({
      kind: "turn.failed",
      producer: "helix_adapter",
      status: "failed",
      causation_id: eligibility.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: true,
      reason_code: "connector_offline",
    });

    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Check my current Minecraft inventory.",
        response_type: "final_failure",
        final_status: "final_failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_error_code: "connector_offline",
        typed_failure: {
          schema: "helix.typed_failure.v1",
          error_code: "connector_offline",
          message:
            "No currently credentialed, registry-admitted Minecraft connector is available for the bound room.",
          assistant_answer: false,
          raw_content_included: false,
        },
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          target_source: "live_environment",
          target_kind: "live_environment",
          strength: "hard",
          must_enter_backend_ask: true,
          allow_client_shortcut: false,
          allow_no_tool_direct: false,
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          source_target: "live_environment",
          required_terminal_artifact_kind: "model_synthesized_answer",
          allowed_terminal_artifact_kinds: [
            "model_synthesized_answer",
            "typed_failure",
          ],
          forbidden_terminal_artifact_kinds: [],
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          requested_capability: capability,
          admitted_capability: capability,
          requested_capability_family: "live_environment",
          requested_capability_source: "explicit_user_command",
          required_observation_kinds_for_requested_capability: [
            "provider_gateway_observation_packet",
          ],
        },
        capability_plan: {
          requested_capability: capability,
          selected_capability: capability,
          capability_family: "live_environment",
          admission_status: "admitted",
        },
        tool_lifecycle_trace: {
          schema: "helix.tool_lifecycle_trace.v1",
          requested_capability: capability,
          admitted_capability: capability,
          executed_capability: capability,
          lifecycle_stage: "completed",
          observation_refs: [observationRef],
        },
        runtime_tool_call: {
          capability_key: capability,
          status: "failed",
        },
        loop_parity_trace: {
          schema: "helix.loop_parity_trace.v1",
          selected_route: "/ask/turn/stream",
          actual_tool_calls: [
            { tool_id: capability, result_ref: observationRef },
          ],
          observations_created: [
            {
              observation_id: observationRef,
              source_kind: "provider_gateway_observation_packet",
            },
          ],
          route_authority_ok: true,
        },
        turn_lifecycle: lifecycle.snapshot(),
        route_authority_audit: { route_authority_ok: true },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          terminal_artifact_kind: "typed_failure",
          server_authoritative: true,
        },
        terminal_authority_single_writer: {
          schema: "helix.terminal_authority_single_writer_result.v1",
          selected_terminal_artifact_kind: "typed_failure",
          selected_terminal_artifact_ref: `${turnId}:typed_failure:connector_offline`,
          source: "typed_failure",
          integrity: { single_writer_applied: true },
        },
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          terminal_artifact_kind: "typed_failure",
          final_answer_source: "typed_failure",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: observationRef,
            kind: "provider_gateway_observation_packet",
            payload_schema: "helix.agent_step_observation_packet.v1",
            capability_key: capability,
            status: "failed",
            error_code: "connector_offline",
          },
          {
            artifact_id: `${turnId}:typed_failure:connector_offline`,
            kind: "typed_failure",
            payload: {
              schema: "helix.typed_failure.v1",
              error_code: "connector_offline",
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      observation_ref: observationRef,
      reentry_proven: true,
      materialized_terminal_artifact_kind: "typed_failure",
      terminal_authority_kind: "typed_failure",
      visible_terminal_kind: "typed_failure",
      rail_status: "complete",
      rail_failure_code: null,
      terminal_eligible: false,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      reentry_status: "reentered",
      selected_terminal_kind: "typed_failure",
      visible_terminal_kind: "typed_failure",
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
      terminal_eligible: false,
    });
  });

  it("keeps an observed requested action authoritative across a later supporting inspection", () => {
    const turnId = "ask:test:minecraft-inspect-act-chain";
    const commandCapability = "com.casimirbot.minecraft.command";
    const spatialCapability =
      "com.casimirbot.minecraft.spatial_region.inspect";
    const commandRef = `${turnId}:workstation_gateway:${commandCapability}:1`;
    const failedSpatialRef = `${turnId}:workstation_gateway:${spatialCapability}:2`;
    const successfulSpatialRef = `${turnId}:workstation_gateway:${spatialCapability}:3`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt:
          "Inspect, build a wall with Minecraft commands, then inspect again.",
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: turnId,
          requested_capability: commandCapability,
          admitted_capability: commandCapability,
          requested_capability_family: "live_environment",
          requested_capability_source: "explicit_user_command",
          requested_capability_confidence: 0.99,
          required_observation_kinds_for_requested_capability: [
            "provider_gateway_observation_packet",
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: turnId,
          requested_capability: commandCapability,
          selected_capability: spatialCapability,
          capability_family: "live_environment",
          admission_status: "admitted",
        },
        tool_lifecycle_trace: {
          schema: "helix.tool_lifecycle_trace.v1",
          turn_id: turnId,
          requested_capability: spatialCapability,
          admitted_capability: spatialCapability,
          executed_capability: spatialCapability,
          lifecycle_stage: "completed",
          status: "completed",
          observation_refs: [successfulSpatialRef],
        },
        runtime_tool_call: {
          capability_key: spatialCapability,
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: commandRef,
            kind: "provider_gateway_observation_packet",
            payload_schema: "helix.agent_step_observation_packet.v1",
            capability_key: commandCapability,
            status: "succeeded",
          },
          {
            artifact_id: failedSpatialRef,
            kind: "provider_gateway_observation_packet",
            payload_schema: "helix.agent_step_observation_packet.v1",
            capability_key: spatialCapability,
            status: "failed",
          },
          {
            artifact_id: successfulSpatialRef,
            kind: "provider_gateway_observation_packet",
            payload_schema: "helix.agent_step_observation_packet.v1",
            capability_key: spatialCapability,
            status: "succeeded",
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: commandCapability,
      selected_capability: spatialCapability,
      executed_capability: spatialCapability,
      requested_selected_match: true,
      observed_multi_step_transition_authorized: true,
      observation_ref: successfulSpatialRef,
    });
    expect(index.tool_turn_chain_audit?.rail_failure_code).not.toBe(
      "explicit_capability_not_selected",
    );
  });

  it("does not downgrade verified native observation re-entry to a missing compatibility projection", () => {
    const turnId = "ask:test:docs-native-reentry";
    const gatewayObservationRef = `${turnId}:workstation_gateway:docs.search:1`;
    const normalizedObservationRef = `${turnId}:codex_normalized:doc_search_results:1`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Can you explain what this paper is about?",
        native_provider_turn_lifecycle: buildVerifiedLifecycle(
          turnId,
          gatewayObservationRef,
          "docs.search",
        ),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: turnId,
          capability_family: "docs_viewer",
          requested_action: "docs.search",
          selected_capability: "docs.search",
          admission_status: "admitted",
          required_terminal_kind: "model_synthesized_answer",
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: turnId,
          requested_capability: "docs.search",
          admitted_capability: "docs.search",
          required_observation_kinds_for_requested_capability: ["doc_search_results"],
          assistant_answer: false,
          raw_content_included: false,
        },
        runtime_tool_call: {
          capability_key: "docs.search",
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: normalizedObservationRef,
            kind: "doc_search_results",
            payload: {
              schema: "helix.doc_search_results.v1",
              capability_key: "docs.search",
              provider_gateway_observation_ref: gatewayObservationRef,
              document_path: "docs/research/nhm2-current-status-whitepaper.md",
              excerpt: "NHM2 is a bounded same-chart lapse-shift diagnostic framework.",
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "docs.search",
      selected_capability: "docs.search",
      executed_capability: "docs.search",
      observation_ref: normalizedObservationRef,
      reentry_executed: true,
      reentry_proven: true,
      reentry_proof_source: "runtime_event_log.observation_reentered",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      reentry_status: "reentered",
      reentry_proven: true,
    });
  });

  it("keeps a compound Docs search rail complete when results exist without an opened-document retrieval context", () => {
    const turnId = "ask:test:compound-docs-search-with-external-failure";
    const docsObservationRef = `${turnId}:codex_normalized:doc_search_results:1`;
    const scholarlyObservationRef = `${turnId}:codex_normalized:scholarly_research_observation:2`;
    const docsSubgoal = {
      subgoal_id: `${turnId}:subgoal:docs`,
      order: 1,
      requested_capability: "docs.search",
      runtime_capability: "docs.search",
      selected_capability: "docs.search",
      executed_capability: "docs.search",
      required_observation_kinds: ["doc_search_results", "retrieval_context"],
      observation_kind: "doc_search_results",
      observation_ref: docsObservationRef,
      satisfaction: "satisfied",
      rail_status: "complete",
    };
    const scholarlySubgoal = {
      subgoal_id: `${turnId}:subgoal:scholarly`,
      order: 2,
      requested_capability: "scholarly-research.lookup_papers",
      runtime_capability: "scholarly-research.lookup_papers",
      selected_capability: "scholarly-research.lookup_papers",
      executed_capability: "scholarly-research.lookup_papers",
      required_observation_kinds: ["scholarly_research_observation"],
      observation_kind: "scholarly_research_observation",
      observation_ref: scholarlyObservationRef,
      satisfaction: "not_satisfied",
      rail_status: "fail_closed",
      rail_failure_code: "semantic_scholar_http_429",
    };
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Find the local whitepaper and compare it with a primary paper.",
        terminal_artifact_kind: "typed_failure",
        capability_itinerary: {
          compound_capability_contract: {
            subgoal_identity_policy: "provider_call_occurrence",
            subgoals: [docsSubgoal, scholarlySubgoal],
          },
        },
        capability_itinerary_execution_state: {
          compound_subgoal_ledger: [docsSubgoal, scholarlySubgoal],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: docsObservationRef,
            kind: "doc_search_results",
            capability_key: "docs.search",
            status: "succeeded",
            payload: {
              schema: "helix.doc_search_results.v1",
              capability_key: "docs.search",
              matches: [{ path: "docs/research/nhm2-current-status-whitepaper.md" }],
            },
          },
          {
            artifact_id: scholarlyObservationRef,
            kind: "scholarly_research_observation",
            capability_key: "scholarly-research.lookup_papers",
            status: "failed",
            payload: { status: "failed", error: "semantic_scholar_http_429" },
          },
        ],
      },
    });

    expect(index.compound_subgoal_rail_statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requested_capability: "docs.search",
        rail_status: "complete",
        rail_failure_code: null,
        observation_ref: docsObservationRef,
      }),
      expect.objectContaining({
        requested_capability: "scholarly-research.lookup_papers",
        rail_status: "complete",
        observation_ref: scholarlyObservationRef,
      }),
    ]));
  });

  it("reconciles a registered docs runtime capability with its requested canonical capability", () => {
    const turnId = "ask:test:docs-runtime-alias-reentry";
    const requestedCapability = "docs-viewer.search_docs";
    const runtimeCapability = "docs.search";
    const gatewayObservationRef = `${turnId}:workstation_gateway:${runtimeCapability}:1`;
    const normalizedObservationRef = `${turnId}:codex_normalized:doc_search_results:1`;
    const retrievalContextRef = `${turnId}:codex_normalized:retrieval_context:1`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Use the docs viewer to search the current document set.",
        native_provider_turn_lifecycle: buildVerifiedLifecycle(
          turnId,
          gatewayObservationRef,
          runtimeCapability,
        ),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: turnId,
          capability_family: "docs_viewer",
          requested_capability: requestedCapability,
          requested_action: requestedCapability,
          selected_capability: runtimeCapability,
          admission_status: "admitted",
          required_terminal_kind: "model_synthesized_answer",
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: turnId,
          requested_capability: requestedCapability,
          admitted_capability: runtimeCapability,
          required_observation_kinds_for_requested_capability: [
            "doc_search_results",
            "retrieval_context",
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        runtime_tool_call: {
          capability_key: runtimeCapability,
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: normalizedObservationRef,
            kind: "doc_search_results",
            capability_key: runtimeCapability,
            source_capability_id: runtimeCapability,
            provider_gateway_observation_ref: gatewayObservationRef,
            payload: {
              schema: "helix.doc_search_results.v1",
              capability_key: runtimeCapability,
              source_capability_id: runtimeCapability,
              matches: [],
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          },
          {
            artifact_id: retrievalContextRef,
            kind: "retrieval_context",
            capability_key: runtimeCapability,
            source_capability_id: runtimeCapability,
            payload: {
              schema: "helix.retrieval_context.v1",
              capability_key: runtimeCapability,
              source_capability_id: runtimeCapability,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: requestedCapability,
      selected_capability: runtimeCapability,
      executed_capability: runtimeCapability,
      requested_selected_match: true,
      observed_artifact_supports_requested_capability: true,
      observation_ref: normalizedObservationRef,
      reentry_executed: true,
      reentry_proven: true,
      reentry_proof_source: "runtime_event_log.observation_reentered",
    });
  });

  it("treats tool-family observation catalogs as alternative evidence kinds", () => {
    const turnId = "ask:test:repo-family-observation-alternative";
    const capability = "repo.search";
    const gatewayObservationRef = `${turnId}:workstation_gateway:${capability}:1`;
    const normalizedObservationRef =
      `${turnId}:codex_normalized:repo_code_evidence_observation:1`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Find where the workstation status route is implemented.",
        native_provider_turn_lifecycle: buildVerifiedLifecycle(
          turnId,
          gatewayObservationRef,
          capability,
        ),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: turnId,
          capability_family: "repo_code",
          requested_action: capability,
          selected_capability: capability,
          admission_status: "admitted",
          required_terminal_kind: "repo_code_evidence_answer",
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: turnId,
          requested_capability: capability,
          admitted_capability: capability,
          required_observation_kinds_for_requested_capability: [
            "repo_code_evidence_observation",
            "repo_code_search_result",
            "repo_evidence_relevance_gate",
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        runtime_tool_call: {
          capability_key: capability,
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: normalizedObservationRef,
            kind: "repo_code_evidence_observation",
            capability_key: capability,
            source_capability_id: capability,
            provider_gateway_observation_ref: gatewayObservationRef,
            payload: {
              schema: "helix.repo_code_evidence_observation.v1",
              capability_key: capability,
              source_capability_id: capability,
              matches: [
                {
                  path: "server/routes/agi.plan.ts",
                  excerpt: "workspace_os.status",
                },
              ],
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.required_observation_coverage_mode).toBe("any");
    expect(index.missing_required_observation_kinds).toEqual([]);
    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: capability,
      selected_capability: capability,
      executed_capability: capability,
      observed_artifact_supports_requested_capability: true,
      observation_ref: normalizedObservationRef,
      reentry_executed: true,
      reentry_proven: true,
    });
    expect(index.tool_turn_chain_audit.rail_failure_code).not.toBe(
      "required_observation_missing",
    );
  });

  it("reconciles the live-shaped theory procedure observation by exact structured identity", () => {
    const turnId = "ask:test:theory-procedure-native-reentry";
    const capability = "theory-experiment-procedure.prepare";
    const gatewayObservationRef = `${turnId}:workstation_gateway:${capability}:receipt`;
    const normalizedObservationRef =
      `${turnId}:codex_normalized:theory_experiment_procedure_observation:1`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt:
          "Prepare a first-principles comparison procedure for two selected theory badges.",
        native_provider_turn_lifecycle: buildVerifiedLifecycle(
          turnId,
          gatewayObservationRef,
          capability,
        ),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: turnId,
          capability_family: "workstation",
          requested_action: capability,
          selected_capability: capability,
          admission_status: "admitted",
          required_terminal_kind: "model_synthesized_answer",
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: turnId,
          requested_capability: capability,
          admitted_capability: capability,
          required_observation_kinds_for_requested_capability: [
            "theory_experiment_procedure_observation",
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
        runtime_tool_call: {
          capability_key: capability,
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            schema: "helix.current_turn_artifact.v1",
            artifact_id: normalizedObservationRef,
            producer_item_id: `${gatewayObservationRef}:call`,
            kind: "provider_normalized_observation",
            observation_kind: "theory_experiment_procedure_observation",
            payload_schema: "casimir.theory_experiment_procedure.observation.v1",
            turn_id: turnId,
            capability_key: capability,
            source_capability_id: capability,
            provider_gateway_observation_ref: gatewayObservationRef,
            status: "succeeded",
            payload: {
              schema: "casimir.theory_experiment_procedure.observation.v1",
              status: "succeeded",
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: capability,
      selected_capability: capability,
      executed_capability: capability,
      observation_ref: normalizedObservationRef,
      required_observation_kinds_for_requested_capability:
        expect.arrayContaining([
          "theory_experiment_procedure_observation",
        ]),
      observed_artifact_supports_requested_capability: true,
      reentry_executed: true,
      reentry_proven: true,
      reentry_proof_source: "runtime_event_log.observation_reentered",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      executed_capability: capability,
      observation_ref: normalizedObservationRef,
      reentry_status: "reentered",
      reentry_proven: true,
    });
  });

  it("does not reconcile a near-name structured capability as the theory procedure observation", () => {
    const turnId = "ask:test:theory-procedure-capability-mismatch";
    const capability = "theory-experiment-procedure.prepare";
    const gatewayObservationRef = `${turnId}:workstation_gateway:${capability}:receipt`;
    const normalizedObservationRef =
      `${turnId}:codex_normalized:theory_experiment_procedure_observation:1`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Prepare the theory experiment procedure.",
        native_provider_turn_lifecycle: buildVerifiedLifecycle(
          turnId,
          gatewayObservationRef,
          capability,
        ),
        capability_plan: {
          requested_action: capability,
          selected_capability: capability,
          admission_status: "admitted",
        },
        tool_call_admission_decision: {
          requested_capability: capability,
          admitted_capability: capability,
          required_observation_kinds_for_requested_capability: [
            "theory_experiment_procedure_observation",
          ],
        },
        runtime_tool_call: {
          capability_key: capability,
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            schema: "helix.current_turn_artifact.v1",
            artifact_id: normalizedObservationRef,
            kind: "provider_normalized_observation",
            observation_kind: "theory_experiment_procedure_observation",
            payload_schema: "casimir.theory_experiment_procedure.observation.v1",
            turn_id: turnId,
            capability_key: `${capability}.preview`,
            source_capability_id: `${capability}.preview`,
            provider_gateway_observation_ref: gatewayObservationRef,
            payload: {
              schema: "casimir.theory_experiment_procedure.observation.v1",
              status: "succeeded",
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: capability,
      observation_ref: null,
      observed_artifact_supports_requested_capability: false,
      reentry_proven: false,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      observation_ref: null,
      reentry_status: "no_observation",
      reentry_proven: false,
    });
  });

  it.each([
    {
      label: "wrong payload schema",
      payloadSchema: "casimir.theory_experiment_procedure.preview.v1",
      nestedSchema: "casimir.theory_experiment_procedure.observation.v1",
    },
    {
      label: "missing payload schema",
      payloadSchema: null,
      nestedSchema: "casimir.theory_experiment_procedure.observation.v1",
    },
    {
      label: "conflicting nested payload schema",
      payloadSchema: "casimir.theory_experiment_procedure.observation.v1",
      nestedSchema: "casimir.theory_experiment_procedure.preview.v1",
    },
  ])("does not reconcile the canonical procedure kind with $label", ({
    label,
    payloadSchema,
    nestedSchema,
  }) => {
    const turnId = `ask:test:theory-procedure-schema-${label.replace(/\s+/g, "-")}`;
    const capability = "theory-experiment-procedure.prepare";
    const gatewayObservationRef = `${turnId}:workstation_gateway:${capability}:receipt`;
    const normalizedObservationRef =
      `${turnId}:codex_normalized:theory_experiment_procedure_observation:1`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Prepare the theory experiment procedure.",
        native_provider_turn_lifecycle: buildVerifiedLifecycle(
          turnId,
          gatewayObservationRef,
          capability,
        ),
        capability_plan: {
          requested_action: capability,
          selected_capability: capability,
          admission_status: "admitted",
        },
        tool_call_admission_decision: {
          requested_capability: capability,
          admitted_capability: capability,
          required_observation_kinds_for_requested_capability: [
            "theory_experiment_procedure_observation",
          ],
        },
        runtime_tool_call: {
          capability_key: capability,
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            schema: "helix.current_turn_artifact.v1",
            artifact_id: normalizedObservationRef,
            kind: "provider_normalized_observation",
            observation_kind: "theory_experiment_procedure_observation",
            ...(payloadSchema ? { payload_schema: payloadSchema } : {}),
            turn_id: turnId,
            capability_key: capability,
            source_capability_id: capability,
            provider_gateway_observation_ref: gatewayObservationRef,
            payload: {
              schema: nestedSchema,
              status: "succeeded",
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: capability,
      observation_ref: null,
      observed_artifact_supports_requested_capability: false,
      reentry_proven: false,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      observation_ref: null,
      reentry_status: "no_observation",
      reentry_proven: false,
    });
  });

  it("rejects conflicting structured identities even when one field is an exact match", () => {
    const turnId = "ask:test:theory-procedure-conflicting-identity";
    const capability = "theory-experiment-procedure.prepare";
    const conflictingCapability = `${capability}.preview`;
    const gatewayObservationRef = `${turnId}:workstation_gateway:${capability}:receipt`;
    const normalizedObservationRef =
      `${turnId}:codex_normalized:theory_experiment_procedure_observation:1`;
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        active_prompt: "Prepare the theory experiment procedure.",
        native_provider_turn_lifecycle: buildVerifiedLifecycle(
          turnId,
          gatewayObservationRef,
          capability,
        ),
        capability_plan: {
          requested_action: capability,
          selected_capability: capability,
          admission_status: "admitted",
        },
        tool_call_admission_decision: {
          requested_capability: capability,
          admitted_capability: capability,
          required_observation_kinds_for_requested_capability: [
            "theory_experiment_procedure_observation",
          ],
        },
        runtime_tool_call: {
          capability_key: capability,
          status: "completed",
        },
        current_turn_artifact_ledger: [
          {
            schema: "helix.current_turn_artifact.v1",
            artifact_id: normalizedObservationRef,
            kind: "provider_normalized_observation",
            observation_kind: "theory_experiment_procedure_observation",
            payload_schema: "casimir.theory_experiment_procedure.observation.v1",
            turn_id: turnId,
            capability_key: capability,
            source_capability_id: capability,
            provider_gateway_observation_ref: gatewayObservationRef,
            payload: {
              schema: "casimir.theory_experiment_procedure.observation.v1",
              capability_key: capability,
              source_capability_id: conflictingCapability,
              status: "succeeded",
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: capability,
      observation_ref: null,
      observed_artifact_supports_requested_capability: false,
      reentry_proven: false,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      observation_ref: null,
      reentry_status: "no_observation",
      reentry_proven: false,
    });
  });
});
