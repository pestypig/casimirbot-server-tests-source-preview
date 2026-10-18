import { newDb } from "pg-mem";
import { expect, it } from "vitest";
import { migration082 } from "../082_environment_temporal_frontiers";

it("stores exact frontier identity and enforces revision, replay and retention constraints", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE helix_environment_durable_goals (goal_id text PRIMARY KEY); INSERT INTO helix_environment_durable_goals VALUES ('goal:test')");
    await migration082.run(client, { enablePgvector: false });
    const insert = (id: string, revision: number, evidence: string, retained = "2026-09-06T00:00:00Z", goal = "goal:test") =>
      client.query(`INSERT INTO helix_environment_temporal_frontiers
        (frontier_id, goal_id, goal_revision, frontier_revision, observation_evidence_ref,
         observation_producer_epoch_ref, action_producer_epoch_ref, identity_hash, payload_hash,
         frontier_payload, observed_at, retained_until)
        VALUES ($1,$2,1,$3,$4,'epoch:observation','epoch:action','identity:hash','payload:hash','{}',
          '2026-09-05T00:00:00Z',$5)`, [id, goal, revision, evidence, retained]);
    await insert("frontier:1", 1, "evidence:1");
    await expect(insert("frontier:2", 1, "evidence:2")).rejects.toThrow();
    await expect(insert("frontier:3", 2, "evidence:1")).rejects.toThrow();
    await expect(insert("frontier:4", 0, "evidence:4")).rejects.toThrow();
    await expect(insert("frontier:5", 2, "evidence:5", "2026-09-04T00:00:00Z")).rejects.toThrow();
    await expect(insert("frontier:6", 2, "evidence:6", undefined, "goal:missing")).rejects.toThrow();
    const result = await client.query("SELECT * FROM helix_environment_temporal_frontiers");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ observation_producer_epoch_ref: "epoch:observation", action_producer_epoch_ref: "epoch:action" });
  } finally { client.release(); await pool.end(); }
});
