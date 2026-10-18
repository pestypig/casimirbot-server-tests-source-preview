import crypto from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const hostedGate = vi.hoisted(() => vi.fn(async (_input: unknown) => undefined));
vi.mock("../../shared-live-room-control/native-room-mission-steering", () => ({ requireCurrentNativeHostedSteering: hostedGate,
  validateNativeHostedDispatchPreparation: hostedGate }));
import { HelixReasoningTaskBindingStore } from "../reasoning-task-binding-store";
import { DurableReasoningBindingAccess } from "../durable-reasoning-binding-access";
import { RoomExternalMissionError } from "../room-external-mission-store";
import type { RoomMissionSteeringEnvelope } from "../room-mission-steering";
import { newDb } from "pg-mem";
import { migration087 } from "../../../db/migrations/087_pairing_ledger";
import { migration090 } from "../../../db/migrations/090_durable_steering";
import { PairingLedgerRepository } from "../pairing-ledger-repository";
import { DurableSteeringRepository } from "../durable-steering-repository";
import { createPairingLedgerRow, acceptPairingLedgerRow, pairingApprovalSchema } from "../pairing-ledger-contract";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
import { migration096 } from "../../../db/migrations/096_native_hosted_room_dispatches";
import { NativeRoomDispatchStore } from "../../shared-live-room-control/native-room-dispatch-store";
import { dispatchNativeHostedRoomInstruction } from "../../shared-live-room-control/native-room-dispatch";
import type { withSharedRealtimeRoomTransaction } from "../../helix-ask/realtime-room/room-store/database";

beforeEach(() => { hostedGate.mockReset().mockResolvedValue(undefined); });
const fixture = () => {
  const now = new Date();
  const presence = { active: true, service_instance_ref: "service:hosted", authenticated_profile_ref: "profile:owner",
    authenticated_mcp_client_ref: "client:one", client_session_ref: "session:task", conversation_thread_ref: "task:one",
    observed_at: now.toISOString(), heartbeat_expires_at: new Date(now.getTime() + 120000).toISOString(),
    thread_observability_bridge: { requested_level: "continuation_ready", supported_levels: ["continuation_ready"],
      declaration_basis: "authenticated_client_declaration", provider_thread_content_included: false,
      hidden_reasoning_included: false, answer_authority: false, terminal_eligible: false } };
  const store = new HelixReasoningTaskBindingStore({ serviceInstanceRef: "service:hosted", listPresence: () => [presence] } as never);
  const claim = store.issueClaim({ profileRef: "profile:owner", clientSessionRef: "session:task", helixConversationId: "chat:one" });
  const binding = store.claim({ profileRef: "profile:owner", authenticatedMcpClientRef: "client:one", clientSessionRef: "session:task",
    claimHandle: claim.claim_handle });
  const task = { profileRef: "profile:owner", bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
    authenticatedMcpClientRef: "client:one", clientSessionRef: "session:task", clientContinuationRef: "task:one",
    helixConversationId: "chat:one", missionId: null, runId: null };
  const text = "Review the current room mission constraints.";
  const envelope: RoomMissionSteeringEnvelope = { schema: "helix.room_mission_steering.v1", roomId: "shared_realtime_room:remote",
    ownerProfileId: task.profileRef, roomMissionId: "native_room_selection:one", roomMissionRevision: 1,
    handoffId: "handoff:guest", realtimeSessionId: "realtime:one", runtimeId: "runtime:one", speakerParticipantId: "participant:guest",
    capturedAtMs: Date.now(), consentVersion: 2, consentReceiptRef: "consent:guest", transcriptTextHash: `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`,
    bindingId: task.bindingId, bindingEpoch: task.bindingEpoch, authenticatedMcpClientRef: task.authenticatedMcpClientRef,
    clientSessionRef: task.clientSessionRef, clientContinuationRef: task.clientContinuationRef, helixConversationId: task.helixConversationId,
    bindingMissionId: null, runId: null, hosted: { authority: "https://rooms.test", local_account_session_id: "session:owner",
      connection_ref: "process:connection", device_ref: `installation:${"a".repeat(64)}`, device_trust_revision: 2,
      attachment: { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 3,
        node_ref: `room_node:sha256:${"b".repeat(64)}`, status: "reserved", expires_at: "2099-01-01T00:00:00Z",
        local_task_verified: false, dispatch_authority: false }, transcript_text_char_count: text.length } };
  const access = new DurableReasoningBindingAccess(store, async () => {});
  const request = { profileRef: task.profileRef, bindingId: task.bindingId, bindingEpoch: task.bindingEpoch,
    clientEventRef: "hosted:handoff-one", origin: "gpt_live_finalized" as const, instructionText: text, roomMission: envelope };
  return { access, store, task, request, text, envelope, presence };
};

