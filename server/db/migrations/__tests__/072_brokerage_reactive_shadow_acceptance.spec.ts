import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration072 } from
  "../072_brokerage_reactive_shadow_acceptance";

describe("migration072 brokerage reactive shadow acceptance", () => {
  it("creates an immutable owner-scoped qualification archive", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    memory.public.none(`
      CREATE TABLE helix_accounts(profile_id text PRIMARY KEY);
      CREATE TABLE helix_brokerage_connections(connection_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY);
    `);
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await migration072.run(client, { enablePgvector: false });
      await client.query(
        `INSERT INTO helix_accounts(profile_id) VALUES ('profile:owner');`,
      );
      await client.query(
        `INSERT INTO helix_brokerage_connections(connection_id)
         VALUES ('connection:one');`,
      );
      await client.query(
        `INSERT INTO helix_shared_realtime_rooms(room_id) VALUES ('room:one');`,
      );
      const hash = `sha256:${"a".repeat(64)}`;
      await client.query(
        `INSERT INTO helix_brokerage_reactive_shadow_acceptance_archives(
           archive_id, owner_profile_id, connection_id, room_id,
           evidence_hash, evidence_json, status, qualified_at
         ) VALUES ('archive:one','profile:owner','connection:one','room:one',
           $1,'{}'::jsonb,'qualified','2026-08-13T15:00:00.000Z');`,
        [hash],
      );
      await expect(client.query(
        `INSERT INTO helix_brokerage_reactive_shadow_acceptance_archives(
           archive_id, owner_profile_id, connection_id, room_id,
           evidence_hash, evidence_json, status, qualified_at
         ) VALUES ('archive:two','profile:owner','connection:one','room:one',
           $1,'{}'::jsonb,'qualified','2026-08-13T15:01:00.000Z');`,
        [hash],
      )).rejects.toThrow();
      const { rows } = await client.query(
        `SELECT status, evidence_hash
           FROM helix_brokerage_reactive_shadow_acceptance_archives;`,
      );
      expect(rows).toEqual([{ status: "qualified", evidence_hash: hash }]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
