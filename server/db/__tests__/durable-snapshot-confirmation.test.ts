import { expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

async function fixture(run: (db: typeof import("../client"), snapshot: () => any, snapshotPath: string) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "casimir-durable-confirm-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_IDLE_FLUSH_MS", "60000");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_MAX_FLUSH_MS", "60000");
  const db = await import("../client");
  try {
    await db.ensureDatabase();
    await db.getPool().query("INSERT INTO helix_accounts(profile_id,display_name) VALUES ('fixture-confirm-owner','Before')");
    await db.requireDurableDatabaseSnapshot(["helix_accounts"]);
    await db.flushLocalDatabaseSnapshotIfEnabled();
    await run(db, () => JSON.parse(fs.readFileSync(snapshotPath, "utf8")), snapshotPath);
  } finally {
    vi.restoreAllMocks();
    await db.resetDbClient(); vi.unstubAllEnvs();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
}
const renameCount = (spy: ReturnType<typeof vi.spyOn>, target: string) => spy.mock.calls.filter((call: unknown[]) => call[1] === target).length;
const change = (db: typeof import("../client"), name: string) => db.getPool().query(
  "UPDATE helix_accounts SET display_name=$1 WHERE profile_id='fixture-confirm-owner'", [name]);

it("writes changed state before confirmation, then reuses that successful coverage", () => fixture(async (db, snapshot, target) => {
  const rename = vi.spyOn(fs.promises, "rename");
  await change(db, "Changed");
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Before");
  await db.confirmDurableDatabaseSnapshot(["helix_accounts"]);
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Changed");
  await db.confirmDurableDatabaseSnapshot(["helix_accounts"]);
  expect(renameCount(rename, target)).toBe(1);
}));

it("recollects only a named strict table when the cached snapshot has no dirty tables", () => fixture(async (db) => {
  const pool = db.getPool();
  const originalQuery = pool.query.bind(pool);
  const selectedTables: string[] = [];
  vi.spyOn(pool, "query").mockImplementation(((...args: any[]) => {
    const text = typeof args[0] === "string" ? args[0] : "";
    if (text.startsWith("SELECT * FROM ")) selectedTables.push(text);
    return (originalQuery as any)(...args);
  }) as any);
  await db.requireDurableDatabaseSnapshot(["helix_accounts"]);
  expect(selectedTables).toEqual(["SELECT * FROM helix_accounts;"]);
}));

it("rejects an uncertain failed save and persists it on an explicit later confirmation", () => fixture(async (db, snapshot, target) => {
  const rename = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("fixture-save-failed"));
  await change(db, "Changed");
  await expect(db.confirmDurableDatabaseSnapshot(["helix_accounts"])).rejects.toThrow("fixture-save-failed");
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Before");
  await db.confirmDurableDatabaseSnapshot(["helix_accounts"]);
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Changed");
  // The injected first failure occurs while replacing the verified recovery
  // copy, before the active snapshot rename. Only the successful retry reaches
  // the active path.
  expect(renameCount(rename, `${target}.last-good`)).toBe(2);
  expect(renameCount(rename, target)).toBe(1);
}));

it("does not establish coverage for a concurrent change during atomic replacement", () => fixture(async (db, snapshot) => {
  const originalRename = fs.promises.rename.bind(fs.promises);
  vi.spyOn(fs.promises, "rename").mockImplementationOnce(async (from, to) => {
    await change(db, "Concurrent");
    await originalRename(from, to);
  });
  await change(db, "Captured");
  await expect(db.confirmDurableDatabaseSnapshot(["helix_accounts"])).rejects.toThrow("durable_snapshot_changed_during_confirmation");
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Captured");
  await db.confirmDurableDatabaseSnapshot(["helix_accounts"]);
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Concurrent");
}));

it("does not mistake another strict save request for a data mutation", () => fixture(async (db, snapshot) => {
  const originalRename = fs.promises.rename.bind(fs.promises);
  let nextSave: Promise<void> | undefined;
  vi.spyOn(fs.promises, "rename").mockImplementationOnce(async (from, to) => {
    // A second reader requires its own strict acknowledgement while this save
    // is in flight, but changes no row. It must not invalidate the first read.
    nextSave = db.requireDurableDatabaseSnapshot(["helix_accounts"]);
    await originalRename(from, to);
  });
  await change(db, "Captured");
  const confirmation = await db.confirmDurableDatabaseSnapshot(["helix_accounts"])
    .then(() => "confirmed", error => error.message);
  await nextSave;
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Captured");
  expect(confirmation).toBe("confirmed");
}));

it("strictly recollects required transaction data even when only another table is marked dirty", () => fixture(async (db, snapshot) => {
  // Transaction callers explicitly name their commit tables at the barrier;
  // they need not depend on the pool.query mutation observer.
  const connection = await db.getPool().connect();
  try {
    await connection.query("UPDATE helix_accounts SET display_name='Transaction' WHERE profile_id='fixture-confirm-owner'");
  } finally { connection.release(); }
  await db.persistLocalDatabaseSnapshotIfEnabled(["helix_room_source_bindings"]);
  await db.requireDurableDatabaseSnapshot(["helix_accounts"]);
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Transaction");
}));

it("does not mistake a best-effort omitted table for confirmed durable state", () => fixture(async (db, snapshot) => {
  const pool = db.getPool();
  const originalQuery = pool.query.bind(pool);
  const query = vi.spyOn(pool, "query").mockImplementation(((...args: any[]) => {
    if (args[0] === "SELECT * FROM helix_accounts;") return Promise.reject(new Error("fixture-collection-failed"));
    return (originalQuery as any)(...args);
  }) as any);
  await change(db, "Changed");
  await db.flushLocalDatabaseSnapshotIfEnabled();
  expect(snapshot().tables.helix_accounts).toEqual([]);
  await expect(db.confirmDurableDatabaseSnapshot(["helix_accounts"])).rejects.toThrow("fixture-collection-failed");
  query.mockRestore();
  await db.confirmDurableDatabaseSnapshot(["helix_accounts"]);
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Changed");
}));

it("clears successful coverage on database reconstruction and validates table selectors", () => fixture(async (db, snapshot, target) => {
  await db.resetDbClient();
  await db.ensureDatabase();
  const rename = vi.spyOn(fs.promises, "rename");
  await expect(db.confirmDurableDatabaseSnapshot([])).rejects.toThrow("durable_snapshot_table_unknown");
  await expect(db.confirmDurableDatabaseSnapshot(["fixture_unknown"])).rejects.toThrow("durable_snapshot_table_unknown");
  await db.confirmDurableDatabaseSnapshot(["helix_accounts"]);
  expect(snapshot().tables.helix_accounts[0].display_name).toBe("Before");
  expect(renameCount(rename, target)).toBeGreaterThan(0);
}));

it("rejects confirmation on volatile-only storage", async () => {
  vi.stubEnv("DATABASE_URL", "pg-mem://fixture-volatile-confirmation");
  const db = await import("../client");
  try {
    await db.ensureDatabase();
    await expect(db.confirmDurableDatabaseSnapshot(["helix_accounts"])).rejects.toThrow("durable_database_unavailable");
  } finally { await db.resetDbClient(); vi.unstubAllEnvs(); }
});
