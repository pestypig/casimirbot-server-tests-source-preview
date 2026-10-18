import { describe, expect, it, vi } from "vitest";
import type { VerifiedHelixEnvironmentActionChoiceSource } from
  "@shared/helix-environment-action-choice";
import { buildHelixEnvironmentTemporalPlan, helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";
import { HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  type HelixEnvironmentActionObservation } from "@shared/helix-environment-action";
import { environmentConnectorSha256 } from "../../catalog";
import { invokeResponsesActionActor } from "../responses-action-actor";
import { captureStoredResponsesActionCheckpoint,
  readCapturedResponsesProgressFeedback,
  reconcileCapturedResponsesActionFeedback } from "../responses-action-checkpoint-capture";
import { assessResponsesActionFeedback } from "../responses-action-feedback";
import { reconcileResponsesActionResult,
  reconcileStoredResponsesActionResult } from "../responses-action-result-reconcile";
import { reconcileResidentResponsesActionResult } from "../responses-action-resident-result";
import { reconcileHistoricalResponsesActionFeedback } from
  "../responses-action-historical-feedback";
import { readStoredResponsesProgressFeedback } from
  "../responses-action-stored-progress";
import { parseResponsesDecisionSnapshot,
  responsesActionDecisionIdempotencyKey } from
  "../responses-action-decision-snapshot";
import { readProtectedResponsesDecisionSource } from
  "../responses-action-decision-source";

const hash = (char: string) => `sha256:${char.repeat(64)}`;
const advancePlan = buildHelixEnvironmentTemporalPlan({
  plan_id: "plan:advance", previous_plan_id: "plan:previous",
  previous_plan_hash: hash("a"),
  identity: { environment_id: "environment:one", source_id: "source:one",
    subject_id: "player:one", goal_id: "goal:one", goal_revision: 3,
    observation_revision: 4, affordance_revision: 5,
    producer_epoch: "epoch:one", authority_id: "authority:one",
    authority_revision: 6 },
  clocks: { environment: { kind: "tick", sequence: 100,
    resolution_unit: "minecraft_tick", nominal_units_per_second: 20 },
    monotonic: { origin_id: "clock:one", elapsed_ms: 1_000 },
    audit_at: "2026-10-09T11:59:50.000Z" },
  adapter_id: "minecraft.fabric_client", adapter_version: "1",
  compiler_version: "compiler:1", resident_executor_version: "native:1",
  start_node_id: "walk", maximum_total_units: 20,
  monotonic_deadline_elapsed_ms: 2_000,
  watermarks: { decision_unit: 8, stop_unit: 16,
    committed_through_unit: 20, stabilization_node_id: "success" },
  lanes: [{ lane_id: "move", priority: 1, resource_keys: ["locomotion"] }],
  effect_ceiling: {},
  nodes: [{ kind: "action", node_id: "walk", lane_id: "move",
    capability_id: "com.casimirbot.minecraft.player.walk", capability_version: "1",
    arguments: { action_kind: "walk", direction: "forward",
      duration_ms: 100, sprint: false }, required_resources: ["locomotion"],
    timing: { earliest_start_unit: 0, latest_start_unit: 4,
      maximum_duration_units: 10 }, preconditions: [],
    completion_conditions: [{ kind: "adapter_condition",
      condition_id: "minecraft.player_grounded", arguments: { expected: true } }],
    abort_guards: [], effect_budget: {}, on_success_node_id: "success",
    on_failure_node_id: "failure", on_timeout_node_id: "failure" },
    { kind: "terminal", node_id: "success", outcome: "succeeded",
      reason_code: "done" },
    { kind: "terminal", node_id: "failure", outcome: "failed",
      reason_code: "failed" }],
});
const clearSource = (): VerifiedHelixEnvironmentActionChoiceSource => ({
  context: { run_id: "run:one", reasoning_binding_id: "binding:one", binding_epoch: 2,
    environment_id: "environment:one", source_id: "source:one",
    subject_id: "player:one", goal_id: "goal:one", goal_revision: 3,
    predecessor_plan_id: "plan:previous", predecessor_plan_hash: hash("a"),
    checkpoint_id: "checkpoint:one", checkpoint_event_id: "event:one",
    checkpoint_event_hash: hash("b"), observation_ref: "observation:one",
    observation_revision: 4, affordance_revision: 5,
    producer_epoch: "epoch:one", authority_id: "authority:one",
    authority_revision: 6, monotonic_origin_id: "clock:one",
    current_unit: 100, current_monotonic_ms: 1_000,
    maximum_proposal_horizon_units: 20, maximum_proposal_lifetime_ms: 1_000,
    interruption_pending: false },
  observation_summary: "position:(0,64,0), route_clear:true, obstacle:false",
  candidates: [{ candidate_id: "advance:one", plan_id: "plan:advance",
    plan_hash: advancePlan.plan_hash, action_code: "walk_to_waypoint",
    target_ref: "waypoint:one", estimated_units: 10 }],
});
const obstacleSource = (): VerifiedHelixEnvironmentActionChoiceSource => {
  const source = clearSource();
  source.context.predecessor_plan_id = "plan:advance";
  source.context.predecessor_plan_hash = advancePlan.plan_hash;
  source.context.checkpoint_id = "checkpoint:two";
  source.context.checkpoint_event_id = "event:two";
  source.context.checkpoint_event_hash = hash("d");
  source.context.observation_ref = "observation:two";
  source.context.observation_revision = 5;
  source.context.affordance_revision = 6;
  source.context.current_unit = 106;
  source.context.current_monotonic_ms = 1_300;
  source.observation_summary = "position:(2,64,0), route_clear:false, obstacle:blocked_headroom";
  source.candidates = [{ candidate_id: "detour:one", plan_id: "plan:detour",
    plan_hash: hash("e"), action_code: "walk_to_waypoint",
    target_ref: "waypoint:detour", estimated_units: 8 }];
  return source;
};
const response = (choiceId: string, rationale: string) => new Response(JSON.stringify({
  id: `response:${choiceId}`, object: "response", status: "completed",
  error: null, incomplete_details: null,
  output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify({
      choice_id: choiceId, rationale_code: rationale }) }] }],
}), { status: 200 });
const nativeObservation = (): HelixEnvironmentActionObservation => ({
  schema: HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  action_request_ref: "request:one", workflow_ref: "workflow:one",
  action_execution_ref: "execution:one", capability_id: "sequence.execute",
  capability_version: 1, action_kind: "execute_sequence", outcome: "failed",
  summary: "A measured headroom obstacle stopped the movement segment.",
  result: { controls_released: true, automatic_replay_performed: false,
    player_motion_performed: true, player_interaction_performed: false,
    inventory_mutation_performed: false, world_mutation_performed: false },
  progress_observation_refs: ["environment_action_event:two"],
  postcondition_evidence_refs: [], evidence_ref: "environment_action_evidence:one",
  observed_at: "2026-10-09T12:00:00.000Z", provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  content_role: "environment_action_observation_not_assistant_answer",
  reentry_required: true, answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
});
const successor = () => ({ available: true as const,
  action_request_id: "request:one", previous_plan_id: "plan:advance",
  previous_plan_hash: advancePlan.plan_hash, workflow_id: "workflow:one",
  checkpoint: { event_id: "event:two", event_hash: hash("d"),
    checkpoint_id: "checkpoint:two",
    action_event_id: "environment_action_event:two" },
  observed_at: "2026-10-09T11:59:59.000Z",
});

