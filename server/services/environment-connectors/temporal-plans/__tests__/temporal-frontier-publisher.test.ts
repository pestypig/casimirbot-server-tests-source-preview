import { afterEach, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { buildHelixEnvironmentAffordanceFrontier, helixEnvironmentThreeClockSchema } from "@shared/helix-environment-time";
import * as context from "../temporal-perception-context";
import * as successor from "../temporal-successor-context";
import { EnvironmentTemporalFrontierStore } from "../temporal-frontier-store";
import { publishTemporalPerceptionFrontier } from "../temporal-frontier-publisher";
afterEach(() => { vi.restoreAllMocks(); });
it.each(["valid", "delayed_response", "diagnostic_failure", "successor_failure", "missing_tick", "missing_resident_clock", "behind", "expired", "last_valid_tick", "wrong_epoch", "live_clock_pair"])("derives a non-authoritative frontier from resolved inputs (%s)", async scenario => {
  let now = 1_000_000_000.375;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const diagnostic = vi.spyOn(console, "info").mockImplementation(() => {
    if (scenario === "diagnostic_failure") throw new Error("diagnostic sink failed");
  });
  vi.spyOn(successor, "readTemporalSuccessorContext").mockImplementation(async () => {
    if (scenario === "successor_failure") throw new Error("context unavailable");
    if (scenario === "delayed_response") now += 17;
    return { available: false, reason_code: "no_current_verified_checkpoint",
      execution_authority: false, answer_authority: false, terminal_eligible: false };
  });
  vi.spyOn(context, "resolveTemporalPerceptionContext").mockResolvedValue({
    goal: { goal_id: "goal:test", goal_revision: 1, identity: { environment_binding_id: "environment:test", source_id: "source:test",
      subject_binding_id: "subject:test", action_authority_id: "authority:test", authority_policy_version: 1 } },
    observation_producer_epoch_ref: "epoch:observation", action_producer_epoch_ref: "epoch:action",
    evidence: { observation: { evidence_ref: "evidence:test", observed_at: "2026-09-05T00:00:00Z",
      result: { game_tick: scenario === "missing_tick" ? undefined : scenario === "live_clock_pair" ? 7588883 : 100, observation_revision: 7 } } },
    catalog: {
      context: { catalogSnapshotId: "catalog:test", private_internal_sentinel: "never-project" },
      resident_clock_observation: scenario === "missing_resident_clock" ? null : {
        producer_epoch_ref: scenario === "wrong_epoch" ? "epoch:other" : "epoch:action", heartbeat_id: "heartbeat:test",
        clock: { clock_id: "clock:resident", clock_kind: "minecraft_game_tick",
          world_tick_index: scenario === "behind" ? 99 : scenario === "expired" ? 200 : scenario === "last_valid_tick" ? 199 : scenario === "live_clock_pair" ? 7588912 : 100,
          monotonic: { origin_id: "resident-origin:test", elapsed_ms: 10 } },
        clock_extrapolated: false, execution_authority: false,
      },
      capabilities: [
      { capability_id: "move", capability_version: 1, policy_listed: true, native_fabric_available: true },
      { capability_id: "denied", capability_version: 1, policy_listed: false, native_fabric_available: true },
    ] },
  } as unknown as Awaited<ReturnType<typeof context.resolveTemporalPerceptionContext>>);
  // Exercise the production builder/schema boundary, not an unconditional receipt.
  const publish = vi.spyOn(EnvironmentTemporalFrontierStore.prototype, "publish").mockImplementation(async input => {
    if (scenario === "delayed_response") now += 23;
    return ({
    created: true,
    frontier: buildHelixEnvironmentAffordanceFrontier({ ...input.draft,
      frontier_id: "environment_frontier:test",
      identity: { ...input.draft.identity, affordance_revision: 1 } }),
  }); });
  const result = publishTemporalPerceptionFrontier({ goalId: "goal:test", profileId: "profile:test", participantId: "participant:test",
    expectedRevision: 1, roomId: "room:test", runId: null, turnId: "turn:test", priorTurnId: "turn:prior", probeRequestId: "probe:test" });
  if (scenario === "successor_failure") {
    await expect(result).rejects.toThrow("context unavailable");
    expect(publish).toHaveBeenCalledOnce();
    expect(diagnostic).not.toHaveBeenCalled();
  } else if (["missing_tick", "behind", "expired", "wrong_epoch"].includes(scenario)) {
    await expect(result).rejects.toThrow(scenario === "missing_tick" ? "temporal_frontier_observation_clock_invalid" : scenario === "expired" ? "temporal_frontier_resident_clock_expired" : "temporal_frontier_resident_clock_unmapped");
    expect(publish).not.toHaveBeenCalled();
    expect(diagnostic).not.toHaveBeenCalled();
  } else {
    const receipt = await result;
    expect(diagnostic).toHaveBeenCalledOnce();
    const [label, timing] = diagnostic.mock.calls[0];
    expect(label).toBe("[temporal-frontier-response-timing]");
    expect(timing).toMatchObject({ frontier_id: "environment_frontier:test",
      producer_epoch_ref: "epoch:action", provider_receipt_proven: false,
      execution_authority: false, live_acceptance: false });
    expect(timing.response_ready_ms - timing.request_received_ms).toBe(scenario === "delayed_response" ? 40 : 0);
    expect(JSON.stringify(timing)).not.toContain("never-project");
    expect(receipt).toMatchObject({ resident_clock_alignment_proven: false, execution_authority: false,
      planning_context: { catalog_snapshot_id: "catalog:test", observation_producer_epoch_ref: "epoch:observation",
        action_producer_epoch_ref: "epoch:action", clock_extrapolated: false, execution_authority: false,
        answer_authority: false, terminal_eligible: false } });
    expect(JSON.stringify(receipt)).not.toContain("never-project");
    if (scenario === "missing_resident_clock") expect(receipt.planning_context.resident_clock_observation).toBeNull();
    else expect(receipt.planning_context.resident_clock_observation).toMatchObject({
      clock: { monotonic: { origin_id: "resident-origin:test", elapsed_ms: 10 } },
    });
    expect(publish.mock.calls[0][0].draft.entries.map(entry => entry.state)).toEqual(["conditional", "blocked"]);
    expect(publish.mock.calls[0][0].draft.identity.observation_revision).toBe(7);
    const expectedTick = scenario === "live_clock_pair" ? 7588883 : 100;
    expect(publish.mock.calls[0][0].draft.clocks.environment.sequence).toBe(expectedTick);
    expect(publish.mock.calls[0][0].draft.expires_at_environment_sequence).toBe(expectedTick + 100);
    const clocks = publish.mock.calls[0][0].draft.clocks;
    expect(helixEnvironmentThreeClockSchema.safeParse(clocks).success).toBe(true);
    expect(Number.isSafeInteger(clocks.monotonic.elapsed_ms)).toBe(true);
    expect(clocks.monotonic.origin_id).toMatch(/^frontier_publication_clock:/u);
  }
});

it("waits for an actual same-epoch resident heartbeat before publishing a moving-player frontier", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(successor, "readTemporalSuccessorContext").mockResolvedValue({
    available: false, reason_code: "no_current_verified_checkpoint",
    execution_authority: false, answer_authority: false, terminal_eligible: false,
  });
  const makeContext = (worldTick: number, epoch = "epoch:action") => ({
    goal: { goal_id: "goal:test", goal_revision: 1, identity: {
      environment_binding_id: "environment:test", source_id: "source:test",
      subject_binding_id: "subject:test", action_authority_id: "authority:test",
      authority_policy_version: 1,
    } },
    observation_producer_epoch_ref: "epoch:observation", action_producer_epoch_ref: "epoch:action",
    evidence: { observation: { evidence_ref: "evidence:test", observed_at: "2026-09-05T00:00:00Z",
      result: { game_tick: 100, observation_revision: 7 } } },
    catalog: { context: { catalogSnapshotId: "catalog:test" },
      resident_clock_observation: { producer_epoch_ref: epoch,
        clock: { clock_kind: "minecraft_game_tick", world_tick_index: worldTick,
          monotonic: { origin_id: "resident:test", elapsed_ms: 10 } } },
      capabilities: [{ capability_id: "move", capability_version: 1,
        policy_listed: true, native_fabric_available: true }] },
  }) as unknown as Awaited<ReturnType<typeof context.resolveTemporalPerceptionContext>>;
  const resolve = vi.spyOn(context, "resolveTemporalPerceptionContext")
    .mockResolvedValueOnce(makeContext(99)).mockResolvedValueOnce(makeContext(100));
  const publish = vi.spyOn(EnvironmentTemporalFrontierStore.prototype, "publish")
    .mockImplementation(async input => ({ created: true, frontier: buildHelixEnvironmentAffordanceFrontier({
      ...input.draft, frontier_id: "environment_frontier:test",
      identity: { ...input.draft.identity, affordance_revision: 1 },
    }) }));
  const input = { goalId: "goal:test", profileId: "profile:test", participantId: "participant:test",
    expectedRevision: 1, roomId: "room:test", runId: null, turnId: "turn:test",
    priorTurnId: "turn:prior", probeRequestId: "probe:test" };
  const result = await publishTemporalPerceptionFrontier(input);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenCalledOnce();
  expect(result.planning_context.resident_clock_observation?.clock.world_tick_index).toBe(100);
  expect(result.resident_clock_alignment_proven).toBe(false);

  resolve.mockReset().mockResolvedValueOnce(makeContext(99))
    .mockResolvedValueOnce(makeContext(100, "epoch:other"));
  publish.mockClear();
  await expect(publishTemporalPerceptionFrontier(input))
    .rejects.toThrow("temporal_frontier_resident_clock_unmapped");
  expect(publish).not.toHaveBeenCalled();

  resolve.mockReset().mockResolvedValueOnce(makeContext(99))
    .mockRejectedValueOnce(new Error("durable_goal_evidence_stale"));
  await expect(publishTemporalPerceptionFrontier(input))
    .rejects.toThrow("durable_goal_evidence_stale");
  expect(publish).not.toHaveBeenCalled();

  resolve.mockReset().mockResolvedValueOnce(makeContext(99))
    .mockRejectedValueOnce(new Error("durable_goal_authority_stale"));
  await expect(publishTemporalPerceptionFrontier(input))
    .rejects.toThrow("durable_goal_authority_stale");
  expect(publish).not.toHaveBeenCalled();
});
