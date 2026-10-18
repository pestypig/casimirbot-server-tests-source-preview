import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import { environmentConnectorSha256 } from "../../catalog";
import { HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  type HelixEnvironmentActionObservation } from "@shared/helix-environment-action";
import { readStoredChildLineage, reconcileResidentResponsesActionResult } from
  "../responses-action-resident-result";

afterEach(() => vi.restoreAllMocks());

const hash = (char: string) => `sha256:${char.repeat(64)}`;
const link = { decision_id: "decision:one", choice_source_hash: hash("a"),
  choice_id: "detour:one", reasoning_binding_id: "binding:one",
  binding_epoch: 2, run_id: "run:one", checkpoint_event_id: "event:before",
  plan_id: "plan:detour", plan_hash: hash("b"),
  action_request_id: "request:child" };
const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "client:one",
  clientSessionRef: "session:one", clientContinuationRef: "task:one",
  bindingId: "binding:one", bindingEpoch: 2,
  helixConversationId: "chat:one", missionId: null, runId: "run:one" };
const lineage = () => ({ action_request_id: "request:child",
  resident_action_request_id: "request:root", plan_id: "plan:detour",
  plan_hash: hash("b"), run_id: "run:one",
  resident_workflow_id: "workflow:root", reasoning_binding_id: "binding:one",
  reasoning_binding_epoch: 2, producer_epoch: "epoch:one",
  client_continuation_ref: "task:one",
  admitted_at: "2026-10-09T11:59:50.000Z",
  native_plan_id: "sequence:detour", recorded_status: "failed",
  resident_recorded_status: "failed" });
const result = (): HelixEnvironmentActionObservation => ({
  schema: HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  action_request_ref: "request:root", workflow_ref: "workflow:root",
  action_execution_ref: "execution:root", capability_id: "sequence.execute",
  capability_version: 1, action_kind: "execute_sequence", outcome: "failed",
  summary: "Headroom obstacle stopped the resident route.",
  result: { controls_released: true, automatic_replay_performed: false,
    player_motion_performed: true, player_interaction_performed: false,
    inventory_mutation_performed: false, world_mutation_performed: false },
  progress_observation_refs: ["event:child-motion"],
  postcondition_evidence_refs: [], evidence_ref: "evidence:root-result",
  observed_at: "2026-10-09T12:00:00.000Z", provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  content_role: "environment_action_observation_not_assistant_answer",
  reentry_required: true, answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
});
const nativeEvent = () => ({
  schema: "helix.environment_action.workflow_event.v1",
  event_id: "event:child-motion", action_request_id: "request:root",
  workflow_id: "workflow:root", sequence: 7,
  event_type: "workflow.progress", workflow_state: "running",
  progress_fraction: 0.5, summary: "Measured headroom obstacle",
  control_engine: "native_fabric", measurements: { sequence_id: "sequence:detour",
    checkpoint_settlements: [] },
  evidence_refs: [], manual_override_detected: false,
  controls_released: false, created_at: "2026-10-09T11:59:59.000Z",
  content_role: "environment_action_event_not_assistant_answer",
  answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
});
const storedEvent = () => ({ event_id: "event:child-motion",
  event_payload: nativeEvent(), event_hash: environmentConnectorSha256(nativeEvent()),
  producer_epoch_ref: "epoch:one" });

const run = async (overrides: {
  child?: ReturnType<typeof lineage> | null;
  root?: HelixEnvironmentActionObservation | null;
  events?: ReturnType<typeof storedEvent>[];
  verify?: () => Promise<unknown>;
  signal?: AbortSignal;
} = {}) => {
  const readChildLineage = vi.fn(async () => overrides.child === undefined ? lineage() : overrides.child);
  const readRootObservation = vi.fn(async () => overrides.root === undefined ? result() : overrides.root);
  const readResidentEvents = vi.fn(async () => overrides.events ?? [storedEvent()]);
  const verdict = await reconcileResidentResponsesActionResult({ link, binding,
    signal: overrides.signal }, { verifyTaskAssociation: vi.fn(overrides.verify ??
      (async () => ({}))) as never }, { readChildLineage, readRootObservation,
      readResidentEvents });
  return { verdict, readChildLineage, readRootObservation, readResidentEvents };
};

