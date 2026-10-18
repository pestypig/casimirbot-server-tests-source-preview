import { expect, it, vi } from "vitest";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import request from "supertest";
import * as broker from "../../services/environment-connectors/actions/action-broker";
import { createEnvironmentActionRouter } from "../../routes/environment-action-routes";
import { closeTemporalEpochGapSql } from "../../services/environment-connectors/actions/temporal-epoch-gap";

// Keep migrations bounded; persistence serialization/restoration is real.
vi.mock("../migrator", () => ({ runMigrations: async (pool: any) => {
  await pool.query(`CREATE TABLE helix_environment_action_connector_manifests (
    manifest_id text primary key, action_authority_id text, producer_epoch_ref text);
    CREATE TABLE helix_environment_action_requests (
    action_request_id text primary key, action_authority_id text, connector_manifest_id text,
    request_payload jsonb, status text, cancellation_reason text, completed_at timestamptz, updated_at timestamptz);`);
} }));
vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

it("preserves Unicode and oversized rows across bounded snapshot chunks and reopen", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-snapshot-chunks-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  const payloads = ["small", "界😀\\\"\n".repeat(60000), "tail"].map(text => ({ text }));
  try {
    await db.ensureDatabase();
    for (const [index, payload] of payloads.entries()) {
      await db.getPool().query(
        "INSERT INTO helix_environment_action_requests (action_request_id,request_payload,status) VALUES ($1,$2::jsonb,'running')",
        [String(index), JSON.stringify(payload)],
      );
    }
    await db.requireLocalDatabaseSnapshotIfEnabled(["helix_environment_action_requests"]);
    const saved = JSON.parse(fs.readFileSync(snapshot, "utf8"));
    expect(saved.tables.helix_environment_action_requests.map((row: any) => row.request_payload)).toEqual(payloads);
    await db.resetDbClient();
    await db.ensureDatabase();
    expect((await db.getPool().query("SELECT request_payload FROM helix_environment_action_requests ORDER BY action_request_id")).rows.map(row => row.request_payload)).toEqual(payloads);
  } finally {
    await db.resetDbClient();
    vi.unstubAllEnvs();
    if (fs.existsSync(snapshot)) unlinkSync(snapshot);
    if (fs.existsSync(`${snapshot}.last-good`)) unlinkSync(`${snapshot}.last-good`);
    rmdirSync(directory);
  }
});

