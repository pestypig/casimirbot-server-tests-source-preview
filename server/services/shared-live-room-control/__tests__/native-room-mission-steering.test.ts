import crypto from "node:crypto";
import { expect, it, vi } from "vitest";
import { requireCurrentNativeHostedSteering, authorizeNativeHostedSteering, validateNativeHostedDispatchPreparation } from "../native-room-mission-steering";
import { nativeHostedDispatchDigest } from "../../local-supervisor/room-mission-steering";
import type { NativeRoomMissionRecord } from "../native-room-mission-store";
import type { NativeSharedLiveRoomConnection } from "../native-room-connection";
import { NativeRoomConnectionError } from "../native-room-connection";
import type { RoomMissionSteeringEnvelope } from "../../local-supervisor/room-mission-steering";
import { RoomExternalMissionError } from "../../local-supervisor/room-external-mission-store";

const fixture = () => {
  const account = { profileId: "profile:owner", sessionId: "session:owner" };
  const association = { profileRef: account.profileId, bindingId: "binding:one", bindingEpoch: 2,
    helixConversationId: "chat:one", authenticatedMcpClientRef: "client:one", clientSessionRef: "client-session:one",
    clientContinuationRef: "task:one", missionId: null, runId: null };
  let deviceId = "device-one", connectionRef = "process:grant-one";
  const deviceRef = `installation:${crypto.createHash("sha256").update(deviceId).digest("hex")}`;
  const attachment = { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 3,
    node_ref: `room_node:sha256:${"a".repeat(64)}`, status: "reserved" as const, expires_at: "2099-01-01T00:00:00Z",
    local_task_verified: false as const, dispatch_authority: false as const };
  const envelope: RoomMissionSteeringEnvelope = { schema: "helix.room_mission_steering.v1", roomId: "shared_realtime_room:hosted",
    ownerProfileId: account.profileId, roomMissionId: "native_room_selection:one", roomMissionRevision: 4,
    handoffId: "handoff:one", realtimeSessionId: "realtime:one", runtimeId: "runtime:one", speakerParticipantId: "participant:guest",
    capturedAtMs: Date.now(), consentVersion: 2, consentReceiptRef: "consent:two", transcriptTextHash: `sha256:${"b".repeat(64)}`,
    bindingId: association.bindingId, bindingEpoch: association.bindingEpoch, helixConversationId: association.helixConversationId,
    authenticatedMcpClientRef: association.authenticatedMcpClientRef, clientSessionRef: association.clientSessionRef,
    clientContinuationRef: association.clientContinuationRef, bindingMissionId: null, runId: null,
    hosted: { authority: "https://rooms.test", local_account_session_id: account.sessionId, connection_ref: connectionRef,
      device_ref: deviceRef, device_trust_revision: 7, attachment, transcript_text_char_count: 25 } };
  const record: NativeRoomMissionRecord = { selection_key: "key:one", owner_profile_id: account.profileId,
    selection_ref: envelope.roomMissionId, revision: 4, status: "selected", request_id: "select:one", request_digest: "c".repeat(64),
    payload: { profileId: account.profileId, sessionId: account.sessionId, deviceRef, authority: "https://rooms.test", connectionRef,
      roomId: envelope.roomId, task: { ...association }, requestId: "select:one", expectedLocalRevision: 3, expectedRemoteRevision: 2 }, attachment };
  const inspect = vi.fn(async () => structuredClone(record) as NativeRoomMissionRecord | null);
  const authorize = vi.fn(async () => 7);
  const connection = { identityFor: vi.fn(() => ({ authority: "https://rooms.test", connectionRef })),
    validateOwnerNodeHandoffClaim: vi.fn(async () => undefined), validateOwnerNodeHandoff: vi.fn(async () => undefined) };
  const connectionFor = vi.fn(() => connection as unknown as NativeSharedLiveRoomConnection);
  const dependencies = { connection: connectionFor, store: { inspect }, authorize, deviceId: () => deviceId };
  const run = () => requireCurrentNativeHostedSteering({ envelope, association }, dependencies);
  return { account, envelope, association, record, inspect, authorize, connection, connectionFor, dependencies, run,
    setDevice: () => { deviceId = "device-two"; }, setConnection: () => { connectionRef = "process:grant-two"; } };
};

it("rechecks the private selection and current trust around a fresh exact hosted capture validation", async () => {
  const f = fixture(); await f.run(); await f.run();
  expect(f.connection.validateOwnerNodeHandoffClaim).toHaveBeenCalledTimes(2);
  expect(f.connection.validateOwnerNodeHandoffClaim).toHaveBeenCalledWith(f.account, f.envelope.roomId, f.envelope.hosted!.attachment,
    expect.objectContaining({ handoff_id: f.envelope.handoffId, speaker_participant_id: f.envelope.speakerParticipantId,
      consent_version: 2, transcript_text_char_count: 25 }), nativeHostedDispatchDigest(f.envelope));
  expect(f.inspect).toHaveBeenCalledTimes(4); expect(f.authorize).toHaveBeenCalledTimes(8);
  expect(JSON.stringify(f.connection.validateOwnerNodeHandoffClaim.mock.calls[0].slice(1))).not.toContain("task:one");
});

