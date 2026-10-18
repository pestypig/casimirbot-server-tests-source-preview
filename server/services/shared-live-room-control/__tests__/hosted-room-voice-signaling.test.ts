import { describe, expect, it } from "vitest";
import type { HelixSharedRealtimeRoom } from "@shared/helix-shared-realtime-room";
import { HostedRoomVoiceSignaling } from "../hosted-room-voice-signaling";

const room = (): HelixSharedRealtimeRoom => ({
  room_id: "room:voice-three", status: "text_ready", capacity_profile: "three_human_text",
  participants: ["owner", "guest-a", "guest-b"].map(participant_id => ({
    participant_id, presence: "present", consent: { microphone_to_room: true,
      consent_version: 1 },
  })),
} as unknown as HelixSharedRealtimeRoom);

describe("hosted three-member human voice signaling", () => {
  it("returns one signal for an uncertain retry and rejects ID reuse with changed SDP", () => {
    const store = new HostedRoomVoiceSignaling();
    const current = room();
    const now = Date.parse("2026-09-30T12:00:00Z");
    const callId = store.admit(current, "owner", now).call_id!;
    store.admit(current, "guest-a", now);
    const request = { callId, clientSignalId: "9260d95e-2935-47fc-a501-0b6aa0e0e3e9",
      targetParticipantId: "owner", negotiationId: "neg-1", kind: "offer" as const,
      description: { type: "offer" as const, sdp: "v=0\r\none" }, candidate: null };
    const first = store.publish(current, "guest-a", request, now + 1);
    expect(store.publish(current, "guest-a", request, now + 2)).toEqual(first);
    expect(store.readSignals(current, "owner", callId, null, now + 3)).toHaveLength(1);
    expect(() => store.publish(current, "guest-a", { ...request,
      description: { type: "offer", sdp: "v=0\r\nchanged" } }, now + 3))
      .toThrowError(/different negotiation payload/u);
  });
  it("targets exact admitted members while keeping model input disabled", () => {
    const store = new HostedRoomVoiceSignaling();
    const current = room();
    const now = Date.parse("2026-09-30T12:00:00Z");
    const first = store.admit(current, "owner", now);
    expect(first).toMatchObject({ audio_connected: false, model_input: false,
      admissions: [{ participant_id: "owner" }] });
    expect(store.admit(current, "guest-a", now + 1).call_id).toBe(first.call_id);
    expect(store.admit(current, "guest-b", now + 2).admissions).toHaveLength(3);
    const receipt = store.publish(current, "guest-b", {
      callId: first.call_id!, targetParticipantId: "owner",
      negotiationId: "guest-b-to-owner", kind: "offer",
      description: { type: "offer", sdp: "v=0\r\nthree-person-offer" },
      candidate: null,
    }, now + 3);
    expect(store.readSignals(current, "owner", first.call_id!, null, now + 4))
      .toMatchObject([{ signal_id: receipt.signal_id,
        sender_participant_id: "guest-b", target_participant_id: "owner" }]);
    expect(store.readSignals(current, "guest-a", first.call_id!, null, now + 4)).toEqual([]);
  });

  it("revocation and expiry remove admissions and suppress retained SDP", () => {
    const store = new HostedRoomVoiceSignaling();
    const current = room();
    const now = Date.parse("2026-09-30T12:00:00Z");
    const callId = store.admit(current, "owner", now).call_id!;
    store.admit(current, "guest-a", now);
    store.publish(current, "guest-a", { callId, targetParticipantId: "owner",
      negotiationId: "one", kind: "offer",
      description: { type: "offer", sdp: "v=0\r\nprivate-sdp" }, candidate: null }, now + 1);
    current.participants[1].consent.microphone_to_room = false;
    current.participants[1].consent.consent_version = 2;
    expect(store.inspect(current, "owner", now + 2).admissions)
      .toMatchObject([{ participant_id: "owner" }]);
    expect(store.readSignals(current, "owner", callId, null, now + 2)).toEqual([]);
    expect(() => store.publish(current, "guest-a", { callId,
      targetParticipantId: "owner", negotiationId: "two", kind: "hangup",
      description: null, candidate: null }, now + 2))
      .toThrowError(/current voice admission/u);
    expect(store.inspect(current, "owner", now + 45_001).call_id).toBeNull();
  });
});
