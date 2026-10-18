import express from "express";
import request from "supertest";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { HelixEnvironmentEvent } from "@shared/helix-environment-event-stream";
import { migration080 } from "../../db/migrations/080_operator_activity_ledger";
import { environmentConnectorSha256 } from
  "../../services/environment-connectors/catalog";
import { appendEnvironmentEventsToOperatorActivity } from
  "../../services/helix-ask/operator-activity-ingestion";
import { VERIFIED_ENVIRONMENT_WORKFLOW_RUN_SQL } from
  "../../services/helix-ask/operator-activity-environment-run";
import { readVerifiedOwnerMissionActivityPage } from
  "../../services/helix-ask/operator-activity-mission-page";
import { readCurrentOwnerMissionActivityScope } from
  "../../services/helix-ask/operator-activity-mission-scope";
import { readVerifiedEnvironmentSourceEventForActivity } from
  "../../services/helix-ask/operator-activity-source-event";
import { HelixOperatorActivityStore } from
  "../../services/helix-ask/operator-activity-store";
import type { Queryable } from
  "../../services/helix-ask/realtime-room/room-store/types";
import { createOperatorActivityRouter } from "../operator-activity";

describe("composed owner mission overlay read", () => {
  it("joins a real canonical event, source hash, workflow run and current owner through the route", async () => {
    const { Pool: MemoryPool } = newDb().adapters.createPg();
    const pool = new MemoryPool() as unknown as Pool;
    const client = await pool.connect();
    try { await migration080.run(client, { enablePgvector: false }); }
    finally { client.release(); }
    for (const ddl of [
      `CREATE TABLE helix_room_external_missions (room_id text, owner_profile_id text,
        owner_participant_id text, mission_id text, mission_revision integer,
        binding_epoch integer, run_id text, status text)`,
      `CREATE TABLE helix_shared_realtime_rooms (room_id text, status text)`,
      `CREATE TABLE helix_shared_realtime_room_members (room_id text,
        participant_id text, profile_id text, member_role text, presence text)`,
      `CREATE TABLE helix_environment_action_requests (workflow_id text, run_id text,
        room_id text, action_authority_id text, connector_manifest_id text,
        environment_binding_id text, source_id text, world_id text,
        participant_id text, subject_binding_id text, status text)`,
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
      `CREATE TABLE helix_environment_events (event_id text, environment_binding_id text,
        producer_epoch_ref text, producer_plane text, event_payload jsonb,
        event_hash text)`,
    ]) await pool.query(ddl);
    await pool.query(`INSERT INTO helix_room_external_missions VALUES
      ('room:one','profile:one','owner:one','mission:one',1,2,'run:one','active')`);
    await pool.query(`INSERT INTO helix_shared_realtime_rooms VALUES ('room:one','active')`);
    await pool.query(`INSERT INTO helix_shared_realtime_room_members VALUES
      ('room:one','owner:one','profile:one','owner','present')`);
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
    await pool.query(`INSERT INTO helix_environment_action_requests VALUES
      ('workflow:one','run:one','room:one','authority:one','manifest:one',
       'binding:one','source:one','world:one','actor:one','subject:one','succeeded')`);
    const occurredAt = new Date(Date.now() - 1_000).toISOString();
    const observedAt = new Date().toISOString();
    const event: HelixEnvironmentEvent = {
      schema: "helix.environment_event.v1", event_id: "event:one", sequence: 1,
      event_type: "workflow.completed", domain: "minecraft", domain_adapter: "fabric_player",
      room_id: "room:one", source_id: "source:one", world_id: "world:one",
      producer_epoch_ref: "epoch:one", producer_plane: "player_embodiment",
      subject_ref: "subject:one", workflow_ref: "workflow:one",
      summary: "Measured workflow completion.", attributes: {}, evidence_refs: [],
      occurred_at: occurredAt, observed_at: observedAt,
      provenance: "measured", raw_event_included: false,
      content_role: "environment_event_not_assistant_answer",
      answer_authority: false, assistant_answer: false,
      terminal_eligible: false, raw_content_included: false,
    };
    await pool.query(`INSERT INTO helix_environment_events VALUES ($1,$2,$3,$4,$5,$6)`,
      [event.event_id, "binding:one", "epoch:one", "player_embodiment",
        JSON.stringify(event), environmentConnectorSha256(event)]);
    const activityStore = new HelixOperatorActivityStore({ pool });
    await appendEnvironmentEventsToOperatorActivity({ profileId: "profile:one",
      nodeRef: "node:one", environmentBindingRef: "binding:one", events: [event],
      store: activityStore });
    const database = async () => pool as unknown as Queryable;
    const app = express();
    app.use("/api/account", createOperatorActivityRouter({
      activityStore,
      resolveSession: async sessionId => sessionId === "session:one"
        ? { session_id: "session:one", profile: { profile_id: "profile:one" } }
        : sessionId === "session:foreign"
          ? { session_id: "session:foreign", profile: { profile_id: "profile:foreign" } }
          : null,
      readMissionScope: input => readCurrentOwnerMissionActivityScope({
        ...input, readDatabase: database,
      }),
      readMissionPage: input => readVerifiedOwnerMissionActivityPage({
        ...input,
        sourceRead: source => readVerifiedEnvironmentSourceEventForActivity({
          ...source, readDatabase: database,
        }),
        runLookup: async params => (await pool.query(VERIFIED_ENVIRONMENT_WORKFLOW_RUN_SQL,
          [...params])).rows,
      }),
    }));
    const path = "/api/account/session/operator-activity/mission-overlay?room_id=room:one";
    const first = await request(app).get(path)
      .set("Cookie", "helix_session=session:one").expect(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body.projections).toMatchObject([{
      run_id: "run:one", summary: "Environment workflow completed: succeeded.",
      label: "Activity completed", answer_authority: false,
    }]);
    const poll = await request(app).get(`${path}&cursor=${encodeURIComponent(first.body.poll_cursor)}`)
      .set("Cookie", "helix_session=session:one").expect(200);
    expect(poll.body.projections).toEqual([]);
    const replay = await appendEnvironmentEventsToOperatorActivity({ profileId: "profile:one",
      nodeRef: "node:one", environmentBindingRef: "binding:one", events: [event],
      store: activityStore });
    expect(replay.replayed).toEqual([true]);
    const second = await request(app).get(path)
      .set("Cookie", "helix_session=session:one").expect(200);
    expect(second.body.projections).toEqual(first.body.projections);
    await pool.query(`UPDATE helix_environment_events SET event_hash=$1 WHERE event_id=$2`,
      ["0".repeat(64), event.event_id]);
    const tampered = await request(app).get(path)
      .set("Cookie", "helix_session=session:one").expect(200);
    expect(tampered.body.projections).toEqual([]);
    await pool.query(`UPDATE helix_environment_events SET event_hash=$1 WHERE event_id=$2`,
      [environmentConnectorSha256(event), event.event_id]);
    await pool.query(`UPDATE helix_environment_action_connector_manifests
      SET producer_epoch_ref='epoch:rotated' WHERE manifest_id='manifest:one'`);
    const rotated = await request(app).get(path)
      .set("Cookie", "helix_session=session:one").expect(200);
    expect(rotated.body.session_identity.producer_epoch_ref).toBe("epoch:rotated");
    expect(rotated.body.projections).toEqual([]);
    const rotatedPoll = await request(app).get(`${path}&cursor=${encodeURIComponent(first.body.poll_cursor)}`)
      .set("Cookie", "helix_session=session:one").expect(200);
    expect(rotatedPoll.body.session_identity.producer_epoch_ref).toBe("epoch:rotated");
    expect(rotatedPoll.body.projections).toEqual([]);
    await pool.query(`UPDATE helix_environment_action_connector_manifests
      SET producer_epoch_ref='epoch:one' WHERE manifest_id='manifest:one'`);
    await pool.query(`UPDATE helix_environment_action_connector_credentials
      SET expires_at='2020-01-01T00:00:00.000Z' WHERE action_authority_id='authority:one'`);
    await request(app).get(path).set("Cookie", "helix_session=session:one").expect(409);
    await pool.query(`UPDATE helix_environment_action_connector_credentials
      SET expires_at='2099-01-01T00:00:00.000Z' WHERE action_authority_id='authority:one'`);
    await pool.query(`UPDATE helix_environment_action_authorities
      SET status='revoked' WHERE action_authority_id='authority:one'`);
    await request(app).get(path).set("Cookie", "helix_session=session:one").expect(409);
    await pool.query(`UPDATE helix_environment_action_authorities
      SET status='active' WHERE action_authority_id='authority:one'`);
    await request(app).get(path).set("Cookie", "helix_session=session:foreign").expect(409);
    await pool.query(`UPDATE helix_room_external_missions SET status='revoked'`);
    await request(app).get(path).set("Cookie", "helix_session=session:one").expect(409);
    await pool.end();
  });
});
