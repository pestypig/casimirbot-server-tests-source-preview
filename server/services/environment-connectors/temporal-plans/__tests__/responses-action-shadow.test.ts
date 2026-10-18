import { describe, expect, it, vi } from "vitest";
import type { VerifiedHelixEnvironmentActionChoiceSource } from
  "@shared/helix-environment-action-choice";
import { runResponsesActionShadow } from "../responses-action-shadow";

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
const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "mcp:one",
  clientSessionRef: "client:one", clientContinuationRef: "task:one",
  bindingId: "binding:one", bindingEpoch: 2,
  helixConversationId: "chat:one", missionId: null, runId: "run:one" };
const actionScope = { ownerProfileId: "profile:one", authorityId: "authority:one",
  connectorInstallationId: "node:one", environmentBindingId: "environment:one",
  roomId: "room:one", sourceId: "source:one", worldId: "world:one",
  participantId: "participant:one", subjectBindingId: "player:one" };
const response = () => new Response(JSON.stringify({ id: "response:one",
  object: "response", status: "completed", error: null, incomplete_details: null,
  output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify({
      choice_id: "advance:one", rationale_code: "private_reason" }) }] }] }),
  { status: 200, headers: { "Content-Type": "application/json" } });
const input = () => ({ model: "gpt-4o-mini", apiKey: "test-secret",
  hostDecisionId: "decision:one", requestedHorizonUnits: 10,
  requestedLifetimeMs: 500, binding, actionScope,
  eventId: "responses_event:one", observedAt: () => "2026-10-05T12:00:00.000Z",
  loadVerifiedSource: async () => source(),
  fetchImpl: vi.fn(async () => response()) as typeof fetch });

describe("one bounded Responses shadow handoff", () => {
  it("verifies binding, makes one model call and publishes a powerless choice", async () => {
    const verifyTaskAssociation = vi.fn(async () => binding);
    const publish = vi.fn(async (entry: { receipt: { status: string } }) => ({
      activity_event: { source_kind: "responses_action" }, replayed: false,
    }));
    const value = input();
    const result = await runResponsesActionShadow(value,
      { verifyTaskAssociation } as never, { publish: publish as never });
    expect(result).toEqual({ status: "published", reason: null, execution_authority: false });
    expect(value.fetchImpl).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "responses_event:one", binding,
      receipt: expect.objectContaining({ status: "proposed",
        proposal: expect.objectContaining({ choice_id: "advance:one",
          execution_authority: false }) }),
    }), expect.anything());
    expect(JSON.stringify(result)).not.toMatch(/private_reason|test-secret/);
  });

  it("never calls the provider for a revoked binding or a wrong source scope", async () => {
    const value = input();
    const publish = vi.fn();
    expect(await runResponsesActionShadow(value,
      { verifyTaskAssociation: vi.fn(async () => { throw new Error("revoked"); }) } as never,
      { publish: publish as never })).toMatchObject({ status: "skipped",
        reason: "binding_unavailable" });
    expect(value.fetchImpl).not.toHaveBeenCalled();
    const wrong = source(); wrong.context.reasoning_binding_id = "binding:other";
    expect(await runResponsesActionShadow({ ...value,
      loadVerifiedSource: async () => wrong },
      { verifyTaskAssociation: vi.fn(async () => binding) } as never,
      { publish: publish as never })).toMatchObject({ status: "skipped",
        reason: "source_unavailable" });
    expect(value.fetchImpl).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes a stable provider refusal as a rejected, no-effect activity", async () => {
    const value = input();
    value.fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: "response:refused", object: "response", status: "completed",
      output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "refusal", refusal: "private provider text" }] }],
    }), { status: 200 })) as typeof fetch;
    const publish = vi.fn(async (entry: { receipt: { status: string; reason: string } }) => ({
      activity_event: { phase: "rejected" }, replayed: false,
    }));
    expect(await runResponsesActionShadow(value,
      { verifyTaskAssociation: vi.fn(async () => binding) } as never,
      { publish: publish as never })).toEqual({
      status: "published", reason: null, execution_authority: false,
    });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      receipt: expect.objectContaining({ status: "rejected",
        reason: "response_refusal", execution_authority: false }),
    }), expect.anything());
    expect(JSON.stringify(publish.mock.calls)).not.toContain("private provider text");
  });

  it("reports missing native owner approval without publishing or calling the provider", async () => {
    const value = input();
    const publish = vi.fn();
    const result = await runResponsesActionShadow({ ...value,
      providerTransport: async () => new Response(JSON.stringify({
        error: "responses_action_owner_approval_required",
      }), { status: 409 }),
    }, { verifyTaskAssociation: vi.fn(async () => binding) } as never,
    { publish: publish as never });
    expect(result).toEqual({ status: "skipped", reason: "owner_approval_required",
      execution_authority: false });
    expect(value.fetchImpl).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("discards a model choice if the verified source changes before publication", async () => {
    const value = input();
    let reads = 0;
    value.loadVerifiedSource = async () => { const next = source();
      if (++reads >= 3) next.context.goal_revision++;
      return next; };
    const publish = vi.fn();
    const result = await runResponsesActionShadow(value,
      { verifyTaskAssociation: vi.fn(async () => binding) } as never,
      { publish: publish as never });
    expect(result).toMatchObject({ status: "skipped", reason: "actor_unavailable" });
    expect(value.fetchImpl).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});
