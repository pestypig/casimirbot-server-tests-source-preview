import { expect, it, vi } from "vitest";
import { ENVIRONMENT_SESSION_LAYERS, projectEnvironmentSessionReadiness } from "@shared/helix-environment-session-readiness";
import { readyUpEnvironmentSession } from "../ready-up-session";
import type { EnvironmentSessionReadinessInput } from "../session-readiness";
import { RoomEnvironmentSubjectError } from "../../subjects/subject-binding-store";
import { EnvironmentDurableGoalError } from "../../goals/durable-goal-store";

function fixture(stale = false) {
  const input = { context: { profileId: "profile:a", roomId: "room:a", participantId: "participant:a" },
    binding: { bindingId: "binding:a" }, environmentBindingId: "environment:a",
    sourceId: "source:a", worldId: "world:a", subjectBindingId: "subject:a" } as EnvironmentSessionReadinessInput;
  const snapshot = () => projectEnvironmentSessionReadiness({ context_ref: "context:a", now_ms: 1,
    maximum_check_age_ms: 5_000, checks: ENVIRONMENT_SESSION_LAYERS.map(layer => ({
      layer, state: stale && layer === "subject" ? "stale" : "verified",
      context_ref: "context:a", evidence_ref: "evidence:a", observed_at_ms: 1,
      expires_at_ms: null, reason_codes: [], human_approval_required: false,
    })) });
  const prior = { subject_binding_id: "subject:a", participant_id: "participant:a", status: "stale",
    subject_ref: "selected:a", producer_epoch_ref: "epoch:old" };
  const dependencies = {
    inspect: vi.fn().mockImplementation(async () => snapshot()),
    environments: vi.fn().mockResolvedValue([{ environment_binding_id: "environment:a", room_id: "room:a",
      source_id: "source:a", world_id: "world:a", self_subject_binding: prior }]),
    refreshSubject: vi.fn().mockImplementation(async () => { stale = false; return { ...prior, producer_epoch_ref: "epoch:new" }; }),
    recoverGoal: vi.fn(),
  };
  const bindingStore = { verifyTaskAssociation: vi.fn() };
  return { input, dependencies, bindingStore,
    run: () => readyUpEnvironmentSession(input, bindingStore, dependencies) };
}

it("three healthy Ready up calls perform no repair", async () => {
  const f = fixture();
  for (let index = 0; index < 3; index++) {
    expect(await f.run()).toMatchObject({ repairs: [], readiness: { ready: true }, execution_authority: false });
  }
  expect(f.dependencies.inspect).toHaveBeenCalledTimes(3);
  expect(f.dependencies.environments).not.toHaveBeenCalled();
  expect(f.dependencies.refreshSubject).not.toHaveBeenCalled();
});

it("repairs the exact stale subject once and subsequent calls are no-ops", async () => {
  const f = fixture(true);
  expect(await f.run()).toMatchObject({ repairs: [{ layer: "subject", changed: true }], readiness: { ready: true } });
  await f.run(); await f.run();
  expect(f.dependencies.refreshSubject).toHaveBeenCalledTimes(1);
  expect(f.dependencies.refreshSubject).toHaveBeenCalledWith({ roomId: "room:a", profileId: "profile:a",
    environmentBindingId: "environment:a", subjectRef: "selected:a", subjectBindingId: "subject:a",
    expectedProducerEpochRef: "epoch:old" });
});

it("does not treat an attempted repair as readiness", async () => {
  const f = fixture(true);
  f.dependencies.refreshSubject.mockRejectedValue(new RoomEnvironmentSubjectError("subject_binding_stale", 409, "expired"));
  const result = await f.run();
  expect(result.readiness.ready).toBe(false);
  expect(result.repairs).toEqual([{ layer: "subject", changed: false, reason_code: "subject_binding_stale" }]);
});

it("does not repair a replaced subject or choose the latest available environment", async () => {
  const f = fixture(true);
  f.dependencies.environments.mockResolvedValue([{ environment_binding_id: "environment:other" }]);
  expect((await f.run()).readiness.ready).toBe(false);
  expect(f.dependencies.refreshSubject).not.toHaveBeenCalled();
});

it("rechecks the binding before mutation", async () => {
  const f = fixture(true);
  f.bindingStore.verifyTaskAssociation.mockImplementation(() => { throw new Error("revoked"); });
  await expect(f.run()).rejects.toThrow("revoked");
  expect(f.dependencies.refreshSubject).not.toHaveBeenCalled();
});

function readinessWithBlockedLayers(...blocked: string[]) {
  return projectEnvironmentSessionReadiness({ context_ref: "context:a", now_ms: 1,
    maximum_check_age_ms: 5_000, checks: ENVIRONMENT_SESSION_LAYERS.map(layer => ({
      layer, state: blocked.includes(layer) ? "stale" : "verified",
      context_ref: "context:a", evidence_ref: "evidence:a", observed_at_ms: 1,
      expires_at_ms: null, reason_codes: [], human_approval_required: false,
    })) });
}

it("rechecks the recovered goal revision rather than treating recovery as readiness", async () => {
  const f = fixture();
  f.dependencies.inspect.mockResolvedValue(readinessWithBlockedLayers("goal"));
  f.dependencies.recoverGoal.mockResolvedValue({ changed: true, goal: { revision: 42 } });
  const result = await f.run();
  expect(f.dependencies.recoverGoal).toHaveBeenCalledWith(f.input, f.bindingStore);
  expect(f.dependencies.inspect).toHaveBeenLastCalledWith({ ...f.input,
    context: { ...f.input.context, expectedRevision: 42 } }, f.bindingStore);
  expect(result.repairs).toEqual([{ layer: "goal", changed: true, reason_code: "goal_recovery_checked" }]);
  expect(result.readiness.ready).toBe(false);
  expect(result.execution_authority).toBe(false);
});

it.each(["source", "subject", "authority", "controller"])(
  "does not recover a goal while %s remains unverified", async layer => {
    const f = fixture();
    f.dependencies.inspect.mockResolvedValue(readinessWithBlockedLayers("goal", layer));
    // No matching subject is available to repair the stale-subject variant.
    f.dependencies.environments.mockResolvedValue([]);
    expect((await f.run()).readiness.ready).toBe(false);
    expect(f.dependencies.recoverGoal).not.toHaveBeenCalled();
  },
);

it("reports uncertain partial recovery on a typed conflict and does not retry", async () => {
  const f = fixture();
  f.dependencies.inspect.mockResolvedValue(readinessWithBlockedLayers("goal"));
  f.dependencies.recoverGoal.mockRejectedValue(new EnvironmentDurableGoalError(
    "durable_goal_revision_conflict", 409, "concurrent revision"));
  const result = await f.run();
  expect(result.repairs).toEqual([{ layer: "goal", changed: null,
    reason_code: "durable_goal_revision_conflict" }]);
  expect(f.dependencies.recoverGoal).toHaveBeenCalledTimes(1);
  expect(f.dependencies.inspect).toHaveBeenCalledTimes(2);
  expect(result.readiness.ready).toBe(false);
});

it("propagates unexpected recovery failures instead of reporting a healthy session", async () => {
  const f = fixture();
  f.dependencies.inspect.mockResolvedValue(readinessWithBlockedLayers("goal"));
  f.dependencies.recoverGoal.mockRejectedValue(new Error("storage unavailable"));
  await expect(f.run()).rejects.toThrow("storage unavailable");
  expect(f.dependencies.recoverGoal).toHaveBeenCalledTimes(1);
});
