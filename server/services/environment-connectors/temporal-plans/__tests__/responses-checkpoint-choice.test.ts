import { describe, expect, it } from "vitest";
import type { HelixEnvironmentCheckpointDecisionContext } from
  "@shared/helix-environment-checkpoint-decision";
import {
  extractResponsesCheckpointChoice,
  materializeResponsesCheckpointDecision,
} from "../responses-checkpoint-choice";

const choice = { disposition: "hold_safe", rationale_code: "obstacle_detected" };
const message = (text = JSON.stringify(choice)) => ({
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text }],
});
const response = (output: unknown[] = [message()]) => ({
  object: "response",
  status: "completed",
  error: null,
  incomplete_details: null,
  output,
});
const context = (): HelixEnvironmentCheckpointDecisionContext => ({
  environment_id: "environment:1",
  source_id: "source:1",
  subject_id: "subject:1",
  goal_id: "goal:1",
  goal_revision: 1,
  predecessor_plan_id: "plan:1",
  predecessor_plan_hash: `sha256:${"a".repeat(64)}`,
  checkpoint_id: "checkpoint:1",
  observation_ref: "observation:1",
  observation_revision: 1,
  affordance_revision: 1,
  producer_epoch: "epoch:1",
  authority_id: "authority:1",
  authority_revision: 1,
  monotonic_origin_id: "process:1",
  current_unit: 100,
  current_monotonic_ms: 1_000,
  maximum_proposal_horizon_units: 10,
  maximum_proposal_lifetime_ms: 500,
  interruption_pending: false,
});

describe("Responses checkpoint choice extraction", () => {
  it("accepts one completed structured message after an inert reasoning item", () => {
    expect(extractResponsesCheckpointChoice(response([
      { type: "reasoning", summary: [] }, message(),
    ]))).toEqual({ ok: true, choice });
  });

  it.each(["queued", "in_progress", "incomplete", "failed", "cancelled"])(
    "rejects a %s response even if it includes valid-looking JSON",
    (status) => {
      expect(extractResponsesCheckpointChoice({ ...response(), status })).toEqual({
        ok: false, reason: "response_not_complete",
      });
    },
  );

  it("rejects a completed response with an error or incomplete detail", () => {
    expect(extractResponsesCheckpointChoice({ ...response(), error: { code: "server_error" } }))
      .toEqual({ ok: false, reason: "response_error" });
    expect(extractResponsesCheckpointChoice({ ...response(), incomplete_details: { reason: "max_output_tokens" } }))
      .toEqual({ ok: false, reason: "response_error" });
  });

  it("rejects refusals, tool calls, and multiple messages rather than selecting one", () => {
    expect(extractResponsesCheckpointChoice(response([{
      ...message(), content: [{ type: "refusal", refusal: "no" }],
    }]))).toEqual({ ok: false, reason: "refusal" });
    expect(extractResponsesCheckpointChoice(response([
      message(), { type: "function_call", name: "move", arguments: "{}" },
    ]))).toEqual({ ok: false, reason: "unexpected_output" });
    expect(extractResponsesCheckpointChoice(response([message(), message()])))
      .toEqual({ ok: false, reason: "unexpected_output" });
  });

  it("rejects partial, oversized, invalid and extra-field choices", () => {
    expect(extractResponsesCheckpointChoice(response([{ ...message(), status: "in_progress" }])))
      .toEqual({ ok: false, reason: "unexpected_output" });
    expect(extractResponsesCheckpointChoice(response([message("x".repeat(1025))])))
      .toEqual({ ok: false, reason: "unexpected_output" });
    expect(extractResponsesCheckpointChoice(response([message("not JSON")])))
      .toEqual({ ok: false, reason: "invalid_choice" });
    expect(extractResponsesCheckpointChoice(response([message(JSON.stringify({
      ...choice, command: "move_forward",
    }))])))
      .toEqual({ ok: false, reason: "invalid_choice" });
  });

  it("does not trust a top-level output_text helper without inspected output", () => {
    expect(extractResponsesCheckpointChoice({
      ...response([]), output_text: JSON.stringify(choice),
    })).toEqual({ ok: false, reason: "unexpected_output" });
  });

  it("materializes only an exact fresh provider choice as a powerless proposal", () => {
    expect(materializeResponsesCheckpointDecision(
      response(), context(), context(), "decision:host", 5, 250,
    )).toMatchObject({
      gate: "checkpoint_preflight", accepted: true, execution_authority: false,
      proposal: {
        decision_id: "decision:host", observation_ref: "observation:1",
        evidence_refs: ["observation:1"], proposed_at_unit: 100,
        expires_at_unit: 105, disposition: "hold_safe",
        execution_authority: false, answer_authority: false,
        terminal_eligible: false,
      },
    });
  });

  it.each([
    ["observation", { observation_revision: 2 }],
    ["authority", { authority_revision: 2 }],
    ["plan", { predecessor_plan_id: "plan:2" }],
    ["affordance", { affordance_revision: 2 }],
    ["producer epoch", { producer_epoch: "epoch:2" }],
  ])("rejects a late valid-looking choice after %s changes", (_label, change) => {
    expect(materializeResponsesCheckpointDecision(
      response(), context(), { ...context(), ...change }, "decision:host", 5, 250,
    )).toMatchObject({
      gate: "checkpoint_preflight", accepted: false,
      reason: "identity_or_revision_stale", execution_authority: false,
    });
  });

  it("rejects an interrupted or expired return despite valid provider JSON", () => {
    expect(materializeResponsesCheckpointDecision(
      response(), context(), { ...context(), interruption_pending: true },
      "decision:host", 5, 250,
    )).toMatchObject({ gate: "checkpoint_preflight", accepted: false,
      reason: "interruption_pending" });
    expect(materializeResponsesCheckpointDecision(
      response(), context(), { ...context(), current_monotonic_ms: 1_251 },
      "decision:host", 5, 250,
    )).toMatchObject({ gate: "checkpoint_preflight", accepted: false,
      reason: "proposal_expired" });
  });

  it("keeps provider rejection separate from checkpoint preflight", () => {
    expect(materializeResponsesCheckpointDecision(
      { ...response(), status: "incomplete" }, context(), context(),
      "decision:host", 5, 250,
    )).toMatchObject({ gate: "responses_output", accepted: false,
      reason: "response_not_complete", execution_authority: false });
  });
});
