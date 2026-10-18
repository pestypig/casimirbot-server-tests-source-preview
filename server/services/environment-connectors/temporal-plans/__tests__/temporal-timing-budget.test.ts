import { expect, it } from "vitest";
import { auditTemporalTimingBudget, temporalTimingStages } from "../temporal-timing-budget";

const fixture = () => {
  const identity = { run_id: "run", plan_id: "plan", checkpoint_id: "checkpoint" };
  return { identity, source: "simulated" as const, remaining_window_ms: 1000, safety_margin_ms: 100,
    spans: temporalTimingStages.map((stage, index) => ({ ...identity, stage, clock_origin: "simulation",
      start_ms: index * 100, end_ms: (index + 1) * 100 })) };
};
it("audits a complete simulated budget without live or execution authority", () => {
  expect(auditTemporalTimingBudget(fixture())).toMatchObject({ complete: true, fits: true,
    total_budget_ms: 600, margin_ms: 400, source: "simulated", live_acceptance: false, execution_authority: false });
});
it("rejects overflow without returning nonfinite budget measurements", () => {
  const input = fixture();
  input.safety_margin_ms = Number.MAX_VALUE;
  input.remaining_window_ms = Number.MAX_VALUE;
  input.spans = input.spans.map((span, index) => ({ ...span,
    start_ms: index === 0 ? 0 : Number.MAX_VALUE, end_ms: Number.MAX_VALUE }));
  expect(auditTemporalTimingBudget(input)).toMatchObject({ complete: false, fits: false,
    total_budget_ms: null, margin_ms: null, reasons: ["budget_arithmetic_invalid"] });
});
it("subtracts local timestamps before accumulating durations", () => {
  const input = fixture();
  input.safety_margin_ms = Number.MAX_VALUE / 2;
  input.remaining_window_ms = Number.MAX_VALUE;
  input.spans = input.spans.map(span => ({ ...span,
    start_ms: Number.MAX_VALUE, end_ms: Number.MAX_VALUE }));
  expect(auditTemporalTimingBudget(input)).toMatchObject({ complete: true, fits: true,
    total_budget_ms: Number.MAX_VALUE / 2, margin_ms: Number.MAX_VALUE / 2 });
});
it.each([600, 599])("rejects exhaustion at window %s", window => {
  expect(auditTemporalTimingBudget({ ...fixture(), remaining_window_ms: window }).reasons).toContain("budget_exhausted");
});
it("rejects missing phases, identity drift, unmapped clocks and trace gaps", () => {
  for (const kind of ["missing", "identity", "clock", "gap", "duplicate"]) {
    const input = fixture();
    if (kind === "missing") input.spans.pop();
    if (kind === "identity") input.spans[1].run_id = "other";
    if (kind === "clock") input.spans[1].clock_origin = "other";
    if (kind === "gap") input.spans[1].start_ms++;
    if (kind === "duplicate") input.spans.push(input.spans[0]);
    expect(auditTemporalTimingBudget(input).fits, kind).toBe(false);
  }
  expect(auditTemporalTimingBudget({ ...fixture(), remaining_window_ms: null }).fits).toBe(false);
});
