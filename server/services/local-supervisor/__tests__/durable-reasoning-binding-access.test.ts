import { afterEach, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import { migration087 } from "../../../db/migrations/087_pairing_ledger";
import { migration090 } from "../../../db/migrations/090_durable_steering";
import { migration119 } from "../../../db/migrations/119_personal_task_results";
import type { HelixLocalSupervisorPresence } from "@shared/helix-local-supervisor-coordination";
import { DurableSteeringRepository } from "../durable-steering-repository";
import { PairingLedgerRepository } from "../pairing-ledger-repository";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
import { createPairingLedgerRow, acceptPairingLedgerRow, pairingApprovalSchema, revokePairingLedgerRow } from "../pairing-ledger-contract";
import { HelixReasoningTaskBindingStore } from "../reasoning-task-binding-store";
import { DurableReasoningBindingAccess } from "../durable-reasoning-binding-access";
import { PersonalTaskResultRepository } from "../personal-task-result";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
const actor = { issuer: "fixture-issuer", profileId: "fixture-owner", installationId: "fixture-device",
  clientId: "fixture-client", taskId: "fixture-task" };

async function fixture() {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('fixture-owner')");
  const client = await pool.connect();
  try { await migration087.run(client, { enablePgvector: false }); await migration090.run(client, { enablePgvector: false });
    await migration119.run(client, { enablePgvector: false }); } finally { client.release(); }
  const now = new Date("2026-09-08T12:00:00Z");
  const flush = vi.fn(async () => {});
  const repository = new PairingLedgerRepository(pool, ephemeralPairingVault(), flush);
  const row = createPairingLedgerRow({ id: "fixture-grant", consentReceiptId: "fixture-human-consent",
    requestDigest: "a".repeat(64), acceptanceSecretDigest: "b".repeat(64),
    approval: pairingApprovalSchema.parse({ destination: actor, chatId: "fixture-chat", environment: null,
      scope: "exact_chat_steering", policyRevision: 1 }) }, now);
  await repository.insert(row);
  const accepted = acceptPairingLedgerRow(row, actor, now);
  await repository.compareAndSwap(accepted, row.revision);
  const entries: HelixLocalSupervisorPresence[] = [];
  const store = new HelixReasoningTaskBindingStore({ serviceInstanceRef: "fixture-service", listPresence: () => entries }, () => now);
  const authorize = vi.fn(async () => {});
  const steering = new DurableSteeringRepository(pool, ephemeralPairingVault(), flush);
  const personal = new PersonalTaskResultRepository(pool, ephemeralPairingVault(), flush);
  const access = new DurableReasoningBindingAccess(store, authorize, async () => repository, () => now,
    async () => steering, undefined, undefined, undefined, async () => personal);
  const binding = await access.restore({ destination: actor, clientSessionRef: "fixture-session", pairingId: row.id });
  const identity = { profileRef: actor.profileId, bindingId: binding.reasoning_binding_id,
    bindingEpoch: binding.binding_epoch, clientSessionRef: "fixture-session" };
  return { repository, store, access, binding, identity, accepted, flush, now, authorize, entries };
}

it("resolves a mirror target only from the current owner's accepted exact-chat pairing", async () => {
  const h = await fixture();
  await expect(h.access.resolveOwnedMirrorTarget({ ...h.identity, helixConversationId: "fixture-chat" }))
    .resolves.toMatchObject({ taskId: actor.taskId,
      bindingId: h.binding.reasoning_binding_id, bindingEpoch: h.binding.binding_epoch });
  await expect(h.access.resolveOwnedMirrorTarget({ ...h.identity, profileRef: "fixture-other-owner",
    helixConversationId: "fixture-chat" })).rejects.toThrow("reasoning_binding_identity_mismatch");
  await expect(h.access.resolveOwnedMirrorTarget({ ...h.identity, helixConversationId: "fixture-other-chat" }))
    .rejects.toThrow("reasoning_binding_identity_mismatch");
  const revoked = revokePairingLedgerRow(h.accepted, actor.profileId, h.now);
  await h.repository.compareAndSwap(revoked, h.accepted.revision);
  await expect(h.access.resolveOwnedMirrorTarget({ ...h.identity, helixConversationId: "fixture-chat" }))
    .rejects.toThrow("pairing_revoked");
});

it("stops resolving the former task when the owner selects a newer accepted pairing for the same chat", async () => {
  const h = await fixture();
  const nextActor = { ...actor, taskId: "fixture-next-task" };
  const nextRow = createPairingLedgerRow({ id: "fixture-next-grant", consentReceiptId: "fixture-next-consent",
    requestDigest: "c".repeat(64), acceptanceSecretDigest: "d".repeat(64),
    approval: pairingApprovalSchema.parse({ destination: nextActor, chatId: "fixture-chat", environment: null,
      scope: "exact_chat_steering", policyRevision: 1 }) }, h.now);
  await h.repository.insert(nextRow);
  await h.repository.compareAndSwap(acceptPairingLedgerRow(nextRow, nextActor, h.now), nextRow.revision);
  const next = await h.access.restore({ destination: nextActor,
    clientSessionRef: "fixture-next-session", pairingId: nextRow.id });
  expect(next.binding_epoch).toBeGreaterThan(h.binding.binding_epoch);
  await expect(h.access.inspect({ profileRef: actor.profileId, bindingId: h.binding.reasoning_binding_id }))
    .resolves.toMatchObject({ status: "active" });
  await expect(h.access.resolveOwnedMirrorTarget({ ...h.identity, helixConversationId: "fixture-chat" }))
    .rejects.toThrow("reasoning_binding_identity_mismatch");
  await expect(h.access.resolveOwnedMirrorTarget({ profileRef: actor.profileId,
    bindingId: next.reasoning_binding_id, helixConversationId: "fixture-chat" }))
    .resolves.toMatchObject({ taskId: nextActor.taskId, bindingId: next.reasoning_binding_id });
});

it("keeps two accepted tasks in different Helix chats active and rejects cross-chat reads", async () => {
  const h = await fixture();
  const secondActor = { ...actor, taskId: "fixture-second-task" };
  const secondRow = createPairingLedgerRow({ id: "fixture-second-grant",
    consentReceiptId: "fixture-second-consent", requestDigest: "e".repeat(64),
    acceptanceSecretDigest: "f".repeat(64),
    approval: pairingApprovalSchema.parse({ destination: secondActor, chatId: "fixture-second-chat",
      environment: null, scope: "exact_chat_steering", policyRevision: 1 }) }, h.now);
  await h.repository.insert(secondRow);
  await h.repository.compareAndSwap(acceptPairingLedgerRow(secondRow, secondActor, h.now), secondRow.revision);
  const second = await h.access.restore({ destination: secondActor,
    clientSessionRef: "fixture-second-session", pairingId: secondRow.id });
  const secondIdentity = { profileRef: actor.profileId, bindingId: second.reasoning_binding_id,
    bindingEpoch: second.binding_epoch, clientSessionRef: "fixture-second-session" };
  await expect(h.access.resolveOwnedMirrorTarget({ ...h.identity, helixConversationId: "fixture-chat" }))
    .resolves.toMatchObject({ taskId: actor.taskId });
  await expect(h.access.resolveOwnedMirrorTarget({ ...secondIdentity,
    helixConversationId: "fixture-second-chat" })).resolves.toMatchObject({ taskId: secondActor.taskId });
  await expect(h.access.resolveOwnedMirrorTarget({ ...h.identity,
    helixConversationId: "fixture-second-chat" })).rejects.toThrow("reasoning_binding_identity_mismatch");
  await expect(h.access.resolveOwnedMirrorTarget({ ...secondIdentity,
    helixConversationId: "fixture-chat" })).rejects.toThrow("reasoning_binding_identity_mismatch");
  await h.access.dispatch({ ...h.identity, clientEventRef: "fixture-first-event", origin: "typed",
    instructionText: "First chat only." });
  await h.access.dispatch({ ...secondIdentity, clientEventRef: "fixture-second-event", origin: "typed",
    instructionText: "Second chat only." });
  const firstEvents = await h.access.readForChatDisplay({ ...h.identity,
    helixConversationId: "fixture-chat", runId: null });
  const secondEvents = await h.access.readForChatDisplay({ ...secondIdentity,
    helixConversationId: "fixture-second-chat", runId: null });
  expect(firstEvents.map(event => event.instruction_text)).toEqual(["First chat only."]);
  expect(secondEvents.map(event => event.instruction_text)).toEqual(["Second chat only."]);
});

it("returns an acknowledged personal task report only to the current owner and grant", async () => {
  const h = await fixture();
  const turn = "managed-turn:11111111-1111-4111-8111-111111111111";
  const request = { ...h.identity,
    clientEventRef: `managed-chat:${turn}:22222222-2222-4222-8222-222222222222`,
    origin: "typed" as const, instructionText: "Observe the selected Minecraft player." };
  const event = await h.access.dispatch(request);
  const association = { ...h.identity, authenticatedMcpClientRef: actor.clientId,
    clientContinuationRef: actor.taskId, helixConversationId: "fixture-chat",
    missionId: null, runId: null };
  h.entries.push({
    schema: "helix.local_supervisor_coordination.v1", service_instance_ref: "fixture-service",
    client_session_ref: "fixture-session", conversation_thread_ref: actor.taskId,
    authenticated_profile_ref: actor.profileId, authenticated_mcp_client_ref: actor.clientId,
    declared_objective_summary: "Poll owner-reviewed steering", declared_objective_is_verified: false,
    lifecycle_basis: "authenticated_client_heartbeat", lifecycle_state: "active",
    resource_claims: [], room_ref: null, environment_ref: null, run_ref: null,
    verified_room_identity: null, verified_connector_identity: null,
    verified_retained_runtime_identity: null, verified_execution_lease_identity: null,
    blocker_summary: null, observed_at: h.now.toISOString(),
    heartbeat_expires_at: new Date(h.now.getTime() + 120_000).toISOString(), active: true,
    credential_included: false, private_endpoint_included: false, hidden_reasoning_included: false,
    native_account_identity_included: false, content_role: "supervisor_presence_advisory",
    answer_authority: false, assistant_answer: false, terminal_eligible: false,
    raw_content_included: false,
  });
  const report = { steeringEventRef: event.steering_event_ref, status: "completed" as const,
    resultText: "Codex reports a nearby stone block; no game effect verified.", evidenceRefs: [] };
  await expect(h.access.submitPersonalTaskResult({ ...association, request: report }))
    .rejects.toThrow("personal_task_result_source_not_admitted");
  expect(await h.access.readForTask(association)).toHaveLength(1);
  await h.access.acknowledgeForTask({ ...association, eventRef: event.steering_event_ref });
  const saved = await h.access.submitPersonalTaskResult({ ...association, request: report });
  expect(saved.sourceTurnId).toBe(turn);
  expect(await h.access.submitPersonalTaskResult({ ...association, request: report })).toEqual(saved);
  expect(await h.access.readCurrentPersonalTaskResultEvidence({ ownerProfileId: actor.profileId,
    bindingId: h.binding.reasoning_binding_id, bindingEpoch: h.binding.binding_epoch,
    steeringEventRef: event.steering_event_ref })).toEqual(saved);
  await expect(h.access.readCurrentPersonalTaskResultEvidence({ ownerProfileId: "fixture-other-owner",
    bindingId: h.binding.reasoning_binding_id, bindingEpoch: h.binding.binding_epoch,
    steeringEventRef: event.steering_event_ref })).rejects.toThrow();
  const revoked = revokePairingLedgerRow(h.accepted, actor.profileId, h.now);
  await h.repository.compareAndSwap(revoked, h.accepted.revision);
  await expect(h.access.readCurrentPersonalTaskResultEvidence({ ownerProfileId: actor.profileId,
    bindingId: h.binding.reasoning_binding_id, bindingEpoch: h.binding.binding_epoch,
    steeringEventRef: event.steering_event_ref })).rejects.toThrow("pairing_revoked");
  expect(await h.access.readOwnerPersonalTaskResultHistory({ ownerProfileId: actor.profileId,
    helixConversationId: "fixture-chat" })).toEqual([saved]);
  expect(await h.access.readOwnerPersonalTaskResultHistory({ ownerProfileId: actor.profileId,
    helixConversationId: "another-chat" })).toEqual([]);
  expect(await h.access.readOwnerPersonalTaskResultHistory({ ownerProfileId: "fixture-other-owner",
    helixConversationId: "fixture-chat" })).toEqual([]);
});

it("rechecks the encrypted grant for dispatch, pickup, acknowledgement and browser display", async () => {
  const h = await fixture();
  const read = vi.spyOn(h.repository, "read");
  const request = { ...h.identity, clientEventRef: "fixture-event", origin: "typed" as const, instructionText: "Inspect the surroundings." };
  const event = await h.access.dispatch(request);
  expect(await h.access.dispatch(request)).toEqual(event);
  expect(await h.access.read(h.identity)).toHaveLength(1);
  expect(await h.access.acknowledge({ ...h.identity, eventRef: event.steering_event_ref }))
    .toMatchObject({ delivery_state: "acknowledged" });
  expect(await h.access.readForChatDisplay({ ...h.identity, helixConversationId: "fixture-chat", runId: null }))
    .toHaveLength(1);
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(5); // Includes post-commit admission checks.
  expect(() => h.store.read(h.identity)).toThrow("reasoning_binding_durable_preflight_required");
  const revoked = revokePairingLedgerRow(h.accepted, actor.profileId, h.now);
  await h.repository.compareAndSwap(revoked, h.accepted.revision);
  for (const operation of [() => h.access.dispatch(request), () => h.access.read(h.identity),
    () => h.access.acknowledge({ ...h.identity, eventRef: event.steering_event_ref }),
    () => h.access.inspect(h.identity), () => h.access.inspectEvent({ ...h.identity, eventRef: event.steering_event_ref }),
    () => h.access.readForChatDisplay({ ...h.identity, helixConversationId: "fixture-chat", runId: null })]) {
    await expect(operation()).rejects.toThrow("pairing_revoked");
  }
});

it("rejects storage failure, foreign owner and wrong task without cached authority", async () => {
  const h = await fixture();
  h.flush.mockRejectedValueOnce(new Error("fixture-disk-unavailable"));
  await expect(h.access.read(h.identity)).rejects.toMatchObject({ code: "reasoning_binding_verification_failed", phase: "durability" });
  await expect(h.access.read({ ...h.identity, profileRef: "fixture-other-owner" })).rejects.toThrow("reasoning_binding_identity_mismatch");
  await expect(h.access.restore({ destination: { ...actor, taskId: "fixture-other-task" },
    clientSessionRef: "fixture-session", pairingId: h.accepted.id })).rejects.toThrow("pairing_destination_mismatch");
  expect(await h.access.inspect(h.identity)).toEqual(h.binding);
  h.authorize.mockRejectedValueOnce(new Error("fixture-trust-revoked"));
  await expect(h.access.read(h.identity)).rejects.toMatchObject({ code: "reasoning_binding_verification_failed", phase: "destination" });
});

it("preserves typed conflicts, missing events and expiry on durable steering", async () => {
  const h = await fixture();
  const request = { ...h.identity, clientEventRef: "fixture-typed-error", origin: "typed" as const,
    instructionText: "Inspect the surroundings.", expiresInSeconds: 30 };
  const event = await h.access.dispatch(request);
  await expect(h.access.dispatch({ ...request, instructionText: "Inspect the inventory." }))
    .rejects.toMatchObject({ code: "reasoning_steering_request_conflict", status: 409 });
  await expect(h.access.inspectEvent({ ...h.identity, eventRef: "reasoning_steering:missing" }))
    .rejects.toMatchObject({ code: "reasoning_steering_not_found", status: 404 });
  await expect(h.access.acknowledge({ ...h.identity, eventRef: "reasoning_steering:missing" }))
    .rejects.toMatchObject({ code: "reasoning_steering_not_found", status: 404 });
  h.now.setTime(h.now.getTime() + 30_000);
  await expect(h.access.acknowledge({ ...h.identity, eventRef: event.steering_event_ref }))
    .rejects.toMatchObject({ code: "reasoning_steering_expired", status: 409 });
  expect(await h.access.dispatch(request)).toMatchObject({ steering_event_ref: event.steering_event_ref,
    expires_at: event.expires_at, delivery_state: "expired" });
});

it("rejects superseded cached bindings before dispatch, pickup, acknowledgement or restoration", async () => {
  const h = await fixture();
  const request = { ...h.identity, clientEventRef: "fixture-before-supersession", origin: "typed" as const,
    instructionText: "Inspect the surroundings." };
  const event = await h.access.dispatch(request);
  // Admission-layer test of a persisted terminal record. Atomic creation of the
  // two-record relation is covered by the encrypted transition-service suite.
  await h.repository.compareAndSwap({ ...h.accepted, revision: 3,
    supersession: { pairingId: "fixture-successor", at: h.now.toISOString() } }, 2);
  const dispatch = vi.spyOn(h.store, "dispatch");
  const pickup = vi.spyOn(h.store, "read");
  const acknowledge = vi.spyOn(h.store, "acknowledge");
  for (const operation of [
    () => h.access.dispatch({ ...request, clientEventRef: "fixture-after-supersession" }),
    () => h.access.read(h.identity),
    () => h.access.acknowledge({ ...h.identity, eventRef: event.steering_event_ref }),
    () => h.access.inspect(h.identity),
    () => h.access.restore({ destination: actor, clientSessionRef: "fixture-session", pairingId: h.accepted.id }),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: "pairing_superseded", status: 409 });
  }
  expect(dispatch).not.toHaveBeenCalled();
  expect(pickup).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
});