describe("Responses temporal child to protected resident result", () => {
  it("resolves the retained child/root association from the protected store", async () => {
    const fixture = JSON.parse(readFileSync(
      "minecraft/helix-fabric-player-agent/src/test/resources/compiled-rolling-walk.json", "utf8"));
    const row = { ...lineage(),
      resident_run_id: "run:one",
      resident_recorded_status: "running",
      plan_id: fixture.source.plan_id, plan_hash: fixture.source.plan_hash,
      source_plan: fixture.source, compilation_artifact: fixture.artifact,
      compilation_hash: fixture.artifact.compilation_hash,
      child_environment_binding_id: fixture.source.identity.environment_id,
      resident_environment_binding_id: fixture.source.identity.environment_id,
      child_source_id: fixture.source.identity.source_id,
      resident_source_id: fixture.source.identity.source_id,
      child_subject_binding_id: fixture.source.identity.subject_id,
      resident_subject_binding_id: fixture.source.identity.subject_id,
      child_action_authority_id: fixture.source.identity.authority_id,
      resident_action_authority_id: fixture.source.identity.authority_id };
    const query = vi.fn(async () => ({ rows: [row] }));
    vi.spyOn(database, "readSharedRealtimeRoomDatabase").mockResolvedValue({ query } as never);
    const found = await readStoredChildLineage("request:child");
    expect(query).toHaveBeenCalledWith(expect.stringContaining(
      "JOIN helix_environment_action_requests"), ["request:child"]);
    expect(found).toMatchObject({ action_request_id: "request:child",
      resident_action_request_id: "request:root",
      resident_recorded_status: "running",
      plan_id: fixture.source.plan_id,
      native_plan_id: fixture.artifact.arguments.sequence_id,
      producer_epoch: fixture.source.identity.producer_epoch });
    query.mockResolvedValueOnce({ rows: [{ ...row, resident_run_id: "run:other" }] });
    await expect(readStoredChildLineage("request:child"))
      .rejects.toThrow("temporal_child_lineage_invalid");
    for (const mismatch of [
      { child_subject_binding_id: "player:other" },
      { resident_environment_binding_id: "environment:other" },
      { resident_source_id: "source:other" },
      { child_action_authority_id: "authority:other" },
    ]) {
      query.mockResolvedValueOnce({ rows: [{ ...row, ...mismatch }] });
      await expect(readStoredChildLineage("request:child"))
        .rejects.toThrow("temporal_child_lineage_invalid");
    }
  });

  it("joins one child to the root result and only its measured native event", async () => {
    const { verdict, readRootObservation, readResidentEvents } = await run();
    expect(readRootObservation).toHaveBeenCalledWith("request:root");
    expect(readResidentEvents).toHaveBeenCalledWith("request:root", "workflow:root");
    expect(verdict).toMatchObject({ status: "reconciled", decision_id: "decision:one",
      action_request_id: "request:child", workflow_ref: "workflow:root",
      resident_action_request_id: "request:root",
      evidence_ref: "evidence:root-result", outcome: "failed",
      progress_observation_refs: ["event:child-motion"],
      native_result_verified: true, goal_progress_verified: false,
      automatic_retry_allowed: false });
  });

  it("rejects a root result from another stored workflow before reading native events", async () => {
    const { verdict, readResidentEvents } = await run({ root: {
      ...result(), workflow_ref: "workflow:other" } });
    expect(verdict).toMatchObject({ status: "blocked",
      reason: "result_identity_mismatch", action_request_id: "request:child",
      native_result_verified: false, automatic_retry_allowed: false });
    expect(readResidentEvents).not.toHaveBeenCalled();
  });

  it("reconciles a successful child only with a successful terminal root row", async () => {
    const { verdict } = await run({ child: { ...lineage(), recorded_status: "succeeded",
      resident_recorded_status: "succeeded" },
      root: { ...result(), outcome: "succeeded" } });
    expect(verdict).toMatchObject({ status: "reconciled", outcome: "succeeded",
      action_request_id: "request:child", progress_observation_refs: ["event:child-motion"],
      native_result_verified: true, automatic_retry_allowed: false });
  });

  it("does not turn a child's measured progress into its terminal outcome", async () => {
    const { verdict, readResidentEvents } = await run({ child: {
      ...lineage(), recorded_status: "running" } });
    expect(readResidentEvents).toHaveBeenCalledWith("request:root", "workflow:root");
    expect(verdict).toMatchObject({ status: "unresolved",
      action_request_id: "request:child", evidence_ref: "evidence:root-result",
      outcome: "failed", native_result_verified: false,
      automatic_retry_allowed: false });
  });

  it("keeps missing or ambiguous resident results unresolved without retry", async () => {
    expect((await run({ child: { ...lineage(), recorded_status: "running",
      resident_recorded_status: "running" },
      root: null })).verdict).toMatchObject({ status: "pending",
      action_request_id: "request:child", resident_action_request_id: "request:root",
      automatic_retry_allowed: false });
    expect((await run({ root: { ...result(), outcome: "action_outcome_unknown" } })).verdict)
      .toMatchObject({ status: "unresolved", action_request_id: "request:child",
        automatic_retry_allowed: false });
  });

  it("rechecks task binding before reporting a missing root result as pending", async () => {
    let checks = 0;
    const { verdict } = await run({ child: { ...lineage(), recorded_status: "running",
      resident_recorded_status: "running" }, root: null,
    verify: async () => {
      checks += 1;
      if (checks === 2) throw new Error("binding revoked during read");
    } });
    expect(checks).toBe(2);
    expect(verdict).toMatchObject({ status: "blocked",
      reason: "binding_mismatch", native_result_verified: false,
      automatic_retry_allowed: false });
  });

  it("does not call a missing or retired admission a running result", async () => {
    const absent = await run({ child: null, root: null });
    expect(absent.verdict).toMatchObject({ status: "blocked",
      reason: "result_provenance_invalid", action_request_id: "request:child",
      native_result_verified: false, automatic_retry_allowed: false });
    expect(absent.readRootObservation).not.toHaveBeenCalled();
    const rootLineage = { ...lineage(), resident_action_request_id: "request:child",
      recorded_status: "running", resident_recorded_status: "running" };
    expect((await run({ child: rootLineage, root: null })).verdict)
      .toMatchObject({ status: "pending", resident_action_request_id: "request:child",
        automatic_retry_allowed: false });
    for (const recorded_status of ["admitted", "canceled", "paused_manual_override",
      "succeeded", "failed"]) {
      const retired = await run({ child: { ...rootLineage, recorded_status,
        resident_recorded_status: recorded_status }, root: null });
      expect(retired.verdict).toMatchObject({ status: "blocked",
        reason: "result_provenance_invalid", automatic_retry_allowed: false });
      if (["succeeded", "failed"].includes(recorded_status))
        expect(retired.readRootObservation).toHaveBeenCalledWith("request:child");
      else expect(retired.readRootObservation).not.toHaveBeenCalled();
    }
  });

  it("reads a settled resident root by its own request and workflow", async () => {
    const rootLineage = { ...lineage(), resident_action_request_id: "request:child",
      recorded_status: "failed", resident_recorded_status: "failed" };
    const { verdict, readRootObservation, readResidentEvents } = await run({
      child: rootLineage,
      root: { ...result(), action_request_ref: "request:child" },
    });
    expect(readRootObservation).toHaveBeenCalledWith("request:child");
    expect(readResidentEvents).not.toHaveBeenCalled();
    expect(verdict).toMatchObject({ status: "reconciled",
      action_request_id: "request:child", workflow_ref: "workflow:root",
      native_result_verified: true, automatic_retry_allowed: false });
  });

  it("does not call a retired or pre-delivery child pending while the root runs", async () => {
    for (const recorded_status of ["admitted", "paused_manual_override",
      "cancel_requested", "canceled", "timed_out", "emergency_stopped",
      "connector_offline", "authority_stale"]) {
      const { verdict, readRootObservation, readResidentEvents } = await run({
        child: { ...lineage(), recorded_status,
          resident_recorded_status: "running" }, root: null });
      expect(verdict).toMatchObject({ status: "blocked",
        reason: "result_provenance_invalid", action_request_id: "request:child",
        native_result_verified: false, automatic_retry_allowed: false });
      expect(readRootObservation).not.toHaveBeenCalled();
      expect(readResidentEvents).not.toHaveBeenCalled();
    }
    const failed = await run({ child: { ...lineage(), recorded_status: "failed",
      resident_recorded_status: "running" },
      root: null });
    expect(failed.verdict).toMatchObject({ status: "blocked",
      reason: "result_provenance_invalid", automatic_retry_allowed: false });
    expect(failed.readRootObservation).toHaveBeenCalledWith("request:root");
    expect(failed.readResidentEvents).not.toHaveBeenCalled();
    for (const resident_recorded_status of ["succeeded", "failed", "canceled",
      "paused_manual_override", "timed_out", "emergency_stopped"]) {
      const stoppedRoot = await run({ child: { ...lineage(), resident_recorded_status },
        root: null });
      expect(stoppedRoot.verdict).toMatchObject({ status: "blocked",
        reason: "result_provenance_invalid", automatic_retry_allowed: false });
      expect(stoppedRoot.readRootObservation).toHaveBeenCalledWith("request:root");
      expect(stoppedRoot.readResidentEvents).not.toHaveBeenCalled();
    }
  });

  it("does not infer a child effect from delivery status or a different native plan", async () => {
    expect((await run({ events: [] })).verdict).toMatchObject({ status: "blocked",
      reason: "result_provenance_invalid", native_result_verified: false });
    const different = nativeEvent(); different.measurements.sequence_id = "sequence:other";
    expect((await run({ events: [{ ...storedEvent(), event_payload: different,
      event_hash: environmentConnectorSha256(different) }] })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
    expect((await run({ events: [{ ...storedEvent(), event_hash: hash("f") }] })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
    const idOnly = nativeEvent();
    delete (idOnly.measurements as { checkpoint_settlements?: unknown }).checkpoint_settlements;
    expect((await run({ events: [{ ...storedEvent(), event_payload: idOnly,
      event_hash: environmentConnectorSha256(idOnly) }] })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
    expect((await run({ child: { ...lineage(), admitted_at:
      "2026-10-09T12:00:01.000Z" } })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
  });

  it("does not borrow a root outcome after the child delivery was retired or contradicted", async () => {
    for (const recorded_status of ["admitted", "paused_manual_override",
      "cancel_requested", "canceled", "timed_out", "emergency_stopped",
      "connector_offline", "authority_stale"]) {
      expect((await run({ child: { ...lineage(), recorded_status } })).verdict)
        .toMatchObject({ status: "blocked", reason: "result_provenance_invalid",
          native_result_verified: false, automatic_retry_allowed: false });
    }
    expect((await run({ child: { ...lineage(), recorded_status: "failed" },
      root: { ...result(), outcome: "succeeded" } })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
    expect((await run({ child: { ...lineage(), recorded_status: "running" },
      root: { ...result(), outcome: "succeeded" } })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
    expect((await run({ child: { ...lineage(), recorded_status: "succeeded" } })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
  });

  it("rejects a root result that contradicts its retained terminal request status", async () => {
    for (const resident_recorded_status of ["running", "canceled", "timed_out",
      "paused_manual_override", "succeeded"]) {
      const inconsistent = await run({ child: { ...lineage(), resident_recorded_status } });
      expect(inconsistent.verdict).toMatchObject({ status: "blocked",
        reason: "result_provenance_invalid", native_result_verified: false,
        automatic_retry_allowed: false });
      expect(inconsistent.readResidentEvents).not.toHaveBeenCalled();
    }
  });

  it("rejects stale identity, current-turn expiry and cancellation", async () => {
    expect((await run({ child: { ...lineage(), reasoning_binding_epoch: 3 } })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_identity_mismatch" });
    expect((await run({ child: { ...lineage(),
      client_continuation_ref: "task:other" } })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_identity_mismatch" });
    expect((await run({ root: { ...result(), eligible_for_current_turn_reentry: false } })).verdict)
      .toMatchObject({ status: "blocked", reason: "result_provenance_invalid" });
    const abort = new AbortController(); abort.abort();
    const cancelled = await run({ signal: abort.signal });
    expect(cancelled.verdict).toMatchObject({ status: "blocked", reason: "read_cancelled" });
    expect(cancelled.readChildLineage).not.toHaveBeenCalled();
  });

  it("is idempotent as a read and never dispatches a successor", async () => {
    const first = await run(); const second = await run();
    expect(second.verdict).toEqual(first.verdict);
    expect(first.readChildLineage).toHaveBeenCalledTimes(1);
    expect(second.readChildLineage).toHaveBeenCalledTimes(1);
    const duplicateProjection = await run({ events: [storedEvent(), storedEvent()] });
    expect(duplicateProjection.verdict).toMatchObject({ status: "reconciled",
      progress_observation_refs: ["event:child-motion"],
      automatic_retry_allowed: false });
  });
});
