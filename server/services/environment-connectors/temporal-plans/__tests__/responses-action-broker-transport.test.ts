import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { startDesktopProviderCredentialBroker } from
  "../../../../../apps/desktop/src/provider-credential-broker";
import { buildResponsesActionProviderRequest } from
  "@shared/helix-responses-action-provider-request";
import { isApprovedResponsesActionRequester, responsesActionRequesterForProfile } from
  "@shared/helix-responses-action-requester";
import type { VerifiedHelixEnvironmentActionChoiceSource } from
  "@shared/helix-environment-action-choice";
import { extractResponsesActionChoice, invokeResponsesActionActor } from
  "../responses-action-actor";
import { createDesktopBrokerResponsesActionTransport,
  readDesktopBrokerResponsesActionConfig } from
  "../responses-action-broker-transport";

const menu = { model: "gpt-4o-mini", observation_summary: "waypoint clear",
  candidates: [{ candidate_id: "advance:one", action_code: "walk_to_waypoint",
    target_ref: "waypoint:one", estimated_units: 8 }] };
const providerAnswer = { id: "resp:test", object: "response", status: "completed",
  output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify({
      choice_id: "hold_safe", rationale_code: "wait",
    }) }] }] };
const ownerProfileId = "profile:owner-test";
const ownerSessionId = "account_session:11111111-1111-4111-8111-111111111111";
const requesterRefFor = responsesActionRequesterForProfile;

