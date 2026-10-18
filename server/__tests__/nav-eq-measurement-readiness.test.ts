import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectNavEqMeasurementReadiness } from "../../scripts/nav-eq-measurement-readiness";

const contractPath =
  "docs/evidence/eh-g8-nav-direct-mcp-execution-qualification-v1/2026-09-21-nav-eq-measurement-contract-v1.json";

const loadContract = () => JSON.parse(readFileSync(contractPath, "utf8"));

describe("NAV-EQ measurement readiness", () => {
  it("keeps every unmeasured live metric open without inventing zeroes", () => {
    const result = inspectNavEqMeasurementReadiness(loadContract());

    expect(result.ready_for_acceptance).toBe(false);
    expect(result.required_metric_count).toBe(16);
    expect(result.measured_metric_count).toBe(0);
    expect(result.open_metric_ids).toHaveLength(16);
    expect(result.violations).toEqual([]);
  });

  it("rejects a latency distribution inferred from too few samples", () => {
    const contract = loadContract();
    const metric = contract.metrics.find(
      (item: { metric_id: string }) => item.metric_id === "dispatch_to_first_tick_latency_ms",
    );
    metric.status = "measured";
    metric.sample_count = 1;
    metric.clock_origin_id = "clock:test";
    metric.source_evidence_refs = ["evidence:test"];
    metric.value = { p50: 10, p95: 10, p99: 10 };

    const result = inspectNavEqMeasurementReadiness(contract);

    expect(result.violations).toContain(
      "insufficient_sample_count:dispatch_to_first_tick_latency_ms",
    );
  });

  it("requires an explicit reason for unavailable measurements", () => {
    const contract = loadContract();
    const metric = contract.metrics[0];
    metric.status = "unavailable";
    metric.unavailable_reason = null;

    const result = inspectNavEqMeasurementReadiness(contract);

    expect(result.unavailable_metric_ids).toContain(metric.metric_id);
    expect(result.violations).toContain(
      `unavailable_metric_missing_reason:${metric.metric_id}`,
    );
  });

  it("recognizes a frozen contract only after every metric is measured", () => {
    const contract = loadContract();
    contract.status = "frozen_complete";
    contract.frozen = true;
    for (const metric of contract.metrics) {
      metric.status = "measured";
      metric.sample_count = metric.minimum_sample_count;
      metric.clock_origin_id = "clock:test";
      metric.source_evidence_refs = [`evidence:${metric.metric_id}`];
      metric.value = metric.aggregation === "p50_p95_p99"
        ? { p50: 1, p95: 2, p99: 3 }
        : 1;
    }

    const result = inspectNavEqMeasurementReadiness(contract);

    expect(result.ready_for_acceptance).toBe(true);
    expect(result.open_metric_ids).toEqual([]);
    expect(result.violations).toEqual([]);
  });
});
