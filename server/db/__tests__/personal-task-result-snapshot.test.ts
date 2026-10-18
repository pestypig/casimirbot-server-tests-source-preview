import { expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { ephemeralPairingVault } from "../../services/local-supervisor/__tests__/pairing-vault-fixture";
import { PairingLedgerRepository } from "../../services/local-supervisor/pairing-ledger-repository";
import { DurableSteeringRepository } from "../../services/local-supervisor/durable-steering-repository";
import { PersonalTaskResultRepository, createPersonalTaskResult,
  PERSONAL_TASK_RESULT_TABLE } from "../../services/local-supervisor/personal-task-result";
import { acceptPairingLedgerRow, createPairingLedgerRow,
  pairingApprovalSchema } from "../../services/local-supervisor/pairing-ledger-contract";
import { acknowledgeDurableSteering, createDurableSteering } from
  "../../services/local-supervisor/durable-steering-contract";

vi.mock("../../services/runtime/runtime-memory-governor", () => ({
  scheduleRuntimeIdleMemorySettle: () => undefined,
}));

it("restores an encrypted personal task report after rebuilding the local database", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-personal-report-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64url"));
  const db = await import("../client");
  const vault = ephemeralPairingVault();
  const flush = () => db.requireDurableDatabaseSnapshot([PERSONAL_TASK_RESULT_TABLE]);
  try {
    await db.ensureDatabase();
    await db.getPool().query("INSERT INTO helix_accounts(profile_id, display_name) VALUES ('fixture-owner', 'Fixture Owner')");
    await db.requireDurableDatabaseSnapshot(["helix_accounts"]);
    const now = new Date("2026-09-29T18:00:00.000Z");
    const destination = { issuer: "fixture-issuer", profileId: "fixture-owner",
      installationId: "fixture-device", clientId: "fixture-client", taskId: "fixture-task" };
    const pending = createPairingLedgerRow({ id: "fixture-report-grant",
      requestDigest: "a".repeat(64), acceptanceSecretDigest: "b".repeat(64),
      consentReceiptId: "fixture-consent", approval: pairingApprovalSchema.parse({
        destination, chatId: "fixture-chat", environment: null, scope: "exact_chat_steering",
        policyRevision: 1,
      }) }, now);
    const pairing = new PairingLedgerRepository(db.getPool(), vault,
      () => db.requireDurableDatabaseSnapshot(["helix_pairing_ledger"]));
    await pairing.insert(pending);
    const grant = acceptPairingLedgerRow(pending, destination, new Date(now.getTime() + 1000));
    await pairing.compareAndSwap(grant, pending.revision);
    const steering = new DurableSteeringRepository(db.getPool(), vault,
      () => db.requireDurableDatabaseSnapshot(["helix_durable_steering"]));
    const event = createDurableSteering(grant, { clientEventRef: "typed:33333333-3333-4333-8333-333333333333",
      origin: "typed", instructionText: "Check Minecraft connector status." }, 1,
    new Date(now.getTime() + 2000));
    await steering.insert(event);
    const acknowledged = acknowledgeDurableSteering(grant, event, new Date(now.getTime() + 3000));
    await steering.compareAndSwap(acknowledged, event.revision);
    const row = createPersonalTaskResult({ ownerProfileId: "fixture-owner", event: acknowledged,
      bindingId: "fixture-binding", bindingEpoch: 1, helixConversationId: "fixture-chat",
      runId: null, request: { steeringEventRef: event.id, status: "completed",
        resultText: "Connector offline; no game action attempted.", evidenceRefs: ["fixture-evidence"] },
      now: new Date(now.getTime() + 4000) });
    const reports = new PersonalTaskResultRepository(db.getPool(), vault, flush);
    await reports.submit(row);
    const snapshot = readFileSync(snapshotPath, "utf8");
    expect(JSON.parse(snapshot).tables[PERSONAL_TASK_RESULT_TABLE]).toHaveLength(1);
    expect(snapshot).not.toContain(row.request.resultText);
    await db.resetDbClient();
    await db.ensureDatabase();
    const restored = new PersonalTaskResultRepository(db.getPool(), vault, flush);
    expect(await restored.read("fixture-owner", event.id)).toEqual(row);
    expect(await restored.listRecentForOwner("fixture-owner")).toEqual([row]);
  } finally {
    await db.resetDbClient();
    vi.unstubAllEnvs();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
        !path.basename(resolved).startsWith("casimir-personal-report-"))
      throw new Error("fixture_cleanup_scope_invalid");
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);
