import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration044 } from "../044_connector_pairing_bootstrap";

describe("migration044 connector pairing bootstrap", () => {
  it("isolates hashed, expiring, one-time pairing state by room and binding", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
        CREATE TABLE helix_room_source_bindings (binding_id text PRIMARY KEY);
        CREATE TABLE helix_room_source_credentials (credential_id text PRIMARY KEY);
        INSERT INTO helix_accounts VALUES ('profile:owner');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_room_source_bindings VALUES ('binding:one');
      `);
      await migration044.run(client, { enablePgvector: false });
      const insert = (id: string, codeHash: string, idempotencyHash: string) =>
        client.query(
          `
            INSERT INTO helix_connector_pairing_codes (
              pairing_id, room_id, owner_profile_id, binding_id, purpose,
              domain_adapter, world_id, source_label, code_hash,
              create_idempotency_key_hash, create_request_hash,
              credential_ttl_ms, expires_at
            ) VALUES (
              $1, 'room:one', 'profile:owner', 'binding:one', 'create',
              'minecraft.fabric_mod.v1', 'minecraft:fabric:test', 'Fabric',
              $2, $3,
              'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              60000, now() + interval '10 minutes'
            );
          `,
          [id, codeHash, idempotencyHash],
        );
      await insert(
        "pairing:one",
        `sha256:${"a".repeat(64)}`,
        `sha256:${"b".repeat(64)}`,
      );
      await expect(
        insert(
          "pairing:duplicate-code",
          `sha256:${"a".repeat(64)}`,
          `sha256:${"d".repeat(64)}`,
        ),
      ).rejects.toThrow();
      await expect(
        insert(
          "pairing:duplicate-idempotency",
          `sha256:${"e".repeat(64)}`,
          `sha256:${"b".repeat(64)}`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(`
          UPDATE helix_connector_pairing_codes
          SET status = 'redeemed'
          WHERE pairing_id = 'pairing:one';
        `),
      ).rejects.toThrow();
    } finally {
      client.release();
      await pool.end();
    }
  });
});