async function fixture() {
  const firstSource = clearSource();
  const firstTransport = vi.fn(async () => response("advance:one", "route_clear"));
  const first = await invokeResponsesActionActor({ model: "fixture:model",
    hostDecisionId: "decision:one", requestedHorizonUnits: 12,
    requestedLifetimeMs: 500, loadVerifiedSource: async () => firstSource,
    providerTransport: firstTransport });
  if (first.status !== "proposed") throw new Error("first decision rejected");
  const link = { decision_id: first.proposal.decision_id,
    choice_source_hash: first.proposal.choice_source_hash,
    choice_id: first.proposal.choice_id,
    reasoning_binding_id: first.proposal.context.reasoning_binding_id,
    binding_epoch: first.proposal.context.binding_epoch,
    run_id: first.proposal.context.run_id,
    checkpoint_event_id: first.proposal.context.checkpoint_event_id,
    plan_id: first.proposal.plan_id!, plan_hash: first.proposal.plan_hash!,
    action_request_id: "request:one" };
  const result = await reconcileResponsesActionResult({ link,
    readCanonicalObservation: async () => nativeObservation() });
  return { firstSource, firstTransport, first, link, result };
}

describe("Responses native feedback to next decision", () => {
  it("links measured obstacle feedback to a materially revised powerless model choice", async () => {
    const { firstSource, firstTransport, first, link, result } = await fixture();
    expect(first.proposal.choice_id).toBe("advance:one");
    expect(firstTransport).toHaveBeenCalledTimes(1);
    expect(link.choice_source_hash).toBe(helixEnvironmentTimeSha256({
      observation_summary: firstSource.observation_summary,
      candidates: firstSource.candidates }));
    const after = obstacleSource();
    const feedback = assessResponsesActionFeedback({ link, result,
      sourceAtDecision: firstSource, successor: successor(),
      sourceAfterFeedback: after });
    expect(feedback).toMatchObject({ status: "feedback_ready",
      decision_id: "decision:one", action_request_id: "request:one",
      result_evidence_ref: "environment_action_evidence:one",
      checkpoint_event_id: "event:two", observation_ref: "observation:two",
      execution_authority: false, goal_progress_verified: false });
    if (feedback.status !== "feedback_ready") throw new Error("feedback blocked");
    const nextTransport = vi.fn(async (menu: { observation_summary: string }) => {
      expect(menu.observation_summary).toContain("blocked_headroom");
      return response("detour:one", "headroom_blocked");
    });
    const next = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: "decision:two", requestedHorizonUnits: 8,
      requestedLifetimeMs: 400, loadVerifiedSource: async () => feedback.source,
      providerTransport: nextTransport as never });
    expect(nextTransport).toHaveBeenCalledTimes(1);
    expect(next).toMatchObject({ status: "proposed", execution_authority: false,
      proposal: { decision_id: "decision:two", choice_id: "detour:one",
        plan_id: "plan:detour", target_ref: "waypoint:detour",
        execution_authority: false } });
    expect(next).not.toHaveProperty("action_request_id");
  });

  it("blocks unresolved native outcome and wrong exact-request checkpoint", async () => {
    const { firstSource, link, result } = await fixture();
    const input = { link, result, sourceAtDecision: firstSource,
      successor: successor(), sourceAfterFeedback: obstacleSource() };
    expect(assessResponsesActionFeedback({ ...input,
      result: { status: "pending", action_request_id: "request:one",
        native_result_verified: false, automatic_retry_allowed: false } }))
      .toMatchObject({ status: "blocked", reason: "native_result_unresolved" });
    expect(assessResponsesActionFeedback({ ...input,
      successor: { ...successor(), action_request_id: "request:other" } }))
      .toMatchObject({ status: "blocked", reason: "checkpoint_action_mismatch" });
    expect(assessResponsesActionFeedback({ ...input,
      successor: { ...successor(), workflow_id: "workflow:other" } }))
      .toMatchObject({ status: "blocked", reason: "checkpoint_action_mismatch" });
    expect(assessResponsesActionFeedback({ ...input,
      successor: { ...successor(), checkpoint: { ...successor().checkpoint,
        action_event_id: "environment_action_event:unrelated" } } }))
      .toMatchObject({ status: "blocked", reason: "checkpoint_action_mismatch" });
    if (result.status !== "reconciled") throw new Error("fixture result unavailable");
    expect(assessResponsesActionFeedback({ ...input,
      result: { ...result, outcome: "manual_override" } }))
      .toMatchObject({ status: "blocked", reason: "feedback_interrupted" });
  });

  it("blocks stale revisions, altered authority and manual takeover", async () => {
    const { firstSource, link, result } = await fixture();
    const check = (after: VerifiedHelixEnvironmentActionChoiceSource) =>
      assessResponsesActionFeedback({ link, result,
        sourceAtDecision: firstSource, successor: successor(),
        sourceAfterFeedback: after });
    const stale = obstacleSource(); stale.context.observation_revision = 4;
    expect(check(stale)).toMatchObject({ status: "blocked", reason: "feedback_stale" });
    const newEpoch = obstacleSource(); newEpoch.context.producer_epoch = "epoch:other";
    expect(check(newEpoch)).toMatchObject({ status: "blocked", reason: "feedback_stale" });
    const revoked = obstacleSource(); revoked.context.authority_revision = 7;
    expect(check(revoked)).toMatchObject({ status: "blocked", reason: "feedback_stale" });
    const takeover = obstacleSource(); takeover.context.interruption_pending = true;
    expect(check(takeover)).toMatchObject({ status: "blocked", reason: "feedback_interrupted" });
  });

  it("rejects a late second choice after epoch change and spends nothing after lease loss", async () => {
    const { firstSource, link, result } = await fixture();
    const feedback = assessResponsesActionFeedback({ link, result,
      sourceAtDecision: firstSource, successor: successor(),
      sourceAfterFeedback: obstacleSource() });
    if (feedback.status !== "feedback_ready") throw new Error("feedback blocked");
    let reads = 0;
    const transport = vi.fn(async () => response("detour:one", "headroom_blocked"));
    const late = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: "decision:late", requestedHorizonUnits: 8,
      requestedLifetimeMs: 400,
      loadVerifiedSource: async () => {
        const current = structuredClone(feedback.source);
        if (++reads === 2) current.context.producer_epoch = "epoch:restarted";
        return current;
      }, providerTransport: transport });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(late).toMatchObject({ status: "rejected", reason: "source_changed",
      execution_authority: false });
    const expiredTransport = vi.fn(async () => response("detour:one", "headroom_blocked"));
    const expired = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: "decision:expired", requestedHorizonUnits: 8,
      requestedLifetimeMs: 400, loadVerifiedSource: async () => null,
      providerTransport: expiredTransport });
    expect(expired).toMatchObject({ status: "unavailable",
      reason: "source_unavailable", execution_authority: false });
    expect(expiredTransport).not.toHaveBeenCalled();
  });
});

