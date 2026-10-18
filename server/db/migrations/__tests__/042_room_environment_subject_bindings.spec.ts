import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration042 } from "../042_room_environment_subject_bindings";

describe("migration042 room environment subject bindings", () => {
  it("keeps one active subject per participant and one active claimant per subject", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_room_members (
          participant_id text PRIMARY KEY
        );
        CREATE TABLE helix_room_source_bindings (binding_id text PRIMARY KEY);
        CREATE TABLE helix_environment_connector_bindings (
          environment_binding_id text PRIMARY KEY
        );
        CREATE TABLE helix_environment_probe_requests (
          probe_request_id text PRIMARY KEY
        );
        INSERT INTO helix_accounts VALUES ('profile:owner'), ('profile:guest');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:owner'), ('participant:guest');
        INSERT INTO helix_room_source_bindings VALUES ('source_binding:one');
        INSERT INTO helix_environment_connector_bindings VALUES ('environment_binding:one');
      `);

      await migration042.run(client, { enablePgvector: false });

      const insert = (input: {
        id: string;
        participant: string;
        profile: string;
        subjectRef: string;
        nativeId: string;
      }) => client.query(
        `
          INSERT INTO helix_room_environment_subject_bindings (
            subject_binding_id,
            room_id,
            participant_id,
            profile_id,
            environment_binding_id,
            room_source_binding_id,
            source_id,
            world_id,
            subject_kind,
            subject_ref,
            subject_native_id,
            subject_label,
            verification_method,
            confidence,
            producer_epoch_ref
          ) VALUES (
            $1, 'room:one', $2, $3, 'environment_binding:one',
            'source_binding:one', 'source:one', 'minecraft:world',
            'minecraft.player', $4, $5, 'Player', 'self_claim', 0.75,
            'producer_epoch:one'
          );
        `,
        [
          input.id,
          input.participant,
          input.profile,
          input.subjectRef,
          input.nativeId,
        ],
      );

      await insert({
        id: "subject_binding:one",
        participant: "participant:owner",
        profile: "profile:owner",
        subjectRef: "subject:one",
        nativeId: "native:one",
      });
      await expect(insert({
        id: "subject_binding:duplicate-participant",
        participant: "participant:owner",
        profile: "profile:owner",
        subjectRef: "subject:two",
        nativeId: "native:two",
      })).rejects.toThrow();
      await expect(insert({
        id: "subject_binding:duplicate-subject",
        participant: "participant:guest",
        profile: "profile:guest",
        subjectRef: "subject:three",
        nativeId: "native:one",
      })).rejects.toThrow();

      await client.query(`
        UPDATE helix_room_environment_subject_bindings
        SET status = 'revoked', revoked_at = now()
        WHERE subject_binding_id = 'subject_binding:one';
      `);
      await insert({
        id: "subject_binding:replacement",
        participant: "participant:guest",
        profile: "profile:guest",
        subjectRef: "subject:replacement",
        nativeId: "native:one",
      });

      const rows = await client.query<{ status: string }>(`
        SELECT status
        FROM helix_room_environment_subject_bindings
        ORDER BY subject_binding_id;
      `);
      expect(rows.rows.map((row) => row.status).sort()).toEqual([
        "active",
        "revoked",
      ]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
