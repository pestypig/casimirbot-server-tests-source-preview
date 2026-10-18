import { describe, expect, it, vi } from "vitest";
import {
  HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  type HelixEnvironmentActionObservation,
} from "@shared/helix-environment-action";
import { reconcileResponsesActionResult, reconcileStoredResponsesActionResult } from
  "../responses-action-result-reconcile";

const link = {
  decision_id: "decision:one", choice_source_hash: `sha256:${"a".repeat(64)}`,
  choice_id: "advance:one", reasoning_binding_id: "binding:one",
  binding_epoch: 2, run_id: "run:one", checkpoint_event_id: "event:one",
  plan_id: "plan:one", plan_hash: `sha256:${"b".repeat(64)}`,
  action_request_id: "request:one",
};

const observation = (): HelixEnvironmentActionObservation => ({
  schema: HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  action_request_ref: "request:one", workflow_ref: "workflow:one",
  action_execution_ref: "execution:one", capability_id: "sequence.execute",
  capability_version: 1, action_kind: "execute_sequence", outcome: "succeeded",
  summary: "The player reached the waypoint.",
  result: { control_engine: "native_fabric", controls_released: true,
    automatic_replay_performed: false, player_motion_performed: true,
    player_interaction_performed: false, inventory_mutation_performed: false,
    world_mutation_performed: false },
  progress_observation_refs: [], postcondition_evidence_refs: [],
  evidence_ref: "environment_action_evidence:one",
  observed_at: "2026-10-09T12:00:00.000Z", provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  content_role: "environment_action_observation_not_assistant_answer",
  reentry_required: true, answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
});

describe("Responses decision to canonical native result", () => {
  it("keeps a missing result unknown and forbids automatic replay", async () => {
    const reader = vi.fn(async () => null);
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: reader })).toEqual({ status: "pending",
      action_request_id: "request:one", native_result_verified: false,
      automatic_retry_allowed: false });
    expect(reader).toHaveBeenCalledExactlyOnceWith("request:one");
  });

  it("joins exact current-turn evidence without declaring goal progress", async () => {
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => observation() })).toMatchObject({
      status: "reconciled", decision_id: "decision:one",
      action_request_id: "request:one", action_execution_ref: "execution:one",
      evidence_ref: "environment_action_evidence:one", outcome: "succeeded",
      player_motion_performed: true, controls_released: true,
      native_result_verified: true, goal_progress_verified: false,
      automatic_retry_allowed: false,
    });
  });

  it("retains a failed effect as evidence rather than success or retry permission", async () => {
    const failed = observation();
    failed.outcome = "failed";
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => failed })).toMatchObject({
      status: "reconciled", outcome: "failed", player_motion_performed: true,
      goal_progress_verified: false, automatic_retry_allowed: false,
    });
  });

  it("keeps recorded unknown outcomes unresolved even with an execution ref", async () => {
    const unknown = observation();
    unknown.outcome = "action_outcome_unknown";
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => unknown })).toMatchObject({
      status: "unresolved", outcome: "action_outcome_unknown",
      native_result_verified: false, automatic_retry_allowed: false,
    });
  });

  it("keeps a pre-execution rejection distinct from a native result", async () => {
    const rejected = observation();
    rejected.outcome = "capability_unavailable";
    rejected.action_execution_ref = null;
    rejected.result.player_motion_performed = false;
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => rejected })).toMatchObject({
      status: "settled_without_native_execution", outcome: "capability_unavailable",
      native_result_verified: false, goal_progress_verified: false,
      automatic_retry_allowed: false,
    });
  });

  it("rejects another request, missing provenance and unreleased controls", async () => {
    const other = observation();
    other.action_request_ref = "request:other";
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => other })).toMatchObject({
      status: "blocked", reason: "result_identity_mismatch" });
    const unproven = observation();
    unproven.provenance_valid = false;
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => unproven })).toMatchObject({
      status: "blocked", reason: "result_provenance_invalid" });
    const unreleased = observation();
    unreleased.result.controls_released = false;
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => unreleased })).toMatchObject({
      status: "blocked", reason: "result_flags_invalid" });
  });

  it("does not turn a reader failure into a new action", async () => {
    expect(await reconcileResponsesActionResult({ link,
      readCanonicalObservation: async () => { throw new Error("offline"); } }))
      .toMatchObject({ status: "blocked", reason: "result_read_failed",
        native_result_verified: false, automatic_retry_allowed: false });
  });
});

