import { describe, expect, it } from "vitest";
import {
  HELIX_MINECRAFT_PLAYER_CAMERA_TRACK_CAPABILITY,
  HELIX_ENVIRONMENT_ACTION_CONTROL_REQUEST_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_CONNECTOR_HEARTBEAT_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_CONNECTOR_MANIFEST_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_REQUEST_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_RESULT_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_WORKFLOW_EVENT_SCHEMA,
  HELIX_ENVIRONMENT_CLOCK_SNAPSHOT_SCHEMA,
  helixEnvironmentActionControlRequestSchema,
  helixEnvironmentActionConnectorHeartbeatSchema,
  helixEnvironmentActionConnectorManifestSchema,
  helixEnvironmentActionRequestSchema,
  helixEnvironmentActionResultSchema,
  helixEnvironmentActionWorkflowEventSchema,
} from "@shared/helix-environment-action";
import {
  HELIX_ENVIRONMENT_EVENT_BATCH_SCHEMA,
  HELIX_ENVIRONMENT_EVENT_SCHEMA,
  HELIX_ENVIRONMENT_SITUATION_DIGEST_SCHEMA,
  helixEnvironmentEventBatchSchema,
  helixEnvironmentSituationDigestSchema,
} from "@shared/helix-environment-event-stream";
import {
  HELIX_MINECRAFT_PLAYER_CAPABILITY_IDS,
  HELIX_MINECRAFT_PLAYER_CONSUME_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_EMERGENCY_STOP_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_NAVIGATE_CAPABILITY,
  helixMinecraftPlayerActionArgumentsSchema,
  minecraftPlayerCapabilityForActionKind,
} from "@shared/helix-minecraft-player-capabilities";
import {
  environmentActionWorkflowMeasurementsValid,
  hashEnvironmentActionIdempotencyContent,
  storedEnvironmentActionMatchesIdempotencyContent,
} from "../services/environment-connectors/actions/action-broker";

const now = "2026-08-05T12:00:00.000Z";
const later = "2026-08-05T12:01:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;

const environmentClock = (tickIndex: number, worldTickIndex: number) => ({
  schema: HELIX_ENVIRONMENT_CLOCK_SNAPSHOT_SCHEMA,
  clock_id: "minecraft_client_tick_clock:test",
  clock_kind: "minecraft_game_tick" as const,
  tick_rate_hz: 20,
  tick_index: tickIndex,
  world_tick_index: worldTickIndex,
  synchronization: "server_synchronized" as const,
  observed_at: now,
});

const baseActionRequest = () => ({
  schema: HELIX_ENVIRONMENT_ACTION_REQUEST_SCHEMA,
  action_request_id: "environment_action_request:test",
  workflow_id: "environment_action_workflow:test",
  action_authority_id: "environment_action_authority:test",
  environment_binding_id: "environment_binding:test",
  room_id: "shared_realtime_room:test",
  source_id: "source:room-ingress:test",
  world_id: "minecraft:local:test",
  participant_id: "room_participant:test",
  subject_binding_id: "environment_subject_binding:test",
  subject_native_id: "minecraft-player-uuid",
  run_id: "helix_agent_run:test",
  turn_id: "ask:test",
  provider_execution_id: "provider_execution:test",
  tool_call_id: "tool_call:test",
  catalog_snapshot_id: "environment_catalog:test",
  capability_id: HELIX_MINECRAFT_PLAYER_NAVIGATE_CAPABILITY,
  capability_version: 1,
  action_kind: "navigate_to",
  effect_class: "continuous_control" as const,
  workflow_mode: "long_running" as const,
  requested_control_engine: "adapter_selected" as const,
  arguments: {
    action_kind: "navigate_to",
    destination: { x: 10, y: 64, z: 12 },
    arrival_radius: 1,
    allow_sprint: true,
    allow_dig: false,
    allow_place: false,
    engine_preference: "adapter_selected",
  },
  preconditions: [],
  postconditions: [
    {
      condition_id: "postcondition:destination",
      condition_kind: "position_within",
      required: true,
      parameters: { x: 10, y: 64, z: 12, radius: 1 },
    },
  ],
  idempotency_key: "environment-action-idempotency-test",
  confirmation_state: "approved" as const,
  approval_ref: "environment_action_approval:test",
  created_at: now,
  deadline_at: later,
  constraints: {
    max_duration_ms: 60_000,
    max_distance_blocks: 128,
    max_block_mutations: 0,
    max_inventory_transfers: 0,
    manual_override_policy: "cancel" as const,
    require_postcondition_verification: true as const,
    world_mutation_allowed: false,
    combat_allowed: false,
    host_access_allowed: false as const,
    automatic_replay_allowed: false as const,
  },
  answer_authority: false as const,
  assistant_answer: false as const,
  terminal_eligible: false as const,
  raw_content_included: false as const,
});

