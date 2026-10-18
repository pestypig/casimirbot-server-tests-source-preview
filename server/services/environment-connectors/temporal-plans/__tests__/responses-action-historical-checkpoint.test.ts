import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import { environmentConnectorSha256 } from "../../catalog";
import { buildHelixEnvironmentTemporalPlan,
  helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";
import { readHistoricalResponsesCheckpoint } from
  "../responses-action-historical-checkpoint";

const compiled = JSON.parse(readFileSync(
  "minecraft/helix-fabric-player-agent/src/test/resources/compiled-rolling-walk.json", "utf8"));
const residentPlan = compiled.source;
const { plan_hash: _residentHash, ...childDraft } = residentPlan;
const plan = buildHelixEnvironmentTemporalPlan({ ...childDraft,
  plan_id: "plan:child", previous_plan_id: residentPlan.plan_id,
  previous_plan_hash: residentPlan.plan_hash,
  identity: { ...residentPlan.identity,
    observation_revision: residentPlan.identity.observation_revision + 1 },
  clocks: { ...residentPlan.clocks,
    environment: { ...residentPlan.clocks.environment, sequence: 2 } } });
const compilationBody = { ...compiled.artifact,
  source_plan_id: plan.plan_id, source_plan_hash: plan.plan_hash,
  arguments: { ...compiled.artifact.arguments, sequence_id: plan.plan_id } };
const { compilation_hash: _compilationHash, ...compilationContent } = compilationBody;
const compilation = { ...compilationContent,
  compilation_hash: helixEnvironmentTimeSha256(compilationContent) };
const at = "2026-09-06T00:00:00.000Z";
const settlement = { checkpoint_id: "checkpoint:compiled-walk",
  node_id: "settled", tick_index: 12, monotonic_elapsed_ns: 600 };
const measurements = { sequence_id: compilation.arguments.sequence_id,
  checkpoint_settlements: [settlement] };
const clock = { schema: "helix.environment_clock_snapshot.v1",
  clock_id: "clock:one", clock_kind: "minecraft_game_tick",
  tick_rate_hz: 20, tick_index: 14, world_tick_index: 200,
  synchronization: "client_local", observed_at: at,
  monotonic: { origin_id: plan.clocks.monotonic.origin_id, elapsed_ms: 1_600 } };
const root = () => ({ action_request_id: "request:root",
  workflow_id: "workflow:one", run_id: "run:one", room_id: "room:one",
  world_id: "world:one", environment_binding_id: plan.identity.environment_id,
  source_id: plan.identity.source_id, subject_binding_id: plan.identity.subject_id,
  action_authority_id: plan.identity.authority_id, temporal_plan: residentPlan });
const lineage = () => ({ source_plan: plan, compilation_artifact: compilation,
  resident_action_request_id: "request:root", reasoning_binding_id: "binding:one",
  reasoning_binding_epoch: 2, client_continuation_ref: "task:one",
  admitted_at: "2026-09-05T23:59:59.000Z", request_payload: root() });
const environmentEvent = () => ({ schema: "helix.environment_event.v1",
  event_id: "event:measured", sequence: 41, event_type: "workflow.progress",
  domain: "minecraft", domain_adapter: plan.adapter_id,
  room_id: "room:one", world_id: "world:one",
  source_id: plan.identity.source_id,
  producer_epoch_ref: plan.identity.producer_epoch,
  producer_plane: "player_embodiment", subject_ref: plan.identity.subject_id,
  workflow_ref: "workflow:one", summary: "Checkpoint measured",
  attributes: { clock, action_event_ref: "event:action",
    active_workflow: { workflow_ref: "workflow:one", workflow_state: "running",
      manual_override_detected: false }, workflow_measurements: measurements },
  evidence_refs: [], occurred_at: at, observed_at: at, provenance: "measured",
  raw_event_included: false,
  content_role: "environment_event_not_assistant_answer",
  answer_authority: false, assistant_answer: false, terminal_eligible: false,
  raw_content_included: false });
const actionEvent = () => ({ schema: "helix.environment_action.workflow_event.v1",
  event_id: "event:action", action_request_id: "request:root",
  workflow_id: "workflow:one", sequence: 7, event_type: "workflow.progress",
  workflow_state: "running", progress_fraction: 0.5,
  summary: "Checkpoint measured", control_engine: "native_fabric", clock,
  measurements, evidence_refs: [], manual_override_detected: false,
  controls_released: false, created_at: at,
  content_role: "environment_action_event_not_assistant_answer",
  answer_authority: false, assistant_answer: false, terminal_eligible: false,
  raw_content_included: false });
const hash = (char: string) => `sha256:${char.repeat(64)}`;
const link = { decision_id: "decision:one", choice_source_hash: hash("a"),
  choice_id: "advance:one", reasoning_binding_id: "binding:one", binding_epoch: 2,
  run_id: "run:one", checkpoint_event_id: "event:prior",
  plan_id: plan.plan_id as string, plan_hash: plan.plan_hash as string,
  action_request_id: "request:child" };
const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "client:one",
  clientSessionRef: "session:one", clientContinuationRef: "task:one",
  bindingId: "binding:one", bindingEpoch: 2, helixConversationId: "chat:one",
  missionId: null, runId: "run:one" };
