import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDefaultHelixSharedRealtimeRoomConsent,
  type HelixSharedRealtimeRoom,
} from "@shared/helix-shared-realtime-room";
import {
  SHARED_REALTIME_ROOM_FRAME_TTL_MS,
  SHARED_REALTIME_ROOM_MAX_PROVIDER_ITEMS,
  SHARED_REALTIME_ROOM_MAX_VISUAL_FRAMES,
  admitSharedRealtimeRoomVisualFrame,
  bindSharedRealtimeRoomAdmittedSession,
  bindSharedRealtimeRoomProviderCall,
  buildSharedRealtimeRoomRuntimeDebugProjection,
  claimSharedRealtimeRoomSpeakerFloor,
  listSharedRealtimeRoomVisualFrames,
  markSharedRealtimeRoomTransportActive,
  readSharedRealtimeRoomRuntime,
  releaseSharedRealtimeRoomSpeakerFloor,
  reserveSharedRealtimeRoomRuntime,
  resetSharedRealtimeRoomRuntimeRegistryForTests,
  updateSharedRealtimeRoomVisualFrameProviderDelivery,
} from "../runtime-registry";

const ROOM_ID = "room:shared-runtime-test";
const START_MS = Date.parse("2026-07-21T12:00:00.000Z");

describe("shared Realtime room runtime registry", () => {
  beforeEach(() => resetSharedRealtimeRoomRuntimeRegistryForTests());

  it("atomically reserves one shared-model runtime and binds only one session and call", () => {
    const first = reserveSharedRealtimeRoomRuntime({
      roomId: ROOM_ID,
      reservedByParticipantId: "participant:owner",
      model: "gpt-realtime-2.1",
      transportOwner: "host_browser",
      nowMs: START_MS,
    });
    const repeated = reserveSharedRealtimeRoomRuntime({
      roomId: ROOM_ID,
      reservedByParticipantId: "participant:guest",
      model: "gpt-realtime-2.1",
      transportOwner: "host_browser",
      nowMs: START_MS + 1,
    });
    const conflict = reserveSharedRealtimeRoomRuntime({
      roomId: ROOM_ID,
      reservedByParticipantId: "participant:guest",
      model: "another-model",
      transportOwner: "room_media_bridge",
      nowMs: START_MS + 2,
    });

    expect(first).toMatchObject({ ok: true, created: true });
    expect(repeated).toMatchObject({ ok: true, created: false });
    expect(repeated.runtime?.runtime_id).toBe(first.runtime?.runtime_id);
    expect(conflict).toMatchObject({
      ok: false,
      error: "shared_realtime_room_runtime_conflict",
      created: false,
    });
    expect(first.runtime).toMatchObject({
      topology: "single_shared_model",
      transport_owner: "host_browser",
      state: "reserved",
    });
    expect(first.runtime?.limitations).toContain(
      "host_browser_transport_is_one_provider_peer_not_room_media_fanout",
    );

    const runtimeId = first.runtime!.runtime_id!;
    expect(bindSharedRealtimeRoomAdmittedSession({
      roomId: ROOM_ID,
      runtimeId,
      realtimeSessionId: "realtime:one",
      nowMs: START_MS + 3,
    }).ok).toBe(true);
    expect(bindSharedRealtimeRoomAdmittedSession({
      roomId: ROOM_ID,
      runtimeId,
      realtimeSessionId: "realtime:two",
      nowMs: START_MS + 4,
    })).toMatchObject({ ok: false, error: "shared_realtime_room_runtime_conflict" });
    expect(bindSharedRealtimeRoomProviderCall({
      roomId: ROOM_ID,
      runtimeId,
      providerCallId: "rtc_private_one",
      nowMs: START_MS + 5,
    }).ok).toBe(true);
    expect(bindSharedRealtimeRoomProviderCall({
      roomId: ROOM_ID,
      runtimeId,
      providerCallId: "rtc_private_two",
      nowMs: START_MS + 6,
    })).toMatchObject({ ok: false, error: "shared_realtime_room_runtime_conflict" });
    expect(markSharedRealtimeRoomTransportActive({
      roomId: ROOM_ID,
      runtimeId,
      transportOwner: "host_browser",
      nowMs: START_MS + 7,
    })).toMatchObject({ ok: true, runtime: { state: "host_transport_active" } });
  });

  it("keeps membership presence outside the registry and leases one consented speaker floor", () => {
    const reservation = reserveSharedRealtimeRoomRuntime({
      roomId: ROOM_ID,
      reservedByParticipantId: "participant:owner",
      model: "gpt-realtime-2.1",
      transportOwner: "room_media_bridge",
      nowMs: START_MS,
    });
    const runtimeId = reservation.runtime!.runtime_id!;
    bindSharedRealtimeRoomAdmittedSession({
      roomId: ROOM_ID,
      runtimeId,
      realtimeSessionId: "realtime:bridge",
      nowMs: START_MS,
    });
    markSharedRealtimeRoomTransportActive({
      roomId: ROOM_ID,
      runtimeId,
      transportOwner: "room_media_bridge",
      nowMs: START_MS,
    });

    expect(claimSharedRealtimeRoomSpeakerFloor({
      roomId: ROOM_ID,
      runtimeId,
      participantId: "participant:owner",
      microphoneToModelAuthorized: false,
      nowMs: START_MS,
    })).toMatchObject({
      ok: false,
      granted: false,
      error: "shared_realtime_room_consent_required",
    });
    const ownerFloor = claimSharedRealtimeRoomSpeakerFloor({
      roomId: ROOM_ID,
      runtimeId,
      participantId: "participant:owner",
      microphoneToModelAuthorized: true,
      leaseMs: 1_000,
      nowMs: START_MS,
    });
    expect(ownerFloor).toMatchObject({ ok: true, granted: true });
    expect(ownerFloor.floor?.epoch).toBe(1);
    expect(claimSharedRealtimeRoomSpeakerFloor({
      roomId: ROOM_ID,
      runtimeId,
      participantId: "participant:guest",
      microphoneToModelAuthorized: true,
      nowMs: START_MS + 500,
    })).toMatchObject({
      ok: false,
      granted: false,
      error: "shared_realtime_room_runtime_conflict",
    });

    const guestFloor = claimSharedRealtimeRoomSpeakerFloor({
      roomId: ROOM_ID,
      runtimeId,
      participantId: "participant:guest",
      microphoneToModelAuthorized: true,
      nowMs: START_MS + 1_001,
    });
    expect(guestFloor).toMatchObject({ ok: true, granted: true });
    expect(guestFloor.floor?.epoch).toBe(2);
    expect(releaseSharedRealtimeRoomSpeakerFloor({
      roomId: ROOM_ID,
      runtimeId,
      participantId: "participant:guest",
      epoch: 1,
      nowMs: START_MS + 1_002,
    }).released).toBe(false);
    expect(releaseSharedRealtimeRoomSpeakerFloor({
      roomId: ROOM_ID,
      runtimeId,
      participantId: "participant:guest",
      epoch: 2,
      nowMs: START_MS + 1_003,
    }).released).toBe(true);
  });

  it("bounds visual metadata and provider items while retaining only authorized thumbnails", () => {
    const reservation = reserveSharedRealtimeRoomRuntime({
      roomId: ROOM_ID,
      reservedByParticipantId: "participant:owner",
      model: "gpt-realtime-2.1",
      transportOwner: "room_media_bridge",
      nowMs: START_MS,
    });
    const runtimeId = reservation.runtime!.runtime_id!;
    bindSharedRealtimeRoomAdmittedSession({
      roomId: ROOM_ID,
      runtimeId,
      realtimeSessionId: "realtime:visual",
      nowMs: START_MS,
    });
    bindSharedRealtimeRoomProviderCall({
      roomId: ROOM_ID,
      runtimeId,
      providerCallId: "rtc_visual_private",
      nowMs: START_MS,
    });

    const providerItemIds: string[] = [];
    let prunedProviderItemId: string | null = null;
    for (let index = 0; index < SHARED_REALTIME_ROOM_MAX_PROVIDER_ITEMS + 1; index += 1) {
      const admitted = admitSharedRealtimeRoomVisualFrame({
        roomId: ROOM_ID,
        participantId: index % 2 ? "participant:guest" : "participant:owner",
        participantDisplayName: index % 2 ? "Guest" : "Owner",
        sourceId: `screen:${index % 2}`,
        sourceSurface: "screen_share_window",
        sequence: index,
        capturedAtMs: START_MS + index,
        imageHash: `sha256:image-${index}`,
        consentReceiptRef: "consent:screen-private",
        screenToModelAuthorized: true,
        thumbnailToRoomAuthorized: true,
        authorizedThumbnailDataUrl: "data:image/png;base64,aGVsbG8=",
        providerDeliveryAvailable: true,
        nowMs: START_MS + index,
      });
      expect(admitted.ok).toBe(true);
      providerItemIds.push(admitted.providerItemId!);
      prunedProviderItemId = admitted.prunedProviderItemId;
    }
    expect(prunedProviderItemId).toBe(providerItemIds[0]);

    const latest = listSharedRealtimeRoomVisualFrames({
      roomId: ROOM_ID,
      includeAuthorizedThumbnails: true,
      nowMs: START_MS + 100,
    }).at(-1)!;
    expect(latest.preview_data_url).toBe("data:image/png;base64,aGVsbG8=");
    expect(listSharedRealtimeRoomVisualFrames({
      roomId: ROOM_ID,
      includeAuthorizedThumbnails: false,
      nowMs: START_MS + 100,
    }).at(-1)).toMatchObject({ preview_data_url: null, raw_content_included: false });
    expect(updateSharedRealtimeRoomVisualFrameProviderDelivery({
      roomId: ROOM_ID,
      frameRef: latest.frame_ref,
      providerItemId: providerItemIds.at(-1)!,
      delivery: "sent_to_shared_model",
      nowMs: START_MS + 100,
    })).toMatchObject({ provider_delivery: "sent_to_shared_model" });

    for (let index = 7; index < 26; index += 1) {
      admitSharedRealtimeRoomVisualFrame({
        roomId: ROOM_ID,
        participantId: "participant:owner",
        participantDisplayName: "Owner",
        sourceId: "screen:owner",
        sourceSurface: "screen_share_window",
        sequence: index,
        capturedAtMs: START_MS + index,
        imageHash: `sha256:image-${index}`,
        consentReceiptRef: "consent:screen-private",
        screenToModelAuthorized: true,
        thumbnailToRoomAuthorized: false,
        providerDeliveryAvailable: false,
        nowMs: START_MS + index,
      });
    }
    expect(listSharedRealtimeRoomVisualFrames({
      roomId: ROOM_ID,
      nowMs: START_MS + 100,
    })).toHaveLength(SHARED_REALTIME_ROOM_MAX_VISUAL_FRAMES);
    expect(listSharedRealtimeRoomVisualFrames({
      roomId: ROOM_ID,
      nowMs: START_MS + SHARED_REALTIME_ROOM_FRAME_TTL_MS + 100,
    })).toHaveLength(0);
  });

  it("builds metadata-only debug evidence with hashes and no private transport or thumbnail data", () => {
    const reservation = reserveSharedRealtimeRoomRuntime({
      roomId: ROOM_ID,
      reservedByParticipantId: "participant:owner",
      model: "gpt-realtime-2.1",
      transportOwner: "host_browser",
      nowMs: START_MS,
    });
    const runtimeId = reservation.runtime!.runtime_id!;
    bindSharedRealtimeRoomAdmittedSession({
      roomId: ROOM_ID,
      runtimeId,
      realtimeSessionId: "realtime-private-session-id",
      nowMs: START_MS,
    });
    bindSharedRealtimeRoomProviderCall({
      roomId: ROOM_ID,
      runtimeId,
      providerCallId: "rtc_private_provider_call",
      nowMs: START_MS,
    });
    admitSharedRealtimeRoomVisualFrame({
      roomId: ROOM_ID,
      participantId: "participant:owner",
      participantDisplayName: "Private Display Name",
      sourceId: "screen:owner",
      sourceSurface: "screen_share_window",
      sequence: 1,
      capturedAtMs: START_MS,
      imageHash: "sha256:debug-frame",
      consentReceiptRef: "raw-private-frame-consent",
      screenToModelAuthorized: true,
      thumbnailToRoomAuthorized: true,
      authorizedThumbnailDataUrl: "data:image/png;base64,cHJpdmF0ZQ==",
      providerDeliveryAvailable: true,
      nowMs: START_MS,
    });

    const consent = {
      ...buildDefaultHelixSharedRealtimeRoomConsent(),
      microphone_to_model: true,
      consent_version: 1,
      consent_receipt_ref: "raw-private-room-consent",
      updated_at: new Date(START_MS).toISOString(),
    };
    const runtime = readSharedRealtimeRoomRuntime({ roomId: ROOM_ID, nowMs: START_MS })!;
    const room: HelixSharedRealtimeRoom = {
      schema: "helix.shared_realtime_room.v1",
      room_id: ROOM_ID,
      title: "Test room",
      status: "active",
      max_participants: 2,
      self_participant_id: "participant:owner",
      participants: [{
        participant_id: "participant:owner",
        display_name: "Private Display Name",
        role: "owner",
        presence: "present",
        consent,
        joined_at: new Date(START_MS).toISOString(),
        last_seen_at: new Date(START_MS).toISOString(),
      }],
      participant_context_cards: [],
      readiness: {
        participant_count: 1,
        required_participant_count: 2,
        ready: false,
        missing_participant_count: 1,
        missing_consent_by_participant: {},
      },
      runtime,
      created_at: new Date(START_MS).toISOString(),
      updated_at: new Date(START_MS).toISOString(),
      closed_at: null,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const debug = buildSharedRealtimeRoomRuntimeDebugProjection({
      room,
      inviteCount: 1,
      auditEventCount: 2,
      nowMs: START_MS,
    });
    const serialized = JSON.stringify(debug);

    expect(debug).toMatchObject({
      schema: "helix.shared_realtime_room.debug.v1",
      raw_content_included: false,
      runtime_evidence: {
        retained_provider_item_count: 1,
        provider_call_id_included: false,
        provider_item_ids_included: false,
        thumbnail_data_included: false,
        answer_authority: false,
      },
    });
    expect(serialized).not.toContain("realtime-private-session-id");
    expect(serialized).not.toContain("rtc_private_provider_call");
    expect(serialized).not.toContain("raw-private-frame-consent");
    expect(serialized).not.toContain("raw-private-room-consent");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("Private Display Name");
    expect(serialized).toContain("sha256:");
  });
});