const settledResult = () => ({
  schema: HELIX_ENVIRONMENT_ACTION_RESULT_SCHEMA,
  action_request_id: "environment_action_request:test",
  workflow_id: "environment_action_workflow:test",
  action_execution_id: "environment_action_execution:test",
  capability_id: HELIX_MINECRAFT_PLAYER_NAVIGATE_CAPABILITY,
  capability_version: 1,
  action_kind: "navigate_to",
  outcome: "succeeded" as const,
  summary: "The selected player reached the admitted destination.",
  control_engine: "native_fabric" as const,
  started_at: now,
  completed_at: later,
  progress_event_refs: ["environment_action_event:progress"],
  postconditions: [
    {
      condition_id: "postcondition:destination",
      condition_kind: "position_within",
      required: true,
      status: "satisfied" as const,
      summary: "The measured position is inside the admitted arrival radius.",
      evidence_refs: ["evidence:position-after"],
      checked_at: later,
    },
  ],
  evidence_refs: ["evidence:position-before", "evidence:position-after"],
  started_clock: environmentClock(120, 84_020),
  completed_clock: environmentClock(140, 84_040),
  duration_ticks: 20,
  side_effects_performed: true,
  player_motion_performed: true,
  player_interaction_performed: false,
  inventory_mutation_performed: false,
  world_mutation_performed: false,
  manual_override_detected: false,
  controls_released: true,
  host_access_performed: false as const,
  automatic_replay_performed: false as const,
  model_invoked: false as const,
  assistant_answer: false as const,
  raw_content_included: false as const,
});