it("uses the hosted guard on dispatch, task pickup and acknowledgement without exposing private authority metadata", async () => {
  const f = fixture(); const event = await f.access.dispatch(f.request);
  expect(await f.access.dispatch(f.request)).toEqual(event);
  expect(JSON.stringify(event)).not.toMatch(/session:owner|process:connection|local_account_session_id|Review the current/);
  expect((await f.access.readForTask(f.task)).map(d => d.instruction_text)).toEqual([f.text]);
  expect(f.store.inspectEvent({ ...f.task, eventRef: event.steering_event_ref }))
    .toMatchObject({ delivery_state: "picked_up", picked_up_at: expect.any(String),
      acknowledged_at: null });
  await f.access.acknowledgeForTask({ ...f.task, eventRef: event.steering_event_ref });
  expect(hostedGate).toHaveBeenCalledTimes(5);
  expect(hostedGate).toHaveBeenLastCalledWith({ envelope: f.envelope, association: expect.objectContaining(f.task) });
  expect(f.store.inspectEvent({ ...f.task, eventRef: event.steering_event_ref }).delivery_state).toBe("acknowledged");
});

it("does not accept a fresh room acknowledgement before the exact task polls", async () => {
  const f = fixture(); const event = await f.access.dispatch(f.request);
  await expect(f.access.acknowledgeForTask({ ...f.task, eventRef: event.steering_event_ref }))
    .rejects.toMatchObject({ code: "reasoning_steering_pickup_required" });
  expect(f.store.inspectEvent({ ...f.task, eventRef: event.steering_event_ref }))
    .toMatchObject({ delivery_state: "pending", picked_up_at: null, acknowledged_at: null });
  await f.access.readForTask(f.task);
  expect((await f.access.acknowledgeForTask({ ...f.task, eventRef: event.steering_event_ref })).delivery_state)
    .toBe("acknowledged");
});

it("withholds revoked hosted text, preserves cursor progress and blocks acknowledgement", async () => {
  const f = fixture(); const event = await f.access.dispatch(f.request);
  const later = await f.access.dispatch({ ...f.request, roomMission: undefined, origin: "typed", clientEventRef: "later:typed", instructionText: "A later local instruction." });
  hostedGate.mockRejectedValue(new RoomExternalMissionError("room_mission_not_current", 409));
  const deliveries = await f.access.readForTask(f.task);
  expect(deliveries.map(d => [d.event.cursor, d.instruction_text])).toEqual([[event.cursor, ""], [later.cursor, "A later local instruction."]]);
  expect(deliveries[0].content_role).toBe("room_mission_suppressed_not_instruction");
  await expect(f.access.acknowledgeForTask({ ...f.task, eventRef: event.steering_event_ref })).rejects.toMatchObject({ code: "room_mission_not_current" });
});

it("does not relabel temporary hosted failure as revocation, and can validate a later explicit pickup", async () => {
  const f = fixture(); await f.access.dispatch(f.request);
  hostedGate.mockRejectedValueOnce(new RoomExternalMissionError("room_mission_hosted_authority_unavailable", 503));
  await expect(f.access.readForTask(f.task)).rejects.toMatchObject({ code: "room_mission_hosted_authority_unavailable" });
  expect((await f.access.readForTask(f.task))[0].instruction_text).toBe(f.text);
});