it("persists owner revocation despite lost device trust and reconciles a lost commit reply", async () => {
  const h = await fixture();
  h.authorize.mockRejectedValue(new Error("fixture-trust-revoked"));
  await expect(h.access.revokeOwned(h.identity, async () => "fixture-other-owner")).rejects.toThrow("pairing_owner_mismatch");
  h.flush.mockRejectedValueOnce(new Error("fixture-lost-commit-reply"));
  await expect(h.access.revokeOwned(h.identity, async () => actor.profileId)).rejects.toThrow("fixture-lost-commit-reply");
  const revoked = await h.access.revokeOwned(h.identity, async () => actor.profileId);
  expect(revoked).toMatchObject({ status: "revoked", revoked_at: h.now.toISOString() });
  expect(await h.access.revokeOwned(h.identity, async () => actor.profileId)).toEqual(revoked);
  expect((await h.repository.read(actor.profileId, h.accepted.id))?.revision).toBe(3);
  h.authorize.mockResolvedValue(undefined);
  await expect(h.access.restore({ destination: actor, clientSessionRef: "fixture-session", pairingId: h.accepted.id }))
    .rejects.toThrow("pairing_revoked");
});

it("initializes one repository handle while every admission still flushes and reads the current grant", async () => {
  const h = await fixture();
  h.flush.mockClear(); h.authorize.mockClear();
  // Production initialization has its own durability barrier in addition to
  // the mandatory fresh barrier before each grant read.
  const initialize = vi.fn(async () => { await h.flush(); return h.repository; });
  const read = vi.spyOn(h.repository, "read");
  const access = new DurableReasoningBindingAccess(h.store, h.authorize, initialize, () => h.now);
  for (let index = 0; index < 3; index++) {
    expect(await access.inspect(h.identity)).toEqual(h.binding);
  }
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(h.authorize).toHaveBeenCalledTimes(3);
  expect(read).toHaveBeenCalledTimes(3);
  expect(h.flush).toHaveBeenCalledTimes(4);

  h.flush.mockRejectedValueOnce(new Error("fixture-durability-lost-after-initialization"));
  await expect(access.inspect(h.identity)).rejects.toMatchObject({ code: "reasoning_binding_verification_failed", phase: "durability" });
  expect(read).toHaveBeenCalledTimes(3);
  h.authorize.mockRejectedValueOnce(new Error("fixture-trust-revoked-after-initialization"));
  await expect(access.inspect(h.identity)).rejects.toMatchObject({ code: "reasoning_binding_verification_failed", phase: "destination" });
  expect(read).toHaveBeenCalledTimes(3);
  const revoked = revokePairingLedgerRow(h.accepted, actor.profileId, h.now);
  await h.repository.compareAndSwap(revoked, h.accepted.revision);
  await expect(access.inspect(h.identity)).rejects.toThrow("pairing_revoked");
  expect(read).toHaveBeenCalledTimes(4);
  expect(initialize).toHaveBeenCalledTimes(1);
});