afterEach(() => vi.restoreAllMocks());

const run = async (overrides: { row?: ReturnType<typeof lineage> | null;
  event?: ReturnType<typeof environmentEvent> | null;
  action?: ReturnType<typeof actionEvent> | null;
  eventHash?: string; actionHash?: string;
  actionEpoch?: string; link?: typeof link; binding?: typeof binding;
  verify?: () => Promise<unknown>; signal?: AbortSignal;
  nowMs?: number } = {}) => {
  const event = overrides.event === undefined ? environmentEvent() : overrides.event;
  const action = overrides.action === undefined ? actionEvent() : overrides.action;
  const readers = {
    readLineage: vi.fn(async () => overrides.row === undefined ? lineage() : overrides.row),
    readEnvironmentEvent: vi.fn(async () => event && ({ event_id: event.event_id,
      event_payload: event, event_hash: overrides.eventHash ?? environmentConnectorSha256(event) })),
    readActionEvent: vi.fn(async () => action && ({ event_id: action.event_id,
      event_payload: action, event_hash: overrides.actionHash ?? environmentConnectorSha256(action),
      producer_epoch_ref: overrides.actionEpoch ?? plan.identity.producer_epoch })),
  };
  const verifier = { verifyTaskAssociation: vi.fn(overrides.verify ??
    (async () => ({}))) };
  const verdict = await readHistoricalResponsesCheckpoint({
    link: overrides.link ?? link, binding: overrides.binding ?? binding,
    checkpointEventId: "event:measured", checkpointId: "checkpoint:compiled-walk",
    signal: overrides.signal,
    nowMs: overrides.nowMs ?? Date.parse("2026-10-09T12:00:00.000Z"),
  }, verifier as never, readers);
  return { verdict, readers, verifier };
};

