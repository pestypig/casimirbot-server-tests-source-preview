import crypto from "node:crypto";
import { createRoomMissionResult } from "../room-mission-result";
import type { RoomMissionSteeringEnvelope } from "../room-mission-steering";

export const resultFixtureNow = new Date("2026-09-25T17:00:00.000Z");
export const resultFixtureText = "Review the guest's constraint.";
export const hostedResultEnvelope = (): RoomMissionSteeringEnvelope => ({
  schema: "helix.room_mission_steering.v1", ownerProfileId: "profile:result-owner",
  roomId: "shared_realtime_room:remote", roomMissionId: "native_room_selection:result", roomMissionRevision: 1,
  handoffId: "handoff:private", realtimeSessionId: "realtime:private", runtimeId: "runtime:private",
  speakerParticipantId: "participant:guest", capturedAtMs: resultFixtureNow.getTime(), consentVersion: 1,
  consentReceiptRef: "consent:guest", transcriptTextHash: `sha256:${crypto.createHash("sha256").update(resultFixtureText).digest("hex")}`,
  bindingId: "binding:private", bindingEpoch: 1, authenticatedMcpClientRef: "client:private",
  clientSessionRef: "session:private", clientContinuationRef: "task:private", helixConversationId: "chat:private",
  bindingMissionId: null, runId: null, hosted: { authority: "https://rooms.test",
    local_account_session_id: "session:owner-private", connection_ref: "connection:private",
    device_ref: `installation:${"b".repeat(64)}`, device_trust_revision: 1,
    transcript_text_char_count: resultFixtureText.length,
    attachment: { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 1,
      node_ref: `room_node:sha256:${"c".repeat(64)}`, status: "reserved", expires_at: "2099-01-01T00:00:00Z",
      local_task_verified: false, dispatch_authority: false } },
});

export function hostedResultRecord() {
  const envelope = hostedResultEnvelope();
  return createRoomMissionResult({ ownerProfileId: envelope.ownerProfileId, envelope, now: resultFixtureNow,
    request: { steeringEventRef: "reasoning_steering:private-result", status: "completed",
      resultText: "A private task report for owner review.", evidenceRefs: ["observation:private"] } });
}
