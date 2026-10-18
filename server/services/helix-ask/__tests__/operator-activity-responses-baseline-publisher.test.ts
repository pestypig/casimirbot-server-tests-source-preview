import { describe, expect, it, vi } from "vitest";
import { publishResponsesBaselineActivity } from
  "../operator-activity-responses-baseline-publisher";

const binding = { profileRef: "profile:one", authenticatedMcpClientRef: "mcp:one",
  clientSessionRef: "client:one", clientContinuationRef: "task:one",
  bindingId: "binding:one", bindingEpoch: 2, helixConversationId: "chat:one",
  missionId: null, runId: "run:one" };
const actionScope = { ownerProfileId: "profile:one", authorityId: "authority:one",
  connectorInstallationId: "node:one", environmentBindingId: "environment:one",
  roomId: "room:one", sourceId: "source:one", worldId: "world:one",
  participantId: "participant:one", subjectBindingId: "player:one" };
const receipt = { status: "proposed" as const, choice_id: "walk_forward",
  decision_id: "decision:one", observation_ref: "observation:one",
  goal_id: "goal:one", goal_revision: 1, provider_response_ref: "resp_one",
  action_performed: false as const, execution_authority: false as const };

describe("Responses baseline activity", () => {
  it("appends a sanitized, exact-task observation without implying an action", async () => {
    const verifyTaskAssociation = vi.fn(async () => binding);
    const append = vi.fn(async (value: { events: unknown[] }) =>
      ({ events: value.events, replayed: [false] }));
    const result = await publishResponsesBaselineActivity({ binding, actionScope,
      receipt, turnId: "turn:one", observedAt: "2026-10-08T21:00:00.000Z" },
      { verifyTaskAssociation } as never, { append } as never);
    expect(verifyTaskAssociation).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0][0]).toMatchObject({
      events: [{ source_kind: "responses_action",
        source_schema: "environment.responses_baseline_activity.v1",
        helix_conversation_ref: "chat:one", reasoning_binding_ref: "binding:one",
        turn_id: "turn:one",
        lifecycle_stage: "baseline_choice_published",
        evidence_refs: ["observation:one", "goal:one"],
        summary: expect.stringContaining("No action started"),
        answer_authority: false, raw_content_included: false }],
    });
    expect(JSON.stringify(result)).not.toContain("resp_one");
  });

  it("does not publish after exact-task verification fails", async () => {
    const append = vi.fn();
    const result = await publishResponsesBaselineActivity({ binding, actionScope,
      receipt, turnId: "turn:one", observedAt: "2026-10-08T21:00:00.000Z" },
      { verifyTaskAssociation: vi.fn().mockRejectedValue(new Error("expired")) } as never,
      { append } as never);
    expect(result).toBeNull();
    expect(append).not.toHaveBeenCalled();
  });
});
