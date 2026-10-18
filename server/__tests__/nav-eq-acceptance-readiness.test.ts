import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectNavEqAcceptanceReadiness } from "../../scripts/nav-eq-acceptance-readiness";

const matrixPath =
  "docs/evidence/eh-g8-nav-direct-mcp-execution-qualification-v1/2026-09-21-nav-eq-acceptance-matrix-v1.json";

const loadMatrix = () => JSON.parse(readFileSync(matrixPath, "utf8"));

describe("NAV-EQ acceptance readiness", () => {
  it("keeps the current matrix at specified maturity with every unproven exit open", () => {
    const result = inspectNavEqAcceptanceReadiness(loadMatrix());

    expect(result.ready_for_live_acceptance).toBe(false);
    expect(result.passed_requirement_count).toBe(1);
    expect(result.open_requirement_ids).toContain("authenticated_direct_tool_callable");
    expect(result.open_requirement_ids).toContain("rolling_course_three_successors");
    expect(result.open_requirement_ids).toContain("explicit_revoke_and_zero_effect_stale_rejection");
    expect(result.violations).toEqual([]);
  });

  it("rejects a missing or duplicate requirement", () => {
    const matrix = loadMatrix();
    matrix.requirements.pop();
    matrix.requirements.push({ ...matrix.requirements[0] });

    const result = inspectNavEqAcceptanceReadiness(matrix);

    expect(result.violations).toContain(
      "missing_requirement:stop_fail_criteria_clear",
    );
    expect(result.violations).toContain(
      "duplicate_requirement:matched_runtime_observation_qualified",
    );
  });

  it("rejects a direct-tool pass without an authenticated callable namespace", () => {
    const matrix = loadMatrix();
    const requirement = matrix.requirements.find(
      (item: { requirement_id: string }) =>
        item.requirement_id === "authenticated_direct_tool_callable",
    );
    requirement.status = "passed";
    requirement.evidence_refs = ["evidence:test"];
    requirement.acceptance_data = {
      authenticated_callable: false,
      authenticated_namespace: null,
    };

    const result = inspectNavEqAcceptanceReadiness(matrix);

    expect(result.ready_for_live_acceptance).toBe(false);
    expect(result.violations).toContain(
      "direct_tool_pass_requires_authenticated_callable_namespace",
    );
  });

  it("requires three rolling successors on the external MCP route", () => {
    const matrix = loadMatrix();
    const requirement = matrix.requirements.find(
      (item: { requirement_id: string }) =>
        item.requirement_id === "rolling_course_three_successors",
    );
    requirement.status = "passed";
    requirement.evidence_refs = ["evidence:test"];
    requirement.acceptance_data = {
      external_mcp_route: true,
      rolling_successor_count: 2,
    };

    const result = inspectNavEqAcceptanceReadiness(matrix);

    expect(result.ready_for_live_acceptance).toBe(false);
    expect(result.violations).toContain(
      "rolling_course_pass_requires_external_mcp_and_three_successors",
    );
  });
});
