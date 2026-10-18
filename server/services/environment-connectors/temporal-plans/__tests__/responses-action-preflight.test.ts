import { describe, expect, it, vi } from "vitest";
import { buildHelixEnvironmentTemporalPlan } from "@shared/helix-environment-time";
import { HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  type HelixEnvironmentActionObservation } from "@shared/helix-environment-action";
import { environmentConnectorSha256 } from "../../catalog";
import { materializeHelixEnvironmentActionChoice,
  type VerifiedHelixEnvironmentActionChoiceSource } from "@shared/helix-environment-action-choice";
import { preflightResponsesActionChoice } from "../responses-action-preflight";
import { createVerifiedResponsesActionSourceLoader } from "../responses-action-source";
import { createVerifiedResponsesCheckpointSourceLoader } from "../responses-checkpoint-source";
import { invokeResponsesActionActor } from "../responses-action-actor";
import { projectResponsesActionActivity } from "../responses-action-activity";
import { admitResponsesActionChoice, responsesActionDecisionIdempotencyKey } from "../responses-action-admission";
import { chooseAndAdmitResponsesAction,
  responsesActionCheckpointDecisionId } from "../responses-action-choice-admit";
import type { ResponsesActionActorReceipt } from "../responses-action-actor";
import { captureStoredResponsesActionCheckpoint,
  readCapturedResponsesProgressFeedback,
  reconcileCapturedResponsesActionFeedback } from "../responses-action-checkpoint-capture";
import { reconcileStoredResponsesActionResult } from
  "../responses-action-result-reconcile";
import { reconcileResidentResponsesActionResult } from "../responses-action-resident-result";
import { parseResponsesDecisionSnapshot } from "../responses-action-decision-snapshot";
import { readProtectedResponsesDecisionSource } from "../responses-action-decision-source";
import { reconcileHistoricalResponsesActionFeedback } from "../responses-action-historical-feedback";
import { readStoredResponsesProgressFeedback } from "../responses-action-stored-progress";

const h = (char: string) => `sha256:${char.repeat(64)}`;
const plan = buildHelixEnvironmentTemporalPlan({
  plan_id: "plan:next", previous_plan_id: "plan:previous", previous_plan_hash: h("a"),
  identity: { environment_id: "environment:one", source_id: "source:one",
    subject_id: "player:one", producer_epoch: "epoch:one", authority_id: "authority:one",
    authority_revision: 6, goal_id: "goal:one", goal_revision: 3,
    observation_revision: 4, affordance_revision: 5 },
  clocks: { environment: { kind: "tick", sequence: 100,
    resolution_unit: "minecraft_tick", nominal_units_per_second: 20 },
    monotonic: { origin_id: "clock:one", elapsed_ms: 1_000 },
    audit_at: "2026-10-05T12:00:00Z" },
  adapter_id: "minecraft.fabric_client", adapter_version: "1", compiler_version: "compiler:1",
  resident_executor_version: "native:1", start_node_id: "walk", maximum_total_units: 20,
  monotonic_deadline_elapsed_ms: 1_500,
  watermarks: { decision_unit: 5, stop_unit: 10, committed_through_unit: 20,
    stabilization_node_id: "success" },
  lanes: [{ lane_id: "move", priority: 1, resource_keys: ["locomotion"] }], effect_ceiling: {},
  nodes: [{ kind: "action", node_id: "walk", lane_id: "move",
    capability_id: "com.casimirbot.minecraft.player.walk", capability_version: "1",
    arguments: { action_kind: "walk", direction: "forward", duration_ms: 100, sprint: false },
    required_resources: ["locomotion"], timing: { earliest_start_unit: 0,
      latest_start_unit: 5, maximum_duration_units: 10 }, preconditions: [],
    completion_conditions: [{ kind: "adapter_condition", condition_id: "minecraft.player_grounded",
      arguments: { expected: true } }], abort_guards: [], effect_budget: {},
    on_success_node_id: "success", on_failure_node_id: "failure", on_timeout_node_id: "failure" },
  { kind: "terminal", node_id: "success", outcome: "succeeded", reason_code: "done" },
  { kind: "terminal", node_id: "failure", outcome: "failed", reason_code: "failed" }],
});

