import { describe, expect, it, vi } from "vitest";
import {
  currentHelixExternalCapabilityPolicy,
  runWithHelixExternalCapabilityPolicy,
} from "../../helix-ask/runtime/external-capability-policy";
import { executeHelixAgentAskTurnRoute } from "../ask-turn-route-execution";

const base = () => ({
  request: {
    question: "What is 2 + 2? Answer in one sentence.",
    sessionId: "session-agent-run",
    turnId: "turn-agent-run",
    traceId: "trace-agent-run",
  },
  personaId: "owner-profile",
  tenantId: "owner-tenant",
  createCaptureResponse: () => ({ captured: null as { statusCode: number; body: Record<string, unknown> } | null }),
});

describe("agent-run Ask-turn execution", () => {
  it("passes the run identity to the Ask-turn solver and forwards its terminal artifacts", async () => {
    const payload = {
      canonical_goal_frame: { turn_id: "turn-agent-run", required_terminal_kind: "direct_answer_text" },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "turn-agent-run" },
      terminal_answer_authority: { server_authoritative: true },
    };
    const handleTurn = vi.fn(async (request: Record<string, unknown>, response: ReturnType<ReturnType<typeof base>["createCaptureResponse"]>) => {
      expect(request.body).toMatchObject({
        question: "What is 2 + 2? Answer in one sentence.",
        session_id: "session-agent-run",
        turn_id: "turn-agent-run",
        trace_id: "trace-agent-run",
        personaId: "owner-profile",
        debug: true,
      });
      expect(request.tenantId).toBe("owner-tenant");
      expect(currentHelixExternalCapabilityPolicy()).toMatchObject({
        accountProfileId: "owner-profile",
        tenantId: "owner-tenant",
        readOnly: true,
      });
      response.captured = { statusCode: 200, body: payload };
    });
    const responder = { send: vi.fn() };

    await runWithHelixExternalCapabilityPolicy({
      runId: "run-agent-test",
      tenantId: "owner-tenant",
      accountProfileId: "owner-profile",
      accountType: "developer",
      allowedCapabilities: [],
      readOnly: true,
    }, () => executeHelixAgentAskTurnRoute({ ...base(), handleTurn, responder }));

    expect(handleTurn).toHaveBeenCalledOnce();
    expect(responder.send).toHaveBeenCalledWith(200, payload);
  });

  it("fails closed when the Ask-turn handler produces no payload", async () => {
    const responder = { send: vi.fn() };
    await executeHelixAgentAskTurnRoute({
      ...base(),
      handleTurn: async () => {},
      responder,
    });
    expect(responder.send).toHaveBeenCalledWith(500, {
      ok: false,
      error: "ask_turn_no_payload",
      terminal_error_code: "ask_turn_no_payload",
    });
  });

  it("does not enter the solver after cancellation", async () => {
    const controller = new AbortController();
    controller.abort("agent_run_cancelled");
    const handleTurn = vi.fn();
    await expect(executeHelixAgentAskTurnRoute({
      ...base(),
      signal: controller.signal,
      handleTurn,
      responder: { send: vi.fn() },
    })).rejects.toThrow("agent_run_cancelled");
    expect(handleTurn).not.toHaveBeenCalled();
  });
});
