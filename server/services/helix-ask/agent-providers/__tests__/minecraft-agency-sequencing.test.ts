import { describe, expect, it } from "vitest";
import {
  affirmativeMinecraftPlayerControlCapabilityIds,
  buildMinecraftAgencyCompoundCoverageResolutions,
  buildMinecraftPostMutationVerificationRequest,
  evaluateMinecraftAgencySequence,
  isAffirmativeMinecraftPlayerEmbodimentActionPrompt,
  minecraftPlayerEmbodimentActionPromptMatch,
  requiredMinecraftPlayerCombatCapabilityIds,
  requiredMinecraftResidentRecoveryCapabilityIds,
  resolveMinecraftExecutionPlaneConstraint,
  requiresCurrentTurnCheckpointBeforeMinecraftMutation,
} from "../minecraft-agency-sequencing";
import { HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY } from "@shared/helix-environment-connector";

const command = (value: string, effect: string) => ({
  capability: "com.casimirbot.minecraft.command",
  arguments: { command: value, effect },
});

const result = (ok: boolean) =>
  ({
    ok,
    capability_id: "com.casimirbot.minecraft.command",
    gateway_admission: {
      requested_capability: "com.casimirbot.minecraft.command",
    },
  }) as any;

const observedResult = (
  capability: string,
  callId: string,
  ok = true,
  observation?: Record<string, unknown>,
) =>
  ({
    ok,
    capability_id: capability,
    artifact_refs: [`artifact:${callId}`],
    gateway_admission: { requested_capability: capability },
    observation_packet: {
      call_id: callId,
      observation_ref: `observation:${callId}`,
      produced_artifact_refs: [`artifact:${callId}`],
    },
    observation,
  }) as any;

