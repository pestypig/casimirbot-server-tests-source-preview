import { expect, it, vi } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";
import { closeTemporalEpochGapSql } from "../../services/environment-connectors/actions/temporal-epoch-gap";

vi.mock("../migrator", () => ({ runMigrations: async (pool: any) => {
  await pool.query(`CREATE TABLE helix_environment_action_connector_manifests (
    manifest_id text primary key, action_authority_id text, producer_epoch_ref text);
    CREATE TABLE helix_environment_action_requests (
    action_request_id text primary key, action_authority_id text, connector_manifest_id text,
    request_payload jsonb, status text, cancellation_reason text, completed_at timestamptz, updated_at timestamptz);`);
} }));
vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

const directory = process.env.ET6_PERSIST_PROCESS_DIR;
it.skipIf(!directory)("runs one isolated persistence process phase", async () => {
  const resolved = path.resolve(directory!);
  expect(path.dirname(resolved)).toBe(path.resolve(tmpdir()));
  expect(path.basename(resolved).startsWith("casimir-et6-process-")).toBe(true);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", path.join(resolved, "snapshot.json"));
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  await db.ensureDatabase();
  const phase = process.env.ET6_PERSIST_PROCESS_PHASE;
  if (phase === "write") {
    await db.getPool().query("INSERT INTO helix_environment_action_connector_manifests VALUES ('old','authority','old-epoch')");
    await db.getPool().query(`INSERT INTO helix_environment_action_requests
      (action_request_id,action_authority_id,connector_manifest_id,request_payload,status)
      VALUES ('resident','authority','old','{"temporal_plan":{"plan_id":"fixture"}}','running')`);
  } else if (phase === "replace") {
    expect((await db.getPool().query("SELECT status FROM helix_environment_action_requests")).rows[0].status).toBe("running");
    await db.getPool().query(closeTemporalEpochGapSql, ["authority", "replacement-epoch"]);
  } else {
    expect(phase).toBe("verify");
    expect((await db.getPool().query("SELECT status,cancellation_reason FROM helix_environment_action_requests")).rows[0])
      .toEqual({ status: "connector_offline", cancellation_reason: "producer_epoch_replaced_evidence_incomplete_no_replay" });
  }
  // This fixture deliberately installs only these two tables, not the full
  // application migration set. Require both rather than pretending otherwise.
  await db.requireLocalDatabaseSnapshotIfEnabled([
    "helix_environment_action_connector_manifests", "helix_environment_action_requests",
  ]);
  // No reset/reopen inside this process. The parent launches the next process.
}, 30000);
