import { newDb } from "pg-mem";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hostedGate = vi.hoisted(() => vi.fn(async (_input: unknown) => undefined));
vi.mock("../../shared-live-room-control/native-room-mission-steering", () => ({
  requireCurrentNativeHostedSteering: hostedGate, validateNativeHostedDispatchPreparation: hostedGate,
}));
import { migration087 } from "../../../db/migrations/087_pairing_ledger";
import { migration090 } from "../../../db/migrations/090_durable_steering";
import { migration093 } from "../../../db/migrations/093_room_external_task_result";
import { migration098 } from "../../../db/migrations/098_native_hosted_room_results";
import { HelixReasoningTaskBindingStore } from "../reasoning-task-binding-store";
import { DurableReasoningBindingAccess } from "../durable-reasoning-binding-access";
import { PairingLedgerRepository } from "../pairing-ledger-repository";
import { DurableSteeringRepository } from "../durable-steering-repository";
import { createPairingLedgerRow, acceptPairingLedgerRow, pairingApprovalSchema } from "../pairing-ledger-contract";
import { RoomMissionResultRepository, createRoomMissionResult } from "../room-mission-result";
import { RoomExternalMissionError } from "../room-external-mission-store";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
import { hostedResultEnvelope, hostedResultRecord, resultFixtureNow, resultFixtureText } from "./native-hosted-room-result-fixture";

const pools: Array<{ end(): Promise<void> }> = [];
beforeEach(() => { hostedGate.mockReset().mockResolvedValue(undefined); });
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(pool => pool.end())); });

async function fixture() {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  const envelope = hostedResultEnvelope(), vault = ephemeralPairingVault();
  let now = resultFixtureNow;
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ($1)", [envelope.ownerProfileId]);
  const db = await pool.connect();
  try { for (const migration of [migration087, migration090, migration093, migration098]) await migration.run(db, { enablePgvector: false }); }
  finally { db.release(); }
  const destination = { issuer: "fixture:issuer", profileId: envelope.ownerProfileId,
    installationId: envelope.hosted!.device_ref, clientId: envelope.authenticatedMcpClientRef, taskId: envelope.clientContinuationRef };
  const ledger = new PairingLedgerRepository(pool, vault, async () => {});
  const grant = createPairingLedgerRow({ id: "pairing:result", requestDigest: "a".repeat(64), acceptanceSecretDigest: "b".repeat(64),
    consentReceiptId: "consent:pairing", approval: pairingApprovalSchema.parse({ destination, chatId: envelope.helixConversationId,
      environment: null, scope: "exact_chat_steering", policyRevision: 1 }) }, now);
  await ledger.insert(grant); await ledger.compareAndSwap(acceptPairingLedgerRow(grant, destination, now), grant.revision);
  const presence = { active: true, service_instance_ref: "service:results", authenticated_profile_ref: envelope.ownerProfileId,
    authenticated_mcp_client_ref: envelope.authenticatedMcpClientRef, client_session_ref: envelope.clientSessionRef,
    conversation_thread_ref: envelope.clientContinuationRef, observed_at: now.toISOString(),
    heartbeat_expires_at: new Date(now.getTime() + 120000).toISOString() };
  const store = new HelixReasoningTaskBindingStore({ serviceInstanceRef: "service:results", listPresence: () => [presence] } as never,
    () => now);
  const flush = vi.fn(async () => {});
  const results = new RoomMissionResultRepository(pool, vault, flush, "hosted");
  const localFactory = vi.fn(async () => new RoomMissionResultRepository(pool, vault, async () => {}));
  const hostedFactory = vi.fn(async () => results);
  const makeAccess = () => new DurableReasoningBindingAccess(store, async () => {}, async () => ledger,
    () => now, async () => new DurableSteeringRepository(pool, vault, async () => {}), localFactory, hostedFactory);
  const access = makeAccess();
  const binding = await access.restore({ destination, clientSessionRef: envelope.clientSessionRef, pairingId: grant.id });
  envelope.bindingId = binding.reasoning_binding_id; envelope.bindingEpoch = binding.binding_epoch;
  const task = { profileRef: envelope.ownerProfileId, bindingId: envelope.bindingId, bindingEpoch: envelope.bindingEpoch,
    authenticatedMcpClientRef: envelope.authenticatedMcpClientRef, clientSessionRef: envelope.clientSessionRef,
    clientContinuationRef: envelope.clientContinuationRef, helixConversationId: envelope.helixConversationId, missionId: null, runId: null };
  const event = await access.dispatch({ ...task, clientEventRef: "handoff:result", origin: "gpt_live_finalized",
    instructionText: resultFixtureText, roomMission: envelope });
  const input = { ...task, request: { ...hostedResultRecord().request, steeringEventRef: event.steering_event_ref } };
  const acknowledge = async () => {
    await access.readForTask(task);
    return access.acknowledgeForTask({ ...task, eventRef: event.steering_event_ref });
  };
  const read = () => access.readCurrentNativeHostedRoomResultEvidence({ ownerProfileId: task.profileRef, steeringEventRef: event.steering_event_ref });
  return { pool, envelope, results, localFactory, hostedFactory, makeAccess, access, task, event, input, acknowledge, read, flush,
    advance: () => { now = new Date(now.getTime() + 86400000); } };
}