describe("console-only admitted Responses causal replay", () => {
  it("joins the actual admission link to resident evidence and a changed next choice", async () => {
    const firstTransport = vi.fn(async () => new Response(JSON.stringify({
      id: "response:advance", object: "response", status: "completed",
      error: null, incomplete_details: null,
      output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({
          choice_id: "advance:one", rationale_code: "route_clear" }) }] }],
    }), { status: 200 }));
    const first = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: "decision:one", requestedHorizonUnits: 12,
      requestedLifetimeMs: 500, loadVerifiedSource: async () => source(),
      providerTransport: firstTransport as never });
    expect(first).toMatchObject({ status: "proposed", execution_authority: false,
      proposal: { choice_id: "advance:one", plan_id: plan.plan_id } });
    if (first.status !== "proposed") throw new Error("first choice unavailable");
    const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "client:one",
      clientSessionRef: "session:one", clientContinuationRef: "task:one",
      bindingId: "binding:one", bindingEpoch: 2, helixConversationId: "chat:one",
      missionId: null, runId: "run:one" };
    const request = { run_id: "run:one", room_id: "room:one",
      participant_id: "participant:one", action_authority_id: "authority:one",
      provider_execution_id: "decision:one",
      idempotency_key: responsesActionDecisionIdempotencyKey({
        decisionId: "decision:one", bindingId: "binding:one", bindingEpoch: 2 }),
      environment_binding_id: "environment:one", source_id: "source:one",
      subject_binding_id: "player:one", action_kind: "execute_sequence" };
    const admit = vi.fn(async () => ({ action_request_id: "request:child" })) as never;
    const admission = await admitResponsesActionChoice({ receipt: first,
      loadVerifiedSource: async () => source(), trustedCandidates: [candidate],
      temporal, binding, request } as never,
    { verifyTaskAssociation: vi.fn(async () => ({})) } as never, async () => {}, {
      readVerifiedNavEqAcceptance: async () => ({ status: "live_accepted",
        profile_ref: "profile:one", adapter_id: plan.adapter_id,
        adapter_version: plan.adapter_version,
        resident_executor_version: plan.resident_executor_version,
        artifact_hash: h("d"), evidence_ref: "nav-eq:evidence:one" }),
      temporalPreflight: vi.fn(async () => ({ plan,
        preflight_only: true, execution_authority: false })) as never, admit });
    expect(admission).toMatchObject({ status: "admitted",
      decision_action_link: { decision_id: "decision:one",
        plan_id: plan.plan_id, action_request_id: "request:child" },
      selection_is_execution_proof: false });
    if (admission.status !== "admitted") throw new Error("admission unavailable");
    const retained = parseResponsesDecisionSnapshot({
      proposal: first.proposal, source: source() });
    expect(retained).not.toBeNull();
    if (!retained) throw new Error("decision snapshot unavailable");
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({
      responsesDecisionSnapshot: retained.snapshot }), expect.anything());
    const retainedRow = { plan_id: plan.plan_id, plan_hash: plan.plan_hash,
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
      responses_decision_snapshot: retained.snapshot,
      responses_decision_snapshot_hash: retained.hash,
      request_payload: { ...request, action_request_id: "request:child",
        temporal_plan: plan, arguments: { sequence_id: "sequence:advance" } } };
    // Every protected lookup receives a freshly deserialized row, as it
    // would after the admission snapshot crossed a storage/process boundary.
    // This is not a PostgreSQL restart or transaction-isolation test.
    const persistedDecisionRow = JSON.stringify(retainedRow);
    const readDecisionSource = vi.fn((input: Parameters<typeof readProtectedResponsesDecisionSource>[0],
      store: Parameters<typeof readProtectedResponsesDecisionSource>[1]) =>
      readProtectedResponsesDecisionSource(input, store,
        async () => JSON.parse(persistedDecisionRow)));
    const sourceRead = await readDecisionSource({
      link: admission.decision_action_link, binding },
    { verifyTaskAssociation: vi.fn(async () => ({})) } as never);
    expect(sourceRead).toMatchObject({ status: "decision_source_verified",
      source: source(), execution_authority: false,
      automatic_replay_allowed: false });
    const tamperedDecisionRow = JSON.parse(persistedDecisionRow);
    tamperedDecisionRow.request_payload.temporal_plan.nodes[0].arguments.direction = "right";
    expect(await readProtectedResponsesDecisionSource({
      link: admission.decision_action_link, binding },
    { verifyTaskAssociation: vi.fn(async () => ({})) } as never,
    async () => tamperedDecisionRow)).toMatchObject({ status: "blocked",
      reason: "snapshot_invalid", execution_authority: false,
      automatic_replay_allowed: false });
    expect(admit).toHaveBeenCalledTimes(1);
    const { plan_hash: _priorHash, ...nextDraft } = plan;
    const detourPlan = buildHelixEnvironmentTemporalPlan({ ...nextDraft,
      plan_id: "plan:detour", previous_plan_id: plan.plan_id,
      previous_plan_hash: plan.plan_hash,
      identity: { ...plan.identity, observation_revision: 5,
        affordance_revision: 6 },
      nodes: plan.nodes.map(node => node.kind === "action" ? {
        ...node, arguments: { ...node.arguments, direction: "right" },
      } : node) });
    expect(detourPlan.plan_hash).not.toBe(plan.plan_hash);
    expect(detourPlan.nodes.find(node => node.kind === "action"))
      .toMatchObject({ arguments: { direction: "right" } });
    const measuredObstacle = { snapshot_schema: "helix.minecraft_perception_snapshot.v1",
      observation_revision: 5, game_tick: 106,
      actor: { position: { x: 2, y: 64, z: 0 }, on_ground: true },
      hazards: [], entities: [], projectiles: [],
      movement_candidates: ["forward", "back", "left", "right"].map(relative_direction => ({
        relative_direction, cardinal_direction: relative_direction === "right" ? "east" :
          relative_direction === "left" ? "west" :
          relative_direction === "back" ? "south" : "north", evidence_complete: true,
        feet_clear: true, head_clear: relative_direction !== "forward",
        drop_depth_blocks: 0, safe_candidate: relative_direction !== "forward",
      })), navigation_frontier: { reachable_foothold_count: 8,
        evidence_complete: true } };
    const successor = { available: true as const,
      action_request_id: admission.decision_action_link.action_request_id,
      previous_plan_id: plan.plan_id, previous_plan_hash: plan.plan_hash,
      workflow_id: "workflow:root", checkpoint: { event_id: "event:two",
        event_hash: h("f"), checkpoint_id: "checkpoint:two",
        action_event_id: "event:child" },
      observed_at: "2026-10-09T11:59:59.000Z",
      predecessor_clocks: plan.clocks };
    const expiredSuccessor = { available: false as const,
      reason_code: "no_current_verified_checkpoint" as const,
      diagnostic_code: "no_matching_temporal_admission" as const,
      execution_authority: false as const, answer_authority: false as const,
      terminal_eligible: false as const };
    let currentSuccessor: typeof successor | typeof expiredSuccessor = successor;
    const checkpointLoader = createVerifiedResponsesCheckpointSourceLoader({
      context: temporal.context, association: temporal.association,
      frontierId: temporal.frontierId,
    }, async () => {}, {
      resolvePerception: async () => ({
        goal: { goal_id: "goal:one", goal_revision: 3, identity: {
          run_id: "run:one", environment_binding_id: "environment:one",
          source_id: "source:one", subject_binding_id: "player:one",
          action_authority_id: "authority:one", authority_policy_version: 6 } },
        observation_producer_epoch_ref: "observation-epoch:one",
        action_producer_epoch_ref: "epoch:one",
        evidence: { observation: { evidence_ref: "observation:two",
          result: measuredObstacle } },
        catalog: { resident_clock_observation: {
          producer_epoch_ref: "epoch:one", manual_input_detected: false,
          clock: { clock_kind: "minecraft_game_tick", tick_index: 106,
            world_tick_index: 106, monotonic: { origin_id: "clock:one",
              elapsed_ms: 1_300 } } } },
      }),
      readFrontier: async () => ({ identity: {
        environment_id: "environment:one", source_id: "source:one",
        subject_id: "player:one", producer_epoch: "epoch:one",
        authority_id: "authority:one", authority_revision: 6,
        goal_id: "goal:one", goal_revision: 3, observation_revision: 5,
        affordance_revision: 6 }, clocks: { environment: {
          resolution_unit: "minecraft_world_tick", sequence: 106 } },
        expires_at_environment_sequence: 120 }),
      readSuccessor: async () => currentSuccessor,
    } as never);
    const loadCurrentInMotionSource = createVerifiedResponsesActionSourceLoader({
      context: temporal.context, association: temporal.association,
      frontierId: temporal.frontierId,
      loadTrustedCandidates: async () => [{ ...candidate,
        candidate_id: "detour:one", target_ref: "waypoint:detour",
        estimated_units: 8, plan: detourPlan }],
    }, async () => {}, { loadCheckpoint: checkpointLoader,
      preflight: vi.fn(async () => ({ preflight_only: true,
        execution_authority: false })) as never });
    const after = await loadCurrentInMotionSource();
    expect(after).not.toBeNull();
    if (!after) throw new Error("measured successor source unavailable");
    const bindingStore = { verifyTaskAssociation: vi.fn(async () => ({})) };
    const capture = await captureStoredResponsesActionCheckpoint({
      link: admission.decision_action_link, binding, sourceAtDecision: source(),
      context: {} as never, loadVerifiedSource: loadCurrentInMotionSource,
    }, bindingStore as never, { readSuccessor: vi.fn(async () => successor) as never });
    expect(capture).toMatchObject({ status: "captured",
      action_request_id: "request:child", action_event_id: "event:child" });
    if (capture.status !== "captured") throw new Error("checkpoint unavailable");
    let pendingDeliveryStatus = "running";
    const readPendingChildLineage = vi.fn(async () => ({
      action_request_id: "request:child", resident_action_request_id: "request:root",
      resident_workflow_id: "workflow:root",
      plan_id: plan.plan_id, plan_hash: plan.plan_hash, run_id: "run:one",
      reasoning_binding_id: "binding:one", reasoning_binding_epoch: 2,
      client_continuation_ref: "task:one",
      admitted_at: "2026-10-09T11:59:50.000Z",
      producer_epoch: "epoch:one", native_plan_id: "sequence:advance",
      recorded_status: pendingDeliveryStatus,
      resident_recorded_status: "running" }));
    let pendingRootObservation: HelixEnvironmentActionObservation | null = null;
    const readPendingRoot = vi.fn(async () => pendingRootObservation);
    const pendingResultRead = vi.fn((input: Parameters<typeof reconcileStoredResponsesActionResult>[0],
      store: Parameters<typeof reconcileStoredResponsesActionResult>[1]) =>
      reconcileStoredResponsesActionResult(input, store, {
        readCanonicalObservation: async () => null,
        readResidentResult: (residentInput, residentStore) =>
          reconcileResidentResponsesActionResult(residentInput, residentStore, {
            readChildLineage: readPendingChildLineage,
            readRootObservation: readPendingRoot,
            readResidentEvents: async () => [],
          }),
      }));
    const progress = await readCapturedResponsesProgressFeedback({ capture,
      binding, loadVerifiedSource: loadCurrentInMotionSource }, bindingStore as never, {
      readResult: pendingResultRead, readDecisionSource });
    expect(progress).toMatchObject({ status: "progress_ready",
      decision_id: "decision:one", action_request_id: "request:child",
      checkpoint_event_id: "event:two", observation_ref: "observation:two",
      native_result_verified: false, execution_authority: false,
      goal_progress_verified: false, automatic_retry_allowed: false });
    expect(pendingResultRead).toHaveBeenCalledTimes(2);
    expect(readPendingChildLineage).toHaveBeenCalledTimes(2);
    expect(readPendingChildLineage).toHaveBeenCalledWith("request:child");
    expect(readPendingRoot).toHaveBeenCalledTimes(2);
    expect(readPendingRoot).toHaveBeenCalledWith("request:root");
    if (progress.status !== "progress_ready") throw new Error("progress unavailable");
    expect(progress.source).toEqual(after);
    // The same in-motion menu can be reconstructed from retained admission
    // and event records after the opaque capture is lost; the live source and
    // pending broker result are still rechecked independently.
    const storedProgressReaders = {
      readDecisionSource,
      readCheckpoint: vi.fn(async () => ({
        status: "historical_checkpoint_verified", action_request_id: "request:child",
        resident_action_request_id: "request:root", workflow_id: "workflow:root",
        plan_id: plan.plan_id, plan_hash: plan.plan_hash,
        checkpoint_id: "checkpoint:two", checkpoint_event_id: "event:two",
        checkpoint_event_hash: h("f"), action_event_id: "event:child",
        action_event_hash: h("e"), observed_at: "2026-10-09T11:59:59.000Z",
        world_tick_index: 106, historical_evidence_only: true,
        current_admission_authority: false, execution_authority: false,
        automatic_replay_allowed: false,
      })) as never,
      readResult: pendingResultRead,
    };
    const storedProgress = await readStoredResponsesProgressFeedback({
      link: admission.decision_action_link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: loadCurrentInMotionSource,
    }, bindingStore as never, storedProgressReaders);
    expect(storedProgress).toMatchObject({ status: "progress_ready",
      decision_id: "decision:one", action_request_id: "request:child",
      checkpoint_event_id: "event:two", source: after,
      native_result_verified: false, execution_authority: false,
      automatic_retry_allowed: false });
    if (storedProgress.status !== "progress_ready")
      throw new Error("stored progress unavailable");
    for (const residentId of [undefined, "request:other"]) {
      const wrongRootSourceRead = vi.fn(loadCurrentInMotionSource);
      const wrongRootProgress = await readStoredResponsesProgressFeedback({
        link: admission.decision_action_link, binding,
        checkpointEventId: "event:two", checkpointId: "checkpoint:two",
        loadVerifiedCurrentSource: wrongRootSourceRead,
      }, bindingStore as never, { ...storedProgressReaders,
        readResult: vi.fn(async () => ({ status: "pending",
          action_request_id: "request:child",
          resident_action_request_id: residentId,
          native_result_verified: false, automatic_retry_allowed: false })) as never });
      expect(wrongRootProgress).toMatchObject({ status: "blocked",
        reason: "native_result_not_pending", execution_authority: false,
        automatic_retry_allowed: false });
      expect(wrongRootSourceRead).not.toHaveBeenCalled();
    }
    // Re-reading the same stored checkpoint projects the same evidence, not
    // a new model decision or broker action request. Native duplicate pickup
    // remains a separate boundary.
    const repeatedProgress = await readStoredResponsesProgressFeedback({
      link: admission.decision_action_link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: loadCurrentInMotionSource,
    }, bindingStore as never, storedProgressReaders);
    expect(repeatedProgress).toEqual(storedProgress);
    expect(admit).toHaveBeenCalledTimes(1);
    // A retained checkpoint outlives the resident lease. Once the protected
    // current-source loader loses that successor, historical proof alone must
    // not create another choice or broker admission.
    // This is the protected successor reader's response after its resident
    // request deadline filter no longer finds a current admission.
    currentSuccessor = expiredSuccessor;
    const lostLeaseProgress = await readStoredResponsesProgressFeedback({
      link: admission.decision_action_link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: loadCurrentInMotionSource,
    }, bindingStore as never, storedProgressReaders);
    expect(lostLeaseProgress).toMatchObject({ status: "blocked",
      reason: "source_unavailable", execution_authority: false,
      automatic_retry_allowed: false });
    const expiredProvider = vi.fn();
    const expiredChoice = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: responsesActionCheckpointDecisionId(after),
      requestedHorizonUnits: 8, requestedLifetimeMs: 150,
      loadVerifiedSource: loadCurrentInMotionSource,
      providerTransport: expiredProvider as never });
    expect(expiredChoice).toMatchObject({ status: "unavailable",
      reason: "source_unavailable", execution_authority: false });
    expect(expiredProvider).not.toHaveBeenCalled();
    expect(admit).toHaveBeenCalledTimes(1);
    currentSuccessor = successor;
    const nextDecisionId = responsesActionCheckpointDecisionId(storedProgress.source);
    expect(nextDecisionId).not.toBe(first.proposal.decision_id);
    expect(responsesActionCheckpointDecisionId(after)).toBe(nextDecisionId);
    const progressSourceRead = vi.fn(async () => after);
    const progressQualificationRead = vi.fn(async () => null);
    const progressAdmission = await admitResponsesActionChoice({ receipt: storedProgress,
      loadVerifiedSource: progressSourceRead, trustedCandidates: [candidate],
      temporal, binding, request } as never,
    bindingStore as never, async () => {}, {
      readVerifiedNavEqAcceptance: progressQualificationRead, admit });
    expect(progressAdmission).toMatchObject({ status: "blocked",
      reason: "no_action_proposal", selection_is_execution_proof: false });
    expect(progressSourceRead).not.toHaveBeenCalled();
    expect(progressQualificationRead).not.toHaveBeenCalled();
    expect(admit).toHaveBeenCalledTimes(1);
    for (const retiredStatus of ["canceled", "paused_manual_override", "timed_out"]) {
      pendingDeliveryStatus = retiredStatus;
      const retiredSourceRead = vi.fn(async () => after);
      const retiredProgress = await readCapturedResponsesProgressFeedback({ capture,
        binding, loadVerifiedSource: retiredSourceRead }, bindingStore as never, {
        readResult: pendingResultRead, readDecisionSource });
      expect(retiredProgress).toMatchObject({ status: "blocked",
        reason: "native_result_not_pending", execution_authority: false,
        automatic_retry_allowed: false });
      expect(retiredSourceRead).not.toHaveBeenCalled();
      expect(admit).toHaveBeenCalledTimes(1);
    }
    pendingDeliveryStatus = "running";
    const secondTransport = vi.fn(async (menu: { observation_summary: string;
      candidates: Array<{ candidate_id: string; target_ref: string | null }> }) => {
      expect(JSON.parse(menu.observation_summary)).toMatchObject({
        safe_movement_candidate_count: 3,
        movement_options: [{ relative_direction: "forward", head_clear: false,
          safe_candidate: false }, { relative_direction: "back" },
        { relative_direction: "left" }, { relative_direction: "right",
          cardinal_direction: "east", head_clear: true, safe_candidate: true }],
      });
      expect(menu.candidates).toContainEqual(expect.objectContaining({
        candidate_id: "detour:one", target_ref: "waypoint:detour" }));
      return new Response(JSON.stringify({
        id: "response:detour", object: "response", status: "completed",
        error: null, incomplete_details: null,
        output: [{ type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({
            choice_id: "detour:one", rationale_code: "headroom_blocked" }) }] }],
      }), { status: 200 });
    });
    // The captured menu is evidence for re-entry, not a reusable current-source
    // loader. The actor must read the live source on both sides of the call.
    const readCurrentInMotionSource = vi.fn(async () => {
      const live = await loadCurrentInMotionSource();
      expect(live).toEqual(storedProgress.source);
      if (live) expect(responsesActionCheckpointDecisionId(live)).toBe(nextDecisionId);
      return live;
    });
    const second = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: nextDecisionId, requestedHorizonUnits: 8,
      requestedLifetimeMs: 150, loadVerifiedSource: readCurrentInMotionSource,
      providerTransport: secondTransport as never });
    expect(firstTransport).toHaveBeenCalledTimes(1);
    expect(secondTransport).toHaveBeenCalledTimes(1);
    expect(readCurrentInMotionSource).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ status: "proposed", execution_authority: false,
      proposal: { decision_id: nextDecisionId, choice_id: "detour:one",
        plan_id: detourPlan.plan_id,
        plan_hash: detourPlan.plan_hash } });
    if (second.status !== "proposed") throw new Error("detour choice unavailable");
    expect(second.proposal.choice_id).not.toBe(first.proposal.choice_id);
    expect(second.proposal.expires_at_monotonic_ms)
      .toBeLessThanOrEqual(detourPlan.monotonic_deadline_elapsed_ms);
    expect(second).not.toHaveProperty("action_request_id");
    // A further observation arriving during a model call invalidates that
    // answer before it can reach temporal admission, even if it names the
    // formerly offered detour. No second action request is created.
    const later = structuredClone(after);
    later.context.observation_ref = "observation:three";
    later.context.observation_revision = 6;
    later.observation_summary = "new measured obstruction after model sampling";
    let lateReads = 0;
    const late = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: "decision:late", requestedHorizonUnits: 8,
      requestedLifetimeMs: 150, loadVerifiedSource: async () =>
        ++lateReads === 1 ? structuredClone(after) : structuredClone(later),
      providerTransport: secondTransport as never });
    expect(lateReads).toBe(2);
    expect(late).toMatchObject({ status: "rejected", reason: "source_changed",
      execution_authority: false });
    const lateAdmission = await admitResponsesActionChoice({ receipt: late,
      loadVerifiedSource: async () => later, trustedCandidates: [candidate],
      temporal, binding, request } as never,
    bindingStore as never, async () => {}, {
      readVerifiedNavEqAcceptance: vi.fn(async () => null), admit });
    expect(lateAdmission).toMatchObject({ status: "blocked",
      reason: "no_action_proposal", selection_is_execution_proof: false });
    expect(admit).toHaveBeenCalledTimes(1);
    // A new player/connector epoch during the same provider flight also
    // invalidates the answer; the earlier checkpoint cannot authorize it.
    const changedEpoch = structuredClone(after);
    changedEpoch.context.producer_epoch = "epoch:other";
    let epochReads = 0;
    const epochDriftChoice = await invokeResponsesActionActor({ model: "fixture:model",
      hostDecisionId: "decision:epoch-drift", requestedHorizonUnits: 8,
      requestedLifetimeMs: 150, loadVerifiedSource: async () =>
        ++epochReads === 1 ? structuredClone(after) : structuredClone(changedEpoch),
      providerTransport: secondTransport as never });
    expect(epochReads).toBe(2);
    expect(epochDriftChoice).toMatchObject({ status: "rejected",
      reason: "source_changed", execution_authority: false });
    const epochDriftAdmission = await admitResponsesActionChoice({
      receipt: epochDriftChoice, loadVerifiedSource: async () => changedEpoch,
      trustedCandidates: [candidate], temporal, binding, request } as never,
    bindingStore as never, async () => {}, {
      readVerifiedNavEqAcceptance: vi.fn(async () => null), admit });
    expect(epochDriftAdmission).toMatchObject({ status: "blocked",
      reason: "no_action_proposal", selection_is_execution_proof: false });
    expect(admit).toHaveBeenCalledTimes(1);
    const root = { schema: HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
      action_request_ref: "request:root", workflow_ref: "workflow:root",
      action_execution_ref: "execution:root", capability_id: "sequence.execute",
      capability_version: 1, action_kind: "execute_sequence", outcome: "failed" as const,
      summary: "A measured headroom obstacle stopped the resident route.",
      result: { controls_released: true, automatic_replay_performed: false,
        player_motion_performed: true, player_interaction_performed: false,
        inventory_mutation_performed: false, world_mutation_performed: false },
      progress_observation_refs: ["event:child"], postcondition_evidence_refs: [],
      evidence_ref: "evidence:root", observed_at: "2026-10-09T12:00:00.000Z",
      provenance_valid: true, eligible_for_current_turn_reentry: true,
      content_role: "environment_action_observation_not_assistant_answer" as const,
      reentry_required: true as const, answer_authority: false as const,
      assistant_answer: false as const, terminal_eligible: false as const,
      raw_content_included: false as const };
    // A result that becomes ambiguous after the in-motion choice must not
    // turn the retained checkpoint into another choice or broker request.
    pendingRootObservation = { ...root, outcome: "action_outcome_unknown" };
    const unknownSourceRead = vi.fn(async () => after);
    const unknownProgress = await readCapturedResponsesProgressFeedback({ capture,
      binding, loadVerifiedSource: unknownSourceRead }, bindingStore as never, {
      readResult: pendingResultRead, readDecisionSource });
    expect(unknownProgress).toMatchObject({ status: "blocked",
      reason: "native_result_not_pending", execution_authority: false,
      automatic_retry_allowed: false });
    expect(unknownSourceRead).not.toHaveBeenCalled();
    expect(admit).toHaveBeenCalledTimes(1);
    // Settlement during the fresh-source read is caught by the second
    // protected result fence, even when the source itself has not changed.
    pendingRootObservation = null;
    const settlingSourceRead = vi.fn(async () => {
      pendingRootObservation = { ...root, outcome: "action_outcome_unknown" };
      return after;
    });
    const settlingProgress = await readCapturedResponsesProgressFeedback({ capture,
      binding, loadVerifiedSource: settlingSourceRead }, bindingStore as never, {
      readResult: pendingResultRead, readDecisionSource });
    expect(settlingProgress).toMatchObject({ status: "blocked",
      reason: "native_result_not_pending", execution_authority: false,
      automatic_retry_allowed: false });
    expect(settlingSourceRead).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
    const event = { schema: "helix.environment_action.workflow_event.v1",
      event_id: "event:child", action_request_id: "request:root",
      workflow_id: "workflow:root", sequence: 7,
      event_type: "workflow.progress", workflow_state: "running",
      progress_fraction: 0.5, summary: "Measured headroom obstacle",
      control_engine: "native_fabric", measurements: { sequence_id: "sequence:advance",
        checkpoint_settlements: [] }, evidence_refs: [],
      manual_override_detected: false, controls_released: false,
      created_at: "2026-10-09T11:59:59.000Z",
      content_role: "environment_action_event_not_assistant_answer",
      answer_authority: false, assistant_answer: false,
      terminal_eligible: false, raw_content_included: false };
    const readCanonicalObservation = vi.fn(async () => null);
    const readChildLineage = vi.fn(async () => ({
      action_request_id: "request:child", resident_action_request_id: "request:root",
      resident_workflow_id: "workflow:root",
      plan_id: plan.plan_id, plan_hash: plan.plan_hash, run_id: "run:one",
      reasoning_binding_id: "binding:one", reasoning_binding_epoch: 2,
      client_continuation_ref: "task:one",
      admitted_at: "2026-10-09T11:59:50.000Z",
      producer_epoch: "epoch:one", native_plan_id: "sequence:advance",
      recorded_status: "failed", resident_recorded_status: "failed" }));
    const readRootObservation = vi.fn(async () => root);
    const readResidentEvents = vi.fn(async () => [{ event_id: "event:child",
      event_payload: event, event_hash: environmentConnectorSha256(event),
      producer_epoch_ref: "epoch:one" }]);
    const feedback = await reconcileCapturedResponsesActionFeedback({ capture,
      binding, loadVerifiedSource: async () => after }, bindingStore as never, {
      readCanonicalObservation,
      readResidentResult: (input, store) => reconcileResidentResponsesActionResult(
        input, store, { readChildLineage,
        readRootObservation, readResidentEvents }),
    });
    expect(feedback).toMatchObject({ status: "feedback_ready",
      decision_id: "decision:one", action_request_id: "request:child",
      result_evidence_ref: "evidence:root", checkpoint_event_id: "event:two",
      execution_authority: false, goal_progress_verified: false });
    expect(readCanonicalObservation).not.toHaveBeenCalled();
    expect(readChildLineage).toHaveBeenCalledWith(
      admission.decision_action_link.action_request_id);
    expect(readRootObservation).toHaveBeenCalledWith("request:root");
    if (feedback.status !== "feedback_ready") throw new Error("feedback unavailable");
    const historicalFeedback = await reconcileHistoricalResponsesActionFeedback({
      link: admission.decision_action_link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: async () => after,
    }, bindingStore as never, {
      readHistoricalCheckpoint: vi.fn(async () => ({
        status: "historical_checkpoint_verified", action_request_id: "request:child",
        resident_action_request_id: "request:root", workflow_id: "workflow:root",
        plan_id: plan.plan_id, plan_hash: plan.plan_hash,
        checkpoint_id: "checkpoint:two", checkpoint_event_id: "event:two",
        checkpoint_event_hash: h("f"), action_event_id: "event:child",
        action_event_hash: environmentConnectorSha256(event),
        observed_at: "2026-10-09T11:59:59.000Z", world_tick_index: 106,
        historical_evidence_only: true, current_admission_authority: false,
        execution_authority: false, automatic_replay_allowed: false,
      })) as never,
      readResult: ((input: Parameters<typeof reconcileResidentResponsesActionResult>[0],
        store: Parameters<typeof reconcileResidentResponsesActionResult>[1]) =>
        reconcileResidentResponsesActionResult(input,
        store, { readChildLineage, readRootObservation, readResidentEvents })) as never,
      readDecisionSource: readDecisionSource as never,
    });
    expect(historicalFeedback).toMatchObject({ status: "feedback_ready",
      decision_id: "decision:one", action_request_id: "request:child",
      checkpoint_event_id: "event:two", execution_authority: false,
      goal_progress_verified: false });
    expect(readDecisionSource).toHaveBeenCalledTimes(11);
    if (historicalFeedback.status !== "feedback_ready")
      throw new Error("historical feedback unavailable");
    // The injected source above proves composition only. The production
    // successor loader needs a current running resident workflow; a settled
    // root with no live successor must not produce another model choice.
    const unavailableAfterSettlement = await reconcileHistoricalResponsesActionFeedback({
      link: admission.decision_action_link, binding,
      checkpointEventId: "event:two", checkpointId: "checkpoint:two",
      loadVerifiedCurrentSource: async () => null,
    }, bindingStore as never, {
      readHistoricalCheckpoint: vi.fn(async () => ({
        status: "historical_checkpoint_verified", action_request_id: "request:child",
        resident_action_request_id: "request:root", workflow_id: "workflow:root",
        plan_id: plan.plan_id, plan_hash: plan.plan_hash,
        checkpoint_id: "checkpoint:two", checkpoint_event_id: "event:two",
        checkpoint_event_hash: h("f"), action_event_id: "event:child",
        action_event_hash: environmentConnectorSha256(event),
        observed_at: "2026-10-09T11:59:59.000Z", world_tick_index: 106,
        historical_evidence_only: true, current_admission_authority: false,
        execution_authority: false, automatic_replay_allowed: false,
      })) as never,
      readResult: ((input: Parameters<typeof reconcileResidentResponsesActionResult>[0],
        store: Parameters<typeof reconcileResidentResponsesActionResult>[1]) =>
        reconcileResidentResponsesActionResult(input,
        store, { readChildLineage, readRootObservation, readResidentEvents })) as never,
      readDecisionSource: readDecisionSource as never,
    });
    expect(unavailableAfterSettlement).toMatchObject({ status: "blocked",
      reason: "source_unavailable", execution_authority: false,
      automatic_retry_allowed: false });
    expect(admit).toHaveBeenCalledTimes(1);
  });
});

