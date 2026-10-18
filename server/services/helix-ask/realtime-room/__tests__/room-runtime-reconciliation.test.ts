import { beforeEach, describe, expect, it } from "vitest";
import { reconcileSharedRealtimeRoomRuntimeAfterLeave } from
  "../room-runtime-reconciliation";
import {
  bindSharedRealtimeRoomAdmittedSession,
  claimSharedRealtimeRoomSpeakerFloor,
  markSharedRealtimeRoomTransportActive,
  promoteSharedRealtimeRoomMediaBridge,
  readSharedRealtimeRoomRuntime,
  reserveSharedRealtimeRoomRuntime,
  resetSharedRealtimeRoomRuntimeRegistryForTests,
} from "../runtime-registry";

describe("shared room runtime leave reconciliation", () => {
  beforeEach(() => resetSharedRealtimeRoomRuntimeRegistryForTests());

  it("clears a departing participant's floor before degrading the shared call", () => {
    const roomId = "room:leave-floor";
    const reservation = reserveSharedRealtimeRoomRuntime({
      roomId,
      reservedByParticipantId: "participant:owner",
      model: "gpt-realtime-2.1",
      transportOwner: "host_browser",
    });
    const runtimeId = reservation.runtime?.runtime_id as string;
    expect(bindSharedRealtimeRoomAdmittedSession({
      roomId,
      runtimeId,
      realtimeSessionId: "realtime:leave-floor",
    }).ok).toBe(true);
    expect(markSharedRealtimeRoomTransportActive({
      roomId,
      runtimeId,
      transportOwner: "host_browser",
    }).ok).toBe(true);
    expect(promoteSharedRealtimeRoomMediaBridge({ roomId, runtimeId }).ok).toBe(true);
    expect(claimSharedRealtimeRoomSpeakerFloor({
      roomId,
      runtimeId,
      participantId: "participant:guest",
      microphoneToModelAuthorized: true,
    }).granted).toBe(true);

    reconcileSharedRealtimeRoomRuntimeAfterLeave({
      roomId,
      memberRole: "participant",
      participantId: "participant:guest",
      requesterSessionId: "session:guest",
    });

    expect(readSharedRealtimeRoomRuntime({ roomId })).toMatchObject({
      state: "degraded",
      active_speaker_participant_id: null,
    });
  });
});
