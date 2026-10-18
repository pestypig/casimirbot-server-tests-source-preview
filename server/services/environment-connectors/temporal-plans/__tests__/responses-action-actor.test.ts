import { describe, expect, it, vi } from "vitest";
import type { VerifiedHelixEnvironmentActionChoiceSource } from
  "@shared/helix-environment-action-choice";
import { projectResponsesActionActivity } from "../responses-action-activity";
import { invokeResponsesActionActor } from "../responses-action-actor";

const h = (char: string) => `sha256:${char.repeat(64)}`;
const source = (): VerifiedHelixEnvironmentActionChoiceSource => ({
  context: {
    run_id: "run:one", reasoning_binding_id: "binding:one", binding_epoch: 2,
    environment_id: "environment:one", source_id: "source:one", subject_id: "player:one",
    goal_id: "goal:one", goal_revision: 3,
    predecessor_plan_id: "plan:previous", predecessor_plan_hash: h("a"),
    checkpoint_id: "checkpoint:one", checkpoint_event_id: "event:one",
    checkpoint_event_hash: h("b"), observation_ref: "observation:one",
    observation_revision: 4, affordance_revision: 5,
    producer_epoch: "epoch:one", authority_id: "authority:one", authority_revision: 6,
    monotonic_origin_id: "clock:one", current_unit: 100, current_monotonic_ms: 1_000,
    maximum_proposal_horizon_units: 20, maximum_proposal_lifetime_ms: 1_000,
    interruption_pending: false,
  },
  observation_summary: "health:20, hazard_count:0, next_waypoint_reachable:true",
  candidates: [{ candidate_id: "advance:one", plan_id: "plan:advance", plan_hash: h("c"),
    action_code: "walk_to_waypoint", target_ref: "waypoint:one", estimated_units: 10 }],
});
const response = (choice: unknown = { choice_id: "advance:one", rationale_code: "route_clear" }) =>
  new Response(JSON.stringify({ id: "resp:one", object: "response", status: "completed",
    error: null, incomplete_details: null,
    output: [{ type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(choice) }] }] }),
  { status: 200, headers: { "Content-Type": "application/json" } });
const run = (overrides: Partial<Parameters<typeof invokeResponsesActionActor>[0]> = {}) =>
  invokeResponsesActionActor({ model: "gpt-4o-mini", apiKey: "test-secret-not-in-output",
    hostDecisionId: "decision:one", requestedHorizonUnits: 12,
    requestedLifetimeMs: 500, loadVerifiedSource: async () => source(),
    fetchImpl: vi.fn(async () => response()) as typeof fetch, ...overrides });

