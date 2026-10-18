import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { migration034 } from "../034_shared_live_room_agent_bindings";
import { migration036 } from "../036_shared_live_room_binding_consent";
import { migration037 } from "../037_shared_live_room_binding_consent_enforcement";

const pools: Pool[] = [];

const createPool = (): Pool => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  pools.push(pool);
  return pool;
};

const runMigration = async (
  pool: Pool,
  migration: typeof migration034,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await migration.run(client, { enablePgvector: false });
  } finally {
    client.release();
  }
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe("migration037 run-room binding consent enforcement", () => {
  it("revokes unreconstructable legacy active bindings and releases their active slot", async () => {
    const pool = createPool();
    await pool.query(`
      CREATE TABLE helix_agent_run_room_bindings (
        binding_id text PRIMARY KEY,
        run_id text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        version bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        revoked_at timestamptz,
        revoke_reason text
      );
    `);
    await pool.query(`
      INSERT INTO helix_agent_run_room_bindings (
        binding_id, run_id, status, version, created_at, updated_at
      ) VALUES (
        'binding:legacy',
        'run_legacy_12345678',
        'active',
        1,
        '2026-07-26T19:00:00.000Z',
        '2026-07-26T19:00:00.000Z'
      );
    `);

    await runMigration(pool, migration036);
    await runMigration(pool, migration037);

    const { rows } = await pool.query<{
      status: string;
      version: string;
      consent_version_at_bind: string | null;
      consent_receipt_ref_at_bind: string | null;
      revoked_at: Date | string | null;
      revoke_reason: string | null;
    }>(`
      SELECT
        status,
        version,
        consent_version_at_bind,
        consent_receipt_ref_at_bind,
        revoked_at,
        revoke_reason
      FROM helix_agent_run_room_bindings
      WHERE binding_id = 'binding:legacy';
    `);

    expect(rows[0]).toMatchObject({
      status: "revoked",
      version: 2,
      consent_version_at_bind: null,
      consent_receipt_ref_at_bind: null,
      revoke_reason: "legacy_binding_missing_consent_identity",
    });
    expect(rows[0]?.revoked_at).not.toBeNull();

    await expect(
      pool.query(`
        UPDATE helix_agent_run_room_bindings
        SET status = 'active'
        WHERE binding_id = 'binding:legacy';
      `),
    ).rejects.toThrow();

    await pool.query(`
      INSERT INTO helix_agent_run_room_bindings (
        binding_id,
        run_id,
        status,
        version,
        consent_version_at_bind,
        consent_receipt_ref_at_bind,
        created_at,
        updated_at
      ) VALUES (
        'binding:replacement',
        'run_legacy_12345678',
        'active',
        1,
        4,
        'consent:replacement:4',
        '2026-07-26T20:00:00.000Z',
        '2026-07-26T20:00:00.000Z'
      );
    `);
  });

  it("keeps the fresh migration strict before any binding can become active", async () => {
    const pool = createPool();
    await pool.query(`
      CREATE TABLE helix_agent_runs (run_id text PRIMARY KEY);
      CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
      CREATE TABLE helix_room_source_bindings (binding_id text PRIMARY KEY);

      INSERT INTO helix_agent_runs (run_id) VALUES ('run:fresh');
      INSERT INTO helix_accounts (profile_id) VALUES ('profile:fresh');
      INSERT INTO helix_shared_realtime_rooms (room_id) VALUES ('room:fresh');
    `);

    await runMigration(pool, migration034);
    await runMigration(pool, migration036);
    await runMigration(pool, migration037);

    const insert = (consentVersion: number, receipt: string | null) =>
      pool.query(
        `
          INSERT INTO helix_agent_run_room_bindings (
            binding_id,
            run_id,
            tenant_id,
            issuer,
            subject_id,
            account_profile_id,
            room_id,
            authorized_by_profile_id,
            participant_id_at_bind,
            member_role_at_bind,
            consent_version_at_bind,
            consent_receipt_ref_at_bind,
            status,
            version,
            created_at,
            updated_at
          ) VALUES (
            $1,
            'run:fresh',
            'tenant:fresh',
            'https://issuer.example',
            'subject:fresh',
            'profile:fresh',
            'room:fresh',
            'profile:fresh',
            'participant:fresh',
            'owner',
            $2,
            $3,
            'active',
            1,
            '2026-07-26T20:00:00.000Z',
            '2026-07-26T20:00:00.000Z'
          );
        `,
        [`binding:fresh:${consentVersion}`, consentVersion, receipt],
      );

    await expect(insert(1, null)).rejects.toThrow();
    await insert(1, "consent:fresh:1");
  });
});