it("returns one private result for an acknowledged durable instruction and recovers it through current source admission", async () => {
  const f = await fixture(); await f.acknowledge(); hostedGate.mockClear();
  const receipt = await f.access.submitRoomMissionResult(f.input);
  expect(receipt).toMatchObject({ observation_recorded: true, room_publication_attempted: false,
    answer_authority: false, terminal_eligible: false, raw_content_included: false });
  expect(JSON.stringify(receipt)).not.toMatch(/task:private|connection:private|session:private|A private task report/);
  expect(hostedGate).toHaveBeenCalledTimes(3);
  expect(await f.makeAccess().submitRoomMissionResult(f.input)).toEqual(receipt);
  expect((await f.read()).request).toEqual(f.input.request);
  expect(f.localFactory).not.toHaveBeenCalled();
  await expect(f.access.readCurrentRoomMissionResultEvidence({ ownerProfileId: f.task.profileRef,
    steeringEventRef: f.event.steering_event_ref })).rejects.toMatchObject({ code: "room_task_result_not_found" });
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
});

it("rejects a result before instruction acknowledgement without opening result storage", async () => {
  const f = await fixture();
  await expect(f.access.submitRoomMissionResult(f.input)).rejects.toMatchObject({ code: "room_task_result_pickup_unconfirmed" });
  expect(f.hostedFactory).not.toHaveBeenCalled();
});

it("requires exact-task pickup before fresh durable room acknowledgement", async () => {
  const f = await fixture();
  await expect(f.access.acknowledgeForTask({ ...f.task, eventRef: f.event.steering_event_ref }))
    .rejects.toMatchObject({ code: "reasoning_steering_pickup_required" });
  expect(await f.access.inspectEvent({ ...f.task, eventRef: f.event.steering_event_ref }))
    .toMatchObject({ delivery_state: "pending", picked_up_at: null, acknowledged_at: null });
  const deliveries = await f.access.readForTask(f.task);
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].event).toMatchObject({ delivery_state: "picked_up", picked_up_at: expect.any(String) });
  expect(await f.access.acknowledgeForTask({ ...f.task, eventRef: f.event.steering_event_ref }))
    .toMatchObject({ delivery_state: "acknowledged", acknowledged_at: expect.any(String) });
});

it.each(["clientContinuationRef", "profileRef", "clientSessionRef"])("rejects a result from a changed %s", async key => {
  const f = await fixture(); await f.acknowledge();
  await expect(f.access.submitRoomMissionResult({ ...f.input, [key]: "identity:other" })).rejects.toThrow();
  expect(f.hostedFactory).not.toHaveBeenCalled();
});

it.each(["room_mission_not_current", "room_mission_hosted_authority_unavailable"])("withholds writes and reads when the current claim check returns %s", async code => {
  const f = await fixture(); await f.acknowledge(); await f.access.submitRoomMissionResult(f.input);
  hostedGate.mockRejectedValue(new RoomExternalMissionError(code, code.endsWith("unavailable") ? 503 : 409));
  await expect(f.access.submitRoomMissionResult(f.input)).rejects.toMatchObject({ code });
  await expect(f.read()).rejects.toMatchObject({ code });
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
});

it("rechecks claim authority after result repository initialization and before saving", async () => {
  const f = await fixture(); await f.acknowledge();
  f.hostedFactory.mockImplementationOnce(async () => {
    hostedGate.mockRejectedValue(new RoomExternalMissionError("room_mission_not_current", 409)); return f.results;
  });
  await expect(f.access.submitRoomMissionResult(f.input)).rejects.toMatchObject({ code: "room_mission_not_current" });
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toEqual([]);
});

it("withholds the receipt if authority changes after commit without erasing or duplicating the private observation", async () => {
  const f = await fixture(); await f.acknowledge();
  const submit = f.results.submit.bind(f.results);
  vi.spyOn(f.results, "submit").mockImplementationOnce(async row => {
    const result = await submit(row);
    hostedGate.mockRejectedValue(new RoomExternalMissionError("room_mission_not_current", 409)); return result;
  });
  await expect(f.access.submitRoomMissionResult(f.input)).rejects.toMatchObject({ code: "room_mission_not_current" });
  await expect(f.read()).rejects.toMatchObject({ code: "room_mission_not_current" });
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
});

it("rejects changed result text and stored source metadata for an existing event", async () => {
  const f = await fixture(); await f.acknowledge();
  const forged = createRoomMissionResult({ ownerProfileId: f.task.profileRef, request: f.input.request,
    envelope: { ...f.envelope, handoffId: "handoff:another-capture" }, now: resultFixtureNow });
  await f.results.submit(forged);
  await expect(f.read()).rejects.toMatchObject({ code: "room_task_result_source_mismatch" });
  await expect(f.access.submitRoomMissionResult(f.input)).rejects.toMatchObject({ code: "room_task_result_request_conflict" });
});

it("withholds receipt on lost snapshot confirmation and resolves one record on a later explicit identical retry", async () => {
  const f = await fixture(); await f.acknowledge();
  f.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("fixture snapshot unavailable"));
  await expect(f.access.submitRoomMissionResult(f.input)).rejects.toThrow("fixture snapshot unavailable");
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
  expect(await f.makeAccess().submitRoomMissionResult(f.input)).toMatchObject({ observation_recorded: true });
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
});

it("does not use a stored observation to restore an expired task pairing", async () => {
  const f = await fixture(); await f.acknowledge(); await f.access.submitRoomMissionResult(f.input); f.advance();
  await expect(f.read()).rejects.toThrow();
  await expect(f.access.submitRoomMissionResult(f.input)).rejects.toThrow();
});