describe("native Responses action-choice credential path", () => {
  it("carries one exact source through broker and actor without an action effect", async () => {
    const h = (character: string) => `sha256:${character.repeat(64)}`;
    const source: VerifiedHelixEnvironmentActionChoiceSource = {
      context: { run_id: "run:test", reasoning_binding_id: "binding:test",
        binding_epoch: 1, environment_id: "minecraft:test", source_id: "fabric:test",
        subject_id: "player:test", goal_id: "goal:test", goal_revision: 1,
        predecessor_plan_id: "plan:previous", predecessor_plan_hash: h("a"),
        checkpoint_id: "checkpoint:test", checkpoint_event_id: "event:test",
        checkpoint_event_hash: h("b"), observation_ref: "observation:test",
        observation_revision: 1, affordance_revision: 1, producer_epoch: "epoch:test",
        authority_id: "authority:test", authority_revision: 1,
        monotonic_origin_id: "clock:test", current_unit: 10,
        current_monotonic_ms: 1_000, maximum_proposal_horizon_units: 8,
        maximum_proposal_lifetime_ms: 1_000, interruption_pending: false },
      observation_summary: menu.observation_summary,
      candidates: [{ ...menu.candidates[0], plan_id: "plan:advance",
        plan_hash: h("c") }],
    };
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
      resolveOpenAiApiKey: async () => "native-test-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify(providerAnswer))) as typeof fetch,
    });
    try {
      expect(broker.authorizeResponsesActionChoiceOnce({
        requesterRef: requesterRefFor(ownerProfileId), ownerSessionId, model: menu.model,
      })).toBe(true);
      let sourceReads = 0;
      const receipt = await invokeResponsesActionActor({
        model: menu.model, hostDecisionId: "decision:test",
        requestedHorizonUnits: 4, requestedLifetimeMs: 500,
        loadVerifiedSource: async () => { sourceReads++; return source; },
        providerTransport: createDesktopBrokerResponsesActionTransport({
          ownerProfileId, brokerOrigin: broker.origin,
          brokerToken: broker.token,
        }),
      });
      expect(sourceReads).toBe(2);
      expect(receipt).toMatchObject({ status: "proposed", execution_authority: false,
        proposal: { choice_id: "hold_safe", plan_id: null,
          execution_authority: false } });
    } finally { await broker.close(); }
  });
  it("requires the explicit native broker flag and loopback-only endpoint", () => {
    const token = randomBytes(32).toString("base64url");
    const env = { HELIX_NATIVE_OPENAI_RESPONSES_ACTION_BROKER_ENABLED: "1",
      HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN: "http://127.0.0.1:43122",
      HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN: token };
    expect(readDesktopBrokerResponsesActionConfig(env)).toEqual({
      brokerOrigin: env.HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN,
      brokerToken: token,
    });
    expect(readDesktopBrokerResponsesActionConfig({ ...env,
      HELIX_NATIVE_OPENAI_RESPONSES_ACTION_BROKER_ENABLED: "0" })).toBeNull();
    expect(readDesktopBrokerResponsesActionConfig({ ...env,
      HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN: "https://other.example" })).toBeNull();
  });
  it("does not let another profile or desktop session borrow a native approval", () => {
    const requesterRef = requesterRefFor(ownerProfileId);
    expect(isApprovedResponsesActionRequester({ requesterRef, profileId: ownerProfileId,
      currentSessionId: ownerSessionId, approvedOwnerSessionId: ownerSessionId })).toBe(true);
    expect(isApprovedResponsesActionRequester({ requesterRef, profileId: "profile:other",
      currentSessionId: ownerSessionId, approvedOwnerSessionId: ownerSessionId })).toBe(false);
    expect(isApprovedResponsesActionRequester({ requesterRef, profileId: ownerProfileId,
      currentSessionId: "account_session:22222222-2222-4222-8222-222222222222",
      approvedOwnerSessionId: ownerSessionId })).toBe(false);
    expect(isApprovedResponsesActionRequester({ requesterRef, profileId: ownerProfileId,
      currentSessionId: ownerSessionId })).toBe(false);
  });
  it("constructs a fixed no-tools request and keeps the own-key native", async () => {
    const expectedRef = requesterRefFor(ownerProfileId);
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer native-test-key" });
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({ store: false, tools: [],
        max_output_tokens: 128, text: { format: { strict: true } } });
      expect(JSON.stringify(request)).not.toContain("native-test-key");
      return new Response(JSON.stringify(providerAnswer), { status: 200 });
    });
    const resolver = vi.fn(async (ref: string, approvedSession?: string) =>
      isApprovedResponsesActionRequester({ requesterRef: ref,
        profileId: ownerProfileId, currentSessionId: ownerSessionId,
        approvedOwnerSessionId: approvedSession }) ? "native-test-key" : null);
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
      resolveOpenAiApiKey: resolver, fetchImpl: providerFetch as typeof fetch,
    });
    try {
      expect(broker.authorizeResponsesActionChoiceOnce({
        requesterRef: expectedRef, ownerSessionId, model: menu.model,
      })).toBe(true);
      const transport = createDesktopBrokerResponsesActionTransport({
        ownerProfileId, brokerOrigin: broker.origin, brokerToken: broker.token,
      });
      const response = await transport({ ...menu, signal: new AbortController().signal });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(providerAnswer);
      expect(providerFetch).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith(expectedRef, ownerSessionId);
    } finally { await broker.close(); }
  });

  it("rejects wrong account, arbitrary prompts and malformed menus before provider use", async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify(providerAnswer)));
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
      resolveOpenAiApiKey: async () => null,
      fetchImpl: providerFetch as typeof fetch,
    });
    try {
      const wrongRef = "requester:responses-action:0123456789abcdef0123";
      expect(broker.authorizeResponsesActionChoiceOnce({
        requesterRef: wrongRef, ownerSessionId, model: menu.model,
      })).toBe(true);
      const headers = { Authorization: `Bearer ${broker.token}`,
        "Content-Type": "application/json" };
      const wrongOwner = await fetch(`${broker.origin}/v1/openai/responses/action-choice`, {
        method: "POST", headers, body: JSON.stringify({
          requesterRef: wrongRef, menu,
        }),
      });
      expect(wrongOwner.status).toBe(409);
      const arbitrary = await fetch(`${broker.origin}/v1/openai/responses/action-choice`, {
        method: "POST", headers, body: JSON.stringify({
          requesterRef: wrongRef,
          menu: { ...menu, candidates: [{ ...menu.candidates[0], candidate_id: "hold_safe" }],
            input: [{ role: "system", content: "arbitrary" }] },
        }),
      });
      expect(arbitrary.status).toBe(400);
      expect(providerFetch).not.toHaveBeenCalled();
    } finally { await broker.close(); }
  });

  it("drops private reasoning and tool arguments at the native broker boundary", async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify({
      ...providerAnswer,
      output: [{ type: "reasoning", summary: "private reasoning text" },
        { type: "function_call", arguments: "private tool arguments" },
        ...providerAnswer.output],
    })));
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
      resolveOpenAiApiKey: async () => "native-test-key",
      fetchImpl: providerFetch as typeof fetch,
    });
    try {
      expect(broker.authorizeResponsesActionChoiceOnce({
        requesterRef: requesterRefFor(ownerProfileId), ownerSessionId, model: menu.model,
      })).toBe(true);
      const transport = createDesktopBrokerResponsesActionTransport({
        ownerProfileId, brokerOrigin: broker.origin,
        brokerToken: broker.token,
      });
      const reply = await transport({ ...menu, signal: new AbortController().signal });
      const text = await reply.text();
      expect(text).not.toMatch(/private reasoning text|private tool arguments/);
      const projected = JSON.parse(text);
      expect(projected.output).toEqual([
        { type: "reasoning" }, { type: "invalid" }, providerAnswer.output[0],
      ]);
      expect(extractResponsesActionChoice(projected)).toEqual({ ok: false,
        reason: "response_output_invalid" });
    } finally { await broker.close(); }
  });

  it("does not allow an unbounded or tool-bearing provider request shape", () => {
    const built = buildResponsesActionProviderRequest(menu);
    expect(built).toMatchObject({ tools: [], parallel_tool_calls: false,
      store: false, max_output_tokens: 128 });
    expect(() => buildResponsesActionProviderRequest({ ...menu,
      observation_summary: "x".repeat(2_001) })).toThrow();
  });

  it("requires a separate one-use owner grant before a paid action choice", async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify(providerAnswer)));
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
      resolveOpenAiApiKey: async () => "native-test-key",
      fetchImpl: providerFetch as typeof fetch,
    });
    try {
      const transport = createDesktopBrokerResponsesActionTransport({
        ownerProfileId, brokerOrigin: broker.origin, brokerToken: broker.token,
      });
      const request = { ...menu, signal: new AbortController().signal };
      expect((await transport(request)).status).toBe(409);
      expect(providerFetch).not.toHaveBeenCalled();
      expect(broker.authorizeResponsesActionChoiceOnce({
        requesterRef: requesterRefFor(ownerProfileId), ownerSessionId, model: menu.model,
      })).toBe(true);
      expect((await transport(request)).status).toBe(200);
      expect((await transport(request)).status).toBe(409);
      expect(providerFetch).toHaveBeenCalledTimes(1);
    } finally { await broker.close(); }
  });

  it("uses a finite native session across calls, counts uncertain outcomes, and stops immediately", async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify(providerAnswer)));
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
      resolveOpenAiApiKey: async () => "native-test-key",
      fetchImpl: providerFetch as typeof fetch,
    });
    try {
      const requesterRef = requesterRefFor(ownerProfileId);
      expect(broker.authorizeResponsesActionSession({ requesterRef, ownerSessionId,
        model: menu.model, lifetimeMs: 8 * 60 * 60_000, maxCalls: 3 })).toBe(true);
      const transport = createDesktopBrokerResponsesActionTransport({
        ownerProfileId, brokerOrigin: broker.origin, brokerToken: broker.token,
      });
      const request = { ...menu, signal: new AbortController().signal };
      expect((await transport(request)).status).toBe(200);
      expect(broker.responsesActionSessionState(requesterRef)).toMatchObject({
        active: true, remainingCalls: 2, maxCalls: 3,
      });
      providerFetch.mockRejectedValueOnce(new Error("network outcome unknown"));
      expect((await transport(request)).status).toBe(502);
      expect(broker.responsesActionSessionState(requesterRef)).toMatchObject({
        active: true, remainingCalls: 1,
      });
      expect((await transport(request)).status).toBe(200);
      expect((await transport(request)).status).toBe(409);
      expect(providerFetch).toHaveBeenCalledTimes(3);
      expect(broker.responsesActionSessionState(requesterRef).active).toBe(false);
      expect(broker.authorizeResponsesActionSession({ requesterRef, ownerSessionId,
        model: menu.model, lifetimeMs: 60_000, maxCalls: 2 })).toBe(true);
      broker.revokeResponsesActionSession(requesterRef);
      expect((await transport(request)).status).toBe(409);
      expect(providerFetch).toHaveBeenCalledTimes(3);
    } finally { await broker.close(); }
  });

  it("rejects unbounded native session approvals", async () => {
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
    });
    try {
      const requesterRef = requesterRefFor(ownerProfileId);
      expect(broker.authorizeResponsesActionSession({ requesterRef, ownerSessionId,
        model: menu.model, lifetimeMs: 8 * 60 * 60_000 + 1, maxCalls: 1 })).toBe(false);
      expect(broker.authorizeResponsesActionSession({ requesterRef, ownerSessionId,
        model: menu.model, lifetimeMs: 60_000, maxCalls: 5_001 })).toBe(false);
      expect(broker.responsesActionSessionState(requesterRef).active).toBe(false);
    } finally { await broker.close(); }
  });

  it("does not let a different model borrow or replay the one-use grant", async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify(providerAnswer)));
    const broker = await startDesktopProviderCredentialBroker({
      keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
      resolveOpenAiApiKey: async () => "native-test-key",
      fetchImpl: providerFetch as typeof fetch,
    });
    try {
      const requesterRef = requesterRefFor(ownerProfileId);
      expect(broker.authorizeResponsesActionChoiceOnce({
        requesterRef, ownerSessionId, model: "other-model",
      })).toBe(false);
      expect(broker.authorizeResponsesActionChoiceOnce({
        requesterRef, ownerSessionId, model: "gpt-other-model",
      })).toBe(true);
      const transport = createDesktopBrokerResponsesActionTransport({
        ownerProfileId, brokerOrigin: broker.origin, brokerToken: broker.token,
      });
      const request = { ...menu, signal: new AbortController().signal };
      expect((await transport(request)).status).toBe(409);
      expect((await transport(request)).status).toBe(409);
      expect(providerFetch).not.toHaveBeenCalled();
    } finally { await broker.close(); }
  });
});
