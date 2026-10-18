import crypto from "node:crypto";
import { expect, it, vi } from "vitest";
import { requireCurrentRoomInterpreterProposal, type RoomInterpreterProposalSteering } from
  "../room-interpreter-proposal-steering";
import { NativeRoomConnectionError, type NativeSharedLiveRoomConnection } from
  "../../shared-live-room-control/native-room-connection";
import type { NativeRoomMissionRecord } from "../../shared-live-room-control/native-room-mission-store";

function fixture() {
  const account = { profileId: "profile:owner", sessionId: "session:owner" };
  const association = { profileRef: account.profileId, bindingId: "binding:one", bindingEpoch: 2,
    authenticatedMcpClientRef: "client:one", clientSessionRef: "client-session:one",
    clientContinuationRef: "task:one", helixConversationId: "chat:one", missionId: null, runId: null };
  const roomId = "shared_realtime_room:11111111-1111-4111-8111-111111111111";
  const deviceId = "device:one";
  const deviceRef = `installation:${crypto.createHash("sha256").update(deviceId).digest("hex")}`;
  const attachment = { attachment_ref: "room_owner_attachment:22222222-2222-4222-8222-222222222222",
    revision: 1, node_ref: `room_node:sha256:${"a".repeat(64)}`, status: "reserved" as const,
    expires_at: "2099-01-01T00:00:00Z", local_task_verified: false as const,
    dispatch_authority: false as const };
  const envelope: RoomInterpreterProposalSteering = {
    schema: "helix.room_interpreter_proposal_steering.v1", roomId,
    ownerProfileId: account.profileId, selectionRef: "selection:one", selectionRevision: 3,
    turnRequestId: "room_interpreter_turn:33333333-3333-4333-8333-333333333333",
    interpreterSessionId: "room_interpreter:44444444-4444-4444-8444-444444444444",
    interpreterGeneration: 2, contextSha256: "b".repeat(64),
    triggerMessageId: "room_message:55555555-5555-4555-8555-555555555555",
    triggerAuthorParticipantId: "participant:guest",
    resultSha256: crypto.createHash("sha256").update("A possible plan.").digest("hex"),
    instructionSha256: crypto.createHash("sha256").update("Please check this proposal.").digest("hex"),
    bindingId: association.bindingId, bindingEpoch: association.bindingEpoch,
    authenticatedMcpClientRef: association.authenticatedMcpClientRef,
    clientSessionRef: association.clientSessionRef,
    clientContinuationRef: association.clientContinuationRef,
    helixConversationId: association.helixConversationId, bindingMissionId: null, runId: null,
    hosted: { authority: "https://rooms.test", localAccountSessionId: account.sessionId,
      connectionRef: "connection:one", deviceRef, deviceTrustRevision: 7, attachment },
  };
  const record: NativeRoomMissionRecord = { selection_key: "key:one", owner_profile_id: account.profileId,
    selection_ref: envelope.selectionRef, revision: envelope.selectionRevision, status: "selected",
    request_id: "select:one", request_digest: "d".repeat(64),
    payload: { profileId: account.profileId, sessionId: account.sessionId, deviceRef,
      authority: envelope.hosted.authority, connectionRef: envelope.hosted.connectionRef,
      roomId, task: association, requestId: "select:one", expectedLocalRevision: 2,
      expectedRemoteRevision: 1 }, attachment };
  const source = { room: { room_id: roomId }, source: {
    request_id: envelope.turnRequestId,
    interpreter_session_id: envelope.interpreterSessionId,
    generation: envelope.interpreterGeneration, context_sha256: envelope.contextSha256,
    trigger_message_id: envelope.triggerMessageId,
    trigger_author_participant_id: envelope.triggerAuthorParticipantId,
    reply_text: "A possible plan.",
    result_sha256: envelope.resultSha256 } };
  const inspect = vi.fn(async () => structuredClone(record) as NativeRoomMissionRecord | null);
  const authorize = vi.fn(async () => 7);
  const readSource = vi.fn(async () => structuredClone(source));
  const connection = { identityFor: () => ({ authority: envelope.hosted.authority,
    connectionRef: envelope.hosted.connectionRef }), inspectHostedInterpreterProposalSource: readSource };
  const deps = { connection: () => connection as unknown as NativeSharedLiveRoomConnection,
    store: { inspect }, authorize, deviceId: () => deviceId };
  const run = () => requireCurrentRoomInterpreterProposal({ envelope, association }, deps);
  return { envelope, association, record, source, inspect, authorize, readSource, run };
}

it("rechecks selected task and current released AI source around pickup", async () => {
  const f = fixture(); await f.run();
  expect(f.inspect).toHaveBeenCalledTimes(2);
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.readSource).toHaveBeenCalledTimes(1);
});

it("withholds changed selection, result or task and distinguishes transport uncertainty", async () => {
  const selection = fixture(); selection.record.revision++;
  await expect(selection.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
  const result = fixture(); result.source.source.result_sha256 = "e".repeat(64);
  await expect(result.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
  const task = fixture(); task.envelope.clientContinuationRef = "task:other";
  await expect(task.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
  expect(task.readSource).not.toHaveBeenCalled();
  const uncertain = fixture(); uncertain.readSource.mockRejectedValueOnce(
    new NativeRoomConnectionError("room_transport_failed"));
  await expect(uncertain.run()).rejects.toMatchObject({
    code: "room_mission_hosted_authority_unavailable", status: 503 });
});
