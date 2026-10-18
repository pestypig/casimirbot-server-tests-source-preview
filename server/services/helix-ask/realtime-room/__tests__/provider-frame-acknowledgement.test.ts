import { beforeEach, describe, expect, it } from "vitest";
import { applySharedRealtimeRoomProviderFrameEvent } from
  "../provider-frame-acknowledgement";
import {
  admitSharedRealtimeRoomVisualFrame,
  bindSharedRealtimeRoomAdmittedSession,
  bindSharedRealtimeRoomProviderCall,
  listSharedRealtimeRoomVisualFrames,
  markSharedRealtimeRoomTransportActive,
  registerSharedRealtimeRoomVisualFrameProviderEvent,
  reserveSharedRealtimeRoomRuntime,
  resetSharedRealtimeRoomRuntimeRegistryForTests,
  updateSharedRealtimeRoomVisualFrameProviderDelivery,
} from "../runtime-registry";

const ROOM_ID = "room-provider-ack";
const SESSION_ID = "realtime-provider-ack";

const preparePendingFrame = () => {
  const reservation = reserveSharedRealtimeRoomRuntime({
    roomId: ROOM_ID,
    reservedByParticipantId: "participant-owner",
    model: "gpt-realtime-2.1",
    transportOwner: "host_browser",
  });
  const runtimeId = reservation.runtime?.runtime_id as string;
  expect(bindSharedRealtimeRoomAdmittedSession({
    roomId: ROOM_ID,
    runtimeId,
    realtimeSessionId: SESSION_ID,
  }).ok).toBe(true);
  expect(bindSharedRealtimeRoomProviderCall({
    roomId: ROOM_ID,
    runtimeId,
    providerCallId: "provider-call-ack",
  }).ok).toBe(true);
  expect(markSharedRealtimeRoomTransportActive({
    roomId: ROOM_ID,
    runtimeId,
    transportOwner: "host_browser",
  }).ok).toBe(true);
  const admission = admitSharedRealtimeRoomVisualFrame({
    roomId: ROOM_ID,
    participantId: "participant-owner",
    participantDisplayName: "Owner",
    sourceId: "screen-owner",
    sourceSurface: "browser_tab",
    sequence: 1,
    capturedAtMs: Date.now(),
    imageHash: "sha256:owner-frame",
    consentReceiptRef: "consent:owner",
    screenToModelAuthorized: true,
    thumbnailToRoomAuthorized: false,
    providerDeliveryAvailable: true,
  });
  const providerItemId = admission.providerItemId as string;
  const providerEventId = "event-owner-frame";
  expect(registerSharedRealtimeRoomVisualFrameProviderEvent({
    roomId: ROOM_ID,
    providerItemId,
    providerEventId,
  })).toBe(true);
  expect(updateSharedRealtimeRoomVisualFrameProviderDelivery({
    roomId: ROOM_ID,
    frameRef: admission.frame?.frame_ref as string,
    providerItemId,
    delivery: "transport_sent",
  })?.provider_delivery).toBe("transport_sent");
  return { providerItemId, providerEventId };
};

beforeEach(() => {
  resetSharedRealtimeRoomRuntimeRegistryForTests();
});

describe("shared-room provider frame acknowledgement", () => {
  it("does not promote transport send or unrelated provider items", () => {
    const { providerItemId } = preparePendingFrame();
    expect(applySharedRealtimeRoomProviderFrameEvent({
      realtimeSessionId: SESSION_ID,
      event: {
        type: "conversation.item.created",
        item: { id: providerItemId, content: [{ type: "input_text", text: "not an image" }] },
      },
    })).toBe("ignored");
    expect(applySharedRealtimeRoomProviderFrameEvent({
      realtimeSessionId: SESSION_ID,
      event: {
        type: "conversation.item.created",
        item: { id: "different-item", content: [{ type: "input_image" }] },
      },
    })).toBe("ignored");
    expect(listSharedRealtimeRoomVisualFrames({ roomId: ROOM_ID })[0]?.provider_delivery)
      .toBe("transport_sent");
  });

  it("promotes only the exact provider-echoed input_image item", () => {
    const { providerItemId } = preparePendingFrame();
    expect(applySharedRealtimeRoomProviderFrameEvent({
      realtimeSessionId: SESSION_ID,
      event: {
        type: "conversation.item.created",
        item: {
          id: providerItemId,
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "redacted-by-provider" }],
        },
      },
    })).toBe("provider_acknowledged");
    expect(listSharedRealtimeRoomVisualFrames({ roomId: ROOM_ID })[0]?.provider_delivery)
      .toBe("sent_to_shared_model");
    expect(updateSharedRealtimeRoomVisualFrameProviderDelivery({
      roomId: ROOM_ID,
      frameRef: listSharedRealtimeRoomVisualFrames({ roomId: ROOM_ID })[0]?.frame_ref as string,
      providerItemId,
      delivery: "sideband_unavailable",
    })).toBeNull();
    expect(listSharedRealtimeRoomVisualFrames({ roomId: ROOM_ID })[0]?.provider_delivery)
      .toBe("sent_to_shared_model");
  });

  it("correlates provider rejection to the originating event", () => {
    const { providerEventId } = preparePendingFrame();
    expect(applySharedRealtimeRoomProviderFrameEvent({
      realtimeSessionId: SESSION_ID,
      event: {
        type: "error",
        error: { event_id: providerEventId, code: "invalid_value" },
      },
    })).toBe("provider_rejected");
    expect(listSharedRealtimeRoomVisualFrames({ roomId: ROOM_ID })[0]?.provider_delivery)
      .toBe("provider_rejected");
  });
});
