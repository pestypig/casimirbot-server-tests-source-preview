import { describe, expect, it, vi } from "vitest";
import { materializeHelixEnvironmentActionChoice,
  type VerifiedHelixEnvironmentActionChoiceSource } from
  "@shared/helix-environment-action-choice";
import { publishResponsesActionActivity } from
  "../operator-activity-responses-action-publisher";

const h = (char: string) => `sha256:${char.repeat(64)}`;
const source = (): VerifiedHelixEnvironmentActionChoiceSource => ({
  context: { run_id: "run:one", reasoning_binding_id: "binding:one", binding_epoch: 2,
    environment_id: "environment:one", source_id: "source:one", subject_id: "player:one",
    goal_id: "goal:one", goal_revision: 3, predecessor_plan_id: "plan:previous",
    predecessor_plan_hash: h("a"), checkpoint_id: "checkpoint:one",
    checkpoint_event_id: "event:one", checkpoint_event_hash: h("b"),
    observation_ref: "observation:one", observation_revision: 4,
    affordance_revision: 5, producer_epoch: "epoch:one", authority_id: "authority:one",
    authority_revision: 6, monotonic_origin_id: "clock:one", current_unit: 100,
    current_monotonic_ms: 1_000, maximum_proposal_horizon_units: 20,
    maximum_proposal_lifetime_ms: 1_000, interruption_pending: false },
  observation_summary: "health:20, hazard_count:0",
  candidates: [{ candidate_id: "advance:one", plan_id: "plan:advance",
    plan_hash: h("c"), action_code: "walk_to_waypoint",
    target_ref: "waypoint:one", estimated_units: 10 }],
});
const receipt = () => {
  const verdict = materializeHelixEnvironmentActionChoice({
    untrustedChoice: { choice_id: "advance:one", rationale_code: "private_reason" },
    invocationSource: source(), currentSource: source(), hostDecisionId: "decision:one",
    requestedHorizonUnits: 10, requestedLifetimeMs: 500,
  });
  if (!verdict.accepted) throw new Error("fixture invalid");
  return { status: "proposed" as const, proposal: verdict.proposal,
    provider_response_ref: "response:one", execution_authority: false as const };
};
const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "mcp:one",
  clientSessionRef: "client:one", clientContinuationRef: "task:one",
  bindingId: "binding:one", bindingEpoch: 2, helixConversationId: "chat:one",
  missionId: null, runId: "run:one" };
const actionScope = { ownerProfileId: "profile:one", authorityId: "authority:one",
  connectorInstallationId: "node:one", environmentBindingId: "environment:one",
  roomId: "room:one", sourceId: "source:one", worldId: "world:one",
  participantId: "participant:one", subjectBindingId: "player:one" };
const input = () => ({ eventId: "responses_event:one", observedAt: "2026-10-05T12:00:00.000Z",
  binding, actionScope, receipt: receipt(), loadVerifiedSource: async () => source() });

describe("Responses activity publisher", () => {
  it("appends only sanitized selection with exact owner and no effect claim", async () => {
    const verifyTaskAssociation = vi.fn(async () => binding);
    const append = vi.fn(async (value: { events: unknown[] }) =>
      ({ events: value.events, replayed: [false] }));
    const result = await publishResponsesActionActivity(input(),
      { verifyTaskAssociation } as never, { append } as never);
    expect(verifyTaskAssociation).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0]).toMatchObject({
      owner: { accountProfileId: "profile:one" },
      events: [{ source_kind: "responses_action", helix_conversation_ref: "chat:one",
        reasoning_binding_ref: "binding:one", reasoning_binding_epoch: 2,
        summary: expect.stringContaining("No action started"), answer_authority: false,
        terminal_eligible: false, raw_content_included: false }],
    });
    expect(JSON.stringify(append.mock.calls[0][0])).not.toContain("private_reason");
    expect(result).toMatchObject({ execution_authority: false,
      answer_authority: false, terminal_eligible: false });
  });

  it("fails closed on source drift, wrong scope and a revoked binding before append", async () => {
    const append = vi.fn();
    const valid = input();
    const stale = source(); stale.context.goal_revision++;
    expect(await publishResponsesActionActivity({ ...valid,
      loadVerifiedSource: async () => stale },
      { verifyTaskAssociation: vi.fn() } as never, { append } as never)).toBeNull();
    expect(await publishResponsesActionActivity({ ...valid,
      actionScope: { ...actionScope, sourceId: "source:other" } },
      { verifyTaskAssociation: vi.fn() } as never, { append } as never)).toBeNull();
    const verifyTaskAssociation = vi.fn()
      .mockResolvedValueOnce(binding).mockRejectedValueOnce(new Error("revoked"));
    expect(await publishResponsesActionActivity(valid,
      { verifyTaskAssociation } as never, { append } as never)).toBeNull();
    expect(append).not.toHaveBeenCalled();
  });
});