describe("protected in-motion checkpoint capture", () => {
  const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "client:one",
    clientSessionRef: "session:one", clientContinuationRef: "task:one",
    bindingId: "binding:one", bindingEpoch: 2,
    helixConversationId: "chat:one", missionId: null, runId: "run:one" };
  const readDecisionSource = vi.fn(async () => ({
    status: "decision_source_verified" as const, source: clearSource(),
    historical_evidence_only: true as const, execution_authority: false as const,
    automatic_replay_allowed: false as const }));
  const capture = async (options: {
    source?: VerifiedHelixEnvironmentActionChoiceSource | null;
    successors?: ReturnType<typeof successor>[];
    verify?: () => Promise<unknown>;
    signal?: AbortSignal;
  } = {}) => {
    const { firstSource, link } = await fixture();
    const readSuccessor = vi.fn()
      .mockResolvedValueOnce(options.successors?.[0] ?? successor())
      .mockResolvedValueOnce(options.successors?.[1] ?? successor());
    const verification = vi.fn(options.verify ?? (async () => ({})));
    const source = options.source === undefined ? obstacleSource() : options.source;
    const receipt = await captureStoredResponsesActionCheckpoint({
      link, binding, sourceAtDecision: firstSource, context: {} as never,
      loadVerifiedSource: async () => source, signal: options.signal,
    }, { verifyTaskAssociation: verification as never },
    { readSuccessor: readSuccessor as never });
    return { receipt, link, readSuccessor, verification };
  };

  it("uses measured in-motion progress for the next choice, then audits the terminal result", async () => {
    const { receipt, link } = await capture();
    if (receipt.status !== "captured") throw new Error("capture unavailable");
    const store = { verifyTaskAssociation: vi.fn(async () => ({})) };
    const readCanonicalObservation = vi.fn(async () => null);
    const readResult = vi.fn((input: Parameters<typeof reconcileStoredResponsesActionResult>[0],
      verifier: Parameters<typeof reconcileStoredResponsesActionResult>[1]) =>
      reconcileStoredResponsesActionResult(input, verifier, {
        readCanonicalObservation }));
    const progress = await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => obstacleSource() }, store as never,
    { readResult, readDecisionSource });
    expect(progress).toMatchObject({ status: "progress_ready",
      decision_id: "decision:one", action_request_id: "request:one",
      checkpoint_event_id: "event:two", observation_ref: "observation:two",
      native_result_verified: false, execution_authority: false,
      goal_progress_verified: false, automatic_retry_allowed: false });
    expect(readResult).toHaveBeenCalledTimes(2);
    expect(readCanonicalObservation).toHaveBeenCalledTimes(2);
    if (progress.status !== "progress_ready") throw new Error("progress unavailable");
    const transport = vi.fn(async (menu: { observation_summary: string }) => {
      expect(menu.observation_summary).toContain("blocked_headroom");
      return response("detour:one", "headroom_blocked");
    });
    const second = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: "decision:in-motion-next", requestedHorizonUnits: 8,
      requestedLifetimeMs: 400, loadVerifiedSource: async () => progress.source,
      providerTransport: transport as never });
    expect(second).toMatchObject({ status: "proposed", execution_authority: false,
      proposal: { choice_id: "detour:one", plan_id: "plan:detour" } });
    expect(second).not.toHaveProperty("action_request_id");
    const terminal = await reconcileStoredResponsesActionResult({ link, binding },
      store as never, { readCanonicalObservation: async () => nativeObservation() });
    expect(terminal).toMatchObject({ status: "reconciled",
      action_request_id: "request:one", native_result_verified: true,
      goal_progress_verified: false, automatic_retry_allowed: false });
  });

  it("withholds in-motion choice on a settled result, source drift or lost capture", async () => {
    const { receipt } = await capture();
    if (receipt.status !== "captured") throw new Error("capture unavailable");
    const store = { verifyTaskAssociation: vi.fn(async () => ({})) };
    const pending = { status: "pending" as const, action_request_id: "request:one",
      native_result_verified: false as const, automatic_retry_allowed: false as const };
    const settled = await reconcileResponsesActionResult({
      link: (await fixture()).link,
      readCanonicalObservation: async () => nativeObservation() });
    const readResult = vi.fn().mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(settled);
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => obstacleSource() }, store as never,
    { readResult, readDecisionSource })).toMatchObject({ status: "blocked",
      reason: "native_result_not_pending", execution_authority: false,
      automatic_retry_allowed: false });
    expect(readResult).toHaveBeenCalledTimes(2);
    const unknown = { status: "unresolved" as const, action_request_id: "request:one",
      evidence_ref: "evidence:unknown", outcome: "action_outcome_unknown" as const,
      native_result_verified: false as const, automatic_retry_allowed: false as const };
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => obstacleSource() }, store as never,
    { readResult: vi.fn(async () => unknown), readDecisionSource }))
      .toMatchObject({ status: "blocked", reason: "native_result_not_pending",
        automatic_retry_allowed: false });
    const wrongRequest = { ...pending, action_request_id: "request:other" };
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => obstacleSource() }, store as never,
    { readResult: vi.fn(async () => wrongRequest), readDecisionSource }))
      .toMatchObject({ status: "blocked", reason: "native_result_not_pending",
        automatic_retry_allowed: false });
    const changed = obstacleSource();
    changed.context.authority_revision += 1;
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => changed }, store as never,
    { readResult: vi.fn(async () => pending), readDecisionSource }))
      .toMatchObject({ status: "blocked",
      reason: "feedback_stale", automatic_retry_allowed: false });
    const takeover = obstacleSource();
    takeover.context.interruption_pending = true;
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => takeover }, store as never,
    { readResult: vi.fn(async () => pending), readDecisionSource }))
      .toMatchObject({ status: "blocked", reason: "feedback_stale",
        automatic_retry_allowed: false });
    expect(await readCapturedResponsesProgressFeedback({
      capture: JSON.parse(JSON.stringify(receipt)), binding,
      loadVerifiedSource: async () => obstacleSource() }, store as never,
    { readResult: vi.fn(async () => pending), readDecisionSource }))
      .toMatchObject({ status: "blocked",
      reason: "capture_unavailable", automatic_retry_allowed: false });
    const wrongDecision = clearSource();
    wrongDecision.context.reasoning_binding_id = "binding:other";
    const noRead = vi.fn(async () => pending);
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => obstacleSource() }, store as never,
    { readResult: noRead, readDecisionSource: vi.fn(async () => ({
      status: "decision_source_verified", source: wrongDecision })) as never }))
      .toMatchObject({ status: "blocked", reason: "decision_source_mismatch",
        automatic_retry_allowed: false });
    expect(noRead).not.toHaveBeenCalled();
    const noLeaseSource = vi.fn(async () => null);
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: noLeaseSource }, store as never,
    { readResult: vi.fn(async () => pending), readDecisionSource }))
      .toMatchObject({ status: "blocked", reason: "source_unavailable",
        automatic_retry_allowed: false });
    expect(noLeaseSource).toHaveBeenCalledTimes(1);
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => obstacleSource() },
    { verifyTaskAssociation: vi.fn(async () => { throw new Error("revoked"); }) } as never,
    { readResult: vi.fn(async () => pending), readDecisionSource }))
      .toMatchObject({ status: "blocked", reason: "binding_mismatch",
        automatic_retry_allowed: false });
    const abort = new AbortController();
    const afterCancelSource = vi.fn(async () => obstacleSource());
    expect(await readCapturedResponsesProgressFeedback({ capture: receipt,
      binding, signal: abort.signal, loadVerifiedSource: afterCancelSource },
    store as never, { readResult: vi.fn(async () => {
      abort.abort(); return pending;
    }), readDecisionSource })).toMatchObject({ status: "blocked",
      reason: "capture_cancelled", automatic_retry_allowed: false });
    expect(afterCancelSource).not.toHaveBeenCalled();
  });

  it("captures the exact running event and audits its eventual protected result", async () => {
    const { receipt, readSuccessor } = await capture();
    expect(receipt).toMatchObject({ status: "captured", decision_id: "decision:one",
      action_request_id: "request:one", checkpoint_event_id: "event:two",
      action_event_id: "environment_action_event:two",
      execution_authority: false });
    expect(readSuccessor).toHaveBeenCalledTimes(2);
    if (receipt.status !== "captured") throw new Error("capture unavailable");
    const resultRead = vi.fn(async () => nativeObservation());
    const feedback = await reconcileCapturedResponsesActionFeedback({
      capture: receipt, binding, loadVerifiedSource: async () => obstacleSource(),
    }, { verifyTaskAssociation: vi.fn(async () => ({})) as never },
    { readCanonicalObservation: resultRead });
    expect(resultRead).toHaveBeenCalledTimes(1);
    expect(resultRead).toHaveBeenCalledWith("request:one");
    expect(feedback).toMatchObject({ status: "feedback_ready",
      action_request_id: "request:one", checkpoint_event_id: "event:two",
      observation_ref: "observation:two", execution_authority: false,
      goal_progress_verified: false });
  });

  it("reconciles a temporal child through the root result and native measured event", async () => {
    const { receipt } = await capture();
    if (receipt.status !== "captured") throw new Error("capture unavailable");
    const root = { ...nativeObservation(), action_request_ref: "request:root" };
    const measured = { schema: "helix.environment_action.workflow_event.v1",
      event_id: "environment_action_event:two", action_request_id: "request:root",
      workflow_id: "workflow:one", sequence: 7,
      event_type: "workflow.progress", workflow_state: "running",
      progress_fraction: 0.5, summary: "Headroom obstacle measured",
      control_engine: "native_fabric", measurements: {
        sequence_id: "sequence:advance", checkpoint_settlements: [] },
      evidence_refs: [], manual_override_detected: false,
      controls_released: false, created_at: "2026-10-09T11:59:59.000Z",
      content_role: "environment_action_event_not_assistant_answer",
      answer_authority: false, assistant_answer: false,
      terminal_eligible: false, raw_content_included: false };
    let childDeliveryStatus = "running";
    const readCanonicalObservation = vi.fn(async () => null);
    const readResidentResult = vi.fn((input: Parameters<typeof reconcileResidentResponsesActionResult>[0],
      store: Parameters<typeof reconcileResidentResponsesActionResult>[1]) =>
      reconcileResidentResponsesActionResult(input, store, {
        readChildLineage: async () => ({
          action_request_id: "request:one", resident_action_request_id: "request:root",
          plan_id: "plan:advance", plan_hash: advancePlan.plan_hash, run_id: "run:one",
          resident_workflow_id: "workflow:one",
          reasoning_binding_id: "binding:one", reasoning_binding_epoch: 2,
          client_continuation_ref: "task:one",
          admitted_at: "2026-10-09T11:59:50.000Z",
          producer_epoch: "epoch:one", native_plan_id: "sequence:advance",
          recorded_status: childDeliveryStatus, resident_recorded_status: "failed" }),
        readRootObservation: async () => root,
        readResidentEvents: async () => [{ event_id: measured.event_id,
          event_payload: measured, event_hash: environmentConnectorSha256(measured),
          producer_epoch_ref: "epoch:one" }],
      }));
    const loadVerifiedSource = vi.fn(async () => obstacleSource());
    const unresolved = await reconcileCapturedResponsesActionFeedback({ capture: receipt,
      binding, loadVerifiedSource },
    { verifyTaskAssociation: vi.fn(async () => ({})) as never },
    { readCanonicalObservation, readResidentResult });
    expect(unresolved).toMatchObject({ status: "blocked",
      reason: "native_result_unresolved", execution_authority: false,
      goal_progress_verified: false });
    expect(loadVerifiedSource).not.toHaveBeenCalled();
    childDeliveryStatus = "failed";
    const feedback = await reconcileCapturedResponsesActionFeedback({ capture: receipt,
      binding, loadVerifiedSource },
    { verifyTaskAssociation: vi.fn(async () => ({})) as never },
    { readCanonicalObservation, readResidentResult });
    expect(readCanonicalObservation).not.toHaveBeenCalled();
    expect(readResidentResult).toHaveBeenCalledTimes(2);
    expect(loadVerifiedSource).toHaveBeenCalledTimes(1);
    expect(feedback).toMatchObject({ status: "feedback_ready",
      action_request_id: "request:one", checkpoint_event_id: "event:two",
      observation_ref: "observation:two", execution_authority: false,
      goal_progress_verified: false });
  });

  it("rejects a changed checkpoint during capture and a manual takeover", async () => {
    const changed = { ...successor(), checkpoint: { ...successor().checkpoint,
      action_event_id: "environment_action_event:other" } };
    expect((await capture({ successors: [successor(), changed] })).receipt)
      .toMatchObject({ status: "blocked", reason: "successor_unavailable" });
    const takeover = obstacleSource(); takeover.context.interruption_pending = true;
    expect((await capture({ source: takeover })).receipt)
      .toMatchObject({ status: "blocked", reason: "feedback_stale" });
  });

  it("fails closed after a restart-like copy, source loss, or binding revocation", async () => {
    const { receipt } = await capture();
    if (receipt.status !== "captured") throw new Error("capture unavailable");
    const reader = vi.fn(async () => nativeObservation());
    const copy = JSON.parse(JSON.stringify(receipt));
    expect(await reconcileCapturedResponsesActionFeedback({ capture: copy, binding,
      loadVerifiedSource: async () => obstacleSource() },
    { verifyTaskAssociation: vi.fn(async () => ({})) as never },
    { readCanonicalObservation: reader }))
      .toMatchObject({ status: "blocked", reason: "capture_unavailable" });
    expect(reader).not.toHaveBeenCalled();
    expect(await reconcileCapturedResponsesActionFeedback({ capture: receipt, binding,
      loadVerifiedSource: async () => null },
    { verifyTaskAssociation: vi.fn(async () => ({})) as never },
    { readCanonicalObservation: reader }))
      .toMatchObject({ status: "blocked", reason: "source_unavailable" });
    expect(await reconcileCapturedResponsesActionFeedback({ capture: receipt, binding,
      loadVerifiedSource: async () => obstacleSource() },
    { verifyTaskAssociation: vi.fn(async () => { throw new Error("revoked"); }) as never },
    { readCanonicalObservation: reader }))
      .toMatchObject({ status: "blocked", reason: "binding_mismatch" });
  });

  it("does not turn an unknown native result or a changed source into a new choice", async () => {
    const { receipt } = await capture();
    if (receipt.status !== "captured") throw new Error("capture unavailable");
    const unknown = { ...nativeObservation(), outcome: "action_outcome_unknown" as const };
    const verifyTaskAssociation = vi.fn(async () => ({}));
    const readCanonicalObservation = vi.fn(async () => unknown);
    const unresolved = await reconcileCapturedResponsesActionFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => obstacleSource() },
    { verifyTaskAssociation: verifyTaskAssociation as never },
    { readCanonicalObservation });
    expect(unresolved).toMatchObject({ status: "blocked",
      reason: "native_result_unresolved", execution_authority: false });
    expect(readCanonicalObservation).toHaveBeenCalledTimes(1);
    const changed = obstacleSource(); changed.context.producer_epoch = "epoch:restarted";
    const stale = await reconcileCapturedResponsesActionFeedback({ capture: receipt,
      binding, loadVerifiedSource: async () => changed },
    { verifyTaskAssociation: verifyTaskAssociation as never },
    { readCanonicalObservation: async () => nativeObservation() });
    expect(stale).toMatchObject({ status: "blocked", reason: "feedback_stale",
      execution_authority: false, automatic_retry_allowed: false });
  });

  it("cancels before any checkpoint read or provider call", async () => {
    const abort = new AbortController(); abort.abort();
    const { receipt, readSuccessor, verification } = await capture({ signal: abort.signal });
    expect(receipt).toMatchObject({ status: "blocked", reason: "capture_cancelled",
      automatic_retry_allowed: false });
    expect(readSuccessor).not.toHaveBeenCalled();
    expect(verification).not.toHaveBeenCalled();
  });

  it("does not publish a capture if cancellation arrives during final binding verification", async () => {
    const abort = new AbortController();
    let checks = 0;
    const { receipt, readSuccessor } = await capture({ signal: abort.signal,
      verify: async () => { if (++checks === 2) abort.abort(); return {}; } });
    expect(readSuccessor).toHaveBeenCalledTimes(2);
    expect(receipt).toMatchObject({ status: "blocked", reason: "capture_cancelled",
      automatic_retry_allowed: false });
  });
});

