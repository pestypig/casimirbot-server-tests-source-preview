import { describe, expect, it } from "vitest";
import {
  attachHelixCapabilityItineraryExecutionState,
  buildHelixCapabilityItineraryExecutionState,
  isHelixCapabilityItineraryFamilyObserved,
} from "../capability-itinerary-execution";

describe("Helix capability itinerary execution", () => {
  it("accepts a successful visible-surface gateway observation as docs-viewer evidence", () => {
    const artifact = {
      artifact_id: "ask:test:docs-visible:observation",
      kind: "provider_gateway_observation_packet",
      capability_key: "docs-viewer.read_visible_surface",
      status: "succeeded",
      payload: {
        status: "succeeded",
        capability_id: "docs-viewer.read_visible_surface",
      },
    };

    expect(isHelixCapabilityItineraryFamilyObserved("docs_viewer", [artifact])).toBe(true);
  });

  it("requires a successful runtime-selected Player Embodiment action instead of accepting a read-only probe", () => {
    const playerLook = "com.casimirbot.minecraft.player.look";
    const playerWalk = "com.casimirbot.minecraft.player.walk";
    const actorStatus = "com.casimirbot.minecraft.actor_status.read";
    const itinerary = {
      turn_id: "ask:test:player-action-any-of",
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capability_any_of_groups: [
          {
            group_id: "minecraft.player_embodiment.action",
            semantic_requirement:
              "one_successful_player_embodiment_action_selected_by_runtime",
            capability_ids: [playerLook, playerWalk],
          },
        ],
      },
    };
    const observation = (capability: string, ref: string) => ({
      artifact_id: ref,
      kind: "live_environment_tool_observation",
      capability_key: capability,
      status: "succeeded",
      payload: {
        status: "succeeded",
        capability_id: capability,
      },
    });

    const readOnlyState = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [observation(actorStatus, "obs:actor-status")],
    });
    expect(readOnlyState).toMatchObject({
      complete: false,
      observed_families: ["live_environment"],
      missing_required_capability_any_of_groups: [
        {
          group_id: "minecraft.player_embodiment.action",
          satisfied: false,
        },
      ],
    });

    const actionState = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        observation(actorStatus, "obs:actor-status"),
        observation(playerLook, "obs:player-look"),
      ],
    });
    expect(actionState).toMatchObject({
      complete: true,
      missing_required_capability_any_of_groups: [],
      required_capability_any_of_groups: [
        {
          group_id: "minecraft.player_embodiment.action",
          satisfied: true,
          satisfied_capability_id: playerLook,
          observation_ref: "obs:player-look",
        },
      ],
    });
  });

  it("keeps a Player Embodiment action missing when a guardian only settles an immediate safety interrupt", () => {
    const turnId = "ask:test:guardian-transport-settled-without-action";
    const capability = "com.casimirbot.minecraft.player.guardian.execute";
    const subgoalId = `${turnId}:guardian:1`;
    const itinerary = {
      turn_id: turnId,
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capability_any_of_groups: [{
          group_id: "minecraft.player_embodiment.action",
          semantic_requirement:
            "one_successful_player_embodiment_action_selected_by_runtime",
          capability_ids: [capability],
        }],
      },
      compound_capability_contract: {
        subgoals: [{
          subgoal_id: subgoalId,
          requested_capability: capability,
          runtime_capability: capability,
          required_observation_kinds: ["live_environment_observation"],
          mandatory: true,
        }],
      },
    };
    const artifact = {
      artifact_id: `${turnId}:observation:1`,
      turn_id: turnId,
      source_scope: "current_turn_context",
      kind: "live_environment_observation",
      capability_key: capability,
      source_capability_id: capability,
      status: "succeeded",
      payload: {
        schema: "helix.live_environment_observation.v1",
        capability_key: capability,
        source_capability_id: capability,
        status: "succeeded",
        result: {
          side_effects_performed: false,
          player_motion_performed: false,
          player_interaction_performed: false,
          inventory_mutation_performed: false,
          world_mutation_performed: false,
          postconditions: [{
            condition_kind: "minecraft.player.reactive_program_completed",
            required: true,
            status: "satisfied",
            evidence_refs: ["event:workflow-settled"],
          }],
          verified_terminal_measurements: {
            reason_code: "reactive_program_interrupted",
            reactive_program_completed: true,
            tick_index: 0,
            executed_action_count: 0,
            action_receipt_count: 0,
            player_motion_performed: false,
            player_interaction_performed: false,
            placement_action_success_count: 0,
            placement_mutation_success_count: 0,
            world_mutations_performed: 0,
            inventory_mutations_performed: 0,
            satisfied_checkpoint_ids: [],
          },
        },
      },
    };

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [artifact],
    });

    expect(state).toMatchObject({
      complete: false,
      missing_required_capabilities: [capability],
      missing_compound_subgoal_ids: [subgoalId],
      missing_required_capability_any_of_groups: [{
        group_id: "minecraft.player_embodiment.action",
        satisfied: false,
      }],
      compound_subgoal_ledger: [expect.objectContaining({
        subgoal_id: subgoalId,
        satisfaction: "pending",
        rail_status: "pending",
        rail_failure_code: "subgoal_observation_missing",
      })],
    });
  });

  it("accepts the same canonical guardian envelope when current-turn measurements prove semantic action progress", () => {
    const turnId = "ask:test:guardian-semantic-action-progress";
    const capability = "com.casimirbot.minecraft.player.guardian.execute";
    const subgoalId = `${turnId}:guardian:1`;
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        turn_id: turnId,
        admitted_tool_families: ["live_environment"],
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capability_any_of_groups: [{
            group_id: "minecraft.player_embodiment.action",
            capability_ids: [capability],
          }],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: subgoalId,
            requested_capability: capability,
            runtime_capability: capability,
            required_observation_kinds: ["live_environment_observation"],
            mandatory: true,
          }],
        },
      },
      artifacts: [{
        artifact_id: `${turnId}:observation:1`,
        turn_id: turnId,
        source_scope: "current_turn_context",
        kind: "live_environment_observation",
        capability_key: capability,
        source_capability_id: capability,
        status: "succeeded",
        payload: {
          schema: "helix.live_environment_observation.v1",
          capability_key: capability,
          source_capability_id: capability,
          status: "succeeded",
          result: {
            side_effects_performed: true,
            player_motion_performed: true,
            player_interaction_performed: false,
            inventory_mutation_performed: false,
            world_mutation_performed: false,
            postconditions: [],
            verified_terminal_measurements: {
              reason_code: "reactive_program_completed",
              tick_index: 4,
              executed_action_count: 1,
              action_receipt_count: 1,
              player_motion_performed: true,
              satisfied_checkpoint_ids: ["checkpoint:step-off-complete"],
            },
          },
        },
      }],
    });

    expect(state).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      missing_compound_subgoal_ids: [],
      missing_required_capability_any_of_groups: [],
      compound_subgoal_ledger: [expect.objectContaining({
        subgoal_id: subgoalId,
        satisfaction: "satisfied",
        rail_status: "complete",
      })],
    });
  });

  it("requires a fresh post-action observation instead of reusing a pre-action read", () => {
    const action = "com.casimirbot.minecraft.player.navigate";
    const status = "com.casimirbot.minecraft.actor.status.read";
    const observation = (capability: string, ref: string) => ({
      artifact_id: ref,
      kind: "live_environment_observation",
      capability_key: capability,
      status: "succeeded",
      payload: { status: "succeeded", capability_id: capability },
    });
    const itinerary = {
      turn_id: "ask:test:post-action-status",
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capabilities: [status],
        required_capability_any_of_groups: [
          {
            group_id: "minecraft.player_embodiment.action",
            semantic_requirement:
              "one_successful_player_embodiment_action_selected_by_runtime",
            capability_ids: [action],
          },
        ],
      },
      compound_capability_contract: {
        subgoals: [
          {
            subgoal_id: "subgoal:post-status",
            order: 1,
            requested_capability: status,
            runtime_capability: status,
            required_observation_kinds: ["live_environment_observation"],
            observation_after_capability_any_of_group_ids: [
              "minecraft.player_embodiment.action",
            ],
            mandatory: true,
          },
        ],
      },
    };

    const beforeAction = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [observation(status, "obs:status:before")],
    });
    expect(beforeAction).toMatchObject({
      complete: false,
      missing_required_capabilities: [status],
      blocked_required_capabilities: [status],
      missing_temporal_postconditions: [
        expect.objectContaining({
          capability_id: status,
          temporal_dependencies_satisfied: false,
          rail_failure_code: "temporal_dependency_missing",
        }),
      ],
    });

    const actionWithoutFreshStatus =
      buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary: itinerary,
        artifacts: [
          observation(status, "obs:status:before"),
          observation(action, "obs:navigate"),
        ],
      });
    expect(actionWithoutFreshStatus).toMatchObject({
      complete: false,
      missing_required_capabilities: [status],
      blocked_required_capabilities: [],
      missing_required_capability_any_of_groups: [],
      missing_temporal_postconditions: [
        expect.objectContaining({
          capability_id: status,
          temporal_dependencies_satisfied: true,
          rail_failure_code: "post_dependency_observation_missing",
        }),
      ],
    });

    const verifiedAfterAction = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        observation(status, "obs:status:before"),
        observation(action, "obs:navigate"),
        observation(status, "obs:status:after"),
      ],
    });
    expect(verifiedAfterAction).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      blocked_required_capabilities: [],
      missing_temporal_postconditions: [],
      compound_subgoal_ledger: [
        expect.objectContaining({
          subgoal_id: "subgoal:post-status",
          observation_ref: "obs:status:after",
          satisfaction: "satisfied",
        }),
      ],
    });
  });

  it("does not mistake admission, stale, or contradictory evidence for a current-turn Player Embodiment action", () => {
    const turnId = "ask:test:strict-player-action-observation";
    const priorTurnId = "ask:test:prior-player-action";
    const spatial = "com.casimirbot.minecraft.spatial_region.inspect";
    const action = "com.casimirbot.minecraft.player.navigate";
    const status = "com.casimirbot.minecraft.actor.status.read";
    const observation = (
      capability: string,
      ref: string,
      artifactTurnId = turnId,
    ) => ({
      artifact_id: ref,
      turn_id: artifactTurnId,
      kind: "provider_gateway_observation_packet",
      capability_key: capability,
      source_capability_id: capability,
      status: "succeeded",
      payload: {
        status: "succeeded",
        capability_key: capability,
        source_capability_id: capability,
      },
    });
    const itinerary = {
      turn_id: turnId,
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capabilities: [status],
        required_capability_any_of_groups: [
          {
            group_id: "minecraft.player_embodiment.action",
            capability_ids: [action],
          },
        ],
      },
      compound_capability_contract: {
        subgoals: [
          {
            subgoal_id: "subgoal:post-action-status",
            requested_capability: status,
            runtime_capability: status,
            required_observation_kinds: [
              "provider_gateway_observation_packet",
            ],
            observation_after_capability_any_of_group_ids: [
              "minecraft.player_embodiment.action",
            ],
            mandatory: true,
          },
        ],
      },
    };
    const admissionOnly = {
      artifact_id: "evaluation:navigate",
      turn_id: turnId,
      kind: "workstation_tool_evaluation",
      capability_key: action,
      status: "completed",
      payload: {
        status: "completed",
        capability_key: action,
        supports_goal: true,
        authority: "agent_runtime_loop",
      },
    };
    const staleAction = {
      ...observation(action, "obs:navigate:prior", priorTurnId),
      source_scope: "prior_turn_context",
    };
    const contradictoryAction = {
      ...observation(action, "obs:navigate:contradictory"),
      payload: {
        status: "succeeded",
        capability_key: spatial,
        source_capability_id: spatial,
      },
    };

    const beforeAction = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        observation(spatial, "obs:spatial"),
        admissionOnly,
        staleAction,
        contradictoryAction,
      ],
    });
    expect(beforeAction).toMatchObject({
      complete: false,
      blocked_required_capabilities: [status],
      missing_required_capability_any_of_groups: [
        {
          group_id: "minecraft.player_embodiment.action",
          satisfied: false,
        },
      ],
      missing_temporal_postconditions: [
        expect.objectContaining({
          capability_id: status,
          temporal_dependencies_satisfied: false,
          rail_failure_code: "temporal_dependency_missing",
        }),
      ],
    });

    const afterAction = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        observation(spatial, "obs:spatial"),
        admissionOnly,
        observation(action, "obs:navigate:current"),
      ],
    });
    expect(afterAction).toMatchObject({
      complete: false,
      blocked_required_capabilities: [],
      missing_required_capability_any_of_groups: [],
      missing_temporal_postconditions: [
        expect.objectContaining({
          capability_id: status,
          temporal_dependencies_satisfied: true,
          rail_failure_code: "post_dependency_observation_missing",
        }),
      ],
    });

    const afterVerification = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        observation(spatial, "obs:spatial"),
        observation(action, "obs:navigate:current"),
        observation(status, "obs:status:after"),
      ],
    });
    expect(afterVerification).toMatchObject({
      complete: true,
      blocked_required_capabilities: [],
      missing_required_capability_any_of_groups: [],
      missing_temporal_postconditions: [],
    });
  });

  it("preserves a source-identified post-navigation status observation after an earlier failed attempt", () => {
    const turnId = "ask:test:source-identified-post-navigation-status";
    const spatial = "com.casimirbot.minecraft.spatial_region.inspect";
    const navigate = "com.casimirbot.minecraft.player.navigate";
    const status = "com.casimirbot.minecraft.actor.status.read";
    const observation = (
      capability: string,
      ref: string,
      outcome: "succeeded" | "failed" = "succeeded",
    ) => ({
      artifact_id: ref,
      turn_id: turnId,
      kind: "provider_gateway_observation_packet",
      source_capability_id: capability,
      source_scope: "current_turn_context",
      status: outcome,
      payload: {
        schema: "helix.live_environment_observation.v1",
        source_capability_id: capability,
        source_scope: "current_turn_context",
        status: outcome,
        observation_role: "evidence_not_assistant_answer",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });
    const itinerary = {
      turn_id: turnId,
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capabilities: [status],
        required_capability_any_of_groups: [{
          group_id: "minecraft.player_embodiment.action",
          capability_ids: [navigate],
        }],
      },
      compound_capability_contract: {
        subgoals: [{
          subgoal_id: "subgoal:spatial",
          order: 1,
          requested_capability: spatial,
          runtime_capability: spatial,
          required_observation_kinds: ["provider_gateway_observation_packet"],
          mandatory: true,
        }, {
          subgoal_id: "subgoal:navigate",
          order: 2,
          requested_capability: navigate,
          runtime_capability: navigate,
          required_observation_kinds: ["provider_gateway_observation_packet"],
          mandatory: true,
        }, {
          subgoal_id: "subgoal:post-status",
          order: 3,
          requested_capability: status,
          runtime_capability: status,
          required_observation_kinds: ["provider_gateway_observation_packet"],
          observation_after_capability_any_of_group_ids: [
            "minecraft.player_embodiment.action",
          ],
          mandatory: true,
        }],
      },
    };

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [
        observation(spatial, "obs:spatial"),
        observation(navigate, "obs:navigate:failed", "failed"),
        observation(navigate, "obs:navigate:succeeded"),
        observation(status, "obs:status:after"),
      ],
    });

    expect(state).toMatchObject({
      complete: true,
      observed_families: ["live_environment"],
      missing_required_capabilities: [],
      missing_required_capability_any_of_groups: [],
      missing_temporal_postconditions: [],
      compound_subgoal_ledger: [
        expect.objectContaining({
          requested_capability: spatial,
          satisfaction: "satisfied",
        }),
        expect.objectContaining({
          requested_capability: navigate,
          observation_ref: "obs:navigate:succeeded",
          satisfaction: "satisfied",
        }),
        expect.objectContaining({
          requested_capability: status,
          observation_ref: "obs:status:after",
          satisfaction: "satisfied",
        }),
      ],
    });
  });

  it("reconciles a successful Minecraft action observation with its committed arguments", () => {
    const capability = "com.casimirbot.minecraft.player.walk";
    const itinerary = {
      turn_id: "ask:test:player-walk-argument-reconciliation",
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capabilities: [capability],
      },
      compound_capability_contract: {
        source: "committed_route_compound_projection",
        subgoals: [{
          subgoal_id: "planned:walk",
          order: 1,
          requested_capability: capability,
          runtime_capability: capability,
          args_hint: {
            direction: "forward",
            duration_ms: 250,
            sprint: false,
          },
          required_args: ["direction", "duration_ms", "sprint"],
          required_observation_kinds: ["live_environment_observation"],
          mandatory: true,
        }],
      },
    };
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: itinerary,
      artifacts: [{
        artifact_id: "obs:walk",
        kind: "live_environment_observation",
        capability_key: capability,
        status: "succeeded",
        executed_args: {
          direction: "forward",
          duration_ms: 250,
          sprint: false,
          idempotent_replay: false,
          physical_execution_performed: true,
        },
        payload: { status: "succeeded" },
      }],
    });
    expect(state).toMatchObject({
      complete: true,
      missing_compound_subgoal_ids: [],
      missing_required_capabilities: [],
      compound_subgoal_ledger: [{
        subgoal_id: "planned:walk",
        satisfaction: "satisfied",
        args_source: "contract_hint_reconciled_with_observation",
        selected_args: {
          direction: "forward",
          duration_ms: 250,
          sprint: false,
        },
      }],
    });
  });

  it("binds repeated capability subgoals to their exact provider-call observation refs", () => {
    const capability = "com.casimirbot.minecraft.command";
    const observation = (ref: string, callId: string) => ({
      artifact_id: ref,
      producer_item_id: callId,
      kind: "environment_command_observation",
      capability_key: capability,
      status: "succeeded",
      payload: {
        schema: "helix.environment_command.observation.v1",
        status: "succeeded",
      },
    });
    const capabilityItinerary = {
      turn_id: "ask:test:occurrence-binding",
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capabilities: [capability],
      },
      compound_capability_contract: {
        subgoal_identity_policy: "provider_call_occurrence",
        subgoals: [
          {
            subgoal_id: "subgoal:checkpoint",
            requested_capability: capability,
            runtime_capability: capability,
            selected_capability: capability,
            executed_capability: capability,
            provider_call_id: "call:checkpoint",
            capability_occurrence: 1,
            observation_ref: "obs:checkpoint",
            support_refs: ["obs:checkpoint", "packet:checkpoint"],
            required_args: [],
            required_observation_kinds: ["environment_command_observation"],
          },
          {
            subgoal_id: "subgoal:fill",
            requested_capability: capability,
            runtime_capability: capability,
            selected_capability: capability,
            executed_capability: capability,
            provider_call_id: "call:fill",
            capability_occurrence: 2,
            observation_ref: "obs:fill",
            support_refs: ["obs:fill", "packet:fill"],
            required_args: [],
            required_observation_kinds: ["environment_command_observation"],
          },
        ],
      },
    };
    const artifacts = [
      observation("obs:checkpoint", "call:checkpoint"),
      observation("obs:fill", "call:fill"),
    ];

    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary,
      artifacts,
    });
    expect(state.complete).toBe(true);
    expect(state.compound_subgoal_ledger.map((entry) => entry.observation_ref)).toEqual([
      "obs:checkpoint",
      "obs:fill",
    ]);
    expect(state.compound_subgoal_ledger[1].support_refs).toEqual(
      expect.arrayContaining(["obs:fill", "packet:fill"]),
    );

    const missingFill = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary,
      artifacts: [artifacts[0]],
    });
    expect(missingFill.complete).toBe(false);
    expect(missingFill.compound_subgoal_ledger[1]).toMatchObject({
      observation_ref: null,
      satisfaction: "pending",
    });
  });

  it("replaces a stale itinerary contract with the current occurrence-aware provider contract", () => {
    const capability = "com.casimirbot.minecraft.command";
    const payload: Record<string, unknown> = {
      capability_itinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capabilities: [capability],
        },
        compound_capability_contract: {
          source: "pre_gateway_static_plan",
          subgoals: [{
            subgoal_id: "stale:command",
            requested_capability: capability,
            runtime_capability: capability,
          }],
        },
      },
      compound_capability_contract: {
        source: "codex_provider_call_occurrence_normalization",
        subgoal_identity_policy: "provider_call_occurrence",
        subgoals: [
          {
            subgoal_id: "current:checkpoint",
            requested_capability: capability,
            runtime_capability: capability,
            selected_capability: capability,
            executed_capability: capability,
            observation_ref: "obs:checkpoint",
            required_observation_kinds: ["environment_command_observation"],
          },
          {
            subgoal_id: "current:fill",
            requested_capability: capability,
            runtime_capability: capability,
            selected_capability: capability,
            executed_capability: capability,
            observation_ref: "obs:fill",
            required_observation_kinds: ["environment_command_observation"],
          },
        ],
      },
    };
    const artifacts = ["checkpoint", "fill"].map((name) => ({
      artifact_id: `obs:${name}`,
      kind: "environment_command_observation",
      capability_key: capability,
      payload: { status: "succeeded" },
    }));

    expect(
      attachHelixCapabilityItineraryExecutionState(payload, artifacts),
    ).toEqual([]);
    expect((payload.capability_itinerary as any).compound_capability_contract).toMatchObject({
      subgoal_identity_policy: "provider_call_occurrence",
    });
    expect((payload.capability_itinerary_execution_state as any).compound_subgoal_ledger.map(
      (entry: any) => entry.observation_ref,
    )).toEqual(["obs:checkpoint", "obs:fill"]);
  });

  it("preserves an unrepresented mandatory compound subgoal across provider-call normalization", () => {
    const payload: Record<string, unknown> = {
      capability_itinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["docs_viewer", "scholarly_research"],
          required_capabilities: ["docs.search", "scholarly-research.lookup_papers"],
        },
        compound_capability_contract: {
          source: "committed_route_compound_projection",
          subgoals: [
            {
              subgoal_id: "planned:docs",
              order: 1,
              requested_capability: "docs.search",
              runtime_capability: "docs.search",
              required_observation_kinds: ["doc_search_results"],
              mandatory: true,
              satisfaction: "pending",
            },
            {
              subgoal_id: "planned:scholarly",
              order: 2,
              requested_capability: "scholarly-research.lookup_papers",
              runtime_capability: "scholarly-research.lookup_papers",
              required_observation_kinds: ["scholarly_research_observation"],
              mandatory: true,
              satisfaction: "pending",
            },
          ],
        },
      },
      compound_capability_contract: {
        source: "codex_provider_call_occurrence_normalization",
        subgoal_identity_policy: "provider_call_occurrence",
        subgoals: [{
          subgoal_id: "current:scholarly:1",
          order: 1,
          requested_capability: "scholarly-research.lookup_papers",
          runtime_capability: "scholarly-research.lookup_papers",
          provider_call_id: "call:scholarly:1",
          capability_occurrence: 1,
          observation_ref: "obs:scholarly:1",
          required_observation_kinds: ["scholarly_research_observation"],
          satisfied: true,
        }],
      },
    };

    attachHelixCapabilityItineraryExecutionState(payload, [{
      artifact_id: "obs:scholarly:1",
      kind: "scholarly_research_observation",
      capability_key: "scholarly-research.lookup_papers",
      payload: { status: "succeeded" },
    }]);

    const contract = (payload.capability_itinerary as any).compound_capability_contract;
    expect(contract.subgoals.map((entry: any) => entry.requested_capability)).toEqual([
      "scholarly-research.lookup_papers",
      "docs.search",
    ]);
    expect((payload.capability_itinerary_execution_state as any)).toMatchObject({
      missing_compound_subgoal_ids: ["planned:docs"],
      missing_required_capabilities: ["docs.search"],
      complete: false,
    });
  });

  it("preserves a later repeated committed occurrence until the provider executes it", () => {
    const capability = "com.casimirbot.minecraft.actor.status.read";
    const payload: Record<string, unknown> = {
      capability_itinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capabilities: [capability],
        },
        compound_capability_contract: {
          source: "committed_route_compound_projection",
          subgoal_identity_policy: "provider_call_occurrence",
          subgoals: [
            {
              subgoal_id: "planned:actor-status:1",
              order: 1,
              requested_capability: capability,
              runtime_capability: capability,
              subgoal_identity_policy: "provider_call_occurrence",
              capability_occurrence: 1,
              required_observation_kinds: ["provider_gateway_observation_packet"],
              mandatory: true,
            },
            {
              subgoal_id: "planned:actor-status:2",
              order: 2,
              requested_capability: capability,
              runtime_capability: capability,
              subgoal_identity_policy: "provider_call_occurrence",
              capability_occurrence: 2,
              required_observation_kinds: ["provider_gateway_observation_packet"],
              mandatory: true,
            },
          ],
        },
      },
      compound_capability_contract: {
        source: "codex_provider_call_occurrence_normalization",
        subgoal_identity_policy: "provider_call_occurrence",
        subgoals: [{
          subgoal_id: "current:actor-status:1",
          order: 1,
          requested_capability: capability,
          runtime_capability: capability,
          provider_call_id: "call:actor-status:1",
          capability_occurrence: 1,
          observation_ref: "obs:actor-status:1",
          required_observation_kinds: ["provider_gateway_observation_packet"],
          satisfied: true,
        }],
      },
    };

    attachHelixCapabilityItineraryExecutionState(payload, [{
      artifact_id: "obs:actor-status:1",
      producer_item_id: "call:actor-status:1",
      kind: "provider_gateway_observation_packet",
      capability_key: capability,
      status: "succeeded",
      payload: { status: "succeeded" },
    }]);

    const contract = (payload.capability_itinerary as any).compound_capability_contract;
    expect(contract.subgoals.map((entry: any) => entry.subgoal_id)).toEqual([
      "current:actor-status:1",
      "planned:actor-status:2",
    ]);
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      missing_compound_subgoal_ids: ["planned:actor-status:2"],
      complete: false,
    });
  });

  it("preserves a committed post-action constraint across provider-call normalization", () => {
    const status = "com.casimirbot.minecraft.actor.status.read";
    const action = "com.casimirbot.minecraft.player.navigate";
    const payload: Record<string, unknown> = {
      capability_itinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capabilities: [status],
          required_capability_any_of_groups: [
            {
              group_id: "minecraft.player_embodiment.action",
              capability_ids: [action],
            },
          ],
        },
        compound_capability_contract: {
          subgoals: [
            {
              subgoal_id: "planned:post-status",
              order: 1,
              requested_capability: status,
              runtime_capability: status,
              required_observation_kinds: [
                "live_environment_observation",
              ],
              observation_after_capability_any_of_group_ids: [
                "minecraft.player_embodiment.action",
              ],
              mandatory: true,
            },
          ],
        },
      },
      compound_capability_contract: {
        source: "codex_provider_call_occurrence_normalization",
        subgoal_identity_policy: "provider_call_occurrence",
        subgoals: [
          {
            subgoal_id: "current:status:before",
            order: 1,
            requested_capability: status,
            runtime_capability: status,
            provider_call_id: "call:status:before",
            observation_ref: "obs:status:before",
            required_observation_kinds: [
              "live_environment_observation",
            ],
            satisfied: true,
          },
          {
            subgoal_id: "current:navigate",
            order: 2,
            requested_capability: action,
            runtime_capability: action,
            provider_call_id: "call:navigate",
            observation_ref: "obs:navigate",
            required_observation_kinds: [
              "live_environment_observation",
            ],
            satisfied: true,
          },
        ],
      },
    };
    const observation = (capability: string, ref: string) => ({
      artifact_id: ref,
      kind: "live_environment_observation",
      capability_key: capability,
      status: "succeeded",
      payload: { status: "succeeded" },
    });

    attachHelixCapabilityItineraryExecutionState(payload, [
      observation(status, "obs:status:before"),
      observation(action, "obs:navigate"),
    ]);

    expect(payload.capability_itinerary_execution_state).toMatchObject({
      complete: false,
      missing_required_capabilities: [status],
      missing_temporal_postconditions: [
        expect.objectContaining({
          capability_id: status,
          temporal_dependencies_satisfied: true,
          rail_failure_code: "post_dependency_observation_missing",
        }),
      ],
    });
    expect(
      (payload.capability_itinerary as any).compound_capability_contract
        .subgoals[0],
    ).toMatchObject({
      observation_after_capability_any_of_group_ids: [
        "minecraft.player_embodiment.action",
      ],
    });
  });

  it("binds a singleton post-action constraint to the latest repeated provider occurrence and follows its gateway order", () => {
    const turnId = "ask:test:repaired-guardian-read-act-read";
    const status = "com.casimirbot.minecraft.actor.status.read";
    const action = "com.casimirbot.minecraft.player.guardian.execute";
    const beforeObservationRef = `${turnId}:normalized:status:1`;
    const actionObservationRef = `${turnId}:normalized:guardian:2`;
    const afterObservationRef = `${turnId}:normalized:status:3`;
    const beforeGatewayRef = `${turnId}:gateway:status:1`;
    const failedActionGatewayRef = `${turnId}:gateway:guardian:2:failed`;
    const actionGatewayRef = `${turnId}:gateway:guardian:5:succeeded`;
    const afterGatewayRef = `${turnId}:gateway:status:6`;
    const payload: Record<string, unknown> = {
      capability_itinerary: {
        turn_id: turnId,
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capabilities: [status],
          required_capability_any_of_groups: [{
            group_id: "minecraft.player_embodiment.action",
            capability_ids: [action],
          }],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "planned:post-status",
            requested_capability: status,
            runtime_capability: status,
            required_observation_kinds: ["live_environment_observation"],
            observation_after_capability_any_of_group_ids: [
              "minecraft.player_embodiment.action",
            ],
            mandatory: true,
          }],
        },
      },
      compound_capability_contract: {
        source: "codex_provider_call_occurrence_normalization",
        subgoal_identity_policy: "provider_call_occurrence",
        subgoals: [
          {
            subgoal_id: "current:status:before",
            order: 1,
            requested_capability: status,
            runtime_capability: status,
            provider_call_id: "call:status:1",
            capability_occurrence: 1,
            observation_ref: beforeObservationRef,
            required_observation_kinds: ["live_environment_observation"],
            satisfied: true,
          },
          {
            subgoal_id: "current:guardian",
            order: 2,
            requested_capability: action,
            runtime_capability: action,
            provider_call_id: "call:guardian:5",
            capability_occurrence: 1,
            observation_ref: actionObservationRef,
            required_observation_kinds: ["live_environment_observation"],
            satisfied: true,
          },
          {
            subgoal_id: "current:status:after",
            order: 3,
            requested_capability: status,
            runtime_capability: status,
            provider_call_id: "call:status:6",
            capability_occurrence: 2,
            observation_ref: afterObservationRef,
            required_observation_kinds: ["live_environment_observation"],
            satisfied: true,
          },
        ],
      },
    };
    const normalizedObservation = (
      capability: string,
      ref: string,
      gatewayRef: string,
    ) => ({
      artifact_id: ref,
      kind: "live_environment_observation",
      turn_id: turnId,
      source_scope: "current_turn_context",
      capability_key: capability,
      provider_gateway_observation_ref: gatewayRef,
      provider_gateway_packet_refs: [gatewayRef],
      status: "succeeded",
      payload: {
        schema: "helix.live_environment_observation.v1",
        status: "succeeded",
        capability_key: capability,
        provider_gateway_observation_ref: gatewayRef,
        provider_gateway_packet_refs: [gatewayRef],
      },
    });
    const gatewayPacket = (
      capability: string,
      ref: string,
      iteration: number,
      status: string,
    ) => ({
      artifact_id: ref,
      kind: "provider_gateway_observation_packet",
      turn_id: turnId,
      capability_key: capability,
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        iteration,
        capability_key: capability,
        status,
      },
    });
    const artifacts = [
      // Terminal ledgers group normalized observations before gateway packets.
      normalizedObservation(status, beforeObservationRef, beforeGatewayRef),
      normalizedObservation(action, actionObservationRef, actionGatewayRef),
      normalizedObservation(status, afterObservationRef, afterGatewayRef),
      gatewayPacket(status, beforeGatewayRef, 1, "succeeded"),
      gatewayPacket(action, failedActionGatewayRef, 2, "failed"),
      gatewayPacket(action, actionGatewayRef, 5, "succeeded"),
      gatewayPacket(status, afterGatewayRef, 6, "succeeded"),
    ];

    expect(
      attachHelixCapabilityItineraryExecutionState(payload, artifacts),
    ).toEqual([]);
    const mergedSubgoals = (payload.capability_itinerary as any)
      .compound_capability_contract.subgoals;
    expect(mergedSubgoals[0].observation_after_capability_any_of_group_ids)
      .toBeUndefined();
    expect(mergedSubgoals[2]).toMatchObject({
      observation_after_capability_any_of_group_ids: [
        "minecraft.player_embodiment.action",
      ],
    });
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      complete: true,
      missing_compound_subgoal_ids: [],
      missing_required_capabilities: [],
      missing_temporal_postconditions: [],
      compound_subgoal_ledger: [
        expect.objectContaining({
          subgoal_id: "current:status:before",
          satisfaction: "satisfied",
          temporal_constraint_applies: false,
        }),
        expect.objectContaining({
          subgoal_id: "current:guardian",
          satisfaction: "satisfied",
        }),
        expect.objectContaining({
          subgoal_id: "current:status:after",
          observation_ref: afterObservationRef,
          satisfaction: "satisfied",
          temporal_constraint_applies: true,
          temporal_dependencies_satisfied: true,
        }),
      ],
    });
  });

  it("does not preserve a planned capability alias already represented by a provider occurrence", () => {
    const payload: Record<string, unknown> = {
      capability_itinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["docs_viewer"],
          required_capabilities: ["docs.search"],
        },
        compound_capability_contract: {
          source: "committed_route_compound_projection",
          subgoals: [{
            subgoal_id: "planned:docs-search",
            order: 1,
            requested_capability: "docs-viewer.search_docs",
            runtime_capability: "docs.search",
            required_observation_kinds: ["doc_search_results"],
            mandatory: true,
          }],
        },
      },
      compound_capability_contract: {
        source: "codex_provider_call_occurrence_normalization",
        subgoal_identity_policy: "provider_call_occurrence",
        subgoals: [{
          subgoal_id: "current:docs-search:1",
          order: 1,
          requested_capability: "docs.search",
          runtime_capability: "docs.search",
          provider_call_id: "call:docs-search:1",
          capability_occurrence: 1,
          observation_ref: "obs:docs-search:1",
          required_observation_kinds: ["doc_search_results"],
          satisfied: true,
        }],
      },
    };

    expect(attachHelixCapabilityItineraryExecutionState(payload, [{
      artifact_id: "obs:docs-search:1",
      kind: "doc_search_results",
      capability_key: "docs.search",
      payload: { status: "succeeded" },
    }])).toEqual([]);

    const contract = (payload.capability_itinerary as any).compound_capability_contract;
    expect(contract.subgoals.map((entry: any) => entry.subgoal_id)).toEqual([
      "current:docs-search:1",
    ]);
    expect(payload.capability_itinerary_execution_state).toMatchObject({
      missing_compound_subgoal_ids: [],
      missing_required_capabilities: [],
      complete: true,
    });
  });

  it("counts only a successful exact live-pipeline cadence observation", () => {
    const capability = "situation-room.live-source.set_rate";
    const artifact = {
      artifact_id: "ask:test:live-pipeline-cadence",
      kind: "provider_gateway_observation_packet",
      capability_key: capability,
      executed_args: {
        cadence_ms: 10_000,
      },
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: capability,
        status: "succeeded",
      },
    };
    const capabilityItinerary = {
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_pipeline"],
        required_capabilities: [capability],
      },
      compound_capability_contract: {
        subgoals: [{
          subgoal_id: "subgoal:live-pipeline-cadence",
          requested_capability: capability,
          runtime_capability: capability,
          required_args: ["cadence_ms"],
          args_hint: {
            cadence_ms: 10_000,
          },
          required_observation_kinds: [
            "live_pipeline_receipt",
            "visual_producer_cadence_receipt",
            "tool_observation",
          ],
        }],
      },
    };

    expect(isHelixCapabilityItineraryFamilyObserved("live_pipeline", [artifact])).toBe(true);
    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary,
      artifacts: [artifact],
    })).toMatchObject({
      complete: true,
      observed_families: ["live_pipeline"],
      missing_observation_families: [],
      missing_required_capabilities: [],
      compound_subgoal_ledger: [{
        selected_capability: capability,
        executed_capability: capability,
        observation_ref: artifact.artifact_id,
        observation_provenance: "capability_key",
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      }],
    });

    for (const rejectedArtifact of [
      {
        ...artifact,
        payload: {
          ...artifact.payload,
          status: "failed",
        },
      },
      {
        ...artifact,
        capability_key: "workspace_os.status",
        payload: {
          ...artifact.payload,
          capability_key: "workspace_os.status",
        },
      },
    ]) {
      expect(isHelixCapabilityItineraryFamilyObserved("live_pipeline", [rejectedArtifact])).toBe(false);
      expect(buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary,
        artifacts: [rejectedArtifact],
      })).toMatchObject({
        complete: false,
        missing_observation_families: ["live_pipeline"],
        missing_required_capabilities: [capability],
        compound_subgoal_ledger: [{
          satisfaction: "pending",
          rail_failure_code: "subgoal_observation_missing",
        }],
      });
    }
  });

  it("counts the canonical moral graph observation as completed family evidence", () => {
    const artifacts = [{
      artifact_id: "ask:test:moral-graph",
      kind: "moral_graph_reflection",
      payload: {
        schema: "helix.moral_graph_reflection_observation.v1",
        capability_key: "moral-graph.reflect_context",
        status: "succeeded",
      },
    }];

    expect(isHelixCapabilityItineraryFamilyObserved("moral_graph_reflection", artifacts)).toBe(true);
    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["moral_graph_reflection"],
          required_capabilities: ["moral-graph.reflect_context"],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "subgoal:moral-graph",
            requested_capability: "moral-graph.reflect_context",
            runtime_capability: "moral-graph.reflect_context",
            required_observation_kinds: [
              "moral_graph_reflection",
              "helix.moral_graph_reflection_observation.v1",
            ],
          }],
        },
      },
      artifacts,
    })).toMatchObject({
      complete: true,
      observed_families: ["moral_graph_reflection"],
      missing_observation_families: [],
      compound_subgoal_ledger: [{
        satisfaction: "satisfied",
        rail_status: "complete",
      }],
    });
  });

  it("counts successful notes-list and text-to-speech observations for their exact families", () => {
    const notesArtifacts = [{
      artifact_id: "ask:test:notes-list",
      kind: "provider_gateway_observation_packet",
      capability_key: "workstation-notes.list_notes",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "workstation-notes.list_notes",
        status: "succeeded",
      },
    }];
    const voiceArtifacts = [{
      artifact_id: "ask:test:voice-delivery",
      kind: "capability_lane_observation_packet",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "text_to_speech.speak_text",
        status: "succeeded",
      },
    }];

    expect(isHelixCapabilityItineraryFamilyObserved("notes", notesArtifacts)).toBe(true);
    expect(isHelixCapabilityItineraryFamilyObserved("workstation", [{
      ...notesArtifacts[0],
      kind: "workstation_notes_list_observation",
    }])).toBe(true);
    expect(isHelixCapabilityItineraryFamilyObserved("voice_delivery", voiceArtifacts)).toBe(true);
    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          required_observation_families: ["workstation"],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "subgoal:notes-list",
            requested_capability: "workstation-notes.list_notes",
            runtime_capability: "workstation-notes.list_notes",
            required_observation_kinds: ["helix.agent_step_observation_packet.v1"],
          }],
        },
      },
      artifacts: notesArtifacts,
    })).toMatchObject({
      complete: true,
      compound_subgoal_ledger: [{
        satisfaction: "satisfied",
        rail_status: "complete",
      }],
    });
  });

  it("does not use a generic gateway packet to satisfy the wrong exact capability", () => {
    const artifacts = [{
      artifact_id: "ask:test:wrong-capability",
      kind: "provider_gateway_observation_packet",
      capability_key: "workspace_os.status",
      payload: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "workspace_os.status",
        status: "succeeded",
      },
    }];

    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          required_observation_families: ["workstation"],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "subgoal:notes-list",
            requested_capability: "workstation-notes.list_notes",
            runtime_capability: "workstation-notes.list_notes",
            required_observation_kinds: ["workstation_notes_list_observation"],
          }],
        },
      },
      artifacts,
    })).toMatchObject({
      complete: false,
      compound_subgoal_ledger: [{
        satisfaction: "pending",
        rail_failure_code: "subgoal_observation_missing",
      }],
    });
  });

  it("counts the registered frontier-conjecture observation as theory-locator evidence", () => {
    const artifacts = [{
      artifact_id: "ask:test:theory-frontier",
      kind: "theory_frontier_conjecture_observation",
      payload: {
        schema: "helix.theory_frontier_conjecture_observation.v1",
        capability_key: "theory-badge-graph.propose_frontier_conjectures",
        status: "succeeded",
      },
    }];

    expect(isHelixCapabilityItineraryFamilyObserved("theory_locator", artifacts)).toBe(true);
    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["theory_locator"],
        },
      },
      artifacts,
    })).toMatchObject({
      complete: true,
      observed_families: ["theory_locator"],
      missing_observation_families: [],
    });
  });

  it("counts the exact theory-experiment procedure observation as theory-locator evidence", () => {
    const artifacts = [{
      artifact_id: "ask:test:theory-experiment-procedure",
      kind: "theory_experiment_procedure_observation",
      payload: {
        schema: "casimir.theory_experiment_procedure.observation.v1",
        capability_key: "theory-experiment-procedure.prepare",
        status: "succeeded",
      },
    }];

    expect(isHelixCapabilityItineraryFamilyObserved("theory_locator", artifacts)).toBe(true);
    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["theory_locator"],
        },
      },
      artifacts,
    })).toMatchObject({
      complete: true,
      observed_families: ["theory_locator"],
      missing_observation_families: [],
    });
  });

  it("counts a formal artifact-family audit observation as theory-locator evidence", () => {
    const artifacts = [{
      artifact_id: "ask:test:theory-formal-artifact-family-audit",
      kind: "theory_formal_artifact_family_audit_observation",
      payload: {
        schema: "casimir.theory_formal_artifact_family_audit.observation.v1",
        capability_key: "theory-formal-verifier.inspect_artifact_family",
        status: "succeeded",
      },
    }];

    expect(
      isHelixCapabilityItineraryFamilyObserved("theory_locator", artifacts),
    ).toBe(true);
    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["theory_locator"],
        },
      },
      artifacts,
    })).toMatchObject({
      complete: true,
      observed_families: ["theory_locator"],
      missing_observation_families: [],
    });
  });

  it("reconciles stale planning hints with authenticated executed observation arguments", () => {
    const capability = "theory-experiment-procedure.prepare";
    const observationKind = "theory_experiment_procedure_observation";
    const artifacts = [{
      artifact_id: "ask:test:theory-experiment-procedure:observation",
      kind: observationKind,
      executed_args: {
        selected_badge_ids: ["study.casimir_dp.evidence_map_stage3"],
      },
      payload: {
        schema: "casimir.theory_experiment_procedure.observation.v1",
        capability_key: capability,
        status: "succeeded",
      },
    }];

    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["theory_locator"],
          required_capabilities: [capability],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "subgoal:theory-procedure",
            requested_capability: capability,
            runtime_capability: capability,
            required_args: ["prompt", "selected_badge_ids"],
            args_hint: {
              prompt: "Prepare the Stage 3 theory comparison.",
              selected_badge_ids: [],
            },
            required_observation_kinds: [observationKind],
          }],
        },
      },
      artifacts,
    })).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      compound_subgoal_ledger: [{
        satisfaction: "satisfied",
        args_source: "contract_hint_reconciled_with_observation",
        selected_args: {
          prompt: "Prepare the Stage 3 theory comparison.",
          selected_badge_ids: ["study.casimir_dp.evidence_map_stage3"],
        },
      }],
    });
  });

  it("treats an authenticated calculator receipt expression as the required calculator input", () => {
    const capability = "scientific-calculator.solve_expression";
    const receiptRef = "ask:test:calculator-receipt";
    const artifacts = [{
      artifact_id: receiptRef,
      kind: "calculator_receipt",
      payload: {
        schema: "helix.calculator_receipt.v1",
        capability_key: capability,
        expression: "17*19",
        normalized_expression: "17*19",
        result: "323",
        status: "succeeded",
      },
    }];

    expect(buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["calculator"],
          required_capabilities: [capability],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "subgoal:calculator",
            requested_capability: capability,
            runtime_capability: capability,
            required_args: ["latex"],
            optional_args: ["expression", "equation"],
            args_hint: {},
            required_observation_kinds: [
              "calculator_receipt",
              "workstation_tool_evaluation",
            ],
          }],
        },
      },
      artifacts,
    })).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      missing_compound_subgoal_ids: [],
      compound_subgoal_ledger: [{
        requested_capability: capability,
        executed_capability: capability,
        args_source: "contract_hint_reconciled_with_observation",
        selected_args: {
          expression: "17*19",
        },
        observation_kind: "calculator_receipt",
        observation_ref: receiptRef,
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      }],
    });
  });

  it("satisfies an exact Minecraft command subgoal from a gateway packet with validated executed arguments", () => {
    const capability = "com.casimirbot.minecraft.command";
    const observationRef = "ask:test:minecraft-command:observation";
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        admitted_tool_families: ["live_environment"],
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capabilities: [capability],
        },
        compound_capability_contract: {
          subgoals: [{
            subgoal_id: "subgoal:minecraft-command",
            requested_capability: capability,
            runtime_capability: capability,
            required_args: ["command", "category", "effect"],
            args_hint: {},
            required_observation_kinds: [
              "live_environment_tool_observation",
              "helix.environment_command.observation.v1",
              "helix.agent_step_observation_packet.v1",
              "provider_gateway_observation_packet",
            ],
          }],
        },
      },
      artifacts: [{
        artifact_id: observationRef,
        kind: "provider_gateway_observation_packet",
        capability_key: capability,
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          capability_key: capability,
          status: "succeeded",
          executed_args: {
            command: "whitelist list",
            category: "server_administration",
            effect: "server_administration",
          },
          produced_artifact_refs: [observationRef],
          assistant_answer: false,
          terminal_eligible: false,
        },
      }],
    });

    expect(state).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      missing_compound_subgoal_ids: [],
      next_missing_subgoal_id: null,
      compound_subgoal_ledger: [{
        requested_capability: capability,
        selected_capability: capability,
        executed_capability: capability,
        selected_args: {
          command: "whitelist list",
          category: "server_administration",
          effect: "server_administration",
        },
        observation_kind: "provider_gateway_observation_packet",
        observation_ref: observationRef,
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      }],
    });
  });

  it("satisfies a guarded Minecraft command subgoal without mutation only from a fresh complete no-candidate observation", () => {
    const turnId = "ask:test:minecraft-guarded-noop";
    const spatialCapability =
      "com.casimirbot.minecraft.spatial_region.inspect";
    const commandCapability = "com.casimirbot.minecraft.command";
    const spatialSubgoalId = "subgoal:minecraft-spatial";
    const observationRef = `${turnId}:spatial-observation`;
    const spatialArtifact = {
      artifact_id: observationRef,
      turn_id: turnId,
      kind: "live_environment_observation",
      source_scope: "current_turn_context",
      capability_key: spatialCapability,
      source_capability_id: spatialCapability,
      source_observation_schema:
        "helix.environment_connector.probe_observation.v1",
      source_observation_status: "succeeded",
      status: "succeeded",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      payload: {
        schema: "helix.live_environment_observation.v1",
        capability_key: spatialCapability,
        source_capability_id: spatialCapability,
        status: "succeeded",
        observation_role: "evidence_not_assistant_answer",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        result: {
          purpose: "structure_planning",
          build_line_candidates: [],
          build_line_candidates_complete: true,
          retained_build_line_candidate_count: 0,
          omitted_build_line_candidate_count: 0,
        },
      },
    };
    const capabilityItinerary = {
      turn_id: turnId,
      admitted_tool_families: ["live_environment"],
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
        required_capabilities: [spatialCapability, commandCapability],
      },
      compound_capability_contract: {
        subgoals: [
          {
            subgoal_id: spatialSubgoalId,
            requested_capability: spatialCapability,
            runtime_capability: spatialCapability,
            required_args: [],
            args_hint: { purpose: "structure_planning" },
            required_observation_kinds: [
              "live_environment_observation",
              "helix.environment_connector.probe_observation.v1",
            ],
          },
          {
            subgoal_id: "subgoal:minecraft-command",
            requested_capability: commandCapability,
            runtime_capability: commandCapability,
            required_args: ["command", "category", "effect"],
            args_hint: {},
            required_observation_kinds: [
              "helix.environment_command.observation.v1",
            ],
            guarded_noop_policy: {
              schema: "helix.compound_capability_guarded_noop.v1",
              mode: "no_verified_safe_candidate",
              guard_subgoal_id: spatialSubgoalId,
              guard_capability: spatialCapability,
              required_purpose: "structure_planning",
              accepted_observation_purposes: [
                "structure_planning",
                "build_planning",
              ],
              candidate_field: "build_line_candidates",
              completeness_field: "build_line_candidates_complete",
              omitted_count_field: "omitted_build_line_candidate_count",
              current_turn_only: true,
              requires_successful_observation: true,
              user_directed_noop_guard: true,
            },
          },
        ],
      },
    };

    expect(
      buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary,
        artifacts: [spatialArtifact],
      }),
    ).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      missing_compound_subgoal_ids: [],
      compound_subgoal_ledger: [
        {
          requested_capability: spatialCapability,
          satisfaction: "satisfied",
        },
        {
          requested_capability: commandCapability,
          selected_capability: null,
          executed_capability: null,
          observation_ref: observationRef,
          observation_provenance: "current_turn_guarded_noop_observation",
          satisfaction: "satisfied",
          satisfaction_reason: "no_verified_safe_candidate",
          satisfied_without_execution: true,
          mutation_performed: false,
          rail_status: "complete",
          rail_failure_code: null,
        },
      ],
    });

    const liveAliasArtifact = {
      ...spatialArtifact,
      source_observation_status: undefined,
      payload: {
        ...spatialArtifact.payload,
        result: {
          ...spatialArtifact.payload.result,
          purpose: "build_planning",
        },
      },
    };
    expect(
      buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary,
        artifacts: [liveAliasArtifact],
      }),
    ).toMatchObject({
      complete: true,
      compound_subgoal_ledger: [
        { satisfaction: "satisfied" },
        {
          satisfaction: "satisfied",
          satisfaction_reason: "no_verified_safe_candidate",
          satisfied_without_execution: true,
          mutation_performed: false,
        },
      ],
    });

    const rejectedArtifacts = [
      {
        name: "incomplete candidate list",
        artifact: {
          ...spatialArtifact,
          payload: {
            ...spatialArtifact.payload,
            result: {
              ...spatialArtifact.payload.result,
              build_line_candidates_complete: false,
            },
          },
        },
      },
      {
        name: "omitted candidate",
        artifact: {
          ...spatialArtifact,
          payload: {
            ...spatialArtifact.payload,
            result: {
              ...spatialArtifact.payload.result,
              omitted_build_line_candidate_count: 1,
            },
          },
        },
      },
      {
        name: "verified safe candidate",
        artifact: {
          ...spatialArtifact,
          payload: {
            ...spatialArtifact.payload,
            result: {
              ...spatialArtifact.payload.result,
              build_line_candidates: [{ safe_candidate: true }],
              retained_build_line_candidate_count: 1,
            },
          },
        },
      },
      {
        name: "prior-turn evidence",
        artifact: {
          ...spatialArtifact,
          turn_id: "ask:test:prior-turn",
          source_scope: "prior_turn_context",
        },
      },
      {
        name: "failed observation",
        artifact: {
          ...spatialArtifact,
          source_observation_status: "failed",
          status: "failed",
          payload: {
            ...spatialArtifact.payload,
            status: "failed",
          },
        },
      },
    ];
    for (const rejected of rejectedArtifacts) {
      const state = buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary,
        artifacts: [rejected.artifact],
      });
      const commandSubgoal = state.compound_subgoal_ledger.find(
        (subgoal) =>
          subgoal.requested_capability === commandCapability,
      );
      expect(commandSubgoal, rejected.name).toMatchObject({
        satisfaction: "failed",
      });
      expect(commandSubgoal, rejected.name).not.toHaveProperty(
        "satisfied_without_execution",
      );
      expect(state.missing_required_capabilities, rejected.name).toContain(
        commandCapability,
      );
      expect(state.complete, rejected.name).toBe(false);
    }

    const walkCapability = "com.casimirbot.minecraft.player.walk";
    const movementArtifact = {
      ...spatialArtifact,
      payload: {
        ...spatialArtifact.payload,
        result: {
          purpose: "movement_safety",
          walk_step_candidates: [],
          walk_step_candidates_complete: true,
          retained_walk_step_candidate_count: 0,
          omitted_walk_step_candidate_count: 0,
        },
      },
    };
    const movementItinerary = {
      ...capabilityItinerary,
      terminal_success_criteria: {
        ...capabilityItinerary.terminal_success_criteria,
        required_capabilities: [spatialCapability, walkCapability],
      },
      compound_capability_contract: {
        subgoals: [
          capabilityItinerary.compound_capability_contract.subgoals[0],
          {
            subgoal_id: "subgoal:minecraft-walk",
            requested_capability: walkCapability,
            runtime_capability: walkCapability,
            required_args: [
              "action_kind",
              "direction",
              "duration_ms",
              "sprint",
            ],
            args_hint: { duration_ms: 250, sprint: false },
            required_observation_kinds: [
              "helix.minecraft.player_action.observation.v1",
            ],
            guarded_noop_policy: {
              schema: "helix.compound_capability_guarded_noop.v1",
              mode: "no_verified_safe_candidate",
              guard_subgoal_id: spatialSubgoalId,
              guard_capability: spatialCapability,
              required_purpose: "movement_safety",
              accepted_observation_purposes: ["movement_safety"],
              candidate_field: "walk_step_candidates",
              completeness_field: "walk_step_candidates_complete",
              omitted_count_field: "omitted_walk_step_candidate_count",
              current_turn_only: true,
              requires_successful_observation: true,
              user_directed_noop_guard: true,
            },
          },
        ],
      },
    };
    expect(
      buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary: movementItinerary,
        artifacts: [movementArtifact],
      }),
    ).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      compound_subgoal_ledger: [
        { satisfaction: "satisfied" },
        {
          requested_capability: walkCapability,
          satisfaction: "satisfied",
          satisfaction_reason: "no_verified_safe_candidate",
          satisfied_without_execution: true,
          mutation_performed: false,
        },
      ],
    });
  });

  it("allows a model-decided conditional command to remain unexecuted after its mandatory inspection", () => {
    const turnId = "ask:test:conditional-minecraft-command";
    const spatialCapability =
      "com.casimirbot.minecraft.spatial_region.inspect";
    const commandCapability = "com.casimirbot.minecraft.command";
    const observationRef = `${turnId}:landing-observation`;
    const spatialArtifact = {
      artifact_id: observationRef,
      turn_id: turnId,
      kind: "live_environment_observation",
      source_scope: "current_turn_context",
      capability_key: spatialCapability,
      source_capability_id: spatialCapability,
      source_observation_schema:
        "helix.environment_connector.probe_observation.v1",
      status: "succeeded",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      payload: {
        schema: "helix.live_environment_observation.v1",
        source_capability_id: spatialCapability,
        status: "succeeded",
        observation_role: "evidence_not_assistant_answer",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        result: { purpose: "landing_safety" },
      },
    };
    const state = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: {
        turn_id: turnId,
        admitted_tool_families: ["live_environment"],
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["live_environment"],
          required_capabilities: [spatialCapability],
        },
        compound_capability_contract: {
          subgoals: [
            {
              subgoal_id: "subgoal:landing-inspection",
              requested_capability: spatialCapability,
              runtime_capability: spatialCapability,
              mandatory: true,
              required_args: [],
              args_hint: { purpose: "landing_safety" },
              required_observation_kinds: ["live_environment_observation"],
            },
            {
              subgoal_id: "subgoal:conditional-command",
              requested_capability: commandCapability,
              runtime_capability: commandCapability,
              mandatory: false,
              required_args: ["command", "category", "effect"],
              args_hint: {},
              required_observation_kinds: [
                "helix.environment_command.observation.v1",
              ],
            },
          ],
        },
      },
      artifacts: [spatialArtifact],
    });

    expect(state).toMatchObject({
      complete: true,
      missing_required_capabilities: [],
      missing_compound_subgoal_ids: [],
      compound_subgoal_ledger: [
        {
          requested_capability: spatialCapability,
          mandatory: true,
          satisfaction: "satisfied",
        },
        {
          requested_capability: commandCapability,
          mandatory: false,
          satisfaction: "optional_not_selected",
          rail_status: "not_required",
        },
      ],
    });
  });

  it("counts only the exact broker-revalidated prior environment evidence schema", () => {
    const artifact = {
      artifact_id: "ask:turn-2:prior-environment-evidence",
      kind: "prior_environment_probe_evidence",
      capability_key:
        "com.casimirbot.minecraft.reachability.check",
      source_scope: "prior_turn_context",
      payload: {
        schema:
          "helix.environment_connector.prior_probe_evidence.v1",
        capability_id:
          "com.casimirbot.minecraft.reachability.check",
        content_role:
          "prior_environment_probe_evidence_not_assistant_answer",
        reentry_required: true,
        answer_authority: false,
        observation: {
          schema:
            "helix.environment_connector.probe_observation.v1",
          capability_id:
            "com.casimirbot.minecraft.reachability.check",
          outcome: "succeeded",
          provenance_valid: true,
          eligible_for_current_turn_reentry: true,
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
    };
    const itinerary = {
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        required_observation_families: ["live_environment"],
      },
    };

    expect(
      isHelixCapabilityItineraryFamilyObserved("live_environment", [
        artifact,
      ]),
    ).toBe(true);
    expect(
      buildHelixCapabilityItineraryExecutionState({
        capabilityItinerary: itinerary,
        artifacts: [artifact],
      }),
    ).toMatchObject({
      complete: true,
      observed_families: ["live_environment"],
      missing_observation_families: [],
    });

    for (const invalidArtifact of [
      {
        ...artifact,
        payload: {
          ...artifact.payload,
          answer_authority: true,
        },
      },
      {
        ...artifact,
        payload: {
          ...artifact.payload,
          observation: {
            ...artifact.payload.observation,
            provenance_valid: false,
          },
        },
      },
      {
        ...artifact,
        payload: {
          ...artifact.payload,
          observation: {
            ...artifact.payload.observation,
            outcome: "target_ambiguous",
          },
        },
      },
    ]) {
      expect(
        isHelixCapabilityItineraryFamilyObserved(
          "live_environment",
          [invalidArtifact],
        ),
      ).toBe(false);
    }
  });
});
