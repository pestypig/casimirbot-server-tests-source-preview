import { newDb } from "pg-mem";
import { afterEach, expect, it } from "vitest";
import { migration119 } from "../../../db/migrations/119_personal_task_results";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
import { acceptPairingLedgerRow, createPairingLedgerRow,
  pairingApprovalSchema } from "../pairing-ledger-contract";
import { acknowledgeDurableSteering, createDurableSteering } from "../durable-steering-contract";
import { createPersonalTaskResult, PersonalTaskResultRepository,
  projectPersonalTaskResultReceipt } from "../personal-task-result";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
const now = new Date("2026-09-29T12:00:00.000Z");
const turn = "managed-turn:11111111-1111-4111-8111-111111111111";
const eventRef = `managed-chat:${turn}:22222222-2222-4222-8222-222222222222`;
const owner = "owner:personal";
const destination = { issuer: "fixture-issuer", profileId: owner,
  installationId: "fixture-device", clientId: "fixture-client", taskId: "fixture-task" };
const grant = acceptPairingLedgerRow(createPairingLedgerRow({ id: "pairing:personal",
  requestDigest: "a".repeat(64), acceptanceSecretDigest: "b".repeat(64),
  consentReceiptId: "consent:personal", approval: pairingApprovalSchema.parse({
    destination, chatId: "chat:personal", environment: null,
    scope: "exact_chat_steering", policyRevision: 1,
  }) }, now), destination, now);
const steering = acknowledgeDurableSteering(grant, createDurableSteering(grant, {
  clientEventRef: eventRef, origin: "typed", instructionText: "Observe my selected Minecraft player.",
  expiresInSeconds: 600,
}, 1, now), new Date(now.getTime() + 1000));
const args = { ownerProfileId: owner, event: steering,
  bindingId: "binding:personal", bindingEpoch: 2, helixConversationId: "chat:personal",
  runId: null, request: { steeringEventRef: steering.id, status: "completed" as const,
    resultText: "Codex reports a reachable stone block; verify native effect separately.",
    evidenceRefs: ["observation:stone"] }, now: new Date(now.getTime() + 2000) };

it("accepts only an acknowledged managed-chat task report, never a room or unpicked event", () => {
  const record = createPersonalTaskResult(args);
  expect(record.sourceTurnId).toBe(turn);
  expect(projectPersonalTaskResultReceipt(record)).toMatchObject({
    task_report_recorded: true, minecraft_effect_verified: false,
    answer_authority: false, terminal_eligible: false,
  });
  for (const event of [
    { ...steering, revision: 1, acknowledgedAt: null },
    { ...steering, request: { ...steering.request, clientEventRef: "typed:other" } },
  ]) expect(() => createPersonalTaskResult({ ...args, event: event as typeof steering }))
    .toThrow();
  expect(() => createPersonalTaskResult({ ...args, ownerProfileId: "owner:other" }))
    .toThrow("personal_task_result_source_not_admitted");
});

it("accepts an acknowledged Bound task typed request under the same exact-task checks", () => {
  const clientEventRef = "typed:33333333-3333-4333-8333-333333333333";
  const boundEvent = acknowledgeDurableSteering(grant, createDurableSteering(grant, {
    clientEventRef, origin: "typed", instructionText: "Read current Minecraft connector health.",
    expiresInSeconds: 600,
  }, 2, now), new Date(now.getTime() + 1000));
  const boundRequest = { ...args.request, steeringEventRef: boundEvent.id };
  const record = createPersonalTaskResult({ ...args, event: boundEvent, request: boundRequest });
  expect(record.sourceTurnId).toBe(clientEventRef);
  const pendingEvent = createDurableSteering(grant, {
    clientEventRef, origin: "typed", instructionText: "Read current Minecraft connector health.",
    expiresInSeconds: 600,
  }, 2, now);
  expect(() => createPersonalTaskResult({ ...args, event: pendingEvent,
    request: boundRequest })).toThrow("personal_task_result_source_not_admitted");
  expect(() => createPersonalTaskResult({ ...args, ownerProfileId: "owner:other",
    event: boundEvent, request: boundRequest })).toThrow("personal_task_result_source_not_admitted");
});

it("stores one encrypted personal report and rejects conflicting retries or metadata tampering", async () => {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_pairing_ledger(pairing_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_durable_steering(event_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('owner:personal')");
  await pool.query("INSERT INTO helix_pairing_ledger VALUES ('pairing:personal')");
  await pool.query("INSERT INTO helix_durable_steering VALUES ($1)", [steering.id]);
  const client = await pool.connect();
  try { await migration119.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  const repository = new PersonalTaskResultRepository(pool, ephemeralPairingVault(), async () => {});
  const row = createPersonalTaskResult(args);
  expect(await repository.submit(row)).toEqual(row);
  expect(await repository.submit(row)).toEqual(row);
  expect(await repository.read(owner, steering.id)).toEqual(row);
  expect(await repository.read("owner:other", steering.id)).toBeNull();
  const stored = (await pool.query("SELECT * FROM helix_personal_task_results")).rows[0];
  expect(JSON.stringify(stored)).not.toContain(args.request.resultText);
  const conflicting = createPersonalTaskResult({ ...args,
    request: { ...args.request, resultText: "Different result" } });
  await expect(repository.submit(conflicting)).rejects.toThrow("personal_task_result_request_conflict");
  await pool.query("UPDATE helix_personal_task_results SET source_turn_id='managed-turn:other'");
  await expect(repository.read(owner, steering.id)).rejects.toThrow("pairing_storage_identity_mismatch");
});
