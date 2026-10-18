import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectNavEqProtocolFreezeReadiness } from "../../scripts/nav-eq-protocol-readiness";

const protocolPath =
  "docs/evidence/eh-g8-nav-direct-mcp-execution-qualification-v1/2026-09-21-current-runtime-pre-admission-protocol-v21.json";

const loadDraft = () => JSON.parse(readFileSync(protocolPath, "utf8"));

describe("NAV-EQ V21 pre-admission protocol readiness", () => {
  it("keeps the current runtime draft fail closed until every live field exists", () => {
    const result = inspectNavEqProtocolFreezeReadiness(loadDraft());

    expect(result.ready_to_freeze).toBe(false);
    expect(result.motion_authorized).toBe(false);
    expect(result.violations).toEqual([]);
    expect(result.missing_live_fields).toContain("direct_tool.authenticated_namespace");
    expect(result.missing_live_fields).toContain("course.geometry_current_for_freeze");
    expect(result.missing_live_fields).toContain("movement_authority.authority_id");
    expect(result.missing_live_fields).toContain("clocks.monotonic_origin_id");
    expect(result.missing_live_fields).toContain("measurement_limits.evidence_drain_runway_ms");
  });

  it("rejects any pre-admission artifact that claims motion authority", () => {
    const draft = loadDraft();
    draft.motion_authorized = true;

    const result = inspectNavEqProtocolFreezeReadiness(draft);

    expect(result.ready_to_freeze).toBe(false);
    expect(result.violations).toContain("pre_admission_protocol_must_not_authorize_motion");
  });

  it("recognizes a complete explicit freeze without turning it into action authority", () => {
    const protocol = loadDraft();
    protocol.status = "frozen_before_admission";
    protocol.runtime.runtime_manifest_sha256 = "A".repeat(64);
    protocol.execution_context.producer_epoch = "producer-epoch:1";
    protocol.execution_context.run_id = "run_test";
    protocol.execution_context.goal_id = "goal:test";
    protocol.direct_tool.authenticated_namespace = "connected-test-client";
    protocol.direct_tool.authenticated_callable = true;
    protocol.movement_authority.authority_id = "authority:test";
    protocol.movement_authority.status = "active";
    protocol.movement_authority.expires_at = "2026-09-21T08:00:00.000Z";
    protocol.course.geometry_evidence_ref = "evidence:geometry";
    protocol.course.geometry_observed_at = "2026-09-21T07:00:00.000Z";
    protocol.course.geometry_semantic_fingerprint = `sha256:${"b".repeat(64)}`;
    protocol.course.geometry_current_for_freeze = true;
    protocol.course.course_envelope_for_player_center = { x_min: 0, x_max: 1, z_min: 0, z_max: 1, y: 65 };
    protocol.course.root_actions = [{ direction: "left", duration_ms: 100 }];
    protocol.course.root_end_postcondition = { position: { x: 0, y: 65, z: 0 }, radius: 0.5 };
    protocol.clocks.frontier_ref = "frontier:test";
    protocol.clocks.environment_tick_sequence = 100;
    protocol.clocks.monotonic_origin_id = "origin:test";
    protocol.clocks.monotonic_elapsed_ms = 1000;
    protocol.clocks.audit_at = "2026-09-21T07:00:00.000Z";
    protocol.lineage.root_plan_id = "plan:test";
    protocol.lineage.root_plan_hash = "sha256:plan";
    protocol.measurement_limits.frozen = true;
    protocol.measurement_limits.geometry_freeze_max_age_ms = 5_000;
    protocol.measurement_limits.root_max_total_ticks = 100;
    protocol.measurement_limits.decision_tick = 20;
    protocol.measurement_limits.stop_tick = 80;
    protocol.measurement_limits.monotonic_deadline_ms_after_frontier = 10000;
    protocol.measurement_limits.evidence_drain_runway_ms = 5000;
    protocol.measurement_limits.direct_user_cancel_limit_ms = 1000;
    protocol.measurement_limits.manual_takeover_release_limit_ms = 1000;

    const result = inspectNavEqProtocolFreezeReadiness(protocol);

    expect(result).toEqual({
      schema: "helix.nav_eq_protocol_freeze_readiness.v1",
      ready_to_freeze: true,
      motion_authorized: false,
      missing_live_fields: [],
      violations: [],
    });
  });

  it("rejects geometry that is stale at the explicit freeze audit", () => {
    const protocol = loadDraft();
    protocol.status = "frozen_before_admission";
    protocol.course.geometry_current_for_freeze = true;
    protocol.course.geometry_observed_at = "2026-09-21T07:00:00.000Z";
    protocol.clocks.audit_at = "2026-09-21T07:00:06.000Z";
    protocol.measurement_limits.geometry_freeze_max_age_ms = 5_000;

    const result = inspectNavEqProtocolFreezeReadiness(protocol);

    expect(result.ready_to_freeze).toBe(false);
    expect(result.violations).toContain("geometry_stale_at_freeze");
  });

  it("rejects invalid runtime hashes and impossible checkpoint ordering", () => {
    const protocol = loadDraft();
    protocol.runtime.runtime_manifest_sha256 = "not-a-sha256";
    protocol.measurement_limits.root_max_total_ticks = 100;
    protocol.measurement_limits.decision_tick = 80;
    protocol.measurement_limits.stop_tick = 70;

    const result = inspectNavEqProtocolFreezeReadiness(protocol);

    expect(result.ready_to_freeze).toBe(false);
    expect(result.violations).toContain("invalid_sha256:runtime.runtime_manifest_sha256");
    expect(result.violations).toContain("decision_tick_must_precede_stop_tick");
  });

  it("rejects an active movement lease that has already expired at freeze", () => {
    const protocol = loadDraft();
    protocol.movement_authority.status = "active";
    protocol.movement_authority.expires_at = "2026-09-21T07:00:00.000Z";
    protocol.clocks.audit_at = "2026-09-21T07:00:00.001Z";

    const result = inspectNavEqProtocolFreezeReadiness(protocol);

    expect(result.ready_to_freeze).toBe(false);
    expect(result.violations).toContain("movement_authority_not_live_at_freeze");
  });
});
