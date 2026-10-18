import { expect, it, vi } from "vitest";
import fs, { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import * as broker from "../../services/environment-connectors/actions/action-broker";
import { createEnvironmentActionRouter } from "../../routes/environment-action-routes";
import * as activity from "../../services/helix-ask/operator-activity-ingestion";
import * as adapters from "../../services/situation-room/environment-adapter-registry";
import * as liveMail from "../../services/environment-connectors/live-mail/minecraft-situation-digest-mail-bridge";
import { environmentConnectorSha256 } from "../../services/environment-connectors/catalog";
import { helixEnvironmentActionRequestSchema, helixEnvironmentActionResultSchema } from "@shared/helix-environment-action";

vi.mock("../migrator", () => ({ runMigrations: async (pool: any) => {
  await pool.query(`CREATE TABLE helix_environment_action_requests (
    action_request_id text PRIMARY KEY, action_authority_id text, workflow_id text,
    status text, connector_manifest_id text, completed_at timestamptz, updated_at timestamptz,
    request_payload jsonb, deadline_at timestamptz);
    CREATE TABLE helix_environment_action_results (
    action_result_id text PRIMARY KEY, action_request_id text UNIQUE, workflow_id text, action_execution_id text,
    capability_id text, capability_version integer, action_kind text, outcome text, result_payload jsonb,
    submitted_result_hash text, result_hash text, controls_released boolean, host_access_performed boolean,
    automatic_replay_performed boolean, provenance_valid boolean, eligible_for_current_turn_reentry boolean,
    completed_at timestamptz, received_at timestamptz);
    CREATE TABLE helix_environment_action_connector_manifests (
    manifest_id text PRIMARY KEY, action_authority_id text, producer_epoch_ref text,
    status text, expires_at timestamptz, received_at timestamptz,
    environment_binding_id text, connector_installation_id text, domain text, domain_adapter text);
    CREATE TABLE helix_environment_action_workflow_events (
    event_id text PRIMARY KEY, action_request_id text, workflow_id text, sequence integer,
    event_type text, workflow_state text, event_payload jsonb, event_hash text,
    producer_epoch_ref text, created_at timestamptz, UNIQUE(workflow_id, sequence));
    CREATE TABLE helix_environment_event_batches (
      batch_id text PRIMARY KEY, environment_binding_id text, connector_manifest_id text,
      room_id text, source_id text, world_id text, producer_epoch_ref text, producer_plane text,
      first_sequence integer, last_sequence integer, batch_hash text, created_at timestamptz);
    CREATE TABLE helix_environment_events (
      event_id text PRIMARY KEY, batch_id text, environment_binding_id text, producer_epoch_ref text,
      producer_plane text, sequence integer, event_type text, subject_ref text, workflow_ref text,
      provenance text, event_payload jsonb, event_hash text, occurred_at timestamptz, observed_at timestamptz);
    CREATE TABLE helix_environment_situation_digests (
      digest_id text PRIMARY KEY, environment_binding_id text, room_id text, source_id text,
      world_id text, producer_epoch_ref text, producer_plane text, subject_ref text,
      window_started_at timestamptz, window_ended_at timestamptz, latest_event_sequence integer,
      digest_payload jsonb, digest_hash text, provenance_valid boolean, observed_at timestamptz);`);
} }));
vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

// Cross-language prerequisite: generate native-compiled-publication.json first.
it.runIf(process.env.HELIX_NATIVE_PUBLICATION_INTEGRATION === "1").each(["single", "projection", "batch"])("withholds native HTTP receipt until saved (mode=%s)", async mode => {
  const projection = mode === "projection";
  const batch = mode === "batch";
  const native = JSON.parse(readFileSync("minecraft/helix-fabric-player-agent/build/native-compiled-publication.json", "utf8"));
  const event = native.events[0];
  expect(event.sequence).toBe(0);
  expect(event.event_type).toBe("workflow.started");
  const batchEvents = [event, { ...event, sequence: 1, event_id: "event:batch-next", event_type: "workflow.progress" }];
  const body = projection ? native.batches[0] : batch ? { events: batchEvents } : event;
  const expectedRows = batch ? 2 : 1;
  const table = projection ? "helix_environment_events" : "helix_environment_action_workflow_events";
  const expectedEventId = projection ? body.events[0].event_id : event.event_id;
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-native-receipt-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  try {
    await db.ensureDatabase();
    await db.getPool().query(`INSERT INTO helix_environment_action_requests (action_request_id,action_authority_id,workflow_id,status,connector_manifest_id) VALUES ('root','authority','workflow','leased','manifest');
      INSERT INTO helix_environment_action_connector_manifests VALUES ('manifest','authority','fixture:producer_epoch','active',null,now(),'env','installation','minecraft','minecraft.fabric_client.v1')`);
    await db.requireLocalDatabaseSnapshotIfEnabled(["helix_environment_action_requests", "helix_environment_action_connector_manifests", table]);
    vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockResolvedValue({ authorityId: "authority",
      environmentBindingId: "env", connectorInstallationId: "installation", roomId: "room", sourceId: "source",
      worldId: "world", subjectBindingId: "subject", actionDomainAdapter: "minecraft.fabric_client.v1" } as never);
    const append = vi.spyOn(activity, "appendEnvironmentEventsToOperatorActivity").mockResolvedValue({ stream_ref: "fixture", events: [] } as never);
    vi.spyOn(adapters, "readEnvironmentAdapterProfileById").mockReturnValue({ profile: { freshness: { observation_max_age_ms: 30000 } } } as never);
    vi.spyOn(liveMail, "bridgeMinecraftPlayerSituationDigestToLiveMail").mockReturnValue({ fixture: true } as never);
    const app = express().use(createEnvironmentActionRouter());
    const endpoint = "/v1/authorities/authority/" + (projection ? "events/batch" : batch ? "requests/events" : "requests/event");
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("fixture receipt snapshot unavailable"));
    try {
      for (let retry = 0; retry < 2; retry++) {
        const response = await request(app).post(endpoint).send(body);
        expect(response.status).toBe(503);
        expect(response.body.ok).toBe(false);
        expect(JSON.parse(readFileSync(snapshot, "utf8")).tables[table]).toHaveLength(0);
        expect((await db.getPool().query(`SELECT * FROM ${table}`)).rows).toHaveLength(expectedRows);
        expect(append).not.toHaveBeenCalled();
      }
    } finally { rename.mockRestore(); }
    let changed = { ...body, summary: "Changed replay content" };
    if (projection) {
      const { batch_hash: ignored, ...content } = body;
      const changedContent = { ...content, events: [{ ...content.events[0], summary: "Changed replay content" }] };
      changed = { ...changedContent, batch_hash: environmentConnectorSha256(changedContent) };
    }
    if (batch) changed = { events: [{ ...event, summary: "Changed replay content" }, batchEvents[1]] };
    const conflicting = await request(app).post(endpoint).send(changed);
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error).toBe("action_event_conflict");
    const acknowledged = await request(app).post(endpoint).send(body);
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body).toMatchObject({ ok: true, replayed: true, terminal_eligible: false });
    if (batch) expect(acknowledged.body.event_ids).toEqual(batchEvents.map(item => item.event_id));
    else expect(acknowledged.body[projection ? "batch_id" : "event_id"]).toBe(projection ? body.batch_id : event.event_id);
    expect(append).toHaveBeenCalledTimes(projection ? 1 : 0);
    const saved = JSON.parse(readFileSync(snapshot, "utf8"));
    expect(saved.tables[table]).toHaveLength(expectedRows);
    if (projection) {
      expect(saved.tables.helix_environment_event_batches).toHaveLength(1);
      expect(saved.tables.helix_environment_situation_digests).toHaveLength(1);
      expect(saved.tables.helix_environment_situation_digests[0].latest_event_sequence).toBe(body.last_sequence);
    }
    expect(saved.tables.helix_environment_action_requests[0].status).toBe(projection ? "leased" : "running");
    await db.resetDbClient();
    await db.ensureDatabase();
    expect((await db.getPool().query(`SELECT event_id FROM ${table} ORDER BY event_id`)).rows).toEqual(
      (batch ? batchEvents.map(item => ({ event_id: item.event_id })) : [{ event_id: expectedEventId }])
        .sort((a, b) => a.event_id.localeCompare(b.event_id)));
  } finally {
    vi.restoreAllMocks();
    await db.resetDbClient();
    vi.unstubAllEnvs();
    for (const file of [snapshot, `${snapshot}.tmp`]) if (fs.existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
});

