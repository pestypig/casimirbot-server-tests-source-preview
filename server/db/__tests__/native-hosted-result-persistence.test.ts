import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { migration098 } from "../migrations/098_native_hosted_room_results";
import { ensureDatabase, getPool, resetDbClient, requireDurableDatabaseSnapshot } from "../client";
import { RoomMissionResultRepository, NATIVE_HOSTED_ROOM_RESULT_TABLE } from "../../services/local-supervisor/room-mission-result";
import { ephemeralPairingVault } from "../../services/local-supervisor/__tests__/pairing-vault-fixture";
import { hostedResultRecord } from "../../services/local-supervisor/__tests__/native-hosted-room-result-fixture";

vi.mock("../migrator", () => ({ runMigrations: async (pool: { connect(): Promise<any> }) => {
  const db = await pool.connect();
  try {
    await db.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
    await migration098.run(db, { enablePgvector: false });
  } finally { db.release(); }
} }));

it("requires the real hosted result snapshot and recovers its encrypted observation after database reopen", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "casimir-hosted-result-"));
  const snapshot = path.join(directory, "snapshot.json"), vault = ephemeralPairingVault(), row = hostedResultRecord();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot); vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const confirm = () => requireDurableDatabaseSnapshot([NATIVE_HOSTED_ROOM_RESULT_TABLE]);
  let flushes = 0;
  try {
    await resetDbClient(); await ensureDatabase();
    await getPool().query("INSERT INTO helix_accounts VALUES ($1)", [row.ownerProfileId]);
    const repository = new RoomMissionResultRepository(getPool(), vault, async () => {
      if (++flushes !== 2) return confirm();
      const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("fixture disk unavailable"));
      try { await confirm(); } finally { rename.mockRestore(); }
    }, "hosted");
    await expect(repository.submit(row)).rejects.toThrow();
    expect((await getPool().query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
    expect(await repository.submit(row)).toEqual(row);
    const saved = fs.readFileSync(snapshot, "utf8");
    expect(JSON.parse(saved).tables.helix_native_hosted_room_results).toHaveLength(1);
    expect(saved).not.toMatch(/A private task report|task:private|session:private|connection:private|observation:private/);
    await resetDbClient(); await ensureDatabase();
    const reopened = new RoomMissionResultRepository(getPool(), vault, confirm, "hosted");
    expect(await reopened.read(row.ownerProfileId, row.request.steeringEventRef)).toEqual(row);
    expect(await reopened.submit(row)).toEqual(row);
    expect((await getPool().query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
  } finally {
    await resetDbClient(); vi.unstubAllEnvs();
    // Delete only this fixture's files without recursive cleanup.
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
}, 30000);