it("shares initialization only within one access instance and retries a failed initialization only on a later call", async () => {
  const h = await fixture();
  const initialize = vi.fn(async () => h.repository)
    .mockRejectedValueOnce(new Error("fixture-initialization-unavailable"));
  const access = new DurableReasoningBindingAccess(h.store, h.authorize, initialize, () => h.now);
  const failed = await Promise.allSettled([access.inspect(h.identity), access.inspect(h.identity)]);
  expect(failed.map(result => result.status)).toEqual(["rejected", "rejected"]);
  for (const result of failed) {
    if (result.status === "rejected") expect(result.reason).toMatchObject({
      code: "reasoning_binding_verification_failed", phase: "repository", reason: "unexpected_failure",
    });
  }
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(await access.inspect(h.identity)).toEqual(h.binding);
  expect(await access.inspect(h.identity)).toEqual(h.binding);
  expect(initialize).toHaveBeenCalledTimes(2);
  const nextAccess = new DurableReasoningBindingAccess(h.store, h.authorize, initialize, () => h.now);
  expect(await nextAccess.inspect(h.identity)).toEqual(h.binding);
  expect(initialize).toHaveBeenCalledTimes(3);
});

it("rechecks the finite pairing deadline after repository initialization", async () => {
  const h = await fixture();
  const initialize = vi.fn(async () => h.repository);
  const read = vi.spyOn(h.repository, "read");
  const access = new DurableReasoningBindingAccess(h.store, h.authorize, initialize, () => h.now);
  expect(await access.inspect(h.identity)).toEqual(h.binding);
  h.now.setTime(Date.parse(h.accepted.pairingExpiresAt));
  await expect(access.inspect(h.identity)).rejects.toThrow("pairing_expired");
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(2);
});
