import { describe, expect, it } from "vitest";
import {
  explicitCapabilityContractForCapability,
  extractExplicitCapabilityContracts,
  extractPlannerBindingCapabilityContracts,
  isExclusiveExplicitMinecraftCommandToolRequest,
  isIsolatedExplicitMinecraftCommandCapabilityIntent,
} from "../explicit-capability-contract";
import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";
import { interpretHelixAskPrompt } from "../prompt-interpretation";
import { buildToolCallAdmissionDecision } from "../tool-call-admission";
import { buildHelixCompoundCapabilityContract } from "../compound-capability-contract";
import {
  assertCapabilityAllowedByCommittedRoute,
  buildCommittedAskRoute,
  inferCommittedRouteToolFamily,
} from "../committed-ask-route";
import { resolveToolFamilyContract } from "../tool-family-contract";
import { buildRouteProductContract } from "../route-product-contract";
import {
  HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
  HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
  HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
  HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
  HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
  HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
  HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
  HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
  HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
  HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
  HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS,
  HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
} from "@shared/helix-environment-connector";
import {
  HELIX_MINECRAFT_COMMAND_CAPABILITY,
  HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
} from "@shared/helix-environment-command";
import {
  HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS,
  HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
} from "@shared/helix-minecraft-player-capabilities";

const CAPABILITY = "com.casimirbot.minecraft.inventory.check";

