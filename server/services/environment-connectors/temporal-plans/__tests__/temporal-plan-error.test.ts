import { expect, it } from "vitest";
import { TemporalPlanError, temporalPlanErrorProjection } from "../temporal-plan-error";

it.each(["temporal_retention_compilation_mismatch","temporal_retention_binding_invalid","temporal_retention_task_mismatch","temporal_retention_goal_stale","temporal_retention_frontier_stale","temporal_retention_action_mismatch","temporal_retention_goal_forbidden","temporal_retention_resident_unresolved","temporal_retention_checkpoint_replay_conflict","temporal_retention_replay_conflict","temporal_retention_action_already_dispatched","temporal_retention_checkpoint_required","temporal_retention_successor_already_admitted","temporal_retention_frontier_predates_checkpoint","temporal_retention_predecessor_binding_mismatch","temporal_retention_predecessor_hash_mismatch","temporal_retention_predecessor_identity_mismatch","temporal_retention_predecessor_revision_regressed","temporal_retention_predecessor_clock_mismatch","temporal_retention_committed_window_overlap","temporal_checkpoint_resident_association_mismatch","temporal_checkpoint_action_mismatch","temporal_checkpoint_event_stale","temporal_checkpoint_event_hash_mismatch","temporal_checkpoint_event_identity_or_state_mismatch","temporal_checkpoint_action_event_mismatch","temporal_checkpoint_action_event_hash_mismatch","temporal_checkpoint_native_plan_mismatch","temporal_checkpoint_clock_unmapped","temporal_checkpoint_anchor_hash_mismatch","temporal_checkpoint_anchor_identity_mismatch","temporal_checkpoint_anchor_state_invalid","temporal_checkpoint_anchor_settlement_changed","temporal_checkpoint_anchor_clock_invalid","temporal_checkpoint_reference_unverified"] as const)("preserves closed checkpoint/retention code %s", code => {
  const error = new TemporalPlanError(code);
  error.message = "private-message-sentinel";
  error.stack = "private-stack-sentinel";
  expect(temporalPlanErrorProjection(error)).toMatchObject({ error: code,
    retryable: false, execution_authority: false, answer_authority: false, terminal_eligible: false });
  expect(JSON.stringify(temporalPlanErrorProjection(error))).not.toContain("sentinel");
  expect(temporalPlanErrorProjection(new Error(code))).toBeNull();
});

it.each([
  "temporal_retention_responses_checkpoint_hash_mismatch",
  "temporal_retention_responses_snapshot_invalid",
  "temporal_retention_responses_snapshot_mismatch",
] as const)("projects a Responses retention guard without private contents: %s", code => {
  const error = new TemporalPlanError(code);
  error.message = "private-message-sentinel";
  const result = temporalPlanErrorProjection(error);
  expect(result).toMatchObject({ error: code, retryable: false,
    execution_authority: false, answer_authority: false });
  expect(JSON.stringify(result)).not.toContain("sentinel");
});

it("retention association failure throws a projectable typed guard", async () => {
  const { assertTemporalPredecessorAssociation } = await import("../temporal-admission-retention");
  let failure: unknown;
  try {
    assertTemporalPredecessorAssociation({} as never, undefined,
      { bindingId: "binding:test", bindingEpoch: 1, continuationRef: "continuation:test" });
  } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(TemporalPlanError);
  expect(temporalPlanErrorProjection(failure)?.error).toBe("temporal_retention_predecessor_binding_mismatch");
});

it("projects a typed admission gate without exception contents or authority", () => {
  const error = new TemporalPlanError("temporal_plan_frontier_expired_or_unmapped");
  error.message = "secret-sentinel";
  error.stack = "private-stack-sentinel";
  const result = temporalPlanErrorProjection(error);
  expect(result).toMatchObject({ error: "temporal_plan_frontier_expired_or_unmapped",
    retryable: false, execution_authority: false, answer_authority: false,
    terminal_eligible: false, reentry_required: true });
  expect(JSON.stringify(result)).not.toContain("sentinel");
});

it("does not promote arbitrary or lookalike exceptions into trusted gate diagnostics", () => {
  expect(temporalPlanErrorProjection(new Error("temporal_plan_not_current"))).toBeNull();
  expect(temporalPlanErrorProjection({ code: "temporal_plan_not_current" })).toBeNull();
});

it.each([
  "temporal_frontier_time_invalid", "temporal_frontier_forbidden",
  "temporal_frontier_integrity_invalid", "temporal_frontier_goal_stale",
  "temporal_frontier_retention_invalid", "temporal_frontier_replay_conflict",
  "temporal_frontier_revision_overflow", "temporal_frontier_observation_regressed",
] as const)("preserves closed frontier storage code %s without arbitrary details", code => {
  const error = new TemporalPlanError(code);
  error.message = "private-message-sentinel";
  error.stack = "private-stack-sentinel";
  const result = temporalPlanErrorProjection(error);
  expect(result).toMatchObject({ error: code, retryable: false, execution_authority: false,
    answer_authority: false, terminal_eligible: false });
  expect(JSON.stringify(result)).not.toContain("sentinel");
});
