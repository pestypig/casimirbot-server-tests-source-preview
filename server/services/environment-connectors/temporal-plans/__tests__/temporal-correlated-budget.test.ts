import { expect, it } from "vitest";
import { auditTemporalCorrelatedBudget } from "../temporal-correlated-budget";

const fixture = () => {
  const identity = {
    run_id: "run",
    checkpoint_id: "checkpoint",
    producer_epoch_ref: "epoch",
  };
  const server = {
    ...identity,
    action_request_id: "child",
    plan_id: "plan",
    reasoning_binding_id: "binding",
    reasoning_binding_epoch: 1,
    clock_origin: "server",
    frontier_id: "frontier",
  };
  return {
    admission: {
      ...server,
      proposal_received_ms: 100,
      transaction_returned_ms: 120,
      frontier_publication_to_proposal_receipt_ms: 20,
    },
    delivery: {
      ...server,
      resident_action_request_id: "root",
      poll_received_ms: 125,
      lease_sql_finished_ms: 140,
      transaction_returned_ms: 150,
      configured_persistence_barrier_completed: true,
    },
    acceptance: {
      ...identity,
      successor_action_request_id: "child",
      resident_action_request_id: "root",
      sequence_id: "plan",
      clock_domain: "native_process_monotonic",
      checkpoint_to_acceptance_ms: 100,
      checkpoint_to_evidence_fence_observed_ms: 35,
      evidence_fence_observed_to_acceptance_ms: 65,
      evidence_fence_observed_to_delivery_poll_ms: 5,
      delivery_http_roundtrip_ms: 50,
      delivery_response_to_acceptance_ms: 10,
      accepted_client_tick: 1,
      stop_client_tick: 3,
    },
    source: "simulated" as const,
    checkpoint_to_stop_window_ms: 200,
    safety_margin_ms: 20,
  };
};
it("uses the enclosing interval once, without adding nested server work", () => {
  expect(auditTemporalCorrelatedBudget(fixture())).toMatchObject({
    total_budget_ms: 120,
    server_nested_duration_ms: 70,
    margin_ms: 80,
    fits: true,
    stage_breakdown_complete: false,
    live_acceptance: false,
    execution_authority: false,
  });
});
const responseFixture = () => ({ frontier_id: "frontier", run_id: "run",
  producer_epoch_ref: "epoch", checkpoint_id: "checkpoint", clock_origin: "server",
  request_received_ms: 50, response_ready_ms: 90 });
it("correlates preparation separately from response-ready to proposal without double counting", () => {
  expect(auditTemporalCorrelatedBudget({ ...fixture(), frontierResponse: responseFixture() }))
    .toMatchObject({ frontier_response_correlated: true, frontier_response_preparation_ms: 40,
      response_ready_to_proposal_receipt_ms: 10, total_budget_ms: 120,
      stage_breakdown_complete: false, fits: true });
});
it("partitions server time with persistence in the lease phase, not initial admission", () => {
  const result = auditTemporalCorrelatedBudget({ ...fixture(), frontierResponse: responseFixture() });
  expect(result.server_phase_durations_ms).toEqual({ frontier_response_preparation: 40,
    response_ready_to_proposal_receipt: 10, proposal_receipt_to_admission_return: 20,
    admission_return_to_delivery_poll: 5, delivery_poll_to_lease_sql: 15,
    lease_sql_to_commit_and_persistence_return: 10 });
  expect(Object.values(result.server_phase_durations_ms!).reduce((sum, value) => sum + value, 0)).toBe(100);
  expect(result.total_budget_ms).toBe(120);
});
it("rejects preparation that cannot fit inside the native checkpoint interval", () => {
  expect(auditTemporalCorrelatedBudget({ ...fixture(), frontierResponse: {
    ...responseFixture(), request_received_ms: 48,
  } })).toMatchObject({ fits: false, enclosing_interval_verified: false,
    server_phase_partition_complete: false,
    reasons: ["server_preparation_enclosure_inconsistent"] });
});
it("allows the documented one-ms preparation enclosure rounding", () => {
  expect(auditTemporalCorrelatedBudget({ ...fixture(), frontierResponse: {
    ...responseFixture(), request_received_ms: 49,
  } }).fits).toBe(true);
});
it.each(["frontier_id", "run_id", "producer_epoch_ref", "checkpoint_id", "clock_origin"])(
  "rejects an unrelated response-ready record: %s", key => {
    expect(auditTemporalCorrelatedBudget({ ...fixture(), frontierResponse: {
      ...responseFixture(), [key]: "other",
    } })).toMatchObject({ fits: false, frontier_response_correlated: false,
      response_ready_to_proposal_receipt_ms: null });
  });