describe("read-only historical Responses checkpoint", () => {
  it("uses only exact protected event IDs without the live five-second filter", async () => {
    const query = vi.fn(async (sql: string, values: unknown[]) => ({ rows: [
      sql.includes("helix_environment_temporal_plan_admissions") ? lineage() :
      sql.includes("helix_environment_action_workflow_events") ? {
        event_id: "event:action", event_payload: actionEvent(),
        event_hash: environmentConnectorSha256(actionEvent()),
        producer_epoch_ref: plan.identity.producer_epoch } : {
        event_id: "event:measured", event_payload: environmentEvent(),
        event_hash: environmentConnectorSha256(environmentEvent()) },
    ] }));
    vi.spyOn(database, "readSharedRealtimeRoomDatabase")
      .mockResolvedValue({ query } as never);
    const result = await readHistoricalResponsesCheckpoint({ link, binding,
      checkpointEventId: "event:measured", checkpointId: "checkpoint:compiled-walk",
      nowMs: Date.parse("2026-10-09T12:00:00.000Z") },
    { verifyTaskAssociation: vi.fn(async () => ({})) } as never);
    expect(result.status).toBe("historical_checkpoint_verified");
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][1]).toEqual(["request:child"]);
    expect(query.mock.calls[1][1]).toEqual(["event:measured",
      plan.identity.environment_id, plan.identity.producer_epoch, "workflow:one"]);
    expect(query.mock.calls[2][1]).toEqual(["request:root", "workflow:one",
      "event:action"]);
    expect(query.mock.calls.every(([sql]) => !sql.includes("now()-interval")))
      .toBe(true);
  });

  it("reverifies a month-old measured pair after the live admission window", async () => {
    expect(residentPlan.plan_id).not.toBe(plan.plan_id);
    const first = await run(); const second = await run();
    expect(second.verdict).toEqual(first.verdict);
    expect(first.verdict).toMatchObject({ status: "historical_checkpoint_verified",
      action_request_id: "request:child", resident_action_request_id: "request:root",
      checkpoint_event_id: "event:measured", action_event_id: "event:action",
      historical_evidence_only: true, current_admission_authority: false,
      execution_authority: false, automatic_replay_allowed: false });
    expect(first.verifier.verifyTaskAssociation).toHaveBeenCalledTimes(2);
    expect(first.readers.readEnvironmentEvent).toHaveBeenCalledWith("event:measured",
      plan.identity.environment_id, plan.identity.producer_epoch, "workflow:one");
    expect(first.readers.readActionEvent).toHaveBeenCalledWith("request:root",
      "workflow:one", "event:action");
  });

  it("rejects missing, tampered and wrong-epoch evidence", async () => {
    expect((await run({ row: null })).verdict).toMatchObject({ status: "blocked",
      reason: "history_missing" });
    expect((await run({ event: null })).verdict).toMatchObject({ status: "blocked",
      reason: "history_missing" });
    expect((await run({ action: null })).verdict).toMatchObject({ status: "blocked",
      reason: "history_missing" });
    for (const change of [{ eventHash: hash("f") }, { actionHash: hash("f") },
      { actionEpoch: "epoch:wrong" }]) {
      expect((await run(change)).verdict).toMatchObject({ status: "blocked",
        reason: "history_invalid", current_admission_authority: false });
    }
  });

  it("does not promote a non-progress workflow event to measured checkpoint proof", async () => {
    const wrongEnvironmentType = environmentEvent();
    wrongEnvironmentType.event_type = "workflow.started";
    expect((await run({ event: wrongEnvironmentType })).verdict).toMatchObject({
      status: "blocked", reason: "history_invalid",
      current_admission_authority: false, automatic_replay_allowed: false });
    const wrongActionType = actionEvent();
    wrongActionType.event_type = "workflow.started";
    expect((await run({ action: wrongActionType })).verdict).toMatchObject({
      status: "blocked", reason: "history_invalid",
      current_admission_authority: false, automatic_replay_allowed: false });
  });

  it("rejects altered checkpoint, producer identity, manual state and chronology", async () => {
    const changed = environmentEvent();
    changed.attributes.workflow_measurements = { ...measurements,
      checkpoint_settlements: [{ ...settlement, tick_index: 11 }] };
    expect((await run({ event: changed })).verdict).toMatchObject({ status: "blocked",
      reason: "history_invalid" });
    const wrongSource = environmentEvent(); wrongSource.source_id = "source:wrong";
    expect((await run({ event: wrongSource })).verdict).toMatchObject({ status: "blocked",
      reason: "history_invalid" });
    const manual = environmentEvent();
    manual.attributes.active_workflow.manual_override_detected = true;
    expect((await run({ event: manual })).verdict).toMatchObject({ status: "blocked",
      reason: "history_invalid" });
    expect((await run({ nowMs: Date.parse("2026-09-05T23:59:59.000Z") })).verdict)
      .toMatchObject({ status: "blocked", reason: "history_invalid" });
    expect((await run({ row: { ...lineage(), admitted_at:
      "2026-09-06T00:00:01.000Z" } })).verdict)
      .toMatchObject({ status: "blocked", reason: "history_invalid" });
  });

  it("rejects stale binding, cancellation and mid-read revocation", async () => {
    const wrong = { ...binding, bindingEpoch: 3 };
    const mismatched = await run({ binding: wrong });
    expect(mismatched.verdict).toMatchObject({ status: "blocked",
      reason: "binding_mismatch" });
    expect(mismatched.readers.readLineage).not.toHaveBeenCalled();
    const abort = new AbortController(); abort.abort();
    const canceled = await run({ signal: abort.signal });
    expect(canceled.verdict).toMatchObject({ status: "blocked",
      reason: "read_cancelled" });
    expect(canceled.readers.readLineage).not.toHaveBeenCalled();
    let checks = 0;
    expect((await run({ verify: async () => {
      if (++checks === 2) throw new Error("revoked"); return {};
    } })).verdict).toMatchObject({ status: "blocked", reason: "binding_mismatch" });
  });
});
