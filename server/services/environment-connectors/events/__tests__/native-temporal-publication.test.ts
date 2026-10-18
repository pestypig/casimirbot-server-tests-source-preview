import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { readTemporalPublicationClock } from "../../temporal-plans/temporal-publication-clock";
import { auditTemporalCorrelatedBudget } from "../../temporal-plans/temporal-correlated-budget";
import { publishTemporalPerceptionFrontier } from "../../temporal-plans/temporal-frontier-publisher";
import { EnvironmentTemporalFrontierStore } from "../../temporal-plans/temporal-frontier-store";
import * as perceptionContext from "../../temporal-plans/temporal-perception-context";
import * as successorContext from "../../temporal-plans/temporal-successor-context";
import { buildHelixEnvironmentAffordanceFrontier } from "@shared/helix-environment-time";
import { recordEnvironmentActionEventBatch } from "../event-stream-store";
import type { EnvironmentActionConnectorClaim } from "../../actions";
import {
  helixEnvironmentActionWorkflowEventSchema,
  helixEnvironmentActionRequestSchema,
} from "@shared/helix-environment-action";
import {
  resolveTemporalEventChain,
  verifyTemporalResidentEffects,
  verifyTemporalSuccessorAcceptance,
} from "../../temporal-plans/temporal-event-plan";
import {
  environmentActionSequenceCheckpointMeasurementsValid,
  submitEnvironmentActionWorkflowEvent,
  leasePendingEnvironmentTemporalSuccessor,
  readEnvironmentTemporalDeliveryState,
  enqueueEnvironmentAction,
  leasePendingEnvironmentActions,
  submitEnvironmentActionResult,
} from "../../actions/action-broker";
import * as roomDatabase from "../../../helix-ask/realtime-room/room-store/database";
import * as registry from "../../../situation-room/environment-action-adapter-registry";
import * as membership from "../../../helix-ask/realtime-room/room-store";
import { helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";
import { helixMinecraftFluidSequenceArgumentsSchema } from "@shared/helix-minecraft-fluid-sequence";
import * as localDb from "../../../../db/client";

// The test creates its bounded schema below; the real client/snapshot writer
// still owns the persistent pool and transaction durability path.
vi.mock("../../../../db/migrator", () => ({
  runMigrations: async () => undefined,
}));
vi.mock("../../../runtime/runtime-memory-governor", () => ({
  scheduleRuntimeIdleMemorySettle: () => undefined,
}));
afterEach(() => vi.restoreAllMocks());

// Opt-in cross-language integration: run PlayerActionRuntimeTransportTest first,
// then set HELIX_NATIVE_PUBLICATION_INTEGRATION=1. Once enabled, a missing native
// artifact fails (it is never replaced with a hand-authored fixture).
it
  .runIf(process.env.HELIX_NATIVE_PUBLICATION_INTEGRATION === "1")
  .each(["native-temporal-publication", "native-compiled-publication"])(
  "stores unchanged %s and acknowledges exact replay [requires native build]",
  async (name) => {
    const roundtrip =
      name === "native-compiled-publication" &&
      process.env.HELIX_NATIVE_BROKER_ROUNDTRIP === "1";
    const wideRunway = roundtrip && process.env.HELIX_NATIVE_BROKER_WIDE_RUNWAY === "1";
    const continuous = roundtrip && process.env.HELIX_NATIVE_BROKER_CONTINUOUS === "1";
    const continuousStop = continuous ? process.env.HELIX_NATIVE_BROKER_CONTINUOUS_STOP : undefined;
    const continuousLostThird = continuous && process.env.HELIX_NATIVE_BROKER_CONTINUOUS_LOST_THIRD === "1";
    const continuousLostBatchAck = continuous && process.env.HELIX_NATIVE_BROKER_CONTINUOUS_LOST_BATCH_ACK === "1";
    if (continuousLostBatchAck && (continuousStop || continuousLostThird)) throw new Error("Choose one continuous fault per run");
    if (continuousLostThird && continuousStop) throw new Error("Choose one continuous fault per run");
    if (continuousStop && !["cancel", "emergency", "manual"].includes(continuousStop)) throw new Error("Unknown continuous stop fixture");
    const nativeArtifactName = wideRunway ? "native-compiled-wide-publication" : name;
    let native = continuous ? null : JSON.parse(
      readFileSync(
        `minecraft/helix-fabric-player-agent/build/${nativeArtifactName}.json`,
        "utf8",
      ),
    );
    if (continuous) {
      const recorded = JSON.parse(readFileSync("minecraft/helix-fabric-player-agent/build/native-continuous-runtime.json", "utf8"));
      native = { root: recorded.wires[0], child: recorded.wires[1],
        events: recorded.publications.filter((item: any) => item.path === "/requests/event").map((item: any) => item.body),
        batches: recorded.publications.filter((item: any) => item.path === "/events/batch").map((item: any) => item.body),
        wires: recorded.wires };
    }
    const lostResponse =
      roundtrip &&
      (process.env.HELIX_NATIVE_BROKER_LOST_RESPONSE === "1" ||
        process.env.HELIX_NATIVE_BROKER_SNAPSHOT_FAILURE === "1");
    const snapshotFailure =
      roundtrip && process.env.HELIX_NATIVE_BROKER_SNAPSHOT_FAILURE === "1";
    const advancingClock = roundtrip && process.env.HELIX_NATIVE_BROKER_ADVANCING_CLOCK === "1";
    const lateResponse =
      roundtrip && (process.env.HELIX_NATIVE_BROKER_LATE_RESPONSE === "1" || advancingClock);
    if (lostResponse && lateResponse)
      throw new Error("Choose one connected delivery fault per run");
    if (wideRunway && (lostResponse || lateResponse)) throw new Error("Wide positive mode must not mix fault fixtures");
    if (continuous && (wideRunway || lostResponse || lateResponse || process.env.HELIX_NATIVE_BROKER_PERSISTENCE === "1"))
      throw new Error("Continuous fixture has its own simulated clock and in-memory database mode");
    for (const event of native.events)
      helixEnvironmentActionWorkflowEventSchema.parse(event);
    expect(native.batches.length).toBeGreaterThan(0);
    const first = native.batches[0];
    const persistent =
      roundtrip &&
      (process.env.HELIX_NATIVE_BROKER_PERSISTENCE === "1" || snapshotFailure);
    const directory = persistent
      ? mkdtempSync(path.join(tmpdir(), "casimir-connected-db-"))
      : null;
    const snapshotPath = directory
      ? path.join(directory, "snapshot.json")
      : null;
    if (persistent) {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath!);
      vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
      vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
      await localDb.ensureDatabase();
    }
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = persistent ? localDb.getPool() : new Pool();
    try {
      await pool.query(`
      CREATE TABLE helix_environment_action_connector_manifests (
        manifest_id text, producer_epoch_ref text, domain text, domain_adapter text,
        status text, expires_at timestamptz, received_at timestamptz,
        action_authority_id text, environment_binding_id text, connector_installation_id text);
      CREATE TABLE helix_environment_event_batches (
        batch_id text PRIMARY KEY, environment_binding_id text, connector_manifest_id text,
        room_id text, source_id text, world_id text, producer_epoch_ref text, producer_plane text,
        first_sequence integer, last_sequence integer, batch_hash text, created_at timestamptz);
      CREATE TABLE helix_environment_events (
        event_id text PRIMARY KEY, batch_id text, environment_binding_id text, producer_epoch_ref text,
        producer_plane text, sequence integer, event_type text, subject_ref text, workflow_ref text,
        provenance text, event_payload jsonb, event_hash text, occurred_at timestamptz, observed_at timestamptz,
        UNIQUE(environment_binding_id, producer_epoch_ref, sequence));
      CREATE TABLE helix_environment_situation_digests (
        digest_id text PRIMARY KEY, environment_binding_id text, room_id text, source_id text,
        world_id text, producer_epoch_ref text, producer_plane text, subject_ref text,
        window_started_at timestamptz, window_ended_at timestamptz, latest_event_sequence integer,
        digest_payload jsonb, digest_hash text, provenance_valid boolean, observed_at timestamptz);
    `);
      const claim = {
        authorityId: "authority",
        environmentBindingId: "env",
        connectorInstallationId: "installation",
        roomId: first.room_id,
        sourceId: first.source_id,
        worldId: first.world_id,
        subjectBindingId: first.events[0].subject_ref,
        actionDomainAdapter: first.events[0].domain_adapter,
      } as EnvironmentActionConnectorClaim;
      Object.assign(claim, {
        ownerProfileId: "fixture:profile",
        credentialId: "fixture:credential",
        policyVersion: 1,
        participantId: native.root.participant_id,
        subjectNativeId: native.root.subject_native_id,
      });
      await pool.query(
        `INSERT INTO helix_environment_action_connector_manifests VALUES
      ('manifest', $1, 'minecraft', $2, 'active', null, now(), 'authority', 'env', 'installation')`,
        [first.producer_epoch_ref, claim.actionDomainAdapter],
      );
      if (name === "native-compiled-publication") {
        const compiledPair = continuous ? {} : JSON.parse(
          readFileSync(
            `minecraft/helix-fabric-player-agent/build/server-compiled-handoff${wideRunway ? "-wide" : ""}.json`,
            "utf8",
          ),
        );
        const compiledChain = continuous ? JSON.parse(readFileSync(
          "minecraft/helix-fabric-player-agent/build/server-compiled-continuous-chain.json", "utf8")) : null;
        if (continuous) Object.assign(compiledPair, { root: compiledChain[0], child: compiledChain[1] });
        await pool.query(`CREATE TABLE helix_environment_action_requests (
        action_request_id text PRIMARY KEY, request_payload jsonb, status text,
        action_authority_id text, workflow_id text, connector_manifest_id text,
        deadline_at timestamptz, lease_expires_at timestamptz, completed_at timestamptz, updated_at timestamptz,
        policy_version integer DEFAULT 1, run_id text, attempt_count integer DEFAULT 0, leased_at timestamptz);
        CREATE TABLE helix_environment_action_workflow_events (
        event_id text PRIMARY KEY, action_request_id text, workflow_id text, sequence integer,
        event_type text, workflow_state text, event_payload jsonb, event_hash text,
        producer_epoch_ref text, created_at timestamptz, UNIQUE(workflow_id, sequence));
        CREATE TABLE helix_environment_temporal_plan_admissions (
        action_request_id text PRIMARY KEY, plan_id text, source_plan jsonb, compilation_artifact jsonb,
        resident_action_request_id text, checkpoint_association jsonb,
        previous_plan_id text, previous_plan_hash text, reasoning_binding_id text,
        reasoning_binding_epoch integer, client_continuation_ref text);
        CREATE TABLE helix_environment_action_authorities (action_authority_id text);
        INSERT INTO helix_environment_action_authorities VALUES ('authority');
        CREATE TABLE helix_environment_durable_goals (goal_id text, current_sequence integer, status text);
        CREATE TABLE helix_environment_action_control_requests (action_authority_id text, status text);
        CREATE TABLE helix_environment_action_connector_heartbeats (action_authority_id text, manifest_id text,
          status text, received_at timestamptz, emergency_stop_latched boolean, control_engines jsonb);
        INSERT INTO helix_environment_action_connector_heartbeats VALUES ('authority','manifest','active',now(),false,'[]');`);
        await pool.query(
          "INSERT INTO helix_environment_durable_goals VALUES ($1,$2,'active')",
          [
            compiledPair.root.source.identity.goal_id,
            compiledPair.root.source.identity.goal_revision,
          ],
        );
        let acceptanceEvent = native.events.find(
          (event: any) => event.measurements.temporal_successor_acceptance,
        );
        expect(acceptanceEvent).toBeDefined();
        const checkpoint =
          acceptanceEvent.measurements.checkpoint_settlements.at(-1);
        const association = {
          resident_action_request_id: "root",
          workflow_id: "workflow",
          plan_id: compiledPair.root.source.plan_id,
          plan_hash: compiledPair.root.source.plan_hash,
          checkpoint_id: checkpoint.checkpoint_id,
          native_node_id: checkpoint.node_id,
          native_tick_index: checkpoint.tick_index,
          workflow_monotonic_elapsed_ns: checkpoint.monotonic_elapsed_ns,
        };
        let childRequest: any;
        let rootRequest: any;
        const continuousRequests: any[] = [];
        for (const key of continuous ? ["root", "child", "child:2", "child:3"] : ["root", "child"]) {
          const wire = continuous ? native.wires[continuousRequests.length] : native[key];
          const request = helixEnvironmentActionRequestSchema.parse({
            ...wire,
            schema: "helix.environment_action.request.v1",
            turn_id: "fixture:turn",
            provider_execution_id: "fixture:provider",
            tool_call_id: `fixture:tool-${key}`,
            catalog_snapshot_id: "fixture:catalog",
            effect_class: "continuous_control",
            workflow_mode: "long_running",
            requested_control_engine: "native_fabric",
            preconditions: [],
            postconditions: [
              {
                condition_id: "fixture:checkpoint",
                condition_kind: "checkpoint",
                required: true,
                parameters: {},
              },
            ],
            idempotency_key: `fixture-request-${key}`,
            confirmation_state: "approved",
            approval_ref: "fixture:approval",
            created_at: new Date().toISOString(),
            deadline_at: new Date(Date.now() + 60_000).toISOString(),
            constraints: {
              max_duration_ms: 60000,
              max_distance_blocks: 128,
              max_block_mutations: 0,
              max_inventory_transfers: 0,
              manual_override_policy: "cancel",
              require_postcondition_verification: true,
              world_mutation_allowed: false,
              combat_allowed: false,
              host_access_allowed: false,
              automatic_replay_allowed: false,
            },
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          });
          if (roundtrip) {
            if (continuous) continuousRequests.push(request);
            if (key === "child") childRequest = request;
            else if (key === "root") rootRequest = request;
            continue;
          }
          await pool.query(
            `INSERT INTO helix_environment_action_requests
          (action_request_id,request_payload,status,action_authority_id,workflow_id,connector_manifest_id,deadline_at,lease_expires_at,run_id)
          VALUES ($1,$2::jsonb,$3,'authority','workflow','manifest',$4,$4,$5)`,
            [
              wire.action_request_id,
              JSON.stringify(request),
              key === "root" ? "running" : "admitted",
              request.deadline_at,
              request.run_id,
            ],
          );
          await pool.query(
            `INSERT INTO helix_environment_temporal_plan_admissions VALUES
          ($1,$2,$3::jsonb,$4::jsonb,'root',$5::jsonb,$6,$7,'fixture:binding',1,'fixture:continuation')`,
            [
              wire.action_request_id,
              wire.temporal_plan.plan_id,
              JSON.stringify(compiledPair[key].source),
              JSON.stringify(compiledPair[key].artifact),
              key === "child" ? JSON.stringify(association) : null,
              wire.temporal_plan.previous_plan_id,
              wire.temporal_plan.previous_plan_hash,
            ],
          );
        }
        if (roundtrip) {
          for (const column of "catalog_snapshot_id environment_binding_id room_id source_id world_id participant_id subject_binding_id subject_native_id turn_id provider_execution_id tool_call_id capability_id action_kind effect_class workflow_mode requested_control_engine request_hash idempotency_key confirmation_state approval_ref cancellation_reason".split(
            " ",
          ))
            await pool.query(
              `ALTER TABLE helix_environment_action_requests ADD COLUMN ${column} text`,
            );
          await pool.query(`ALTER TABLE helix_environment_action_requests ADD COLUMN capability_version integer;
            ALTER TABLE helix_environment_action_requests ADD COLUMN created_at timestamptz;
            ALTER TABLE helix_environment_temporal_plan_admissions ADD COLUMN plan_hash text;
            ALTER TABLE helix_environment_temporal_plan_admissions ADD COLUMN compilation_hash text;
            ALTER TABLE helix_environment_temporal_plan_admissions ADD COLUMN frontier_id text;
            ALTER TABLE helix_environment_temporal_plan_admissions ADD COLUMN goal_id text;
            ALTER TABLE helix_environment_temporal_plan_admissions ADD COLUMN goal_revision integer;
            CREATE TABLE helix_environment_temporal_frontiers (frontier_id text, goal_id text, goal_revision integer,
              frontier_payload jsonb, payload_hash text, observed_at timestamptz, retained_until timestamptz,
              frontier_revision integer, observation_evidence_ref text, observation_producer_epoch_ref text,
              action_producer_epoch_ref text, identity_hash text);
            CREATE TABLE helix_environment_durable_goal_participants (goal_id text, profile_id text, participant_id text, status text, scopes jsonb);
            ALTER TABLE helix_environment_action_connector_manifests ADD COLUMN capabilities jsonb;
            ALTER TABLE helix_environment_action_connector_manifests ADD COLUMN manifest_hash text;`);
          await pool.query(`CREATE TABLE helix_environment_action_results (
            action_result_id text PRIMARY KEY, action_request_id text UNIQUE, workflow_id text, action_execution_id text,
            capability_id text, capability_version integer, action_kind text, outcome text, result_payload jsonb,
            submitted_result_hash text, result_hash text, controls_released boolean, host_access_performed boolean,
            automatic_replay_performed boolean, provenance_valid boolean, eligible_for_current_turn_reentry boolean,
            completed_at timestamptz, received_at timestamptz);`);
          await pool.query(
            "INSERT INTO helix_environment_durable_goal_participants VALUES ($1,'fixture:profile','participant','active','[\"steer\"]')",
            [compiledPair.root.source.identity.goal_id],
          );
          await pool.query(
            "UPDATE helix_environment_action_connector_manifests SET manifest_hash='fixture:manifest',capabilities=$1",
            [
              JSON.stringify([
                {
                  capability_id: childRequest.capability_id,
                  capability_version: 1,
                  action_kind: "execute_sequence",
                  effect_class: "continuous_control",
                  workflow_modes: ["long_running"],
                  control_engines: ["native_fabric"],
                  execution_features: [
                    "latest_start_tick_v1",
                    "temporal_plan_v1",
                  ],
                },
              ]),
            ],
          );
        }
        const verifyRecordedChain = async () => {
          for (const event of native.events) {
            if (!Array.isArray(event.measurements.checkpoint_settlements))
              continue;
            const chain = await resolveTemporalEventChain(
              pool,
              native.root,
              event.measurements,
              first.producer_epoch_ref,
              false,
            );
            for (const evidence of chain)
              expect(
                environmentActionSequenceCheckpointMeasurementsValid({
                  sequence: helixMinecraftFluidSequenceArgumentsSchema.parse(
                    evidence.arguments,
                  ),
                  measurements: evidence.measurements,
                  require_complete: evidence.require_complete,
                }),
              ).toBe(true);
            verifyTemporalResidentEffects(event.measurements, chain);
            const accepted = await verifyTemporalSuccessorAcceptance(
              pool,
              native.root,
              event.measurements,
              first.producer_epoch_ref,
              event.clock,
            );
            expect(accepted).toBe(
              event === acceptanceEvent ? "child" : undefined,
            );
          }
          const activated = native.events.at(-1);
          expect(activated.measurements.sequence_id).toBe("plan:1");
          await expect(
            resolveTemporalEventChain(
              pool,
              { ...native.root, run_id: "wrong-run" },
              activated.measurements,
              first.producer_epoch_ref,
              false,
            ),
          ).rejects.toThrow("identity_mismatch");
          await expect(
            verifyTemporalSuccessorAcceptance(
              pool,
              native.root,
              {
                ...acceptanceEvent.measurements,
                temporal_successor_acceptance: {
                  ...acceptanceEvent.measurements.temporal_successor_acceptance,
                  accepted_client_tick: 1,
                },
              },
              first.producer_epoch_ref,
              acceptanceEvent.clock,
            ),
          ).rejects.toThrow("acceptance_mismatch");
        };
        expect(native.events[0].sequence).toBe(0);
        // Only authority join observations are stubbed; delivery selection, current
        // event checks, retained identities and the one-shot lease execute real SQL.
        const deliveryDb = {
          query: async (sql: string, values?: any[]) => {
            if (sql.includes("FROM helix_environment_action_authorities a"))
              return {
                rows: [
                  {
                    ...native.root,
                    allowed_capability_ids: [native.root.capability_id],
                    autonomy_mode: "approve_each",
                    authority_status: "active",
                    authority_expires_at: null,
                    environment_status: "active",
                    source_status: "active",
                    room_status: "open",
                    owner_profile_id: claim.ownerProfileId,
                    credential_id: claim.credentialId,
                    policy_version: 1,
                    credential_status: "active",
                    credential_expires_at: new Date(Date.now() + 60000),
                  },
                ],
              };
            if (
              roundtrip &&
              sql.includes(
                "FROM helix_environment_capability_catalog_snapshots",
              )
            )
              return {
                rows: [
                  {
                    catalog_snapshot_id: "fixture:catalog",
                    manifest_hash: "fixture:manifest",
                  },
                ],
              };
            return pool.query(sql, values);
          },
        };
        let bindingActive = true;
        const delivery = {
          claim,
          residentActionRequestId: "root",
          predecessorPlanId: association.plan_id,
          predecessorPlanHash: association.plan_hash,
          checkpointId: association.checkpoint_id,
          bindingStore: {
            inspect: () => ({
              status: bindingActive ? "active" : "revoked",
              binding_epoch: 1,
              run_id: native.root.run_id,
              provider_thread_ref_hash: createHash("sha256")
                .update("fixture:continuation")
                .digest("hex"),
            }),
          },
        };
        const realTransaction = roomDatabase.withSharedRealtimeRoomTransaction;
        const transaction = vi
          .spyOn(roomDatabase, "withSharedRealtimeRoomTransaction")
          .mockImplementation(async (handler, options) =>
            persistent
              ? realTransaction(
                  async (client) =>
                    handler(
                      new Proxy(client, {
                        get(target, property, receiver) {
                          if (property !== "query")
                            return Reflect.get(target, property, receiver);
                          return (sql: string, values?: any[]) =>
                            sql.includes(
                              "FROM helix_environment_action_authorities a",
                            ) ||
                            sql.includes(
                              "FROM helix_environment_capability_catalog_snapshots",
                            )
                              ? deliveryDb.query(sql, values)
                              : target.query(sql, values);
                        },
                      }),
                    ),
                  options,
                )
              : handler(deliveryDb as never),
          );
        const adapter = vi
          .spyOn(registry, "resolveEnvironmentActionAdapterProfile")
          .mockReturnValue({
            profile: { freshness: { heartbeat_max_age_ms: 5000 } },
          } as never);
        const member = vi
          .spyOn(membership, "readSharedRealtimeRoomMembership")
          .mockResolvedValue({
            participantId: "participant",
            role: "owner",
          } as never);
        try {
          if (roundtrip) {
            const clockOrigin = process.hrtime.bigint();
            const admissionDiagnostics: Record<string, unknown>[] = [];
            const deliveryDiagnostics: Record<string, unknown>[] = [];
            const frontierDiagnostics: Record<string, unknown>[] = [];
            vi.spyOn(console, "info").mockImplementation((label, value) => {
              if (label === "[temporal-admission-timing]")
                admissionDiagnostics.push(value);
              if (label === "[temporal-delivery-timing]")
                deliveryDiagnostics.push(value);
              if (label === "[temporal-frontier-response-timing]")
                frontierDiagnostics.push(value);
            });
            const elapsedMs = () =>
              Number(process.hrtime.bigint() - clockOrigin) / 1e6;
            const serverTiming: Record<string, number> = {};
            const rootFrontier = buildHelixEnvironmentAffordanceFrontier({
              frontier_id: "fixture:root-frontier",
              identity: compiledPair.root.source.identity,
              clocks: {
                ...compiledPair.root.source.clocks,
                monotonic: readTemporalPublicationClock(),
              },
              entries: [],
              expires_at_environment_sequence: compiledPair.root.source.clocks.environment.sequence + 100,
            });
            await pool.query(
              "INSERT INTO helix_environment_temporal_frontiers (frontier_id,goal_id,goal_revision,frontier_payload,payload_hash,observed_at,retained_until,frontier_revision) VALUES ($1,$2,$3,$4,$5,now(),$6,$7)",
              [
                rootFrontier.frontier_id,
                rootFrontier.identity.goal_id,
                rootFrontier.identity.goal_revision,
                JSON.stringify(rootFrontier),
                helixEnvironmentTimeSha256(rootFrontier),
                new Date(Date.now() + 60000),
                rootFrontier.identity.affordance_revision,
              ],
            );
            serverTiming.root_admission_start_ms = elapsedMs();
            await enqueueEnvironmentAction(
              { profileId: "fixture:profile", request: rootRequest },
              {
                retention: {
                  preflight: {
                    plan: compiledPair.root.source,
                    compilation: compiledPair.root.artifact,
                    frontier: rootFrontier,
                    binding: {
                      ...delivery.bindingStore.inspect(),
                      reasoning_binding_id: "fixture:binding",
                      authenticated_profile_ref: "fixture:profile",
                    },
                  },
                  bindingId: "fixture:binding",
                  bindingEpoch: 1,
                  continuationRef: "fixture:continuation",
                  runId: "run",
                } as never,
                revalidateTask: () => {
                  if (!bindingActive)
                    throw new Error("fixture_binding_revoked");
                },
              },
            );
            serverTiming.root_admission_end_ms = elapsedMs();
            expect(
              (
                await pool.query(
                  "SELECT status FROM helix_environment_action_requests WHERE action_request_id='root'",
                )
              ).rows[0].status,
            ).toBe("admitted");
            const readDb = vi
              .spyOn(roomDatabase, "readSharedRealtimeRoomDatabase")
              .mockResolvedValue(deliveryDb as never);
            try {
              serverTiming.root_lease_start_ms = elapsedMs();
              const rootLease = await leasePendingEnvironmentActions({
                claim,
                limit: 1,
              });
              serverTiming.root_lease_end_ms = elapsedMs();
              expect(
                rootLease.requests.map((request) => request.action_request_id),
              ).toEqual(["root"]);
              expect(rootLease.requests[0].arguments).toEqual(
                native.root.arguments,
              );
            } finally {
              readDb.mockRestore();
            }
            const failures: string[] = [];
            let snapshotRejections = 0;
            let deliveries = 0;
            let duplicatePickupChecks = 0;
            let reconciliations = 0;
            let droppedBatch: any = null;
            let batchAckReplays = 0;
            const fixtureServer = createServer(async (req, res) => {
              try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(Buffer.from(chunk));
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                let result: unknown;
                if (req.url === "/requests/event") {
                  result = await submitEnvironmentActionWorkflowEvent({
                    claim,
                    event: body,
                  });
                } else if (req.url === "/requests/result") {
                  if (continuous && !continuousStop && !continuousLostThird) {
                    // Isolated database snapshots give each rejected variant the
                    // same real-handler input state, then restore the positive run.
                    const before = db.backup();
                    const children = (await pool.query("SELECT action_request_id,status,completed_at,updated_at FROM helix_environment_action_requests WHERE action_request_id<>'root' ORDER BY action_request_id")).rows;
                    for (const variant of ["wrong-player", "missing-motion", "late"] as const) {
                      try {
                        if (variant === "late") await pool.query("UPDATE helix_environment_action_requests SET deadline_at=$1 WHERE action_request_id='root'", [new Date(Date.now() - 1000).toISOString()]);
                        const rejected = await submitEnvironmentActionResult({
                          claim: variant === "wrong-player" ? { ...claim, subjectNativeId: "wrong-player" } : claim,
                          result: variant === "missing-motion" ? { ...body, player_motion_performed: false } : body,
                        });
                        expect(rejected.observation.outcome).not.toBe("succeeded");
                        expect((await pool.query("SELECT action_request_id,status,completed_at,updated_at FROM helix_environment_action_requests WHERE action_request_id<>'root' ORDER BY action_request_id")).rows).toEqual(children);
                      } finally { before.restore(); }
                    }
                  }
                  result = await submitEnvironmentActionResult({
                    claim,
                    result: body,
                  });
                } else if (req.url === "/events/batch") {
                  result = await recordEnvironmentActionEventBatch({
                    claim,
                    batch: body,
                    ...(persistent
                      ? {}
                      : {
                          withTransaction: async (handler: any) =>
                            handler(pool),
                        }),
                  });
                  if (continuousLostBatchAck) {
                    if (droppedBatch === null) {
                      expect((result as any).replayed).toBe(false);
                      droppedBatch = body;
                      res.writeHead(503, { "content-type": "application/json" });
                      res.end(JSON.stringify({ ok: false, error: "fixture_batch_ack_lost_after_commit" }));
                      return;
                    }
                    if (body.batch_id === droppedBatch.batch_id) {
                      expect(body).toEqual(droppedBatch);
                      expect((result as any).replayed).toBe(true);
                      batchAckReplays++;
                    }
                  }
                } else if (req.url === "/requests/temporal-successor") {
                  deliveries++;
                  serverTiming.successor_poll_received_ms = elapsedMs();
                  await pool.query(
                    "UPDATE helix_environment_action_connector_heartbeats SET received_at=now()",
                  );
                  if (deliveries === 1 || (continuous && deliveries <= 3)) {
                    const successor = continuous ? compiledChain[deliveries] : compiledPair.child;
                    const predecessor = continuous ? compiledChain[deliveries - 1] : compiledPair.root;
                    const successorRequest = continuous ? continuousRequests[deliveries] : childRequest;
                    const projection = (
                      await pool.query(
                        "SELECT event_payload FROM helix_environment_events ORDER BY sequence DESC LIMIT 1",
                      )
                    ).rows[0].event_payload;
                    serverTiming.successor_evidence_read_ms = elapsedMs();
                    const planIdentity = successor.source.identity;
                    // Fixture authority/perception resolution; publication, schema,
                    // revision allocation and storage below are production code.
                    vi.spyOn(perceptionContext, "resolveTemporalPerceptionContext").mockResolvedValue({
                      goal: { goal_id: planIdentity.goal_id, goal_revision: planIdentity.goal_revision,
                        identity: { environment_binding_id: planIdentity.environment_id,
                          source_id: planIdentity.source_id, subject_binding_id: planIdentity.subject_id,
                          action_authority_id: planIdentity.authority_id,
                          authority_policy_version: planIdentity.authority_revision, run_id: "run" } },
                      action_producer_epoch_ref: planIdentity.producer_epoch,
                      observation_producer_epoch_ref: planIdentity.producer_epoch,
                      evidence: { observation: { evidence_ref: projection.event_id,
                        observed_at: new Date().toISOString(), result: {
                          game_tick: projection.attributes.clock.world_tick_index,
                          observation_revision: planIdentity.observation_revision } } },
                      catalog: { capabilities: [], context: { catalogSnapshotId: "fixture:catalog" },
                        resident_clock_observation: null },
                    } as never);
                    vi.spyOn(successorContext, "readTemporalSuccessorContext").mockResolvedValue({
                      available: true, previous_plan_id: predecessor.source.plan_id,
                      checkpoint: { checkpoint_id: body.checkpoint_id },
                    } as never);
                    const { frontier } = await publishTemporalPerceptionFrontier({
                      profileId: "fixture:profile", participantId: "participant",
                      goalId: planIdentity.goal_id, expectedRevision: planIdentity.goal_revision,
                    } as never, new EnvironmentTemporalFrontierStore(roomDatabase.withSharedRealtimeRoomTransaction));
                    serverTiming.successor_admission_start_ms = elapsedMs();
                    await enqueueEnvironmentAction(
                      { profileId: "fixture:profile", request: successorRequest },
                      {
                        retention: {
                          preflight: {
                            plan: successor.source,
                            compilation: successor.artifact,
                            frontier,
                            binding: {
                              ...delivery.bindingStore.inspect(),
                              reasoning_binding_id: "fixture:binding",
                              authenticated_profile_ref: "fixture:profile",
                            },
                          },
                          bindingId: "fixture:binding",
                          bindingEpoch: 1,
                          continuationRef: "fixture:continuation",
                          runId: "run",
                          checkpoint: {
                            eventId: projection.event_id,
                            checkpointId: body.checkpoint_id,
                          },
                        } as never,
                        revalidateTask: () => {
                          if (!bindingActive)
                            throw new Error("fixture_binding_revoked");
                        },
                      },
                    );
                    serverTiming.successor_admission_end_ms = elapsedMs();
                    if (continuous && deliveries === 3) {
                      // A newer authenticated publication supersedes the
                      // observation used by this still-unleased candidate.
                      // Restore only the isolated database to continue the
                      // unchanged positive native run after the negative check.
                      const beforeNewObservation = db.backup();
                      try {
                        const { affordance_revision: _oldRevision, ...identity } = frontier.identity;
                        await new EnvironmentTemporalFrontierStore(roomDatabase.withSharedRealtimeRoomTransaction).publish({
                          profileId: "fixture:profile", participantId: "participant",
                          observationEvidenceRef: "fixture:newer-successor-observation",
                          observationProducerEpochRef: planIdentity.producer_epoch,
                          retainedUntil: new Date(Date.now() + 60_000).toISOString(),
                          draft: { identity: { ...identity, observation_revision: identity.observation_revision + 1 },
                            clocks: frontier.clocks, entries: frontier.entries,
                            expires_at_environment_sequence: frontier.expires_at_environment_sequence },
                        });
                        expect(await leasePendingEnvironmentTemporalSuccessor({ ...delivery,
                          residentActionRequestId: body.resident_action_request_id,
                          predecessorPlanId: body.predecessor_plan_id, predecessorPlanHash: body.predecessor_plan_hash,
                          checkpointId: body.checkpoint_id } as never), "New observation must invalidate the unleased successor").toBeNull();
                        expect((await pool.query("SELECT status,attempt_count FROM helix_environment_action_requests WHERE action_request_id=$1",
                          [successorRequest.action_request_id])).rows).toEqual([{ status: "admitted", attempt_count: 0 }]);
                      } finally { beforeNewObservation.restore(); }
                    }
                  }
                  serverTiming.successor_lease_start_ms = elapsedMs();
                  const renameFault = snapshotFailure
                    ? vi
                        .spyOn(fs.promises, "rename")
                        .mockRejectedValue(
                          new Error("fixture_successor_snapshot_failure"),
                        )
                    : null;
                  let child;
                  try {
                    child = await leasePendingEnvironmentTemporalSuccessor({
                      ...delivery,
                      residentActionRequestId: body.resident_action_request_id,
                      predecessorPlanId: body.predecessor_plan_id,
                      predecessorPlanHash: body.predecessor_plan_hash,
                      checkpointId: body.checkpoint_id,
                    } as never);
                  } finally {
                    renameFault?.mockRestore();
                  }
                  serverTiming.successor_lease_end_ms = elapsedMs();
                  if (continuous) {
                    expect(child?.action_request_id).toBe(`child:${deliveries}`);
                    const leasedBeforeDuplicate = (await pool.query(
                      "SELECT status,attempt_count FROM helix_environment_action_requests WHERE action_request_id=$1",
                      [child!.action_request_id],
                    )).rows;
                    expect(leasedBeforeDuplicate).toEqual([{ status: "leased", attempt_count: 1 }]);
                    expect(await leasePendingEnvironmentTemporalSuccessor({
                      ...delivery,
                      residentActionRequestId: body.resident_action_request_id,
                      predecessorPlanId: body.predecessor_plan_id,
                      predecessorPlanHash: body.predecessor_plan_hash,
                      checkpointId: body.checkpoint_id,
                    } as never), "Exact duplicate pickup must never lease a second child").toBeNull();
                    expect((await pool.query(
                      "SELECT status,attempt_count FROM helix_environment_action_requests WHERE action_request_id=$1",
                      [child!.action_request_id],
                    )).rows).toEqual(leasedBeforeDuplicate);
                    duplicatePickupChecks++;
                  }
                  if (lostResponse || (continuousLostThird && deliveries === 3)) {
                    expect(child?.action_request_id).toBe(continuousLostThird ? "child:3" : "child");
                    res.writeHead(503, { "content-type": "application/json" });
                    res.end(
                      JSON.stringify({
                        ok: false,
                        error: "fixture_response_lost_after_lease",
                      }),
                    );
                    return;
                  }
                  result = { ok: true, action_request: child };
                } else if (req.url === "/requests/temporal-successor/status") {
                  reconciliations++;
                  const state = await readEnvironmentTemporalDeliveryState({
                    ...delivery,
                    residentActionRequestId: body.resident_action_request_id,
                    predecessorPlanId: body.predecessor_plan_id,
                    predecessorPlanHash: body.predecessor_plan_hash,
                    checkpointId: body.checkpoint_id,
                  } as never);
                  expect(state).toMatchObject({
                    recorded_status: "leased",
                    execution_authority: false,
                    effects_verified: false,
                  });
                  result = {
                    delivery_state: state,
                    automatic_replay_allowed: false,
                  };
                } else throw new Error(`Unexpected fixture route ${req.url}`);
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ ok: true, ...(result as object) }));
              } catch (error) {
                if (
                  snapshotFailure &&
                  String(error).includes("snapshot") &&
                  req.url === "/requests/temporal-successor"
                ) {
                  snapshotRejections++;
                  const saved = JSON.parse(readFileSync(snapshotPath!, "utf8"));
                  const savedChild =
                    saved.tables.helix_environment_action_requests.find(
                      (row: any) => row.action_request_id === "child",
                    );
                  if (savedChild && savedChild.status !== "admitted")
                    failures.push(
                      `Unexpected saved child status ${savedChild.status}`,
                    );
                  const memoryChild = (
                    await pool.query(
                      "SELECT status FROM helix_environment_action_requests WHERE action_request_id='child'",
                    )
                  ).rows[0];
                  if (memoryChild?.status !== "leased")
                    failures.push(
                      "Lease did not commit before snapshot failure",
                    );
                  res.writeHead(503);
                  res.end(
                    JSON.stringify({
                      ok: false,
                      error: "fixture_snapshot_failed",
                    }),
                  );
                  return;
                }
                failures.push(String(error));
                res.writeHead(500);
                res.end(JSON.stringify({ error: String(error) }));
              }
            });
            await new Promise<void>((resolve) =>
              fixtureServer.listen(0, "127.0.0.1", resolve),
            );
            try {
              const port = (fixtureServer.address() as { port: number }).port;
              const gradle = process.env.HELIX_NATIVE_GRADLE_PATH;
              if (!gradle || !path.isAbsolute(gradle))
                throw new Error(
                  "HELIX_NATIVE_GRADLE_PATH must name the local Gradle executable",
                );
              await new Promise<void>((resolve, reject) => {
                const child = spawn(
                  "powershell.exe",
                  [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    continuous
                      ? continuousLostThird
                        ? "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test --rerun -x runGameTest --tests '*PlayerActionRuntimeTransportTest.continuousCompiledChainLostThirdResponseNeverReplaysDelivery'; exit $LASTEXITCODE"
                        : continuousStop === "cancel"
                        ? "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test --rerun -x runGameTest --tests '*PlayerActionRuntimeTransportTest.continuousCompiledChainCancellationDiscardsThirdSuccessor'; exit $LASTEXITCODE"
                        : continuousStop === "emergency"
                        ? "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test --rerun -x runGameTest --tests '*PlayerActionRuntimeTransportTest.continuousCompiledChainEmergencyStopDiscardsThirdSuccessor'; exit $LASTEXITCODE"
                        : continuousStop === "manual"
                        ? "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test --rerun -x runGameTest --tests '*PlayerActionRuntimeTransportTest.continuousCompiledChainManualObservationDiscardsThirdSuccessor'; exit $LASTEXITCODE"
                        : "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test --rerun -x runGameTest --tests '*PlayerActionRuntimeTransportTest.continuousCompiledChainPollsThreeSuccessorsInOneResidentRuntime'; exit $LASTEXITCODE"
                      : wideRunway
                      ? "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test -x runGameTest --tests '*PlayerActionRuntimeTransportTest.elapsedClockAcceptsWithinDeclaredWideRunway'; exit $LASTEXITCODE"
                      : advancingClock
                      ? "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test -x runGameTest --tests '*PlayerActionRuntimeTransportTest.elapsedClockExpiresWhileSuccessorHttpIsInFlight'; exit $LASTEXITCODE"
                      : lateResponse
                      ? "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test -x runGameTest --tests '*PlayerActionRuntimeTransportTest.serverCompiledLateResponsePublishesCancellationResult'; exit $LASTEXITCODE"
                      : "& $env:HELIX_NATIVE_GRADLE_PATH --no-daemon --max-workers=1 test -x runGameTest --tests '*PlayerActionRuntimeTransportTest.serverCompiledWalkPassesRuntimeHandoffAndPublication'; exit $LASTEXITCODE",
                  ],
                  {
                    cwd: path.resolve("minecraft/helix-fabric-player-agent"),
                    windowsHide: true,
                    env: {
                      ...process.env,
                      HELIX_NATIVE_COMPILED_HANDOFF: "1",
                      HELIX_NATIVE_BROKER_LOST_RESPONSE: lostResponse
                        ? "1"
                        : "0",
                      HELIX_NATIVE_BROKER_FIXTURE_ORIGIN: `http://127.0.0.1:${port}`,
                    },
                  },
                );
                let output = "";
                const deadline = setTimeout(() => {
                  if (child.pid) {
                    const cleanup = spawn(
                      "taskkill.exe",
                      ["/PID", String(child.pid), "/T", "/F"],
                      { windowsHide: true },
                    );
                    cleanup.on("error", () => child.kill());
                  }
                }, 100000);
                child.stdout.on("data", (chunk) => {
                  output = (output + chunk).slice(-12000);
                });
                child.stderr.on("data", (chunk) => {
                  output = (output + chunk).slice(-12000);
                });
                child.once("error", (error) => {
                  clearTimeout(deadline);
                  reject(error);
                });
                child.once("exit", (code) => {
                  clearTimeout(deadline);
                  code === 0
                    ? resolve()
                    : reject(
                        new Error(
                          `Native fixture exit ${code}: ${output}; broker: ${failures.join(";")}`,
                        ),
                      );
                });
              });
              expect(failures).toEqual([]);
              if (continuous) {
                expect(deliveries).toBe(3);
                expect(duplicatePickupChecks).toBe(3);
                expect(admissionDiagnostics).toHaveLength(4);
                expect(deliveryDiagnostics).toHaveLength(3);
                const requests = (await pool.query("SELECT action_request_id,status,attempt_count FROM helix_environment_action_requests ORDER BY action_request_id")).rows;
                expect(requests).toHaveLength(4);
                expect(requests.every((request: any) => request.attempt_count === 1)).toBe(true);
                if (continuousStop || continuousLostThird) {
                  const stopOutcome = continuousLostThird || continuousStop === "manual" ? "cancel" : continuousStop;
                  expect(reconciliations).toBe(continuousLostThird ? 3 : 0);
                  expect(requests.every((request: any) => request.status === (stopOutcome === "cancel" ? "canceled" : "emergency_stopped"))).toBe(true);
                  expect(requests.find((request: any) => request.action_request_id === "root")?.status)
                    .toBe(stopOutcome === "cancel" ? "canceled" : "emergency_stopped");
                  const artifactSuffix = continuousLostThird ? "lost-third-deadline" : continuousStop;
                  const stopped = JSON.parse(readFileSync(`minecraft/helix-fabric-player-agent/build/native-continuous-${artifactSuffix}.json`, "utf8"));
                  expect(stopped.moving_ticks).toBe(continuousLostThird ? 62 : 43);
                  const lastPoll = stopped.polls.at(-1);
                  const beforeStopReplay = (await pool.query("SELECT action_request_id,status,attempt_count,completed_at,updated_at FROM helix_environment_action_requests ORDER BY action_request_id")).rows;
                  const stopEvent = stopped.publications.filter((item: any) => item.path === "/requests/event").at(-1).body;
                  expect((await submitEnvironmentActionWorkflowEvent({ claim, event: stopEvent })).replayed).toBe(true);
                  expect((await pool.query("SELECT action_request_id,status,attempt_count,completed_at,updated_at FROM helix_environment_action_requests ORDER BY action_request_id")).rows).toEqual(beforeStopReplay);
                  expect(await leasePendingEnvironmentTemporalSuccessor({ ...delivery,
                    residentActionRequestId: lastPoll.resident_action_request_id,
                    predecessorPlanId: lastPoll.predecessor_plan_id,
                    predecessorPlanHash: lastPoll.predecessor_plan_hash,
                    checkpointId: lastPoll.checkpoint_id } as never)).toBeNull();
                  const stoppedReadDb = vi.spyOn(roomDatabase, "readSharedRealtimeRoomDatabase").mockResolvedValue(deliveryDb as never);
                  try { expect((await leasePendingEnvironmentActions({ claim, limit: 10 })).requests).toEqual([]); }
                  finally { stoppedReadDb.mockRestore(); }
                  expect((await pool.query("SELECT action_request_id FROM helix_environment_action_results")).rows).toEqual([{ action_request_id: "root" }]);
                  writeFileSync(`minecraft/helix-fabric-player-agent/build/native-continuous-broker-${artifactSuffix}.json`, JSON.stringify({
                    requests, admissionDiagnostics, deliveryDiagnostics, reconciliations,
                    duplicate_pickup_checks: duplicatePickupChecks,
                    moving_ticks: stopped.moving_ticks, live_acceptance: false,
                    simulated_clock_and_player: true, post_stop_delivery: null, ordinary_replay: false,
                  }, null, 2));
                  return;
                }
                expect(requests.every((request: any) => request.status === "succeeded")).toBe(true);
                expect(requests.find((request: any) => request.action_request_id === "root")?.status).toBe("succeeded");
                expect(requests.find((request: any) => request.action_request_id === "child:3")?.status).toBe("succeeded");
                expect((await pool.query("SELECT action_request_id FROM helix_environment_action_results")).rows).toEqual([{ action_request_id: "root" }]);
                const nativeRun = JSON.parse(readFileSync("minecraft/helix-fabric-player-agent/build/native-continuous-runtime.json", "utf8"));
                expect(nativeRun.moving_ticks).toBe(84);
                const terminal = nativeRun.publications.find((item: any) => item.path === "/requests/result").body;
                const beforeReplay = (await pool.query("SELECT action_request_id,status,attempt_count,completed_at,updated_at FROM helix_environment_action_requests ORDER BY action_request_id")).rows;
                expect((await submitEnvironmentActionResult({ claim, result: terminal })).replayed).toBe(true);
                expect((await pool.query("SELECT action_request_id,status,attempt_count,completed_at,updated_at FROM helix_environment_action_requests ORDER BY action_request_id")).rows).toEqual(beforeReplay);
                await expect(submitEnvironmentActionResult({ claim, result: { ...terminal, summary: "conflicting replay" } })).rejects.toMatchObject({ code: "action_result_conflict" });
                if (continuousLostBatchAck) {
                  expect(droppedBatch).not.toBeNull();
                  expect(batchAckReplays).toBe(1);
                }
                writeFileSync(`minecraft/helix-fabric-player-agent/build/native-continuous-broker${continuousLostBatchAck ? "-lost-batch-ack" : ""}.json`, JSON.stringify({
                  requests, admissionDiagnostics, deliveryDiagnostics, frontierDiagnostics,
                  duplicate_pickup_checks: duplicatePickupChecks,
                  moving_ticks: nativeRun.moving_ticks,
                  ...(continuousLostBatchAck ? { dropped_batch_id: droppedBatch.batch_id, batch_ack_replays: batchAckReplays } : {}),
                  live_acceptance: false, simulated_clock_and_player: true,
                }, null, 2));
                return;
              }
              expect(deliveries).toBe(1);
              expect(deliveryDiagnostics).toHaveLength(snapshotFailure ? 0 : 1);
              if (!snapshotFailure) {
                const diagnostic = deliveryDiagnostics[0];
                expect(diagnostic).toMatchObject({
                  action_request_id: "child",
                  resident_action_request_id: "root",
                  run_id: "run",
                  reasoning_binding_id: "fixture:binding",
                  reasoning_binding_epoch: 1,
                  checkpoint_id: "checkpoint:compiled-walk",
                  producer_epoch_ref: first.producer_epoch_ref,
                  configured_persistence_barrier_completed: true,
                  native_pickup_proven: false,
                  execution_authority: false,
                  live_acceptance: false,
                });
                expect(
                  diagnostic.poll_to_transaction_return_ms,
                ).toBeGreaterThanOrEqual(0);
                expect(
                  diagnostic.lease_sql_to_transaction_return_ms,
                ).toBeGreaterThanOrEqual(0);
                expect(diagnostic.clock_origin).toBe(
                  admissionDiagnostics[1].clock_origin,
                );
                expect(diagnostic.poll_received_ms).toBeGreaterThanOrEqual(
                  admissionDiagnostics[1].transaction_returned_ms as number,
                );
              }
              if (snapshotFailure) {
                expect(snapshotRejections).toBe(1);
                await localDb.requireLocalDatabaseSnapshotIfEnabled([
                  "helix_environment_action_requests",
                ]);
              }
              if (persistent) {
                const saved = JSON.parse(readFileSync(snapshotPath!, "utf8"));
                expect(
                  saved.tables.helix_environment_temporal_plan_admissions,
                ).toHaveLength(2);
                expect(
                  saved.tables.helix_environment_action_requests,
                ).toHaveLength(2);
                expect(
                  saved.tables.helix_environment_action_requests.find(
                    (row: any) => row.action_request_id === "child",
                  ).status,
                ).toBe(lostResponse || lateResponse ? "leased" : "running");
                expect(
                  saved.tables.helix_environment_action_workflow_events.length,
                ).toBeGreaterThan(0);
                expect(
                  saved.tables.helix_environment_events.length,
                ).toBeGreaterThan(0);
              }
              if (lateResponse) {
                const terminal = JSON.parse(
                  readFileSync(
                    "minecraft/helix-fabric-player-agent/build/native-compiled-terminal.json",
                    "utf8",
                  ),
                );
                expect(terminal.result.outcome).toBe("request_canceled");
                expect(terminal.result.controls_released).toBe(true);
                const events = (
                  await pool.query(
                    "SELECT event_payload FROM helix_environment_action_workflow_events",
                  )
                ).rows;
                expect(
                  events.some(
                    (row) =>
                      row.event_payload.measurements.sequence_id === "plan:1",
                  ),
                ).toBe(false);
                expect(
                  events.some(
                    (row) => row.event_payload.workflow_state === "canceled",
                  ),
                ).toBe(true);
                expect(
                  (
                    await pool.query(
                      "SELECT status,attempt_count FROM helix_environment_action_requests WHERE action_request_id='child'",
                    )
                  ).rows,
                ).toEqual([{ status: "leased", attempt_count: 1 }]);
                expect(
                  (
                    await pool.query(
                      "SELECT action_request_id FROM helix_environment_action_results",
                    )
                  ).rows,
                ).toEqual([{ action_request_id: "root" }]);
                return;
              }
              if (lostResponse) {
                expect(reconciliations).toBe(1);
                const uncertain = JSON.parse(
                  readFileSync(
                    "minecraft/helix-fabric-player-agent/build/native-compiled-uncertain.json",
                    "utf8",
                  ),
                );
                expect(uncertain.deliveries).toBe(1);
                expect(uncertain.reconciliations).toBe(1);
                expect(
                  uncertain.events.some(
                    (event: any) => event.measurements.sequence_id === "plan:1",
                  ),
                ).toBe(false);
                expect(
                  (
                    await pool.query(
                      "SELECT status,attempt_count FROM helix_environment_action_requests WHERE action_request_id='child'",
                    )
                  ).rows,
                ).toEqual([{ status: "leased", attempt_count: 1 }]);
                expect(
                  (await pool.query("SELECT * FROM helix_environment_events"))
                    .rows,
                ).toHaveLength(uncertain.batches.length);
                return;
              }
              native = JSON.parse(
                readFileSync(
                  `minecraft/helix-fabric-player-agent/build/${nativeArtifactName}.json`,
                  "utf8",
                ),
              );
              acceptanceEvent = native.events.find(
                (event: any) =>
                  event.measurements.temporal_successor_acceptance,
              );
              for (const phase of [
                "root_admission",
                "root_lease",
                "successor_admission",
                "successor_lease",
              ]) {
                expect(serverTiming[`${phase}_end_ms`]).toBeGreaterThanOrEqual(
                  serverTiming[`${phase}_start_ms`],
                );
              }
              expect(
                serverTiming.successor_admission_start_ms,
              ).toBeGreaterThanOrEqual(serverTiming.successor_evidence_read_ms);
              expect(
                serverTiming.successor_evidence_read_ms,
              ).toBeGreaterThanOrEqual(serverTiming.successor_poll_received_ms);
              expect(
                serverTiming.successor_lease_start_ms,
              ).toBeGreaterThanOrEqual(serverTiming.successor_admission_end_ms);
              const nativeTiming =
                native.events.at(-1).measurements
                  .last_temporal_activation_timing;
              expect(admissionDiagnostics).toHaveLength(2);
              for (const [index, actionId] of ["root", "child"].entries()) {
                const diagnostic = admissionDiagnostics[index];
                expect(diagnostic).toMatchObject({
                  action_request_id: actionId,
                  run_id: "run",
                  producer_epoch_ref: first.producer_epoch_ref,
                  reasoning_binding_id: "fixture:binding",
                  reasoning_binding_epoch: 1,
                  reason_code: "same_process_publication_interval",
                  provider_sampling_latency_ms: null,
                  execution_authority: false,
                  required_snapshot_proven: false,
                });
                expect(
                  diagnostic.frontier_publication_to_proposal_receipt_ms,
                ).toBeGreaterThanOrEqual(0);
                expect(
                  diagnostic.proposal_receipt_to_transaction_return_ms,
                ).toBeGreaterThanOrEqual(0);
                expect(diagnostic).not.toHaveProperty(
                  "client_continuation_ref",
                );
                expect(diagnostic).not.toHaveProperty("request_payload");
              }
              expect(nativeTiming.run_id).toBe("run");
              expect(nativeTiming.successor_action_request_id).toBe("child");
              expect(
                nativeTiming.checkpoint_to_activation_ms,
              ).toBeGreaterThanOrEqual(0);
              const correlatedInput = {
                admission: admissionDiagnostics[1],
                delivery: deliveryDiagnostics[0],
                acceptance:
                  acceptanceEvent.measurements.last_temporal_acceptance_timing,
                frontierResponse: frontierDiagnostics[0],
                source: "simulated" as const,
                checkpoint_to_stop_window_ms: wideRunway ? native.fixture_timing_budget.checkpoint_to_stop_window_ms : null,
                safety_margin_ms: wideRunway ? native.fixture_timing_budget.safety_margin_ms : 0,
              };
              const enclosingBudget = auditTemporalCorrelatedBudget(correlatedInput);
              expect(enclosingBudget).toMatchObject({
                enclosing_interval_verified: true,
                frontier_response_correlated: true,
                server_phase_partition_complete: true,
                fits: wideRunway,
                reasons: wideRunway ? [] : ["window_unmeasured"],
                stage_breakdown_complete: false,
                live_acceptance: false,
                execution_authority: false,
              });
              if (wideRunway) {
                expect(native.fixture_timing_budget.basis).toBe("elapsed_native_fixture_clock_50ms_per_tick");
                expect(enclosingBudget.margin_ms).toBeGreaterThan(0);
                expect(auditTemporalCorrelatedBudget({ ...correlatedInput, checkpoint_to_stop_window_ms: 1 }))
                  .toMatchObject({ fits: false, reasons: ["budget_exhausted"] });
              }
              const envelope = enclosingBudget.delivery_server_return_request_relative!;
              expect(Object.values(enclosingBudget.server_phase_durations_ms!).reduce((sum, value) => sum + value, 0))
                .toBe(Number(deliveryDiagnostics[0].transaction_returned_ms) - Number(frontierDiagnostics[0].request_received_ms));
              expect(envelope.available).toBe(true);
              expect(envelope.lower_ms).toBeGreaterThanOrEqual(0);
              expect(envelope.upper_ms).toBeGreaterThanOrEqual(envelope.lower_ms!);
              expect(envelope.upper_ms).toBeLessThanOrEqual(
                correlatedInput.acceptance.delivery_http_roundtrip_ms,
              );
              const corruptedBudget = auditTemporalCorrelatedBudget({
                ...correlatedInput,
                delivery: { ...correlatedInput.delivery,
                  transaction_returned_ms: Number(correlatedInput.delivery.poll_received_ms) +
                    Number(correlatedInput.acceptance.delivery_http_roundtrip_ms) + 2 },
              });
              expect(corruptedBudget.reasons).toContain("delivery_http_enclosure_inconsistent");
              expect(corruptedBudget.enclosing_interval_verified).toBe(false);
              expect(corruptedBudget.delivery_server_return_request_relative).toBeNull();
              writeFileSync(
                "minecraft/helix-fabric-player-agent/build/connected-broker-timing.json",
                JSON.stringify(
                  {
                    scope:
                      "Measured fixture process intervals; simulated environment ticks; not live capacity",
                    identity: {
                      run_id: "run",
                      resident_action_request_id: "root",
                      successor_action_request_id: "child",
                      producer_epoch_ref: first.producer_epoch_ref,
                    },
                    server_clock:
                      "process.hrtime fixture-relative milliseconds",
                    serverTiming,
                    production_admission_diagnostics: admissionDiagnostics,
                    production_delivery_diagnostics: deliveryDiagnostics,
                    enclosing_budget: enclosingBudget,
                    server_phase_durations_ms: {
                      poll_to_evidence_read:
                        serverTiming.successor_evidence_read_ms -
                        serverTiming.successor_poll_received_ms,
                      fixture_frontier_preparation:
                        serverTiming.successor_admission_start_ms -
                        serverTiming.successor_evidence_read_ms,
                      admission:
                        serverTiming.successor_admission_end_ms -
                        serverTiming.successor_admission_start_ms,
                      admitted_to_lease_start:
                        serverTiming.successor_lease_start_ms -
                        serverTiming.successor_admission_end_ms,
                      lease_including_required_snapshot_when_enabled:
                        serverTiming.successor_lease_end_ms -
                        serverTiming.successor_lease_start_ms,
                    },
                    timing_coverage: {
                      frontier_response_diagnostics: frontierDiagnostics,
                      required_snapshot_enabled: persistent,
                      provider_proposal:
                        "not measured; precompiled fixture is not a provider proposal",
                      snapshot_separate_duration: null,
                      cross_process_clock_mapping: null,
                      complete_five_stage_budget: false,
                    },
                    native_clock:
                      "separate JVM monotonic origin; do not subtract from server timestamps",
                    nativeTiming,
                    nativeAcceptance:
                      acceptanceEvent.measurements
                        .last_temporal_acceptance_timing,
                    live_window_budget_ms: null,
                    live_acceptance: false,
                  },
                  null,
                  2,
                ),
              );
            } finally {
              await new Promise<void>((resolve, reject) =>
                fixtureServer.close((error) =>
                  error ? reject(error) : resolve(),
                ),
              );
            }
          } else
            for (const event of native.events) {
              if (event === acceptanceEvent) {
                // Replay native evidence at its captured audit time, without
                // rewriting signed/hash-bound events to pretend they are fresh now.
                const auditTime = vi
                  .spyOn(Date, "now")
                  .mockReturnValue(Date.parse(event.created_at));
                try {
                  auditTime.mockReturnValue(
                    Date.parse(event.created_at) + 6000,
                  );
                  expect(
                    await leasePendingEnvironmentTemporalSuccessor(
                      delivery as never,
                    ),
                  ).toBeNull();
                  auditTime.mockReturnValue(Date.parse(event.created_at));
                  expect(
                    await leasePendingEnvironmentTemporalSuccessor({
                      ...delivery,
                      checkpointId: "wrong-checkpoint",
                    } as never),
                  ).toBeNull();
                  bindingActive = false;
                  expect(
                    await leasePendingEnvironmentTemporalSuccessor(
                      delivery as never,
                    ),
                  ).toBeNull();
                  bindingActive = true;
                  const leased = await leasePendingEnvironmentTemporalSuccessor(
                    delivery as never,
                  );
                  expect(leased?.action_request_id).toBe("child");
                  expect(leased?.temporal_plan).toEqual(
                    native.child.temporal_plan,
                  );
                  expect(leased?.arguments).toEqual(native.child.arguments);
                  expect(leased?.temporal_plan_canonical_json).toBe(
                    native.child.temporal_plan_canonical_json,
                  );
                  expect(
                    await leasePendingEnvironmentTemporalSuccessor(
                      delivery as never,
                    ),
                  ).toBeNull();
                  expect(
                    await readEnvironmentTemporalDeliveryState(
                      delivery as never,
                    ),
                  ).toMatchObject({
                    action_request_id: "child",
                    recorded_status: "leased",
                    effects_verified: false,
                    execution_authority: false,
                    automatic_replay_allowed: false,
                  });
                  bindingActive = false;
                  expect(
                    await readEnvironmentTemporalDeliveryState(
                      delivery as never,
                    ),
                  ).toBeNull();
                  bindingActive = true;
                } finally {
                  auditTime.mockRestore();
                }
              }
              expect(
                await submitEnvironmentActionWorkflowEvent({ claim, event }),
              ).toMatchObject({ replayed: false });
              expect(
                await submitEnvironmentActionWorkflowEvent({ claim, event }),
              ).toMatchObject({ replayed: true });
            }
          await verifyRecordedChain();
          await expect(
            submitEnvironmentActionWorkflowEvent({
              claim,
              event: { ...acceptanceEvent, summary: "Conflicting replay" },
            }),
          ).rejects.toMatchObject({ code: "action_event_conflict" });
          await expect(
            submitEnvironmentActionWorkflowEvent({
              claim,
              event: {
                ...acceptanceEvent,
                event_id: "late-acceptance",
                sequence: native.events.at(-1).sequence + 1,
                measurements: {
                  ...acceptanceEvent.measurements,
                  temporal_successor_acceptance: {
                    ...acceptanceEvent.measurements
                      .temporal_successor_acceptance,
                    accepted_client_tick: 1,
                  },
                },
              },
            }),
          ).rejects.toMatchObject({ code: "action_event_invalid" });
          const child = (
            await pool.query(
              "SELECT status FROM helix_environment_action_requests WHERE action_request_id='child'",
            )
          ).rows[0];
          expect(child.status).toBe("running");
          expect(
            (
              await pool.query(
                "SELECT attempt_count FROM helix_environment_action_requests WHERE action_request_id='child'",
              )
            ).rows[0].attempt_count,
          ).toBe(1);
          expect(
            (
              await pool.query(
                "SELECT * FROM helix_environment_action_workflow_events",
              )
            ).rows,
          ).toHaveLength(native.events.length);
        } finally {
          transaction.mockRestore();
          adapter.mockRestore();
          member.mockRestore();
        }
      }
      const withTransaction = async <T>(
        handler: (client: typeof pool) => Promise<T>,
      ) => handler(pool);
      for (const batch of native.batches) {
        const recorded = await recordEnvironmentActionEventBatch({
          claim,
          batch,
          withTransaction,
        });
        expect(recorded.replayed).toBe(roundtrip);
        expect(recorded.digest.producer_epoch_ref).toBe(
          first.producer_epoch_ref,
        );
        expect(recorded.digest.latest_event_sequence).toBe(batch.last_sequence);
        const replay = await recordEnvironmentActionEventBatch({
          claim,
          batch,
          withTransaction,
        });
        expect(replay.replayed).toBe(true);
        expect(replay.digest.digest_hash).toBe(recorded.digest.digest_hash);
        const projection = batch.events[0];
        const paired = native.events.find(
          (event: { event_id: string }) =>
            event.event_id === projection.attributes.action_event_ref,
        );
        expect(paired).toBeDefined();
        expect(projection.attributes.workflow_measurements).toEqual(
          paired.measurements,
        );
      }
      const counts = await pool.query("SELECT * FROM helix_environment_events");
      expect(counts.rows).toHaveLength(native.batches.length);
      await expect(
        recordEnvironmentActionEventBatch({
          claim: { ...claim, subjectBindingId: "wrong-player" },
          batch: first,
          withTransaction,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        recordEnvironmentActionEventBatch({
          claim,
          batch: { ...first, world_id: "tampered-world" },
          withTransaction,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await pool.query(
        "UPDATE helix_environment_action_connector_manifests SET producer_epoch_ref = 'replacement-epoch'",
      );
      await expect(
        recordEnvironmentActionEventBatch({
          claim,
          batch: first,
          withTransaction,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      if (persistent) {
        await localDb.resetDbClient();
        vi.unstubAllEnvs();
        for (const filename of readdirSync(directory!))
          unlinkSync(path.join(directory!, filename));
        rmdirSync(directory!);
      } else await pool.end();
    }
  },
  120000,
);
