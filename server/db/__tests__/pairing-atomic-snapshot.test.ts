import { expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PairingLedgerRepository } from "../../services/local-supervisor/pairing-ledger-repository";
import { createPairingLedgerRow, pairingApprovalSchema, acceptPairingLedgerRow, acceptPairingReplacement } from "../../services/local-supervisor/pairing-ledger-contract";
import { PairingTransitionService } from "../../services/local-supervisor/pairing-transition-service";
import { ephemeralPairingVault } from "../../services/local-supervisor/__tests__/pairing-vault-fixture";

vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

it("O2/O5 atomic encrypted ledger pair rejects partial conflict and restores both committed rows from disk", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-pairing-atomic-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  const codec = ephemeralPairingVault();
  const flush = vi.fn(() => db.requireDurableDatabaseSnapshot(["helix_pairing_ledger"]));
  const repository = () => new PairingLedgerRepository(db.getPool(), codec, flush, db.commitPairingLedgerWrites);
  const actor = { issuer: "fixture-issuer", profileId: "fixture-owner", installationId: "fixture-install", clientId: "fixture-client", taskId: "fixture-private-task" };
  const at = new Date("2026-09-12T12:00:00Z");
  const secret = crypto.randomBytes(32).toString("base64url");
  const transitions = () => new PairingTransitionService(repository(), {
    destination: async (credential: string) => {
      if (credential !== "fixture-provider") throw new Error("fixture-provider-required");
      return actor;
    }, humanOwner: async (credential: string) => {
      if (credential !== "fixture-human") throw new Error("fixture-human-required");
      return actor.profileId;
    },
  }, () => at);
  const make = (id: string, digest: string) => createPairingLedgerRow({ id, requestDigest: digest.repeat(64),
    acceptanceSecretDigest: crypto.createHash("sha256").update(secret).digest("hex"), consentReceiptId: "fixture-consent",
    approval: pairingApprovalSchema.parse({ destination: actor, chatId: "fixture-chat", environment: null,
      scope: "exact_chat_steering", policyRevision: 1 }) }, at);
  try {
    await db.ensureDatabase();
    await db.getPool().query("INSERT INTO helix_accounts(profile_id,display_name) VALUES ('fixture-owner','Fixture')");
    await db.requireDurableDatabaseSnapshot(["helix_accounts"]);
    const old = make("pairing:old", "a");
    const independent = make("pairing:new", "b");
    const fresh = { ...independent, approval: pairingApprovalSchema.parse({ ...independent.approval,
      policyRevision: 2, replacement: { pairingId: old.id, revision: 2 } }) };
    await repository().insert(old); await repository().insert(fresh);
    const acceptedOld = acceptPairingLedgerRow(old, actor, at);
    await repository().compareAndSwap(acceptedOld, 1);
    const prepared = acceptPairingReplacement(fresh, acceptedOld, actor, at);
    const supersededOld = prepared.predecessor, acceptedNew = prepared.replacement;
    expect(await repository().compareAndSwapPair({ row: supersededOld, expectedRevision: 2 },
      { row: { ...acceptedNew, requestDigest: "d".repeat(64) }, expectedRevision: 1 })).toBe(false);
    expect(await repository().read(actor.profileId, old.id)).toEqual(acceptedOld);
    expect(await repository().read(actor.profileId, fresh.id)).toEqual(fresh);
    // A failed persistence reply does not undo the atomic commit. Same-ID
    // reconciliation must persist both rows without repeating either change.
    flush.mockRejectedValueOnce(new Error("fixture-lost-durability-reply"));
    await expect(transitions().accept("fixture-provider", { id: fresh.id, secret }))
      .rejects.toThrow("fixture-lost-durability-reply");
    const accepted = await transitions().accept("fixture-provider", { id: fresh.id, secret });
    expect(accepted).toMatchObject({ state: "accepted", revision: 2, pairingExpiresAt: fresh.pairingExpiresAt });
    const snapshot = readFileSync(snapshotPath, "utf8");
    expect(snapshot).not.toContain(actor.taskId);
    expect(JSON.parse(snapshot).tables.helix_pairing_ledger).toHaveLength(2);
    await db.resetDbClient(); await db.ensureDatabase();
    expect(await repository().read(actor.profileId, old.id)).toEqual(supersededOld);
    expect(await repository().read(actor.profileId, fresh.id)).toEqual(acceptedNew);
    await expect(transitions().recover("fixture-provider", old.id)).rejects.toThrow("pairing_superseded");
    await expect(transitions().accept("fixture-provider", { id: old.id, secret })).rejects.toThrow("pairing_superseded");
    expect(await transitions().recover("fixture-provider", fresh.id)).toEqual(accepted);
    await transitions().revoke("fixture-human", fresh.id);
    await db.resetDbClient(); await db.ensureDatabase();
    await expect(transitions().recover("fixture-provider", old.id)).rejects.toThrow("pairing_superseded");
    await expect(transitions().recover("fixture-provider", fresh.id)).rejects.toThrow("pairing_revoked");
  } finally {
    await db.resetDbClient(); vi.unstubAllEnvs();
    try { unlinkSync(snapshotPath); } catch {}
    try { unlinkSync(`${snapshotPath}.last-good`); } catch {}
    rmdirSync(directory);
  }
}, 60000);
