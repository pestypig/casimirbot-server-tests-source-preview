import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { migration094 } from "../migrations/094_room_owner_node_attachments";
import { migration097 } from "../migrations/097_room_owner_handoff_claims";
import { migration099 } from "../migrations/099_room_task_disclosures";
import { ensureDatabase, getPool, resetDbClient } from "../client";
import { disclosureFixture } from "../../services/shared-live-room-control/__tests__/owner-result-disclosure-fixture";
import { RoomOwnerResultDisclosureService } from "../../services/shared-live-room-control/owner-result-disclosure-service";

vi.mock("../migrator", () => ({ runMigrations: async (pool: { connect(): Promise<any> }) => {
  const db = await pool.connect();
  try {
    await db.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
    await db.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY,owner_profile_id text,status text)");
    await db.query("CREATE TABLE helix_shared_realtime_room_members(room_id text,profile_id text,participant_id text,member_role text,presence text)");
    for (const migration of [migration094, migration097, migration099]) await migration.run(db, { enablePgvector: false });
  } finally { db.release(); }
} }));

it("withholds a disclosure receipt on disk failure and reopens the approved report with its claim dependencies", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "casimir-room-disclosure-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot); vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  try {
    await resetDbClient(); await ensureDatabase();
    const f = await disclosureFixture(getPool());
    const service = new RoomOwnerResultDisclosureService({ handoffs: f.handoffs, authority: () => f.authority, now: () => f.clock.value });
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("fixture disk unavailable"));
    try { await expect(service.disclose(f.principal, f.request())).rejects.toThrow(); }
    finally { rename.mockRestore(); }
    expect((await getPool().query("SELECT * FROM helix_room_task_disclosures")).rows).toHaveLength(1);
    const acknowledged = await service.disclose(f.principal, f.request());
    const saved = fs.readFileSync(snapshot, "utf8");
    expect(JSON.parse(saved).tables.helix_room_task_disclosures).toHaveLength(1);
    // This copy was explicitly released to the room; the private task envelope is absent.
    expect(saved).toContain(f.report.result_text);
    expect(saved).not.toMatch(/binding_id|client_session_ref|private_key/);
    await resetDbClient(); await ensureDatabase();
    const rows = (await getPool().query("SELECT * FROM helix_room_task_disclosures")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ disclosure_ref: acknowledged.disclosure.disclosure_ref,
      claim_ref: acknowledged.claim.claim_ref, result_text: f.report.result_text, result_sha256: f.report.result_sha256, task_status: "unable" });
    expect((await getPool().query("SELECT * FROM helix_room_owner_handoff_claims")).rows).toHaveLength(1);
    await getPool().query("DELETE FROM helix_shared_realtime_rooms WHERE room_id=$1", [f.roomId]);
    expect((await getPool().query("SELECT * FROM helix_room_task_disclosures")).rows).toHaveLength(0);
  } finally {
    await resetDbClient(); vi.unstubAllEnvs();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
}, 30000);
