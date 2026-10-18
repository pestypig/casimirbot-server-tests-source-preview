import { describe, expect, it } from "vitest";
import {
  buildHelixResidentControllerEvent,
  buildHelixResidentControllerProposal,
  evaluateHelixResidentControllerCurrentness,
  helixResidentControllerAdmissionSchema,
  helixResidentControllerProfileSchema,
  helixResidentControllerReceiptSchema,
  reduceHelixResidentControllerEvents,
  type HelixResidentControllerEvent,
  type HelixResidentControllerIdentity,
} from "@shared/helix-resident-controller";
import {
  HELIX_MINECRAFT_COMPANION_MINING_S1_DECLARATION,
  helixMinecraftCompanionActionSchema,
  helixMinecraftCompanionBindingSchema,
  helixMinecraftCompanionReceiptSchema,
} from "@shared/helix-minecraft-companion";
import {
  HELIX_RESIDENT_CONTROLLER_LEGACY_AUTHORITY_INVENTORY,
  helixLegacyAuthorityInventoryEntrySchema,
  isHelixResidentControllerContextEligible,
} from "@shared/helix-resident-controller-legacy-authority";

const hash = (character = "a") => `sha256:${character.repeat(64)}`;
const now = "2026-08-31T18:00:00.000Z";
const later = "2026-08-31T18:05:00.000Z";

const identity = (): HelixResidentControllerIdentity => ({
  environment_id: "environment:minecraft:s1",
  world_id: "minecraft:overworld",
  connector_epoch: "epoch:s1",
  actor_id: "companion:noble-one",
  actor_runtime_id: "entity:noble-one:1",
  actor_incarnation_id: "incarnation:noble-one:1",
  controller_profile_id: "resident.minecraft.companion-follow.v1",
  controller_artifact_hash: hash("a"),
  owner_account_id: "account:owner",
  authority_subject_id: "subject:owner",
  beneficiary_subject_id: "player:owner",
  room_id: "room:s1",
  observation_revision: 7,
});

const companionIdentity = () => ({
  ...identity(),
  companion_id: "companion:noble-one",
  actor_entity_id: "entity:noble-one:1",
  target_subject_id: "player:owner",
});

const proposal = () =>
  buildHelixResidentControllerProposal({
    proposal_id: "proposal:s1:1",
    identity: identity(),
    response_kind: "follow",
    arguments: { target_subject_id: "player:owner" },
    precondition_refs: ["evidence:observation:7"],
    requested_resource_keys: ["minecraft:navigation"],
    requested_effect_keys: ["minecraft:actor-motion"],
    maximum_effect_count: 64,
    proposed_at: now,
    expires_at: later,
  });

const profile = () => ({
  schema: "helix.resident_controller.profile.v1",
  controller_profile_id: "resident.minecraft.companion-follow.v1",
  controller_artifact_hash: hash("a"),
  domain: "minecraft",
  response_vocabulary: ["follow", "hold", "release"],
  sensor_vocabulary: ["target_distance", "obstruction"],
  resource_vocabulary: ["minecraft:navigation"],
  effect_vocabulary: ["minecraft:actor-motion"],
  maximum_observation_age_ms: 1_000,
  reaction_deadline_ms: 50,
  maximum_duration_ms: 60_000,
  deterministic_fallback: "release",
  manual_override_required: true,
  emergency_stop_required: true,
  model_execution_supported: false,
  authority_expansion_supported: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
});

const binding = () => ({
  schema: "helix.minecraft_companion.binding.v1",
  binding_id: "binding:noble-one:1",
  identity: companionIdentity(),
  visible_actor: {
    entity_id: "entity:noble-one:1",
    incarnation_id: "incarnation:noble-one:1",
    canonical_location: true,
    canonical_health: true,
    canonical_inventory: true,
    canonical_equipment: true,
    canonical_xp: true,
    targetable: true,
  },
  interaction_backend: {
    backend_id: "bounded_unregistered_player_semantics_v1",
    backend_version: "v1",
    visible_body: false,
    online_player_registration: false,
    independent_location: false,
    independent_health: false,
    independent_inventory: false,
    independent_pickup_owner: false,
    independent_advancement_identity: false,
    command_lane_enabled: false,
    maximum_discarded_update_packets: 64,
  },
  one_actor_one_economy: true,
  observed_at: now,
  evidence_refs: ["evidence:binding:1"],
  credential_included: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
});

const residentReceipt = (outcome = "completed") => ({
  schema: "helix.resident_controller.receipt.v1",
  receipt_id: "receipt:s1:1",
  proposal_id: "proposal:s1:1",
  admission_id: "admission:s1:1",
  identity: identity(),
  actor_lease_id: "lease:actor:1",
  effect_lease_id: "lease:effect:1",
  outcome,
  started_at: now,
  settled_at: later,
  start_observation_revision: 7,
  end_observation_revision: 8,
  effects_committed: outcome === "completed" ? 1 : 0,
  measurements: { target_distance: 2.5 },
  evidence_refs: ["evidence:receipt:1"],
  controls_released: true,
  resources_released: true,
  leases_replayable: false,
  credential_included: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
});

