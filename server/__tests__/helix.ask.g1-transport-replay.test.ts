import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import {
  claimHelixAskTurnTransportExecution,
  rememberHelixAskTurnTransportReplay,
  resetHelixAskTurnTransportReplayForTests,
} from "../services/helix-ask/runtime/ask-turn-transport-replay";
import { attachHelixAskRuntimeTransparency } from "../services/helix-ask/runtime/runtime-path-identity";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const priorBurst = process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB;
const priorHostRatio = process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN;

describe("Helix Ask G1 stream-to-JSON replay boundary", () => {
  beforeEach(() => {
    resetHelixAskTurnTransportReplayForTests();
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB = "1";
    process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN = "0.001";
  });
  afterEach(() => {
    resetHelixAskTurnTransportReplayForTests();
    if (priorBurst === undefined) delete process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB;
    else process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB = priorBurst;
    if (priorHostRatio === undefined) delete process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN;
    else process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN = priorHostRatio;
  });

  it("returns the completed SSE turn on JSON fallback before any new route execution", async () => {
    const turnId = `g1-replay-${Date.now()}`;
    const completedPayload = attachHelixAskRuntimeTransparency({
      ok: true,
      turn_id: turnId,
      agent_runtime: "codex",
      codex_bin: "codex-app-server",
      codex_native_provider_bridge: {
        eligible: true,
        attempted: true,
        status: "completed",
        fallback_reason: null,
      },
      codex_native_compatibility_fallback: { activated: false },
      response_type: "final_answer",
      final_status: "final_answer",
      selected_final_answer: "original SSE answer",
      answer: "original SSE answer",
      text: "original SSE answer",
      final_answer_source: "provider_terminal_candidate",
      terminal_artifact_kind: "model_synthesized_answer",
      debug: {},
    });
    const identityHash = (completedPayload.runtime_path_identity as { identity_hash: string }).identity_hash;
    rememberHelixAskTurnTransportReplay({
      turnId,
      sessionId: `session-${turnId}`,
      prompt: "Use repo search once.",
      sourceTransport: "ask_turn_sse",
      payload: completedPayload,
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        turn_id: turnId,
        turnId,
        question: "Use repo search once.",
        sessionId: `session-${turnId}`,
        agent_runtime: "helix",
      })
      .expect(200);

    expect(response.body.selected_final_answer).toBe("original SSE answer");
    expect(response.body.transport_replay).toMatchObject({
      turn_id: turnId,
      execution_reused: true,
      duplicate_execution_count: 0,
      source_transport: "ask_turn_sse",
      replay_transport: "ask_turn_json",
      runtime_identity_hash: identityHash,
    });
    expect(response.body.runtime_path_identity).toMatchObject({
      actual_path: "codex_native_app_server",
      api_transport: "ask_turn_json",
      transport_replay: { occurred: true, execution_reused: true, duplicate_execution_count: 0 },
      identity_hash: identityHash,
    });
    expect(response.body.debug.runtime_path_identity.identity_hash).toBe(identityHash);
  });

  it("fails closed while the original transport is still executing", async () => {
    const turnId = `g1-in-flight-${Date.now()}`;
    const identity = {
      turnId,
      sessionId: `session-${turnId}`,
      prompt: "Use repo search once.",
    };
    expect(claimHelixAskTurnTransportExecution(identity).status).toBe("claimed");

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        turn_id: turnId,
        question: identity.prompt,
        sessionId: identity.sessionId,
        agent_runtime: "codex",
      })
      .expect(202);

    expect(response.body).toMatchObject({
      terminal_error_code: "turn_execution_already_in_flight",
      transport_execution_guard: {
        status: "already_in_flight",
        execution_started_by_this_request: false,
        duplicate_execution_count: 0,
      },
      runtime_path_identity: {
        execution_path: "pre_runtime_policy_boundary",
        api_transport: "ask_turn_json",
        transport_history: [{
          status: "already_in_flight",
          execution_performed: false,
          duplicate_execution_count: 0,
        }],
      },
    });
  });
});
