import { describe, expect, it } from "vitest";
import { buildCapacityReportFromCapture } from
  "../../scripts/helix-environment-capacity-report";

const sample = (cycle: number, patch: Record<string, unknown> = {}) => ({
  schema: "environment.capacity_sample.v1",
  sample_id: `capacity_sample:et6:${cycle}`,
  course: cycle === 1 ? "controlled_n0" : "unknown_world",
  rolling_cycle_index: cycle,
  identity: {
    environment_id: "environment:minecraft:et6",
    source_id: "source:fabric:et6",
    subject_id: "player:et6",
    producer_epoch: "epoch:fabric:et6",
    authority_id: "authority:player:et6",
    authority_revision: 1,
    goal_id: "goal:capacity:et6",
    goal_revision: 1,
    observation_revision: cycle,
    affordance_revision: cycle,
  },
  exact_reasoning_binding_ref: "reasoning_binding:et6:live",
  resident_computation_ms: cycle,
  dispatch_to_first_tick_ms: cycle * 2,
  scheduler_ticks: 20,
  active_control_ticks: 20,
  stalled_ticks: 0,
  missed_ticks: 0,
  queue_depth_peak: cycle,
  lead_time_ticks: cycle * 4,
  latencies_ms: {
    event_to_evidence: cycle * 3,
    evidence_to_pickup: cycle * 4,
    stop_to_replan: cycle * 5,
    finalized_steering_to_stop: cycle * 2,
    manual_or_safety_to_release: cycle,
  },
  elapsed_ms: 1_000,
  replans: 1,
  unnecessary_replans: 0,
  observation_input_bytes: 1_000,
  observation_output_bytes: 250,
  observation_tokens: 60,
  raw_event_count: 10,
  emitted_observation_count: 2,
  performed_effect_refs: [`effect:et6:${cycle}`],
  verified_progress_units: 3,
  model_tool_round_trips: 1,
  changed_affordance_replan_observed: cycle === 2,
  local_intervention_observed: cycle === 2,
  user_steering_observed: cycle === 2,
  reconnect_recovery_observed: cycle === 3,
  revocation_observed: cycle === 3,
  stale_after_revoke_rejected: cycle === 3,
  evidence_reentered: true,
  controls_released: true,
  credential_included: false,
  hidden_reasoning_included: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  ...patch,
});