it("prepares using capture evidence but requires the exact claim for subsequent delivery", async () => {
  const f = fixture();
  await validateNativeHostedDispatchPreparation({ envelope: f.envelope, association: f.association }, f.dependencies);
  expect(f.connection.validateOwnerNodeHandoff).toHaveBeenCalledTimes(1);
  expect(f.connection.validateOwnerNodeHandoffClaim).not.toHaveBeenCalled();
  f.connection.validateOwnerNodeHandoffClaim.mockRejectedValue(new NativeRoomConnectionError("idempotency_conflict"));
  await expect(f.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
  expect(f.connection.validateOwnerNodeHandoff).toHaveBeenCalledTimes(1);
});

it.each(["account", "trust", "connection", "device", "selection", "pending", "task", "attachment", "session", "expired"])(
  "denies stale %s before the hosted read", async kind => {
    const f = fixture();
    if (kind === "account") f.authorize.mockRejectedValue(new RoomExternalMissionError("room_mission_not_current", 409));
    if (kind === "trust") f.authorize.mockResolvedValue(8);
    if (kind === "connection") f.setConnection();
    if (kind === "device") f.setDevice();
    if (kind === "selection") f.record.revision += 1;
    if (kind === "pending") f.record.status = "pending";
    if (kind === "task") f.record.payload.task.clientContinuationRef = "task:other";
    if (kind === "attachment") f.record.attachment = { ...f.record.attachment!, revision: 4 };
    if (kind === "session") f.record.payload.sessionId = "session:other";
    if (kind === "expired") f.envelope.hosted!.attachment.expires_at = "2020-01-01T00:00:00Z";
    await expect(f.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
    expect(f.connection.validateOwnerNodeHandoffClaim).not.toHaveBeenCalled();
  });

it.each(["trust", "selection", "device", "connection"])("withholds admission after %s changes during the hosted read", async kind => {
  const f = fixture(); f.connection.validateOwnerNodeHandoffClaim.mockImplementationOnce(async () => {
    if (kind === "trust") f.authorize.mockResolvedValue(8);
    if (kind === "selection") f.record.revision += 1;
    if (kind === "device") f.setDevice();
    if (kind === "connection") f.setConnection();
  });
  await expect(f.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
});

it("treats transport failure as unavailable, and only confirmed stale authority as revoked", async () => {
  const f = fixture(); f.connection.validateOwnerNodeHandoffClaim.mockRejectedValueOnce(new NativeRoomConnectionError("room_transport_failed"));
  await expect(f.run()).rejects.toMatchObject({ code: "room_mission_hosted_authority_unavailable", status: 503 });
  await expect(f.run()).resolves.toBeUndefined();
  f.connection.validateOwnerNodeHandoffClaim.mockRejectedValueOnce(new NativeRoomConnectionError("room_handoff_changed"));
  await expect(f.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
});

it("rejects a forged task association even if the saved selection was not changed", async () => {
  const f = fixture(); f.envelope.clientContinuationRef = "task:forged";
  await expect(f.run()).rejects.toMatchObject({ code: "room_mission_not_current" });
  expect(f.inspect).not.toHaveBeenCalled();
});

it.each(["session", "profile", "user", "policy", "link", "trust", "allowed"])("current local authorization checks %s", async kind => {
  const account = { profileId: "profile:owner", sessionId: "session:owner" };
  const status = { session: { session_id: account.sessionId, profile: { profile_id: account.profileId } },
    account_policy: { account_type: "developer", feature_flags: ["shared_realtime_rooms"], locked_features: [] as string[] } };
  if (kind === "session") status.session.session_id = "session:other";
  if (kind === "profile") status.session.profile.profile_id = "profile:other";
  if (kind === "user") status.account_policy.account_type = "user";
  if (kind === "policy") status.account_policy.locked_features.push("shared_realtime_rooms");
  const result = authorizeNativeHostedSteering(account, "device-one", {
    status: vi.fn(async () => status) as never,
    links: { listBindings: vi.fn(async () => ({ bindings: kind === "link" ? [] : [{ status: "active" }] })) } as never,
    trust: vi.fn(async () => ({ trusted: kind !== "trust", policy_revision: 7 })) as never,
  });
  if (kind === "allowed") await expect(result).resolves.toBe(7);
  else await expect(result).rejects.toMatchObject({ code: "room_mission_not_current" });
});
