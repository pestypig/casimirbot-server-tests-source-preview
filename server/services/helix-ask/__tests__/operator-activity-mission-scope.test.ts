import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { readCurrentOwnerMissionActivityScope } from "../operator-activity-mission-scope";
import type { Queryable } from "../realtime-room/room-store/types";

const fixture = async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  for (const table of [
    `CREATE TABLE helix_room_external_missions (room_id text, owner_profile_id text,
      owner_participant_id text, mission_id text, mission_revision integer,
      binding_epoch integer, run_id text, status text)`,
    `CREATE TABLE helix_shared_realtime_rooms (room_id text, status text)`,
    `CREATE TABLE helix_shared_realtime_room_members (room_id text,
      participant_id text, profile_id text, member_role text, presence text)`,
    `CREATE TABLE helix_environment_action_requests (run_id text, room_id text,
      action_authority_id text, connector_manifest_id text, environment_binding_id text,
      source_id text, world_id text, participant_id text, subject_binding_id text,
      status text)`,
    `CREATE TABLE helix_environment_action_authorities (action_authority_id text,
      owner_profile_id text, environment_binding_id text, room_source_binding_id text,
      room_id text, source_id text, world_id text, participant_id text,
      subject_binding_id text, status text, expires_at timestamptz)`,
    `CREATE TABLE helix_environment_connector_bindings (environment_binding_id text, status text)`,
    `CREATE TABLE helix_room_source_bindings (binding_id text, status text)`,
    `CREATE TABLE helix_environment_action_connector_manifests (manifest_id text,
      action_authority_id text, connector_installation_id text,
      producer_epoch_ref text, environment_binding_id text, room_id text,
      source_id text, world_id text, participant_id text, subject_binding_id text,
      status text, expires_at timestamptz)`,
    `CREATE TABLE helix_environment_action_connector_credentials (action_authority_id text,
      environment_binding_id text, connector_installation_id text,
      status text, expires_at timestamptz)`,
  ]) await pool.query(table);
  await pool.query(`INSERT INTO helix_room_external_missions VALUES
    ('room:one','profile:one','owner:one','mission:one',1,2,'run:one','active')`);
  await pool.query(`INSERT INTO helix_shared_realtime_rooms VALUES ('room:one','active')`);
  await pool.query(`INSERT INTO helix_shared_realtime_room_members VALUES
    ('room:one','owner:one','profile:one','owner','present')`);
  await pool.query(`INSERT INTO helix_environment_action_requests VALUES
    ('run:one','room:one','authority:one','manifest:one','binding:one',
     'source:one','world:one','actor:one','subject:one','succeeded')`);
  await pool.query(`INSERT INTO helix_environment_action_authorities VALUES
    ('authority:one','profile:one','binding:one','source-binding:one',
     'room:one','source:one','world:one','actor:one','subject:one','active',NULL)`);
  await pool.query(`INSERT INTO helix_environment_connector_bindings VALUES ('binding:one','active')`);
  await pool.query(`INSERT INTO helix_room_source_bindings VALUES ('source-binding:one','active')`);
  await pool.query(`INSERT INTO helix_environment_action_connector_manifests VALUES
    ('manifest:one','authority:one','node:one','epoch:one','binding:one',
     'room:one','source:one','world:one','actor:one','subject:one','active',NULL)`);
  await pool.query(`INSERT INTO helix_environment_action_connector_credentials VALUES
    ('authority:one','binding:one','node:one','active','2099-01-01T00:00:00.000Z')`);
  const read = (ownerProfileId = "profile:one") =>
    readCurrentOwnerMissionActivityScope({ roomId: "room:one", ownerProfileId,
      readDatabase: async () => pool as unknown as Queryable });
  return { pool, read };
};

describe("current owner mission activity scope", () => {
  it("derives one exact run, actor and producer epoch from server-owned rows", async () => {
    const f = await fixture();
    expect(await f.read()).toMatchObject({
      missionId: "mission:one", missionRevision: 1, bindingEpoch: 2,
      scope: { profile_ref: "profile:one", node_ref: "node:one", run_id: "run:one",
        room_ref: "room:one", source_ref: "source:one", world_ref: "world:one" },
      actionScope: { authorityId: "authority:one", participantId: "actor:one",
        subjectBindingId: "subject:one" },
      producerEpochRef: "epoch:one",
    });
    await f.pool.end();
  });

  it("fails closed for foreign owner, revoke, stale epoch and ambiguous actor", async () => {
    const f = await fixture();
    expect(await f.read("profile:foreign")).toBeNull();
    await f.pool.query(`UPDATE helix_room_external_missions SET status='revoked'`);
    expect(await f.read()).toBeNull();
    await f.pool.query(`UPDATE helix_room_external_missions SET status='active'`);
    await f.pool.query(`UPDATE helix_environment_action_connector_manifests SET status='superseded'`);
    expect(await f.read()).toBeNull();
    await f.pool.query(`UPDATE helix_environment_action_connector_manifests SET status='active'`);
    await f.pool.query(`INSERT INTO helix_environment_action_connector_manifests VALUES
      ('manifest:two','authority:one','node:one','epoch:two','binding:one',
       'room:one','source:one','world:one','actor:one','subject:one','active',NULL)`);
    await f.pool.query(`INSERT INTO helix_environment_action_requests VALUES
      ('run:one','room:one','authority:one','manifest:two','binding:one',
       'source:one','world:one','actor:one','subject:one','succeeded')`);
    expect(await f.read()).toBeNull();
    await f.pool.end();
  });

  it("does not infer a scope from a room whose owner is absent", async () => {
    const f = await fixture();
    await f.pool.query(`UPDATE helix_shared_realtime_room_members SET presence='away'`);
    expect(await f.read()).toBeNull();
    await f.pool.end();
  });
});
