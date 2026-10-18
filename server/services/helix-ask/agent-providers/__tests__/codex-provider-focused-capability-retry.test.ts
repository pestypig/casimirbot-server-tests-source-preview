import { describe, expect, it } from "vitest";
import type { HelixAgentContinuationState } from "@shared/helix-agent-continuation-state";
import {
  buildGenericCompoundContinuationReviewGuidance,
  buildCodexContinuationCapabilitySets,
  buildCodexContinuationCapabilityInputContractLines,
  buildCodexFocusedInitialCapabilityRetryPrompt,
  buildCodexModelCapabilityPromptProjection,
  buildCodexTurnModelVisibleCapabilityCatalog,
  carryCodexDetailedActionsIntoContinuationPreferences,
  codexProviderCapabilityUsageNotes,
  selectCodexCompoundRequiredCapabilityIds,
  shouldUseCodexFocusedCapabilityProjection,
} from "../codex-provider";

describe("Codex focused initial capability retry", () => {
  it("keeps missing executable compound requirements actionable", () => {
    const guidance = buildGenericCompoundContinuationReviewGuidance([
      "com.casimirbot.minecraft.player.craft",
    ]).join("\n");

    expect(guidance).toContain(
      "without current-turn postcondition evidence remains unfinished",
    );
    expect(guidance).toContain(
      "request the next admitted capability needed to perform or verify it",
    );
    expect(guidance).not.toContain(
      "Do not call an executable step blocked merely because",
    );
  });

  it("describes each strict fluid-sequence node shape without choosing gameplay", () => {
    const notes = codexProviderCapabilityUsageNotes(
      "com.casimirbot.minecraft.player.sequence.execute",
    ).join("\n");

    expect(notes).toContain(
      "input_segment requires earliest_tick, duration_ticks, controls, on_complete, and on_failure",
    );
    expect(notes).toContain(
      "workflow_action requires earliest_tick, timeout_ticks, action, on_success, and on_failure",
    );
    expect(notes).toContain(
      "checkpoint has wait_up_to_ticks but no timeout_ticks, duration_ticks, or controls",
    );
    expect(notes).toContain(
      "terminal permits only node_id, node_kind, terminal_outcome, and reason_code",
    );
    expect(notes).toContain(
      "combines several causally ordered player actions, explicit checkpoints, and final control release",
    );
    expect(notes).toContain(
      "must equal the checkpoint_id field of a reachable checkpoint node exactly",
    );
    expect(notes).toContain(
      "place that checkpoint before the dependent workflow_action",
    );
    expect(notes).toContain("exact frozen input schema lists them");
    expect(notes).toContain(
      "current_focus means only the player's present view",
    );
    expect(notes).toContain(
      "aim with look_at target_kind position at the observed block center",
    );
    expect(notes).toContain("interact with looked_at_block");
    expect(notes).toContain("Mutation ceilings are independent");
    expect(notes).toContain(
      "Do not enable world mutation or add minecraft:air merely to admit inventory effects",
    );
    expect(notes).toContain(
      "If actor status has no looked_at_block or reports within_interaction_range false",
    );
    expect(notes).toContain("preserve the successful prefix evidence");
    expect(notes).not.toMatch(/note_block|oak_planks|g2.fluid/i);
  });

  it("states that spatial evidence does not silently become interaction focus", () => {
    const notes = codexProviderCapabilityUsageNotes(
      "com.casimirbot.minecraft.player.interact",
    ).join("\n");

    expect(notes).toContain("does not move the camera");
    expect(notes).toContain(
      "first request com.casimirbot.minecraft.player.look",
    );
    expect(notes).toContain("Do not substitute the spatial scan center");
    expect(notes).not.toMatch(/note_block|oak_planks|g2.fluid/i);
  });

  it("describes the resident guardian as a bounded local profile rather than a command", () => {
    const notes = codexProviderCapabilityUsageNotes(
      "com.casimirbot.minecraft.player.viability_guardian.arm",
    ).join("\n");

    expect(notes).toContain("resident.minecraft.fabric-guardian.v1");
    expect(notes).toContain("Five minutes at 20 Hz is 6000 ticks");
    expect(notes).toContain(
      '["swim_up", "release_controls", "request_semantic_replan"]',
    );
    expect(notes).toContain(
      "Do not select this arm capability as if it implements a requested fire, lava, unsafe-landing",
    );
    expect(notes).toContain(
      "event nodes may wait locally for a future measured trigger",
    );
    expect(notes).toContain("Do not substitute water breathing");
  });

  it("explains that reactive programs may wait locally for future hazards", () => {
    const notes = codexProviderCapabilityUsageNotes(
      "com.casimirbot.minecraft.player.guardian.execute",
    ).join("\n");

    expect(notes).toContain(
      "anticipated future condition as well as a currently observed condition",
    );
    expect(notes).toContain(
      "A fresh no-hazard observation does not invalidate a user-defined future trigger",
    );
    expect(notes).toContain("wait locally within wait_up_to_ticks");
    expect(notes).toContain("settle without another model turn");
    expect(notes).toContain(
      "Sprint/jump input is strongly slowed in lava",
    );
    expect(notes).toContain("600 ms produced only 0.435 blocks");
    expect(notes).toContain("1400 ms produced 3.188 blocks");
    expect(notes).toContain("calibration evidence rather than a universal duration");
    expect(notes).toContain(
      "must be an independent interrupt evaluated throughout the program",
    );
    expect(notes).toContain(
      "health_at_least becomes not_satisfied",
    );
    expect(notes).not.toMatch(/guardian-fire-recovery-water-course|enter-water/);
  });

  it("focuses hard source routes without making generic direct answers tool-shaped", () => {
    expect(
      shouldUseCodexFocusedCapabilityProjection({
        semanticPlayerEmbodimentActionRequired: false,
        hardRuntimeSourceRoute: true,
        admittedCapabilityCount: 3,
      }),
    ).toBe(true);
    expect(
      shouldUseCodexFocusedCapabilityProjection({
        semanticPlayerEmbodimentActionRequired: true,
        hardRuntimeSourceRoute: false,
        admittedCapabilityCount: 3,
      }),
    ).toBe(true);
    expect(
      shouldUseCodexFocusedCapabilityProjection({
        semanticPlayerEmbodimentActionRequired: false,
        hardRuntimeSourceRoute: false,
        admittedCapabilityCount: 3,
      }),
    ).toBe(false);
    expect(
      shouldUseCodexFocusedCapabilityProjection({
        semanticPlayerEmbodimentActionRequired: false,
        hardRuntimeSourceRoute: true,
        admittedCapabilityCount: 0,
      }),
    ).toBe(false);
  });

  it("projects only the admitted semantic action family into the initial model catalog", () => {
    const guardian = "com.casimirbot.minecraft.player.guardian.execute";
    const walk = "com.casimirbot.minecraft.player.walk";
    const unrelated = "live_env.query_visual_summaries";
    const catalog = buildCodexTurnModelVisibleCapabilityCatalog({
      gatewayManifest: {
        schema: "helix.workstation_tool_gateway.v1",
        manifest_version: "test",
        agent_runtime: "codex",
        mode: "act",
        capabilities: [
          { capability_id: guardian, description: "guardian" },
          { capability_id: walk, description: "walk" },
          {
            capability_id: unrelated,
            description: "UNRELATED_CATALOG_PAYLOAD".repeat(10_000),
          },
        ],
        unavailable_capabilities: [
          {
            capability_id: "unrelated.unavailable",
            availability: "unavailable",
            reason: "provider_not_configured",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      } as any,
      capabilityLaneManifest: {
        schema: "helix.agent_model_visible_capability_lane_manifest.v1",
        source_schema: "helix.capability_lane_manifest.v1",
        selected_runtime_agent_provider: "codex",
        purpose: "model_visible_requestable_capability_lanes",
        lanes: [
          {
            lane_id: "minecraft",
            capabilities: [
              { capability_id: guardian },
              { capability_id: unrelated },
            ],
          },
          {
            lane_id: "unrelated",
            capabilities: [{ capability_id: unrelated }],
          },
        ],
        authority_rules: {},
        usage_notes: [],
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      } as any,
      admittedCapabilityIds: [guardian, walk],
    });

    expect(
      catalog.gatewayManifest.capabilities.map(
        (capability) => capability.capability_id,
      ),
    ).toEqual([guardian, walk]);
    expect(catalog.gatewayManifest.unavailable_capabilities).toEqual([]);
    expect(catalog.capabilityLaneManifest.lanes).toHaveLength(1);
    expect(catalog.capabilityLaneManifest.lanes[0]?.capabilities).toEqual([
      expect.objectContaining({ capability_id: guardian }),
    ]);
    expect(catalog.capabilityLaneManifest.usage_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("explicit causal action node"),
        expect.stringContaining("ceil(duration_ms / 50)"),
        expect.stringContaining("any required lane that fails"),
        expect.stringContaining("first wait for a real trajectory-producing state transition"),
        expect.stringContaining("grounded vanilla client may report a small negative delta-y near -0.0784"),
        expect.stringContaining("main-hand item_use place lane must declare camera, locomotion, hotbar, main_hand"),
        expect.stringContaining("rather than letting it starve the motion lane"),
        expect.stringContaining("causally ordered work that shares resources in one required lane"),
        expect.stringContaining("Do not poll by pointing a branch back to itself"),
        expect.stringContaining("A focus check is not a trajectory check"),
        expect.stringContaining("cannot directly claim success"),
      ]),
    );
    expect(JSON.stringify(catalog)).not.toContain("UNRELATED_CATALOG_PAYLOAD");
  });

  it("does not add reactive-program guidance when that capability is absent", () => {
    const catalog = buildCodexTurnModelVisibleCapabilityCatalog({
      gatewayManifest: {
        schema: "helix.workstation_tool_gateway.v1",
        manifest_version: "test",
        agent_runtime: "codex",
        mode: "act",
        capabilities: [
          {
            capability_id: "com.casimirbot.minecraft.player.walk",
            description: "walk",
          },
        ],
        unavailable_capabilities: [],
        assistant_answer: false,
        raw_content_included: false,
      } as any,
      capabilityLaneManifest: {
        schema: "helix.agent_model_visible_capability_lane_manifest.v1",
        source_schema: "helix.capability_lane_manifest.v1",
        selected_runtime_agent_provider: "codex",
        purpose: "model_visible_requestable_capability_lanes",
        lanes: [],
        authority_rules: {},
        usage_notes: ["BASE_NOTE"],
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      } as any,
      admittedCapabilityIds: ["com.casimirbot.minecraft.player.walk"],
    });

    expect(catalog.capabilityLaneManifest.usage_notes).toEqual(["BASE_NOTE"]);
    expect(JSON.stringify(catalog)).not.toContain("explicit causal action node");
  });

  it("keeps every admitted action selectable while expanding only relevant schemas", () => {
    const actorStatus = "com.casimirbot.minecraft.actor.status.read";
    const inventory = "com.casimirbot.minecraft.inventory.check";
    const spatial = "com.casimirbot.minecraft.spatial_region.inspect";
    const guardian = "com.casimirbot.minecraft.player.guardian.execute";
    const walk = "com.casimirbot.minecraft.player.walk";
    const transfer = "com.casimirbot.minecraft.player.inventory.transfer";
    const unrelated = "com.casimirbot.minecraft.player.unrelated";
    const capability = (input: {
      capabilityId: string;
      label: string;
      description: string;
      mutating: boolean;
      inputDescription?: string;
    }) => ({
      schema: "helix.workstation_tool_gateway.capability.v1",
      capability_id: input.capabilityId,
      label: input.label,
      description: input.description,
      panel_id: null,
      action_id: input.capabilityId,
      mode: input.mutating ? "act" : "read",
      mutating: input.mutating,
      code_mutation: false,
      shell_access: false,
      requires_confirmation: input.mutating,
      requires_source: true,
      terminal_eligible: false,
      permission_profile_required: input.mutating ? "act" : "read",
      post_tool_model_step_required: true,
      input_schema: {
        type: "object",
        required: ["target"],
        properties: {
          target: {
            type: "string",
            description: input.inputDescription ?? input.description,
          },
        },
      },
      output_observation_schema: "test.observation.v1",
      observation_schema: "test.observation.v1",
      safety_tags: input.mutating ? ["world_mutation"] : ["read_only"],
      assistant_answer: false,
      raw_content_included: false,
    });
    const fullManifest = {
      schema: "helix.workstation_tool_gateway.v1",
      manifest_version: "test",
      agent_runtime: "codex",
      mode: "act",
      capabilities: [
        capability({
          capabilityId: actorStatus,
          label: "Read actor status",
          description: "Read health and measured position.",
          mutating: false,
        }),
        capability({
          capabilityId: inventory,
          label: "Check inventory",
          description: "Read the water bucket inventory state.",
          mutating: false,
        }),
        capability({
          capabilityId: spatial,
          label: "Inspect spatial region",
          description: "Inspect the landing surface and block columns.",
          mutating: false,
        }),
        capability({
          capabilityId: guardian,
          label: "Execute a concurrent guardian program",
          description:
            "Run a bounded survival guardian program with trajectory reactions, fluid placement, interrupts, inventory budgets, and health evidence.",
          mutating: true,
        }),
        capability({
          capabilityId: walk,
          label: "Walk the player",
          description: "Hold one movement direction for a bounded duration.",
          mutating: true,
        }),
        capability({
          capabilityId: transfer,
          label: "Transfer inventory items",
          description:
            "Move item stacks between player inventory and a container.",
          mutating: true,
        }),
        capability({
          capabilityId: unrelated,
          label: "Unrelated action",
          description: "Perform an unrelated action.",
          mutating: true,
          inputDescription: "UNRELATED_SCHEMA_PAYLOAD".repeat(10_000),
        }),
      ],
      assistant_answer: false,
      raw_content_included: false,
    } as any;

    const projection = buildCodexModelCapabilityPromptProjection({
      question:
        "Save me from fall damage with one water source using a bounded survival guardian program and report trajectory, inventory, and health evidence.",
      gatewayManifest: fullManifest,
      requiredCapabilityIds: [actorStatus],
      alwaysDetailedCapabilityIds: [actorStatus, inventory, spatial],
      maxSemanticallyRankedCapabilities: 2,
      preferMutatingCapabilities: true,
    });

    expect(
      projection.capabilityIndex.capabilities.map(
        (entry) => entry.capability_id,
      ),
    ).toEqual([
      actorStatus,
      inventory,
      spatial,
      guardian,
      walk,
      transfer,
      unrelated,
    ]);
    expect(projection.detailedCapabilityIds).toEqual([
      actorStatus,
      inventory,
      spatial,
      guardian,
      transfer,
    ]);
    expect(
      projection.detailedGatewayManifest.capabilities.map(
        (entry) => entry.capability_id,
      ),
    ).toEqual([actorStatus, inventory, spatial, guardian, transfer]);
    expect(
      projection.capabilityIndex.capabilities.find(
        (entry) => entry.capability_id === unrelated,
      ),
    ).toEqual(
      expect.objectContaining({
        detailed_schema_included: false,
        required_top_level_fields: ["target"],
      }),
    );
    expect(JSON.stringify(projection)).not.toContain(
      "UNRELATED_SCHEMA_PAYLOAD",
    );
    expect(JSON.stringify(projection).length).toBeLessThan(20_000);
    expect(JSON.stringify(fullManifest).length).toBeGreaterThan(200_000);

    const preferredCapabilityIds =
      carryCodexDetailedActionsIntoContinuationPreferences({
        preferredCapabilityIds: [actorStatus],
        projection,
      });
    expect(preferredCapabilityIds).toEqual([
      actorStatus,
      guardian,
      transfer,
    ]);

    // "Report inventory evidence" can make a transfer schema useful for
    // semantic retrieval without asking Codex to move an item. Retrieval
    // preferences must not become terminal obligations.
    const reportingSets = buildCodexContinuationCapabilitySets({
        requiredCapabilityIds: [actorStatus],
        projection,
      });
    expect(reportingSets).toEqual({
      requiredCapabilityIds: [actorStatus],
      preferredCapabilityIds: [actorStatus, guardian, transfer],
    });
    expect(
      selectCodexCompoundRequiredCapabilityIds({
        semanticPlayerEmbodimentActionRequired: true,
        ...reportingSets,
      }),
    ).toEqual([actorStatus]);
    expect(
      selectCodexCompoundRequiredCapabilityIds({
        semanticPlayerEmbodimentActionRequired: false,
        ...reportingSets,
      }),
    ).toEqual([actorStatus, guardian, transfer]);

    // An explicitly admitted transfer remains a real terminal obligation.
    expect(
      buildCodexContinuationCapabilitySets({
        requiredCapabilityIds: [actorStatus, transfer],
        projection,
      }),
    ).toEqual({
      requiredCapabilityIds: [actorStatus, transfer],
      preferredCapabilityIds: [actorStatus, transfer, guardian],
    });
  });

  it("retrieves camera tracking rather than a fixed guardian action for a tracking prompt", () => {
    const projection = buildCodexModelCapabilityPromptProjection({
      question:
        "Keep the nearest bat centered smoothly for thirty seconds and report angular tracking error.",
      gatewayManifest: {
        schema: "helix.workstation_tool_gateway.v1",
        manifest_version: "test",
        agent_runtime: "codex",
        mode: "act",
        capabilities: [
          {
            capability_id: "com.casimirbot.minecraft.player.guardian.execute",
            label: "Execute a concurrent guardian program",
            description: "Run concurrent typed lanes and interrupts.",
            mode: "act",
            mutating: true,
            requires_confirmation: true,
            requires_source: true,
            permission_profile_required: "act",
            input_schema: { type: "object" },
            safety_tags: ["world_mutation"],
          },
          {
            capability_id: "com.casimirbot.minecraft.player.camera.track",
            label: "Track an entity with the camera",
            description:
              "Keep a loaded entity centered for a bounded interval and report measured angular error.",
            mode: "act",
            mutating: true,
            requires_confirmation: true,
            requires_source: true,
            permission_profile_required: "act",
            input_schema: { type: "object" },
            safety_tags: ["player_control"],
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      } as any,
      maxSemanticallyRankedCapabilities: 1,
      preferMutatingCapabilities: true,
    });

    expect(projection.detailedCapabilityIds).toEqual([
      "com.casimirbot.minecraft.player.camera.track",
    ]);
  });

  it("retries an act-only provider-selected capability without replaying the large initial catalog", () => {
    const guardian = "com.casimirbot.minecraft.player.guardian.execute";
    const unrelated = "live_env.query_visual_summaries";
    const state = {
      schema: "helix.agent_continuation_state.v1",
      turn_id: "ask:test:focused-guardian-retry",
      state_id: "ask:test:focused-guardian-retry:state:1",
      sequence: 1,
      trigger: "initial",
      goal: {
        status: "in_progress",
        satisfied: false,
        terminal_product_allowed: false,
      },
      observation_refs: { all: [], existing: [], new: [] },
      missing_requirement_ids: ["minecraft.player_embodiment.action"],
      last_attempt: null,
      next_admissible_affordances: [],
      capability_proposal: {
        allowed: true,
        admitted_capability_ids: [guardian, unrelated],
        authority: "helix_policy_admits_runtime_proposal",
      },
      tried_action_fingerprints: [],
      progress: {
        made_progress: false,
        new_observation_count: 0,
        resolved_requirement_ids: [],
        added_requirement_ids: ["minecraft.player_embodiment.action"],
        new_affordance_count: 0,
        no_progress_repeat_count: 0,
        reason_codes: ["initial_continuation_state"],
      },
      budget: {
        soft: {
          iterations: { max: null, consumed: 0, remaining: null },
          tool_calls: { max: null, consumed: 0, remaining: null },
          model_decisions: { max: null, consumed: 0, remaining: null },
          pressure: "none",
          exhausted: false,
        },
        hard: {
          iterations: { max: null, consumed: 0, remaining: null },
          tool_calls: { max: null, consumed: 0, remaining: null },
          model_decisions: { max: null, consumed: 0, remaining: null },
          exhausted: false,
        },
        extension_count: 0,
        max_extensions: null,
      },
      allowed_decisions: ["act"],
      authority: "runtime_agent_decides_within_admitted_boundaries",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    } as HelixAgentContinuationState;
    const prompt = buildCodexFocusedInitialCapabilityRetryPrompt({
      question:
        "Track the cow while taking one short step and feeding it exactly three times, stopping if health drops below six.",
      continuationState: state,
      availableCapabilities: [
        {
          capability_id: guardian,
          label: "Execute bounded guardian program",
          mode: "act",
          mutating: true,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["program"],
            properties: {
              program: {
                type: "object",
                description: "A bounded concurrent reactive program.",
              },
            },
          },
        },
        {
          capability_id: unrelated,
          label: "Unrelated live-source query",
          mode: "read",
          mutating: false,
          input_schema: {
            type: "object",
            description: "UNRELATED_CATALOG_PAYLOAD".repeat(10_000),
          },
        },
      ] as any,
      admittedCapabilityIds: [guardian, unrelated],
      preferredCapabilityIds: [guardian],
      retryInstruction:
        "Output only HELIX_CAPABILITY_LANE_REQUEST_JSON for the admitted capability identified in the prior response.",
      priorResponse: `The governed action is ${guardian}, but I did not emit it.`,
    });

    expect(prompt).toContain("Original user request:");
    expect(prompt).toContain(guardian);
    expect(prompt).toContain("A bounded concurrent reactive program.");
    expect(prompt).toContain("Prior non-compliant response");
    expect(prompt).not.toContain("UNRELATED_CATALOG_PAYLOAD");
    expect(prompt).not.toContain(
      "Available Helix workstation gateway capabilities:",
    );
    expect(prompt.length).toBeLessThan(40_000);
  });

  it("keeps validator-only guardian failures on an exact graph repair instead of proposing world diagnostics", () => {
    const guardian = "com.casimirbot.minecraft.player.guardian.execute";
    const actorStatus = "com.casimirbot.minecraft.actor.status.read";
    const state = {
      schema: "helix.agent_continuation_state.v1",
      turn_id: "ask:test:guardian-validator-repair",
      state_id: "ask:test:guardian-validator-repair:state:2",
      sequence: 2,
      trigger: "post_attempt",
      goal: {
        status: "in_progress",
        satisfied: false,
        terminal_product_allowed: false,
      },
      observation_refs: { all: ["obs:validation"], existing: [], new: ["obs:validation"] },
      missing_requirement_ids: ["minecraft.player_embodiment.action"],
      last_attempt: {
        attempt_id: "attempt:1",
        capability_id: guardian,
        action_fingerprint: "fingerprint:1",
        status: "failed",
        failure_class: "invalid_args",
        failure_code: "precondition_failed",
        failure_message:
          "The concurrent Minecraft guardian program failed its trusted contract: lanes.0.nodes: Reactive lane graphs must be acyclic.",
        retryability: "retryable",
        observation_refs: ["obs:validation"],
      },
      next_admissible_affordances: [],
      capability_proposal: {
        allowed: true,
        admitted_capability_ids: [guardian, actorStatus],
        authority: "helix_policy_admits_runtime_proposal",
      },
      tried_action_fingerprints: ["fingerprint:1"],
      progress: {
        made_progress: false,
        new_observation_count: 1,
        resolved_requirement_ids: [],
        added_requirement_ids: [],
        new_affordance_count: 0,
        no_progress_repeat_count: 1,
        reason_codes: ["failed_attempt_observation_only"],
      },
      budget: {
        soft: {
          iterations: { max: 12, consumed: 1, remaining: 11 },
          tool_calls: { max: 12, consumed: 1, remaining: 11 },
          model_decisions: { max: 12, consumed: 1, remaining: 11 },
          pressure: "none",
          exhausted: false,
        },
        hard: {
          iterations: { max: 20, consumed: 1, remaining: 19 },
          tool_calls: { max: 20, consumed: 1, remaining: 19 },
          model_decisions: { max: 20, consumed: 1, remaining: 19 },
          exhausted: false,
        },
        extension_count: 0,
        max_extensions: 0,
      },
      allowed_decisions: ["retry"],
      authority: "runtime_agent_decides_within_admitted_boundaries",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    } as HelixAgentContinuationState;
    const capabilities = [
      {
        capability_id: guardian,
        label: "Execute bounded guardian program",
        mode: "act",
        mutating: true,
        input_schema: {
          type: "object",
          required: ["program_schema"],
          properties: { program_schema: { type: "string" } },
        },
      },
      {
        capability_id: actorStatus,
        label: "Read actor status",
        mode: "read",
        mutating: false,
        input_schema: { type: "object", properties: {} },
      },
    ] as any;

    const validatorRepair = buildCodexContinuationCapabilityInputContractLines({
      continuationState: state,
      availableCapabilities: capabilities,
      admittedCapabilityIds: [guardian, actorStatus],
    }).join("\n");
    expect(validatorRepair).toContain(guardian);
    expect(validatorRepair).not.toContain(actorStatus);

    const admittedInputSchemaRepair =
      buildCodexContinuationCapabilityInputContractLines({
        continuationState: {
          ...state,
          last_attempt: {
            ...state.last_attempt!,
            failure_message:
              "Minecraft player-action arguments did not satisfy the admitted input schema: $.sequence_schema: Missing required property sequence_schema.",
          },
        },
        availableCapabilities: capabilities,
        admittedCapabilityIds: [guardian, actorStatus],
      }).join("\n");
    expect(admittedInputSchemaRepair).toContain(guardian);
    expect(admittedInputSchemaRepair).not.toContain(actorStatus);

    const runtimeFailure = buildCodexContinuationCapabilityInputContractLines({
      continuationState: {
        ...state,
        last_attempt: {
          ...state.last_attempt!,
          failure_class: "unknown",
          failure_code: "failed",
          failure_message: "A required reactive lane failed or was canceled.",
        },
      },
      availableCapabilities: capabilities,
      admittedCapabilityIds: [guardian, actorStatus],
    }).join("\n");
    expect(runtimeFailure).toContain(actorStatus);
  });
});
