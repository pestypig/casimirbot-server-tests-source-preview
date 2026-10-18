import { expect, it } from "vitest";
import { newDb } from "pg-mem";
import { closeTemporalEpochGapSql } from "../temporal-epoch-gap";

it("closes only unfinished old-epoch temporal requests without claiming effects or deleting evidence", async () => {
  const memory = newDb();
  memory.public.none(`CREATE TABLE helix_environment_action_connector_manifests (
    manifest_id text, action_authority_id text, producer_epoch_ref text);
    CREATE TABLE helix_environment_action_requests (
    action_request_id text, action_authority_id text, connector_manifest_id text, request_payload jsonb,
    status text, cancellation_reason text, completed_at timestamptz, updated_at timestamptz);
    CREATE TABLE evidence (id text);
    INSERT INTO evidence VALUES ('retained');
    INSERT INTO helix_environment_action_connector_manifests VALUES
      ('old','authority','old-epoch'),('new','authority','new-epoch'),('foreign','other','old-epoch');`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  try {
    for (const [id, authority, manifest, status, payload] of [
      ["lost", "authority", "old", "running", { temporal_plan: {} }],
      ["leased", "authority", "old", "leased", { temporal_plan: {} }],
      ["new", "authority", "new", "running", { temporal_plan: {} }],
      ["terminal", "authority", "old", "succeeded", { temporal_plan: {} }],
      ["foreign", "other", "foreign", "running", { temporal_plan: {} }],
      ["ordinary", "authority", "old", "running", {}],
    ]) await pool.query(`INSERT INTO helix_environment_action_requests
      (action_request_id,action_authority_id,connector_manifest_id,status,request_payload) VALUES ($1,$2,$3,$4,$5)`,
    [id, authority, manifest, status, JSON.stringify(payload)]);
    await pool.query(closeTemporalEpochGapSql, ["authority", "new-epoch"]);
    const rows: Array<{ action_request_id: string; status: string }> =
      (await pool.query("SELECT * FROM helix_environment_action_requests")).rows;
    for (const id of ["lost", "leased"]) expect(rows.find(r => r.action_request_id === id)).toMatchObject({
      status: "connector_offline", cancellation_reason: "producer_epoch_replaced_evidence_incomplete_no_replay" });
    for (const id of ["new", "foreign", "ordinary"]) expect(rows.find(r => r.action_request_id === id)?.status).toBe("running");
    expect(rows.find(r => r.action_request_id === "terminal")?.status).toBe("succeeded");
    expect((await pool.query("SELECT * FROM evidence")).rows).toEqual([{ id: "retained" }]);
    await pool.query(closeTemporalEpochGapSql, ["authority", "new-epoch"]);
    expect((await pool.query("SELECT * FROM helix_environment_action_requests")).rows).toEqual(rows);
  } finally { await pool.end(); }
});
