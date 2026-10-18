import { describe, expect, it, vi } from "vitest";
import { createVerifiedResponsesCheckpointSourceLoader,
  summarizeResponsesCheckpointPerception } from "../responses-checkpoint-source";
import { invokeResponsesCheckpointWorker } from "../responses-checkpoint-worker";

const association = {
  kind: "direct_mcp_client" as const, associationId: "client:one", associationEpoch: 1,
  profileRef: "profile:one", runId: "run:one", roomId: "room:one",
  participantId: "participant:one", continuationRef: "session:one",
};
const request = { association, frontierId: "frontier:one", context: {
  goalId: "goal:one", profileId: "profile:one", participantId: "participant:one",
  expectedRevision: 2, roomId: "room:one", runId: "run:one", turnId: "turn:one",
  probeRequestId: "probe:one", priorTurnId: "turn:prior",
} };
const snapshot = { snapshot_schema: "helix.minecraft_perception_snapshot.v1",
  observation_revision: 11, game_tick: 112,
  actor: { position: { x: 2, y: 64, z: -4 }, health: 16, max_health: 20,
    food_level: 10, on_ground: true, chat: "private player text" },
  hazards: [{ critical: true, name: "private NBT" }],
  entities: [{ classification: "hostile", display_name: "private entity name" }],
  projectiles: [], movement_candidates: [{ safe_candidate: true }],
  navigation_frontier: { reachable_foothold_count: 12, evidence_complete: true },
  ui_state: { chat: "private screen text" },
};
const context = () => ({ goal: { goal_id: "goal:one", goal_revision: 2, identity: {
  run_id: "run:one", room_id: "room:one", environment_binding_id: "environment:one",
  source_id: "source:one", subject_binding_id: "subject:one",
  action_authority_id: "authority:one", authority_policy_version: 4,
} }, observation_producer_epoch_ref: "observation-epoch:one",
  action_producer_epoch_ref: "action-epoch:one",
  evidence: { observation: { evidence_ref: "observation:one", result: snapshot } },
  catalog: { resident_clock_observation: { producer_epoch_ref: "action-epoch:one",
    manual_input_detected: false,
    clock: { clock_kind: "minecraft_game_tick", tick_index: 113, world_tick_index: 113,
      monotonic: { origin_id: "clock:one", elapsed_ms: 6_000 } } } },
});
const frontier = () => ({ identity: {
  environment_id: "environment:one", source_id: "source:one", subject_id: "subject:one",
  producer_epoch: "action-epoch:one", authority_id: "authority:one", authority_revision: 4,
  goal_id: "goal:one", goal_revision: 2, observation_revision: 11,
  affordance_revision: 3,
}, clocks: { environment: { resolution_unit: "minecraft_world_tick", sequence: 112 } },
  expires_at_environment_sequence: 125 });
const successor = () => ({ available: true as const,
  previous_plan_id: "plan:one", previous_plan_hash: `sha256:${"b".repeat(64)}`,
  checkpoint: { event_id: "event:checkpoint:one", event_hash: `sha256:${"a".repeat(64)}`,
    checkpoint_id: "checkpoint:one" },
  predecessor_clocks: { environment: { resolution_unit: "minecraft_tick", sequence: 100 },
    monotonic: { origin_id: "clock:one" } },
});
const fixture = () => {
  const verify = vi.fn(async () => {});
  const dependencies = { resolvePerception: vi.fn(async () => context()),
    readFrontier: vi.fn(async () => frontier()), readSuccessor: vi.fn(async () => successor()) };
  const load = createVerifiedResponsesCheckpointSourceLoader(request, verify,
    dependencies as never);
  return { verify, dependencies, load };
};