const action = () => ({
  schema: "helix.minecraft_companion.action.v1",
  action_id: "action:s1:1",
  proposal_id: "proposal:s1:1",
  binding_id: "binding:noble-one:1",
  identity: companionIdentity(),
  payload: {
    action_kind: "follow",
    target: {
      subject_id: "player:owner",
      entity_id: "entity:owner:1",
      observation_revision: 7,
    },
    start_distance: 5,
    stop_distance: 3,
    maximum_radius: 32,
  },
  actor_lease_id: "lease:actor:1",
  effect_lease_id: "lease:effect:1",
  requested_at: now,
  expires_at: later,
  public_capability_exposed: false,
  world_authority_used: false,
  mining_authorized: false,
  command_execution_authorized: false,
  automatic_replay: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
});

describe("EH-RCC1 resident-controller contract", () => {
  it("accepts a bounded provider-neutral profile and rejects model or authority expansion", () => {
    expect(helixResidentControllerProfileSchema.parse(profile())).toMatchObject({
      model_execution_supported: false,
      authority_expansion_supported: false,
      answer_authority: false,
    });
    expect(
      helixResidentControllerProfileSchema.safeParse({
        ...profile(),
        model_execution_supported: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["incarnation", { actor_incarnation_id: "incarnation:noble-one:2" }],
    ["world", { world_id: "minecraft:the_nether" }],
    ["epoch", { connector_epoch: "epoch:s2" }],
    ["observation", { observation_revision: 8 }],
  ])("rejects a proposal after %s drift", (_name, patch) => {
    expect(
      evaluateHelixResidentControllerCurrentness({
        proposal: proposal(),
        currentIdentity: { ...identity(), ...patch },
        now: "2026-08-31T18:01:00.000Z",
      }),
    ).toMatchObject({ current: false, reason: "identity_stale" });
  });

  it("admits only a finite serialized actor/effect lease without replay", () => {
    const currentProposal = proposal();
    const admission = {
      schema: "helix.resident_controller.admission.v1",
      admission_id: "admission:s1:1",
      proposal_id: currentProposal.proposal_id,
      proposal_hash: currentProposal.proposal_hash,
      identity: identity(),
      actor_lease_id: "lease:actor:1",
      effect_lease_id: "lease:effect:1",
      admitted_resource_keys: ["minecraft:navigation"],
      admitted_effect_keys: ["minecraft:actor-motion"],
      maximum_effect_count: 64,
      admitted_at: now,
      expires_at: later,
      automatic_replay: false,
      serialized_execution_required: true,
      manual_override_required: true,
      emergency_stop_required: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    };
    expect(helixResidentControllerAdmissionSchema.parse(admission)).toMatchObject({
      automatic_replay: false,
      serialized_execution_required: true,
      answer_authority: false,
    });
    expect(
      helixResidentControllerAdmissionSchema.safeParse({
        ...admission,
        expires_at: now,
      }).success,
    ).toBe(false);
  });

  it("reduces only a contiguous, identity-stable lifecycle and releases all control", () => {
    const events: HelixResidentControllerEvent[] = [];
    const append = (payload: Parameters<typeof buildHelixResidentControllerEvent>[0]["payload"]) => {
      events.push(
        buildHelixResidentControllerEvent({
          event_id: `event:s1:${events.length + 1}`,
          sequence: events.length + 1,
          previous_event_hash: events.at(-1)?.event_hash ?? null,
          identity: identity(),
          payload,
          occurred_at: now,
        }),
      );
    };
    append({ kind: "registered" });
    append({ kind: "bound" });
    append({ kind: "admitted", admission_id: "admission:s1:1" });
    append({ kind: "activated", admission_id: "admission:s1:1" });
    append({ kind: "suspended", reason: "manual input" });
    append({ kind: "release_started", reason: "operator release" });
    append({ kind: "released", receipt_id: "receipt:s1:1" });

    expect(reduceHelixResidentControllerEvents(events)).toMatchObject({
      state: "released",
      controls_may_be_asserted: false,
      execution_authority: false,
      terminal_eligible: false,
    });
  });

  it("rejects poisoned hashes, skipped states, and incarnation drift", () => {
    const registered = buildHelixResidentControllerEvent({
      event_id: "event:s1:1",
      sequence: 1,
      previous_event_hash: null,
      identity: identity(),
      payload: { kind: "registered" },
      occurred_at: now,
    });
    expect(() =>
      reduceHelixResidentControllerEvents([
        { ...registered, event_hash: hash("f") },
      ]),
    ).toThrowError(expect.objectContaining({ code: "resident_controller_event_hash_invalid" }));

    const activated = buildHelixResidentControllerEvent({
      event_id: "event:s1:2",
      sequence: 2,
      previous_event_hash: registered.event_hash,
      identity: identity(),
      payload: { kind: "activated", admission_id: "admission:s1:1" },
      occurred_at: now,
    });
    expect(() => reduceHelixResidentControllerEvents([registered, activated])).toThrowError(
      expect.objectContaining({ code: "resident_controller_transition_invalid" }),
    );

    const drifted = buildHelixResidentControllerEvent({
      event_id: "event:s1:2",
      sequence: 2,
      previous_event_hash: registered.event_hash,
      identity: { ...identity(), actor_incarnation_id: "incarnation:noble-one:2" },
      payload: { kind: "bound" },
      occurred_at: now,
    });
    expect(() => reduceHelixResidentControllerEvents([registered, drifted])).toThrowError(
      expect.objectContaining({ code: "resident_controller_identity_drift" }),
    );
  });
});

describe("S1 Minecraft hybrid companion contract", () => {
  it("binds one logical companion, one visible entity, and no second economy", () => {
    expect(helixMinecraftCompanionBindingSchema.parse(binding())).toMatchObject({
      one_actor_one_economy: true,
      interaction_backend: {
        visible_body: false,
        online_player_registration: false,
        independent_inventory: false,
        command_lane_enabled: false,
      },
    });
    expect(
      helixMinecraftCompanionBindingSchema.safeParse({
        ...binding(),
        interaction_backend: {
          ...binding().interaction_backend,
          independent_inventory: true,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts bounded follow hysteresis but has no executable mining action", () => {
    expect(helixMinecraftCompanionActionSchema.parse(action()).payload.action_kind).toBe("follow");
    expect(
      helixMinecraftCompanionActionSchema.safeParse({
        ...action(),
        payload: { action_kind: "mine", target_position: [0, 64, 0] },
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftCompanionActionSchema.safeParse({
        ...action(),
        payload: { ...action().payload, start_distance: 2, stop_distance: 3 },
      }).success,
    ).toBe(false);
    expect(HELIX_MINECRAFT_COMPANION_MINING_S1_DECLARATION).toMatchObject({
      lifecycle: "s1_contract_only",
      public_catalog_exposed: false,
      execution_enabled: false,
      world_authority_substitution_allowed: false,
      command_fallback_allowed: false,
    });
  });

  it("settles once against canonical actor state and never on failure", () => {
    const completed = {
      schema: "helix.minecraft_companion.receipt.v1",
      resident_receipt: residentReceipt(),
      binding_id: "binding:noble-one:1",
      action_id: "action:s1:1",
      companion_id: "companion:noble-one",
      actor_entity_id: "entity:noble-one:1",
      actor_incarnation_id: "incarnation:noble-one:1",
      interaction_backend_id: "bounded_unregistered_player_semantics_v1",
      interaction_backend_version: "v1",
      canonical_state_before_hash: hash("b"),
      canonical_state_after_hash: hash("c"),
      backend_working_state_discarded: true,
      backend_owned_inventory: false,
      backend_owned_health: false,
      backend_owned_position: false,
      settlement_count: 1,
      late_effect_count: 0,
      duplicate_effect_count: 0,
      public_capability_exposed: false,
      mining_authorized: false,
      credential_included: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    };
    expect(helixMinecraftCompanionReceiptSchema.parse(completed).settlement_count).toBe(1);
    expect(helixResidentControllerReceiptSchema.parse(residentReceipt())).toBeTruthy();
    expect(
      helixMinecraftCompanionReceiptSchema.safeParse({
        ...completed,
        resident_receipt: residentReceipt("interrupted"),
      }).success,
    ).toBe(false);
  });
});

describe("S1 legacy-authority hygiene", () => {
  it("keeps quarantined and generated surfaces out of resident-controller context", () => {
    const dottie = HELIX_RESIDENT_CONTROLLER_LEGACY_AUTHORITY_INVENTORY.find(
      (entry) => entry.inventory_id === "legacy:dottie-orchestrator",
    )!;
    const lattice = HELIX_RESIDENT_CONTROLLER_LEGACY_AUTHORITY_INVENTORY.find(
      (entry) => entry.inventory_id === "legacy:generated-code-lattice",
    )!;
    expect(isHelixResidentControllerContextEligible(dottie)).toBe(false);
    expect(isHelixResidentControllerContextEligible(lattice)).toBe(false);
    expect(dottie.deletion_authorized).toBe(false);
  });

  it("rejects a generated projection or receipt promoted to design/execution authority", () => {
    const base = HELIX_RESIDENT_CONTROLLER_LEGACY_AUTHORITY_INVENTORY.at(-1)!;
    expect(
      helixLegacyAuthorityInventoryEntrySchema.safeParse({
        ...base,
        current_design_authority: true,
      }).success,
    ).toBe(false);
    expect(
      helixLegacyAuthorityInventoryEntrySchema.safeParse({
        ...base,
        execution_authority: true,
      }).success,
    ).toBe(false);
  });
});
