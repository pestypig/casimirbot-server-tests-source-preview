import crypto from "node:crypto";
import { expect, it, vi } from "vitest";
import { dispatchNativeHostedRoomInstruction, inspectNativeHostedRoomInstructions } from "../native-room-dispatch";
import type { NativeSharedLiveRoomConnection } from "../native-room-connection";
import type { NativeRoomMissionRecord } from "../native-room-mission-store";
import { RoomExternalMissionError } from "../../local-supervisor/room-external-mission-store";

const fixture = () => {
  const account = { profileId: "profile:owner", sessionId: "session:owner" };
  const task = { profileRef: account.profileId, bindingId: "binding:one", bindingEpoch: 1,
    helixConversationId: "chat:private", missionId: null, runId: null, authenticatedMcpClientRef: "client:one",
    clientSessionRef: "client-session:one", clientContinuationRef: "task:private" };
  const text = "Consider the guest's current constraint before proceeding.";
  const capture = { handoff_id: "handoff:guest", realtime_session_id: "realtime:one", runtime_id: "runtime:one",
    speaker_participant_id: "participant:guest", captured_at_ms: Date.now(), consent_version: 2,
    consent_receipt_ref: "consent:guest", transcript_text_hash: `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`,
    transcript_text_char_count: text.length };
  const attachment = { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 1,
    node_ref: `room_node:sha256:${"a".repeat(64)}`, status: "reserved" as const, expires_at: "2099-01-01T00:00:00Z",
    local_task_verified: false as const, dispatch_authority: false as const };
  const request = { room_id: "shared_realtime_room:remote", selection_ref: "native_room_selection:one", selection_revision: 1,
    handoff_id: capture.handoff_id, instruction_text: text };
  const record = { status: "selected", owner_profile_id: account.profileId, selection_ref: request.selection_ref, revision: 1,
    payload: { task, profileId: account.profileId, sessionId: account.sessionId, roomId: request.room_id,
      authority: "https://rooms.test", connectionRef: "process:one",
      deviceRef: `installation:${crypto.createHash("sha256").update("device:one").digest("hex")}` }, attachment } as NativeRoomMissionRecord;
  const inspect = vi.fn(async () => record as NativeRoomMissionRecord | null);
  const authorize = vi.fn(async () => 3), validate = vi.fn(async (_input: unknown) => {});
  const resolveOwnedDurablePreparationTarget = vi.fn(async () => ({ task: { ...task }, pairingId: "pairing:one" }));
  const dispatch = vi.fn(async (_input: unknown) => ({ steering_event_ref: "reasoning_steering:one" }) as never);
  const access = { resolveOwnedDurablePreparationTarget, dispatch };
  const prepare = vi.fn(async (_input: unknown) => ({ dispatch_ref: "native_room_dispatch:one", client_event_ref: "native_room_handoff:one",
    status: "pending" as const, event_ref: null }));
  const finish = vi.fn(async (_input: unknown, _eventRef: string) => ({ dispatch_ref: "native_room_dispatch:one", client_event_ref: "native_room_handoff:one",
    status: "queued" as const, event_ref: "reasoning_steering:one" }));
  let deviceId = "device:one", connectionRef = "process:one";
  const connection = { identityFor: () => ({ authority: "https://rooms.test", connectionRef }),
    claimOwnerNodeHandoff: vi.fn(async () => ({})),
    listOwnerNodeHandoffs: vi.fn(async () => [{ ...capture }]) };
  const connectionFor = vi.fn(() => connection as unknown as NativeSharedLiveRoomConnection);
  const input = { account, request, access, authorizeRequest: vi.fn(async () => {}) };
  const dependencies = { connection: connectionFor, deviceId: () => deviceId, authorize, validate, validatePreparation: validate,
    selections: { inspect }, dispatches: { prepare, finish } };
  return { input, dependencies, record, capture, task, inspect, authorize, validate, resolveOwnedDurablePreparationTarget,
    dispatch, prepare, finish, connection, connectionFor, setDevice: () => { deviceId = "device:changed"; },
    setConnection: () => { connectionRef = "process:changed"; }, run: () => dispatchNativeHostedRoomInstruction(input, dependencies) };
};

