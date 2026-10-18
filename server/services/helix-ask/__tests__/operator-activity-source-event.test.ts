import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { HelixEnvironmentEvent } from "@shared/helix-environment-event-stream";
import { environmentConnectorSha256 } from "../../environment-connectors/catalog";
import { readVerifiedEnvironmentSourceEventForActivity } from "../operator-activity-source-event";
import type { EnvironmentOperatorActivityActionScope } from "../operator-activity-environment-run";
import type { Queryable } from "../realtime-room/room-store/types";

const actionScope: EnvironmentOperatorActivityActionScope = {
  ownerProfileId: "profile:one", authorityId: "authority:one",
  connectorInstallationId: "node:one", environmentBindingId: "binding:one",
  roomId: "room:one", sourceId: "source:one", worldId: "world:one",
  participantId: "participant:one", subjectBindingId: "subject:one",
};
const event: HelixEnvironmentEvent = {
  schema: "helix.environment_event.v1", event_id: "event:one", sequence: 1,
  event_type: "workflow.completed", domain: "minecraft", domain_adapter: "fabric_player",
  room_id: "room:one", source_id: "source:one", world_id: "world:one",
  producer_epoch_ref: "epoch:one", producer_plane: "player_embodiment",
  subject_ref: "subject:one", workflow_ref: "workflow:one",
  summary: "Measured completion.", attributes: {}, evidence_refs: [],
  occurred_at: "2026-09-30T15:00:00.000Z",
  observed_at: "2026-09-30T15:00:01.000Z",
  provenance: "measured", raw_event_included: false,
  content_role: "environment_event_not_assistant_answer",
  answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
};

const fixture = async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await pool.query(`CREATE TABLE helix_environment_events (
    event_id text, environment_binding_id text, producer_epoch_ref text,
    producer_plane text, event_payload jsonb, event_hash text);`);
  await pool.query(`INSERT INTO helix_environment_events VALUES ($1,$2,$3,$4,$5,$6)`,
    [event.event_id, actionScope.environmentBindingId, event.producer_epoch_ref,
      event.producer_plane, JSON.stringify(event), environmentConnectorSha256(event)]);
  const read = (patch: Partial<Parameters<typeof readVerifiedEnvironmentSourceEventForActivity>[0]> = {}) =>
    readVerifiedEnvironmentSourceEventForActivity({
      eventRef: event.event_id, actionScope,
      expectedProducerEpochRef: "epoch:one",
      readDatabase: async () => pool as unknown as Queryable,
      ...patch,
    });
  return { pool, read };
};

describe("protected source-event read for mission activity", () => {
  it("returns only the hash-verified exact event", async () => {
    const f = await fixture();
    expect(await f.read()).toEqual(event);
    expect(await f.read({ eventRef: "event:foreign" })).toBeNull();
    expect(await f.read({ expectedProducerEpochRef: "epoch:rotated" })).toBeNull();
    expect(await f.read({ actionScope: { ...actionScope, subjectBindingId: "subject:foreign" } }))
      .toBeNull();
    await f.pool.end();
  });

  it("rejects tampered payloads and missing or ambiguous rows", async () => {
    const f = await fixture();
    await f.pool.query(`UPDATE helix_environment_events
      SET event_payload=$1 WHERE event_id=$2`,
    [JSON.stringify({ ...event, summary: "Forged success." }), event.event_id]);
    expect(await f.read()).toBeNull();
    await f.pool.query(`DELETE FROM helix_environment_events`);
    expect(await f.read()).toBeNull();
    await f.pool.query(`INSERT INTO helix_environment_events VALUES ($1,$2,$3,$4,$5,$6)`,
      [event.event_id, actionScope.environmentBindingId, event.producer_epoch_ref,
        event.producer_plane, JSON.stringify(event), environmentConnectorSha256(event)]);
    await f.pool.query(`INSERT INTO helix_environment_events VALUES ($1,$2,$3,$4,$5,$6)`,
      [event.event_id, actionScope.environmentBindingId, event.producer_epoch_ref,
        event.producer_plane, JSON.stringify(event), environmentConnectorSha256(event)]);
    expect(await f.read()).toBeNull();
    await f.pool.end();
  });
});
