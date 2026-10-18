import { describe, expect, it } from "vitest";
import {
  HELIX_MINECRAFT_COMPANION_PROFILE_SCHEMA,
  helixMinecraftCompanionPersistenceSchema,
  helixMinecraftCompanionPresenceSchema,
  type HelixMinecraftCompanionProfile,
} from "@shared/helix-minecraft-companion-presence";
import type { HelixMinecraftCompanionAction } from "@shared/helix-minecraft-companion";
import {
  CompanionPresenceStore,
} from "../companion-presence-store";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const t0 = "2026-08-31T19:00:00.000Z";
const t1 = "2026-08-31T19:01:00.000Z";
const t2 = "2026-08-31T19:02:00.000Z";
const t3 = "2026-08-31T19:03:00.000Z";
const expiry = "2026-08-31T19:10:00.000Z";

const profile = (): HelixMinecraftCompanionProfile => ({
  schema: HELIX_MINECRAFT_COMPANION_PROFILE_SCHEMA,
  companion_id: "companion:noble-one",
  owner_account_id: "account:owner",
  authority_subject_id: "subject:owner",
  beneficiary_subject_id: "player:owner",
  controller_profile_id: "resident.minecraft.companion-follow.v1",
  controller_artifact_hash: hash("a"),
  created_at: t0,
  public_capability_exposed: false,
  credential_included: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
});

const spawn = (store: CompanionPresenceStore, incarnation = "incarnation:noble-one:1") =>
  store.spawn({
    actorEntityId: `entity:${incarnation}`,
    actorIncarnationId: incarnation,
    environmentId: "environment:minecraft:s2",
    worldId: "minecraft:overworld",
    connectorEpoch: "epoch:s2:1",
    spawnedAt: t1,
    presenceExpiresAt: expiry,
    evidenceRefs: ["evidence:spawn:1"],
  });

const activate = (store: CompanionPresenceStore) => {
  store.bind({ observedAt: t1, evidenceRefs: ["evidence:bind:1"] });
  store.admit({
    actorLeaseId: "lease:actor:1",
    effectLeaseId: "lease:effect:1",
    resourceKeys: ["minecraft:navigation", "minecraft:chunk:bounded"],
    admittedAt: t2,
    evidenceRefs: ["evidence:admit:1"],
  });
  return store.activate({ activatedAt: t2, evidenceRefs: ["evidence:active:1"] });
};

const actionFor = (
  store: CompanionPresenceStore,
  patch: Partial<HelixMinecraftCompanionAction["identity"]> = {},
): HelixMinecraftCompanionAction => {
  const presence = store.inspect();
  const incarnation = presence.incarnation!;
  return {
    schema: "helix.minecraft_companion.action.v1",
    action_id: "action:s2:1",
    proposal_id: "proposal:s2:1",
    binding_id: "binding:s2:1",
    identity: {
      environment_id: incarnation.environment_id,
      world_id: incarnation.world_id,
      connector_epoch: incarnation.connector_epoch,
      actor_id: presence.profile.companion_id,
      actor_runtime_id: incarnation.actor_entity_id,
      actor_incarnation_id: incarnation.actor_incarnation_id,
      controller_profile_id: presence.profile.controller_profile_id,
      controller_artifact_hash: presence.profile.controller_artifact_hash,
      owner_account_id: presence.profile.owner_account_id,
      authority_subject_id: presence.profile.authority_subject_id,
      beneficiary_subject_id: presence.profile.beneficiary_subject_id,
      room_id: "room:s2",
      observation_revision: presence.revision,
      companion_id: presence.profile.companion_id,
      actor_entity_id: incarnation.actor_entity_id,
      target_subject_id: null,
      ...patch,
    },
    payload: { action_kind: "hold" },
    actor_lease_id: presence.actor_lease_id!,
    effect_lease_id: presence.effect_lease_id!,
    requested_at: t2,
    expires_at: expiry,
    public_capability_exposed: false,
    world_authority_used: false,
    mining_authorized: false,
    command_execution_authorized: false,
    automatic_replay: false,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
  };
};

