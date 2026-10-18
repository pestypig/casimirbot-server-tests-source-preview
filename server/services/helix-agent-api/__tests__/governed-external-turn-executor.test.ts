import { describe, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { currentHelixExternalCapabilityPolicy } from "../../helix-ask/runtime/external-capability-policy";
import {
  executeGovernedHelixAskExternalTurn,
  type HelixAskExternalTurnExecutionInput,
  type HelixAskExternalTurnRouteBridge,
} from "../governed-external-turn-executor";

const baseInput = (
  signal = new AbortController().signal,
): HelixAskExternalTurnExecutionInput => ({
  run_id: "run_governed_external_12345678",
  question: "Evaluate the admitted evidence.",
  session_id: "session_governed_external",
  turn_id: "turn_governed_external",
  trace_id: "trace_governed_external",
  persona_id: "profile_governed_external",
  tenant_id: "tenant_governed_external",
  issuer: "https://issuer.example",
  subject_id: "subject_governed_external",
  account_type: "developer",
  oauth_scopes: new Set(["helix.agent_runs.write"]),
  account_policy: buildHelixAccountCapabilityPolicy("developer"),
  mode: "read",
  allow_tools: ["repo.search"],
  required_evidence: ["repository_evidence"],
  signal,
  deadline_at: "2099-07-26T20:00:00.000Z",
});

const blockedProjection = {
  terminal_authority_status: "blocked",
  terminal_authority_reason: "test_projection",
  terminal_product: null,
  observation_refs: [],
  evidence_refs: [],
  receipt_refs: [],
  pending_questions: [],
  unresolved_requirements: [],
  missing_evidence_requirements: [],
  satisfied_evidence_requirements: [],
};

const dependencies = (bridge: HelixAskExternalTurnRouteBridge) => {
  const projectTurn = vi.fn(() => blockedProjection as never);
  return {
    projectTurn,
    loadRouteBridge: vi.fn(async () => bridge),
  };
};

describe("governed external Helix turn executor", () => {
  it("rejects an invalid route request before entering the Ask kernel", async () => {
    const execute = vi.fn();
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: () => ({
        ok: false,
        issues: [{ path: ["question"], message: "required" }],
      }),
      finalizePayload: vi.fn(),
    };
    const deps = dependencies(bridge);

    const result = await executeGovernedHelixAskExternalTurn(baseInput(), deps);

    expect(result).toMatchObject({
      status: 400,
      payload: { error: "invalid_external_agent_turn" },
      projection: null,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(deps.projectTurn).not.toHaveBeenCalled();
  });

  it("applies the exact read-only identity and empty-tool sentinel policy", async () => {
    let observedPolicy: ReturnType<
      typeof currentHelixExternalCapabilityPolicy
    > = null;
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: () => ({
        ok: true,
        execute: async ({ responder }) => {
          observedPolicy = currentHelixExternalCapabilityPolicy();
          responder.send(500, { ok: false, error: "bounded_test" });
        },
      }),
      finalizePayload: vi.fn(),
    };
    const deps = dependencies(bridge);
    const input = {
      ...baseInput(),
      allow_tools: [],
    };

    await executeGovernedHelixAskExternalTurn(input, deps);

    expect(observedPolicy).toMatchObject({
      runId: input.run_id,
      tenantId: input.tenant_id,
      issuer: input.issuer,
      subjectId: input.subject_id,
      accountProfileId: input.persona_id,
      accountType: input.account_type,
      oauthScopes: input.oauth_scopes,
      accountPolicy: input.account_policy,
      allowedCapabilities: ["__helix_external_agent_no_tools__"],
      readOnly: true,
      signal: input.signal,
      deadlineAt: input.deadline_at,
    });
  });

  it("invokes one prepared Ask turn, keeps the first response, and projects only the finalized payload", async () => {
    const execute = vi.fn(async ({ responder, streamChunk }) => {
      streamChunk("first ");
      responder.send(200, {
        ok: true,
        route: "test_route",
        text: "unfinalized",
      });
      streamChunk("ignored after response");
      responder.send(201, { ok: true, text: "second response" });
    });
    const finalizePayload = vi.fn(({ payload }) => ({
      ...payload,
      canonical_terminal: true,
    }));
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: () => ({ ok: true, execute }),
      finalizePayload,
    };
    const deps = dependencies(bridge);
    const input = baseInput();

    const result = await executeGovernedHelixAskExternalTurn(input, deps);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalizePayload).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    expect(result.streamed_text).toBe("first ");
    expect(result.payload).toMatchObject({
      text: "unfinalized",
      canonical_terminal: true,
    });
    expect(result.payload).not.toHaveProperty("text", "second response");
    expect(deps.projectTurn).toHaveBeenCalledWith({
      payload: result.payload,
      status: 200,
      turnId: input.turn_id,
      threadId: input.session_id,
      requiredEvidence: input.required_evidence,
    });
  });

  it("does not finalize an Ask error response", async () => {
    const finalizePayload = vi.fn();
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: () => ({
        ok: true,
        execute: async ({ responder }) => {
          responder.send(409, { ok: false, error: "needs_input" });
        },
      }),
      finalizePayload,
    };
    const deps = dependencies(bridge);

    const result = await executeGovernedHelixAskExternalTurn(baseInput(), deps);

    expect(result.status).toBe(409);
    expect(result.payload).toMatchObject({ error: "needs_input" });
    expect(finalizePayload).not.toHaveBeenCalled();
    expect(deps.projectTurn).toHaveBeenCalledTimes(1);
  });

  it("preserves a typed failure returned with HTTP 200", async () => {
    const finalizePayload = vi.fn();
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: () => ({
        ok: true,
        execute: async ({ responder }) => {
          responder.send(200, { ok: false, error: "source_admission_blocked" });
        },
      }),
      finalizePayload,
    };
    const deps = dependencies(bridge);
    const result = await executeGovernedHelixAskExternalTurn(baseInput(), deps);
    expect(result.payload).toMatchObject({ ok: false, error: "source_admission_blocked" });
    expect(finalizePayload).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical terminal finalizer throws", async () => {
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: () => ({
        ok: true,
        execute: async ({ responder }) => {
          responder.send(200, { ok: true, text: "forged terminal" });
        },
      }),
      finalizePayload: () => {
        throw new Error("terminal_integrity_failed");
      },
    };
    const deps = dependencies(bridge);

    const result = await executeGovernedHelixAskExternalTurn(baseInput(), deps);

    expect(result.payload).toMatchObject({
      ok: false,
      error: "external_turn_finalization_failed",
      finalization_stage: "unknown",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(deps.projectTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: result.payload,
      }),
    );
  });

  it("stops before loading the route bridge when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("agent_run_cancelled"));
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: vi.fn(),
      finalizePayload: vi.fn(),
    };
    const deps = dependencies(bridge);

    await expect(
      executeGovernedHelixAskExternalTurn(baseInput(controller.signal), deps),
    ).rejects.toThrow("agent_run_cancelled");
    expect(deps.loadRouteBridge).not.toHaveBeenCalled();
  });

  it("does not finalize or project when cancellation arrives during Ask", async () => {
    const controller = new AbortController();
    const bridge: HelixAskExternalTurnRouteBridge = {
      prepareRequest: () => ({
        ok: true,
        execute: async ({ responder }) => {
          responder.send(200, { ok: true, text: "late result" });
          controller.abort(new Error("agent_run_cancelled"));
        },
      }),
      finalizePayload: vi.fn(),
    };
    const deps = dependencies(bridge);

    await expect(
      executeGovernedHelixAskExternalTurn(baseInput(controller.signal), deps),
    ).rejects.toThrow("agent_run_cancelled");
    expect(bridge.finalizePayload).not.toHaveBeenCalled();
    expect(deps.projectTurn).not.toHaveBeenCalled();
  });
});
