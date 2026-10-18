import { describe, expect, it, vi } from "vitest";
import { chooseResponsesBaseline, createResponsesBaselineMenu } from
  "../responses-baseline-shadow";

const snapshot = () => ({ game_tick: 120,
  actor: { position: { x: 2, y: 64, z: -4 }, health: 20,
    on_ground: true, chat: "PRIVATE PLAYER CHAT" },
  hazards: [], movement_candidates: ["forward", "back", "left", "right"]
    .map((relative_direction, index) => ({ relative_direction,
      safe_candidate: index < 2, evidence_complete: true,
      target_feet_position: { x: 2 + index, y: 64, z: -4 } })),
  ui_state: { chat: "PRIVATE SCREEN TEXT" },
});
const menu = () => createResponsesBaselineMenu({ model: "gpt-4o-mini",
  observationRef: "observation:one", snapshot: snapshot(),
  goalId: "goal:one", goalRevision: 1, objectiveText: "Move east" });
const response = (choice_id: string) => new Response(JSON.stringify({
  object: "response", status: "completed", id: "resp_one",
  output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify({
      choice_id, rationale_code: "toward_goal" }) }] }],
}), { status: 200 });

describe("Responses baseline shadow choice", () => {
  it("offers only measured safe directions without player chat or NBT", () => {
    const result = menu();
    expect(result?.candidates.map(candidate => candidate.candidate_id))
      .toEqual(["walk_forward", "walk_back"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(createResponsesBaselineMenu({ model: "gpt-4o-mini",
      observationRef: "observation:one", snapshot: { ...snapshot(),
        actor: { ...snapshot().actor, on_ground: false } },
      goalId: "goal:one", goalRevision: 1,
      objectiveText: "Move east" })).toBeNull();
  });

  it("makes one powerless model choice and rejects an unoffered direction", async () => {
    const selected = await chooseResponsesBaseline({ menu: menu()!,
      decisionId: "decision:one", verifyCurrent: vi.fn(async () => true),
      transport: vi.fn(async () => response("walk_forward")) });
    expect(selected).toMatchObject({ status: "proposed", choice_id: "walk_forward",
      observation_ref: "observation:one", action_performed: false,
      execution_authority: false });
    const invalid = await chooseResponsesBaseline({ menu: menu()!,
      decisionId: "decision:two", verifyCurrent: vi.fn(async () => true),
      transport: vi.fn(async () => response("walk_right")) });
    expect(invalid).toMatchObject({ status: "rejected", reason: "choice_not_offered",
      action_performed: false });
  });

  it("accepts an offered choice when the model writes a short human-readable rationale", async () => {
    const result = await chooseResponsesBaseline({ menu: menu()!,
      decisionId: "decision:prose-rationale", verifyCurrent: vi.fn(async () => true),
      transport: vi.fn(async () => new Response(JSON.stringify({
        object: "response", status: "completed", id: "resp_prose",
        output: [{ type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({
            choice_id: "walk_forward",
            rationale_code: "The forward square appears safe and advances the goal.",
          }) }] }],
      }), { status: 200 })) });
    expect(result).toMatchObject({ status: "proposed", choice_id: "walk_forward",
      action_performed: false, execution_authority: false });
    expect(JSON.stringify(result)).not.toContain("forward square appears safe");
  });

  it("will not call the provider or keep a choice after binding or goal drift", async () => {
    const transport = vi.fn(async () => response("walk_forward"));
    expect(await chooseResponsesBaseline({ menu: menu()!,
      decisionId: "decision:one", verifyCurrent: vi.fn(async () => false),
      transport })).toMatchObject({ status: "unavailable",
        reason: "binding_or_goal_stale" });
    expect(transport).not.toHaveBeenCalled();
    const verifyCurrent = vi.fn()
      .mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await chooseResponsesBaseline({ menu: menu()!,
      decisionId: "decision:one", verifyCurrent, transport }))
      .toMatchObject({ status: "unavailable", reason: "binding_or_goal_stale" });
  });

  it("reports only recognized native broker gates without leaking error bodies", async () => {
    for (const [brokerError, expected] of [
      ["responses_action_owner_approval_required", "owner_approval_required"],
      ["responses_action_credential_unavailable", "credential_unavailable"],
      ["PRIVATE UNTRUSTED ERROR", "provider_http_409"],
    ]) {
      const result = await chooseResponsesBaseline({ menu: menu()!,
        decisionId: "decision:gate", verifyCurrent: vi.fn(async () => true),
        transport: vi.fn(async () => new Response(JSON.stringify({ error: brokerError }),
          { status: 409 })) });
      expect(result).toMatchObject({ status: "unavailable", reason: expected,
        action_performed: false, execution_authority: false });
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    }
  });
});
