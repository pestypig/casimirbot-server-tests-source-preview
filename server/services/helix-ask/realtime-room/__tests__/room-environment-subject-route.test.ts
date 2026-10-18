import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
  type HelixEnvironmentAdapterAdmissionProjection,
} from "@shared/helix-environment-adapter-profile";
import {
  HELIX_ENVIRONMENT_SOURCE_HEARTBEAT_SCHEMA,
  type HelixEnvironmentSourceHeartbeat,
} from "@shared/helix-environment-source-manifest";
import {
  HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  type HelixRoomSourceAdmission,
} from "@shared/helix-room-source-ingress";
import { ensureDatabase, getPool } from "../../../../db/client";
import { materializeLegacyRoomSourceConnector } from "../../../environment-connectors/bindings";
import { listEnvironmentConnectorCapabilityDescriptors } from "../../../environment-connectors/catalog";
import {
  listRoomEnvironmentParticipantSubjectContexts,
  resolveRoomEnvironmentSubjectForProbe,
} from "../../../environment-connectors/subjects";
import { projectEnvironmentAdapterProducerEpoch } from "../../../situation-room/environment-adapter-admission-store";
import { resolveEnvironmentAdapterProfile } from "../../../situation-room/environment-adapter-registry";
import {
  recordEnvironmentSourceHeartbeat,
  resetEnvironmentSourceHeartbeatStoreForTest,
} from "../../../situation-room/environment-source-heartbeat-store";
import {
  createReadySharedRealtimeRoom,
  createSharedRealtimeRoomTestApp,
  resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent,
} from "./route-harness";
import { readSharedRealtimeRoomMembership } from "../room-store";
import { ensureOwnRoomEnvironmentSubject, refreshOwnRoomEnvironmentSubjectEpoch } from "../../../environment-connectors/subjects/subject-binding-store";

const SAME_ORIGIN_HEADERS = {
  Host: "casimirbot.test",
  Origin: "http://casimirbot.test",
  "Sec-Fetch-Site": "same-origin",
};

