import { afterEach, expect, it, vi } from "vitest";
import * as perception from "../../temporal-plans/temporal-perception-context";
import { readBoundSessionEvidence, type BoundSessionEvidenceInput } from "../bound-session-evidence";

afterEach(() => vi.restoreAllMocks());

it("awaits durable authorization before perception and rejects asynchronous revocation after it", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const read = vi.spyOn(perception, "resolveTemporalPerceptionContext").mockResolvedValue({} as never);
  const verifyTaskAssociation = vi.fn().mockImplementationOnce(async () => {
    await pending; return {};
  }).mockRejectedValueOnce(new Error("pairing_revoked"));
  const outcome = readBoundSessionEvidence(request(), { verifyTaskAssociation });
  const rejected = expect(outcome).rejects.toThrow("pairing_revoked");
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  release();
  await rejected;
  expect(read).toHaveBeenCalledTimes(1);
  expect(verifyTaskAssociation).toHaveBeenCalledTimes(2);
});

const request = (): BoundSessionEvidenceInput => ({
  context: { profileId: "profile:a", participantId: "participant:a", runId: "run:a",
    goalId: "goal:a", expectedRevision: 1, roomId: "room:a", turnId: "turn:a",
    priorTurnId: "turn:prior", probeRequestId: "probe:a" },
  binding: { profileRef: "profile:a", authenticatedMcpClientRef: "client:a",
    clientSessionRef: "session:a", clientContinuationRef: "task:a", bindingId: "binding:a",
    bindingEpoch: 1, helixConversationId: "chat:a", missionId: null, runId: "run:a" },
});

it.each(["profile", "run", "chat_only"])("rejects %s context before collecting evidence", async kind => {
  const input = request();
  if (kind === "profile") input.context.profileId = "profile:b";
  if (kind === "run") input.context.runId = "run:b";
  if (kind === "chat_only") input.context.runId = input.binding.runId = null;
  const read = vi.spyOn(perception, "resolveTemporalPerceptionContext");
  const verifyTaskAssociation = vi.fn();
  await expect(readBoundSessionEvidence(input, { verifyTaskAssociation }))
    .rejects.toThrow("temporal_plan_task_context_mismatch");
  expect(read).not.toHaveBeenCalled();
  expect(verifyTaskAssociation).not.toHaveBeenCalled();
});

it("preserves exact selectors and reads again without repairing or rotating state", async () => {
  const input = request();
  const before = structuredClone(input);
  const read = vi.spyOn(perception, "resolveTemporalPerceptionContext")
    .mockResolvedValue({ goal: { goal_id: "goal:a", goal_revision: 1 } } as never);
  const verifyTaskAssociation = vi.fn().mockReturnValue({ reasoning_binding_id: "binding:a" });
  for (let index = 0; index < 3; index++) {
    await expect(readBoundSessionEvidence(input, { verifyTaskAssociation })).resolves.toMatchObject({
      binding: { reasoning_binding_id: "binding:a" }, execution_authority: false,
      answer_authority: false, terminal_eligible: false,
    });
  }
  expect(read).toHaveBeenCalledTimes(3);
  expect(read).toHaveBeenLastCalledWith(input.context);
  expect(verifyTaskAssociation).toHaveBeenCalledTimes(6);
  expect(verifyTaskAssociation).toHaveBeenLastCalledWith(input.binding);
  expect(input).toEqual(before);
});

it("propagates stale goal or perception instead of treating binding as readiness", async () => {
  vi.spyOn(perception, "resolveTemporalPerceptionContext")
    .mockRejectedValue(new Error("durable_goal_authority_stale"));
  const verifyTaskAssociation = vi.fn().mockReturnValue({});
  await expect(readBoundSessionEvidence(request(), { verifyTaskAssociation }))
    .rejects.toThrow("durable_goal_authority_stale");
  expect(verifyTaskAssociation).toHaveBeenCalledTimes(1);
});

it("rejects a binding revoked during evidence collection", async () => {
  vi.spyOn(perception, "resolveTemporalPerceptionContext").mockResolvedValue({} as never);
  const verifyTaskAssociation = vi.fn().mockReturnValueOnce({})
    .mockImplementationOnce(() => { throw new Error("reasoning_binding_revoked"); });
  await expect(readBoundSessionEvidence(request(), { verifyTaskAssociation }))
    .rejects.toThrow("reasoning_binding_revoked");
});
