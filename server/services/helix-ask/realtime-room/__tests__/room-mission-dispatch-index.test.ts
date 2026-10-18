import { beforeEach, describe, expect, it } from "vitest";
import { reserveRoomMissionDispatch, completeRoomMissionDispatch,
  listRoomMissionDispatches } from "../../../local-supervisor/room-mission-dispatch-index";
import type { RoomExternalMission } from "../../../local-supervisor/room-external-mission-store";
import type { HelixReasoningSteeringEventProjection } from "@shared/helix-reasoning-task-binding";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "./route-harness";

beforeEach(resetSharedRealtimeRoomRouteTestState);

describe("room mission non-content dispatch index", () => {
  it("keeps an exact unconfirmed intent, then records one returned steering reference", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:index-owner",
      displayName: "Owner", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Indexed mission" }).expect(201)).body.room;
    const mission = { schema: "helix.room_external_mission.v1", room_id: room.room_id,
      owner_profile_id: owner.profileId, owner_participant_id: room.self_participant_id,
      mission_id: "room_mission:index", mission_revision: 1, status: "active",
      reasoning_binding_id: "reasoning_binding:index", binding_epoch: 1,
      helix_conversation_id: "chat:index", binding_mission_id: null, run_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), revoked_at: null,
      execution_authority: false, answer_authority: false, terminal_eligible: false } as RoomExternalMission;
    const scope = { roomId: room.room_id as string, ownerProfileId: owner.profileId,
      missionId: mission.mission_id, missionRevision: 1,
      bindingId: mission.reasoning_binding_id, bindingEpoch: 1 };
    const reservationInput = { mission, speakerParticipantId: room.self_participant_id as string,
      clientEventRef: "room-handoff:index", instructionOrigin: "gpt_live_finalized" as const,
      instructionSha256: "a".repeat(64), instructionLength: 12 };
    const pending = await reserveRoomMissionDispatch(reservationInput);
    expect(pending).toMatchObject({ status: "pending", steering_event_ref: null,
      instruction_sha256: "a".repeat(64) });
    expect(await reserveRoomMissionDispatch(reservationInput)).toEqual(pending);
    expect(await listRoomMissionDispatches(scope)).toEqual([pending]);
    const event = { schema: "helix.reasoning_steering_event.v1", steering_event_ref: "reasoning_steering:index",
      reasoning_binding_id: mission.reasoning_binding_id, binding_epoch: 1, cursor: 1,
      client_event_ref: reservationInput.clientEventRef, origin: "gpt_live_finalized", delivery_state: "pending",
      instruction_sha256: reservationInput.instructionSha256, instruction_length: 12,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(),
      acknowledged_at: null, advisory_only: true, execution_requested: false,
      evidence_satisfied: false, provider_thread_content_included: false, hidden_reasoning_included: false,
      answer_authority: false, terminal_eligible: false } as HelixReasoningSteeringEventProjection;
    const queued = await completeRoomMissionDispatch({ reservation: pending, event });
    expect(queued).toMatchObject({ status: "queued", steering_event_ref: event.steering_event_ref });
    expect(await completeRoomMissionDispatch({ reservation: pending, event })).toEqual(queued);
    expect(await listRoomMissionDispatches(scope)).toEqual([queued]);
    expect(await listRoomMissionDispatches({ ...scope, missionRevision: 2 })).toEqual([]);
    expect(await listRoomMissionDispatches({ ...scope, ownerProfileId: "profile:another" })).toEqual([]);
    expect(JSON.stringify(queued)).not.toContain("instruction text");
    await expect(reserveRoomMissionDispatch({ ...reservationInput, instructionSha256: "b".repeat(64) }))
      .rejects.toMatchObject({ code: "room_mission_dispatch_identity_mismatch" });
    await expect(reserveRoomMissionDispatch({ ...reservationInput, instructionOrigin: "typed" }))
      .rejects.toMatchObject({ code: "room_mission_dispatch_identity_mismatch" });
    await expect(completeRoomMissionDispatch({ reservation: pending,
      event: { ...event, origin: "typed" } }))
      .rejects.toMatchObject({ code: "room_mission_dispatch_identity_mismatch" });
    await expect(completeRoomMissionDispatch({ reservation: pending,
      event: { ...event, instruction_sha256: "b".repeat(64) } }))
      .rejects.toMatchObject({ code: "room_mission_dispatch_identity_mismatch" });
  });
});
