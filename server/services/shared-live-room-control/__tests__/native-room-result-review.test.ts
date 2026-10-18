import crypto from "node:crypto";
import { expect, it, vi } from "vitest";
import { reviewNativeHostedRoomResults, shareNativeHostedRoomResult } from "../native-room-result-review";
import { nativeResultDisclosureReceipt } from "./native-result-disclosure-receipt-fixture";
import { nativeHostedDispatchDigest } from "../../local-supervisor/room-mission-steering";
import { hostedResultRecord } from "../../local-supervisor/__tests__/native-hosted-room-result-fixture";

const fixture = () => {
  const record = hostedResultRecord(), envelope = record.envelope, hosted = envelope.hosted!;
  const deviceId = "device:review";
  hosted.device_ref = `installation:${crypto.createHash("sha256").update(deviceId).digest("hex")}`;
  const task = { profileRef: record.ownerProfileId, bindingId: envelope.bindingId, bindingEpoch: envelope.bindingEpoch,
    authenticatedMcpClientRef: envelope.authenticatedMcpClientRef, clientSessionRef: envelope.clientSessionRef,
    clientContinuationRef: envelope.clientContinuationRef, helixConversationId: envelope.helixConversationId,
    missionId: envelope.bindingMissionId, runId: envelope.runId };
  const selection = { selection_ref: envelope.roomMissionId, revision: envelope.roomMissionRevision, status: "selected",
    owner_profile_id: record.ownerProfileId, attachment: hosted.attachment,
    payload: { profileId: record.ownerProfileId, sessionId: hosted.local_account_session_id, authority: hosted.authority,
      connectionRef: hosted.connection_ref, roomId: envelope.roomId, deviceRef: hosted.device_ref, task } };
  const identity = { authority: hosted.authority, connectionRef: hosted.connection_ref };
  const connection = { identityFor: vi.fn(() => identity), listOwnerNodeHandoffs: vi.fn(async () => []),
    discloseOwnerNodeResult: vi.fn(async (...args: Parameters<typeof nativeResultDisclosureReceipt>) => {
      await args[6]?.(); return nativeResultDisclosureReceipt(...args);
    }) };
  const access = { resolveOwnedDurablePreparationTarget: vi.fn(async () => ({ task: { ...task }, pairingId: "pairing:one" })),
    readCurrentNativeHostedRoomResultEvidence: vi.fn(async () => record) };
  const refs = vi.fn(async () => [record.request.steeringEventRef]);
  const dependencies = { connection: () => connection as never, deviceId: () => deviceId,
    selections: { inspect: vi.fn(async () => selection as never) }, results: vi.fn(async () => ({ listEventRefs: refs }) as never) };
  const input = { account: { profileId: record.ownerProfileId, sessionId: hosted.local_account_session_id },
    request: { room_id: envelope.roomId }, access, authorizeRequest: vi.fn(async () => {}) };
  const reviewRequest = { room_id: envelope.roomId, selection_ref: envelope.roomMissionId,
    selection_revision: envelope.roomMissionRevision, result_ref: record.resultId, steering_event_ref: record.request.steeringEventRef,
    result_sha256: crypto.createHash("sha256").update(record.request.resultText).digest("hex") };
  return { record, selection, identity, connection, access, dependencies, input, reviewRequest, refs };
};

it("lists only current result metadata and opens the exact selected private report without sharing", async () => {
  const f = fixture();
  const catalog = await reviewNativeHostedRoomResults(f.input, false, f.dependencies);
  expect(catalog).toMatchObject({ raw_content_included: false, room_publication_attempted: false,
    answer_authority: false, terminal_eligible: false, results: [{ result_ref: f.record.resultId }] });
  expect(JSON.stringify(catalog)).not.toMatch(/A private task report|task:private|session:private|connection:private|observation:private/);
  const preview = await reviewNativeHostedRoomResults({ ...f.input, request: f.reviewRequest }, true, f.dependencies);
  expect(preview).toMatchObject({ result_text: f.record.request.resultText, raw_content_included: true,
    private_owner_review: true, content_role: "untrusted_external_task_observation", room_publication_attempted: false });
  expect(JSON.stringify(preview)).not.toMatch(/task:private|session:private|connection:private|observation:private/);
  expect(f.connection.listOwnerNodeHandoffs).toHaveBeenCalledTimes(2);
});

