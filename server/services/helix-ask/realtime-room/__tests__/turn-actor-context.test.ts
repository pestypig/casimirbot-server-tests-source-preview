import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bindSharedRealtimeRoomAdmittedSession,
  claimSharedRealtimeRoomSpeakerFloor,
  markSharedRealtimeRoomTransportActive,
  promoteSharedRealtimeRoomMediaBridge,
  releaseSharedRealtimeRoomSpeakerFloor,
  reserveSharedRealtimeRoomRuntime,
} from "../runtime-registry";
import { resolveRealtimeRoomTurnActorContext } from "../turn-actor-context";
import {
  createReadySharedRealtimeRoom,
  createSharedRealtimeRoomTestApp,
  resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent,
} from "./route-harness";

describe("Realtime room turn actor context", () => {
  beforeEach(async () => {
    await resetSharedRealtimeRoomRouteTestState();
  });

  afterEach(async () => {
    await resetSharedRealtimeRoomRouteTestState();
  });

  it("freezes the active room speaker and does not relabel an unclaimed floor as the host", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:turn-actor-owner",
      displayName: "Turn Actor Owner",
      accountType: "developer",
    });
    const guest = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:turn-actor-guest",
      displayName: "Turn Actor Guest",
      accountType: "developer",
    });
    const roomId = await createReadySharedRealtimeRoom({
      owner,
      guest,
      title: "Turn actor room",
    });
    const ownerRoom = await owner.agent
      .get(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}`)
      .expect(200);
    const ownerParticipantId = ownerRoom.body.room.self_participant_id as string;
    const guestParticipantId = ownerRoom.body.room.participants.find(
      (participant: { participant_id: string }) =>
        participant.participant_id !== ownerParticipantId,
    ).participant_id as string;
    const reserved = reserveSharedRealtimeRoomRuntime({
      roomId,
      reservedByParticipantId: ownerParticipantId,
      model: "gpt-realtime-2.1",
      transportOwner: "host_browser",
      nowMs: 1_000,
    });
    const runtimeId = reserved.runtime?.runtime_id as string;
    bindSharedRealtimeRoomAdmittedSession({
      roomId,
      runtimeId,
      realtimeSessionId: "realtime:turn-actor",
      nowMs: 1_010,
    });
    markSharedRealtimeRoomTransportActive({
      roomId,
      runtimeId,
      transportOwner: "host_browser",
      nowMs: 1_020,
    });
    promoteSharedRealtimeRoomMediaBridge({ roomId, runtimeId, nowMs: 1_020 });
    const floor = claimSharedRealtimeRoomSpeakerFloor({
      roomId,
      runtimeId,
      participantId: guestParticipantId,
      microphoneToModelAuthorized: true,
      nowMs: 1_030,
    });
    expect(floor.granted).toBe(true);

    const guestSpeaker = await resolveRealtimeRoomTurnActorContext({
      threadId: `helix-ask:room:${roomId}`,
      requesterProfileId: owner.profileId,
      realtimeSessionId: "realtime:turn-actor",
      nowMs: 1_040,
    });
    expect(guestSpeaker).toMatchObject({
      room_id: roomId,
      requester_profile_id: owner.profileId,
      participant_id: guestParticipantId,
      resolution: "resolved",
      resolution_source: "active_speaker_floor",
    });

    releaseSharedRealtimeRoomSpeakerFloor({
      roomId,
      runtimeId,
      participantId: guestParticipantId,
      epoch: floor.floor?.epoch,
      nowMs: 1_050,
    });
    const ownerMicrophone = await resolveRealtimeRoomTurnActorContext({
      threadId: `helix-ask:room:${roomId}`,
      requesterProfileId: owner.profileId,
      realtimeSessionId: "realtime:turn-actor",
      nowMs: 1_060,
    });
    expect(ownerMicrophone).toMatchObject({
      participant_id: null,
      resolution: "unavailable",
      resolution_source: "speaker_unavailable",
    });
  });

  it("does not manufacture a room actor for an ordinary Ask thread", async () => {
    await expect(resolveRealtimeRoomTurnActorContext({
      threadId: "helix-ask:desktop",
      requesterProfileId: "profile:any",
      realtimeSessionId: "realtime:any",
    })).resolves.toBeNull();
  });
});