describe("protected Responses result read", () => {
  const binding = {
    profileRef: "profile:one", authenticatedMcpClientRef: "mcp:one",
    clientSessionRef: "session:one", clientContinuationRef: "task:one",
    bindingId: "binding:one", bindingEpoch: 2,
    helixConversationId: "chat:one", missionId: null, runId: "run:one",
  };

  it("reads the broker by exact request ID only with an association on both sides", async () => {
    const verifyTaskAssociation = vi.fn();
    const readCanonicalObservation = vi.fn(async () => observation());
    const result = await reconcileStoredResponsesActionResult({ link, binding },
      { verifyTaskAssociation }, { readCanonicalObservation });
    expect(result).toMatchObject({ status: "reconciled",
      decision_id: "decision:one", evidence_ref: "environment_action_evidence:one",
      automatic_retry_allowed: false });
    expect(readCanonicalObservation).toHaveBeenCalledExactlyOnceWith("request:one");
    expect(verifyTaskAssociation).toHaveBeenCalledTimes(2);
  });

  it("uses protected temporal lineage before any direct child result", async () => {
    const verifyTaskAssociation = vi.fn();
    const readCanonicalObservation = vi.fn(async () => observation());
    const resident = vi.fn(async () => ({ status: "reconciled" as const,
      decision_id: link.decision_id, action_request_id: link.action_request_id,
      action_execution_ref: "execution:root", workflow_ref: "workflow:root",
      evidence_ref: "evidence:root", observed_at: "2026-10-09T12:00:00.000Z",
      progress_observation_refs: ["event:child"], outcome: "failed" as const,
      player_motion_performed: true, controls_released: true as const,
      native_result_verified: true as const, goal_progress_verified: false as const,
      automatic_retry_allowed: false as const }));
    const result = await reconcileStoredResponsesActionResult({ link, binding },
      { verifyTaskAssociation }, { readCanonicalObservation,
        readResidentResult: resident });
    expect(readCanonicalObservation).not.toHaveBeenCalled();
    expect(resident).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "reconciled",
      action_request_id: "request:one", evidence_ref: "evidence:root",
      automatic_retry_allowed: false });
    expect(verifyTaskAssociation).toHaveBeenCalledTimes(2);
  });

  it("cannot accept a direct child observation when protected lineage rejects it", async () => {
    const readCanonicalObservation = vi.fn(async () => observation());
    const resident = vi.fn(async () => ({ status: "blocked" as const,
      reason: "result_identity_mismatch" as const,
      action_request_id: link.action_request_id,
      native_result_verified: false as const,
      automatic_retry_allowed: false as const }));
    const result = await reconcileStoredResponsesActionResult({ link, binding },
      { verifyTaskAssociation: vi.fn(async () => ({})) },
      { readCanonicalObservation, readResidentResult: resident });
    expect(result).toMatchObject({ status: "blocked",
      reason: "result_identity_mismatch", native_result_verified: false,
      automatic_retry_allowed: false });
    expect(resident).toHaveBeenCalledTimes(1);
    expect(readCanonicalObservation).not.toHaveBeenCalled();
  });

  it("rejects a protected receipt for another admitted request", async () => {
    const result = await reconcileStoredResponsesActionResult({ link, binding },
      { verifyTaskAssociation: vi.fn(async () => ({})) }, {
        readCanonicalObservation: async () => observation(),
        readResidentResult: async () => ({ status: "pending",
          action_request_id: "request:other", native_result_verified: false,
          automatic_retry_allowed: false }),
      });
    expect(result).toMatchObject({ status: "blocked",
      reason: "result_identity_mismatch", action_request_id: link.action_request_id,
      native_result_verified: false, automatic_retry_allowed: false });
  });

  it("blocks wrong binding, run, or expired pre-read association before storage access", async () => {
    const readCanonicalObservation = vi.fn(async () => observation());
    const verifyTaskAssociation = vi.fn();
    for (const wrong of [{ ...binding, bindingEpoch: 3 },
      { ...binding, runId: "run:later" },
      { ...binding, bindingId: "binding:later" }]) {
      expect(await reconcileStoredResponsesActionResult({ link, binding: wrong },
        { verifyTaskAssociation }, { readCanonicalObservation }))
        .toMatchObject({ status: "blocked", reason: "binding_mismatch" });
    }
    expect(verifyTaskAssociation).not.toHaveBeenCalled();
    verifyTaskAssociation.mockRejectedValueOnce(new Error("expired"));
    expect(await reconcileStoredResponsesActionResult({ link, binding },
      { verifyTaskAssociation }, { readCanonicalObservation }))
      .toMatchObject({ status: "blocked", reason: "binding_mismatch" });
    expect(readCanonicalObservation).not.toHaveBeenCalled();
  });

  it("does not publish a result after association loss during the read", async () => {
    const verifyTaskAssociation = vi.fn()
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    expect(await reconcileStoredResponsesActionResult({ link, binding },
      { verifyTaskAssociation }, { readCanonicalObservation: async () => observation() }))
      .toMatchObject({ status: "blocked", reason: "binding_mismatch",
        native_result_verified: false, automatic_retry_allowed: false });
  });

  it("does not publish a result when canceled before or during the read", async () => {
    const before = new AbortController();
    before.abort();
    const reader = vi.fn(async () => observation());
    const verifier = { verifyTaskAssociation: vi.fn() };
    expect(await reconcileStoredResponsesActionResult({ link, binding,
      signal: before.signal }, verifier, { readCanonicalObservation: reader }))
      .toMatchObject({ status: "blocked", reason: "read_cancelled" });
    expect(reader).not.toHaveBeenCalled();
    const during = new AbortController();
    expect(await reconcileStoredResponsesActionResult({ link, binding,
      signal: during.signal }, verifier, { readCanonicalObservation: async () => {
        during.abort(); return observation();
      } })).toMatchObject({ status: "blocked", reason: "read_cancelled",
        automatic_retry_allowed: false });
    const duringRecheck = new AbortController();
    const verifyTaskAssociation = vi.fn().mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => { duringRecheck.abort(); });
    expect(await reconcileStoredResponsesActionResult({ link, binding,
      signal: duringRecheck.signal }, { verifyTaskAssociation },
      { readCanonicalObservation: async () => observation() }))
      .toMatchObject({ status: "blocked", reason: "read_cancelled",
        native_result_verified: false, automatic_retry_allowed: false });
  });
});