describe("provider-neutral environment player-action contract", () => {
  it("treats bounded delivery retries as the same semantic action", () => {
    const original = helixEnvironmentActionRequestSchema.parse(baseActionRequest());
    const retry = helixEnvironmentActionRequestSchema.parse({
      ...baseActionRequest(),
      action_request_id: "environment_action_request:retry",
      workflow_id: "environment_action_workflow:retry",
      provider_execution_id: "provider_execution:retry",
      tool_call_id: "tool_call:retry",
      preconditions: original.preconditions.map((condition) => ({
        ...condition,
        condition_id: `${condition.condition_id}:retry`,
      })),
      postconditions: original.postconditions.map((condition) => ({
        ...condition,
        condition_id: `${condition.condition_id}:retry`,
      })),
      created_at: "2026-08-05T12:00:02.000Z",
      deadline_at: "2026-08-05T12:01:02.000Z",
    });

    expect(hashEnvironmentActionIdempotencyContent(retry)).toBe(
      hashEnvironmentActionIdempotencyContent(original),
    );
    expect(storedEnvironmentActionMatchesIdempotencyContent({
      storedPayload: JSON.stringify(original),
      storedRequestHash: "sha256:legacy-full-request-hash",
      request: retry,
    })).toBe(true);
  });

  it("rejects semantic changes hidden behind the same idempotency key", () => {
    const original = helixEnvironmentActionRequestSchema.parse(baseActionRequest());
    const changed = helixEnvironmentActionRequestSchema.parse({
      ...baseActionRequest(),
      arguments: {
        ...baseActionRequest().arguments,
        destination: { x: 11, y: 64, z: 12 },
      },
    });

    expect(hashEnvironmentActionIdempotencyContent(changed)).not.toBe(
      hashEnvironmentActionIdempotencyContent(original),
    );
  });

  it("declares the initial and reusable Minecraft player capability families", () => {
    expect(HELIX_MINECRAFT_PLAYER_CAPABILITY_IDS).toContain(
      HELIX_MINECRAFT_PLAYER_NAVIGATE_CAPABILITY,
    );
    expect(HELIX_MINECRAFT_PLAYER_CAPABILITY_IDS).toContain(
      HELIX_MINECRAFT_PLAYER_EMERGENCY_STOP_CAPABILITY,
    );
    expect(minecraftPlayerCapabilityForActionKind("craft")).toBe(
      "com.casimirbot.minecraft.player.craft",
    );
    expect(HELIX_MINECRAFT_PLAYER_CAPABILITY_IDS).toContain(
      HELIX_MINECRAFT_PLAYER_CONSUME_CAPABILITY,
    );
    expect(minecraftPlayerCapabilityForActionKind("consume")).toBe(
      "com.casimirbot.minecraft.player.consume",
    );
  });

  it("admits exact main-hand mushroom-stew recovery without hidden escalation", () => {
    const consume = {
      action_kind: "consume" as const,
      item_id: "minecraft:mushroom_stew",
      count: 1,
      hand: "main_hand" as const,
      max_duration_ms: 8_000,
      stop_below_health: 8,
      minimum_food_gain: 6,
      expected_remainder_item_id: "minecraft:bowl",
    };

    expect(helixMinecraftPlayerActionArgumentsSchema.safeParse(consume).success).toBe(true);
    expect(helixMinecraftPlayerActionArgumentsSchema.safeParse({
      ...consume,
      hand: "off_hand",
    }).success).toBe(false);
    expect(helixMinecraftPlayerActionArgumentsSchema.safeParse({
      ...consume,
      max_duration_ms: 999,
    }).success).toBe(false);
    expect(helixMinecraftPlayerActionArgumentsSchema.safeParse({
      ...consume,
      stop_below_health: 0,
    }).success).toBe(false);
    expect(helixMinecraftPlayerActionArgumentsSchema.safeParse({
      ...consume,
      allow_attack: true,
    }).success).toBe(false);
  });

  it("accepts bounded navigation and forbids hidden dig/place escalation", () => {
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse(
        baseActionRequest().arguments,
      ).success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...baseActionRequest().arguments,
        allow_dig: true,
      }).success,
    ).toBe(false);
  });

  it("admits one exact mining target without weakening bounded search", () => {
    const exactMine = {
      action_kind: "mine" as const,
      block_id: "minecraft:iron_ore",
      count: 1,
      search_radius: 32,
      target_position: { x: -11, y: 40, z: -2 },
    };
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse(exactMine).success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...exactMine,
        count: 2,
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...exactMine,
        target_position: { x: -11.5, y: 40, z: -2 },
      }).success,
    ).toBe(false);
  });

  it("admits ranged combat repertoires only with explicit bounded budgets", () => {
    const rangedGuard = {
      action_kind: "combat_guard" as const,
      hostile_entity_type_ids: ["minecraft:skeleton"],
      max_acquisition_distance: 24,
      require_line_of_sight: true as const,
      minimum_attack_cooldown: 0.9,
      max_attack_pulses: 48,
      max_target_switches: 4,
      target_commit_ticks: 10,
      retreat_start_distance: 2.5,
      retreat_stop_distance: 4,
      retreat_when_hostile_count_at_least: 2,
      max_duration_ms: 30_000,
      stop_below_health: 12,
      friendly_fire: false as const,
      approach_policy: "local_reroute_bounded" as const,
      max_approach_ticks: 300,
      cover_policy: "lateral_bounded" as const,
      max_cover_ticks: 120,
      projectile_response: "shield_or_sidestep" as const,
      projectile_evasion_horizon_ticks: 8,
      max_evasion_ticks: 200,
      shield_hand: "off_hand" as const,
      max_shield_hold_ticks: 200,
    };

    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse(rangedGuard).success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...rangedGuard,
        max_approach_ticks: 0,
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...rangedGuard,
        max_cover_ticks: 0,
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...rangedGuard,
        max_evasion_ticks: 0,
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...rangedGuard,
        shield_hand: "none",
      }).success,
    ).toBe(false);
  });

  it("requires an exact mine receipt to preserve the admitted coordinate", () => {
    const request = {
      ...baseActionRequest(),
      capability_id: "com.casimirbot.minecraft.player.mine",
      action_kind: "mine",
      arguments: {
        action_kind: "mine",
        block_id: "minecraft:iron_ore",
        count: 1,
        search_radius: 32,
        target_position: { x: -11, y: 40, z: -2 },
      },
      constraints: {
        ...baseActionRequest().constraints,
        max_block_mutations: 1,
        max_inventory_transfers: 1,
        world_mutation_allowed: true,
      },
    } as any;
    const result = {
      ...settledResult(),
      capability_id: "com.casimirbot.minecraft.player.mine",
      action_kind: "mine",
      world_mutation_performed: true,
    } as any;
    const measurements = {
      block_id: "minecraft:iron_ore",
      removed_count: 1,
      world_mutations_performed: 1,
      target_position: { x: -11, y: 40, z: -2 },
    };
    expect(
      environmentActionWorkflowMeasurementsValid({
        request,
        result,
        measurements,
      }),
    ).toBe(true);
    expect(
      environmentActionWorkflowMeasurementsValid({
        request,
        result,
        measurements: {
          ...measurements,
          target_position: { x: -11, y: 40, z: -1 },
        },
      }),
    ).toBe(false);
  });

  it("validates a bounded camera tracker and rejects forged target evidence", () => {
    const argumentsValue = {
      action_kind: "track_target" as const,
      target: {
        target_kind: "entity_type" as const,
        entity_type_id: "minecraft:bat",
        selection: "nearest" as const,
      },
      aim_point: "center" as const,
      max_acquisition_distance: 64,
      max_duration_ms: 30_000,
      max_turn_degrees_per_tick: 20,
      max_angular_acceleration_degrees_per_tick_squared: 4,
      prediction_ticks: 2,
      deadband_degrees: 0.5,
      reacquire_ticks: 10,
      require_line_of_sight: false,
      stop_below_health: 4,
    };
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse(argumentsValue).success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...argumentsValue,
        aim_point: "render_center",
      }).success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...argumentsValue,
        target: {
          target_kind: "particle_type",
          particle_type_id: "minecraft:enchant",
          selection: "nearest",
          continuity: "single_instance",
          handoff_radius: 0,
          max_handoffs: 0,
        },
      }).success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...argumentsValue,
        target: {
          target_kind: "particle_type",
          particle_type_id: "minecraft:enchant",
          selection: "nearest",
          continuity: "single_instance",
          handoff_radius: 1,
          max_handoffs: 1,
        },
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...argumentsValue,
        target: { ...argumentsValue.target, selection: "random" },
      }).success,
    ).toBe(false);

    const request = {
      ...baseActionRequest(),
      capability_id: HELIX_MINECRAFT_PLAYER_CAMERA_TRACK_CAPABILITY,
      action_kind: "track_target",
      arguments: argumentsValue,
      requested_control_engine: "native_fabric",
    } as any;
    const result = {
      ...settledResult(),
      capability_id: HELIX_MINECRAFT_PLAYER_CAMERA_TRACK_CAPABILITY,
      action_kind: "track_target",
      duration_ticks: 600,
    } as any;
    const measurements = {
      tracking_completed: true,
      target_kind: "entity_type",
      target_entity_type_id: "minecraft:bat",
      target_ref: `target:${"a".repeat(40)}`,
      duration_ticks: 600,
      sample_count: 600,
      retained_ticks: 590,
      target_loss_ticks: 10,
      line_of_sight_retained_ticks: 560,
      reacquisition_count: 2,
      mean_angular_error_degrees: 1.8,
      p95_angular_error_degrees: 4,
      max_angular_error_degrees: 12,
      final_yaw_error_degrees: 1,
      final_pitch_error_degrees: 0.5,
      line_of_sight_required: false,
    };
    expect(environmentActionWorkflowMeasurementsValid({
      request,
      result,
      measurements,
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request,
      result,
      measurements: {
        ...measurements,
        target_ref: "550e8400-e29b-41d4-a716-446655440000",
      },
    })).toBe(false);
    expect(environmentActionWorkflowMeasurementsValid({
      request,
      result,
      measurements: {
        ...measurements,
        target_entity_type_id: "minecraft:pig",
      },
    })).toBe(false);
    expect(environmentActionWorkflowMeasurementsValid({
      request: {
        ...request,
        arguments: {
          ...argumentsValue,
          target: {
            target_kind: "particle_type",
            particle_type_id: "minecraft:enchant",
            selection: "nearest",
            continuity: "same_type_stream",
            handoff_radius: 2,
            max_handoffs: 20,
          },
        },
      },
      result,
      measurements: {
        ...measurements,
        target_kind: "particle_type",
        target_particle_type_id: "minecraft:enchant",
        target_entity_type_id: undefined,
        particle_continuity: "same_type_stream",
        particle_handoff_count: 3,
        particle_max_handoffs: 20,
      },
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request: {
        ...request,
        arguments: {
          ...argumentsValue,
          target: {
            target_kind: "particle_type",
            particle_type_id: "minecraft:enchant",
            selection: "nearest",
            continuity: "same_type_stream",
            handoff_radius: 2,
            max_handoffs: 20,
          },
        },
      },
      result,
      measurements: {
        ...measurements,
        target_kind: "particle_type",
        target_particle_type_id: "minecraft:enchant",
        target_entity_type_id: undefined,
        particle_continuity: "same_type_stream",
        particle_handoff_count: 21,
        particle_max_handoffs: 20,
      },
    })).toBe(false);
  });

  it("requires exact identities, postconditions, no host access, and no replay", () => {
    expect(helixEnvironmentActionRequestSchema.parse(baseActionRequest())).toMatchObject({
      effect_class: "continuous_control",
      terminal_eligible: false,
      constraints: {
        require_postcondition_verification: true,
        host_access_allowed: false,
        automatic_replay_allowed: false,
      },
    });
  });

  it("rejects world mutation without an admitted mutation scope", () => {
    expect(
      helixEnvironmentActionRequestSchema.safeParse({
        ...baseActionRequest(),
        effect_class: "world_mutation",
      }).success,
    ).toBe(false);
  });

  it("requires every settled workflow to release client controls", () => {
    expect(helixEnvironmentActionResultSchema.parse(settledResult()).outcome).toBe(
      "succeeded",
    );
    expect(
      helixEnvironmentActionResultSchema.safeParse({
        ...settledResult(),
        controls_released: false,
      }).success,
    ).toBe(false);
  });

  it("preserves the 20 TPS Minecraft clock and rejects inconsistent duration receipts", () => {
    expect(helixEnvironmentActionResultSchema.parse(settledResult())).toMatchObject({
      started_clock: { tick_index: 120, world_tick_index: 84_020 },
      completed_clock: { tick_index: 140, world_tick_index: 84_040 },
      duration_ticks: 20,
    });
    expect(
      helixEnvironmentActionResultSchema.safeParse({
        ...settledResult(),
        duration_ticks: 19,
      }).success,
    ).toBe(false);
    expect(
      helixEnvironmentActionResultSchema.safeParse({
        ...settledResult(),
        completed_clock: {
          ...settledResult().completed_clock,
          world_tick_index: null,
        },
      }).success,
    ).toBe(false);
  });

  it("does not permit success with an unverified required postcondition", () => {
    const result = settledResult();
    expect(
      helixEnvironmentActionResultSchema.safeParse({
        ...result,
        postconditions: [
          {
            ...result.postconditions[0],
            status: "not_satisfied",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires terminal workflow events and manual override to be explicit", () => {
    const terminalEvent = {
      schema: HELIX_ENVIRONMENT_ACTION_WORKFLOW_EVENT_SCHEMA,
      event_id: "environment_action_event:complete",
      action_request_id: "environment_action_request:test",
      workflow_id: "environment_action_workflow:test",
      sequence: 4,
      event_type: "workflow.succeeded",
      workflow_state: "succeeded",
      progress_fraction: 1,
      summary: "Workflow completed and controls were released.",
      control_engine: "native_fabric",
      clock: environmentClock(140, 84_040),
      evidence_refs: ["evidence:position-after"],
      manual_override_detected: false,
      controls_released: true,
      created_at: later,
      content_role: "environment_action_event_not_assistant_answer",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    expect(helixEnvironmentActionWorkflowEventSchema.parse(terminalEvent)).toBeTruthy();
    expect(
      helixEnvironmentActionWorkflowEventSchema.safeParse({
        ...terminalEvent,
        event_type: "workflow.manual_override_detected",
        workflow_state: "paused_manual_override",
      }).success,
    ).toBe(false);
  });

  it("makes cancellation and emergency stop release all controls", () => {
    const controlRequest = {
      schema: HELIX_ENVIRONMENT_ACTION_CONTROL_REQUEST_SCHEMA,
      control_request_id: "environment_action_control:test",
      control_kind: "emergency_stop",
      action_authority_id: "environment_action_authority:test",
      environment_binding_id: "environment_binding:test",
      room_id: "shared_realtime_room:test",
      source_id: "source:room-ingress:test",
      world_id: "minecraft:local:test",
      participant_id: "room_participant:test",
      subject_binding_id: "environment_subject_binding:test",
      workflow_id: null,
      reason: "The room owner requested an immediate stop.",
      release_all_controls: true,
      created_at: now,
      deadline_at: later,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    expect(helixEnvironmentActionControlRequestSchema.parse(controlRequest)).toBeTruthy();
    expect(
      helixEnvironmentActionControlRequestSchema.safeParse({
        ...controlRequest,
        release_all_controls: false,
      }).success,
    ).toBe(false);
  });

  it("keeps the separately paired client manifest capability-scoped and host-blind", () => {
    const manifest = {
      schema: HELIX_ENVIRONMENT_ACTION_CONNECTOR_MANIFEST_SCHEMA,
      manifest_id: "environment_action_manifest:test",
      connector_installation_id: "connector_installation:test",
      producer_epoch_ref: "producer_epoch:test",
      action_authority_id: "environment_action_authority:test",
      environment_binding_id: "environment_binding:test",
      room_id: "shared_realtime_room:test",
      source_id: "source:room-ingress:test",
      world_id: "minecraft:local:test",
      participant_id: "room_participant:test",
      subject_binding_id: "environment_subject_binding:test",
      subject_native_id: "minecraft-player-uuid",
      domain: "minecraft",
      domain_adapter: "minecraft.fabric_client.v1",
      adapter_profile_id: "game.minecraft.player.fabric.v1",
      adapter_version: "0.1.0",
      protocol_version: "helix.environment_action.v1",
      capabilities: [
        {
          capability_id: HELIX_MINECRAFT_PLAYER_NAVIGATE_CAPABILITY,
          capability_version: 1,
          action_kind: "navigate_to",
          effect_class: "continuous_control",
          workflow_modes: ["long_running"],
          control_engines: ["native_fabric"],
          requires_world_mutation_scope: false,
          requires_confirmation: true,
        },
      ],
      available_control_engines: [
        {
          control_engine: "native_fabric",
          available: true,
          version: "1.21.8",
        },
        {
          control_engine: "baritone",
          available: false,
          version: null,
        },
      ],
      safety_policy: {
        manual_override_supported: true,
        manual_override_policy: "cancel",
        progress_observations_supported: true,
        postcondition_verification_supported: true,
        emergency_stop_supported: true,
        release_controls_on_disconnect: true,
        host_access_supported: false,
        automatic_replay_supported: false,
        model_execution_supported: false,
      },
      created_at: now,
      credential_included: false,
      content_role: "environment_action_connector_manifest_not_assistant_answer",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    } as const;

    expect(helixEnvironmentActionConnectorManifestSchema.parse(manifest)).toBeTruthy();
    expect(
      helixEnvironmentActionConnectorManifestSchema.safeParse({
        ...manifest,
        bearer_token: "must-not-appear-in-a-manifest",
      }).success,
    ).toBe(false);
    expect(
      helixEnvironmentActionConnectorManifestSchema.safeParse({
        ...manifest,
        capabilities: [
          {
            ...manifest.capabilities[0],
            control_engines: ["baritone"],
          },
        ],
      }).success,
    ).toBe(false);

    const baritoneAvailable = {
      ...manifest,
      capabilities: [
        {
          ...manifest.capabilities[0],
          control_engines: ["native_fabric", "baritone"],
        },
      ],
      available_control_engines: [
        manifest.available_control_engines[0],
        {
          control_engine: "baritone",
          available: true,
          version: "1.15.0",
          goal_forms: ["near_position"],
          mutation_policy: "movement_only",
          breaking_allowed: false,
          placement_allowed: false,
          inventory_mutation_allowed: false,
        },
      ],
    } as const;
    expect(
      helixEnvironmentActionConnectorManifestSchema.safeParse(baritoneAvailable)
        .success,
    ).toBe(true);
    expect(
      helixEnvironmentActionConnectorManifestSchema.safeParse({
        ...baritoneAvailable,
        available_control_engines: [
          baritoneAvailable.available_control_engines[0],
          {
            ...baritoneAvailable.available_control_engines[1],
            breaking_allowed: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      helixEnvironmentActionConnectorManifestSchema.safeParse({
        ...baritoneAvailable,
        available_control_engines: [
          baritoneAvailable.available_control_engines[0],
          {
            control_engine: "baritone",
            available: true,
            version: "1.15.0",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("does not let a heartbeat assert controls without an exact workflow", () => {
    const heartbeat = {
      schema: HELIX_ENVIRONMENT_ACTION_CONNECTOR_HEARTBEAT_SCHEMA,
      heartbeat_id: "environment_action_heartbeat:test",
      manifest_id: "environment_action_manifest:test",
      connector_installation_id: "connector_installation:test",
      producer_epoch_ref: "producer_epoch:test",
      action_authority_id: "environment_action_authority:test",
      environment_binding_id: "environment_binding:test",
      room_id: "shared_realtime_room:test",
      source_id: "source:room-ingress:test",
      world_id: "minecraft:local:test",
      participant_id: "room_participant:test",
      subject_binding_id: "environment_subject_binding:test",
      status: "active",
      active_workflow_ids: ["environment_action_workflow:test"],
      controls_asserted: true,
      manual_input_detected: false,
      emergency_stop_latched: false,
      control_engines: [
        {
          control_engine: "native_fabric",
          status: "busy",
          last_error: null,
        },
      ],
      latest_event_sequence: 4,
      clock: environmentClock(140, 84_040),
      evidence_refs: ["evidence:heartbeat"],
      created_at: now,
      credential_included: false,
      content_role: "environment_action_connector_heartbeat_not_assistant_answer",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    } as const;

    expect(helixEnvironmentActionConnectorHeartbeatSchema.parse(heartbeat)).toBeTruthy();
    const baritoneHeartbeat = {
      ...heartbeat,
      control_engines: [
        heartbeat.control_engines[0],
        {
          control_engine: "baritone",
          status: "idle",
          goal_owned: false,
          process_active: false,
          mutation_policy: "movement_only",
          mutation_policy_intact: true,
          safe_cancel_last_result: true,
          last_error: null,
        },
      ],
    } as const;
    expect(
      helixEnvironmentActionConnectorHeartbeatSchema.safeParse(
        baritoneHeartbeat,
      ).success,
    ).toBe(true);
    expect(
      helixEnvironmentActionConnectorHeartbeatSchema.safeParse({
        ...baritoneHeartbeat,
        control_engines: [
          baritoneHeartbeat.control_engines[0],
          {
            ...baritoneHeartbeat.control_engines[1],
            mutation_policy: "unrestricted",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      helixEnvironmentActionConnectorHeartbeatSchema.safeParse({
        ...baritoneHeartbeat,
        control_engines: [
          baritoneHeartbeat.control_engines[0],
          {
            ...baritoneHeartbeat.control_engines[1],
            status: "available",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      helixEnvironmentActionConnectorHeartbeatSchema.safeParse({
        ...heartbeat,
        active_workflow_ids: [],
      }).success,
    ).toBe(false);
    expect(
      helixEnvironmentActionConnectorHeartbeatSchema.safeParse({
        ...heartbeat,
        emergency_stop_latched: true,
      }).success,
    ).toBe(false);
  });
});

describe("typed environment event stream and situation digest", () => {
  const event = (sequence: number, eventId: string) => ({
    schema: HELIX_ENVIRONMENT_EVENT_SCHEMA,
    event_id: eventId,
    sequence,
    event_type: "workflow.progress",
    producer_plane: "player_embodiment",
    domain: "minecraft",
    domain_adapter: "minecraft.fabric_client.v1",
    room_id: "shared_realtime_room:test",
    source_id: "source:room-ingress:test",
    world_id: "minecraft:local:test",
    producer_epoch_ref: "producer_epoch_ref:test",
    subject_ref: "environment_subject:test",
    workflow_ref: "environment_action_workflow:test",
    summary: "The workflow advanced.",
    attributes: { progress_fraction: sequence / 10 },
    evidence_refs: [`evidence:event-${sequence}`],
    occurred_at: now,
    observed_at: now,
    provenance: "measured",
    raw_event_included: false,
    content_role: "environment_event_not_assistant_answer",
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  });

  it("requires strictly ordered event batches", () => {
    const first = event(1, "environment_event:first");
    const second = event(2, "environment_event:second");
    const batch = {
      schema: HELIX_ENVIRONMENT_EVENT_BATCH_SCHEMA,
      batch_id: "environment_event_batch:test",
      room_id: first.room_id,
      source_id: first.source_id,
      world_id: first.world_id,
      producer_epoch_ref: first.producer_epoch_ref,
      producer_plane: "player_embodiment",
      first_sequence: 1,
      last_sequence: 2,
      events: [first, second],
      batch_hash: hash,
      created_at: now,
      content_role: "environment_event_batch_not_assistant_answer",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    expect(helixEnvironmentEventBatchSchema.parse(batch)).toBeTruthy();
    expect(
      helixEnvironmentEventBatchSchema.safeParse({
        ...batch,
        events: [second, first],
      }).success,
    ).toBe(false);
  });

  it("keeps digest event references inside its provenance set", () => {
    const digest = {
      schema: HELIX_ENVIRONMENT_SITUATION_DIGEST_SCHEMA,
      digest_id: "environment_situation_digest:test",
      room_id: "shared_realtime_room:test",
      source_id: "source:room-ingress:test",
      world_id: "minecraft:local:test",
      producer_epoch_ref: "producer_epoch_ref:test",
      producer_plane: "player_embodiment",
      subject_ref: "environment_subject:test",
      window_started_at: now,
      window_ended_at: later,
      latest_event_sequence: 2,
      event_counts: { "workflow.progress": 2 },
      latest_event_refs: ["environment_event:second"],
      situation: {
        actor: { health: 20 },
        inventory: null,
        hazards: null,
        focus: null,
        active_workflow: { workflow_id: "environment_action_workflow:test" },
      },
      changed_fields: ["active_workflow"],
      derived_from_event_refs: [
        "environment_event:first",
        "environment_event:second",
      ],
      derived_from_snapshot_refs: [],
      digest_hash: hash,
      observed_at: later,
      provenance_valid: true,
      raw_events_included: false,
      content_role: "environment_situation_digest_not_assistant_answer",
      reentry_required: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    expect(helixEnvironmentSituationDigestSchema.parse(digest)).toBeTruthy();
    expect(
      helixEnvironmentSituationDigestSchema.safeParse({
        ...digest,
        latest_event_refs: ["environment_event:missing"],
      }).success,
    ).toBe(false);
  });
});
