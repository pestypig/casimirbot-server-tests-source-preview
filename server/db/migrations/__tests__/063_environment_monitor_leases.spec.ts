import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb, type IMemoryDb } from "pg-mem";
import { migration063 } from "../063_environment_monitor_leases";

describe("migration063 environment monitor leases", () => {
  let memory: IMemoryDb;
  let client: any;

  beforeAll(async () => {
    memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    client = new adapter.Client();
    await client.connect();
    await client.query(`
      CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
      CREATE TABLE helix_agent_runs (run_id text PRIMARY KEY);
      CREATE TABLE helix_environment_durable_goals (goal_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_room_members (participant_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
      CREATE TABLE helix_room_environment_subject_bindings (subject_binding_id text PRIMARY KEY);
    `);
    await migration063.run(client, { enablePgvector: false });
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates durable lease and append-only cursor tables", async () => {
    const tables = await client.query(`
      SELECT DISTINCT table_name FROM information_schema.tables
      WHERE table_name IN (
        'helix_environment_monitor_leases',
        'helix_environment_monitor_events',
        'helix_environment_monitor_delivered_evidence'
      ) ORDER BY table_name;
    `);
    expect(tables.rows.map((row: any) => row.table_name)).toEqual([
      "helix_environment_monitor_delivered_evidence",
      "helix_environment_monitor_events",
      "helix_environment_monitor_leases",
    ]);
  });

  it("enforces cursor, event-kind, and one-evidence-per-monitor invariants", async () => {
    await client.query(`
      INSERT INTO helix_accounts VALUES ('profile:owner');
      INSERT INTO helix_agent_runs VALUES ('agent_run:one');
      INSERT INTO helix_environment_durable_goals VALUES ('environment_durable_goal:one');
      INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
      INSERT INTO helix_shared_realtime_room_members VALUES ('participant:one');
      INSERT INTO helix_environment_connector_bindings VALUES ('environment:one');
      INSERT INTO helix_room_environment_subject_bindings VALUES ('subject:one');
    `);
    await client.query(`
      INSERT INTO helix_environment_monitor_leases(
        monitor_id, owner_profile_id, mcp_client_id, client_continuation_ref,
        run_id, goal_id, room_id, participant_id, environment_binding_id,
        source_id, world_id, subject_ref, producer_epoch_ref, policy_revision,
        status, lease_payload, created_at, updated_at, expires_at
      ) VALUES (
        'environment_monitor:one', 'profile:owner', 'mcp_client:one',
        'codex_task:one', 'agent_run:one', 'environment_durable_goal:one',
        'room:one', 'participant:one', 'environment:one', 'source:one',
        'minecraft:overworld', 'subject:one', 'producer_epoch:one', 1,
        'active', '{}', now(), now(), now() + interval '1 hour'
      );
    `);
    const hashA = `sha256:${"a".repeat(64)}`;
    const hashB = `sha256:${"b".repeat(64)}`;
    await client.query(`
      INSERT INTO helix_environment_monitor_events(
        monitor_event_id, monitor_id, sequence, event_kind,
        previous_event_hash, event_hash, evidence_ref, cursor_before,
        cursor_after, event_payload, occurred_at
      ) VALUES (
        'monitor_event:one', 'environment_monitor:one', 1,
        'monitor_created', NULL, $1, NULL, 0, 0, '{}', now()
      );
    `, [hashA]);
    await client.query(`
      INSERT INTO helix_environment_monitor_events(
        monitor_event_id, monitor_id, sequence, event_kind,
        previous_event_hash, event_hash, evidence_ref, cursor_before,
        cursor_after, event_payload, occurred_at
      ) VALUES (
        'monitor_event:two', 'environment_monitor:one', 2,
        'semantic_batch_delivered', $1, $2, 'evidence:one', 0, 1, '{}', now()
      );
    `, [hashA, hashB]);
    await client.query(`
      INSERT INTO helix_environment_monitor_delivered_evidence(
        monitor_id, evidence_ref, delivery_id, delivered_cursor, delivered_at
      ) VALUES (
        'environment_monitor:one', 'evidence:one', 'delivery:one', 1, now()
      );
    `);
    await expect(client.query(`
      INSERT INTO helix_environment_monitor_delivered_evidence(
        monitor_id, evidence_ref, delivery_id, delivered_cursor, delivered_at
      ) VALUES (
        'environment_monitor:one', 'evidence:one', 'delivery:two', 2, now()
      );
    `)).rejects.toThrow();
    await expect(client.query(`
      INSERT INTO helix_environment_monitor_events(
        monitor_event_id, monitor_id, sequence, event_kind,
        previous_event_hash, event_hash, evidence_ref, cursor_before,
        cursor_after, event_payload, occurred_at
      ) VALUES (
        'monitor_event:duplicate', 'environment_monitor:one', 3,
        'semantic_batch_delivered', $1,
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'evidence:one', 1, 2, '{}', now()
      );
    `, [hashB])).rejects.toThrow();
    await expect(client.query(`
      INSERT INTO helix_environment_monitor_events(
        monitor_event_id, monitor_id, sequence, event_kind,
        previous_event_hash, event_hash, cursor_before, cursor_after,
        event_payload, occurred_at
      ) VALUES (
        'monitor_event:answer', 'environment_monitor:one', 3,
        'assistant_answer_written', $1,
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        1, 1, '{}', now()
      );
    `, [hashB])).rejects.toThrow();
    await expect(client.query(`
      UPDATE helix_environment_monitor_leases
      SET acknowledged_cursor=2, delivered_cursor=1
      WHERE monitor_id='environment_monitor:one';
    `)).rejects.toThrow();
  });
});
