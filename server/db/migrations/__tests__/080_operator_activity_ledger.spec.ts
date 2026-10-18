import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration080 } from "../080_operator_activity_ledger";

describe("migration080", () => {
  it("creates owner-scoped streams with unique ordered and source identities", async () => {
    const memory = newDb();
    const pg = memory.adapters.createPg();
    const pool = new pg.Pool();
    const client = await pool.connect();
    try {
      await migration080.run(client as never, { enablePgvector: false });
    } finally {
      client.release();
    }
    await pool.query(`
      INSERT INTO helix_operator_activity_streams
        (stream_ref, tenant_id, account_profile_id, profile_ref, node_ref)
      VALUES ('stream:one','tenant:one','account:one','profile:one','node:one');
    `);
    const payload = JSON.stringify({ schema: "helix.operator_activity_event.v1" });
    await pool.query(`
      INSERT INTO helix_operator_activity_events
        (stream_ref, activity_event_id, projection_sequence, source_kind,
         source_schema, source_event_ref, event_payload, content_sha256, observed_at)
      VALUES ('stream:one','event:one',0,'environment_event',
              'helix.environment_event.v1','source:event:one',$1::jsonb,$2,$3);
    `, [payload, "a".repeat(64), "2026-09-01T20:00:00.000Z"]);
    const result = await pool.query(
      "SELECT projection_sequence, event_payload FROM helix_operator_activity_events",
    );
    expect(Number(result.rows[0].projection_sequence)).toBe(0);
    expect(result.rows[0].event_payload.schema).toBe("helix.operator_activity_event.v1");
    await expect(pool.query(`
      INSERT INTO helix_operator_activity_events
        (stream_ref, activity_event_id, projection_sequence, source_kind,
         source_schema, source_event_ref, event_payload, content_sha256, observed_at)
      VALUES ('stream:one','event:two',1,'environment_event',
              'helix.environment_event.v1','source:event:one',$1::jsonb,$2,$3);
    `, [payload, "b".repeat(64), "2026-09-01T20:00:01.000Z"])).rejects.toThrow();
  });
});