describe("S2 companion presence store", () => {
  it("starts as a private durable registration without a runtime body", () => {
    const presence = new CompanionPresenceStore(profile(), t0).inspect();
    expect(presence).toMatchObject({
      state: "registered",
      incarnation: null,
      actor_lease_id: null,
      effect_lease_id: null,
      controls_may_be_asserted: false,
      public_capability_exposed: false,
      execution_authority: false,
    });
  });

  it("advances visible identity through finite spawn, bind, admit, and active states", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    expect(spawn(store).state).toBe("spawned");
    const active = activate(store);
    expect(active).toMatchObject({
      state: "active",
      actor_lease_id: "lease:actor:1",
      effect_lease_id: "lease:effect:1",
      controls_may_be_asserted: true,
      active_resource_keys: ["minecraft:navigation", "minecraft:chunk:bounded"],
    });
    expect(active.incarnation?.presence_expires_at).toBe(expiry);
  });

  it("accepts only an exact current-incarnation action", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    spawn(store);
    activate(store);
    expect(store.assertActionCurrent(actionFor(store), t3).action_id).toBe("action:s2:1");
    expect(() =>
      store.assertActionCurrent(
        actionFor(store, { actor_incarnation_id: "incarnation:noble-one:old" }),
        t3,
      ),
    ).toThrowError(expect.objectContaining({ code: "companion_action_identity_stale" }));
  });

  it("releases every lease, resource, proposal, chunk claim, effect, and control", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    spawn(store);
    activate(store);
    store.queueProposal("proposal:s2:1", t2);
    const released = store.release({
      cleanupId: "cleanup:s2:1",
      reason: "manual_override",
      completedAt: t3,
      evidenceRefs: ["evidence:cleanup:1"],
    });
    expect(released).toMatchObject({
      state: "released",
      actor_lease_id: null,
      effect_lease_id: null,
      active_resource_keys: [],
      pending_proposal_ids: [],
      controls_may_be_asserted: false,
      cleanup_receipt: {
        navigation_cleared: true,
        transient_effects_cleared: true,
        chunk_claims_released: true,
        outstanding_proposals_canceled: true,
        controls_released: true,
        late_effect_count: 0,
        duplicate_effect_count: 0,
      },
    });
    expect(() => store.assertActionCurrent(actionForReleased(released), t3)).toThrowError(
      expect.objectContaining({ code: "companion_not_active" }),
    );
  });

  it("makes cleanup idempotent without issuing a second receipt or revision", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    spawn(store);
    activate(store);
    const first = store.release({
      cleanupId: "cleanup:s2:1",
      reason: "completed",
      completedAt: t3,
      evidenceRefs: ["evidence:cleanup:1"],
    });
    const second = store.release({
      cleanupId: "cleanup:s2:2",
      reason: "completed",
      completedAt: expiry,
      evidenceRefs: ["evidence:cleanup:2"],
    });
    expect(second.revision).toBe(first.revision);
    expect(second.cleanup_receipt?.cleanup_id).toBe("cleanup:s2:1");
  });

  it("persists only the durable profile and restores with no incarnation or authority", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    spawn(store);
    activate(store);
    const snapshot = store.snapshot(t3);
    expect(helixMinecraftCompanionPersistenceSchema.parse(snapshot)).toMatchObject({
      previous_actor_incarnation_id: "incarnation:noble-one:1",
      active_incarnation_persisted: false,
      actor_lease_persisted: false,
      effect_lease_persisted: false,
      resource_claims_persisted: false,
      pending_proposals_persisted: false,
      credentials_persisted: false,
    });
    const restored = CompanionPresenceStore.restore(snapshot, expiry);
    expect(restored.inspect()).toMatchObject({
      state: "registered",
      incarnation: null,
      actor_lease_id: null,
      effect_lease_id: null,
      persistence_restored: true,
      controls_may_be_asserted: false,
    });
    expect(() => spawn(restored, "incarnation:noble-one:1")).toThrowError(
      expect.objectContaining({ code: "companion_incarnation_reused" }),
    );
  });

  it("rotates incarnation after release and despawn and rejects the prior action", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    spawn(store);
    activate(store);
    const oldAction = actionFor(store);
    store.release({
      cleanupId: "cleanup:s2:1",
      reason: "death",
      completedAt: t3,
      evidenceRefs: ["evidence:death:1"],
    });
    store.despawn({ despawnedAt: t3, evidenceRefs: ["evidence:despawn:1"] });
    spawn(store, "incarnation:noble-one:2");
    activate(store);
    expect(store.inspect().incarnation?.actor_incarnation_id).toBe("incarnation:noble-one:2");
    expect(() => store.assertActionCurrent(oldAction, t3)).toThrowError(
      expect.objectContaining({ code: "companion_action_identity_stale" }),
    );
  });

  it("turns finite-presence expiry into complete cleanup", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    spawn(store);
    activate(store);
    const released = store.enforcePresenceExpiry({
      now: expiry,
      cleanupId: "cleanup:s2:expiry",
      evidenceRefs: ["evidence:expiry:1"],
    });
    expect(released).toMatchObject({
      state: "released",
      controls_may_be_asserted: false,
      cleanup_receipt: { reason: "lease_expired" },
    });
  });

  it("invalidates and cleans a pre-admission body when finite presence expires", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    spawn(store);
    const invalidated = store.enforcePresenceExpiry({
      now: expiry,
      cleanupId: "cleanup:s2:unadmitted-expiry",
      evidenceRefs: ["evidence:expiry:unadmitted"],
    });
    expect(invalidated).toMatchObject({
      state: "invalidated",
      actor_lease_id: null,
      effect_lease_id: null,
      controls_may_be_asserted: false,
      cleanup_receipt: {
        reason: "lease_expired",
        released_actor_lease_id: null,
        released_effect_lease_id: null,
        chunk_claims_released: true,
      },
    });
  });

  it("fails closed on skipped lifecycle states and forged released cleanup", () => {
    const store = new CompanionPresenceStore(profile(), t0);
    expect(() =>
      store.activate({ activatedAt: t1, evidenceRefs: ["evidence:invalid"] }),
    ).toThrowError(expect.objectContaining({ code: "companion_activate_state_invalid" }));

    expect(
      helixMinecraftCompanionPresenceSchema.safeParse({
        ...store.inspect(),
        state: "released",
      }).success,
    ).toBe(false);
  });
});