describe("historical checkpoint and current-source composition", () => {
  const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "client:one",
    clientSessionRef: "session:one", clientContinuationRef: "task:one",
    bindingId: "binding:one", bindingEpoch: 2,
    helixConversationId: "chat:one", missionId: null, runId: "run:one" };
  const historical = () => ({ status: "historical_checkpoint_verified" as const,
    action_request_id: "request:one", resident_action_request_id: "request:one",
    workflow_id: "workflow:one", plan_id: "plan:advance",
    plan_hash: advancePlan.plan_hash, checkpoint_id: "checkpoint:two",
    checkpoint_event_id: "event:two", checkpoint_event_hash: hash("d"),
    action_event_id: "environment_action_event:two",
    action_event_hash: hash("e"), observed_at: "2026-10-09T11:59:59.000Z",
    world_tick_index: 106, historical_evidence_only: true as const,
    current_admission_authority: false as const,
    execution_authority: false as const, automatic_replay_allowed: false as const });

  it("re-enters a stored measured checkpoint while the exact result remains pending", async () => {
    const { firstSource, link } = await fixture();
    const readCurrent = vi.fn(async () => obstacleSource());
    const readResult = vi.fn(async () => ({ status: "pending" as const,
      action_request_id: link.action_request_id, native_result_verified: false as const,
      automatic_retry_allowed: false as const }));
    const readDecisionSource = vi.fn(async () => ({ status: "decision_source_verified" as const,
      source: firstSource, historical_evidence_only: true as const,
      execution_authority: false as const, automatic_replay_allowed: false as const }));
    const readCheckpoint = vi.fn(async () => historical());
    const store = { verifyTaskAssociation: vi.fn(async () => ({})) };
    const progress = await readStoredResponsesProgressFeedback({ link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: readCurrent }, store as never, {
      readDecisionSource: readDecisionSource as never,
      readCheckpoint: readCheckpoint as never, readResult: readResult as never });
    expect(progress).toMatchObject({ status: "progress_ready",
      decision_id: link.decision_id, action_request_id: link.action_request_id,
      checkpoint_event_id: "event:two", observation_ref: "observation:two",
      source: obstacleSource(), native_result_verified: false,
      goal_progress_verified: false, execution_authority: false,
      automatic_retry_allowed: false });
    expect(readDecisionSource).toHaveBeenCalledWith({ link, binding,
      signal: undefined }, store);
    expect(readCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      link, binding, checkpointEventId: "event:two", checkpointId: "checkpoint:two",
    }), store);
    expect(readResult).toHaveBeenCalledTimes(2);
    expect(readCurrent).toHaveBeenCalledTimes(1);
    expect(store.verifyTaskAssociation).toHaveBeenCalledTimes(2);
  });

  it("blocks missing history, stale identity, unknown outcome and settlement races", async () => {
    const { firstSource, link } = await fixture();
    const store = { verifyTaskAssociation: vi.fn(async () => ({})) };
    const base = { link, binding, checkpointEventId: "event:two",
      checkpointId: "checkpoint:two" };
    const decision = vi.fn(async () => ({ status: "decision_source_verified" as const,
      source: firstSource, historical_evidence_only: true as const,
      execution_authority: false as const, automatic_replay_allowed: false as const }));
    const history = vi.fn(async () => historical());
    const pending = { status: "pending" as const,
      action_request_id: link.action_request_id, native_result_verified: false as const,
      automatic_retry_allowed: false as const };
    const result = vi.fn(async () => pending);
    const current = vi.fn(async () => obstacleSource());
    const deps = { readDecisionSource: decision as never,
      readCheckpoint: history as never, readResult: result as never };
    const read = (overrides: Partial<typeof base> & {
      loadVerifiedCurrentSource?: () => Promise<VerifiedHelixEnvironmentActionChoiceSource | null>
    } = {},
      readers = deps) => readStoredResponsesProgressFeedback({ ...base,
        loadVerifiedCurrentSource: current, ...overrides }, store as never, readers);
    expect(await read({}, { ...deps, readCheckpoint: vi.fn(async () => ({
      status: "blocked", reason: "history_missing", action_request_id: link.action_request_id,
      current_admission_authority: false, execution_authority: false,
      automatic_replay_allowed: false })) as never })).toMatchObject({
      status: "blocked", reason: "checkpoint_unavailable",
      automatic_retry_allowed: false });
    expect(current).not.toHaveBeenCalled();
    expect(result).not.toHaveBeenCalled();
    expect(await read({}, { ...deps, readResult: vi.fn(async () => ({
      status: "unresolved", action_request_id: link.action_request_id,
      evidence_ref: "evidence:unknown", outcome: "action_outcome_unknown",
      native_result_verified: false, automatic_retry_allowed: false })) as never }))
      .toMatchObject({ status: "blocked", reason: "native_result_not_pending" });
    expect(current).not.toHaveBeenCalled();
    // A direct root request may omit resident_action_request_id, but a
    // supplied resident ID must still match the protected checkpoint root.
    expect(await read({}, { ...deps, readResult: vi.fn(async () => ({
      ...pending, resident_action_request_id: "request:other" })) as never }))
      .toMatchObject({ status: "blocked", reason: "native_result_not_pending",
        automatic_retry_allowed: false });
    expect(current).not.toHaveBeenCalled();
    const drifted = obstacleSource(); drifted.context.producer_epoch = "epoch:other";
    expect(await read({ loadVerifiedCurrentSource: async () => drifted }))
      .toMatchObject({ status: "blocked", reason: "feedback_stale" });
    const manual = obstacleSource(); manual.context.interruption_pending = true;
    expect(await read({ loadVerifiedCurrentSource: async () => manual }))
      .toMatchObject({ status: "blocked", reason: "feedback_stale",
        automatic_retry_allowed: false });
    let resultReads = 0;
    const settlingResult = vi.fn(async () => ++resultReads === 1 ? pending : {
      status: "unresolved" as const, action_request_id: link.action_request_id,
      evidence_ref: "evidence:unknown", outcome: "action_outcome_unknown" as const,
      native_result_verified: false as const, automatic_retry_allowed: false as const });
    expect(await read({}, { ...deps, readResult: settlingResult as never }))
      .toMatchObject({ status: "blocked", reason: "native_result_not_pending" });
    expect(settlingResult).toHaveBeenCalledTimes(2);
    expect(await read({ loadVerifiedCurrentSource: async () => null }))
      .toMatchObject({ status: "blocked", reason: "source_unavailable" });
    expect(await read({ checkpointEventId: "event:other" }))
      .toMatchObject({ status: "blocked", reason: "checkpoint_unavailable" });
    const abort = new AbortController(); abort.abort();
    const canceledDecisionRead = vi.fn();
    expect(await readStoredResponsesProgressFeedback({ ...base,
      loadVerifiedCurrentSource: current, signal: abort.signal }, store as never, {
      ...deps, readDecisionSource: canceledDecisionRead as never }))
      .toMatchObject({ status: "blocked", reason: "read_cancelled",
        automatic_retry_allowed: false });
    expect(canceledDecisionRead).not.toHaveBeenCalled();
  });

  it("composes historical proof only with an injected current authority read", async () => {
    const { firstSource, link, result } = await fixture();
    const readCurrent = vi.fn(async () => obstacleSource());
    const verifyTaskAssociation = vi.fn(async () => ({}));
    const feedback = await reconcileHistoricalResponsesActionFeedback({
      link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: readCurrent },
    { verifyTaskAssociation } as never, {
      readHistoricalCheckpoint: vi.fn(async () => historical()) as never,
      readResult: vi.fn(async () => result) as never,
      readDecisionSource: vi.fn(async () => ({ status: "decision_source_verified",
        source: firstSource, historical_evidence_only: true,
        execution_authority: false, automatic_replay_allowed: false })) as never });
    expect(feedback).toMatchObject({ status: "feedback_ready",
      action_request_id: "request:one", checkpoint_event_id: "event:two",
      execution_authority: false, goal_progress_verified: false });
    expect(readCurrent).toHaveBeenCalledTimes(1);
    expect(verifyTaskAssociation).toHaveBeenCalledTimes(1);
  });

  it("joins a child checkpoint to the same resident root as the broker result", async () => {
    const { firstSource, link, result } = await fixture();
    const readCurrent = vi.fn(async () => obstacleSource());
    const feedback = await reconcileHistoricalResponsesActionFeedback({
      link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: readCurrent },
    { verifyTaskAssociation: vi.fn(async () => ({})) } as never, {
      readHistoricalCheckpoint: vi.fn(async () => ({ ...historical(),
        resident_action_request_id: "request:root" })) as never,
      readResult: vi.fn(async () => ({ ...result,
        resident_action_request_id: "request:root" })) as never,
      readDecisionSource: vi.fn(async () => ({ status: "decision_source_verified",
        source: firstSource, historical_evidence_only: true,
        execution_authority: false, automatic_replay_allowed: false })) as never,
    });
    expect(feedback).toMatchObject({ status: "feedback_ready",
      action_request_id: "request:one", execution_authority: false,
      goal_progress_verified: false });
    expect(readCurrent).toHaveBeenCalledTimes(1);
  });

  it("never turns missing history, unknown result or lost lease into a choice", async () => {
    const { firstSource, link, result } = await fixture();
    const readCurrent = vi.fn(async () => obstacleSource());
    const store = { verifyTaskAssociation: vi.fn(async () => ({})) };
    const base = { link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: readCurrent };
    const readDecisionSource = vi.fn(async () => ({ status: "decision_source_verified",
      source: firstSource, historical_evidence_only: true,
      execution_authority: false, automatic_replay_allowed: false })) as never;
    expect(await reconcileHistoricalResponsesActionFeedback(base, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => ({ status: "blocked",
        reason: "history_missing", action_request_id: "request:one",
        current_admission_authority: false, execution_authority: false,
        automatic_replay_allowed: false })) as never,
      readResult: vi.fn() as never, readDecisionSource,
    })).toMatchObject({ status: "blocked",
      reason: "historical_checkpoint_unavailable", automatic_retry_allowed: false });
    expect(readCurrent).not.toHaveBeenCalled();
    const unknown = { status: "pending", action_request_id: "request:one",
      native_result_verified: false, automatic_retry_allowed: false };
    expect(await reconcileHistoricalResponsesActionFeedback(base, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => historical()) as never,
      readResult: vi.fn(async () => unknown) as never,
      readDecisionSource,
    })).toMatchObject({ status: "blocked", reason: "native_result_unresolved",
      automatic_retry_allowed: false });
    expect(readDecisionSource).not.toHaveBeenCalled();
    expect(await reconcileHistoricalResponsesActionFeedback(base, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => historical()) as never,
      readResult: vi.fn(async () => ({ ...result,
        outcome: "manual_override" })) as never,
      readDecisionSource,
    })).toMatchObject({ status: "blocked", reason: "feedback_interrupted",
      automatic_retry_allowed: false });
    expect(readDecisionSource).not.toHaveBeenCalled();
    expect(readCurrent).not.toHaveBeenCalled();
    expect(await reconcileHistoricalResponsesActionFeedback(base, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => ({ ...historical(),
        resident_action_request_id: "request:other-root" })) as never,
      readResult: vi.fn(async () => result) as never,
      readDecisionSource,
    })).toMatchObject({ status: "blocked", reason: "result_root_mismatch",
      automatic_retry_allowed: false });
    expect(readDecisionSource).not.toHaveBeenCalled();
    expect(readCurrent).not.toHaveBeenCalled();
    const cancelled = new AbortController();
    expect(await reconcileHistoricalResponsesActionFeedback({ ...base,
      signal: cancelled.signal }, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => historical()) as never,
      readResult: vi.fn(async () => { cancelled.abort(); return unknown; }) as never,
      readDecisionSource,
    })).toMatchObject({ status: "blocked", reason: "read_cancelled",
      automatic_retry_allowed: false });
    expect(readDecisionSource).not.toHaveBeenCalled();
    expect(await reconcileHistoricalResponsesActionFeedback(base, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => historical()) as never,
      readResult: vi.fn(async () => result) as never,
      readDecisionSource: vi.fn(async () => ({ status: "blocked",
        reason: "snapshot_missing", execution_authority: false,
        automatic_replay_allowed: false })) as never,
    })).toMatchObject({ status: "blocked",
      reason: "decision_source_unavailable", automatic_retry_allowed: false });
    const revoked = obstacleSource(); revoked.context.authority_revision = 7;
    expect(await reconcileHistoricalResponsesActionFeedback({ ...base,
      loadVerifiedCurrentSource: async () => revoked }, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => historical()) as never,
      readResult: vi.fn(async () => result) as never,
      readDecisionSource,
    })).toMatchObject({ status: "blocked", reason: "feedback_stale" });
    const noLease = vi.fn(async () => null);
    expect(await reconcileHistoricalResponsesActionFeedback({ ...base,
      loadVerifiedCurrentSource: noLease }, store as never, {
      readHistoricalCheckpoint: vi.fn(async () => historical()) as never,
      readResult: vi.fn(async () => result) as never,
      readDecisionSource,
    })).toMatchObject({ status: "blocked", reason: "source_unavailable",
      automatic_retry_allowed: false });
  });
});

