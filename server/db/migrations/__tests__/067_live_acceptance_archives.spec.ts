import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { migration067 } from "../067_live_acceptance_archives";

describe("migration067 live acceptance archives", () => {
  let client: any;

  beforeAll(async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    client = new adapter.Client();
    await client.connect();
    await client.query(`
      CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
      CREATE TABLE helix_brokerage_connections (
        connection_id text PRIMARY KEY,
        owner_profile_id text NOT NULL REFERENCES helix_accounts(profile_id)
      );
      CREATE TABLE helix_shared_realtime_rooms (
        room_id text PRIMARY KEY,
        owner_profile_id text NOT NULL REFERENCES helix_accounts(profile_id)
      );
      CREATE TABLE helix_live_trading_controls (
        control_id text PRIMARY KEY,
        connection_id text NOT NULL REFERENCES helix_brokerage_connections(connection_id),
        room_id text NOT NULL REFERENCES helix_shared_realtime_rooms(room_id)
      );
      INSERT INTO helix_accounts VALUES ('profile:owner');
      INSERT INTO helix_brokerage_connections VALUES (
        'brokerage_connection:one', 'profile:owner'
      );
      INSERT INTO helix_shared_realtime_rooms VALUES (
        'room:one', 'profile:owner'
      );
      INSERT INTO helix_live_trading_controls VALUES (
        'live_trading_control:one', 'brokerage_connection:one', 'room:one'
      );
    `);
    await migration067.run(client, { enablePgvector: false });
  });

  afterAll(async () => {
    await client.end();
  });

  it("stores only completed zero-exposure acceptance and deduplicates evidence", async () => {
    const parameters = [
      "live_acceptance_archive:one",
      "profile:owner",
      "brokerage_connection:one",
      "room:one",
      "live_trading_control:one",
      `sha256:${"a".repeat(64)}`,
      JSON.stringify({ schema: "helix.live_acceptance_archive_evidence.v1" }),
      "2026-08-27T15:00:00.000Z",
    ];
    await expect(client.query(
      `INSERT INTO helix_live_acceptance_archives (
         archive_id, owner_profile_id, connection_id, room_id, control_id,
         evidence_hash, evidence_json, reconciled_filled_entry_count,
         reconciled_filled_exit_count, unresolved_live_exposure_count,
         accepted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,1,1,0,$8);`,
      parameters,
    )).resolves.toBeTruthy();
    await expect(client.query(
      `INSERT INTO helix_live_acceptance_archives (
         archive_id, owner_profile_id, connection_id, room_id, control_id,
         evidence_hash, evidence_json, reconciled_filled_entry_count,
         reconciled_filled_exit_count, unresolved_live_exposure_count,
         accepted_at
       ) VALUES ('live_acceptance_archive:duplicate',$2,$3,$4,$5,$6,$7::jsonb,
         1,1,0,$8);`,
      parameters,
    )).rejects.toThrow();
    await expect(client.query(
      `INSERT INTO helix_live_acceptance_archives (
         archive_id, owner_profile_id, connection_id, room_id, control_id,
         evidence_hash, evidence_json, reconciled_filled_entry_count,
         reconciled_filled_exit_count, unresolved_live_exposure_count,
         accepted_at
       ) VALUES ('live_acceptance_archive:unresolved',$2,$3,$4,$5,
         $6 || 'b',$7::jsonb,1,1,1,$8);`,
      parameters,
    )).rejects.toThrow();
  });
});
