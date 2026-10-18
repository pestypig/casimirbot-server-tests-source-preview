import { describe, expect, it } from "vitest";
import type {
  HelixCapabilityLaneGoalDispatchPlan,
  HelixCapabilityLaneGoalDispatchTarget,
} from "@shared/helix-capability-lane-goal-binding";
import { buildHelixCapabilityLaneGoalDispatchAdmission } from "../goal-dispatch-admission";

const buildPlan = (
  target: HelixCapabilityLaneGoalDispatchTarget,
  input: Partial<HelixCapabilityLaneGoalDispatchPlan> = {},
): HelixCapabilityLaneGoalDispatchPlan => ({
  schema: "helix.capability_lane.goal_dispatch_plan.v1",
  target,
  status: "planned_not_dispatched",
  reason: `goal_binding_policy_plans_${target}`,
  source_report_action: target === "terminal_authority_review"
    ? "request_terminal_authority"
    : target === "manual_review"
      ? "manual_review"
      : target === "ui_badge"
        ? "surface_badge"
        : target === "none"
          ? "record_only"
          : "wake_on_salience",
  goal_binding_id: "goal-binding-admission",
  goal_id: "goal:admission",
  lane_session_id: "lane-session-admission",
  session_control_key: "lane-session-admission::docs:admission::sha256:admission::docs_chunk::es-US::es",
  lane_id: "live_translation",
  source_id: "docs:admission",
  source_hash: "sha256:admission",
  source_kind: "docs",
  source_projection_target: "docs_chunk",
  account_locale: "es-US",
  latest_chunk_id: "chunk-admission",
  latest_chunk_index: 1,
  latest_dedupe_key: "docs:admission:chunk:es",
  latest_source_event_id: "docs:admission:event",
  latest_source_event_ms: 100,
  latest_observed_at_ms: 125,
  latest_freshness_status: "fresh",
  latest_projection_target: "docs_chunk",
  target_language: "es",
  latest_cancel_requested: false,
  latest_mail_loop_wake_kind: target === "ask_wake" ? "mailbox_wake" : "none",
  permissions: {
    read: true,
    observe: true,
    act: true,
    write: false,
    shell: false,
    code_mutation: false,
  },
  evidence_ref: "ask:lane:translation:admission-obs",
  mail_loop_ref: target === "ask_wake" ? "stage-play-mail:admission" : null,
  receipt_ref: "ask:lane:translation:admission-obs:projection:receipt",
  requires_live_mail_loop: target === "ask_wake",
  requires_terminal_authority: target === "terminal_authority_review",
  side_effects_executed: false,
  wake_dispatched: false,
  badge_projected: false,
  terminal_report_emitted: false,
  terminal_authority_status: target === "terminal_authority_review"
    ? "pending_helix_terminal_authority"
    : "not_terminal_authority",
  reentry_required: true,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  ...input,
});

describe("capability lane goal dispatch admission", () => {
  it("classifies each dispatch target without allowing side effects or terminal answers", () => {
    const admissions = [
      buildHelixCapabilityLaneGoalDispatchAdmission(buildPlan("ask_wake")),
      buildHelixCapabilityLaneGoalDispatchAdmission(buildPlan("terminal_authority_review")),
      buildHelixCapabilityLaneGoalDispatchAdmission(buildPlan("ui_badge")),
      buildHelixCapabilityLaneGoalDispatchAdmission(buildPlan("manual_review")),
      buildHelixCapabilityLaneGoalDispatchAdmission(buildPlan("none")),
    ];

    expect(admissions.map((admission) => admission.status)).toEqual([
      "eligible_waiting_for_mail_loop",
      "eligible_pending_terminal_authority",
      "admitted_projection_only",
      "eligible_manual_review",
      "admitted_debug_only",
    ]);
    expect(admissions.map((admission) => admission.latest_mail_loop_wake_kind)).toEqual([
      "mailbox_wake",
      "none",
      "none",
      "none",
      "none",
    ]);
    expect(admissions.every((admission) =>
      admission.session_control_key ===
        "lane-session-admission::docs:admission::sha256:admission::docs_chunk::es-US::es"
    )).toBe(true);
    expect(admissions.every((admission) => (
      admission.blocked_reason === null &&
      admission.side_effects_allowed === false &&
      admission.side_effects_executed === false &&
      admission.wake_dispatch_allowed === false &&
      admission.badge_projection_allowed === false &&
      admission.terminal_report_allowed === false &&
      admission.reentry_required === true &&
      admission.terminal_eligible === false &&
      admission.assistant_answer === false &&
      admission.raw_content_included === false
    ))).toBe(true);
  });

  it("fails closed for missing evidence, missing mail loop refs, stopped bindings, and terminal review without pending authority", () => {
    expect(buildHelixCapabilityLaneGoalDispatchAdmission(
      buildPlan("ask_wake", { evidence_ref: null }),
    )).toMatchObject({
      status: "blocked",
      blocked_reason: "missing_evidence_ref",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(buildHelixCapabilityLaneGoalDispatchAdmission(
      buildPlan("ask_wake", { mail_loop_ref: null }),
    )).toMatchObject({
      status: "blocked",
      blocked_reason: "missing_mail_loop_ref",
    });
    expect(buildHelixCapabilityLaneGoalDispatchAdmission(
      buildPlan("none", { source_report_action: "stopped" }),
    )).toMatchObject({
      status: "blocked",
      blocked_reason: "goal_binding_stopped",
    });
    expect(buildHelixCapabilityLaneGoalDispatchAdmission(
      buildPlan("terminal_authority_review", {
        terminal_authority_status: "not_terminal_authority",
      }),
    )).toMatchObject({
      status: "blocked",
      blocked_reason: "terminal_authority_not_pending",
      requires_terminal_authority: true,
      terminal_report_allowed: false,
    });
  });
});