it("derives capture authority, queues only after persisted intent and returns a non-content receipt", async () => {
  const f = fixture(); const receipt = await f.run();
  expect(receipt).toMatchObject({ instruction_queued: true, task_pickup_confirmed: false,
    execution_authority: false, answer_authority: false, raw_content_included: false });
  expect(JSON.stringify(receipt)).not.toMatch(/participant:guest|Consider the guest|chat:private|task:private|session:owner/);
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ clientEventRef: "native_room_handoff:one",
    origin: "gpt_live_finalized", instructionText: f.input.request.instruction_text,
    roomMission: expect.objectContaining({ speakerParticipantId: f.capture.speaker_participant_id,
      consentVersion: f.capture.consent_version, consentReceiptRef: f.capture.consent_receipt_ref }) }));
  expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.dispatch.mock.invocationCallOrder[0]);
  expect(f.dispatch.mock.invocationCallOrder[0]).toBeLessThan(f.finish.mock.invocationCallOrder[0]);
  expect(f.validate).toHaveBeenCalledTimes(5);
  expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.connection.claimOwnerNodeHandoff.mock.invocationCallOrder[0]);
  expect(f.connection.claimOwnerNodeHandoff.mock.invocationCallOrder[0]).toBeLessThan(f.dispatch.mock.invocationCallOrder[0]);
});

it.each(["valid", "altered", "expired", "missing", "connection-changed"])("dispatches the approved transfer only after exact native checks: %s", async kind => {
  const f = fixture(), { instruction_text: text, ...selection } = f.input.request;
  const read = vi.fn(async () => ({ instruction_text: kind === "altered" ? "changed text" : text,
    expires_at: new Date(Date.now() + (kind === "expired" ? -1 : 120_000)).toISOString() }));
  if (kind === "missing") read.mockRejectedValue(new Error("no owner approval"));
  if (kind === "connection-changed") read.mockImplementation(async () => {
    f.setConnection(); return { instruction_text: text, expires_at: new Date(Date.now() + 120_000).toISOString() };
  });
  Object.assign(f.connection, { readReviewedOwnerInstruction: read });
  const run = () => dispatchNativeHostedRoomInstruction({ ...f.input, request: { ...selection, use_reviewed_transfer: true } }, f.dependencies);
  if (kind === "valid") {
    expect(await run()).toMatchObject({ instruction_queued: true, task_pickup_confirmed: false });
    expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ instructionText: text }));
  } else {
    await expect(run()).rejects.toThrow(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  }
});

it.each(["valid", "old-session", "other-connection", "replaced-selection"])("qualifies native instruction catalog: %s", async kind => {
  const f = fixture();
  if (kind === "old-session") f.record.payload.sessionId = "session:previous";
  if (kind === "other-connection") f.record.payload.connectionRef = "connection:previous";
  if (kind === "replaced-selection") f.inspect.mockResolvedValueOnce(structuredClone(f.record)).mockResolvedValue({ ...f.record, revision: 9 });
  const run = () => inspectNativeHostedRoomInstructions({ ...f.input, roomId: f.input.request.room_id }, f.dependencies);
  if (kind === "valid") expect(await run()).toMatchObject({ captures: [f.capture], selection_ref: f.record.selection_ref,
    selection_revision: 1, task_label: f.task.clientContinuationRef, raw_content_included: false, dispatch_authority: false });
  else await expect(run()).rejects.toThrow();
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
});

