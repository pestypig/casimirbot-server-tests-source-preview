import { afterEach, expect, it, vi } from "vitest";
import * as preflightModule from "../temporal-plan-preflight";
import * as broker from "../../actions/action-broker";
import { admitDirectTemporalPlan, admitTemporalPlan } from "../temporal-plan-admission";
import * as directPreflightModule from "../temporal-plan-preflight";

afterEach(() => { vi.restoreAllMocks(); });

it("awaits asynchronous task rejection before calling the action broker", async () => {
  vi.spyOn(preflightModule, "preflightTemporalPlan").mockResolvedValue({ plan: {}, compilation: { arguments: {} } } as never);
  const enqueue = vi.spyOn(broker, "enqueueEnvironmentAction");
  const verifyTaskAssociation = vi.fn().mockRejectedValue(new Error("pairing_revoked"));
  await expect(admitTemporalPlan(input() as never, { verifyTaskAssociation })).rejects.toThrow("pairing_revoked");
  expect(enqueue).not.toHaveBeenCalled();
});
const input = () => ({ preflight: { context: { profileId: "owner", participantId: "player" },
  binding: { runId: "run", bindingId: "binding", bindingEpoch: 1, clientContinuationRef: "exact-task" },
  compilation: { target: "serial" } }, request: { run_id: "run", participant_id: "player", action_kind: "execute_sequence" } });

it("hands compiler output and retained identity to the existing broker with live task revalidation", async () => {
  const prepared = { plan: { plan_id: "plan" }, compilation: { arguments: { sequence_id: "compiled" } },
    association: { kind: "reasoning_binding", associationId: "binding", associationEpoch: 1,
      profileRef: "owner", runId: "run", roomId: "room", participantId: "player",
      continuationRef: "exact-task" } };
  vi.spyOn(preflightModule, "preflightTemporalPlan").mockResolvedValue(prepared as never);
  const enqueue = vi.spyOn(broker, "enqueueEnvironmentAction").mockResolvedValue({ action_request_id: "admitted" } as never);
  const store = { verifyTaskAssociation: vi.fn() };
  const decisionSnapshot = { proposal: { decision_id: "decision:test" },
    source: { observation_summary: "recorded source menu" } };
  expect(await admitTemporalPlan({ ...input(),
    responsesDecisionSnapshot: decisionSnapshot } as never, store as never))
    .toEqual({ action_request_id: "admitted" });
  expect(enqueue.mock.calls[0][0]).toMatchObject({ profileId: "owner", requestingParticipantId: "player",
    request: { arguments: prepared.compilation.arguments, temporal_plan: prepared.plan } });
  const retention = enqueue.mock.calls[0][1]!;
  expect(retention.retention).toMatchObject({ bindingId: "binding", bindingEpoch: 1, continuationRef: "exact-task", runId: "run" });
  expect(retention.retention.responsesDecisionSnapshot).toEqual(decisionSnapshot);
  store.verifyTaskAssociation.mockImplementation(() => { throw new Error("revoked"); });
  await expect(retention.revalidateTask()).rejects.toThrow("revoked");
});

it.each(["run_id", "participant_id", "action_kind"])("rejects mismatched %s before preflight", async key => {
  const value = input();
  (value.request as Record<string, string>)[key] = "wrong";
  const preflight = vi.spyOn(preflightModule, "preflightTemporalPlan");
  const enqueue = vi.spyOn(broker, "enqueueEnvironmentAction");
  await expect(admitTemporalPlan(value as never, { verifyTaskAssociation: vi.fn() } as never)).rejects.toThrow("temporal_admission_request_context_mismatch");
  expect(preflight).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});

it("does not enqueue after failed preflight", async () => {
  vi.spyOn(preflightModule, "preflightTemporalPlan").mockRejectedValue(new Error("stale"));
  const enqueue = vi.spyOn(broker, "enqueueEnvironmentAction");
  await expect(admitTemporalPlan(input() as never, { verifyTaskAssociation: vi.fn() } as never)).rejects.toThrow("stale");
  expect(enqueue).not.toHaveBeenCalled();
});

const directInput = () => ({ preflight: {
  context: { profileId: "owner", participantId: "player", roomId: "room", runId: "run" },
  association: { kind: "direct_mcp_client", associationId: "direct_mcp_context:owned", associationEpoch: 1,
    profileRef: "owner", roomId: "room", runId: "run", participantId: "player",
    continuationRef: "direct_mcp_session:owned" },
  compilation: { target: "serial" },
}, request: { room_id: "room", run_id: "run", participant_id: "player", action_kind: "execute_sequence" } });

it("routes a verified direct client association through the same broker and revalidates at dispatch", async () => {
  const value = directInput();
  vi.spyOn(directPreflightModule, "preflightTemporalPlanWithAssociation")
    .mockResolvedValue({ plan: { plan_id: "plan" }, compilation: { arguments: { sequence_id: "compiled" } },
      association: value.preflight.association } as never);
  const enqueue = vi.spyOn(broker, "enqueueEnvironmentAction")
    .mockResolvedValue({ action_request_id: "direct-admitted" } as never);
  const verify = vi.fn();
  await expect(admitDirectTemporalPlan(value as never, verify)).resolves.toEqual({ action_request_id: "direct-admitted" });
  expect(enqueue.mock.calls[0][1]?.retention).toMatchObject({
    bindingId: "direct_mcp_context:owned", bindingEpoch: 1,
    continuationRef: "direct_mcp_session:owned", runId: "run",
  });
  verify.mockImplementation(() => { throw new Error("direct_session_revoked"); });
  await expect(enqueue.mock.calls[0][1]?.revalidateTask()).rejects.toThrow("direct_session_revoked");
});

it.each(["room_id", "run_id", "participant_id", "action_kind"])(
  "rejects a direct %s mismatch before compilation or broker admission", async key => {
    const value = directInput();
    (value.request as Record<string, string>)[key] = "wrong";
    const preflight = vi.spyOn(directPreflightModule, "preflightTemporalPlanWithAssociation");
    const enqueue = vi.spyOn(broker, "enqueueEnvironmentAction");
    await expect(admitDirectTemporalPlan(value as never, vi.fn()))
      .rejects.toThrow("temporal_admission_request_context_mismatch");
    expect(preflight).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

it("does not accept a room-steering binding as a direct execution context", async () => {
  const value = directInput();
  value.preflight.association.kind = "reasoning_binding";
  const enqueue = vi.spyOn(broker, "enqueueEnvironmentAction");
  await expect(admitDirectTemporalPlan(value as never, vi.fn()))
    .rejects.toThrow("temporal_admission_request_context_mismatch");
  expect(enqueue).not.toHaveBeenCalled();
});