const source = (): VerifiedHelixEnvironmentActionChoiceSource => ({
  context: { run_id: "run:one", reasoning_binding_id: "binding:one", binding_epoch: 2,
    environment_id: "environment:one", source_id: "source:one", subject_id: "player:one",
    goal_id: "goal:one", goal_revision: 3, predecessor_plan_id: "plan:previous",
    predecessor_plan_hash: h("a"), checkpoint_id: "checkpoint:one",
    checkpoint_event_id: "event:one", checkpoint_event_hash: h("b"),
    observation_ref: "observation:one", observation_revision: 4, affordance_revision: 5,
    producer_epoch: "epoch:one", authority_id: "authority:one", authority_revision: 6,
    monotonic_origin_id: "clock:one", current_unit: 100, current_monotonic_ms: 1_000,
    maximum_proposal_horizon_units: 20, maximum_proposal_lifetime_ms: 1_000,
    interruption_pending: false }, observation_summary: "safe waypoint ahead",
  candidates: [{ candidate_id: "advance:one", plan_id: plan.plan_id, plan_hash: plan.plan_hash,
    action_code: "walk_to_waypoint", target_ref: "waypoint:one", estimated_units: 10 }],
});
const receipt = (choice_id = "advance:one"): ResponsesActionActorReceipt => {
  const decision = materializeHelixEnvironmentActionChoice({
    untrustedChoice: { choice_id, rationale_code: "route_clear" },
    invocationSource: source(), currentSource: source(), hostDecisionId: "decision:one",
    requestedHorizonUnits: 12, requestedLifetimeMs: 500 });
  if (!decision.accepted) throw new Error("fixture choice invalid");
  return { status: "proposed", proposal: decision.proposal,
    provider_response_ref: "resp:one", execution_authority: false };
};
const temporal = { context: { profileId: "profile:one", participantId: "participant:one",
    runId: "run:one", goalId: "goal:one", expectedRevision: 3, roomId: "room:one",
    turnId: "turn:one", priorTurnId: "turn:prior", probeRequestId: "probe:one" },
  association: { kind: "reasoning_binding" as const, associationId: "binding:one",
    associationEpoch: 2, profileRef: "profile:one", runId: "run:one",
    roomId: "room:one", participantId: "participant:one", continuationRef: "task:one" },
  frontierId: "frontier:one" };