it.each(["text", "length", "task", "ttl"])("rejects mismatched %s before enqueueing or hosted validation", async kind => {
  const f = fixture();
  if (kind === "text") f.request.instructionText = "A different instruction.";
  if (kind === "length") f.envelope.hosted!.transcript_text_char_count += 1;
  if (kind === "task") f.envelope.clientContinuationRef = "task:other";
  if (kind === "ttl") Object.assign(f.request, { expiresInSeconds: 3600 });
  await expect(f.access.dispatch(f.request)).rejects.toThrow();
  expect(hostedGate).not.toHaveBeenCalled();
  expect(await f.access.readForTask(f.task)).toEqual([]);
});

it("requires durable pairing before accepting a hosted task result", async () => {
  const f = fixture(); const event = await f.access.dispatch(f.request);
  await f.access.readForTask(f.task);
  await f.access.acknowledgeForTask({ ...f.task, eventRef: event.steering_event_ref });
  await expect(f.access.submitRoomMissionResult({ ...f.task, request: { steeringEventRef: event.steering_event_ref,
    status: "completed", resultText: "A private report.", evidenceRefs: [] } }))
    .rejects.toMatchObject({ code: "hosted_room_durable_pairing_required" });
});

it("requires a durable pairing for hosted dispatch preparation", async () => {
  const f = fixture();
  await expect(f.access.resolveOwnedDurablePreparationTarget(f.task)).rejects.toMatchObject({ code: "hosted_room_durable_pairing_required" });
});

