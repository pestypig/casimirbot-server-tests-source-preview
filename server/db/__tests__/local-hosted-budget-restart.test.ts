import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { migration026 } from "../migrations/026_helix_accounts";
import { migration101 } from "../migrations/101_local_hosted_budgets";
import { ZERO_HOSTED_UNITS, HOSTED_REQUEST_UPPER_BOUND } from "@shared/helix-hosted-budget";

// Only unrelated migrations are excluded. Serialization, file save, restoration,
// strict barrier and the real sponsor store execute unchanged.
vi.mock("../migrator", () => ({ runMigrations: async (pool: any) => {
  const c = await pool.connect();
  try { await migration026.run(c, { enablePgvector: false }); await migration101.run(c, { enablePgvector: false }); }
  finally { c.release(); }
} }));
vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

it("actual isolated snapshot reopen preserves dispatched/unknown and exactly-once reconciliation after failed save", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "casimir-local-hosted-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1"); vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  const { HostedBudgetStore } = await import("../../services/helix-account/hosted-budget-store");
  const create = () => new HostedBudgetStore({ localEnabled: () => true, production: () => false,
    now: () => new Date("2026-09-27T12:00:00Z") });
  try {
    await db.ensureDatabase();
    await db.getPool().query(`INSERT INTO helix_accounts(profile_id,display_name,account_type,provider,provider_subject)
      VALUES ('host','host','developer','local','host')`);
    await db.requireDurableDatabaseSnapshot(["helix_accounts"]);
    let store = create(); const t = await store.startTrial("host");
    await store.attachRoom({ sponsorProfileId: "host", termId: t.termId!, eligibilityRevision: 1,
      roomId: "room", guestProfileId: "guest", programId: "canvas" });
    await store.renewRoomLease("room", "host", { deliberate: true,
      upperBound: { ...ZERO_HOSTED_UNITS, databaseMillis: 600000 } });
    const input = { sponsorProfileId: "host", termId: t.termId!, eligibilityRevision: 1, roomId: "room",
      sponsorRevision: 1, memberProfileId: "guest", memberRevision: 1, programOwnerProfileId: "owner", nodeId: "node",
      programId: "canvas", documentId: "doc", documentRevision: 0, connectorEpoch: "epoch", grantId: "grant",
      requestId: "request", bodySha256: "a".repeat(64), upperBound: { ...HOSTED_REQUEST_UPPER_BOUND } };
    const r = await store.reserveEffect(input); await store.markDispatched(r.reservationId);
    await db.resetDbClient(); store = create();
    expect((await store.reserveEffect(input)).status).toBe("dispatched");
    await store.settleEffect({ reservationId: r.reservationId, outcome: "outcome_unknown", actual: ZERO_HOSTED_UNITS });
    await db.resetDbClient(); store = create();
    expect((await store.reserveEffect(input)).status).toBe("outcome_unknown");
    const settle = { reservationId: r.reservationId, outcome: "verified_success" as const,
      effectId: "durable-canvas-effect-1", evidenceRef: "canvas:revision:1", actual: { ...ZERO_HOSTED_UNITS, modeledCostMicrousd: 100 } };
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("fixture save failure"));
    await expect(store.settleEffect(settle)).rejects.toThrow("fixture save failure");
    rename.mockRestore();
    // Commit was already accepted in DB. Retry confirms and saves it; never
    // interpret acknowledgement failure as native no-effect or free capacity.
    await store.settleEffect(settle);
    await db.resetDbClient(); store = create();
    expect(await store.termStatus("host")).toMatchObject({ termId: t.termId, successfulEffects: 1, unresolvedEffects: 0 });
    expect((await store.reserveEffect(input)).status).toBe("verified_success");
    await store.settleEffect(settle);
    expect((await store.termStatus("host")).successfulEffects).toBe(1);
  } finally {
    vi.restoreAllMocks(); await db.resetDbClient(); vi.unstubAllEnvs();
    if (fs.existsSync(snapshot)) fs.unlinkSync(snapshot);
    fs.rmdirSync(directory);
  }
});