const candidate = { candidate_id: "advance:one", action_code: "walk_to_waypoint",
  target_ref: "waypoint:one", estimated_units: 10, plan,
  compilation: { target: "serial" as const, options: {
    mutation_scope: { world_mutation_allowed: false, max_block_mutations: 0,
      max_inventory_transfers: 0, allowed_block_ids: [], allowed_regions: [], combat_allowed: false },
  } } };

describe("Responses choice into existing temporal preflight", () => {
  it("scopes replay identity to the decision and exact binding epoch", () => {
    const key = responsesActionDecisionIdempotencyKey({
      decisionId: "decision:one", bindingId: "binding:one", bindingEpoch: 2 });
    expect(key).toMatch(/^responses_decision:[a-f0-9]{64}$/u);
    expect(key).toBe(responsesActionDecisionIdempotencyKey({
      decisionId: "decision:one", bindingId: "binding:one", bindingEpoch: 2 }));
    expect(key).not.toBe(responsesActionDecisionIdempotencyKey({
      decisionId: "decision:two", bindingId: "binding:one", bindingEpoch: 2 }));
    expect(key).not.toBe(responsesActionDecisionIdempotencyKey({
      decisionId: "decision:one", bindingId: "binding:one", bindingEpoch: 3 }));
  });

  it("passes only the exact host plan into preflight and still does not dispatch", async () => {
    const preflight = vi.fn(async () => ({ preflight_only: true, execution_authority: false,
      answer_authority: false, terminal_eligible: false })) as never;
    const result = await preflightResponsesActionChoice({ receipt: receipt(),
      loadVerifiedSource: async () => source(), trustedCandidates: [candidate], temporal },
    async () => {}, preflight);
    expect(result).toMatchObject({ status: "preflight_ready", decision_id: "decision:one",
      execution_authority: false, result: { preflight_only: true } });
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(preflight.mock.calls[0][0]).toMatchObject({ plan: { plan_id: plan.plan_id,
      plan_hash: plan.plan_hash }, compilation: { target: "serial" } });
  });

  it("never preflights a hold, another binding or an untrusted plan", async () => {
    const preflight = vi.fn() as never;
    expect(await preflightResponsesActionChoice({ receipt: receipt("hold_safe"),
      loadVerifiedSource: async () => source(), trustedCandidates: [candidate], temporal },
    async () => {}, preflight)).toMatchObject({ status: "control_choice",
      choice_id: "hold_safe", execution_authority: false });
    expect(await preflightResponsesActionChoice({ receipt: receipt(),
      loadVerifiedSource: async () => source(), trustedCandidates: [candidate],
      temporal: { ...temporal, association: { ...temporal.association,
        associationId: "binding:other" } } },
    async () => {}, preflight)).toMatchObject({ status: "rejected", reason: "binding_mismatch" });
    expect(await preflightResponsesActionChoice({ receipt: receipt(),
      loadVerifiedSource: async () => source(), trustedCandidates: [{ ...candidate,
        plan: { ...plan, plan_id: "plan:other" } }], temporal },
    async () => {}, preflight)).toMatchObject({ status: "rejected",
      reason: "candidate_not_trusted" });
    expect(preflight).not.toHaveBeenCalled();
  });

  it("drops a selection if the source changes during preflight", async () => {
    let reads = 0;
    const result = await preflightResponsesActionChoice({ receipt: receipt(),
      loadVerifiedSource: async () => { const latest = source(); if (++reads === 2)
        latest.context.authority_revision++; return latest; },
      trustedCandidates: [candidate], temporal }, async () => {},
    vi.fn(async () => ({ preflight_only: true, execution_authority: false })) as never);
    expect(result).toMatchObject({ status: "rejected", reason: "selection_stale" });
    expect(reads).toBe(2);
  });

  it("derives the offered menu only from verified checkpoint and preflighted host plans", async () => {
    const original = source();
    const { run_id: runId, reasoning_binding_id: _bindingId,
      binding_epoch: _bindingEpoch, checkpoint_event_id: eventId,
      checkpoint_event_hash: eventHash, ...context } = original.context;
    const checkpoint = { run_id: runId, checkpoint_event_id: eventId,
      checkpoint_event_hash: eventHash, context,
      observation_summary: original.observation_summary };
    const preflight = vi.fn(async () => ({ preflight_only: true,
      execution_authority: false })) as never;
    const loader = createVerifiedResponsesActionSourceLoader({ context: temporal.context,
      association: temporal.association, frontierId: "frontier:one",
      loadTrustedCandidates: async () => [candidate] }, async () => {}, {
      loadCheckpoint: async () => checkpoint, preflight });
    const result = await loader();
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ context: { run_id: "run:one",
      reasoning_binding_id: "binding:one", binding_epoch: 2,
      checkpoint_event_id: "event:one" }, candidates: [{ candidate_id: "advance:one",
        plan_hash: plan.plan_hash }] });
    const altered = createVerifiedResponsesActionSourceLoader({ context: temporal.context,
      association: temporal.association, frontierId: "frontier:one",
      loadTrustedCandidates: async () => [{ ...candidate, plan: { ...plan,
        previous_plan_id: "plan:other" } }] }, async () => {}, {
      loadCheckpoint: async () => checkpoint, preflight });
    expect(await altered()).toBeNull();
    expect(preflight).toHaveBeenCalledTimes(1);
  });

  it("withholds the entire menu if a host plan fails preflight or the checkpoint changes", async () => {
    const original = source();
    const { run_id: runId, reasoning_binding_id: _bindingId,
      binding_epoch: _bindingEpoch, checkpoint_event_id: eventId,
      checkpoint_event_hash: eventHash, ...context } = original.context;
    const checkpoint = { run_id: runId, checkpoint_event_id: eventId,
      checkpoint_event_hash: eventHash, context,
      observation_summary: original.observation_summary };
    const input = { context: temporal.context, association: temporal.association,
      frontierId: "frontier:one", loadTrustedCandidates: async () => [candidate] };
    const failing = createVerifiedResponsesActionSourceLoader(input, async () => {}, {
      loadCheckpoint: async () => checkpoint,
      preflight: vi.fn(async () => { throw new Error("preflight_rejected"); }) as never });
    expect(await failing()).toBeNull();

    let reads = 0;
    const changed = createVerifiedResponsesActionSourceLoader(input, async () => {}, {
      loadCheckpoint: async () => { reads++;
        return reads === 1 ? checkpoint : { ...checkpoint,
          checkpoint_event_hash: h("c") }; },
      preflight: vi.fn(async () => ({ preflight_only: true,
        execution_authority: false })) as never });
    expect(await changed()).toBeNull();
    expect(reads).toBe(2);

    const impossible = createVerifiedResponsesActionSourceLoader({ ...input,
      loadTrustedCandidates: async () => [{ ...candidate, estimated_units: 21 }] },
    async () => {}, { loadCheckpoint: async () => checkpoint,
      preflight: vi.fn() as never });
    expect(await impossible()).toBeNull();

    reads = 0;
    const expired = createVerifiedResponsesActionSourceLoader(input, async () => {}, {
      loadCheckpoint: async () => { reads++;
        return reads === 1 ? checkpoint : { ...checkpoint,
          context: { ...checkpoint.context, current_monotonic_ms: 1_500 } }; },
      preflight: vi.fn(async () => ({ preflight_only: true,
        execution_authority: false })) as never });
    expect(await expired()).toBeNull();
  });

  it("carries one host menu through mocked Responses, preflight and no-effect activity", async () => {
    const original = source();
    const { run_id: runId, reasoning_binding_id: _bindingId,
      binding_epoch: _bindingEpoch, checkpoint_event_id: eventId,
      checkpoint_event_hash: eventHash, ...context } = original.context;
    const checkpoint = { run_id: runId, checkpoint_event_id: eventId,
      checkpoint_event_hash: eventHash, context,
      observation_summary: original.observation_summary };
    const preflight = vi.fn(async () => ({ preflight_only: true,
      execution_authority: false, answer_authority: false,
      terminal_eligible: false })) as never;
    const loadVerifiedSource = createVerifiedResponsesActionSourceLoader({
      context: temporal.context, association: temporal.association,
      frontierId: temporal.frontierId, loadTrustedCandidates: async () => [candidate],
    }, async () => {}, { loadCheckpoint: async () => checkpoint, preflight });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      object: "response", id: "response:one", status: "completed",
      error: null, incomplete_details: null,
      output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({
          choice_id: "advance:one", rationale_code: "route_clear" }) }] }],
    }), { status: 200 })) as typeof fetch;
    const receipt = await invokeResponsesActionActor({ model: "gpt-4o-mini",
      apiKey: "fixture-key", hostDecisionId: "decision:one",
      requestedHorizonUnits: 12, requestedLifetimeMs: 500,
      loadVerifiedSource, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({ status: "proposed", execution_authority: false,
      proposal: { choice_id: "advance:one", plan_hash: plan.plan_hash } });
    const result = await preflightResponsesActionChoice({ receipt,
      loadVerifiedSource, trustedCandidates: [candidate], temporal },
    async () => {}, preflight);
    expect(result).toMatchObject({ status: "preflight_ready",
      execution_authority: false });
    const latest = await loadVerifiedSource();
    expect(latest).not.toBeNull();
    const activity = projectResponsesActionActivity({ eventId: "activity:one",
      helixConversationId: "chat:one", source: latest!, receipt,
      preflight: result, observedAt: "2026-10-05T12:00:00.000Z" });
    expect(activity).toMatchObject({ phase: "preflight_ready",
      reasoning_binding_id: "binding:one", action_code: "walk_to_waypoint",
      action_performed: false, execution_authority: false,
      private_reasoning_included: false });
    expect(JSON.stringify(activity)).not.toMatch(/fixture-key|route_clear/i);
    expect(preflight).toHaveBeenCalledTimes(6);
  });

  it("keeps broker admission behind exact binding, request and verified NAV-EQ profile", async () => {
    const binding = { profileRef: "profile:one", bindingId: "binding:one",
      bindingEpoch: 2, clientContinuationRef: "task:one", runId: "run:one" };
    const request = { run_id: "run:one", room_id: "room:one",
      participant_id: "participant:one", action_authority_id: "authority:one",
      provider_execution_id: "decision:one",
      idempotency_key: responsesActionDecisionIdempotencyKey({
        decisionId: "decision:one", bindingId: "binding:one", bindingEpoch: 2 }),
      environment_binding_id: "environment:one", source_id: "source:one",
      subject_binding_id: "player:one", action_kind: "execute_sequence" };
    const admitted = vi.fn(async () => ({ action_request_id: "request:one" })) as never;
    const preflight = vi.fn(async () => ({ plan, preflight_only: true,
      execution_authority: false })) as never;
    const verifyLive = vi.fn(async () => null) as never;
    const input = { receipt: receipt(), loadVerifiedSource: async () => source(),
      trustedCandidates: [candidate], temporal, binding, request };
    const deps = { readVerifiedNavEqAcceptance: verifyLive,
      temporalPreflight: preflight, admit: admitted };
    const store = { verifyTaskAssociation: vi.fn() };
    expect(await admitResponsesActionChoice(input as never, store, async () => {}, deps))
      .toMatchObject({ status: "blocked", reason: "nav_eq_not_live_accepted" });
    expect(admitted).not.toHaveBeenCalled();

    verifyLive.mockResolvedValue({ status: "live_accepted", profile_ref: "profile:one",
      adapter_id: plan.adapter_id, adapter_version: plan.adapter_version,
      resident_executor_version: plan.resident_executor_version,
      artifact_hash: h("d"), evidence_ref: "nav-eq:evidence:one" });
    expect(await admitResponsesActionChoice(input as never, store, async () => {}, deps))
      .toMatchObject({ status: "admitted", receipt: { action_request_id: "request:one" },
        qualification_evidence_ref: "nav-eq:evidence:one",
        decision_action_link: { decision_id: "decision:one",
          choice_id: "advance:one", checkpoint_event_id: "event:one",
          reasoning_binding_id: "binding:one", binding_epoch: 2,
          run_id: "run:one",
          plan_id: plan.plan_id, plan_hash: plan.plan_hash,
          action_request_id: "request:one" },
        selection_is_execution_proof: false });
    expect(admitted).toHaveBeenCalledTimes(1);
    expect(admitted.mock.calls[0][0]).toMatchObject({
      preflight: { binding, plan: { plan_id: plan.plan_id,
        plan_hash: plan.plan_hash }, compilation: { target: "serial" } },
      request, checkpoint: { eventId: "event:one", checkpointId: "checkpoint:one" },
      responsesDecisionSnapshot: { proposal: { decision_id: "decision:one",
        choice_id: "advance:one", plan_id: plan.plan_id,
        plan_hash: plan.plan_hash }, source: source() },
    });

    const wrongBinding = { ...input, binding: { ...binding, bindingEpoch: 3 } };
    expect(await admitResponsesActionChoice(wrongBinding as never, store, async () => {}, deps))
      .toMatchObject({ status: "blocked", reason: "binding_mismatch" });
    const wrongRequest = { ...input, request: { ...request,
      action_authority_id: "authority:other" } };
    expect(await admitResponsesActionChoice(wrongRequest as never, store, async () => {}, deps))
      .toMatchObject({ status: "blocked", reason: "request_mismatch" });
    const replayedDecision = { ...input, request: { ...request,
      provider_execution_id: "decision:older" } };
    expect(await admitResponsesActionChoice(replayedDecision as never, store, async () => {}, deps))
      .toMatchObject({ status: "blocked", reason: "request_mismatch" });
    const aliasedKey = { ...input, request: { ...request,
      idempotency_key: responsesActionDecisionIdempotencyKey({
        decisionId: "decision:older", bindingId: "binding:one", bindingEpoch: 2 }) } };
    expect(await admitResponsesActionChoice(aliasedKey as never, store, async () => {}, deps))
      .toMatchObject({ status: "blocked", reason: "request_mismatch" });
    expect(admitted).toHaveBeenCalledTimes(1);
  });

  it("drops a candidate if NAV-EQ proof mismatches, source changes, or broker rejects", async () => {
    const binding = { profileRef: "profile:one", bindingId: "binding:one",
      bindingEpoch: 2, clientContinuationRef: "task:one", runId: "run:one" };
    const request = { run_id: "run:one", room_id: "room:one",
      participant_id: "participant:one", action_authority_id: "authority:one",
      provider_execution_id: "decision:one",
      idempotency_key: responsesActionDecisionIdempotencyKey({
        decisionId: "decision:one", bindingId: "binding:one", bindingEpoch: 2 }),
      environment_binding_id: "environment:one", source_id: "source:one",
      subject_binding_id: "player:one", action_kind: "execute_sequence" };
    const accepted = { status: "live_accepted" as const, profile_ref: "profile:one",
      adapter_id: plan.adapter_id, adapter_version: plan.adapter_version,
      resident_executor_version: plan.resident_executor_version,
      artifact_hash: h("d"), evidence_ref: "nav-eq:evidence:one" };
    const admitted = vi.fn(async () => ({ action_request_id: "request:one" })) as never;
    const preflight = vi.fn(async () => ({ plan, preflight_only: true,
      execution_authority: false })) as never;
    const input = { receipt: receipt(), loadVerifiedSource: async () => source(),
      trustedCandidates: [candidate], temporal, binding, request };
    const store = { verifyTaskAssociation: vi.fn() };
    expect(await admitResponsesActionChoice(input as never, store, async () => {}, {
      readVerifiedNavEqAcceptance: async () => ({ ...accepted,
        adapter_version: "different" }), temporalPreflight: preflight, admit: admitted,
    })).toMatchObject({ status: "blocked", reason: "nav_eq_not_live_accepted" });
    expect(admitted).not.toHaveBeenCalled();

    let reads = 0;
    expect(await admitResponsesActionChoice({ ...input,
      loadVerifiedSource: async () => { const latest = source();
        if (++reads === 4) latest.context.binding_epoch++; return latest; },
    } as never, store, async () => {}, {
      readVerifiedNavEqAcceptance: async () => accepted,
      temporalPreflight: preflight, admit: admitted,
    })).toMatchObject({ status: "blocked", reason: "selection_stale" });
    expect(reads).toBe(4);
    expect(admitted).not.toHaveBeenCalled();

    const failedBroker = vi.fn(async () => { throw new Error("permission_revoked"); }) as never;
    expect(await admitResponsesActionChoice(input as never, store, async () => {}, {
      readVerifiedNavEqAcceptance: async () => accepted,
      temporalPreflight: preflight, admit: failedBroker,
    })).toMatchObject({ status: "blocked", reason: "broker_rejected" });
    expect(failedBroker).toHaveBeenCalledTimes(1);
  });
});