describe("Shared Realtime room environment subjects", () => {
  beforeEach(async () => {
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "1");
    resetEnvironmentSourceHeartbeatStoreForTest();
    await resetSharedRealtimeRoomRouteTestState();
  });

  afterEach(() => {
    resetEnvironmentSourceHeartbeatStoreForTest();
    vi.unstubAllEnvs();
  });

  it("lets two members bind different sanitized players and blocks duplicate or cross-member claims", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:environment-owner",
      displayName: "Environment Owner",
      accountType: "developer",
    });
    const guest = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:environment-guest",
      displayName: "Environment Guest",
      accountType: "developer",
    });
    const roomId = await createReadySharedRealtimeRoom({
      owner,
      guest,
      title: "Two-player Fabric room",
    });
    const ownerRoom = await owner.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}`)
      .expect(200);
    const guestRoom = await guest.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}`)
      .expect(200);
    const ownerParticipantId = ownerRoom.body.room.self_participant_id as string;
    const guestParticipantId = guestRoom.body.room.self_participant_id as string;

    await ensureDatabase();
    const bindingId = "room_source_binding:environment-subject-route";
    const credentialId = "room_source_credential:environment-subject-route";
    const sourceId = "source:room-ingress:environment-subject-route";
    const worldId = "minecraft:local:environment-subject-route";
    const domainAdapter = "minecraft.fabric_mod.v1";
    const producerEpoch = "environment-subject-route-epoch";
    const producerEpochRef = projectEnvironmentAdapterProducerEpoch({
      bindingId,
      producerEpoch,
    });
    const adapter = resolveEnvironmentAdapterProfile({
      domainAdapter,
      worldId,
    });
    const now = new Date();
    const admission: HelixEnvironmentAdapterAdmissionProjection = {
      schema: HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
      admission_id: "environment_adapter_admission:environment-subject-route",
      adapter_profile_id: adapter.profile.profile_id,
      adapter_profile_version: adapter.profile.profile_version,
      adapter_contract_hash: adapter.contract_hash,
      manifest_id: "manifest:environment-subject-route",
      manifest_hash: `sha256:${"a".repeat(64)}`,
      producer_epoch_ref: producerEpochRef,
      source_family: adapter.profile.source_family,
      mechanics_collection_ids: adapter.profile.mechanics_collections.map(
        (entry) => entry.collection_id,
      ),
      admitted_at: now.toISOString(),
      content_role: "adapter_admission_not_assistant_answer",
      reentry_required: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const db = getPool();
    await db.query(
      `
        INSERT INTO helix_room_source_bindings (
          binding_id, room_id, owner_profile_id, source_id, world_id,
          domain_adapter, source_label, scopes
        ) VALUES ($1, $2, $3, $4, $5, $6, 'Local Fabric 1.21.8', '[]'::jsonb);
      `,
      [bindingId, roomId, owner.profileId, sourceId, worldId, domainAdapter],
    );
    await db.query(
      `
        INSERT INTO helix_room_source_credentials (
          credential_id, binding_id, token_hash, token_prefix, expires_at
        ) VALUES ($1, $2, $3, 'test-only', $4);
      `,
      [
        credentialId,
        bindingId,
        crypto.createHash("sha256").update("test-only").digest("hex"),
        new Date(now.getTime() + 60_000).toISOString(),
      ],
    );
    await db.query(
      `
        INSERT INTO helix_environment_adapter_admissions (
          admission_id, binding_id, credential_id, producer_epoch, room_id,
          source_id, world_id, domain_adapter, adapter_profile_id,
          adapter_profile_version, adapter_contract_hash, manifest_id,
          manifest_hash, source_family, mechanics_collection_ids, admitted_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15::jsonb, $16
        );
      `,
      [
        admission.admission_id,
        bindingId,
        credentialId,
        producerEpoch,
        roomId,
        sourceId,
        worldId,
        domainAdapter,
        admission.adapter_profile_id,
        admission.adapter_profile_version,
        admission.adapter_contract_hash,
        admission.manifest_id,
        admission.manifest_hash,
        admission.source_family,
        JSON.stringify(admission.mechanics_collection_ids),
        admission.admitted_at,
      ],
    );
    const connector = await materializeLegacyRoomSourceConnector({
      ownerProfileId: owner.profileId,
      roomSourceBindingId: bindingId,
      credentialId,
      roomId,
      sourceId,
      worldId,
      producerEpochRef,
      adapterAdmission: admission,
      capabilityDescriptors: listEnvironmentConnectorCapabilityDescriptors({
        adapterProfileId: admission.adapter_profile_id,
      }),
    });
    const aliceNativeId = "123e4567-e89b-12d3-a456-426614174000";
    const bobNativeId = "123e4567-e89b-12d3-a456-426614174001";
    const heartbeat: HelixEnvironmentSourceHeartbeat = {
      schema: HELIX_ENVIRONMENT_SOURCE_HEARTBEAT_SCHEMA,
      heartbeat_id: "heartbeat:environment-subject-route",
      source_id: sourceId,
      room_id: roomId,
      domain: "minecraft",
      domain_adapter: domainAdapter,
      status: "active",
      active_players: [
        {
          actor_id: "minecraft:player:Alice",
          stable_actor_id: aliceNativeId,
          actor_label: "Alice",
          dimension: "minecraft:overworld",
        },
        {
          actor_id: "minecraft:player:Bob",
          stable_actor_id: bobNativeId,
          actor_label: "Bob",
          dimension: "minecraft:the_end",
        },
      ],
      evidence_refs: [bindingId, admission.admission_id],
      assistant_answer: false,
      raw_content_included: false,
      created_at: now.toISOString(),
    };
    const sourceAdmission: HelixRoomSourceAdmission = {
      schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
      transport: "room_source_ingress",
      binding_id: bindingId,
      request_id: "request:environment-subject-route",
      room_id: roomId,
      source_id: sourceId,
      world_id: worldId,
      domain_adapter: domainAdapter,
      adapter_admission: admission,
      evidence_refs: [
        bindingId,
        `room_source_request:${bindingId}:request:environment-subject-route`,
        admission.admission_id,
      ],
      content_role: "source_admission_not_assistant_answer",
      reentry_required: true,
      model_invoked: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    recordEnvironmentSourceHeartbeat(heartbeat, { sourceAdmission });

    const ownerList = await owner.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments`)
      .expect(200);
    const ownerEnvironment = ownerList.body.environments[0];
    expect(ownerEnvironment).toMatchObject({
      environment_binding_id: connector.environmentBindingId,
      domain_adapter: domainAdapter,
      connection_status: "active",
      identity_assignment: "binding_required",
      owner_controls_visible: true,
      self_subject_binding: null,
      subject_directory: {
        freshness: "fresh",
        subjects: [
          expect.objectContaining({ display_label: "Alice" }),
          expect.objectContaining({ display_label: "Bob" }),
        ],
      },
    });
    expect(JSON.stringify(ownerList.body)).not.toContain(aliceNativeId);
    expect(JSON.stringify(ownerList.body)).not.toContain(bobNativeId);

    const aliceRef = ownerEnvironment.subject_directory.subjects[0]
      .subject_ref as string;
    const bobRef = ownerEnvironment.subject_directory.subjects[1]
      .subject_ref as string;
    await owner.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .send({ subject_ref: aliceRef })
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe(
          "room_environment_cookie_cross_origin_forbidden",
        );
      });
    const ownerBound = await owner.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ subject_ref: aliceRef })
      .expect(200);
    expect(ownerBound.body.binding).toMatchObject({
      participant_id: ownerParticipantId,
      subject_label: "Alice",
      verification_method: "self_claim",
    });
    expect(JSON.stringify(ownerBound.body)).not.toContain(aliceNativeId);

    const commandAuthorityPath =
      `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}` +
      `/environments/${encodeURIComponent(connector.environmentBindingId)}` +
      "/command-authority";
    const configuredAuthority = await owner.agent
      .put(commandAuthorityPath)
      .set(SAME_ORIGIN_HEADERS)
      .send({
        authority_profile: "server_administrator",
        autonomy_mode: "autonomous",
        approved_categories: [],
        expires_at: null,
      })
      .expect(200);
    expect(configuredAuthority.body.member_grant.subject_binding_id).toBe(
      ownerBound.body.binding.subject_binding_id,
    );

    // Ready up must not implement verification by replacing a healthy binding.
    const ensureInput = { roomId, profileId: owner.profileId,
      environmentBindingId: connector.environmentBindingId, subjectRef: aliceRef };
    const bindingsBeforeEnsure = await db.query(
      "SELECT * FROM helix_room_environment_subject_bindings WHERE room_id=$1 ORDER BY subject_binding_id", [roomId]);
    for (let attempt = 0; attempt < 3; attempt++) {
      const retained = await ensureOwnRoomEnvironmentSubject(ensureInput);
      expect(retained.subject_binding_id).toBe(ownerBound.body.binding.subject_binding_id);
      expect(retained.verified_at).toBe(ownerBound.body.binding.verified_at);
      expect(retained.expires_at).toBe(ownerBound.body.binding.expires_at);
    }
    await expect(ensureOwnRoomEnvironmentSubject({ ...ensureInput, subjectRef: bobRef }))
      .rejects.toMatchObject({ code: "subject_binding_stale" });
    expect((await db.query(
      "SELECT * FROM helix_room_environment_subject_bindings WHERE room_id=$1 ORDER BY subject_binding_id", [roomId])).rows)
      .toEqual(bindingsBeforeEnsure.rows);
    await db.query("UPDATE helix_room_environment_subject_bindings SET expires_at=$2 WHERE subject_binding_id=$1",
      [ownerBound.body.binding.subject_binding_id, new Date(Date.now() - 1_000).toISOString()]);
    await expect(ensureOwnRoomEnvironmentSubject(ensureInput)).rejects.toMatchObject({ code: "subject_binding_stale" });
    await db.query("UPDATE helix_room_environment_subject_bindings SET expires_at=NULL WHERE subject_binding_id=$1",
      [ownerBound.body.binding.subject_binding_id]);
    const retainedAuthority = await owner.agent.get(commandAuthorityPath).set(SAME_ORIGIN_HEADERS).expect(200);
    expect(retainedAuthority.body.member_grant.subject_binding_id).toBe(ownerBound.body.binding.subject_binding_id);

    const ownerRebound = await owner.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ subject_ref: aliceRef })
      .expect(200);
    expect(ownerRebound.body.binding.subject_binding_id).not.toBe(
      ownerBound.body.binding.subject_binding_id,
    );
    const authorityAfterRebind = await owner.agent
      .get(commandAuthorityPath)
      .set(SAME_ORIGIN_HEADERS)
      .expect(200);
    expect(authorityAfterRebind.body.member_grant.subject_binding_id).toBe(
      ownerRebound.body.binding.subject_binding_id,
    );

    await guest.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ subject_ref: aliceRef })
      .expect(409)
      .expect((response) => {
        expect(response.body.error).toBe("subject_already_claimed");
      });
    await guest.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/participants/${encodeURIComponent(ownerParticipantId)}/subject`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ subject_ref: bobRef })
      .expect(403);
    const guestBound = await guest.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ subject_ref: bobRef })
      .expect(200);
    expect(guestBound.body.binding).toMatchObject({
      participant_id: guestParticipantId,
      subject_label: "Bob",
    });

    const guestList = await guest.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments`)
      .expect(200);
    expect(guestList.body.environments[0]).toMatchObject({
      owner_controls_visible: false,
      identity_assignment: "supported",
      self_subject_binding: {
        participant_id: guestParticipantId,
        subject_label: "Bob",
      },
    });
    expect(JSON.stringify(guestList.body)).not.toContain(aliceNativeId);
    expect(JSON.stringify(guestList.body)).not.toContain(bobNativeId);

    const renamedHeartbeat: HelixEnvironmentSourceHeartbeat = {
      ...heartbeat,
      heartbeat_id: "heartbeat:environment-subject-route:renamed",
      active_players: [
        heartbeat.active_players[0],
        {
          actor_id: "minecraft:player:Bobby",
          stable_actor_id: bobNativeId,
          actor_label: "Bobby",
          dimension: "minecraft:the_end",
        },
      ],
      created_at: new Date().toISOString(),
    };
    recordEnvironmentSourceHeartbeat(renamedHeartbeat, { sourceAdmission });
    const renamedGuestList = await guest.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments`)
      .expect(200);
    expect(renamedGuestList.body.environments[0]).toMatchObject({
      self_subject_binding: {
        participant_id: guestParticipantId,
        subject_label: "Bobby",
        status: "active",
      },
      subject_directory: {
        subjects: expect.arrayContaining([
          expect.objectContaining({ display_label: "Bobby" }),
        ]),
      },
    });

    const guestMembership = await readSharedRealtimeRoomMembership({
      roomId,
      profileId: guest.profileId,
    });
    expect(guestMembership).not.toBeNull();
    const resolvedAfterRename = await resolveRoomEnvironmentSubjectForProbe({
      membership: guestMembership!,
      environmentBindingId: connector.environmentBindingId,
      sourceId,
      worldId,
      producerEpochRef,
    });
    expect(resolvedAfterRename).toMatchObject({
      participantId: guestParticipantId,
      subjectLabel: "Bobby",
      subjectNativeId: bobNativeId,
    });
    expect(await listRoomEnvironmentParticipantSubjectContexts(roomId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participant_id: guestParticipantId,
          subject_label: "Bobby",
          status: "active",
        }),
      ]),
    );
    await expect(resolveRoomEnvironmentSubjectForProbe({
      membership: guestMembership!,
      environmentBindingId: connector.environmentBindingId,
      sourceId: "source:room-ingress:wrong",
      worldId,
      producerEpochRef,
    })).rejects.toMatchObject({ code: "wrong_environment" });
    await expect(resolveRoomEnvironmentSubjectForProbe({
      membership: guestMembership!,
      environmentBindingId: connector.environmentBindingId,
      sourceId,
      worldId: "minecraft:local:wrong-world",
      producerEpochRef,
    })).rejects.toMatchObject({ code: "wrong_world" });
    await expect(resolveRoomEnvironmentSubjectForProbe({
      membership: guestMembership!,
      environmentBindingId: connector.environmentBindingId,
      sourceId,
      worldId,
      producerEpochRef: "adapter_epoch:wrong",
    })).rejects.toMatchObject({ code: "producer_epoch_mismatch" });

    recordEnvironmentSourceHeartbeat({
      ...renamedHeartbeat,
      heartbeat_id: "heartbeat:environment-subject-route:offline",
      active_players: [heartbeat.active_players[0]],
      created_at: new Date().toISOString(),
    }, { sourceAdmission });
    await expect(resolveRoomEnvironmentSubjectForProbe({
      membership: guestMembership!,
      environmentBindingId: connector.environmentBindingId,
      sourceId,
      worldId,
      producerEpochRef,
    })).rejects.toMatchObject({ code: "subject_offline" });

    recordEnvironmentSourceHeartbeat({
      ...renamedHeartbeat,
      heartbeat_id: "heartbeat:environment-subject-route:stale",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }, { sourceAdmission });
    await expect(resolveRoomEnvironmentSubjectForProbe({
      membership: guestMembership!,
      environmentBindingId: connector.environmentBindingId,
      sourceId,
      worldId,
      producerEpochRef,
    })).rejects.toMatchObject({ code: "subject_binding_stale" });

    recordEnvironmentSourceHeartbeat({
      ...renamedHeartbeat,
      heartbeat_id: "heartbeat:environment-subject-route:restored",
      created_at: new Date().toISOString(),
    }, { sourceAdmission });
    await guest.agent
      .delete(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .expect(200)
      .expect((response) => {
        expect(response.body.binding).toBeNull();
      });
    const ownerAssigned = await owner.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/participants/${encodeURIComponent(guestParticipantId)}/subject`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ subject_ref: bobRef })
      .expect(200);
    expect(ownerAssigned.body.binding).toMatchObject({
      participant_id: guestParticipantId,
      subject_label: "Bobby",
      verification_method: "owner_assigned",
      status: "active",
    });
    expect(JSON.stringify(ownerAssigned.body)).not.toContain(bobNativeId);

    const restartedProducerEpoch = `${producerEpoch}-restarted`;
    const restartedProducerEpochRef = projectEnvironmentAdapterProducerEpoch({
      bindingId,
      producerEpoch: restartedProducerEpoch,
    });
    const restartedAdmission: HelixEnvironmentAdapterAdmissionProjection = {
      ...admission,
      admission_id: `${admission.admission_id}-restarted`,
      manifest_id: `${admission.manifest_id}-restarted`,
      manifest_hash: `sha256:${"c".repeat(64)}`,
      producer_epoch_ref: restartedProducerEpochRef,
      admitted_at: new Date().toISOString(),
    };
    await db.query(
      `
        INSERT INTO helix_environment_adapter_admissions (
          admission_id, binding_id, credential_id, producer_epoch, room_id,
          source_id, world_id, domain_adapter, adapter_profile_id,
          adapter_profile_version, adapter_contract_hash, manifest_id,
          manifest_hash, source_family, mechanics_collection_ids, admitted_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15::jsonb, $16
        );
      `,
      [
        restartedAdmission.admission_id,
        bindingId,
        credentialId,
        restartedProducerEpoch,
        roomId,
        sourceId,
        worldId,
        domainAdapter,
        restartedAdmission.adapter_profile_id,
        restartedAdmission.adapter_profile_version,
        restartedAdmission.adapter_contract_hash,
        restartedAdmission.manifest_id,
        restartedAdmission.manifest_hash,
        restartedAdmission.source_family,
        JSON.stringify(restartedAdmission.mechanics_collection_ids),
        restartedAdmission.admitted_at,
      ],
    );
    const restartedConnector = await materializeLegacyRoomSourceConnector({
      ownerProfileId: owner.profileId,
      roomSourceBindingId: bindingId,
      credentialId,
      roomId,
      sourceId,
      worldId,
      producerEpochRef: restartedProducerEpochRef,
      adapterAdmission: restartedAdmission,
      capabilityDescriptors: listEnvironmentConnectorCapabilityDescriptors({
        adapterProfileId: restartedAdmission.adapter_profile_id,
      }),
    });
    expect(restartedConnector.environmentBindingId).toBe(
      connector.environmentBindingId,
    );
    const restartedHeartbeat: HelixEnvironmentSourceHeartbeat = {
      ...renamedHeartbeat,
      heartbeat_id: "heartbeat:environment-subject-route:restarted",
      created_at: new Date().toISOString(),
    };
    recordEnvironmentSourceHeartbeat(restartedHeartbeat, {
      sourceAdmission: {
        ...sourceAdmission,
        request_id: "request:environment-subject-route:restarted",
        adapter_admission: restartedAdmission,
        evidence_refs: [
          bindingId,
          `room_source_request:${bindingId}:request:environment-subject-route:restarted`,
          restartedAdmission.admission_id,
        ],
      },
    });

    const staleOwnerList = await owner.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments`)
      .expect(200);
    expect(staleOwnerList.body.environments[0]).toMatchObject({
      identity_assignment: "reverification_required",
      self_subject_binding: {
        subject_label: "Alice",
        status: "stale",
        producer_epoch_ref: producerEpochRef,
      },
    });
    const ownerMembership = await readSharedRealtimeRoomMembership({
      roomId,
      profileId: owner.profileId,
    });
    expect(ownerMembership).not.toBeNull();
    await expect(resolveRoomEnvironmentSubjectForProbe({
      membership: ownerMembership!,
      environmentBindingId: connector.environmentBindingId,
      sourceId,
      worldId,
      producerEpochRef: restartedProducerEpochRef,
    })).rejects.toMatchObject({ code: "producer_epoch_mismatch" });

    await expect(ensureOwnRoomEnvironmentSubject(ensureInput)).rejects.toMatchObject({ code: "subject_binding_stale" });
    const refreshInput = { ...ensureInput, subjectBindingId: ownerRebound.body.binding.subject_binding_id,
      expectedProducerEpochRef: producerEpochRef };
    await expect(refreshOwnRoomEnvironmentSubjectEpoch({ ...refreshInput, subjectBindingId: "binding:wrong" }))
      .rejects.toMatchObject({ code: "subject_binding_stale" });
    await expect(refreshOwnRoomEnvironmentSubjectEpoch({ ...refreshInput, expectedProducerEpochRef: "epoch:wrong" }))
      .rejects.toMatchObject({ code: "subject_binding_stale" });
    for (let attempt = 0; attempt < 3; attempt++) {
      const refreshed = await refreshOwnRoomEnvironmentSubjectEpoch(refreshInput);
      expect(refreshed).toMatchObject({
        subject_binding_id: ownerRebound.body.binding.subject_binding_id,
        producer_epoch_ref: restartedProducerEpochRef,
        verified_at: ownerRebound.body.binding.verified_at,
        expires_at: ownerRebound.body.binding.expires_at,
      });
    }
    const refreshedEvents = await db.query(
      "SELECT * FROM helix_shared_realtime_room_events WHERE room_id=$1 AND event_type='environment_subject_epoch_refreshed'", [roomId]);
    expect(refreshedEvents.rows).toHaveLength(1);
    const renewedOwner = await owner.agent
      .put(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ subject_ref: aliceRef })
      .expect(200);
    expect(renewedOwner.body.binding).toMatchObject({
      subject_label: "Alice",
      status: "active",
      producer_epoch_ref: restartedProducerEpochRef,
    });
    const renewedOwnerList = await owner.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments`)
      .expect(200);
    expect(renewedOwnerList.body.environments[0]).toMatchObject({
      identity_assignment: "supported",
      self_subject_binding: {
        subject_label: "Alice",
        status: "active",
        producer_epoch_ref: restartedProducerEpochRef,
      },
    });

    await owner.agent
      .delete(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/environments/${encodeURIComponent(connector.environmentBindingId)}/me`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .expect(200);
    const authorityAfterRevoke = await owner.agent
      .get(commandAuthorityPath)
      .set(SAME_ORIGIN_HEADERS)
      .expect(200);
    expect(authorityAfterRevoke.body.member_grant.subject_binding_id).toBeNull();
    await expect(ensureOwnRoomEnvironmentSubject(ensureInput)).rejects.toMatchObject({ code: "subject_binding_stale" });
  });
});