const actionForReleased = (
  presence: ReturnType<CompanionPresenceStore["inspect"]>,
): HelixMinecraftCompanionAction => ({
  schema: "helix.minecraft_companion.action.v1",
  action_id: "action:s2:released",
  proposal_id: "proposal:s2:released",
  binding_id: "binding:s2:1",
  identity: {
    environment_id: presence.incarnation!.environment_id,
    world_id: presence.incarnation!.world_id,
    connector_epoch: presence.incarnation!.connector_epoch,
    actor_id: presence.profile.companion_id,
    actor_runtime_id: presence.incarnation!.actor_entity_id,
    actor_incarnation_id: presence.incarnation!.actor_incarnation_id,
    controller_profile_id: presence.profile.controller_profile_id,
    controller_artifact_hash: presence.profile.controller_artifact_hash,
    owner_account_id: presence.profile.owner_account_id,
    authority_subject_id: presence.profile.authority_subject_id,
    beneficiary_subject_id: presence.profile.beneficiary_subject_id,
    room_id: "room:s2",
    observation_revision: presence.revision,
    companion_id: presence.profile.companion_id,
    actor_entity_id: presence.incarnation!.actor_entity_id,
    target_subject_id: null,
  },
  payload: { action_kind: "hold" },
  actor_lease_id: "lease:actor:released",
  effect_lease_id: "lease:effect:released",
  requested_at: t2,
  expires_at: expiry,
  public_capability_exposed: false,
  world_authority_used: false,
  mining_authorized: false,
  command_execution_authorized: false,
  automatic_replay: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
});