it.each(["room_id", "selection_ref", "selection_revision", "result_ref", "result_sha256", "steering_event_ref"])("rejects a review with mismatched %s", async field => {
  const f = fixture(), changed = field === "selection_revision" ? 2 : field === "result_sha256" ? "a".repeat(64) : "shared_realtime_room:other";
  await expect(reviewNativeHostedRoomResults({ ...f.input, request: { ...f.reviewRequest, [field]: changed } }, true, f.dependencies))
    .rejects.toThrow();
});

it.each(["profileId", "sessionId", "authority", "connectionRef", "deviceRef", "roomId"])("rejects changed stored %s before opening result storage", async key => {
  const f = fixture(); f.selection.payload[key as "sessionId"] = "changed";
  await expect(reviewNativeHostedRoomResults(f.input, false, f.dependencies)).rejects.toThrow();
  expect(f.dependencies.results).not.toHaveBeenCalled(); expect(f.access.readCurrentNativeHostedRoomResultEvidence).not.toHaveBeenCalled();
});

it("rechecks request authority after a report read and withholds its text when access changes", async () => {
  const f = fixture(); f.access.readCurrentNativeHostedRoomResultEvidence.mockImplementationOnce(async () => {
    f.input.authorizeRequest.mockRejectedValue(new Error("account changed")); return f.record;
  });
  await expect(reviewNativeHostedRoomResults({ ...f.input, request: f.reviewRequest }, true, f.dependencies)).rejects.toThrow("account changed");
});

it.each(["connection", "selection", "task", "source"])("withholds an awaited report after %s changes", async kind => {
  const f = fixture(); f.access.readCurrentNativeHostedRoomResultEvidence.mockImplementationOnce(async () => {
    if (kind === "connection") f.identity.connectionRef = "connection:other";
    if (kind === "selection") f.selection.revision++;
    if (kind === "task") f.access.resolveOwnedDurablePreparationTarget.mockResolvedValue({ task: { ...f.selection.payload.task, clientContinuationRef: "task:other" }, pairingId: "pairing:other" });
    if (kind === "source") f.record.envelope.roomMissionRevision++;
    return f.record;
  });
  await expect(reviewNativeHostedRoomResults({ ...f.input, request: f.reviewRequest }, true, f.dependencies)).rejects.toThrow();
});

it("does not call a missing remote node an empty current catalog", async () => {
  const f = fixture(); f.refs.mockResolvedValue([]); f.connection.listOwnerNodeHandoffs.mockRejectedValue(new Error("revoked remote node"));
  await expect(reviewNativeHostedRoomResults(f.input, false, f.dependencies)).rejects.toThrow("revoked remote node");
  expect(f.refs).not.toHaveBeenCalled();
});

it("rejects an incomplete stored task even when there are no reports to read", async () => {
  const f = fixture(), admitted = { ...f.selection.payload.task };
  f.refs.mockResolvedValue([]);
  Reflect.deleteProperty(f.selection.payload.task, "clientContinuationRef");
  f.access.resolveOwnedDurablePreparationTarget.mockResolvedValue({ task: admitted, pairingId: "pairing:one" });
  await expect(reviewNativeHostedRoomResults(f.input, false, f.dependencies)).rejects.toThrow();
  expect(f.dependencies.results).not.toHaveBeenCalled();
});

it("propagates current claim or transport rejection without returning cached report metadata", async () => {
  const f = fixture(); f.access.readCurrentNativeHostedRoomResultEvidence.mockRejectedValue(new Error("claim unavailable"));
  await expect(reviewNativeHostedRoomResults(f.input, false, f.dependencies)).rejects.toThrow("claim unavailable");
});

it("rejects duplicate repository references instead of projecting a misleading catalog", async () => {
  const f = fixture(); f.refs.mockResolvedValue([f.record.request.steeringEventRef, f.record.request.steeringEventRef]);
  await expect(reviewNativeHostedRoomResults(f.input, false, f.dependencies)).rejects.toThrow();
});