it("restores an unfinished request and retains the explicit epoch-gap outcome on a second reopen", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-et6-persistence-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "immediate");
  const db = await import("../client");
  try {
    await db.ensureDatabase();
    await db.getPool().query("INSERT INTO helix_environment_action_connector_manifests VALUES ('old','authority','old-epoch')");
    await db.getPool().query(`INSERT INTO helix_environment_action_requests
      (action_request_id,action_authority_id,connector_manifest_id,request_payload,status)
      VALUES ('resident','authority','old','{"temporal_plan":{"plan_id":"fixture"}}','running')`);
    await db.resetDbClient();
    await db.ensureDatabase();
    expect((await db.getPool().query("SELECT status,request_payload FROM helix_environment_action_requests")).rows[0])
      .toEqual({ status: "running", request_payload: { temporal_plan: { plan_id: "fixture" } } });
    vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
    const { withSharedRealtimeRoomTransaction } = await import("../../services/helix-ask/realtime-room/room-store/database");
    const app = express().use(createEnvironmentActionRouter({ inspect: () => null } as never));
    const endpoint = "/v1/authorities/authority/requests/temporal-successor";
    vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockResolvedValue({ authorityId: "authority" } as never);
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("fixture disk write failure"));
    try {
      let executableResponseReturned = false;
      vi.spyOn(broker, "leasePendingEnvironmentTemporalSuccessor").mockImplementation(() => withSharedRealtimeRoomTransaction(async client => {
        await client.query("UPDATE helix_environment_action_requests SET status='leased'");
        return { executable_fixture: true } as never;
      }, { requireLocalSnapshot: true }).then(value => {
        executableResponseReturned = true;
        return value;
      }));
      const failed = await request(app).post(endpoint).send({ resident_action_request_id: "resident",
        predecessor_plan_id: "fixture", predecessor_plan_hash: "hash", checkpoint_id: "checkpoint" });
      expect(failed.status).toBe(503);
      expect(failed.body).toMatchObject({ ok: false, error: "action_connector_unavailable", terminal_eligible: false });
      expect(failed.body).not.toHaveProperty("action_request");
      expect(executableResponseReturned).toBe(false);
      // pg-mem did not undo COMMIT when the save subsequently failed. Never
      // turn this error into evidence that the action was not leased.
      expect((await db.getPool().query("SELECT status FROM helix_environment_action_requests")).rows[0].status).toBe("leased");
      const onDisk = JSON.parse(fs.readFileSync(snapshot, "utf8"));
      expect(onDisk.tables.helix_environment_action_requests[0].status).toBe("running");
      // A receipt retry can observe the already-committed row without changing
      // it. It must still persist the evidence before acknowledging the retry.
      rename.mockRejectedValueOnce(new Error("fixture retry disk write failure"));
      await expect(withSharedRealtimeRoomTransaction(async client => {
        return (await client.query("SELECT status FROM helix_environment_action_requests")).rows[0].status;
      }, { requireLocalSnapshot: true, snapshotTables: ["helix_environment_action_requests"] }))
        .rejects.toThrow("fixture retry disk write failure");
      expect(JSON.parse(fs.readFileSync(snapshot, "utf8")).tables.helix_environment_action_requests[0].status).toBe("running");
      await expect(withSharedRealtimeRoomTransaction(async client => {
        return (await client.query("SELECT status FROM helix_environment_action_requests")).rows[0].status;
      }, { requireLocalSnapshot: true, snapshotTables: ["helix_environment_action_requests"] }))
        .resolves.toBe("leased");
      expect(JSON.parse(fs.readFileSync(snapshot, "utf8")).tables.helix_environment_action_requests[0].status).toBe("leased");
    } finally { rename.mockRestore(); }
    const returned = await withSharedRealtimeRoomTransaction(async client => {
      await client.query("UPDATE helix_environment_action_requests SET status='leased'");
      return "saved-before-return";
    }, { requireLocalSnapshot: true });
    expect(returned).toBe("saved-before-return");
    expect(JSON.parse(fs.readFileSync(snapshot, "utf8")).tables.helix_environment_action_requests[0].status).toBe("leased");
    // Hold a deferred snapshot at its atomic rename. A delivery barrier must
    // join that writer before serializing the newer lease into the same path.
    await db.getPool().query("UPDATE helix_environment_action_requests SET status='running'");
    let releaseRename!: () => void;
    let enteredRename!: () => void;
    const renameHeld = new Promise<void>(resolve => { releaseRename = resolve; });
    const renameEntered = new Promise<void>(resolve => { enteredRename = resolve; });
    const originalRename = fs.promises.rename.bind(fs.promises);
    let renameCalls = 0;
    const heldRename = vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (++renameCalls === 1) {
        enteredRename();
        await renameHeld;
      }
      return originalRename(from, to);
    });
    const deferredFlush = db.flushLocalDatabaseSnapshotIfEnabled();
    let strictFlush: Promise<void> | undefined;
    try {
      await renameEntered;
      await db.getPool().query("UPDATE helix_environment_action_requests SET status='leased'");
      let strictReturned = false;
      strictFlush = db.requireLocalDatabaseSnapshotIfEnabled(["helix_environment_action_requests"])
        .then(() => { strictReturned = true; });
      // Allow actual asynchronous filesystem work to contend with the held
      // rename; this wait is fault orchestration, not a latency measurement.
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(renameCalls).toBe(1);
      expect(strictReturned).toBe(false);
      releaseRename();
      await Promise.all([deferredFlush, strictFlush]);
      expect(JSON.parse(fs.readFileSync(snapshot, "utf8")).tables.helix_environment_action_requests[0].status).toBe("leased");
    } finally {
      releaseRename();
      await Promise.allSettled([deferredFlush, strictFlush]);
      heldRename.mockRestore();
    }
    await db.flushLocalDatabaseSnapshotIfEnabled();
    const sharedRename = vi.spyOn(fs.promises, "rename");
    try {
      await Promise.all([
        db.requireLocalDatabaseSnapshotIfEnabled(["helix_environment_action_requests"]),
        db.requireLocalDatabaseSnapshotIfEnabled(["helix_environment_action_connector_manifests"]),
      ]);
      expect(sharedRename.mock.calls.map(([, target]) => target)).toEqual([
        `${snapshot}.last-good`,
        snapshot,
      ]);
      const savedBatch = JSON.parse(fs.readFileSync(snapshot, "utf8"));
      expect(savedBatch.tables.helix_environment_action_requests[0].status).toBe("leased");
      expect(savedBatch.tables.helix_environment_action_connector_manifests[0].manifest_id).toBe("old");
    } finally { sharedRename.mockRestore(); }
    const snapshotBeforeReadFailure = fs.readFileSync(snapshot, "utf8");
    const activePool = db.getPool();
    const originalQuery = activePool.query.bind(activePool);
    const brokenRead = vi.spyOn(activePool, "query").mockImplementation(((...args: any[]) => {
      if (args[0] === "SELECT * FROM helix_environment_action_requests;")
        return Promise.reject(new Error("fixture required snapshot read failure"));
      return (originalQuery as any)(...args);
    }) as any);
    try {
      const failed = await request(app).post(endpoint).send({ resident_action_request_id: "resident",
        predecessor_plan_id: "fixture", predecessor_plan_hash: "hash", checkpoint_id: "checkpoint" });
      expect(failed.status).toBe(503);
      expect(failed.body).not.toHaveProperty("action_request");
      expect(fs.readFileSync(snapshot, "utf8")).toBe(snapshotBeforeReadFailure);
    } finally { brokenRead.mockRestore(); }
    await db.getPool().query(closeTemporalEpochGapSql, ["authority", "replacement-epoch"]);
    await db.resetDbClient();
    await db.ensureDatabase();
    expect((await db.getPool().query("SELECT status,cancellation_reason FROM helix_environment_action_requests")).rows[0])
      .toEqual({ status: "connector_offline", cancellation_reason: "producer_epoch_replaced_evidence_incomplete_no_replay" });
  } finally {
    vi.restoreAllMocks();
    await db.resetDbClient();
    vi.unstubAllEnvs();
    // Only the exact snapshot created by this test; no recursive cleanup.
    try { unlinkSync(snapshot); } catch {}
    try { unlinkSync(`${snapshot}.last-good`); } catch {}
    rmdirSync(directory);
  }
}, 30000);