describe("Minecraft environment connector capability routing", () => {
  it.each([
    [
      "On the live Fabric server in this room, check the running Minecraft registry and tell me whether the exact block ID minecraft:netherrack exists. Use current environment evidence rather than general knowledge.",
      HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
    ],
    [
      "From the connected Fabric server, list the live recipes that produce minecraft:stone_bricks, with at most five results.",
      HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
    ],
  ])("routes a live mechanics fact request through the environment: %s", (prompt, capability) => {
    const contracts = extractExplicitCapabilityContracts(prompt, {
      trusted_environment_domain: "minecraft",
    });
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: `turn:${capability}`,
      threadId: `thread:${capability}`,
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });

    expect(contracts.map((entry) => entry.capability)).toContain(capability);
    expect(sourceTarget).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.reasons).not.toContain("negative_workspace_scope");
  });

  it.each([
    "Do not check whether minecraft:netherrack exists in the live Minecraft block registry.",
    "Later, check whether minecraft:netherrack exists in the live Minecraft block registry.",
    'The guide says "check whether minecraft:netherrack exists in the live Minecraft block registry."',
    "Why did the previous turn check whether minecraft:netherrack exists in the live Minecraft block registry?",
    "Do not look up recipes that produce minecraft:stone_bricks on the Fabric server.",
    "Later we may look up recipes that produce minecraft:stone_bricks on the Fabric server.",
    'The screen shows "look up recipes that produce minecraft:stone_bricks" as an example.',
  ])("does not execute contextual live mechanics wording: %s", (prompt) => {
    const capabilities = extractExplicitCapabilityContracts(prompt, {
      trusted_environment_domain: "minecraft",
    }).map((entry) => entry.capability);

    expect(capabilities).not.toContain(
      HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
    );
    expect(capabilities).not.toContain(
      HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
    );
  });

  it("preserves an affirmative general-knowledge-only request as model-only", () => {
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "turn:general-knowledge-only",
      threadId: "thread:general-knowledge-only",
      promptText: "Use only general knowledge to explain what netherrack is.",
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });

    expect(sourceTarget).toMatchObject({
      target_source: "model_only",
      strength: "hard",
    });
  });

  it("keeps the Player Embodiment look contract aligned with the live gateway schema", () => {
    expect(
      explicitCapabilityContractForCapability(
        "com.casimirbot.minecraft.player.look",
      ),
    ).toMatchObject({
      required_args: ["target_kind", "max_turn_degrees_per_tick"],
      optional_args: expect.arrayContaining([
        "position",
        "yaw_delta_degrees",
        "pitch_delta_degrees",
        "environment_label",
      ]),
    });
  });

  it("requires an existing workflow reference for every workflow-control contract", () => {
    for (const capability of [
      "com.casimirbot.minecraft.player.workflow.status",
      "com.casimirbot.minecraft.player.workflow.resume",
      "com.casimirbot.minecraft.player.workflow.cancel",
      "com.casimirbot.minecraft.player.emergency_stop",
    ]) {
      expect(explicitCapabilityContractForCapability(capability)).toMatchObject({
        required_args: ["workflow_ref"],
        optional_args: ["reason"],
      });
    }
  });

  it("binds conditional movement evidence without preselecting the player action", () => {
    const prompt =
      "Help me take one safe step as a player in the active Minecraft Fabric world. First inspect a small region immediately around and below DatDamPig. If a cardinal direction has solid walkable support, safe headroom, and no nearby fire, drop, or other immediate hazard, use the paired Player Embodiment client to walk no more than one block in that direction, then make a fresh player-status check. If no safe direction is evidenced, do not move and explain the missing or unsafe evidence.";
    const contract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:conditional-safe-player-step",
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });
    const spatial = contract?.subgoals.find(
      (subgoal) =>
        subgoal.requested_capability ===
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    );
    const walk = contract?.subgoals.find(
      (subgoal) =>
        subgoal.requested_capability ===
        HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
    );

    expect(spatial?.args_hint).toMatchObject({
      target: "current_actor",
      purpose: "movement_safety",
    });
    expect(walk).toBeUndefined();
  });

  it("admits an operative Player Embodiment plane without preselecting Codex's concrete action", () => {
    const prompt =
      "Using only my paired Minecraft Player Embodiment client, rotate my view about 20 degrees to the right without moving, changing inventory, or using server commands. Stop, then read fresh actor-status evidence and report the final yaw and pitch.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "turn:player-embodiment-semantic-selection",
      threadId: "thread:player-embodiment-semantic-selection",
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      precedence_reason: "explicit_minecraft_player_embodiment_source_target",
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.reasons).toContain(
      "player_action_capability_selection_owned_by_runtime",
    );

    const interpretation = interpretHelixAskPrompt(prompt);
    expect(interpretation.control_command_detected).toBe(true);
    expect(interpretation.executable_operator_commands).toEqual([
      expect.objectContaining({
        text: "rotate",
        action_family: "minecraft.player_embodiment",
      }),
    ]);
    expect(
      extractExplicitCapabilityContracts(prompt, {
        trusted_environment_domain: "minecraft",
      }).map((entry) => entry.capability),
    ).not.toContain("com.casimirbot.minecraft.player.look");
    expect(
      extractPlannerBindingCapabilityContracts(prompt, {
        trusted_environment_domain: "minecraft",
      }).map((entry) => entry.capability),
    ).toEqual([HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY]);
    expect(
      buildHelixCompoundCapabilityContract({
        turnId: "turn:player-embodiment-semantic-selection",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      }),
    ).toMatchObject({
      required_capabilities: [HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY],
      subgoals: [
        expect.objectContaining({
          requested_capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        }),
      ],
    });

    const committedRoute = buildCommittedAskRoute({
      turnId: "turn:player-embodiment-semantic-selection",
      promptText: prompt,
      selectedRoute: "/ask",
      payload: {
        source_target_intent: sourceTargetIntent,
        canonical_goal_frame: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
        },
        route_product_contract: {
          allowed_terminal_artifact_kinds: ["direct_answer_text"],
          forbidden_terminal_artifact_kinds: ["model_synthesized_answer"],
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["live_environment"],
        },
      },
    });
    expect(committedRoute).toMatchObject({
      route: {
        source_target: "live_environment",
        strength: "hard",
      },
      canonical_goal: {
        goal_kind: "environment_action_workflow",
        requested_capability: null,
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: expect.arrayContaining([
          "model_synthesized_answer",
          "agent_provider_terminal_candidate",
          "typed_failure",
        ]),
      },
      compatibility: {
        source_goal_capability_terminal_compatible: true,
        violations: [],
      },
    });
  });

  it("uses current authenticated player authority to keep an ambiguous fluid procedure out of World Authority", () => {
    const prompt =
      "Complete the G2 fluid micro-course: inspect the current player state, perform the bounded look/sprint/jump, interact with the verified reachable target, equip the stick, craft four oak planks, verify every checkpoint, and release all controls.";
    const trustedEnvironmentContext = {
      trusted_environment_domain: "minecraft" as const,
      authorized_player_action_capability_ids: [
        HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY,
      ],
    };

    const contracts = extractExplicitCapabilityContracts(
      prompt,
      trustedEnvironmentContext,
    );
    expect(contracts.map((entry) => entry.capability)).not.toContain(
      HELIX_MINECRAFT_COMMAND_CAPABILITY,
    );
    expect(contracts.map((entry) => entry.capability)).not.toContain(
      HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY,
    );
    expect(contracts.map((entry) => entry.capability)).not.toContain(
      HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
    );

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "turn:g2-fluid-authorized-player-plane",
      threadId: "thread:g2-fluid-authorized-player-plane",
      promptText: prompt,
      trustedEnvironmentContext,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      precedence_reason: "explicit_minecraft_player_embodiment_source_target",
    });
    expect(sourceTargetIntent.reasons).toContain(
      "player_action_capability_selection_owned_by_runtime",
    );

    const committedRoute = buildCommittedAskRoute({
      turnId: "turn:g2-fluid-authorized-player-plane",
      promptText: prompt,
      selectedRoute: "/ask",
      payload: {
        source_target_intent: sourceTargetIntent,
        canonical_goal_frame: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["live_environment"],
        },
      },
    });
    expect(committedRoute.canonical_goal).toMatchObject({
      goal_kind: "environment_action_workflow",
      requested_capability: null,
      required_terminal_kind: "model_synthesized_answer",
    });
  });

  it("keeps an ordered read-act-read Player Embodiment request on the live source when server commands are negated", () => {
    const prompt =
      "Using only the paired Minecraft Player Embodiment client, perform this ordered procedure in one turn: first read fresh actor status, second rotate my view 15 degrees to the right, and third read fresh actor status again. Report the before yaw, after yaw, and measured delta. Do not use any World Authority or server commands.";

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "turn:player-embodiment-read-act-read",
      threadId: "thread:player-embodiment-read-act-read",
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      precedence_reason: "explicit_minecraft_player_embodiment_source_target",
      explicit_cues: ["operative_minecraft_player_embodiment_action"],
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.reasons).toContain(
      "player_action_capability_selection_owned_by_runtime",
    );

    const plannerMatches = extractPlannerBindingCapabilityContracts(prompt, {
      trusted_environment_domain: "minecraft",
    });
    expect(plannerMatches.map((entry) => entry.capability)).toEqual([
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ]);

    const contract = buildHelixCompoundCapabilityContract({
      turnId: "turn:player-embodiment-read-act-read",
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });
    expect(contract?.subgoals).toEqual([
      expect.objectContaining({
        order: 1,
        requested_capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        subgoal_identity_policy: "provider_call_occurrence",
        capability_occurrence: 1,
      }),
      expect.objectContaining({
        order: 2,
        requested_capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        subgoal_identity_policy: "provider_call_occurrence",
        capability_occurrence: 2,
      }),
    ]);
    expect(contract?.subgoal_identity_policy).toBe("provider_call_occurrence");
    expect(contract?.requires_all_subgoals).toBe(true);
  });

  it("leaves a natural concurrent Player Embodiment program to Codex instead of prebinding walk from camera wording", () => {
    const prompt =
      "In the paired Minecraft Player Embodiment client, take one very short step forward while turning my camera fifteen degrees to the right at the same time. Use the bounded concurrent reactive capability so both lanes run together, stop immediately if my health drops below six, perform no world mutation, release all controls when done, and report the measured execution evidence.";
    const context = { trusted_environment_domain: "minecraft" as const };

    expect(
      extractExplicitCapabilityContracts(prompt, context).map(
        (entry) => entry.capability,
      ),
    ).toContain(HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY);
    expect(
      extractPlannerBindingCapabilityContracts(prompt, context).map(
        (entry) => entry.capability,
      ),
    ).not.toContain(HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY);

    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "turn:runtime-owned-concurrent-player-action",
      threadId: "thread:runtime-owned-concurrent-player-action",
      promptText: prompt,
      trustedEnvironmentContext: context,
    });
    const admission = buildToolCallAdmissionDecision({
      turnId: "turn:runtime-owned-concurrent-player-action",
      promptText: prompt,
      sourceTargetIntent: sourceTarget,
      trustedEnvironmentContext: context,
    });
    expect(admission).toMatchObject({
      admitted_tool_families: ["live_environment"],
    });
    expect(admission.requested_capability).toBeUndefined();
    expect(admission.selected_capability).toBeUndefined();
    expect(admission.admitted_capability).toBeUndefined();
    expect(admission.mandatory_next_tool_name).not.toBe(
      HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
    );
  });

  it("still prebinds a Player Embodiment capability when the operator names its exact capability ID", () => {
    const prompt =
      "Using the paired Minecraft Player Embodiment client, run com.casimirbot.minecraft.player.walk with direction forward for 250 milliseconds.";
    const plannerCapabilities = extractPlannerBindingCapabilityContracts(
      prompt,
      { trusted_environment_domain: "minecraft" },
    ).map((entry) => entry.capability);

    expect(plannerCapabilities).toContain(
      HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
    );
  });

  it.each([
    'Explain the example "using the paired Minecraft Player Embodiment client, rotate right" without acting.',
    "Later, use the paired Minecraft Player Embodiment client to rotate right.",
    "Previously I used the Player Embodiment plane to rotate right.",
    "If I reconnect later, use the paired Minecraft Player Embodiment client to rotate right.",
    "The screen says use the paired Minecraft Player Embodiment client to rotate right.",
    "Do not use the paired Minecraft Player Embodiment client to rotate right.",
    "Can the Minecraft player client rotate right?",
  ])("does not admit contextual Player Embodiment mutation: %s", (prompt) => {
    expect(interpretHelixAskPrompt(prompt).control_command_detected).toBe(
      false,
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: "turn:contextual-player-embodiment",
        threadId: "thread:contextual-player-embodiment",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      }).precedence_reason,
    ).not.toBe("explicit_minecraft_player_embodiment_source_target");
  });

  it("keeps natural paired-client actions runtime-owned while preserving the explicit verification subgoal", () => {
    const prompt =
      "Using the paired Minecraft player client, take one careful step forward no farther than 1.5 blocks, jump once, stop, and then verify my final position from fresh Minecraft environment evidence. If manual input is detected or the landing path is unsafe, cancel and return the exact typed reason. Do not place or break blocks.";
    const context = { trusted_environment_domain: "minecraft" as const };
    const capabilities = extractExplicitCapabilityContracts(
      prompt,
      context,
    ).map((entry) => entry.capability);

    expect(capabilities).toEqual([
      HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
      HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ]);
    expect(capabilities).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);

    const contract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:paired-client-walk-jump-verify",
      promptText: prompt,
      trustedEnvironmentContext: context,
    });
    expect(contract?.required_capabilities).toEqual([
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ]);
    expect(contract?.subgoals).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        args_hint: { target: "current_actor" },
      }),
    ]);

    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:test:paired-client-walk-jump-verify",
      promptText: prompt,
      sourceTargetIntent: {
        target_source: "live_environment",
        target_kind: "live_environment",
      },
      trustedEnvironmentContext: context,
    });
    expect(admission.compound_requested_capabilities).toEqual([
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ]);
    expect(admission.compound_requested_capabilities).not.toContain(
      HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
    );
    expect(admission.compound_requested_capabilities).not.toContain(
      HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
    );
  });

  it("keeps an immediate player safety precondition executable", () => {
    const prompt =
      "Using only the paired Minecraft Player Embodiment client, if the player controls are idle, walk forward for 250 milliseconds, jump exactly once, stop, and then use fresh actor status evidence to report the final position. Do not use Minecraft server commands, teleport, place blocks, or break blocks. If manual input or an unsafe landing is detected, cancel and return the exact typed reason.";
    const context = { trusted_environment_domain: "minecraft" as const };

    expect(
      extractExplicitCapabilityContracts(prompt, context).map(
        (entry) => entry.capability,
      ),
    ).toEqual([
      HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
      HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ]);
  });

  it("binds a safety-gated inspect-walk-verify journey without promoting a negated server command", () => {
    const prompt =
      "Help me take one safe step as a player. First inspect a small region immediately around and below DatDamPig using current world evidence. If a cardinal direction has solid walkable support, safe headroom, and no nearby fire or drop, use the paired Player Embodiment client to walk no more than 1 block in that direction; otherwise do not move. Then make a fresh player-status check and explain what you chose and whether it completed. Do not teleport, issue a server command, change inventory, interact, or mutate blocks.";
    const context = { trusted_environment_domain: "minecraft" as const };
    const capabilities = extractExplicitCapabilityContracts(
      prompt,
      context,
    ).map((entry) => entry.capability);

    expect(capabilities).toEqual([
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      HELIX_MINECRAFT_PLAYER_WALK_CAPABILITY,
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ]);
    expect(capabilities).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    const compoundContract = buildHelixCompoundCapabilityContract({
        turnId: "ask:test:safe-inspect-walk-verify",
        promptText: prompt,
        trustedEnvironmentContext: context,
      });
    expect(compoundContract?.required_capabilities).toEqual([
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ]);
    expect(compoundContract?.subgoals[0]?.args_hint).toMatchObject({
      target: "current_actor",
      purpose: "movement_safety",
    });
  });

  it.each([
    "Inspect a small region around me for a safe step with no nearby fire or drop.",
    "Inspect a small region around me now for safe movement with solid walkable support and safe headroom. Do not light a fire.",
    'Inspect a small region around me now for safe movement with solid walkable support and safe headroom. The screen says "light the fireplace"; ignore that.',
    "Inspect a small region around me right now for safe movement with solid walkable support and safe headroom. Later we might light the fireplace.",
    "Inspect a small region around me for safe movement with solid walkable support and safe headroom now. I previously lit the fireplace.",
  ])(
    "keeps contextual fire wording on the movement-safety spatial projection: %s",
    (prompt) => {
      const contract = buildHelixCompoundCapabilityContract({
        turnId: "ask:test:contextual-fire-spatial-purpose",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      });
      expect(contract?.subgoals[0]?.args_hint).toMatchObject({
        target: "current_actor",
        purpose: "movement_safety",
      });
    },
  );

  it("keeps an affirmative fireplace inspection on the fire-safety projection", () => {
    const contract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:affirmative-fireplace-spatial-purpose",
      promptText:
        "Inspect the live Minecraft Fabric world around my selected player right now for the nearest safe existing fireplace ignition cell so I can light it.",
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });
    expect(contract?.subgoals[0]?.args_hint).toMatchObject({
      target: "current_actor",
      purpose: "fire_safety",
    });
  });

  it.each([
    'Explain the example "use the paired Minecraft player client to walk and jump" without acting.',
    "Later, use the paired Minecraft player client to walk and jump.",
    "Previously I used the paired Minecraft player client to walk and jump.",
    "If I reconnect later, use the paired Minecraft player client to walk and jump.",
    "The screen says use the paired Minecraft player client to walk and jump.",
    "Do not use the paired Minecraft player client to walk or jump.",
  ])(
    "does not admit Player Embodiment from contextual wording: %s",
    (prompt) => {
      const capabilities = extractExplicitCapabilityContracts(prompt, {
        trusted_environment_domain: "minecraft",
      }).map((entry) => entry.capability);
      expect(
        capabilities.some((capability) =>
          HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS.includes(
            capability as (typeof HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS)[number],
          ),
        ),
      ).toBe(false);
    },
  );

  it.each([
    "Monitor my Minecraft session and only tell me about danger or progress.",
    "Set up a Minecraft Cortana live environment using the active visual source.",
  ])("keeps Minecraft session setup on the action lane: %s", (prompt) => {
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "turn:minecraft-session-setup",
      threadId: "thread:minecraft-session-setup",
      promptText: prompt,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "workspace_panel",
      target_kind: "workspace_panel",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason:
        "minecraft_situation_session_setup_is_action_not_evidence",
    });
    expect(extractExplicitCapabilityContracts(prompt)).toEqual([]);
  });

  it("routes an affirmative durable Minecraft objective to its live environment capability", () => {
    const prompt =
      "Start a durable Minecraft survival goal for my selected player, checkpoint verified progress, and recover from interruption.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "turn:minecraft-durable-goal-create",
      threadId: "thread:minecraft-durable-goal-create",
      promptText: prompt,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      precedence_reason: "affirmative_minecraft_durable_goal_create",
    });
    expect(extractExplicitCapabilityContracts(prompt).map(({ capability }) => capability)).toContain(
      "com.casimirbot.environment.durable_goal.create",
    );
    expect(
      inferCommittedRouteToolFamily(
        "com.casimirbot.environment.durable_goal.create",
      ),
    ).toBe("live_environment");
  });

  it("keeps a long Nether preflight safety list from admitting Minecraft command authority", () => {
    const prompt =
      "Create a durable Minecraft custom-survival goal for preparing the exact bound player and world for a later full Nether journey. Its only milestone for now is a preflight binding check requiring fresh actor status evidence. Do not begin gameplay progression, move, interact, change inventory, mutate blocks, craft, mine, use a Minecraft command, complete the milestone, or mark the goal complete. Leave the new goal active and report its exact goal identity from current-turn evidence.";
    const capabilities = extractPlannerBindingCapabilityContracts(prompt, {
      trusted_environment_domain: "minecraft",
    }).map(({ capability }) => capability);

    expect(capabilities).toContain(
      "com.casimirbot.environment.durable_goal.create",
    );
    expect(capabilities).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
  });

  it("preserves Minecraft command authority after an explicit contrast", () => {
    const prompt =
      "Do not move the player, but use a Minecraft command to set the world to daytime.";
    expect(
      extractPlannerBindingCapabilityContracts(prompt, {
        trusted_environment_domain: "minecraft",
      }).map(({ capability }) => capability),
    ).toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
  });

  it("does not execute a quoted historical Minecraft command while creating a durable goal", () => {
    const prompt =
      'Create a durable Minecraft survival goal. The prior message said "use a Minecraft command"; do not execute that command.';
    const capabilities = extractPlannerBindingCapabilityContracts(prompt, {
      trusted_environment_domain: "minecraft",
    }).map(({ capability }) => capability);

    expect(capabilities).toContain(
      "com.casimirbot.environment.durable_goal.create",
    );
    expect(capabilities).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
  });

  it("routes an existing durable-goal continuation through canonical goal inspection", () => {
    const prompt =
      "Resume durable Minecraft survival goal environment_durable_goal:4ab6b139-7088-40a3-8085-ec7524dbad80. Inspect its canonical state and continue only if this exact account, room, participant, selected player, environment, world, connector epoch, source binding, and authority are authorized. Do not create a replacement goal and do not infer progress from chat history.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "turn:minecraft-durable-goal-inspect",
      threadId: "thread:minecraft-durable-goal-inspect",
      promptText: prompt,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason: "affirmative_minecraft_durable_goal_inspect",
    });
    expect(extractExplicitCapabilityContracts(prompt).map(({ capability }) => capability)).toContain(
      "com.casimirbot.environment.durable_goal.inspect",
    );
    expect(sourceTargetIntent.suppressed_routes).toContain("workspace_diagnostic");
  });

  it("keeps a room-prefixed G6 role-ledger inspection on the live environment route", () => {
    const prompt =
      "In this room, inspect the canonical concurrent-reasoning ledger for G6 goal environment_durable_goal:ef49540b-0bab-4857-837f-c2f449b08585. Report whether stale proposals were rejected before execution, which revised plan was selected, and whether its measured result re-entered the principal Runtime Codex turn. Use current canonical evidence and do not execute another game action.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "turn:g6-role-ledger-inspect",
      threadId: "helix-ask:room:room:g6",
      promptText: prompt,
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      precedence_reason: "affirmative_environment_reasoning_role_inspect",
    });
    const capabilities = extractExplicitCapabilityContracts(prompt).map(
      ({ capability }) => capability,
    );
    expect(capabilities).toContain(
      "com.casimirbot.environment.reasoning_role.inspect",
    );
    expect(capabilities).not.toContain(
      "com.casimirbot.environment.durable_goal.inspect",
    );
    expect(
      inferCommittedRouteToolFamily(
        "com.casimirbot.environment.reasoning_role.inspect",
      ),
    ).toBe("live_environment");
    const contract = buildHelixCompoundCapabilityContract({
      turnId: "turn:g6-role-ledger-inspect",
      promptText: prompt,
    });
    expect(contract?.subgoals).toHaveLength(1);
    expect(contract?.subgoals[0]).toMatchObject({
      requested_capability:
        "com.casimirbot.environment.reasoning_role.inspect",
      required_args: ["goal_id"],
      args_hint: {
        goal_id:
          "environment_durable_goal:ef49540b-0bab-4857-837f-c2f449b08585",
      },
    });
  });

  it("admits inspect, fresh player evidence, and verified progress recording for a compound durable-goal continuation", () => {
    const prompt =
      "Continue my durable Minecraft survival patrol goal environment_durable_goal:8d46e04c-746c-4fde-9bad-0a3c689a1c87. Inspect its canonical state, use fresh current-game evidence to verify that my player is alive and viable, record the baseline checkpoint and complete only the baseline milestone if its required postcondition is actually supported, then tell me the next unverified milestone. Do not move the player or infer progress from chat history.";
    expect(
      extractExplicitCapabilityContracts(prompt).map(({ capability }) => capability),
    ).toEqual(
      expect.arrayContaining([
        "com.casimirbot.environment.durable_goal.inspect",
        "com.casimirbot.minecraft.actor.status.read",
        "com.casimirbot.environment.durable_goal.append",
      ]),
    );
  });

  it.each([
    "Do not record progress for durable Minecraft goal environment_durable_goal:example-12345678.",
    "Later, append a checkpoint to durable Minecraft goal environment_durable_goal:example-12345678.",
    "Previously I completed a milestone for durable Minecraft goal environment_durable_goal:example-12345678.",
    'The screen says "record durable Minecraft goal progress for environment_durable_goal:example-12345678".',
    "Explain how to update a milestone for durable Minecraft goal environment_durable_goal:example-12345678.",
  ])("does not append a contextual durable-goal progress phrase: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt).some(
        ({ capability }) =>
          capability === "com.casimirbot.environment.durable_goal.append",
      ),
    ).toBe(false);
  });

  it.each([
    "Do not resume durable Minecraft goal environment_durable_goal:example-12345678.",
    "Later, inspect durable Minecraft goal environment_durable_goal:example-12345678.",
    "Previously I resumed durable Minecraft goal environment_durable_goal:example-12345678.",
    'The screen says "resume durable Minecraft goal environment_durable_goal:example-12345678".',
    "Explain how to inspect durable Minecraft goal environment_durable_goal:example-12345678.",
  ])("does not inspect a contextual durable-goal reference: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt).some(
        ({ capability }) =>
          capability === "com.casimirbot.environment.durable_goal.inspect",
      ),
    ).toBe(false);
  });

  it.each([
    "Do not start a durable Minecraft survival goal.",
    "Later, start a durable Minecraft survival goal.",
    "Previously I started a durable Minecraft survival goal.",
    'The screen says "start a durable Minecraft survival goal".',
    "Explain how to start a durable Minecraft survival goal.",
  ])("does not execute a contextual durable-goal phrase: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt).some(
        ({ capability }) =>
          capability === "com.casimirbot.environment.durable_goal.create",
      ),
    ).toBe(false);
  });

  it("classifies the exact capability as live environment evidence", () => {
    expect(explicitCapabilityContractForCapability(CAPABILITY)).toMatchObject({
      capability: CAPABILITY,
      capability_family: "live_environment",
      source_target: "live_environment",
      required_terminal_kind: "model_synthesized_answer",
      required_observation_kinds: expect.arrayContaining([
        "helix.environment_connector.probe_observation.v1",
      ]),
    });
    expect(inferCommittedRouteToolFamily(CAPABILITY)).toBe("live_environment");
    expect(
      inferCommittedRouteToolFamily(
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      ),
    ).toBe("live_environment");
    expect(
      inferCommittedRouteToolFamily(HELIX_MINECRAFT_COMMAND_CAPABILITY),
    ).toBe("live_environment");
    expect(resolveToolFamilyContract({ toolName: CAPABILITY })).toMatchObject({
      toolFamily: "live_environment",
      authority: "evidence_only",
      mutating: false,
      requiredReentry: true,
    });
    for (const capability of HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS) {
      expect(explicitCapabilityContractForCapability(capability)).toMatchObject(
        {
          capability,
          capability_family: "live_environment",
          source_target: "live_environment",
          required_terminal_kind: "model_synthesized_answer",
          required_observation_kinds: expect.arrayContaining([
            "helix.environment_connector.probe_observation.v1",
          ]),
        },
      );
      expect(resolveToolFamilyContract({ toolName: capability })).toMatchObject(
        {
          toolFamily: "live_environment",
          authority: "evidence_only",
          mutating: false,
          requiredReentry: true,
        },
      );
    }
  });

  it.each([
    [
      "Check my current health and hunger in Minecraft.",
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ],
    [
      "In Minecraft, list the mobs nearby around me.",
      HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
    ],
    [
      "In Minecraft, am I in danger from hostile mobs nearby right now?",
      HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
    ],
    [
      "Inspect the local terrain around me in Minecraft.",
      HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
    ],
    [
      "Inspect the blocks around my selected Minecraft player right now. Describe any nearby structure boundary and any safe fireplace candidate you can actually verify, but do not change the world.",
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ],
    [
      "Using the Minecraft environment source and my paired Player Embodiment client, first read fresh actor status plus nearby blocks and hazards within 4 blocks; choose a loaded walkable destination only if current-turn evidence proves it has a solid floor and two-block air clearance.",
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ],
    [
      "Using only the Minecraft Fabric environment source, perform a fresh read-only spatial-region inspection for structure_planning around my selected player.",
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ],
    [
      "Inspect the live Minecraft Fabric world around my selected player right now for the nearest safe existing fireplace ignition cell. Use a fresh fire_safety spatial-region observation with a 5000 ms freshness ceiling. Do not mutate anything and do not search documents.",
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ],
    [
      "Before building anything, inspect the area west of my selected Minecraft player and identify the nearest safe level site for a freestanding stone-brick wall five blocks long north-south and three blocks high. Avoid my player, the chest, crafting table, paths, foliage, water, and other structures. Report the exact candidate endpoints and protected anchors, but do not change the world.",
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ],
    [
      "Verify the existing Minecraft wall volume from x=-63 y=69 z=-2 through x=-59 y=71 z=-2 as exactly minecraft:stone_bricks using a fresh structure_verification environment observation with a 5000 ms freshness ceiling. Do not mutate anything and do not search documents.",
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ],
    [
      "Recheck the existing Minecraft block at x=-50 y=68 z=-2 as exactly minecraft:fire using one fresh structure_verification environment observation with a 5000 ms freshness ceiling. Report total, matched, mismatched, and mismatch samples. Do not mutate anything and do not search documents.",
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    ],
    [
      "In Minecraft, check whether I have line of sight to that position.",
      HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
    ],
    [
      "In Minecraft, check whether the wheat crop is mature.",
      HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
    ],
    [
      "In Minecraft, check whether I can reach that position.",
      HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
    ],
  ])(
    "admits the natural read-only situation request %s",
    (prompt, expected) => {
      expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
        expect.objectContaining({
          capability: expected,
          source: "natural_capability_intent",
        }),
      );
    },
  );

  it("uses only canonical spatial arguments for the exact read-only gameplay request", () => {
    const prompt =
      "Inspect the blocks around my selected Minecraft player right now. Describe any nearby structure boundary and any safe fireplace candidate you can actually verify, but do not change the world.";
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:read-only-spatial-inspection",
      promptText: prompt,
    });

    expect(compound?.subgoals).toHaveLength(1);
    expect(compound?.subgoals[0]).toMatchObject({
      requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      args_hint: {
        target: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 6,
        purpose: "fire_safety",
      },
    });
    expect(compound?.subgoals[0]?.args_hint).not.toHaveProperty("radius");
  });

  it("keeps a natural selected-player build-site inspection on the hard live-environment route", () => {
    const prompt =
      "Before building anything, inspect the area west of my selected Minecraft player and identify the nearest safe level site for a freestanding stone-brick wall five blocks long north-south and three blocks high. Avoid my player, the chest, crafting table, paths, foliage, water, and other structures. Report the exact candidate endpoints and protected anchors, but do not change the world.";

    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:selected-player-build-site",
        threadId: "helix-ask:room:shared_realtime_room:build-site",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
    expect(
      buildHelixCompoundCapabilityContract({
        turnId: "ask:test:selected-player-build-site",
        promptText: prompt,
      })?.subgoals,
    ).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        args_hint: {
          target: "current_actor",
          horizontal_radius: 7,
          vertical_radius: 6,
          purpose: "structure_planning",
          requested_length: 5,
          requested_height: 3,
          orientation: "north_south",
          relative_side: "west",
        },
      }),
    ]);
  });

  it("keeps scoped no-mutation and no-docs constraints on an exact Minecraft verification route", () => {
    const prompt =
      "Verify the existing Minecraft wall volume from x=-63 y=69 z=-2 through x=-59 y=71 z=-2 as exactly minecraft:stone_bricks using a fresh structure_verification environment observation with a 5000 ms freshness ceiling. Do not mutate anything and do not search documents.";
    const turnId = "ask:test:exact-wall-verification";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId: "helix-ask:room:shared_realtime_room:exact-wall-verification",
      promptText: prompt,
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      promptText: prompt,
    });
    expect(admission).toMatchObject({
      source_target: "live_environment",
      required: true,
      admitted_tool_families: expect.arrayContaining(["live_environment"]),
      requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    });
    expect(admission.tool_admission_suppressed).not.toBe(true);
    expect(
      buildHelixCompoundCapabilityContract({
        turnId,
        promptText: prompt,
      })?.subgoals,
    ).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        args_hint: {
          target: "current_actor",
          purpose: "structure_verification",
          verification_from: { x: -63, y: 69, z: -2 },
          verification_to: { x: -59, y: 71, z: -2 },
          expected_block: "minecraft:stone_bricks",
          freshness_requirement_ms: 5_000,
        },
      }),
    ]);
  });

  it("treats a scoped no-docs clause as a family constraint during exact single-block recheck", () => {
    const prompt =
      "Recheck the existing Minecraft block at x=-50 y=68 z=-2 as exactly minecraft:fire using one fresh structure_verification environment observation with a 5000 ms freshness ceiling. Report total, matched, mismatched, and mismatch samples. Do not mutate anything and do not search documents.";
    const turnId = "ask:test:exact-single-block-recheck";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId: "helix-ask:room:shared_realtime_room:single-block-recheck",
      promptText: prompt,
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      promptText: prompt,
    });
    expect(admission).toMatchObject({
      source_target: "live_environment",
      required: true,
      admitted_tool_families: expect.arrayContaining(["live_environment"]),
      requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    });
    expect(admission.tool_admission_suppressed).not.toBe(true);
    expect(
      buildHelixCompoundCapabilityContract({
        turnId,
        promptText: prompt,
      })?.subgoals,
    ).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        args_hint: {
          target: "current_actor",
          purpose: "structure_verification",
          verification_from: { x: -50, y: 68, z: -2 },
          verification_to: { x: -50, y: 68, z: -2 },
          expected_block: "minecraft:fire",
          freshness_requirement_ms: 5_000,
        },
      }),
    ]);
  });

  it("keeps scoped no-mutation and no-docs constraints on a live fireplace-safety route", () => {
    const prompt =
      "Inspect the live Minecraft Fabric world around my selected player right now for the nearest safe existing fireplace ignition cell. Use a fresh fire_safety spatial-region observation with a 5000 ms freshness ceiling. Do not mutate anything and do not search documents.";
    const turnId = "ask:test:fireplace-safety-inspection";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId: "helix-ask:room:shared_realtime_room:fireplace-safety",
      promptText: prompt,
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      promptText: prompt,
    });
    expect(admission).toMatchObject({
      source_target: "live_environment",
      required: true,
      admitted_tool_families: expect.arrayContaining(["live_environment"]),
      requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    });
    expect(admission.tool_admission_suppressed).not.toBe(true);
    expect(
      buildHelixCompoundCapabilityContract({
        turnId,
        promptText: prompt,
      })?.subgoals,
    ).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        args_hint: {
          target: "current_actor",
          horizontal_radius: 7,
          vertical_radius: 6,
          purpose: "fire_safety",
        },
      }),
    ]);
  });

  it.each([
    "Do not inspect the area west of my selected Minecraft player for a wall site.",
    "Later, inspect the area west of my selected Minecraft player for a wall site.",
    'The screen says "Inspect the area west of my selected Minecraft player for a wall site."',
    "Historically, before building anything, I inspected the area west of my selected Minecraft player for a wall site.",
    "Explain how to inspect the area west of my selected Minecraft player for a wall site without running the probe.",
    "Do not verify the Minecraft wall volume from x=-63 y=69 z=-2 through x=-59 y=71 z=-2 as exactly minecraft:stone_bricks.",
    "Later, verify the Minecraft wall volume from x=-63 y=69 z=-2 through x=-59 y=71 z=-2 as exactly minecraft:stone_bricks.",
    'The screen says "Verify the Minecraft wall volume from x=-63 y=69 z=-2 through x=-59 y=71 z=-2 as exactly minecraft:stone_bricks."',
    "Historically, we verified the Minecraft wall volume from x=-63 y=69 z=-2 through x=-59 y=71 z=-2 as exactly minecraft:stone_bricks.",
    "Explain how to verify the Minecraft wall volume from x=-63 y=69 z=-2 through x=-59 y=71 z=-2 as exactly minecraft:stone_bricks without running the probe.",
    "Do not recheck the existing Minecraft block at x=-50 y=68 z=-2 as exactly minecraft:fire.",
    "Later, recheck the existing Minecraft block at x=-50 y=68 z=-2 as exactly minecraft:fire.",
    'The screen says "Recheck the existing Minecraft block at x=-50 y=68 z=-2 as exactly minecraft:fire."',
    "Historically, we rechecked the existing Minecraft block at x=-50 y=68 z=-2 as exactly minecraft:fire.",
    "Explain how to recheck the existing Minecraft block at x=-50 y=68 z=-2 as exactly minecraft:fire without running the probe.",
    "Do not inspect the live Minecraft Fabric world around my selected player for a fireplace ignition cell.",
    "Later, inspect the live Minecraft Fabric world around my selected player for a fireplace ignition cell.",
    'The screen says "Inspect the live Minecraft Fabric world around my selected player for a fireplace ignition cell."',
    "Historically, I inspected the live Minecraft Fabric world around my selected player for a fireplace ignition cell.",
    "Explain how to inspect the live Minecraft Fabric world around my selected player for a fireplace ignition cell without running the probe.",
    "Do not read nearby blocks around my selected Minecraft player.",
    "Later, read nearby blocks around my selected Minecraft player.",
    'The screen says "Read nearby blocks around my selected Minecraft player."',
    "Historically, I read nearby blocks around my selected Minecraft player.",
    "Explain how to read nearby blocks around my selected Minecraft player without running the probe.",
    "Do not perform a spatial-region inspection around my selected Minecraft player.",
    "Later, perform a spatial-region inspection around my selected Minecraft player.",
    'The screen says "Perform a spatial-region inspection around my selected Minecraft player."',
    "Historically, I performed a spatial-region inspection around my selected Minecraft player.",
    "Explain how to perform a spatial-region inspection around my selected Minecraft player without running the probe.",
  ])(
    "does not admit contextual selected-player build-site inspection: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY);
    },
  );

  it("can admit several evidence probes for one situation question without making any observation terminal", () => {
    const capabilities = extractExplicitCapabilityContracts(
      "In Minecraft, check my health and current Minecraft inventory, then tell me whether hostile mobs are nearby right now.",
    ).map((entry) => entry.capability);

    expect(capabilities).toEqual(
      expect.arrayContaining([
        HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        CAPABILITY,
        HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
      ]),
    );
  });

  it("admits actor, nearby-entity, and inventory evidence for a compound C0 observation", () => {
    const prompt =
      "C0 admission check only. Using the current admitted Minecraft Fabric source, report the current actor identity, position, health, equipped item, and the nearest zombie identity, distance, and health. Do not issue any player action, command, World Authority mutation, or workflow.";
    const capabilities = extractExplicitCapabilityContracts(prompt).map(
      (entry) => entry.capability,
    );

    expect(capabilities).toEqual(
      expect.arrayContaining([
        HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
        CAPABILITY,
      ]),
    );
  });

  it.each([
    "Do not report the current Minecraft actor identity, position, health, or nearest zombie identity, distance, and health.",
    "Later, report the current Minecraft actor identity, position, health, and nearest zombie identity, distance, and health.",
    "Previously, I reported the current Minecraft actor identity, position, health, and nearest zombie identity, distance, and health.",
    'The screen says "Report the current Minecraft actor identity, position, health, and nearest zombie identity, distance, and health."',
    "Explain how to report the current Minecraft actor identity, position, health, and nearest zombie identity, distance, and health without running a probe.",
  ])("does not admit contextual C0 observation probes: %s", (prompt) => {
    const capabilities = extractExplicitCapabilityContracts(prompt).map(
      (entry) => entry.capability,
    );
    expect(capabilities).not.toContain(
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    );
    expect(capabilities).not.toContain(
      HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
    );
  });

  it("admits the affirmative C0 observation clause after contextual screen text", () => {
    const prompt =
      "The screen mentions a zombie. Using the current Minecraft Fabric source, report the current actor identity, position, health, and the nearest zombie identity, distance, and health; do not attack or mutate the world.";
    const capabilities = extractExplicitCapabilityContracts(prompt).map(
      (entry) => entry.capability,
    );

    expect(capabilities).toEqual(
      expect.arrayContaining([
        HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
      ]),
    );
  });

  it.each([
    ["In the connected Minecraft world, build a wall around my house.", "fill"],
    ["In the current Minecraft world, light the fireplace safely.", "setblock"],
    [
      "In the live Minecraft world, protect me from a dangerous fall.",
      "helixgame fall_rescue",
    ],
  ])(
    "admits spatial evidence and command authority for a structure-aware action: %s",
    (prompt, expectedCatalogPrefix) => {
      const capabilities = extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.capability,
      );
      expect(capabilities).toContain(
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      );
      expect(capabilities).toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
      expect(capabilities).toContain(
        HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
      );
      expect(
        capabilities.indexOf(HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY),
      ).toBeLessThan(capabilities.indexOf(HELIX_MINECRAFT_COMMAND_CAPABILITY));
      expect(
        capabilities.indexOf(HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY),
      ).toBeLessThan(capabilities.indexOf(HELIX_MINECRAFT_COMMAND_CAPABILITY));
      const compound = buildHelixCompoundCapabilityContract({
        turnId: "ask:test:spatial-before-action",
        promptText: prompt,
      });
      expect(
        compound?.subgoals.map((subgoal) => subgoal.requested_capability),
      ).toEqual(capabilities);
      expect(compound?.subgoals[0]?.args_hint).toMatchObject({
        target: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 6,
      });
      expect(compound?.subgoals[1]?.args_hint).toEqual({
        path_prefix: expectedCatalogPrefix,
        limit: 64,
      });
    },
  );

  it("routes an ordinary bounded fall-rescue request through landing inspection and the local rescue command tree", () => {
    const prompt =
      "In the current Minecraft world, protect my selected player from a dangerous fall for the next 60 seconds. Arm the local water rescue now, but do not make me fall yet.";
    const capabilities = extractExplicitCapabilityContracts(prompt).map(
      (entry) => entry.capability,
    );
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:natural-fall-rescue",
      promptText: prompt,
    });

    expect(capabilities).toEqual(
      expect.arrayContaining([
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
        HELIX_MINECRAFT_COMMAND_CAPABILITY,
      ]),
    );
    expect(compound?.subgoals[0]?.args_hint).toMatchObject({
      target: "current_actor",
      purpose: "landing_safety",
    });
    expect(compound?.subgoals[1]?.args_hint).toEqual({
      path_prefix: "helixgame fall_rescue",
      limit: 64,
    });
    expect(compound?.subgoals[2]?.mandatory).toBe(true);
  });

  it("keeps a safety-conditional fall-rescue command model-decided after inspection", () => {
    const prompt =
      "Protect my selected Minecraft player from a dangerous fall for the next 300 seconds. First inspect my current landing area. If it is safe, arm the local fall rescue; otherwise report why you stopped.";
    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:conditional-fall-rescue",
      promptText: prompt,
    });

    expect(
      compound?.subgoals.map((subgoal) => ({
        capability: subgoal.requested_capability,
        mandatory: subgoal.mandatory,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          mandatory: true,
        },
        {
          capability: HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
          mandatory: true,
        },
        {
          capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
          mandatory: false,
        },
      ]),
    );
    expect(compound?.required_capabilities).not.toContain(
      HELIX_MINECRAFT_COMMAND_CAPABILITY,
    );
    expect(compound?.requires_all_subgoals).toBe(false);
  });

  it.each([
    "Do not arm fall rescue in my current Minecraft world.",
    "Later, protect me from a dangerous fall in my current Minecraft world.",
    'The room transcript says "Arm fall rescue in my current Minecraft world."',
    "Historically, you protected me from a dangerous fall in Minecraft.",
    "Explain how to arm fall rescue in Minecraft without running anything.",
  ])(
    "does not admit contextual or non-immediate fall-rescue mutation: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it("uses only trusted selected-room Minecraft scope for an ordinary wall follow-up", () => {
    const turnId = "ask:test:trusted-room-wall-followup";
    const prompt =
      "At my current safe plains site, build a freestanding stone-brick wall five blocks long north-south and three blocks high at the nearest safe level location at least three blocks away from me. Inspect first and avoid my player, entities, structures, foliage, paths, and water. Capture a rollback checkpoint before changing blocks, build only on verified solid support into verified air, inspect the finished wall, and report the exact endpoints plus checkpoint status. If no safe site is verified, do not build.";
    const trustedEnvironmentContext = {
      trusted_environment_domain: "minecraft" as const,
    };

    expect(
      extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.capability,
      ),
    ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    const capabilities = extractExplicitCapabilityContracts(
      prompt,
      trustedEnvironmentContext,
    ).map((entry) => entry.capability);
    expect(capabilities).toEqual(
      expect.arrayContaining([
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
        HELIX_MINECRAFT_COMMAND_CAPABILITY,
      ]),
    );

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId: "helix-ask:room:shared_realtime_room:trusted-wall",
      promptText: prompt,
      trustedEnvironmentContext,
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      promptText: prompt,
      trustedEnvironmentContext,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
    });
    expect(admission).toMatchObject({
      source_target: "live_environment",
      required: true,
      admitted_tool_families: expect.arrayContaining(["live_environment"]),
      compound_requested_capabilities: expect.arrayContaining(capabilities),
    });
    const compound = buildHelixCompoundCapabilityContract({
      turnId,
      promptText: prompt,
      trustedEnvironmentContext,
    });
    expect(
      compound?.subgoals.map((subgoal) => subgoal.requested_capability),
    ).toEqual(capabilities);
    const spatialSubgoal = compound?.subgoals.find(
      (subgoal) =>
        subgoal.requested_capability ===
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    );
    const commandSubgoal = compound?.subgoals.find(
      (subgoal) =>
        subgoal.requested_capability === HELIX_MINECRAFT_COMMAND_CAPABILITY,
    );
    expect(commandSubgoal?.guarded_noop_policy).toMatchObject({
      schema: "helix.compound_capability_guarded_noop.v1",
      mode: "no_verified_safe_candidate",
      guard_subgoal_id: spatialSubgoal?.subgoal_id,
      guard_capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      required_purpose: "structure_planning",
      accepted_observation_purposes: ["structure_planning", "build_planning"],
      candidate_field: "build_line_candidates",
      completeness_field: "build_line_candidates_complete",
      omitted_count_field: "omitted_build_line_candidate_count",
      current_turn_only: true,
      requires_successful_observation: true,
      user_directed_noop_guard: true,
    });
  });

  it.each([
    "At my current safe plains site, build a wall after inspecting it.",
    'The room transcript says "If no safe site is verified, do not build."',
    "If no safe site is verified later, explain why a builder should not build.",
  ])("does not invent guarded no-op authority for %s", (prompt) => {
    const commandSubgoal = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:no-guarded-noop-shortcut",
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    })?.subgoals.find(
      (subgoal) =>
        subgoal.requested_capability === HELIX_MINECRAFT_COMMAND_CAPABILITY,
    );
    expect(commandSubgoal?.guarded_noop_policy).toBeUndefined();
  });

  it.each([
    'The room transcript contains "build a freestanding stone-brick wall beside me."',
    "If the area is clear later, build a freestanding stone-brick wall beside me.",
    "At my current site, do not build a freestanding stone-brick wall beside me.",
  ])(
    "does not turn trusted room scope into execution for contextual wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt, {
          trusted_environment_domain: "minecraft",
        }).map((entry) => entry.capability),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it.each([
    "Do not build a wall around my house in the connected Minecraft world.",
    "Later, light the fireplace in the current Minecraft world.",
    'The screen says "Protect me from a fall in the live Minecraft world."',
    "Historically, we built a wall around my house in the connected Minecraft world.",
    "Explain how to light a Minecraft fireplace, but do not execute anything.",
    'The room transcript contains "At my current safe plains site, build a wall beside my selected Minecraft player."',
    "If the area is clear later, build a wall beside my selected Minecraft player.",
    "At my current safe plains site, do not build a wall beside my selected Minecraft player.",
  ])(
    "never admits mutation for contextual structure-aware wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it("routes an affirmative live Fabric dispatcher request to the exact Minecraft command capability", () => {
    const prompt =
      "Using the live Fabric server command dispatcher, list the players currently on the server whitelist and tell me the result.";
    expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-command-surface",
        threadId: "helix-ask:room:shared_realtime_room:command-surface",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
  });

  it.each([
    "Can you make me glow for ten seconds in the connected Minecraft world?",
    "Please give me night vision for one minute in Minecraft.",
    "In the live Fabric world, bring that pig over here.",
    "In the connected Minecraft world, create a glowing allay named HELIX GUIDE about three blocks in front of me and tag it helix_guide_demo.",
    "In the connected Minecraft world, create a glowing allay named HELIX GUIDE about three blocks in front of me, safely frozen in place, and tag it helix_guide_demo so we can remove only this demo later.",
    "Build a temporary stone arch beside me in the connected Minecraft world.",
    "Construct a tagged demonstration platform near me in Minecraft.",
    "Yes—continue now with exactly the two remaining live-world actions from your last answer: show DatDamPig the aqua title HELIX GUIDE ONLINE, then play the bright amethyst-block chime at DatDamPig's current position. Use the connected Fabric environment, and report only fresh observed outcomes.",
    "In the connected Fabric environment, display a title for DatDamPig now.",
    "Clear the weather in the connected Minecraft world.",
    "I want you to save the current Minecraft server world now.",
    "In Minecraft, set the time to noon and tell me what happened.",
  ])(
    "proposes the command surface for an affirmative natural Minecraft action: %s",
    (prompt) => {
      expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
        expect.objectContaining({
          capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
          source: "natural_capability_intent",
        }),
      );
      expect(
        arbitrateAskSourceTarget({
          turnId: `ask:test:minecraft-natural-action:${prompt.length}`,
          threadId: "helix-ask:room:shared_realtime_room:natural-action",
          promptText: prompt,
        }),
      ).toMatchObject({
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
        allow_no_tool_direct: false,
      });
    },
  );

  it.each([
    "Do not make me glow in the connected Minecraft world.",
    "Later I may ask you to make me glow in Minecraft.",
    "If I join again, make me glow in Minecraft.",
    'The screen says "Can you make me glow in Minecraft?"',
    '"Make me glow in Minecraft" is only an example request.',
    "Historically, I asked you to make me glow in Minecraft.",
    "Can you explain how to make me glow in Minecraft?",
    "Explain glowing in Minecraft, but do not apply it.",
    "Can the Minecraft connector make me glow?",
    "Do not create a glowing allay in the connected Minecraft world.",
    "Later, create a tagged allay in Minecraft.",
    'The screen says "Build a temporary stone arch in Minecraft."',
    "Historically, we constructed a tagged demonstration platform in Minecraft.",
    "Can you explain how to create a named allay in Minecraft?",
    "Can the Minecraft connector build structures?",
    'The screen says: "show DatDamPig the title HELIX GUIDE ONLINE in the Fabric world."',
    "The Fabric guide says to play an amethyst chime, but do not run it.",
    "Later, display HELIX GUIDE ONLINE for DatDamPig in Minecraft.",
    '"Then play a chime in the connected Fabric environment" is only an example.',
  ])(
    "does not propose a mutating Minecraft command for contextual wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it("admits an affirmative action in a mixed request while preserving final synthesis", () => {
    const prompt =
      "Make me glow in the connected Minecraft world, then explain what happened.";
    expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
        source: "natural_capability_intent",
        contract: expect.objectContaining({
          required_terminal_kind: "model_synthesized_answer",
        }),
      }),
    );
  });

  it.each([
    "Check the paired Minecraft server's live command capabilities, then tell me the current daytime without changing the world.",
    "What is the current daytime value in our Minecraft world? Please read it directly from the live Fabric server before you answer.",
  ])("admits an affirmative natural live-world property read: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt, {
        trusted_environment_domain: "minecraft",
      }),
    ).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: `ask:test:minecraft-live-world-property:${prompt.length}`,
        threadId: "helix-ask:room:shared_realtime_room:live-world-property",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
      allow_no_tool_direct: false,
    });
  });

  it.each([
    "Do not check the current daytime in the paired Minecraft server.",
    "Later, check the current daytime in our Minecraft world, but not now.",
    "If I reconnect, check the current Minecraft weather.",
    "Historically, we checked the current daytime in the Fabric server.",
    'The room transcript says "check the current daytime in Minecraft."',
    '"Check the current Minecraft daytime" is only an example request.',
    "Explain how to check the current daytime in Minecraft without running anything.",
  ])("does not execute a contextual live-world property read: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt, {
        trusted_environment_domain: "minecraft",
      }).map((entry) => entry.capability),
    ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
  });

  it("admits goal-shaped Minecraft mechanics retrieval without requiring a document title and keeps execution suppressed", () => {
    const prompt =
      "Before doing anything in Minecraft, look up the connected environment mechanics for how to give my bound player a temporary glowing effect for ten seconds. Cite the exact source file and line that supports the command you would use. Do not execute any command.";
    const capabilities = extractExplicitCapabilityContracts(prompt).map(
      (entry) => entry.capability,
    );
    expect(capabilities).toContain("docs-viewer.search_docs");
    expect(capabilities).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-mechanics-docs",
        threadId: "helix-ask:room:shared_realtime_room:mechanics-docs",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "docs_viewer",
      target_kind: "docs_viewer",
      strength: "hard",
      requested_outputs: expect.arrayContaining([
        "file_path",
        "line_backed_source",
        "tool_call_eligibility",
      ]),
      suppressed_routes: expect.arrayContaining([
        "scholarly_research_lookup",
        "workstation_action",
        "model_only_concept",
      ]),
      allow_no_tool_direct: false,
      precedence_reason: "minecraft_environment_mechanics_docs_source_target",
    });
  });

  it.each([
    "Do not look up any Minecraft command docs; explain the phrase only.",
    "Later, look up the Minecraft command mechanics, but not now.",
    "If I join again, look up the Fabric command syntax.",
    "Earlier you looked up the Minecraft mechanics and cited a source line.",
    'The screen says "look up the Minecraft command docs"; explain that text.',
    '"Look up the Minecraft command docs" is only an example prompt.',
  ])("does not retrieve mechanics for contextual wording: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.capability,
      ),
    ).not.toContain("docs-viewer.search_docs");
  });

  it("treats a bare one-line Minecraft slash command as an affirmative exact operator command", () => {
    const prompt = "/gamerule doDaylightCycle false";
    expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:bare-minecraft-command",
        threadId: "helix-ask:room:shared_realtime_room:bare-command",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
    });
  });

  it("keeps an exact paired-world command affirmative when a later clause excludes every other command", () => {
    const prompt =
      "In my paired Minecraft Fabric world, run the exact catalog command /helixgame checkpoint capture helixbindtest 1 1 for my selected player. Then run /helixgame checkpoint status and report the fresh observations. Do not run any other command.";
    expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:paired-exact-command-with-scoped-exclusion",
        threadId: "helix-ask:room:shared_realtime_room:paired-exact-command",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
    });
  });

  it("binds a schema-complete exact Minecraft command into the compound itinerary", () => {
    const prompt =
      'Run exactly one command in the paired Minecraft Fabric environment. Use com.casimirbot.minecraft.command with command "/helixgame checkpoint status", category "query", and effect "read_only". Do not run any other command.';
    const commandSubgoal = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:exact-minecraft-command-args",
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    })?.subgoals.find(
      (subgoal) =>
        subgoal.requested_capability === HELIX_MINECRAFT_COMMAND_CAPABILITY,
    );

    expect(commandSubgoal?.args_hint).toEqual({
      command: "helixgame checkpoint status",
      category: "query",
      effect: "read_only",
    });
  });

  it("isolates an affirmative exact command from excluded helper tools without admitting contextual variants", () => {
    const prompt =
      'Run exactly one command in the paired Minecraft Fabric environment. Use com.casimirbot.minecraft.command with command "time query daytime", category "server_query", and effect "read_only". Do not run any other command or tool.';
    expect(isIsolatedExplicitMinecraftCommandCapabilityIntent(prompt)).toBe(
      true,
    );

    for (const contextual of [
      `Do not ${prompt}`,
      `Later, ${prompt}`,
      `The transcript says "${prompt}"`,
      `Explain this instruction without executing it: ${prompt}`,
    ]) {
      expect(
        isIsolatedExplicitMinecraftCommandCapabilityIntent(contextual),
      ).toBe(false);
    }
  });

  it("keeps a semantic mutation preface inside an explicit one-command boundary", () => {
    const prompt =
      'Ignite the already surveyed fire-safe hearth cell in my paired Minecraft Fabric world. Run exactly one command: use com.casimirbot.minecraft.command with command "setblock -50 68 -2 minecraft:fire", category "world_build", and effect "world_mutation". Do not run any other command or tool.';
    const context = { trusted_environment_domain: "minecraft" as const };

    expect(isExclusiveExplicitMinecraftCommandToolRequest(prompt)).toBe(true);
    expect(
      isIsolatedExplicitMinecraftCommandCapabilityIntent(prompt, context),
    ).toBe(true);
    expect(
      extractExplicitCapabilityContracts(prompt, context).map(
        (entry) => entry.capability,
      ),
    ).toEqual([HELIX_MINECRAFT_COMMAND_CAPABILITY]);

    const compound = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:exclusive-fireplace-command",
      promptText: prompt,
      trustedEnvironmentContext: context,
    });
    expect(compound?.required_capabilities).toEqual([
      HELIX_MINECRAFT_COMMAND_CAPABILITY,
    ]);
    expect(compound?.requires_all_subgoals).toBe(false);

    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:test:exclusive-fireplace-command",
      promptText: prompt,
      sourceTargetIntent: {
        target_source: "live_environment",
        target_kind: "live_environment",
      },
      trustedEnvironmentContext: context,
    });
    expect(admission.compound_requested_capabilities).toEqual([
      HELIX_MINECRAFT_COMMAND_CAPABILITY,
    ]);
    expect(admission.exclusive_tool_capabilities).toEqual([
      HELIX_MINECRAFT_COMMAND_CAPABILITY,
    ]);
    expect(admission.requested_tool_cardinality).toBe(1);
  });

  it.each([
    (prompt: string) => `Do not ${prompt}`,
    (prompt: string) => `Later, ${prompt}`,
    (prompt: string) => `The transcript says "${prompt}"`,
    (prompt: string) =>
      `Explain this instruction without executing it: ${prompt}`,
  ])(
    "does not manufacture exclusivity from contextual command text",
    (wrap) => {
      const executable =
        'Ignite the hearth. Run exactly one command: use com.casimirbot.minecraft.command with command "setblock 1 2 3 minecraft:fire", category "world_build", and effect "world_mutation". Do not run any other command or tool.';
      expect(
        isExclusiveExplicitMinecraftCommandToolRequest(wrap(executable)),
      ).toBe(false);
    },
  );

  it.each([
    "In my paired Minecraft Fabric world, do not run /helixgame checkpoint status.",
    'The room transcript says "run /helixgame checkpoint status in the paired Minecraft Fabric world."',
    "Later, run /helixgame checkpoint status in my paired Minecraft Fabric world.",
  ])(
    "does not admit a paired-world command from negated, quoted, or deferred wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt, {
          trusted_environment_domain: "minecraft",
        }).map((entry) => entry.capability),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it.each([
    'The screen says "/gamerule doDaylightCycle false".',
    'Later run "/gamerule doDaylightCycle false".',
    'Explain "/gamerule doDaylightCycle false" without executing it.',
    "`/gamerule doDaylightCycle false`",
  ])(
    "does not treat referenced slash-command text as bare execution: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it("routes a natural Minecraft world-save request to the command capability without treating it as host filesystem access", () => {
    const prompt =
      'Save the connected Minecraft Fabric server world to disk now using the exact administrator command "/save-all flush". Report only the fresh observed server result.';
    expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-save-all",
        threadId: "helix-ask:room:shared_realtime_room:save-all",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
  });

  it.each([
    "In the active connected Minecraft Fabric world, play one bright amethyst-block chime at my bound player's current position so I can hear it, then report only the fresh observed result.",
    "Now finish the encounter in the connected Minecraft Fabric world by playing one bright amethyst-block chime at my bound player's current position so I can hear it.",
  ])(
    "routes a natural Minecraft sound action ahead of generic current-position evidence: %s",
    (prompt) => {
      expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
        expect.objectContaining({
          capability: HELIX_MINECRAFT_COMMAND_CAPABILITY,
          source: "natural_capability_intent",
        }),
      );
      expect(
        arbitrateAskSourceTarget({
          turnId: "ask:test:minecraft-natural-sound",
          threadId: "helix-ask:room:shared_realtime_room:natural-sound",
          promptText: prompt,
        }),
      ).toMatchObject({
        target_source: "live_environment",
        target_kind: "live_environment",
        precedence_reason:
          "explicit_minecraft_environment_capability_source_target",
      });
    },
  );

  it.each([
    'The screen says "In the active connected Minecraft Fabric world, play one bright chime."',
    "Later, in the active connected Minecraft Fabric world, play one bright chime.",
    "If I ask again, in the connected Minecraft Fabric world play one bright chime.",
    "Explain how playing a chime in the connected Minecraft Fabric world would work without executing it.",
  ])(
    "does not execute contextual or deferred natural Minecraft sound wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it.each([
    'Later, save the connected Minecraft Fabric server world using the command "/save-all flush".',
    'The screen says "Save the connected Minecraft Fabric server world using /save-all flush."',
    "Explain how to save the connected Minecraft Fabric server world with /save-all flush, but do not execute it.",
    "Can the Fabric connector save the Minecraft server world using /save-all flush?",
    'Save the text of the Minecraft command "/save-all flush" to a file on disk.',
  ])("does not execute contextual or host-file save wording: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.capability,
      ),
    ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
  });

  it.each([
    "Explain what the Fabric server command `time set night` would do; do not execute it.",
    'The screen says "Using the live Fabric server command dispatcher, run whitelist list."',
    "Later I may ask you to use the live Fabric server command dispatcher to list the whitelist.",
    "If I enable full mode, use the live Fabric server command dispatcher to list the whitelist.",
    "Historically, we used the live Fabric server command dispatcher to list the whitelist.",
    "Can the Fabric connector use the live Fabric server command dispatcher to list the whitelist?",
  ])(
    "does not execute contextual Fabric command-surface wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    },
  );

  it("keeps an explicit Minecraft command explanation with a non-execution instruction model-only", () => {
    const prompt =
      "Explain what the Minecraft command `time set night` would do, but do not execute it or change the world.";
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-command-discussion",
        threadId: "helix-ask:room:shared_realtime_room:command-discussion",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "model_only",
      target_kind: "general_background",
      strength: "hard",
      allow_no_tool_direct: true,
      precedence_reason:
        "minecraft_command_non_execution_discussion_is_not_execution",
    });
  });

  it("routes an affirmative read-only Minecraft command-catalog request without admitting command execution", () => {
    const prompt =
      'Use only com.casimirbot.minecraft.command.catalog against the paired live Fabric source. Query the current command tree with path_prefix "helixgame checkpoint" and limit 64. Report the fresh catalog entries. Do not execute any command and do not use another tool.';
    const extracted = extractExplicitCapabilityContracts(prompt, {
      trusted_environment_domain: "minecraft",
    });

    expect(extracted.map((entry) => entry.capability)).toEqual([
      HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
    ]);
    expect(extracted[0]?.source).toBe("natural_capability_intent");
    expect(
      buildHelixCompoundCapabilityContract({
        turnId: "ask:test:minecraft-command-catalog-only",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      })?.subgoals,
    ).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY,
        args_hint: {
          path_prefix: "helixgame checkpoint",
          limit: 64,
        },
      }),
    ]);
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-command-catalog-only",
        threadId: "helix-ask:room:shared_realtime_room:catalog-only",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      explicit_cues: [
        `explicit_capability:${HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY}`,
      ],
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
  });

  it.each([
    "Explain how the Minecraft command catalog works without querying it.",
    'The room transcript says "query the current Minecraft command catalog."',
    "Later, query the current Minecraft command catalog.",
    "If I pair a server, query its Minecraft command catalog.",
  ])(
    "does not admit a contextual Minecraft command-catalog request: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt, {
          trusted_environment_domain: "minecraft",
        }).map((entry) => entry.capability),
      ).not.toContain(HELIX_MINECRAFT_COMMAND_CATALOG_CAPABILITY);
    },
  );

  it("bounds an explicitly requested Minecraft command-catalog limit", () => {
    const prompt =
      'Query the paired Minecraft command catalog with path_prefix "helixgame" and limit 999. Do not execute a command.';
    expect(
      buildHelixCompoundCapabilityContract({
        turnId: "ask:test:minecraft-command-catalog-bounded-limit",
        promptText: prompt,
        trustedEnvironmentContext: {
          trusted_environment_domain: "minecraft",
        },
      })?.subgoals[0]?.args_hint,
    ).toEqual({
      path_prefix: "helixgame",
      limit: 64,
    });
  });

  it.each([
    "What is my Minecraft status right now?",
    "Can you check my Minecraft health now?",
    "Using my paired Minecraft Fabric environment, check my current player health and exact position now. If my selected player is offline, fail accurately instead of using stale evidence.",
    "Given the inventory you just observed, check my current Minecraft status again now. Clearly separate what is freshly observed from your advice.",
    "Recheck my current Minecraft status now for me. Require a new current-turn actor observation from the room-bound Fabric source.",
  ])(
    "treats first-person current Minecraft state as a live actor probe: %s",
    (prompt) => {
      expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
        expect.objectContaining({
          capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
          source: "natural_capability_intent",
        }),
      );
    },
  );

  it("keeps live player status authoritative when the prompt mentions stale evidence", () => {
    const prompt =
      "Using my paired Minecraft Fabric environment, check my current player health and exact position now. Do not mutate anything. If my selected player is offline, fail accurately and actionably instead of using stale evidence.";
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-offline-current-state",
        threadId: "helix-ask:room:shared_realtime_room:offline-current-state",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
      allow_no_tool_direct: false,
    });
  });

  it.each([
    "What is Minecraft's service status right now?",
    "Search the web for the current Minecraft server status.",
    "Do not check my Minecraft status right now.",
    "Later I may ask what my Minecraft status is.",
    'The screen says "What is my Minecraft status right now?"',
    "Historically, I asked what my Minecraft status was.",
    "If I join the world, check my Minecraft status.",
    "Can the Minecraft connector check my Minecraft status?",
    "Do not check my current Minecraft status again now.",
    "Later I may ask you to check my current Minecraft status again.",
    'The transcript says "check my current Minecraft status again now."',
    "Historically, we checked my current Minecraft status again.",
    "If I rejoin, check my current Minecraft status again.",
    "Do not recheck my current Minecraft status now.",
    "Later I may ask you to recheck my current Minecraft status.",
    'The transcript says "recheck my current Minecraft status now."',
    "Historically, we rechecked my current Minecraft status.",
    "If I rejoin, recheck my current Minecraft status.",
    "Can the Minecraft connector recheck my current Minecraft status?",
  ])(
    "does not execute contextual or non-player Minecraft status wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY);
    },
  );

  it("recognizes closed-container knowledge as an exact unsupported frontier without advertising it as an implemented situation probe", () => {
    const prompt =
      "In this Minecraft room, inspect the contents of the nearest closed chest without opening it and tell me exactly what is inside.";
    const contracts = extractExplicitCapabilityContracts(prompt);

    expect(contracts).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
    expect(HELIX_MINECRAFT_SITUATION_CAPABILITY_IDS).not.toContain(
      HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
    );
    expect(
      buildHelixCompoundCapabilityContract({
        turnId: "ask:test:minecraft-closed-container-frontier",
        promptText: prompt,
      })?.subgoals,
    ).toEqual([
      expect.objectContaining({
        requested_capability:
          HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
        runtime_capability: HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
        required_args: [],
      }),
    ]);
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:test:minecraft-closed-container-frontier",
      threadId: "helix-ask:room:shared_realtime_room:closed-container",
      promptText: prompt,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:test:minecraft-closed-container-frontier",
      sourceTargetIntent,
      promptText: prompt,
    });
    expect(admission).toMatchObject({
      source_target: "live_environment",
      requested_capability: HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY,
      admitted_tool_families: ["live_environment"],
    });
    expect(
      buildCommittedAskRoute({
        turnId: "ask:test:minecraft-closed-container-frontier",
        promptText: prompt,
        selectedRoute: "/ask",
        payload: {
          source_target_intent: sourceTargetIntent,
          tool_call_admission_decision: admission,
        },
      }),
    ).toMatchObject({
      route: {
        source_target: "live_environment",
        strength: "hard",
        route_reason: "explicit_capability_contract",
      },
      canonical_goal: {
        goal_kind: "live_environment",
        required_terminal_kind: "model_synthesized_answer",
      },
      compatibility: {
        source_goal_capability_terminal_compatible: true,
        violations: [],
      },
    });
  });

  it.each([
    "In Minecraft, do not inspect the contents of the nearest closed chest.",
    "Later I may ask you to inspect the contents of a closed chest in Minecraft.",
    'The Minecraft screen says "inspect the contents of the closed chest."',
    "Historically, we inspected the contents of closed chests in Minecraft.",
    "If the player returns, inspect the closed chest contents in Minecraft.",
    "Can the Minecraft connector inspect closed chest contents?",
  ])(
    "does not execute contextual closed-container frontier wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_CONTAINER_CONTENTS_READ_CAPABILITY);
    },
  );

  it("admits an immediate corrective game-situation turn without requiring Minecraft to be repeated", () => {
    const prompt =
      "Actually, recheck just the nearby hostile mobs and immediate hazards now; do not rely on the earlier observation.";
    const contracts = extractExplicitCapabilityContracts(prompt);
    expect(contracts.map((entry) => entry.capability)).toEqual(
      expect.arrayContaining([
        HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
        HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
      ]),
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:minecraft-corrective",
        threadId: "helix-ask:room:shared_realtime_room:corrective",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });
  });

  it.each([
    "Do not recheck the nearby hostile mobs and immediate hazards now.",
    "Later I may ask you to recheck the nearby hostile mobs and immediate hazards.",
    'The screen says "recheck the nearby hostile mobs and immediate hazards now."',
    "Historically, we would recheck the nearby hostile mobs and immediate hazards.",
    "If the route changes, recheck the nearby hostile mobs and immediate hazards.",
    "Can the connector recheck the nearby hostile mobs and immediate hazards now?",
  ])(
    "does not execute contextual game-situation continuation wording: %s",
    (prompt) => {
      expect(extractExplicitCapabilityContracts(prompt)).toEqual([]);
      expect(
        arbitrateAskSourceTarget({
          turnId: `ask:test:minecraft-corrective:${prompt.length}`,
          threadId: "helix-ask:room:shared_realtime_room:corrective",
          promptText: prompt,
        }).target_source,
      ).not.toBe("world_event");
    },
  );

  it("keeps the Minecraft room context for a natural status, armor, and inventory request", () => {
    const capabilities = extractExplicitCapabilityContracts(
      "In this Minecraft room, check my current health, hunger or effects, armor, and inventory now. Am I equipped to explore for a few minutes?",
    ).map((entry) => entry.capability);

    expect(capabilities).toEqual(
      expect.arrayContaining([
        HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        CAPABILITY,
      ]),
    );
  });

  it("routes a fresh selected-player yaw and pitch read to actor status without inventing a command", () => {
    const prompt =
      "Using only fresh evidence collected during this turn, inspect my selected Minecraft player and tell me the exact current yaw and pitch. Make no changes to the player or world, and do not reuse any earlier observation.";
    const context = { trusted_environment_domain: "minecraft" as const };
    const capabilities = extractExplicitCapabilityContracts(
      prompt,
      context,
    ).map((entry) => entry.capability);

    expect(capabilities).toContain(
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    );
    expect(capabilities).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    expect(capabilities).not.toContain("docs-viewer.search_docs");

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:test:minecraft-yaw-pitch-read",
      threadId: "helix-ask:room:shared_realtime_room:yaw-pitch",
      promptText: prompt,
      trustedEnvironmentContext: context,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      allow_no_tool_direct: false,
      precedence_reason:
        "explicit_minecraft_environment_capability_source_target",
    });

    expect(
      buildToolCallAdmissionDecision({
        turnId: "ask:test:minecraft-yaw-pitch-read",
        sourceTargetIntent,
        promptText: prompt,
        trustedEnvironmentContext: context,
      }),
    ).toMatchObject({
      source_target: "live_environment",
      requested_capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
      selected_capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
      admitted_tool_families: ["live_environment"],
    });
  });

  it("materializes trusted semantic targets for compound Minecraft probes", () => {
    const actorContract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:minecraft-targets",
      promptText:
        "In this Minecraft room, check my current health and inventory now.",
    });
    expect(actorContract?.subgoals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requested_capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
          required_args: ["target"],
          args_hint: { target: "current_actor" },
        }),
        expect.objectContaining({
          requested_capability: CAPABILITY,
          required_args: ["target"],
          args_hint: { target: "current_actor" },
        }),
      ]),
    );

    const positionContract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:minecraft-position-targets",
      promptText:
        "In this Minecraft room, check both line of sight and straight-line geometric reachability to x=100 y=80 z=103 now.",
    });
    expect(positionContract?.subgoals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requested_capability: HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
          required_args: ["target", "position"],
          args_hint: {
            target: "position",
            position: { x: 100, y: 80, z: 103 },
          },
        }),
        expect.objectContaining({
          requested_capability: HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
          required_args: ["target", "position"],
          args_hint: {
            target: "position",
            position: { x: 100, y: 80, z: 103 },
          },
        }),
      ]),
    );

    const cropContract = buildHelixCompoundCapabilityContract({
      turnId: "ask:test:minecraft-crop-target",
      promptText:
        "In this Minecraft room, check whether the wheat at x=100 y=80 z=103 is mature now.",
    });
    expect(cropContract?.subgoals).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
        required_args: ["target"],
        args_hint: {
          target: "position",
          position: { x: 100, y: 80, z: 103 },
        },
      }),
    ]);
  });

  it("routes an affirmative Crimson Curse state question through the current actor observation", () => {
    expect(
      extractExplicitCapabilityContracts(
        "In Minecraft, check the current Crimson Curse infection phase, mass, and points now.",
      ),
    ).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
  });

  it("routes an immediate Minecraft where-am-I question through the current actor observation", () => {
    const prompt =
      "Where am I in Minecraft right now? Report my player name, dimension, position, health, and food from the live environment.";
    expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        source: "natural_capability_intent",
        contract: expect.objectContaining({
          source_target: "live_environment",
          capability_family: "live_environment",
        }),
      }),
    );
  });

  it("keeps selected-player live-tool wording on the Minecraft environment source", () => {
    const prompt =
      "Check my selected Minecraft player's current status and exact position using the live environment tool. Report only fresh observed state.";
    expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
      expect.objectContaining({
        capability: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        source: "natural_capability_intent",
      }),
    );
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:selected-minecraft-player-status",
        threadId: "thread:test",
        promptText: prompt,
      }).target_source,
    ).toBe("live_environment");
  });

  it.each([
    "Do not tell me where I am in Minecraft right now.",
    "Later I might ask where I am in Minecraft.",
    'The screen says "Where am I in Minecraft right now?"',
    "Why did the previous turn answer where I am in Minecraft?",
    "Can the Minecraft connector tell me where I am?",
  ])(
    "does not execute contextual Minecraft where-am-I wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY);
    },
  );

  it.each([
    "In Minecraft, do not check the Crimson Curse infection phase.",
    "In Minecraft, later I may ask you to check the Crimson Curse infection phase.",
    'The Minecraft guide says "check the Crimson Curse infection phase now."',
    "Can the Minecraft connector check the Crimson Curse infection phase?",
  ])(
    "does not execute contextual Crimson Curse state wording: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY);
    },
  );

  it.each([
    "In Minecraft, check my health but do not check my inventory.",
    "In Minecraft, later I may ask you to check my health and inventory.",
    'The Minecraft guide says "check my health and inventory now."',
    "Can the Minecraft connector check my health and inventory?",
  ])(
    "does not admit contextual or non-affirmative inventory wording from a broader Minecraft clause: %s",
    (prompt) => {
      expect(
        extractExplicitCapabilityContracts(prompt).map(
          (entry) => entry.capability,
        ),
      ).not.toContain(CAPABILITY);
    },
  );

  it.each([
    "Check my current Minecraft inventory now using the connected environment.",
    "What is the player carrying in Minecraft right now? Inspect the connected world before answering.",
  ])(
    "admits an affirmative natural inventory request without inventing internet search: %s",
    (prompt) => {
      expect(extractExplicitCapabilityContracts(prompt)).toContainEqual(
        expect.objectContaining({
          capability: CAPABILITY,
          source: "natural_capability_intent",
          contract: expect.objectContaining({
            source_target: "live_environment",
            capability_family: "live_environment",
          }),
        }),
      );
    },
  );

  it("does not replace an exact processed-mail semantic wake with an inventory probe", () => {
    const prompt =
      "Read processed Minecraft live-source mail packet stage_play_live_source_mail:mail-1, record an evidence-grounded checkpoint for that exact packet, inspect the resulting mail-loop state, and revise the next semantic plan from the verified inventory change.";

    expect(
      extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.capability,
      ),
    ).not.toContain(CAPABILITY);
  });

  it("still admits an explicit inventory probe when it is a separate requested operation", () => {
    const prompt =
      "Read processed Minecraft live-source mail packet stage_play_live_source_mail:mail-1 and record its checkpoint. Then separately check my current Minecraft inventory now.";

    expect(
      extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.capability,
      ),
    ).toContain(CAPABILITY);
  });

  it("keeps exact connector source arbitration and tool admission on live_environment", () => {
    const turnId = "ask:test:minecraft-environment-connector-admission";
    const prompt =
      "Check my current Minecraft inventory now using the connected environment.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId: "thread:test",
      promptText: prompt,
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      promptText: prompt,
    });

    expect(admission).toMatchObject({
      original_source_target: "live_environment",
      effective_source_target: "live_environment",
      source_target: "live_environment",
      requested_capability: CAPABILITY,
      requested_capability_family: "live_environment",
      admitted_tool_families: ["live_environment"],
      mandatory_capability_admitted: true,
    });
    expect(admission.admitted_tool_families).not.toContain("world_event");
  });

  it("narrows an exact Minecraft contract to live-environment tool admission", () => {
    const turnId = "ask:test:minecraft-exact-committed-route";
    const prompt =
      "What is the player carrying in Minecraft right now? Inspect the connected world before answering.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId: "thread:test",
      promptText: prompt,
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      promptText: prompt,
    });
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "/ask",
      payload: {
        source_target_intent: {
          ...sourceTargetIntent,
          // A stale/soft upstream projection must not weaken the exact
          // capability contract that commits this route as hard.
          strength: "soft",
        },
        tool_call_admission_decision: admission,
      },
    });

    expect(committedRoute.route).toMatchObject({
      source_target: "live_environment",
      strength: "hard",
      route_reason: "explicit_capability_contract",
    });
    expect(committedRoute.capability_policy.allowed_tool_families).toEqual([
      "live_environment",
    ]);
    expect(
      assertCapabilityAllowedByCommittedRoute({
        committedRoute,
        capabilityId: CAPABILITY,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      assertCapabilityAllowedByCommittedRoute({
        committedRoute,
        capabilityId: "internet-search.search_web",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "selected_capability_not_allowed_by_committed_route",
    });
  });

  it("commits a prior Minecraft observation follow-up as live-environment evidence synthesis", () => {
    const turnId = "ask:test:minecraft-prior-evidence";
    const prompt =
      "Given the current Minecraft observations you just gathered, what should I fix first?";
    const sourceTargetIntent = {
      schema: "helix.ask.source_target_intent.v1",
      turn_id: turnId,
      thread_id: "helix-ask:room:shared_realtime_room:prior-evidence",
      target_source: "world_event",
      target_kind: "world_event",
      strength: "hard",
      precedence_reason: "explicit_current_world_followup",
    };
    const routeProductContract = buildRouteProductContract({
      turnId,
      threadId: sourceTargetIntent.thread_id,
      sourceTargetIntent,
      promptText: prompt,
    });
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "/ask",
      payload: {
        source_target_intent: sourceTargetIntent,
        route_product_contract: routeProductContract,
        canonical_goal_frame: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
        },
        conversation_memory_packet: {
          schema: "helix.conversation_memory_packet.v1",
          current_turn_id: turnId,
          allowed_for_current_goal: true,
          allowed_use: "reuse_prior_evidence_refs",
          reusable_evidence_refs: ["ask:turn-1:environment:reachability"],
        },
      },
    });

    expect(routeProductContract.allowed_terminal_artifact_kinds).toContain(
      "model_synthesized_answer",
    );
    expect(committedRoute).toMatchObject({
      route: {
        source_target: "world_event",
        strength: "hard",
      },
      canonical_goal: {
        goal_kind: "environment_evidence_synthesis",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_policy: {
        allowed_tool_families: ["live_environment"],
        required_capability_families: ["live_environment"],
      },
      terminal_product: {
        evidence_reentry_required: true,
        followup_reasoning_required: true,
        required_terminal_product: "model_synthesized_answer",
      },
      compatibility: {
        source_goal_capability_terminal_compatible: true,
        violations: [],
      },
    });
  });

  it("repairs a hard Minecraft world route when generic read wording left a stale document goal", () => {
    const turnId = "ask:test:minecraft-world-read-directly";
    const prompt =
      "What is the current daytime value in our Minecraft world? Please read it directly from the live Fabric server before you answer.";
    const sourceTargetIntent = {
      schema: "helix.ask_source_target_intent.v1",
      turn_id: turnId,
      thread_id: "helix-ask:room:shared_realtime_room:world-read",
      target_source: "world_event",
      target_kind: "world_event",
      strength: "hard",
      precedence_reason: "explicit_world_event_source_target",
    };
    const staleDocumentRoute = {
      schema: "helix.committed_ask_route.v1",
      turn_id: turnId,
      commit_id: "committed-route:stale-document-goal",
      prompt_hash: "stale",
      committed_at_stage: "post_prompt_source_arbitration",
      prompt_intent: {
        primary_intent_kind: "doc_open_best",
        secondary_intent_kinds: [],
      },
      route: {
        selected_route: "/ask/turn/stream",
        source_target: "world_event",
        target_kind: "world_event",
        strength: "hard",
        source_identity: "docs/example.md",
        route_reason: "explicit_world_event_source_target",
        stale_metadata_policy: "ignore_unless_matches_commit",
      },
      canonical_goal: {
        goal_kind: "doc_open_best",
        required_terminal_kind: "doc_open_receipt",
        allowed_terminal_artifact_kinds: ["doc_open_receipt"],
        forbidden_terminal_artifact_kinds: [],
      },
      capability_policy: {
        allowed_tool_families: ["live_environment"],
        suppressed_tool_families: [],
        required_capability_families: ["live_environment"],
        mutating_families_allowed: true,
      },
      suppression: {
        contextual_tool_mentions: [],
        negative_constraints: [],
        suppressed_families: [],
        firewall_required: true,
      },
      terminal_product: {
        terminal_authority_required: true,
        evidence_reentry_required: true,
        followup_reasoning_required: true,
        required_terminal_product: "doc_open_receipt",
      },
      transitions: [],
      compatibility: {
        source_goal_capability_terminal_compatible: true,
        stale_metadata_ignored: false,
        shortcut_firewall_applied: false,
        violations: [],
      },
      assistant_answer: false,
      raw_content_included: false,
    };

    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "/ask/turn/stream",
      payload: {
        source_target_intent: sourceTargetIntent,
        committed_ask_route: staleDocumentRoute,
        canonical_goal_frame: {
          goal_kind: "doc_open_best",
          required_terminal_kind: "doc_open_receipt",
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          source_target: "world_event",
          required_terminal_kind: "doc_open_receipt",
          allowed_terminal_artifact_kinds: ["doc_open_receipt"],
        },
        active_doc_identity: { active_doc_path: "docs/example.md" },
        tool_call_admission_decision: {
          admitted_tool_families: ["live_environment"],
        },
      },
    });

    expect(committedRoute).toMatchObject({
      route: {
        source_target: "world_event",
        target_kind: "world_event",
        strength: "hard",
        source_identity: null,
      },
      canonical_goal: {
        goal_kind: "environment_evidence_synthesis",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: expect.arrayContaining([
          "model_synthesized_answer",
          "agent_provider_terminal_candidate",
          "typed_failure",
        ]),
      },
      terminal_product: {
        evidence_reentry_required: true,
        followup_reasoning_required: true,
        required_terminal_product: "model_synthesized_answer",
      },
      compatibility: {
        source_goal_capability_terminal_compatible: true,
        violations: [],
      },
    });
    expect(committedRoute.commit_id).not.toBe(staleDocumentRoute.commit_id);
  });

  it.each([
    "Do not check my Minecraft inventory.",
    "Later, I may ask you to check my Minecraft inventory.",
    'The docs say "check my Minecraft inventory" as an example.',
    "Why did the previous turn say it checked my Minecraft inventory?",
    "Can the connector check my Minecraft inventory?",
    "Do not check what the player is carrying in Minecraft.",
    "Later I may ask what the player is carrying in Minecraft.",
    'The docs say "what is the player carrying in Minecraft?" as an example.',
    "Why did the previous turn say what the player was carrying in Minecraft?",
  ])("does not admit contextual or non-executable wording: %s", (prompt) => {
    expect(
      extractExplicitCapabilityContracts(prompt).some(
        (entry) => entry.capability === CAPABILITY,
      ),
    ).toBe(false);
  });

  it.each([
    [
      "Do not check my current health in Minecraft.",
      HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
    ],
    [
      "Later, I may ask you to list the mobs nearby in Minecraft.",
      HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
    ],
    [
      'The docs use "In Minecraft, am I in danger from hostile mobs nearby?" as an example.',
      HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
    ],
    [
      "Why did the previous turn inspect the local terrain around me in Minecraft?",
      HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
    ],
    [
      "Can the connector check line of sight in Minecraft?",
      HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
    ],
    [
      "Do not check whether the Minecraft wheat crop is mature.",
      HELIX_MINECRAFT_CROP_STATE_READ_CAPABILITY,
    ],
    [
      "If we later ask, check whether I can reach that position in Minecraft.",
      HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
    ],
    [
      'The screen shows "check line of sight in Minecraft" as suggested text.',
      HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
    ],
  ])("rejects contextual Minecraft probe wording: %s", (prompt, capability) => {
    expect(
      extractExplicitCapabilityContracts(prompt).some(
        (entry) => entry.capability === capability,
      ),
    ).toBe(false);
  });

  it("admits the affirmative half of a mixed geometry request without admitting its negated half", () => {
    const capabilities = extractExplicitCapabilityContracts(
      "In Minecraft, check line of sight to x=100 y=80 z=103, but do not check reachability.",
    ).map((entry) => entry.capability);

    expect(capabilities).toContain(
      HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
    );
    expect(capabilities).not.toContain(
      HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
    );
  });

  it("keeps a live read-only environment check off the negated server-command and docs lanes", () => {
    const prompt =
      "Using the active Minecraft Fabric environment connected to this room, make one fresh read-only check and tell me whether any player is currently online, along with the active source and world status. Do not move anything, use server commands, or change the world.";
    const capabilities = extractExplicitCapabilityContracts(prompt, {
      trusted_environment_domain: "minecraft",
    }).map((entry) => entry.capability);
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "turn:negated-server-command-live-check",
      threadId: "thread:negated-server-command-live-check",
      promptText: prompt,
      trustedEnvironmentContext: {
        trusted_environment_domain: "minecraft",
      },
    });

    expect(capabilities).not.toContain(HELIX_MINECRAFT_COMMAND_CAPABILITY);
    expect(capabilities).not.toContain("docs-viewer.search_docs");
    expect(sourceTarget).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
    });
  });
});