it.each([undefined, null, NaN, -1, 49, 101])("rejects missing/regressed/future response readiness %s", ready => {
  expect(auditTemporalCorrelatedBudget({ ...fixture(), frontierResponse: {
    ...responseFixture(), response_ready_ms: ready,
  } })).toMatchObject({ fits: false, frontier_response_correlated: false,
    reasons: ["frontier_response_marks_invalid"] });
});
it("does not invent response readiness for legacy traces", () => {
  expect(auditTemporalCorrelatedBudget(fixture())).toMatchObject({
    frontier_response_correlated: false, frontier_response_preparation_ms: null,
    response_ready_to_proposal_receipt_ms: null, stage_breakdown_complete: false });
});
it.each([
  "epoch",
  "binding",
  "checkpoint",
  "action",
  "native_action",
  "clock",
  "regression",
  "snapshot",
  "late",
  "nested",
])("rejects inconsistent correlated evidence: %s", (fault) => {
  const input = fixture();
  if (fault === "epoch") input.acceptance.producer_epoch_ref = "other";
  if (fault === "binding") input.delivery.reasoning_binding_epoch++;
  if (fault === "checkpoint") input.delivery.checkpoint_id = "other";
  if (fault === "action") input.delivery.action_request_id = "other";
  if (fault === "native_action") input.acceptance.successor_action_request_id = "other";
  if (fault === "clock") input.delivery.clock_origin = "restart";
  if (fault === "regression") input.delivery.transaction_returned_ms = 10;
  if (fault === "snapshot")
    input.delivery.configured_persistence_barrier_completed = false;
  if (fault === "late") input.acceptance.accepted_client_tick = 3;
  if (fault === "nested") input.acceptance.checkpoint_to_acceptance_ms = 50;
  expect(auditTemporalCorrelatedBudget(input)).toMatchObject({
    fits: false,
    enclosing_interval_verified: false,
  });
});
it.each([undefined, null, "", "unrelated-child"])("rejects missing or wrong native successor identity %s", action => {
  const input = fixture();
  expect(auditTemporalCorrelatedBudget({ ...input, acceptance: {
    ...input.acceptance, successor_action_request_id: action,
  } })).toMatchObject({ fits: false, enclosing_interval_verified: false,
    reasons: ["identity_mismatch"] });
});
it("rejects server delivery outside HTTP even when the total native budget fits", () => {
  const input = fixture();
  input.acceptance.delivery_http_roundtrip_ms = 20;
  input.acceptance.delivery_response_to_acceptance_ms = 40;
  expect(auditTemporalCorrelatedBudget(input)).toMatchObject({
    native_transport_coverage_complete: true, fits: false,
    enclosing_interval_verified: false,
    reasons: ["delivery_http_enclosure_inconsistent"],
  });
});
it("allows only the documented one-ms delivery rounding tolerance", () => {
  const input = fixture();
  input.acceptance.delivery_http_roundtrip_ms = 24;
  input.acceptance.delivery_response_to_acceptance_ms = 36;
  expect(auditTemporalCorrelatedBudget(input).fits).toBe(true);
  input.acceptance.delivery_http_roundtrip_ms = 23;
  input.acceptance.delivery_response_to_acceptance_ms = 37;
  expect(auditTemporalCorrelatedBudget(input).reasons).toContain("delivery_http_enclosure_inconsistent");
});
it("cannot infer a window from a successful pickup", () => {
  expect(
    auditTemporalCorrelatedBudget({
      ...fixture(),
      checkpoint_to_stop_window_ms: null,
    }),
  ).toMatchObject({
    enclosing_interval_verified: true,
    fits: false,
    margin_ms: null,
    reasons: ["window_unmeasured"],
  });
});
it.each(["evidence_fence_observed_to_delivery_poll_ms", "delivery_http_roundtrip_ms", "delivery_response_to_acceptance_ms"])(
  "rejects missing transport phase %s", key => {
    const input = fixture();
    expect(auditTemporalCorrelatedBudget({ ...input, acceptance: { ...input.acceptance, [key]: null } }))
      .toMatchObject({ fits: false, native_transport_coverage_complete: false,
        reasons: ["native_transport_coverage_missing_or_inconsistent"] });
  });
it.each([undefined, null, NaN, -1, 200])("rejects incomplete or impossible native phase %s", duration => {
  const input = fixture();
  expect(auditTemporalCorrelatedBudget({ ...input, acceptance: {
    ...input.acceptance, checkpoint_to_evidence_fence_observed_ms: duration,
  } })).toMatchObject({ fits: false, native_phase_coverage_complete: false,
    enclosing_interval_verified: false, reasons: ["native_phase_coverage_missing_or_inconsistent"] });
});
it.each([120, 119])("rejects an exhausted window %s", (window) => {
  expect(
    auditTemporalCorrelatedBudget({
      ...fixture(),
      checkpoint_to_stop_window_ms: window,
    }).reasons,
  ).toContain("budget_exhausted");
});