describe("ET6 capacity report capture utility", () => {
  it.each(["environment_id", "subject_id", "goal_id"])(
    "rejects mixed %s even when the reasoning binding matches",
    (field) => {
      const changed = sample(2);
      expect(() => buildCapacityReportFromCapture({
        schema: "environment.capacity_capture.v1",
        report_id: "capacity_report:mixed-identity",
        samples: [sample(1), { ...changed, identity: {
          ...changed.identity, [field]: "other:identity",
        } }, sample(3)],
        evidence_refs: ["fixture:mixed-identity"],
      })).toThrow("one environment, subject, and goal");
    },
  );

  it("rejects a repeated sample identity with a relabeled cycle", () => {
    expect(() => buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:replayed-sample",
      samples: [sample(1), sample(2, { sample_id: sample(1).sample_id }), sample(3)],
      evidence_refs: ["fixture:replayed-sample"],
    })).toThrow("unique sample identities");
  });

  it("does not confuse reconnect epoch changes with a different subject or goal", () => {
    const reconnected = sample(3);
    const report = buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:reconnect-fixture",
      samples: [sample(1), sample(2), { ...reconnected, identity: {
        ...reconnected.identity, producer_epoch: "epoch:reconnected", goal_revision: 2,
      } }],
      evidence_refs: ["fixture:reconnect-not-live-proof"],
    });
    expect(report.rolling_cycle_count).toBe(3);
  });

  it("keeps duplicate effects across reconnect samples as failed acceptance", () => {
    const report = buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:duplicate-effects",
      samples: [sample(1), sample(2), sample(3, {
        performed_effect_refs: sample(1).performed_effect_refs,
      })],
      evidence_refs: ["fixture:duplicate-effects"],
    });
    expect(report.duplicate_effect_count).toBe(1);
    expect(report.exit_satisfied).toBe(false);
  });

  it("retains native missed intervals separately from observed scheduler ticks", () => {
    // EnvironmentCapacityTelemetryTest: invocations at 1010 and 1160 ms.
    // Two nominal 50 ms slots were missed between the two actual invocations.
    const report = buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:native-lag",
      samples: [sample(1, {
        scheduler_ticks: 2,
        active_control_ticks: 1,
        stalled_ticks: 1,
        missed_ticks: 2,
      })],
      evidence_refs: ["fixture:native-capacity-telemetry"],
    });
    expect(report.missed_tick_count).toBe(2);
    expect(report.stalled_tick_count).toBe(1);
    expect(report.continuous_control_ratio).toBe(0.5);
    expect(report.exit_satisfied).toBe(false);
  });

  it.each([
    { stalled_ticks: 21 },
    { active_control_ticks: 21 },
    { missed_ticks: -1 },
  ])("still rejects impossible observed or negative counters: %j", (patch) => {
    expect(() => buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:invalid-counters",
      samples: [sample(1, patch)],
      evidence_refs: ["fixture:invalid-counters"],
    })).toThrow();
  });

  it("builds the canonical passing report from one exact measured binding", () => {
    const report = buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:et6:live",
      samples: [sample(1), sample(2), sample(3)],
      evidence_refs: ["evidence:et6:live"],
    });
    expect(report.exit_satisfied).toBe(true);
    expect(report.rolling_cycle_count).toBe(3);
    expect(report.missing_measurements).toEqual([]);
    expect(report.exact_reasoning_binding_ref).toBe(
      "reasoning_binding:et6:live",
    );
  });

  it("rejects mixed bindings instead of aggregating them", () => {
    expect(() =>
      buildCapacityReportFromCapture({
        schema: "environment.capacity_capture.v1",
        report_id: "capacity_report:et6:mixed",
        samples: [
          sample(1),
          sample(2, {
            exact_reasoning_binding_ref: "reasoning_binding:other",
          }),
        ],
        evidence_refs: ["evidence:et6:mixed"],
      }),
    ).toThrow("one exact reasoning binding");
  });

  it("retains missing measurements as a failed exit", () => {
    const report = buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:et6:incomplete",
      samples: [sample(1, { observation_tokens: null })],
      evidence_refs: ["evidence:et6:incomplete"],
    });
    expect(report.exit_satisfied).toBe(false);
    expect(report.missing_measurements).toContain("observation:tokens");
  });

  it("does not coerce unavailable lead-time or byte measurements to zero", () => {
    const report = buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:et6:unavailable-measurements",
      samples: [
        sample(1, {
          lead_time_ticks: null,
          observation_input_bytes: null,
          observation_output_bytes: null,
        }),
      ],
      evidence_refs: ["evidence:et6:unavailable-measurements"],
    });

    expect(report.lead_time_ticks_p50).toBeNull();
    expect(report.observation_input_bytes).toBeNull();
    expect(report.observation_output_bytes).toBeNull();
    expect(report.missing_measurements).toEqual(expect.arrayContaining([
      "planning:lead_time_ticks",
      "observation:input_bytes",
      "observation:output_bytes",
    ]));
    expect(report.exit_satisfied).toBe(false);
  });

  it("does not force an unavailable course label into a measured category", () => {
    const report = buildCapacityReportFromCapture({
      schema: "environment.capacity_capture.v1",
      report_id: "capacity_report:et6:unavailable-course",
      samples: [sample(1, { course: null })],
      evidence_refs: ["evidence:et6:unavailable-course"],
    });

    expect(report.courses_observed).toEqual([]);
    expect(report.missing_measurements).toContain("course:classification");
    expect(report.exit_criteria.required_measurements_complete).toBe(false);
    expect(report.exit_satisfied).toBe(false);
  });
});