it.runIf(process.env.HELIX_NATIVE_PUBLICATION_INTEGRATION === "1")("persists native cancellation result before HTTP acknowledgement, without claiming verified execution", async () => {
  const native = JSON.parse(readFileSync("minecraft/helix-fabric-player-agent/build/native-compiled-terminal.json", "utf8"));
  const body = helixEnvironmentActionResultSchema.parse(native.result);
  expect(body.outcome).toBe("request_canceled");
  const payload = helixEnvironmentActionRequestSchema.parse({ ...native.root,
    schema: "helix.environment_action.request.v1", turn_id: "fixture:turn", provider_execution_id: "fixture:provider",
    tool_call_id: "fixture:tool", catalog_snapshot_id: "fixture:catalog", effect_class: "continuous_control",
    workflow_mode: "long_running", requested_control_engine: "native_fabric", preconditions: [],
    postconditions: [{ condition_id: "fixture:checkpoint", condition_kind: "checkpoint", required: true, parameters: {} }],
    idempotency_key: "fixture-terminal-request", confirmation_state: "approved", approval_ref: "fixture:approval",
    created_at: body.started_at, deadline_at: new Date(Date.now() + 60000).toISOString(),
    constraints: { max_duration_ms: 60000, max_distance_blocks: 128, max_block_mutations: 0, max_inventory_transfers: 0,
      manual_override_policy: "cancel", require_postcondition_verification: true, world_mutation_allowed: false,
      combat_allowed: false, host_access_allowed: false, automatic_replay_allowed: false },
    answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
  });
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-native-terminal-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1"); vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  try {
    await db.ensureDatabase();
    await db.getPool().query(`INSERT INTO helix_environment_action_requests
      (action_request_id,action_authority_id,workflow_id,status,connector_manifest_id,request_payload,deadline_at)
      VALUES ('root','authority','workflow','canceled','manifest',$1::jsonb,$2)`, [JSON.stringify(payload), payload.deadline_at]);
    await db.requireLocalDatabaseSnapshotIfEnabled(["helix_environment_action_requests", "helix_environment_action_results"]);
    // Deliberately incomplete provenance: persistence must never manufacture a
    // verified execution or successful terminal outcome from this receipt.
    vi.spyOn(broker, "authenticateEnvironmentActionConnector").mockResolvedValue({ authorityId: "authority" } as never);
    const app = express().use(createEnvironmentActionRouter());
    const endpoint = "/v1/authorities/authority/requests/result";
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("fixture terminal snapshot unavailable"));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect((await request(app).post(endpoint).send(body)).status).toBe(503);
        expect((await db.getPool().query("SELECT * FROM helix_environment_action_results")).rows).toHaveLength(1);
        expect(JSON.parse(readFileSync(snapshot, "utf8")).tables.helix_environment_action_results).toHaveLength(0);
      }
    } finally { rename.mockRestore(); }
    expect((await request(app).post(endpoint).send({ ...body, summary: "conflicting terminal replay" })).status).toBe(409);
    const replay = await request(app).post(endpoint).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, observation: { provenance_valid: false,
      eligible_for_current_turn_reentry: false, terminal_eligible: false } });
    expect(replay.body.observation.outcome).not.toBe("succeeded");
    expect(JSON.parse(readFileSync(snapshot, "utf8")).tables.helix_environment_action_results).toHaveLength(1);
    await db.resetDbClient(); await db.ensureDatabase();
    expect((await db.getPool().query("SELECT action_request_id FROM helix_environment_action_results")).rows).toEqual([{ action_request_id: "root" }]);
  } finally {
    vi.restoreAllMocks(); await db.resetDbClient(); vi.unstubAllEnvs();
    for (const file of [snapshot, `${snapshot}.tmp`]) if (fs.existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
});
