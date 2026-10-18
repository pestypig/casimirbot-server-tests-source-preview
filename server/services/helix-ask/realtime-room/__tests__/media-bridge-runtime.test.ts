import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSharedRealtimeRoomMediaSignals,
  publishSharedRealtimeRoomMediaSignal,
  readSharedRealtimeRoomMediaSignals,
} from "../media-signal-mailbox";
import {
  bindSharedRealtimeRoomAdmittedSession,
  claimSharedRealtimeRoomSpeakerFloor,
  demoteSharedRealtimeRoomMediaBridge,
  markSharedRealtimeRoomTransportActive,
  promoteSharedRealtimeRoomMediaBridge,
  readSharedRealtimeRoomRuntime,
  reserveSharedRealtimeRoomRuntime,
  resetSharedRealtimeRoomRuntimeRegistryForTests,
} from "../runtime-registry";

const ROOM_ID = "room-media-runtime";

beforeEach(() => {
  resetSharedRealtimeRoomRuntimeRegistryForTests();
  clearSharedRealtimeRoomMediaSignals(ROOM_ID);
});

describe("shared-room media runtime lifecycle", () => {
  it("promotes one bound call, admits participant floor, and recovers to host transport", () => {
    const reservation = reserveSharedRealtimeRoomRuntime({
      roomId: ROOM_ID,
      reservedByParticipantId: "owner",
      model: "gpt-realtime-2.1",
      transportOwner: "host_browser",
    });
    const runtimeId = reservation.runtime?.runtime_id as string;
    expect(bindSharedRealtimeRoomAdmittedSession({
      roomId: ROOM_ID,
      runtimeId,
      realtimeSessionId: "realtime-media-runtime",
    }).ok).toBe(true);
    expect(markSharedRealtimeRoomTransportActive({
      roomId: ROOM_ID,
      runtimeId,
      transportOwner: "host_browser",
    }).ok).toBe(true);
    expect(promoteSharedRealtimeRoomMediaBridge({ roomId: ROOM_ID, runtimeId }).runtime)
      .toMatchObject({ state: "bridge_active", transport_owner: "room_media_bridge" });
    expect(promoteSharedRealtimeRoomMediaBridge({ roomId: ROOM_ID, runtimeId }).ok)
      .toBe(true);
    expect(claimSharedRealtimeRoomSpeakerFloor({
      roomId: ROOM_ID,
      runtimeId,
      participantId: "participant",
      microphoneToModelAuthorized: true,
    }).granted).toBe(true);
    expect(demoteSharedRealtimeRoomMediaBridge({ roomId: ROOM_ID, runtimeId }).runtime)
      .toMatchObject({
        state: "host_transport_active",
        transport_owner: "host_browser",
        active_speaker_participant_id: null,
      });
    expect(demoteSharedRealtimeRoomMediaBridge({ roomId: ROOM_ID, runtimeId }).ok)
      .toBe(true);
    expect(promoteSharedRealtimeRoomMediaBridge({ roomId: ROOM_ID, runtimeId }).ok).toBe(true);
  });

  it("keeps signaling targeted, cursor-bounded, and expired signals unavailable", () => {
    const first = publishSharedRealtimeRoomMediaSignal({
      roomId: ROOM_ID,
      runtimeId: "runtime",
      negotiationId: "negotiation:current",
      senderParticipantId: "owner",
      targetParticipantId: "participant",
      kind: "offer",
      description: { type: "offer", sdp: "offer-sdp" },
      candidate: null,
      nowMs: 1_000,
    });
    const second = publishSharedRealtimeRoomMediaSignal({
      roomId: ROOM_ID,
      runtimeId: "runtime",
      negotiationId: "negotiation:current",
      senderParticipantId: "participant",
      targetParticipantId: "owner",
      kind: "answer",
      description: { type: "answer", sdp: "answer-sdp" },
      candidate: null,
      nowMs: 1_100,
    });
    expect(readSharedRealtimeRoomMediaSignals({
      roomId: ROOM_ID,
      targetParticipantId: "participant",
      nowMs: 1_200,
    }).map((signal) => signal.signal_id)).toEqual([first.signal_id]);
    expect(readSharedRealtimeRoomMediaSignals({
      roomId: ROOM_ID,
      targetParticipantId: "owner",
      afterSignalId: first.signal_id,
      nowMs: 1_200,
    }).map((signal) => signal.signal_id)).toEqual([second.signal_id]);
    expect(readSharedRealtimeRoomMediaSignals({
      roomId: ROOM_ID,
      targetParticipantId: "participant",
      nowMs: 1_000 + 2 * 60_000 + 1,
    })).toEqual([]);
    expect(readSharedRealtimeRoomRuntime({ roomId: ROOM_ID })).toBeNull();
  });
});