describe("atomic decision-source recovery", () => {
  const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "client:one",
    clientSessionRef: "session:one", clientContinuationRef: "task:one",
    bindingId: "binding:one", bindingEpoch: 2,
    helixConversationId: "chat:one", missionId: null, runId: "run:one" };

  it("recovers only the exact hash-verified admission snapshot", async () => {
    const { firstSource, first, link } = await fixture();
    if (first.status !== "proposed") throw new Error("first decision rejected");
    const snapshot = parseResponsesDecisionSnapshot({
      proposal: first.proposal, source: firstSource });
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("snapshot invalid");
    const row = { plan_id: link.plan_id, plan_hash: link.plan_hash,
      reasoning_binding_id: binding.bindingId,
      reasoning_binding_epoch: binding.bindingEpoch,
      client_continuation_ref: binding.clientContinuationRef,
      checkpoint_association: {
        event_id: first.proposal.context.checkpoint_event_id,
        event_hash: first.proposal.context.checkpoint_event_hash,
        checkpoint_id: first.proposal.context.checkpoint_id,
        plan_id: first.proposal.context.predecessor_plan_id,
        plan_hash: first.proposal.context.predecessor_plan_hash,
      },
      responses_decision_snapshot: snapshot.snapshot,
      responses_decision_snapshot_hash: snapshot.hash,
      request_payload: { action_request_id: link.action_request_id,
        provider_execution_id: link.decision_id, run_id: link.run_id,
        idempotency_key: responsesActionDecisionIdempotencyKey({
          decisionId: link.decision_id, bindingId: link.reasoning_binding_id,
          bindingEpoch: link.binding_epoch }),
        temporal_plan: advancePlan,
        environment_binding_id: firstSource.context.environment_id,
        source_id: firstSource.context.source_id,
        subject_binding_id: firstSource.context.subject_id,
        action_authority_id: firstSource.context.authority_id } };
    const readRow = vi.fn(async () => row);
    const store = { verifyTaskAssociation: vi.fn(async () => ({})) };
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, readRow)).toMatchObject({ status: "decision_source_verified",
        source: firstSource, execution_authority: false,
        automatic_replay_allowed: false });
    expect(readRow).toHaveBeenCalledWith(link.action_request_id);
    expect(store.verifyTaskAssociation).toHaveBeenCalledTimes(2);
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, async () => ({ ...row,
        responses_decision_snapshot_hash: hash("f") })))
      .toMatchObject({ status: "blocked", reason: "snapshot_invalid" });
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, async () => ({ ...row,
        checkpoint_association: { ...row.checkpoint_association,
          event_hash: hash("f") } })))
      .toMatchObject({ status: "blocked", reason: "snapshot_invalid" });
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, async () => ({ ...row,
        request_payload: { ...row.request_payload,
          provider_execution_id: "decision:other" } })))
      .toMatchObject({ status: "blocked", reason: "snapshot_invalid" });
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, async () => ({ ...row,
        request_payload: { ...row.request_payload,
          idempotency_key: responsesActionDecisionIdempotencyKey({
            decisionId: "decision:other", bindingId: link.reasoning_binding_id,
            bindingEpoch: link.binding_epoch }) } })))
      .toMatchObject({ status: "blocked", reason: "snapshot_invalid" });
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, async () => ({ ...row,
        request_payload: { ...row.request_payload,
          source_id: "source:other" } })))
      .toMatchObject({ status: "blocked", reason: "snapshot_invalid" });
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, async () => ({ ...row,
        request_payload: { ...row.request_payload,
          temporal_plan: { ...row.request_payload.temporal_plan,
            plan_hash: hash("f") } } })))
      .toMatchObject({ status: "blocked", reason: "snapshot_invalid" });
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      store as never, async () => null))
      .toMatchObject({ status: "blocked", reason: "snapshot_missing" });
    let checks = 0;
    expect(await readProtectedResponsesDecisionSource({ link, binding },
      { verifyTaskAssociation: async () => {
        if (++checks === 2) throw new Error("binding revoked during read");
        return {};
      } } as never, readRow)).toMatchObject({ status: "blocked",
        reason: "binding_mismatch", automatic_replay_allowed: false });
    const abort = new AbortController(); abort.abort();
    expect(await readProtectedResponsesDecisionSource({ link, binding,
      signal: abort.signal }, store as never, readRow))
      .toMatchObject({ status: "blocked", reason: "read_cancelled" });
  });

  it("accepts a later still-valid admission clock but rejects a changed menu", async () => {
    const { firstSource, first } = await fixture();
    if (first.status !== "proposed") throw new Error("first decision rejected");
    const advanced = structuredClone(firstSource);
    advanced.context.current_unit += 2;
    advanced.context.current_monotonic_ms += 100;
    expect(parseResponsesDecisionSnapshot({ proposal: first.proposal,
      source: advanced })).not.toBeNull();
    advanced.observation_summary = "obstacle changed before admission";
    expect(parseResponsesDecisionSnapshot({ proposal: first.proposal,
      source: advanced })).toBeNull();
  });
});