describe("one exact-task Responses choice into temporal admission", () => {
  const binding = { profileRef: "profile:one", bindingId: "binding:one",
    bindingEpoch: 2, clientContinuationRef: "task:one", runId: "run:one" };
  const request = { run_id: "run:one", room_id: "room:one",
    participant_id: "participant:one", action_authority_id: "authority:one",
    environment_binding_id: "environment:one", source_id: "source:one",
    subject_binding_id: "player:one", action_kind: "execute_sequence" };
  const accepted = { status: "live_accepted" as const, profile_ref: "profile:one",
    adapter_id: plan.adapter_id, adapter_version: plan.adapter_version,
    resident_executor_version: plan.resident_executor_version,
    artifact_hash: h("d"), evidence_ref: "nav-eq:evidence:one" };
  const bridgeInput = () => ({ actor: { model: "gpt-4o-mini", apiKey: "fixture-key",
      requestedHorizonUnits: 12, requestedLifetimeMs: 500 },
    trustedCandidates: [candidate],
    createLoadVerifiedSource: () => async () => source(),
    temporal, binding, request });
  const proposed = (decisionId: string, choiceId = "advance:one") => {
    const verdict = materializeHelixEnvironmentActionChoice({
      untrustedChoice: { choice_id: choiceId, rationale_code: "route_clear" },
      invocationSource: source(), currentSource: source(),
      hostDecisionId: decisionId, requestedHorizonUnits: 12,
      requestedLifetimeMs: 500 });
    if (!verdict.accepted) throw new Error("invalid fixture choice");
    return { status: "proposed" as const, proposal: verdict.proposal,
      provider_response_ref: "response:one", execution_authority: false as const };
  };

  it("keeps duplicate checkpoint pickups on one decision and idempotency key", () => {
    const first = source();
    const repeated = source();
    repeated.context.current_unit += 3;
    repeated.context.current_monotonic_ms += 150;
    const decisionId = responsesActionCheckpointDecisionId(first);
    expect(responsesActionCheckpointDecisionId(repeated)).toBe(decisionId);
    expect(responsesActionDecisionIdempotencyKey({ decisionId,
      bindingId: binding.bindingId, bindingEpoch: binding.bindingEpoch }))
      .toBe(responsesActionDecisionIdempotencyKey({
        decisionId: responsesActionCheckpointDecisionId(repeated),
        bindingId: binding.bindingId, bindingEpoch: binding.bindingEpoch }));
    const changedObservation = source();
    changedObservation.context.observation_revision++;
    expect(responsesActionCheckpointDecisionId(changedObservation)).not.toBe(decisionId);
    const changedEpoch = source();
    changedEpoch.context.binding_epoch++;
    expect(responsesActionCheckpointDecisionId(changedEpoch)).not.toBe(decisionId);
  });

  it("stops before the paid actor when NAV-EQ or the exact task is not accepted", async () => {
    const invokeActor = vi.fn() as never;
    const store = { verifyTaskAssociation: vi.fn() };
    const noAcceptance = await chooseAndAdmitResponsesAction(bridgeInput() as never,
      store, async () => {}, { readVerifiedNavEqAcceptance: async () => null,
        invokeActor });
    expect(noAcceptance).toMatchObject({ status: "blocked",
      reason: "nav_eq_not_live_accepted", model_choice_recorded: false });
    expect(invokeActor).not.toHaveBeenCalled();

    store.verifyTaskAssociation.mockRejectedValueOnce(new Error("binding_expired"));
    const noBinding = await chooseAndAdmitResponsesAction(bridgeInput() as never,
      store, async () => {}, { readVerifiedNavEqAcceptance: async () => accepted,
        invokeActor });
    expect(noBinding).toMatchObject({ status: "blocked", reason: "binding_mismatch" });
    expect(invokeActor).not.toHaveBeenCalled();

    const noCurrentLease = await chooseAndAdmitResponsesAction({ ...bridgeInput(),
      createLoadVerifiedSource: () => async () => null } as never,
    store, async () => {}, { readVerifiedNavEqAcceptance: async () => accepted,
      invokeActor });
    expect(noCurrentLease).toMatchObject({ status: "blocked",
      reason: "source_unavailable", model_choice_recorded: false });
    expect(invokeActor).not.toHaveBeenCalled();
  });

  it("derives the decision identity and idempotency key from one frozen menu", async () => {
    const input = bridgeInput();
    const store = { verifyTaskAssociation: vi.fn() };
    const invokeActor = vi.fn(async (args: { hostDecisionId: string }) => {
      input.trustedCandidates[0].candidate_id = "mutated:after_choice";
      return proposed(args.hostDecisionId);
    }) as never;
    const admitChoice = vi.fn(async () => ({ status: "admitted",
      receipt: { action_request_id: "request:one" },
      qualification_evidence_ref: "nav-eq:evidence:one",
      decision_action_link: { action_request_id: "request:one" },
      selection_is_execution_proof: false })) as never;
    const result = await chooseAndAdmitResponsesAction(input as never, store,
      async () => {}, { readVerifiedNavEqAcceptance: async () => accepted,
        invokeActor, admitChoice });
    expect(result).toMatchObject({ status: "admitted", model_choice_recorded: true,
      native_result_verified: false, selection_is_execution_proof: false });
    expect(admitChoice).toHaveBeenCalledTimes(1);
    const admittedInput = admitChoice.mock.calls[0][0] as {
      receipt: ResponsesActionActorReceipt;
      trustedCandidates: typeof input.trustedCandidates;
      request: { provider_execution_id: string; idempotency_key: string };
    };
    if (admittedInput.receipt.status !== "proposed") throw new Error("missing proposal");
    expect(admittedInput.trustedCandidates[0].candidate_id).toBe("advance:one");
    expect(Object.isFrozen(admittedInput.trustedCandidates[0])).toBe(true);
    expect(admittedInput.request.provider_execution_id)
      .toBe(admittedInput.receipt.proposal.decision_id);
    expect(admittedInput.request.idempotency_key)
      .toBe(responsesActionDecisionIdempotencyKey({
        decisionId: admittedInput.receipt.proposal.decision_id,
        bindingId: binding.bindingId, bindingEpoch: binding.bindingEpoch }));
  });

  it("keeps hold, stale source and forged decision receipts out of the broker", async () => {
    const store = { verifyTaskAssociation: vi.fn() };
    const admitPlan = vi.fn() as never;
    const common = { readVerifiedNavEqAcceptance: async () => accepted,
      temporalPreflight: vi.fn() as never, admitPlan };
    const hold = await chooseAndAdmitResponsesAction(bridgeInput() as never,
      store, async () => {}, { ...common,
        invokeActor: vi.fn(async (args: { hostDecisionId: string }) =>
          proposed(args.hostDecisionId, "hold_safe")) as never });
    expect(hold).toMatchObject({ status: "control_choice", choice_id: "hold_safe" });
    expect(admitPlan).not.toHaveBeenCalled();

    let reads = 0;
    const stale = await chooseAndAdmitResponsesAction({ ...bridgeInput(),
      createLoadVerifiedSource: () => async () => {
        const current = source();
        if (++reads > 1) current.context.authority_revision++;
        return current;
      } } as never, store, async () => {}, { ...common,
      invokeActor: vi.fn(async (args: { hostDecisionId: string }) =>
        proposed(args.hostDecisionId)) as never });
    expect(stale).toMatchObject({ status: "blocked", reason: "selection_stale" });
    expect(admitPlan).not.toHaveBeenCalled();

    const forged = await chooseAndAdmitResponsesAction(bridgeInput() as never,
      store, async () => {}, { ...common,
        invokeActor: vi.fn(async () => proposed("decision:older")) as never });
    expect(forged).toMatchObject({ status: "blocked", reason: "no_action_proposal" });
    expect(admitPlan).not.toHaveBeenCalled();
  });
});