describe("bounded Responses action actor", () => {
  it("uses the native transport without a server-side API key", async () => {
    const providerTransport = vi.fn(async () => response());
    const receipt = await run({ apiKey: undefined, providerTransport,
      fetchImpl: vi.fn(() => { throw new Error("direct provider call forbidden"); }) as typeof fetch });
    expect(providerTransport).toHaveBeenCalledTimes(1);
    expect(providerTransport.mock.calls[0][0]).toMatchObject({
      model: "gpt-4o-mini", observation_summary: source().observation_summary,
      candidates: [{ candidate_id: "advance:one", action_code: "walk_to_waypoint" }],
    });
    expect(receipt).toMatchObject({ status: "proposed", execution_authority: false });
  });
  it("offers only host-prepared action IDs through one strict no-tools Responses call", async () => {
    const fetchImpl = vi.fn(async () => response()) as typeof fetch;
    const receipt = await run({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ model: "gpt-4o-mini", store: false,
      tools: [], parallel_tool_calls: false,
      text: { format: { type: "json_schema", strict: true,
        schema: { properties: { choice_id: { enum: ["advance:one", "hold_safe",
          "escalate_to_codex"] } }, additionalProperties: false } } } });
    expect(request).not.toHaveProperty("previous_response_id");
    expect(JSON.stringify(request)).not.toContain("plan_hash");
    expect(receipt).toMatchObject({ status: "proposed", provider_response_ref: "resp:one",
      execution_authority: false, proposal: { choice_id: "advance:one", plan_hash: h("c"),
        execution_authority: false, answer_authority: false, terminal_eligible: false } });
    expect(JSON.stringify(receipt)).not.toContain("test-secret-not-in-output");
  });

  it("does not call the provider for absent or interrupted canonical source", async () => {
    const fetchImpl = vi.fn(async () => response()) as typeof fetch;
    expect(await run({ fetchImpl, loadVerifiedSource: async () => null }))
      .toMatchObject({ status: "unavailable", reason: "source_unavailable" });
    const interrupted = source(); interrupted.context.interruption_pending = true;
    expect(await run({ fetchImpl, loadVerifiedSource: async () => interrupted }))
      .toMatchObject({ status: "unavailable", reason: "source_unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fences an answer after binding, plan, candidate or clock changes", async () => {
    for (const change of [
      (s: VerifiedHelixEnvironmentActionChoiceSource) => { s.context.binding_epoch++; },
      (s: VerifiedHelixEnvironmentActionChoiceSource) => { s.context.goal_revision++; },
      (s: VerifiedHelixEnvironmentActionChoiceSource) => { s.candidates[0].plan_hash = h("f"); },
      (s: VerifiedHelixEnvironmentActionChoiceSource) => { s.context.current_unit = 113; },
      (s: VerifiedHelixEnvironmentActionChoiceSource) => { s.context.interruption_pending = true; },
    ]) {
      let reads = 0;
      const result = await run({ loadVerifiedSource: async () => {
        const next = source(); if (++reads === 2) change(next); return next;
      } });
      expect(result.status).toBe("rejected");
      expect(reads).toBe(2);
    }
  });

  it("rejects unknown IDs, tool calls, refusals and smuggled keypresses", async () => {
    expect(await run({ fetchImpl: vi.fn(async () => response({ choice_id: "unknown",
      rationale_code: "guess" })) as typeof fetch }))
      .toMatchObject({ status: "rejected", reason: "candidate_unavailable" });
    expect(await run({ fetchImpl: vi.fn(async () => response({ choice_id: "advance:one",
      rationale_code: "go", keys: ["W"] })) as typeof fetch }))
      .toMatchObject({ status: "rejected", reason: "invalid_choice" });
    const refusal = new Response(JSON.stringify({ object: "response", status: "completed",
      output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "refusal", refusal: "private refusal text" }] }] }), { status: 200 });
    const result = await run({ fetchImpl: vi.fn(async () => refusal.clone()) as typeof fetch });
    expect(result).toMatchObject({ status: "rejected", reason: "response_refusal" });
    expect(JSON.stringify(result)).not.toContain("private refusal text");
    const toolCall = new Response(JSON.stringify({ object: "response", status: "completed",
      output: [{ type: "function_call", name: "walk", arguments: "{}" }] }), { status: 200 });
    expect(await run({ fetchImpl: vi.fn(async () => toolCall.clone()) as typeof fetch }))
      .toMatchObject({ status: "rejected", reason: "response_output_invalid" });
  });

  it("fails closed on provider errors, oversized output, cancellation and timeout", async () => {
    expect(await run({ fetchImpl: vi.fn(async () => new Response("private", { status: 429 })) as typeof fetch }))
      .toMatchObject({ status: "unavailable", reason: "provider_http_error" });
    expect(await run({ fetchImpl: vi.fn(async () => new Response("x".repeat(65_537))) as typeof fetch }))
      .toMatchObject({ status: "unavailable", reason: "provider_response_oversize" });
    const canceled = new AbortController(); canceled.abort();
    expect(await run({ signal: canceled.signal })).toMatchObject({ status: "unavailable",
      reason: "provider_canceled" });
    const pending = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })) as typeof fetch;
    expect(await run({ fetchImpl: pending, timeoutMs: 100 }))
      .toMatchObject({ status: "unavailable", reason: "provider_timeout" });
  });

  it("projects an exact-binding activity decision without raw model text or an effect claim", async () => {
    const receipt = await run();
    const activity = projectResponsesActionActivity({ eventId: "activity:one",
      helixConversationId: "chat:one", source: source(), receipt,
      observedAt: "2026-10-05T12:00:00.000Z" });
    expect(activity).toMatchObject({ phase: "proposed", reasoning_binding_id: "binding:one",
      binding_epoch: 2, goal_revision: 3, action_code: "walk_to_waypoint",
      action_performed: false, private_reasoning_included: false,
      execution_authority: false });
    expect(JSON.stringify(activity)).not.toMatch(/route_clear|test-secret-not-in-output/i);
    const stale = source(); stale.context.goal_revision++;
    expect(projectResponsesActionActivity({ eventId: "activity:two",
      helixConversationId: "chat:one", source: stale, receipt,
      observedAt: "2026-10-05T12:00:00.000Z" })).toBeNull();
  });
});