describe("protected Responses checkpoint source loader", () => {
  it("derives a powerless source from the exact association, latest protected frontier and verified measured event hash", async () => {
    const { load, verify, dependencies } = fixture();
    const source = await load();
    expect(source).toMatchObject({ run_id: "run:one",
      checkpoint_event_id: "event:checkpoint:one", checkpoint_event_hash: `sha256:${"a".repeat(64)}`,
      context: { environment_id: "environment:one", goal_id: "goal:one", goal_revision: 2,
        observation_ref: "observation:one", observation_revision: 11,
        affordance_revision: 3, producer_epoch: "action-epoch:one",
        authority_id: "authority:one", authority_revision: 4,
        current_unit: 113, current_monotonic_ms: 6_000,
        maximum_proposal_horizon_units: 20, maximum_proposal_lifetime_ms: 1_000,
        interruption_pending: false } });
    expect(dependencies.readFrontier).toHaveBeenCalledWith(expect.objectContaining({
      expectedEvidenceRef: "observation:one",
      expectedObservationProducerEpoch: "observation-epoch:one",
      requireLatestForGoal: true,
    }));
    expect(verify).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(source)).not.toMatch(/private player text|private NBT|private screen text|private entity name/);
  });

  it("keeps typed headroom evidence without forwarding raw movement or chat text", () => {
    const clear: Record<string, unknown> = structuredClone(snapshot);
    clear.movement_candidates = ["forward", "back", "left", "right"].map(relative_direction => ({
      relative_direction, cardinal_direction: "north", evidence_complete: true,
      feet_clear: true, head_clear: true, drop_depth_blocks: 0,
      safe_candidate: true, support_block: "private block text",
    }));
    const blocked = structuredClone(clear);
    (blocked.movement_candidates as Array<Record<string, unknown>>)[0].head_clear = false;
    (blocked.movement_candidates as Array<Record<string, unknown>>)[0].safe_candidate = false;
    const before = summarizeResponsesCheckpointPerception(clear);
    const after = summarizeResponsesCheckpointPerception(blocked);
    expect(after).not.toBe(before);
    expect(JSON.parse(after)).toMatchObject({ safe_movement_candidate_count: 3,
      movement_options: [{ relative_direction: "forward", feet_clear: true,
        head_clear: false, safe_candidate: false }] });
    expect(after.length).toBeLessThanOrEqual(2_000);
    expect(after).not.toMatch(/private block text|private player text|private NBT/);
  });

  it("uses completed milliseconds from the native fractional monotonic clock", async () => {
    const f = fixture();
    f.dependencies.resolvePerception.mockResolvedValue({ ...context(), catalog: {
      resident_clock_observation: { ...context().catalog.resident_clock_observation,
        clock: { ...context().catalog.resident_clock_observation.clock,
          monotonic: { origin_id: "clock:one", elapsed_ms: 6_000.875 } } },
    } } as never);
    expect((await f.load())?.context.current_monotonic_ms).toBe(6_000);
  });

  it("fails before protected reads for a foreign task or mismatched run", async () => {
    const { verify, dependencies } = fixture();
    const load = createVerifiedResponsesCheckpointSourceLoader({ ...request,
      association: { ...association, runId: "run:foreign" } }, verify, dependencies as never);
    expect(await load()).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(dependencies.resolvePerception).not.toHaveBeenCalled();
  });

  it("declines provider sampling on native manual takeover or an unknown manual-input flag", async () => {
    for (const manualFlag of [true, undefined]) {
      const f = fixture();
      f.dependencies.resolvePerception.mockResolvedValue({ ...context(), catalog: {
        resident_clock_observation: { ...context().catalog.resident_clock_observation,
          manual_input_detected: manualFlag },
      } } as never);
      const fetchImpl = vi.fn(async () => new Response("unexpected")) as typeof fetch;
      expect(await invokeResponsesCheckpointWorker({ model: "gpt-4o-mini", apiKey: "test-only",
        hostDecisionId: "decision:one", requestedHorizonUnits: 5,
        requestedLifetimeMs: 250, loadVerifiedSource: f.load, fetchImpl }))
        .toEqual({ status: "unavailable", reason: "checkpoint_source_unavailable",
          execution_authority: false });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("fails closed for revoked grants, rotated identity, stale frontier, absent checkpoint and unsafe clocks", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => f.verify.mockRejectedValue(new Error("revoked")),
      (f: ReturnType<typeof fixture>) => f.dependencies.resolvePerception.mockResolvedValue({
        ...context(), goal: { ...context().goal, identity: { ...context().goal.identity,
          run_id: "run:other" } } }),
      (f: ReturnType<typeof fixture>) => f.dependencies.readFrontier.mockResolvedValue(null as never),
      (f: ReturnType<typeof fixture>) => f.dependencies.readFrontier.mockResolvedValue({
        ...frontier(), identity: { ...frontier().identity, producer_epoch: "old-epoch" } }),
      (f: ReturnType<typeof fixture>) => f.dependencies.readSuccessor.mockResolvedValue({
        available: false, reason_code: "no_current_verified_checkpoint" } as never),
      (f: ReturnType<typeof fixture>) => f.dependencies.readSuccessor.mockResolvedValue({
        ...successor(), checkpoint: { ...successor().checkpoint, event_hash: "tampered" } }),
      (f: ReturnType<typeof fixture>) => f.dependencies.readSuccessor.mockResolvedValue({
        ...successor(), checkpoint: { ...successor().checkpoint, event_hash: "a".repeat(64) } }),
      (f: ReturnType<typeof fixture>) => f.dependencies.resolvePerception.mockResolvedValue({
        ...context(), catalog: { resident_clock_observation: {
          ...context().catalog.resident_clock_observation,
          clock: { ...context().catalog.resident_clock_observation.clock,
            world_tick_index: 125 } } } }),
    ]) {
      const f = fixture();
      mutate(f);
      const result = await f.load().catch(() => null);
      expect(result).toBeNull();
    }
  });

  it("re-reads the canonical source after sampling and suppresses changed checkpoints", async () => {
    const f = fixture();
    let reads = 0;
    f.dependencies.readSuccessor.mockImplementation(async () => ({ ...successor(),
      checkpoint: { ...successor().checkpoint,
        event_hash: `sha256:${(++reads === 1 ? "a" : "c").repeat(64)}` } }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "resp:one", object: "response",
      status: "completed", error: null, incomplete_details: null,
      output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({
          disposition: "continue_same_goal", rationale_code: "path_clear" }) }] }] }),
    { status: 200 })) as typeof fetch;
    const result = await invokeResponsesCheckpointWorker({ model: "gpt-4o-mini", apiKey: "test-only",
      hostDecisionId: "decision:one", requestedHorizonUnits: 5, requestedLifetimeMs: 250,
      loadVerifiedSource: f.load, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.verify).toHaveBeenCalledTimes(6);
    expect(result).toEqual({ status: "unavailable", reason: "checkpoint_source_changed",
      execution_authority: false });
  });

  it("never calls Responses when protected association verification fails", async () => {
    const f = fixture();
    f.verify.mockRejectedValue(new Error("revoked"));
    const fetchImpl = vi.fn(async () => new Response("unexpected")) as typeof fetch;
    const result = await invokeResponsesCheckpointWorker({ model: "gpt-4o-mini", apiKey: "test-only",
      hostDecisionId: "decision:one", requestedHorizonUnits: 5, requestedLifetimeMs: 250,
      loadVerifiedSource: f.load, fetchImpl });
    expect(result).toEqual({ status: "unavailable", reason: "checkpoint_source_unavailable",
      execution_authority: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(f.dependencies.resolvePerception).not.toHaveBeenCalled();
  });
});

it("summarizes only numeric/boolean perception fields", () => {
  const summary = summarizeResponsesCheckpointPerception(snapshot);
  expect(JSON.parse(summary)).toMatchObject({ game_tick: 112, health: 16,
    critical_hazard_count: 1, hostile_entity_count: 1, safe_movement_candidate_count: 1 });
  expect(summary).not.toMatch(/private|chat|NBT|display_name/);
});
