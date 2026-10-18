import { describe, expect, it, vi } from "vitest";
import {
  invokeResponsesCheckpointWorker,
  type VerifiedResponsesCheckpointSource,
} from "../responses-checkpoint-worker";

const source = (): VerifiedResponsesCheckpointSource => ({
  run_id: "run:one", checkpoint_event_id: "event:checkpoint:one",
  checkpoint_event_hash: `sha256:${"a".repeat(64)}`,
  observation_summary: "A traversable route is blocked by one obstacle.",
  context: {
    environment_id: "environment:one", source_id: "source:one",
    subject_id: "subject:one", goal_id: "goal:one", goal_revision: 1,
    predecessor_plan_id: "plan:one", predecessor_plan_hash: `sha256:${"b".repeat(64)}`,
    checkpoint_id: "checkpoint:one", observation_ref: "observation:one",
    observation_revision: 2, affordance_revision: 3, producer_epoch: "epoch:one",
    authority_id: "authority:one", authority_revision: 4,
    monotonic_origin_id: "clock:one", current_unit: 100,
    current_monotonic_ms: 1_000, maximum_proposal_horizon_units: 10,
    maximum_proposal_lifetime_ms: 500, interruption_pending: false,
  },
});
const response = (choice: unknown = { disposition: "hold_safe", rationale_code: "route_blocked" }) =>
  new Response(JSON.stringify({ id: "resp:one", object: "response", status: "completed",
    error: null, incomplete_details: null,
    output: [{ type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(choice) }] }] }),
  { status: 200, headers: { "Content-Type": "application/json" } });
const run = (overrides: Partial<Parameters<typeof invokeResponsesCheckpointWorker>[0]> = {}) =>
  invokeResponsesCheckpointWorker({
    model: "gpt-4o-mini", apiKey: "test-credential-never-published",
    hostDecisionId: "decision:host", requestedHorizonUnits: 5,
    requestedLifetimeMs: 250, loadVerifiedSource: async () => source(),
    now: () => new Date("2026-09-30T12:00:00.000Z"),
    fetchImpl: vi.fn(async () => response()) as typeof fetch,
    ...overrides,
  });

describe("bounded Responses checkpoint worker", () => {
  it("calls the real Responses endpoint with strict no-tools output and returns only a powerless source-bound projection", async () => {
    const fetchImpl = vi.fn(async () => response()) as typeof fetch;
    const result = await run({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ model: "gpt-4o-mini", store: false,
      tools: [], parallel_tool_calls: false, max_output_tokens: 128,
      text: { format: { type: "json_schema", strict: true,
        schema: { additionalProperties: false,
          required: ["disposition", "rationale_code"] } } } });
    expect(request).not.toHaveProperty("previous_response_id");
    expect(result).toMatchObject({ status: "projected",
      checkpoint_event_id: "event:checkpoint:one", checkpoint_event_hash: `sha256:${"a".repeat(64)}`,
      provider_response_ref: "resp:one", execution_authority: false,
      outcome: { status: "proposal", disposition: "hold_safe",
        decision_id: "decision:host", execution_authority: false,
        action_authority_granted: false, answer_authority: false,
        terminal_eligible: false, raw_response_included: false } });
    expect(JSON.stringify(result)).not.toContain("test-credential-never-published");
    expect(JSON.stringify(result)).not.toContain("route_blocked");
  });

  it("does not call the provider without a verified canonical source", async () => {
    const fetchImpl = vi.fn(async () => response()) as typeof fetch;
    expect(await run({ loadVerifiedSource: async () => null, fetchImpl }))
      .toEqual({ status: "unavailable", reason: "checkpoint_source_unavailable",
        execution_authority: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await run({ loadVerifiedSource: async () => { throw new Error("private database failure"); }, fetchImpl }))
      .toMatchObject({ status: "unavailable", reason: "checkpoint_source_unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("suppresses a late proposal when the exact checkpoint event or identity rotates", async () => {
    for (const mutate of [
      (value: VerifiedResponsesCheckpointSource) => ({ ...value,
        checkpoint_event_hash: `sha256:${"c".repeat(64)}` }),
      (value: VerifiedResponsesCheckpointSource) => ({ ...value,
        observation_summary: "Different source summary." }),
      (value: VerifiedResponsesCheckpointSource) => ({ ...value,
        context: { ...value.context, authority_revision: 5 } }),
    ]) {
      let reads = 0;
      const result = await run({ loadVerifiedSource: async () =>
        ++reads === 1 ? source() : mutate(source()) });
      expect(result.status).toBe("unavailable");
      expect(reads).toBe(2);
    }
  });

  it("projects a completed refusal as rejected without exposing model text", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: "resp:refusal", object: "response", status: "completed", error: null,
      incomplete_details: null, output: [{ type: "message", role: "assistant",
        status: "completed", content: [{ type: "refusal", refusal: "private text" }] }],
    }), { status: 200 })) as typeof fetch;
    expect(await run({ fetchImpl })).toMatchObject({ status: "projected",
      outcome: { status: "rejected", reason: "refusal", decision_id: null,
        answer_authority: false } });
    expect(JSON.stringify(await run({ fetchImpl }))).not.toContain("private text");
  });

  it("fails closed for HTTP failure, oversized response, cancellation and timeout", async () => {
    expect(await run({ fetchImpl: vi.fn(async () => new Response("private error", { status: 429 })) as typeof fetch }))
      .toMatchObject({ status: "unavailable", reason: "provider_http_error" });
    expect(await run({ fetchImpl: vi.fn(async () => new Response("x".repeat(65_537))) as typeof fetch }))
      .toMatchObject({ status: "unavailable", reason: "provider_response_oversize" });
    const canceled = new AbortController(); canceled.abort();
    const fetchImpl = vi.fn(async () => response()) as typeof fetch;
    expect(await run({ signal: canceled.signal, fetchImpl }))
      .toMatchObject({ status: "unavailable", reason: "provider_canceled" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const pending = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })) as typeof fetch;
    expect(await run({ fetchImpl: pending, timeoutMs: 100 }))
      .toMatchObject({ status: "unavailable", reason: "provider_timeout" });
  });
});