it.each(["selection", "missing", "text", "length", "capture", "extra_actor", "extra_pairing", "durable_pairing", "account"])(
  "rejects invalid %s before creating intent or queueing", async kind => {
    const f = fixture();
    if (kind === "selection") f.input.request.selection_revision += 1;
    if (kind === "missing") f.inspect.mockResolvedValue(null);
    if (kind === "text") f.input.request.instruction_text = "A different instruction";
    if (kind === "length") f.capture.transcript_text_char_count += 1;
    if (kind === "capture") f.connection.listOwnerNodeHandoffs.mockResolvedValue([]);
    if (kind === "extra_actor") Object.assign(f.input.request, { speaker_participant_id: "participant:owner" });
    if (kind === "extra_pairing") Object.assign(f.input.request, { pairing_id: "pairing:caller" });
    if (kind === "durable_pairing") f.resolveOwnedDurablePreparationTarget.mockRejectedValue(new Error("pairing unavailable"));
    if (kind === "account") f.authorize.mockRejectedValue(new Error("account unavailable"));
    await expect(f.run()).rejects.toThrow(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  },
);

it.each(["device", "connection", "pairing", "task", "consent"])("rejects changed %s after intent persistence before queueing", async kind => {
  const f = fixture();
  f.prepare.mockImplementationOnce(async () => {
    if (kind === "device") f.setDevice();
    if (kind === "connection") f.setConnection();
    if (kind === "pairing") f.resolveOwnedDurablePreparationTarget.mockResolvedValue({ task: f.task, pairingId: "pairing:changed" });
    if (kind === "task") f.resolveOwnedDurablePreparationTarget.mockResolvedValue({ task: { ...f.task, clientContinuationRef: "task:changed" }, pairingId: "pairing:one" });
    if (kind === "consent") f.validate.mockRejectedValue(new RoomExternalMissionError("room_mission_not_current", 409));
    return { dispatch_ref: "native_room_dispatch:one", client_event_ref: "native_room_handoff:one", status: "pending", event_ref: null };
  });
  await expect(f.run()).rejects.toThrow(); expect(f.dispatch).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
});

it.each(["queue", "finish", "post_queue_consent", "post_finish_consent"])("reports uncertain %s without automatic retry or false pickup confirmation", async kind => {
  const f = fixture();
  if (kind === "queue") f.dispatch.mockRejectedValueOnce(new Error("queue response lost"));
  if (kind === "finish") f.finish.mockRejectedValueOnce(new Error("snapshot response lost"));
  if (kind === "post_queue_consent") f.validate.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new RoomExternalMissionError("room_mission_not_current", 409));
  if (kind === "post_finish_consent") f.validate.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new RoomExternalMissionError("room_mission_not_current", 409));
  await expect(f.run()).rejects.toMatchObject({ code: "hosted_room_dispatch_unconfirmed", outcomeUnknown: true });
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

it("rechecks device identity after the final awaited request authorization", async () => {
  const f = fixture(); let checks = 0;
  f.input.authorizeRequest.mockImplementation(async () => { if (++checks === 11) f.setDevice(); });
  await expect(f.run()).rejects.toMatchObject({ code: "hosted_room_dispatch_unconfirmed", outcomeUnknown: true });
  expect(f.dispatch).toHaveBeenCalledTimes(1); expect(f.finish).toHaveBeenCalledTimes(1);
});

it("does not queue after an uncertain hosted claim or renew that claim automatically", async () => {
  const f = fixture(); f.connection.claimOwnerNodeHandoff.mockRejectedValueOnce(new Error("claim response lost"));
  await expect(f.run()).rejects.toMatchObject({ code: "hosted_room_dispatch_unconfirmed", outcomeUnknown: true });
  expect(f.connection.claimOwnerNodeHandoff).toHaveBeenCalledTimes(1);
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
});

it("does not queue when native request authorization is lost during intent persistence", async () => {
  const f = fixture(), original = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementationOnce(async input => {
    const result = await original(input); f.input.authorizeRequest.mockRejectedValue(new Error("native session revoked")); return result;
  });
  await expect(f.run()).rejects.toThrow("native session revoked");
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
});