it("revalidates hosted pickup through the encrypted durable queue after repository recovery", async () => {
  const f = fixture(), now = new Date();
  const pool = new (newDb().adapters.createPg().Pool)();
  try {
    await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
    await pool.query("INSERT INTO helix_accounts VALUES ($1)", [f.task.profileRef]);
    const client = await pool.connect();
    try {
      await migration087.run(client, { enablePgvector: false });
      await migration090.run(client, { enablePgvector: false });
      await migration096.run(client, { enablePgvector: false });
    } finally { client.release(); }
    const destination = { issuer: "fixture:issuer", profileId: f.task.profileRef, installationId: "fixture:device",
      clientId: f.task.authenticatedMcpClientRef, taskId: f.task.clientContinuationRef };
    const grant = createPairingLedgerRow({ id: "pairing:hosted", requestDigest: "a".repeat(64),
      acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "consent:hosted",
      approval: pairingApprovalSchema.parse({ destination, chatId: f.task.helixConversationId,
        environment: null, scope: "exact_chat_steering", policyRevision: 1 }) }, now);
    const vault = ephemeralPairingVault();
    const ledger = new PairingLedgerRepository(pool, vault, async () => {});
    await ledger.insert(grant);
    await ledger.compareAndSwap(acceptPairingLedgerRow(grant, destination, now), grant.revision);
    const store = new HelixReasoningTaskBindingStore({ serviceInstanceRef: "service:hosted", listPresence: () => [f.presence] } as never);
    const makeAccess = () => new DurableReasoningBindingAccess(store, async () => {},
      async () => new PairingLedgerRepository(pool, vault, async () => {}), () => now,
      async () => new DurableSteeringRepository(pool, vault, async () => {}));
    const first = makeAccess();
    const binding = await first.restore({ destination, clientSessionRef: f.task.clientSessionRef, pairingId: grant.id });
    const task = { ...f.task, bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch };
    const envelope = { ...f.envelope, bindingId: task.bindingId, bindingEpoch: task.bindingEpoch,
      hosted: { ...f.envelope.hosted!, device_ref: `installation:${crypto.createHash("sha256").update("fixture:device").digest("hex")}` } };
    const request = { ...f.request, bindingId: task.bindingId, bindingEpoch: task.bindingEpoch, roomMission: envelope, expiresInSeconds: 600 };
    const recovered = makeAccess();
    expect(await first.resolveOwnedDurablePreparationTarget(task)).toEqual({ task, pairingId: grant.id });
    const transaction = (async (run: (db: typeof pool) => Promise<unknown>) => run(pool)) as typeof withSharedRealtimeRoomTransaction;
    const dispatches = new NativeRoomDispatchStore(transaction);
    const connection = { identityFor: () => ({ authority: envelope.hosted.authority, connectionRef: envelope.hosted.connection_ref }),
      claimOwnerNodeHandoff: async () => ({}),
      listOwnerNodeHandoffs: async () => [{ handoff_id: envelope.handoffId, realtime_session_id: envelope.realtimeSessionId,
        runtime_id: envelope.runtimeId, speaker_participant_id: envelope.speakerParticipantId, captured_at_ms: envelope.capturedAtMs,
        consent_version: envelope.consentVersion, consent_receipt_ref: envelope.consentReceiptRef,
        transcript_text_hash: envelope.transcriptTextHash, transcript_text_char_count: f.text.length }] };
    const dependencies = { connection: () => connection as never, deviceId: () => "fixture:device",
      authorize: async () => envelope.hosted.device_trust_revision, validate: hostedGate, dispatches,
      selections: { inspect: async () => ({ selection_ref: envelope.roomMissionId, revision: envelope.roomMissionRevision,
        owner_profile_id: task.profileRef, status: "selected", payload: { task,
          profileId: task.profileRef, sessionId: envelope.hosted.local_account_session_id,
          deviceRef: envelope.hosted.device_ref, authority: envelope.hosted.authority,
          connectionRef: envelope.hosted.connection_ref, roomId: envelope.roomId },
        attachment: envelope.hosted.attachment }) as never } };
    const input = { account: { profileId: task.profileRef, sessionId: envelope.hosted.local_account_session_id }, authorizeRequest: async () => {},
      request: { room_id: envelope.roomId, selection_ref: envelope.roomMissionId, selection_revision: envelope.roomMissionRevision,
        handoff_id: envelope.handoffId, instruction_text: f.text }, access: first };
    const receipt = await dispatchNativeHostedRoomInstruction(input, dependencies);
    expect(await dispatchNativeHostedRoomInstruction({ ...input, access: recovered }, dependencies)).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(/Review the current|session:owner|task:one|participant:guest/);
    const intent = await dispatches.prepare({ pairingId: grant.id, envelope, expiresInSeconds: 600 });
    request.clientEventRef = intent.client_event_ref;
    const event = await first.dispatch(request);
    expect(event.steering_event_ref).toBe(receipt.steering_event_ref);
    expect(await recovered.dispatch(request)).toEqual(event);
    const rows = (await pool.query("SELECT * FROM helix_durable_steering")).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Review the current|process:connection|session:owner/);
    expect((await new DurableSteeringRepository(pool, vault, async () => {}).read(task.profileRef, grant.id, event.steering_event_ref))?.request.roomMission).toEqual(envelope);
    expect((await recovered.readForTask(task))[0]).toMatchObject({
      instruction_text: f.text, event: { delivery_state: "picked_up",
        picked_up_at: expect.any(String), acknowledged_at: null } });
    const persistedPickup = await new DurableSteeringRepository(pool, vault,
      async () => {}).read(task.profileRef, grant.id, event.steering_event_ref);
    expect(persistedPickup).toMatchObject({ revision: 2,
      pickedUpAt: expect.any(String), acknowledgedAt: null });
    hostedGate.mockRejectedValueOnce(new RoomExternalMissionError("room_mission_hosted_authority_unavailable", 503));
    await expect(recovered.readForTask(task)).rejects.toMatchObject({ code: "room_mission_hosted_authority_unavailable" });
    expect((await recovered.readForTask(task))[0]).toMatchObject({
      instruction_text: f.text, event: { delivery_state: "picked_up" } });
    expect((await new DurableSteeringRepository(pool, vault, async () => {})
      .read(task.profileRef, grant.id, event.steering_event_ref))?.revision).toBe(2);
    await recovered.acknowledgeForTask({ ...task, eventRef: event.steering_event_ref });
    expect((await new DurableSteeringRepository(pool, vault, async () => {})
      .read(task.profileRef, grant.id, event.steering_event_ref))?.revision).toBe(3);
    hostedGate.mockRejectedValue(new RoomExternalMissionError("room_mission_not_current", 409));
    expect((await makeAccess().readForTask(task))[0]).toMatchObject({ instruction_text: "",
      content_role: "room_mission_suppressed_not_instruction", event: { cursor: event.cursor, delivery_state: "revoked" } });
    await expect(recovered.acknowledgeForTask({ ...task, eventRef: event.steering_event_ref })).rejects.toMatchObject({ code: "room_mission_not_current" });
  } finally { await pool.end(); }
});
