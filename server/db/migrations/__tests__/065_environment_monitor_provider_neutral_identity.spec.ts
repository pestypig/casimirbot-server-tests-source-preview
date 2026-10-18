import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { migration063 } from "../063_environment_monitor_leases";
import { migration065 } from "../065_environment_monitor_provider_neutral_identity";

describe("migration065 provider-neutral environment monitor identity", () => {
  let client: any;

  beforeAll(async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
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
      INSERT INTO helix_accounts VALUES ('profile:owner');
      INSERT INTO helix_agent_runs VALUES ('agent_run:one');
      INSERT INTO helix_environment_durable_goals VALUES ('environment_durable_goal:one');
      INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
      INSERT INTO helix_shared_realtime_room_members VALUES ('participant:one');
    `);
    await migration063.run(client, { enablePgvector: false });
    await migration065.run(client, { enablePgvector: false });
  });

  afterAll(async () => {
    await client.end();
  });

  const insertLease = (monitorId: string, profileId = "profile:owner") =>
    client.query(
      `INSERT INTO helix_environment_monitor_leases(
         monitor_id, owner_profile_id, mcp_client_id, client_continuation_ref,
         run_id, goal_id, room_id, participant_id, environment_binding_id,
         source_id, world_id, subject_ref, producer_epoch_ref, policy_revision,
         status, lease_payload, created_at, updated_at, expires_at
       ) VALUES (
         $1, $2, 'mcp_client:one', $1, 'agent_run:one',
         'environment_durable_goal:one', 'room:one', 'participant:one',
         'brokerage_room_binding:one', 'brokerage_connection:one',
         'robinhood:agentic', 'paper_account:one',
         'brokerage_producer_epoch:one', 1, 'active', '{}', now(), now(),
         now() + interval '1 hour'
       );`,
      [monitorId, profileId],
    );

  it("admits exact brokerage-native binding and subject identities", async () => {
    await expect(insertLease("environment_monitor:brokerage")).resolves.toBeTruthy();
  });

  it("retains shared ownership foreign keys", async () => {
    await expect(
      insertLease("environment_monitor:unknown-owner", "profile:missing"),
    ).rejects.toThrow();
  });
});