it.each(["authority", "task_id", "result_text", "share_with_room"])("rejects caller supplied %s", async field => {
  const f = fixture();
  await expect(reviewNativeHostedRoomResults({ ...f.input, request: { ...f.reviewRequest, [field]: "forged" } }, true, f.dependencies)).rejects.toThrow();
  expect(f.input.authorizeRequest).not.toHaveBeenCalled();
});

it("shares only the current exact native report through the private connection and returns metadata", async () => {
  const f = fixture();
  const receipt = await shareNativeHostedRoomResult({ ...f.input, request: { ...f.reviewRequest, share_with_room: true } }, f.dependencies);
  expect(f.connection.discloseOwnerNodeResult).toHaveBeenCalledTimes(1);
  const args = f.connection.discloseOwnerNodeResult.mock.calls[0];
  expect(args[0]).toEqual(f.input.account); expect(args[1]).toBe(f.record.envelope.roomId);
  expect(args[4]).toBe(nativeHostedDispatchDigest(f.record.envelope));
  expect(args[5]).toEqual({ task_status: f.record.request.status, result_text: f.record.request.resultText,
    result_sha256: f.reviewRequest.result_sha256, share_with_room: true });
  expect(JSON.stringify(args.slice(1))).not.toMatch(/task:private|session:private|connection:private|observation:private/);
  expect(receipt).toMatchObject({ room_publication_attempted: true, room_disclosure_recorded: true,
    room_presentation_confirmed: false, raw_content_included: false, terminal_eligible: false });
  expect(JSON.stringify(receipt)).not.toContain(f.record.request.resultText);
  expect(f.access.readCurrentNativeHostedRoomResultEvidence).toHaveBeenCalledTimes(3);
});

it.each(["approval", "text", "hash", "result", "selection", "account", "source"])("denies sharing on %s mismatch before sending", async kind => {
  const f = fixture(), body: Record<string, unknown> = { ...f.reviewRequest, share_with_room: true };
  if (kind === "approval") body.share_with_room = false;
  if (kind === "text") body.result_text = "Replacement";
  if (kind === "hash") body.result_sha256 = "f".repeat(64);
  if (kind === "result") body.result_ref = "result:other";
  if (kind === "selection") f.selection.revision++;
  if (kind === "account") f.input.authorizeRequest.mockRejectedValue(new Error("account changed"));
  if (kind === "source") f.access.readCurrentNativeHostedRoomResultEvidence.mockRejectedValue(new Error("source revoked"));
  await expect(shareNativeHostedRoomResult({ ...f.input, request: body }, f.dependencies)).rejects.toThrow();
  expect(f.connection.discloseOwnerNodeResult).not.toHaveBeenCalled();
});

it.each(["connection", "selection", "account", "source", "report", "receipt", "transport"])("withholds share acknowledgement after %s changes without retry", async kind => {
  const f = fixture();
  f.connection.discloseOwnerNodeResult.mockImplementationOnce(async (...args) => {
    const receipt = nativeResultDisclosureReceipt(...args);
    if (kind === "connection") f.identity.connectionRef = "connection:changed";
    if (kind === "selection") f.selection.revision++;
    if (kind === "account") f.input.authorizeRequest.mockRejectedValue(new Error("account changed"));
    if (kind === "source") f.access.readCurrentNativeHostedRoomResultEvidence.mockRejectedValue(new Error("claim revoked"));
    if (kind === "report") f.record.request.resultText = "Changed after send";
    if (kind === "receipt") receipt.capture.consent_version++;
    if (kind === "transport") throw new Error("response lost");
    return receipt;
  });
  await expect(shareNativeHostedRoomResult({ ...f.input, request: { ...f.reviewRequest, share_with_room: true } }, f.dependencies))
    .rejects.toMatchObject({ code: "hosted_room_result_share_unconfirmed", outcomeUnknown: true });
  expect(f.connection.discloseOwnerNodeResult).toHaveBeenCalledTimes(1);
});