describe("Minecraft agency sequencing", () => {
  it("detects a semantic player-plane action without choosing the action capability", () => {
    const prompt =
      "Using only my paired Minecraft Player Embodiment client, rotate my view about 20 degrees to the right without moving or using server commands.";
    expect(isAffirmativeMinecraftPlayerEmbodimentActionPrompt(prompt)).toBe(
      true,
    );
    expect(minecraftPlayerEmbodimentActionPromptMatch(prompt)).toMatchObject({
      matched_text: "rotate",
    });
  });

  it("keeps an explicit paired-client request on the Player Embodiment plane", () => {
    const prompt =
      "Using the paired Minecraft player client, take one careful step forward, jump once, stop, and verify my final position.";
    expect(resolveMinecraftExecutionPlaneConstraint(prompt)).toBe(
      "player_embodiment",
    );
    expect(isAffirmativeMinecraftPlayerEmbodimentActionPrompt(prompt)).toBe(
      true,
    );
    const decision = evaluateMinecraftAgencySequence({
      prompt,
      candidate: command("tp DatDamPig -47.8 68.2 -1.3", "player_mutation"),
      priorRequests: [],
      gatewayCallResults: [],
    });
    expect(decision).toMatchObject({
      admitted: false,
      recovery_lane_request: null,
    });
    expect(decision.reason).toContain("minecraft_execution_plane_mismatch");
    expect(decision.reason).toContain("Player Embodiment");
  });

  it("does not promote a negated server-command contrast into a hybrid plane", () => {
    const prompt =
      "Emergency stop the active paired Player Embodiment workflow now. Use the bounded player emergency-stop control, not a server command, and release every connector-owned control.";

    expect(resolveMinecraftExecutionPlaneConstraint(prompt)).toBe(
      "player_embodiment",
    );
    expect(affirmativeMinecraftPlayerControlCapabilityIds(prompt)).toEqual([
      "com.casimirbot.minecraft.player.emergency_stop",
    ]);
  });

  it("does not expose player controls from non-operative mentions", () => {
    const prompts = [
      "Do not emergency stop my Minecraft player.",
      'The documentation says "Emergency stop the player now."',
      "Yesterday I emergency stopped the player.",
      "If I ask later, emergency stop the player.",
      "Explain how emergency stop works.",
      "The UI says emergency stop is ready.",
    ];
    for (const prompt of prompts) {
      expect(affirmativeMinecraftPlayerControlCapabilityIds(prompt)).toEqual(
        [],
      );
    }
  });

  it("treats an operative bounded guardian program as the Player Embodiment plane", () => {
    const prompt =
      "Step off this Minecraft test platform and save me from fall damage by reacting to my measured trajectory and placing exactly one water source with the water bucket I am carrying. Use one bounded survival_tas guardian program, do not use commands or teleportation, stop if my health drops below eight, and release every control afterward.";

    expect(resolveMinecraftExecutionPlaneConstraint(prompt)).toBe(
      "player_embodiment",
    );
    expect(minecraftPlayerEmbodimentActionPromptMatch(prompt)).toMatchObject({
      matched_text: "Step",
    });
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: command(
          "execute as @s at @s run setblock ~ ~ ~ minecraft:water",
          "world_mutation",
        ),
        priorRequests: [],
        gatewayCallResults: [],
      }),
    ).toMatchObject({
      admitted: false,
      recovery_lane_request: null,
    });
  });

  it("keeps a natural resident-protection request on the authorized Player Embodiment plane", () => {
    const prompt =
      "I'm about to cross dangerous terrain. Keep my Minecraft player viable while you plan: swim upward if I become submerged, and release controls and reconsider if fire, lava, an unsafe fall, or blocked movement appears. Set that protection up now for five minutes.";
    const context = {
      trusted_environment_domain: "minecraft" as const,
      authorized_player_action_capability_ids: [
        "com.casimirbot.minecraft.player.viability_guardian.arm",
      ],
    };

    expect(
      minecraftPlayerEmbodimentActionPromptMatch(prompt, context),
    ).toMatchObject({ matched_text: "Keep" });
    expect(
      isAffirmativeMinecraftPlayerEmbodimentActionPrompt(prompt, context),
    ).toBe(true);
  });

  it("requires reactive-program evidence for an affirmative physical hazard recovery", () => {
    const context = {
      trusted_environment_domain: "minecraft" as const,
      authorized_player_action_capability_ids: [
        "com.casimirbot.minecraft.player.guardian.execute",
      ],
    };
    const prompt =
      "Protect my paired Minecraft player locally for 30 seconds. If I enter lava, immediately jump and sprint into the prepared water, verify the fire is out, and release controls.";

    expect(
      requiredMinecraftResidentRecoveryCapabilityIds(prompt, context),
    ).toEqual(["com.casimirbot.minecraft.player.guardian.execute"]);
  });

  it("requires exact combat evidence for an affirmative tracked-zombie attack", () => {
    const prompt =
      "Use DatDamPig Player Embodiment to track the exact hostile zombie, then use cooldown-aware combat attack actions against only that zombie until it is defeated. Do not attack a friendly or neutral entity.";

    expect(requiredMinecraftPlayerCombatCapabilityIds(prompt)).toEqual([
      "com.casimirbot.minecraft.player.combat.attack",
    ]);
  });

  it("requires resident combat-guard evidence for an affirmative multi-zombie fight", () => {
    const prompt =
      "Use DatDamPig Player Embodiment to fight three hostile zombies at once and keep attacking until they are defeated.";
    expect(requiredMinecraftPlayerCombatCapabilityIds(prompt)).toEqual([
      "com.casimirbot.minecraft.player.combat.guard",
    ]);
  });

  it.each([
    "Do not attack the zombie with Player Embodiment; only observe it.",
    'The screen says "Attack the zombie with Player Embodiment"; explain that text.',
    "Yesterday Player Embodiment attacked the zombie; summarize what happened.",
    "If I ask later, use Player Embodiment to attack the zombie.",
    "Explain how Player Embodiment could attack a zombie without acting.",
  ])("does not require combat execution for contextual wording: %s", (prompt) => {
    expect(requiredMinecraftPlayerCombatCapabilityIds(prompt)).toEqual([]);
  });

  it.each([
    "Do not protect me from lava by jumping.",
    'The documentation says "Protect me from lava by jumping."',
    "Yesterday you protected me from lava by jumping.",
    "If I ask later, protect me from lava by jumping.",
    "Explain how a guardian could protect me from lava by jumping.",
    "The UI says protect me from lava by jumping.",
  ])("does not require recovery execution for contextual wording: %s", (prompt) => {
    expect(
      requiredMinecraftResidentRecoveryCapabilityIds(prompt, {
        trusted_environment_domain: "minecraft",
        authorized_player_action_capability_ids: [
          "com.casimirbot.minecraft.player.guardian.execute",
        ],
      }),
    ).toEqual([]);
  });

  it("carries a natural imperative gameplay request onto an authenticated player plane", () => {
    const context = {
      trusted_environment_domain: "minecraft" as const,
      authorized_player_action_capability_ids: [
        "com.casimirbot.minecraft.player.guardian.execute",
      ],
    };
    const prompt =
      "Step off this ledge, save me from the fall with my water bucket, verify I landed safely, pick the water back up, and release control.";

    expect(
      minecraftPlayerEmbodimentActionPromptMatch(prompt, context),
    ).toMatchObject({ matched_text: "Step" });
    expect(
      isAffirmativeMinecraftPlayerEmbodimentActionPrompt(prompt, context),
    ).toBe(true);
  });

  it.each([
    "Do not step off this ledge.",
    'The screen says "Step off this ledge"; explain that text.',
    "Earlier I stepped off this ledge; summarize what happened.",
    "If I ask later, step off this ledge.",
    "Explain how to step off this ledge without acting.",
  ])("does not promote contextual imperative gameplay wording: %s", (prompt) => {
    expect(
      minecraftPlayerEmbodimentActionPromptMatch(prompt, {
        trusted_environment_domain: "minecraft",
        authorized_player_action_capability_ids: [
          "com.casimirbot.minecraft.player.guardian.execute",
        ],
      }),
    ).toBeNull();
  });

  it("does not turn contextual guardian-program language into player execution", () => {
    const prompts = [
      'The screen says "Use one bounded survival_tas guardian program"; explain the label.',
      "Do not use the reactive guardian program; just describe it.",
      "Later we could use a bounded guardian program, but do nothing now.",
      "Earlier the survival_tas guardian program moved me; summarize that history.",
    ];

    for (const prompt of prompts) {
      expect(resolveMinecraftExecutionPlaneConstraint(prompt)).toBeNull();
      expect(minecraftPlayerEmbodimentActionPromptMatch(prompt)).toBeNull();
    }
  });

  it.each([
    "Explain how to keep my Minecraft player safe without acting.",
    "Later, keep my Minecraft player safe, but do nothing now.",
    "Previously you protected my Minecraft player; summarize what happened.",
    "Do not arm or protect my Minecraft player right now.",
  ])("does not execute contextual resident-protection wording: %s", (prompt) => {
    expect(
      minecraftPlayerEmbodimentActionPromptMatch(prompt, {
        trusted_environment_domain: "minecraft",
        authorized_player_action_capability_ids: [
          "com.casimirbot.minecraft.player.viability_guardian.arm",
        ],
      }),
    ).toBeNull();
  });

  it("keeps an immediate geometry safety condition on the Player Embodiment plane", () => {
    const prompt =
      "First inspect the local geometry. If a cardinal direction has solid walkable support, safe headroom, and no nearby fire or drop, use the paired Player Embodiment client to walk no more than one block in that direction. Do not issue a server command.";

    expect(resolveMinecraftExecutionPlaneConstraint(prompt)).toBe(
      "player_embodiment",
    );
    expect(minecraftPlayerEmbodimentActionPromptMatch(prompt)).toMatchObject({
      matched_text: "walk",
    });
  });

  it("admits a guarded walk only when its exact relative direction is freshly evidenced safe", () => {
    const prompt =
      "First inspect around me. If a cardinal direction has safe support and headroom, walk one step in that direction. If no safe direction is evidenced, do not move.";
    const inspection = {
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      arguments: {
        target: "current_actor",
        purpose: "movement_safety",
      },
    };
    const walk = (direction: string) => ({
      capability: "com.casimirbot.minecraft.player.walk",
      arguments: {
        action_kind: "walk",
        direction,
        duration_ms: 250,
        sprint: false,
      },
    });
    const compoundCapabilityContract = {
      subgoals: [
        {
          order: 1,
          requested_capability:
            HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          mandatory: true,
        },
        {
          order: 2,
          requested_capability: "com.casimirbot.minecraft.player.walk",
          mandatory: true,
          guarded_noop_policy: {
            schema: "helix.compound_capability_guarded_noop.v1",
            mode: "no_verified_safe_candidate",
            guard_capability:
              HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
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
    };
    const spatialResult = (candidates: Array<Record<string, unknown>>) =>
      observedResult(
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        "movement-safety",
        true,
        {
          result: {
            purpose: "movement_safety",
            walk_step_candidates: candidates,
            walk_step_candidates_complete: true,
            omitted_walk_step_candidate_count: 0,
          },
        },
      );

    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: walk("forward"),
        priorRequests: [inspection],
        gatewayCallResults: [
          spatialResult([
            {
              relative_direction: "forward",
              evidence_complete: true,
              safe_candidate: true,
            },
          ]),
        ],
        compoundCapabilityContract,
      }).admitted,
    ).toBe(true);

    const wrongDirection = evaluateMinecraftAgencySequence({
      prompt,
      candidate: walk("left"),
      priorRequests: [inspection],
      gatewayCallResults: [
        spatialResult([
          {
            relative_direction: "forward",
            evidence_complete: true,
            safe_candidate: true,
          },
        ]),
      ],
      compoundCapabilityContract,
    });
    expect(wrongDirection.admitted).toBe(false);
    expect(wrongDirection.reason).toContain(
      "minecraft_movement_direction_not_evidenced_safe",
    );

    const noCandidate = evaluateMinecraftAgencySequence({
      prompt,
      candidate: walk("forward"),
      priorRequests: [inspection],
      gatewayCallResults: [spatialResult([])],
      compoundCapabilityContract,
    });
    expect(noCandidate.admitted).toBe(false);
    expect(noCandidate.reason).toContain(
      "minecraft_guarded_noop_satisfied",
    );

    const missingEvidence = evaluateMinecraftAgencySequence({
      prompt,
      candidate: walk("forward"),
      priorRequests: [],
      gatewayCallResults: [],
      compoundCapabilityContract,
    });
    expect(missingEvidence).toMatchObject({
      admitted: false,
      recovery_lane_request: {
        capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        arguments: { purpose: "movement_safety" },
      },
    });
  });

  it("admits Codex-selected player actions and neutral evidence under a Player Embodiment constraint", () => {
    const prompt =
      "Use Player Embodiment to walk forward and jump, then verify where I landed.";
    for (const candidate of [
      {
        capability: "com.casimirbot.minecraft.player.walk",
        arguments: { direction: "forward", distance_blocks: 1 },
      },
      {
        capability: "com.casimirbot.minecraft.player.jump",
        arguments: { count: 1 },
      },
      {
        capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        arguments: { target: "current_actor", purpose: "landing_safety" },
      },
      command("data get entity DatDamPig Pos", "read_only"),
    ]) {
      expect(
        evaluateMinecraftAgencySequence({
          prompt,
          candidate,
          priorRequests: [],
          gatewayCallResults: [],
        }).admitted,
      ).toBe(true);
    }
  });

  it("re-enters an explicit Player Embodiment ordering mismatch before a later action runs", () => {
    const actorStatus = {
      capability: "com.casimirbot.minecraft.actor.status.read",
      arguments: { target: "current_actor" },
    };
    const walk = {
      capability: "com.casimirbot.minecraft.player.walk",
      arguments: { direction: "forward", duration_ms: 250, sprint: false },
    };
    const jump = {
      capability: "com.casimirbot.minecraft.player.jump",
      arguments: { count: 1 },
    };
    const compoundCapabilityContract = {
      subgoals: [
        {
          subgoal_id: "ordered:walk",
          order: 1,
          requested_capability: walk.capability,
          mandatory: true,
        },
        {
          subgoal_id: "ordered:jump",
          order: 2,
          requested_capability: jump.capability,
          mandatory: true,
        },
        {
          subgoal_id: "ordered:final-status",
          order: 3,
          requested_capability: actorStatus.capability,
          mandatory: true,
        },
      ],
    };
    const prompt =
      "Using only my paired Minecraft Player Embodiment client, if the controls are idle, walk forward for 250 milliseconds, then jump exactly once, stop, and finally read my position.";

    const blocked = evaluateMinecraftAgencySequence({
      prompt,
      candidate: jump,
      priorRequests: [actorStatus],
      gatewayCallResults: [
        observedResult(actorStatus.capability, "preflight-status"),
      ],
      compoundCapabilityContract,
    });
    expect(blocked).toMatchObject({
      admitted: false,
      recovery_lane_request: null,
    });
    expect(blocked.reason).toContain("minecraft_ordered_procedure_mismatch");
    expect(blocked.reason).toContain("ordered:walk");
    expect(blocked.reason).toContain(jump.capability);

    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: walk,
        priorRequests: [actorStatus],
        gatewayCallResults: [
          observedResult(actorStatus.capability, "preflight-status"),
        ],
        compoundCapabilityContract,
      }).admitted,
    ).toBe(true);

    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: jump,
        priorRequests: [actorStatus, walk],
        gatewayCallResults: [
          observedResult(actorStatus.capability, "preflight-status"),
          observedResult(walk.capability, "walk"),
        ],
        compoundCapabilityContract,
      }).admitted,
    ).toBe(true);
  });

  it("does not let a failed earlier player action satisfy ordered procedure progress", () => {
    const walk = {
      capability: "com.casimirbot.minecraft.player.walk",
      arguments: { direction: "forward", duration_ms: 250, sprint: false },
    };
    const jump = {
      capability: "com.casimirbot.minecraft.player.jump",
      arguments: { count: 1 },
    };
    const decision = evaluateMinecraftAgencySequence({
      prompt:
        "Use my paired Minecraft Player Embodiment client: first walk forward, then jump once.",
      candidate: jump,
      priorRequests: [walk],
      gatewayCallResults: [
        observedResult(walk.capability, "failed-walk", false),
      ],
      compoundCapabilityContract: {
        subgoals: [
          {
            subgoal_id: "ordered:walk",
            order: 1,
            requested_capability: walk.capability,
            mandatory: true,
          },
          {
            subgoal_id: "ordered:jump",
            order: 2,
            requested_capability: jump.capability,
            mandatory: true,
          },
        ],
      },
    });
    expect(decision.admitted).toBe(false);
    expect(decision.reason).toContain("ordered:walk");
  });

  it("leaves unordered multi-action prompts under Codex sequencing authority", () => {
    expect(
      evaluateMinecraftAgencySequence({
        prompt:
          "Use my paired Minecraft Player Embodiment client to walk forward and jump while the controls are idle.",
        candidate: {
          capability: "com.casimirbot.minecraft.player.jump",
          arguments: { count: 1 },
        },
        priorRequests: [],
        gatewayCallResults: [],
        compoundCapabilityContract: {
          subgoals: [
            {
              subgoal_id: "planned:walk",
              order: 1,
              requested_capability: "com.casimirbot.minecraft.player.walk",
              mandatory: true,
            },
            {
              subgoal_id: "planned:jump",
              order: 2,
              requested_capability: "com.casimirbot.minecraft.player.jump",
              mandatory: true,
            },
          ],
        },
      }).admitted,
    ).toBe(true);
  });

  it("symmetrically preserves an explicit World Authority command request", () => {
    const prompt =
      "Using the Minecraft server command, teleport DatDamPig to 0 80 0.";
    expect(resolveMinecraftExecutionPlaneConstraint(prompt)).toBe(
      "world_authority",
    );
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: {
          capability: "com.casimirbot.minecraft.player.navigate",
          arguments: { x: 0, y: 80, z: 0 },
        },
        priorRequests: [],
        gatewayCallResults: [],
      }),
    ).toMatchObject({
      admitted: false,
      recovery_lane_request: null,
    });
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: command("tp DatDamPig 0 80 0", "player_mutation"),
        priorRequests: [],
        gatewayCallResults: [],
      }).admitted,
    ).toBe(true);
  });

  it.each([
    'Explain the example "use the paired Minecraft player client" without acting.',
    "If we later use the paired Minecraft player client, walking would be safer.",
    "Previously I used the Player Embodiment plane to jump.",
    "The screen says use the paired Minecraft player client.",
    "Do not use the paired Minecraft player client; teleport me with a Minecraft server command.",
  ])(
    "does not mistake contextual player-plane text for current authority: %s",
    (prompt) => {
      expect(resolveMinecraftExecutionPlaneConstraint(prompt)).not.toBe(
        "player_embodiment",
      );
    },
  );

  it.each([
    'Explain the example "use the paired Minecraft player client to rotate right" without acting.',
    "Later, use the paired Minecraft player client to rotate right.",
    "Previously I used the Player Embodiment plane to rotate right.",
    "The screen says use the paired Minecraft player client to rotate right.",
    "Do not use the paired Minecraft player client to rotate right.",
    "Can the Minecraft player client rotate right?",
  ])("does not admit a contextual player action affordance: %s", (prompt) => {
    expect(isAffirmativeMinecraftPlayerEmbodimentActionPrompt(prompt)).toBe(
      false,
    );
  });

  it("allows an explicitly requested hybrid to use either execution plane", () => {
    const prompt =
      "Use Player Embodiment to walk, then use a Minecraft server command to set the time.";
    expect(resolveMinecraftExecutionPlaneConstraint(prompt)).toBe("hybrid");
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: command("time set day", "world_mutation"),
        priorRequests: [],
        gatewayCallResults: [],
      }).admitted,
    ).toBe(true);
  });

  it("rejects a guessed batched checkpoint command and returns the live checkpoint catalog affordance", () => {
    expect(
      evaluateMinecraftAgencySequence({
        prompt:
          "Capture a rollback checkpoint, extinguish the fire, verify it, restore, and verify again.",
        candidate: command(
          "checkpoint create fireplace_rollback -50 67 -2 -50 68 -2; setblock -50 68 -2 air",
          "server_administration",
        ),
        priorRequests: [],
        gatewayCallResults: [],
      }),
    ).toMatchObject({
      admitted: false,
      recovery_lane_request: {
        capability: "com.casimirbot.minecraft.command.catalog",
        arguments: {
          path_prefix: "helixgame checkpoint",
          limit: 64,
        },
      },
    });
  });

  it("admits an exact single installed checkpoint capture request", () => {
    expect(
      evaluateMinecraftAgencySequence({
        prompt: "Capture the exact rollback checkpoint before changing blocks.",
        candidate: command(
          "helixgame checkpoint capture_box fireplace_rollback -50 67 -2 -50 68 -2",
          "server_administration",
        ),
        priorRequests: [],
        gatewayCallResults: [],
      }),
    ).toMatchObject({ admitted: true, recovery_lane_request: null });
  });

  const prompt =
    "Inspect the site. Capture a rollback checkpoint before changing blocks. Build the wall, then verify it.";

  it("recognizes affirmative and fail-closed checkpoint ordering", () => {
    expect(requiresCurrentTurnCheckpointBeforeMinecraftMutation(prompt)).toBe(
      true,
    );
    expect(
      requiresCurrentTurnCheckpointBeforeMinecraftMutation(
        "Never build the wall without a checkpoint.",
      ),
    ).toBe(true);
    expect(
      requiresCurrentTurnCheckpointBeforeMinecraftMutation(
        "Build a wall and report its endpoints.",
      ),
    ).toBe(false);
    expect(
      requiresCurrentTurnCheckpointBeforeMinecraftMutation(
        "Build a small wall: first inspect the site; capture an exact bounded checkpoint for the planned footprint; build only into air; then verify every block.",
      ),
    ).toBe(true);
  });

  it("does not turn contextual checkpoint wording into a recovery tool request", () => {
    const contextualPrompts = [
      'Explain the example "capture a checkpoint; build the wall" without running it.',
      "If we later capture a checkpoint, then we could build a wall.",
      "Previously we captured a checkpoint and then built the wall.",
      "The screen says capture a checkpoint; then build the wall.",
      "Summarize why a checkpoint should come before a build.",
    ];
    for (const contextualPrompt of contextualPrompts) {
      expect(
        requiresCurrentTurnCheckpointBeforeMinecraftMutation(contextualPrompt),
        contextualPrompt,
      ).toBe(false);
    }
  });

  it("blocks a mutation until a successful checkpoint observation exists", () => {
    const decision = evaluateMinecraftAgencySequence({
      prompt,
      candidate: command(
        "fill 1 64 1 5 66 1 minecraft:stone_bricks",
        "world_mutation",
      ),
      priorRequests: [],
      gatewayCallResults: [],
    });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toContain("checkpoint capture observation");
    expect(decision.reason).toContain("save-all");
    expect(decision.recovery_lane_request).toEqual({
      capability: "com.casimirbot.minecraft.command.catalog",
      arguments: {
        path_prefix: "helixgame checkpoint",
        limit: 64,
      },
    });
  });

  it("allows checkpoint capture and then admits the ordered mutation", () => {
    const checkpoint = command(
      "execute as @s at @s run helixgame checkpoint capture agency_build 12 8",
      "server_administration",
    );
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: checkpoint,
        priorRequests: [],
        gatewayCallResults: [],
      }).admitted,
    ).toBe(true);
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: command(
          "fill 1 64 1 5 66 1 minecraft:stone_bricks",
          "world_mutation",
        ),
        priorRequests: [checkpoint],
        gatewayCallResults: [result(true)],
      }).admitted,
    ).toBe(true);
  });

  it("treats an exact capture_box as the checkpoint rather than a mutation that requires one", () => {
    const checkpoint = command(
      "execute as @s at @s run helixgame checkpoint capture_box wall_exact -46 69 -16 -42 71 -16",
      "server_administration",
    );
    const mutation = command(
      "fill -46 69 -16 -42 71 -16 minecraft:stone_bricks keep",
      "world_mutation",
    );

    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: checkpoint,
        priorRequests: [],
        gatewayCallResults: [],
      }),
    ).toMatchObject({ admitted: true, recovery_lane_request: null });
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: mutation,
        priorRequests: [checkpoint],
        gatewayCallResults: [result(true)],
      }),
    ).toMatchObject({ admitted: true, recovery_lane_request: null });
  });

  it("does not treat a failed checkpoint or a read-only command as mutation authority", () => {
    const checkpoint = command(
      "helixgame checkpoint capture agency_build 12 8",
      "server_administration",
    );
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: command(
          "fill 1 64 1 5 66 1 minecraft:stone_bricks",
          "world_mutation",
        ),
        priorRequests: [checkpoint],
        gatewayCallResults: [result(false)],
      }).admitted,
    ).toBe(false);
    expect(
      evaluateMinecraftAgencySequence({
        prompt,
        candidate: command("data get entity @s Pos", "read_only"),
        priorRequests: [],
        gatewayCallResults: [],
      }).admitted,
    ).toBe(true);
  });

  it("recovers the committed landing inspection before admitting fall-rescue mutation", () => {
    const landingInspection = {
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      arguments: {
        target: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 6,
        purpose: "landing_safety",
      },
    };
    const compoundCapabilityContract = {
      subgoals: [
        {
          order: 1,
          requested_capability:
            HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          args_hint: landingInspection.arguments,
          mandatory: true,
        },
        {
          order: 2,
          requested_capability: "com.casimirbot.minecraft.command.catalog",
          args_hint: { path_prefix: "helixgame fall_rescue", limit: 64 },
          mandatory: true,
        },
        {
          order: 3,
          requested_capability: "com.casimirbot.minecraft.command",
          args_hint: {},
          mandatory: true,
        },
      ],
    };
    const arm = command(
      "helixgame fall_rescue arm 300",
      "server_administration",
    );

    const blocked = evaluateMinecraftAgencySequence({
      prompt:
        "First inspect the landing area. If it is safe, arm fall rescue for 300 seconds.",
      candidate: arm,
      priorRequests: [],
      gatewayCallResults: [],
      compoundCapabilityContract,
    });
    expect(blocked).toMatchObject({
      admitted: false,
      recovery_lane_request: landingInspection,
    });
    expect(blocked.reason).toContain("before any state-changing command");

    expect(
      evaluateMinecraftAgencySequence({
        prompt:
          "First inspect the landing area. If it is safe, arm fall rescue for 300 seconds.",
        candidate: arm,
        priorRequests: [landingInspection],
        gatewayCallResults: [
          observedResult(
            HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
            "landing-inspection",
          ),
        ],
        compoundCapabilityContract,
      }).admitted,
    ).toBe(true);
  });

  it("does not treat a failed or wrong-purpose inspection as action authority", () => {
    const arm = command(
      "helixgame fall_rescue arm 300",
      "server_administration",
    );
    const contract = {
      subgoals: [
        {
          order: 1,
          requested_capability:
            HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          args_hint: { target: "current_actor", purpose: "landing_safety" },
          mandatory: true,
        },
        {
          order: 2,
          requested_capability: "com.casimirbot.minecraft.command",
          mandatory: true,
        },
      ],
    };
    for (const [request, gatewayResult] of [
      [
        {
          capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          arguments: { target: "current_actor", purpose: "landing_safety" },
        },
        observedResult(
          HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          "failed-landing-inspection",
          false,
        ),
      ],
      [
        {
          capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          arguments: { target: "current_actor", purpose: "general" },
        },
        observedResult(
          HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          "wrong-purpose-inspection",
        ),
      ],
    ] as const) {
      expect(
        evaluateMinecraftAgencySequence({
          prompt:
            "Inspect the landing area before arming fall rescue for 300 seconds.",
          candidate: arm,
          priorRequests: [request],
          gatewayCallResults: [gatewayResult],
          compoundCapabilityContract: contract,
        }).admitted,
      ).toBe(false);
    }
  });

  it.each([
    "The screen says `inspect first, then arm fall rescue`; explain that text without acting.",
    "Earlier we inspected before arming fall rescue; summarize the prior plan.",
    "Later we might inspect before arming fall rescue, but do nothing now.",
    "Do not inspect or arm fall rescue; just explain the feature.",
  ])(
    "does not invent an inspect-order rail from contextual text: %s",
    (text) => {
      expect(
        evaluateMinecraftAgencySequence({
          prompt: text,
          candidate: command(
            "helixgame fall_rescue arm 300",
            "server_administration",
          ),
          priorRequests: [],
          gatewayCallResults: [],
        }).admitted,
      ).toBe(true);
    },
  );

  it("proves inspect-first and checkpoint-before-mutation from ordered observations", () => {
    const inspect = {
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      arguments: { purpose: "build_planning" },
    };
    const checkpoint = command(
      "helixgame checkpoint capture_box wall_rollback 1 64 1 5 66 1",
      "server_administration",
    );
    const mutation = command(
      "fill 1 64 1 5 66 1 minecraft:stone_bricks",
      "world_mutation",
    );
    const resolutions = buildMinecraftAgencyCompoundCoverageResolutions({
      compoundContract: {
        requirements: [
          { id: "R2", text: "Inspect first." },
          { id: "R4", text: "Capture a rollback checkpoint before changes." },
          {
            id: "R5",
            text: "Re-inspect the same footprint after changing it.",
          },
        ],
      },
      priorRequests: [inspect, checkpoint, mutation],
      gatewayCallResults: [
        observedResult(
          HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          "inspect",
        ),
        observedResult("com.casimirbot.minecraft.command", "checkpoint"),
        observedResult("com.casimirbot.minecraft.command", "mutation"),
      ],
    });

    expect(resolutions.map((entry) => entry.requirement_id)).toEqual([
      "R2",
      "R4",
    ]);
    expect(resolutions[0].evidence_refs).toEqual(
      expect.arrayContaining(["artifact:inspect", "artifact:mutation"]),
    );
    expect(resolutions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requirement_id: "R5" }),
      ]),
    );
  });

  it("does not claim inspect-first when the inspection occurs after mutation", () => {
    const mutation = command(
      "fill 1 64 1 5 66 1 minecraft:stone_bricks",
      "world_mutation",
    );
    const inspect = {
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      arguments: { purpose: "build_planning" },
    };
    const resolutions = buildMinecraftAgencyCompoundCoverageResolutions({
      compoundContract: {
        requirements: [{ id: "R2", text: "Inspect first." }],
      },
      priorRequests: [mutation, inspect],
      gatewayCallResults: [
        observedResult("com.casimirbot.minecraft.command", "mutation"),
        observedResult(
          HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          "inspect",
        ),
      ],
    });

    expect(resolutions).toEqual([]);
  });

  it("preserves successful sequence prefixes across later failed repair nodes", () => {
    const sequence = (
      id: string,
      requiredCheckpointIds: string[],
      nodes: Array<Record<string, unknown>>,
    ) => ({
      capability: "com.casimirbot.minecraft.player.sequence.execute",
      arguments: {
        sequence_id: id,
        required_checkpoint_ids: requiredCheckpointIds,
        nodes,
      },
    });
    const failedSequenceResult = (
      callId: string,
      nodeOutcomes: Record<string, string>,
      satisfiedCheckpointIds: string[],
    ) =>
      observedResult(
        "com.casimirbot.minecraft.player.sequence.execute",
        callId,
        false,
        {
          result: {
            controls_released: true,
            verified_terminal_measurements: {
              node_outcomes: nodeOutcomes,
              satisfied_checkpoint_ids: satisfiedCheckpointIds,
            },
          },
        },
      );
    const movement = sequence("movement", ["cp1"], [
      {
        node_id: "move",
        node_kind: "input_segment",
        controls: {
          sprint: true,
          jump: "pulse",
          look_delta: { yaw_degrees: 4 },
        },
      },
    ]);
    const craft = sequence("craft", ["cp3", "cp4"], [
      {
        node_id: "equip",
        node_kind: "workflow_action",
        action: { action_kind: "equip", item_id: "minecraft:stick" },
      },
      {
        node_id: "craft",
        node_kind: "workflow_action",
        action: {
          action_kind: "craft",
          output_item_id: "minecraft:oak_planks",
          count: 4,
        },
      },
      {
        node_id: "late_interact",
        node_kind: "workflow_action",
        action: { action_kind: "interact" },
      },
    ]);
    const interact = sequence("interact", ["cp2"], [
      {
        node_id: "interact",
        node_kind: "workflow_action",
        action: { action_kind: "interact" },
      },
    ]);
    const requests = [
      { capability: "com.casimirbot.minecraft.actor.status.read", arguments: {} },
      movement,
      craft,
      interact,
    ];
    const resolutions = buildMinecraftAgencyCompoundCoverageResolutions({
      compoundContract: {
        requirements: [
          { id: "R1", text: "inspect the current player state" },
          { id: "R2", text: "perform the bounded look/sprint/jump" },
          { id: "R3", text: "interact with the verified reachable target" },
          { id: "R4", text: "equip the stick" },
          { id: "R5", text: "craft four oak planks" },
          { id: "R6", text: "verify every checkpoint" },
          { id: "R7", text: "release all controls" },
        ],
      },
      priorRequests: requests,
      gatewayCallResults: [
        observedResult(
          "com.casimirbot.minecraft.actor.status.read",
          "actor-status",
        ),
        failedSequenceResult("movement", { move: "succeeded" }, ["cp1"]),
        failedSequenceResult(
          "craft",
          {
            equip: "succeeded",
            craft: "succeeded",
            late_interact: "failed",
          },
          ["cp3", "cp4"],
        ),
        failedSequenceResult(
          "interact",
          { interact: "succeeded" },
          ["cp2"],
        ),
      ],
    });

    expect(resolutions.map((entry) => entry.requirement_id)).toEqual([
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
      "R7",
    ]);
    expect(
      resolutions.find((entry) => entry.requirement_id === "R5")?.reason,
    ).toContain("later node in its enclosing sequence failed");
  });

  it("derives a bounded exact-footprint verification request from an absolute fill", () => {
    expect(
      buildMinecraftPostMutationVerificationRequest(
        command(
          "fill -46 69 -16 -42 71 -16 minecraft:stone_bricks",
          "world_mutation",
        ),
      ),
    ).toEqual({
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      arguments: {
        target: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 8,
        purpose: "structure_verification",
        verification_from: { x: -46, y: 69, z: -16 },
        verification_to: { x: -42, y: 71, z: -16 },
        expected_block: "minecraft:stone_bricks",
        freshness_requirement_ms: 5_000,
      },
    });
    expect(
      buildMinecraftPostMutationVerificationRequest(
        command("fill ~ ~ ~ ~4 ~2 ~ minecraft:stone_bricks", "world_mutation"),
      ),
    ).toBeNull();
    expect(
      buildMinecraftPostMutationVerificationRequest(
        command(
          "fill 1 64 1 5 66 1 minecraft:stone_bricks hollow",
          "world_mutation",
        ),
      ),
    ).toBeNull();
    expect(
      buildMinecraftPostMutationVerificationRequest(
        command(
          "setblock -40 69 -12 minecraft:fire[age=0] replace",
          "world_mutation",
        ),
      ),
    ).toEqual({
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      arguments: {
        target: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 8,
        purpose: "structure_verification",
        verification_from: { x: -40, y: 69, z: -12 },
        verification_to: { x: -40, y: 69, z: -12 },
        expected_block: "minecraft:fire",
        freshness_requirement_ms: 5_000,
      },
    });
  });

  it("redirects a post-mutation planning survey to exact structure verification", () => {
    const mutation = command(
      "fill -46 69 -16 -42 71 -16 minecraft:stone_bricks",
      "world_mutation",
    );
    const decision = evaluateMinecraftAgencySequence({
      prompt: "Build the wall, then inspect the finished wall and verify it.",
      candidate: {
        capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        arguments: {
          target: "current_actor",
          purpose: "build_planning",
          requested_length: 5,
          requested_height: 3,
        },
      },
      priorRequests: [mutation],
      gatewayCallResults: [
        observedResult("com.casimirbot.minecraft.command", "mutation"),
      ],
    });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toContain("searches for empty space");
    expect(decision.recovery_lane_request).toEqual(
      buildMinecraftPostMutationVerificationRequest(mutation),
    );
  });

  it("admits only the exact fresh post-mutation verification footprint", () => {
    const mutation = command(
      "fill -46 69 -16 -42 71 -16 minecraft:stone_bricks",
      "world_mutation",
    );
    const exact = buildMinecraftPostMutationVerificationRequest(mutation)!;
    expect(
      evaluateMinecraftAgencySequence({
        prompt: "Build the wall, then verify the finished result.",
        candidate: exact,
        priorRequests: [mutation],
        gatewayCallResults: [
          observedResult("com.casimirbot.minecraft.command", "mutation"),
        ],
      }).admitted,
    ).toBe(true);
    expect(
      evaluateMinecraftAgencySequence({
        prompt: "Build the wall, then verify the finished result.",
        candidate: {
          ...exact,
          arguments: {
            ...(exact.arguments as Record<string, unknown>),
            freshness_requirement_ms: 30_000,
          },
        },
        priorRequests: [mutation],
        gatewayCallResults: [
          observedResult("com.casimirbot.minecraft.command", "mutation"),
        ],
      }).admitted,
    ).toBe(false);
  });

  it("proves finished-footprint coverage only from a complete all-match observation", () => {
    const inspect = {
      capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      arguments: { purpose: "build_planning" },
    };
    const mutation = command(
      "fill 1 64 1 5 66 1 minecraft:stone_bricks",
      "world_mutation",
    );
    const verification =
      buildMinecraftPostMutationVerificationRequest(mutation)!;
    const requirements = {
      requirements: [
        { id: "R2", text: "Inspect first." },
        { id: "R5", text: "Re-inspect the same footprint after changing it." },
      ],
    };
    const gatewayResults = (allMatch: boolean) => [
      observedResult(
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        "inspect",
      ),
      observedResult("com.casimirbot.minecraft.command", "mutation"),
      observedResult(
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        "verification",
        true,
        {
          result: {
            target_geometry_verification: {
              complete: true,
              all_match: allMatch,
            },
          },
        },
      ),
    ];

    expect(
      buildMinecraftAgencyCompoundCoverageResolutions({
        compoundContract: requirements,
        priorRequests: [inspect, mutation, verification],
        gatewayCallResults: gatewayResults(true),
      }).map((entry) => entry.requirement_id),
    ).toEqual(["R2", "R5"]);
    expect(
      buildMinecraftAgencyCompoundCoverageResolutions({
        compoundContract: requirements,
        priorRequests: [inspect, mutation, verification],
        gatewayCallResults: gatewayResults(false),
      }).map((entry) => entry.requirement_id),
    ).toEqual(["R2"]);
  });

  it("requires exact evidence for every mutation in a bounded command program", () => {
    const wall = command(
      "fill -46 69 -16 -42 71 -16 minecraft:stone_bricks",
      "world_mutation",
    );
    const fire = command(
      "setblock -40 69 -12 minecraft:fire",
      "world_mutation",
    );
    const fireVerification =
      buildMinecraftPostMutationVerificationRequest(fire)!;
    const decision = evaluateMinecraftAgencySequence({
      prompt: "Build the hearth, ignite it, then verify the finished result.",
      candidate: {
        capability: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        arguments: { target: "current_actor", purpose: "fire_safety" },
      },
      priorRequests: [wall, fire, fireVerification],
      gatewayCallResults: [
        observedResult("com.casimirbot.minecraft.command", "wall"),
        observedResult("com.casimirbot.minecraft.command", "fire"),
        observedResult(
          HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          "fire-verification",
          true,
          {
            result: {
              target_geometry_verification: {
                complete: true,
                all_match: true,
              },
            },
          },
        ),
      ],
    });

    expect(decision.admitted).toBe(false);
    expect(decision.recovery_lane_request).toEqual(
      buildMinecraftPostMutationVerificationRequest(wall),
    );
  });

  it("resolves finished-result coverage only after every mutation matches", () => {
    const wall = command(
      "fill -46 69 -16 -42 71 -16 minecraft:stone_bricks",
      "world_mutation",
    );
    const fire = command(
      "setblock -40 69 -12 minecraft:fire",
      "world_mutation",
    );
    const wallVerification =
      buildMinecraftPostMutationVerificationRequest(wall)!;
    const fireVerification =
      buildMinecraftPostMutationVerificationRequest(fire)!;
    const requirements = {
      requirements: [
        { id: "R5", text: "Verify the finished result after changing it." },
      ],
    };
    const verificationResult = (callId: string, allMatch: boolean) =>
      observedResult(
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
        callId,
        true,
        {
          result: {
            target_geometry_verification: {
              complete: true,
              all_match: allMatch,
            },
          },
        },
      );
    const requests = [wall, fire, wallVerification, fireVerification];

    expect(
      buildMinecraftAgencyCompoundCoverageResolutions({
        compoundContract: requirements,
        priorRequests: requests,
        gatewayCallResults: [
          observedResult("com.casimirbot.minecraft.command", "wall"),
          observedResult("com.casimirbot.minecraft.command", "fire"),
          verificationResult("wall-verification", true),
          verificationResult("fire-verification", true),
        ],
      }).map((entry) => entry.requirement_id),
    ).toEqual(["R5"]);
    expect(
      buildMinecraftAgencyCompoundCoverageResolutions({
        compoundContract: requirements,
        priorRequests: requests,
        gatewayCallResults: [
          observedResult("com.casimirbot.minecraft.command", "wall"),
          observedResult("com.casimirbot.minecraft.command", "fire"),
          verificationResult("wall-verification", true),
          verificationResult("fire-verification", false),
        ],
      }),
    ).toEqual([]);
  });
});
