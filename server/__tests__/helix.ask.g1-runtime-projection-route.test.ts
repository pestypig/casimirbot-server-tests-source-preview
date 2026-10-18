import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { resetHelixAskTurnTransportReplayForTests } from "../services/helix-ask/runtime/ask-turn-transport-replay";
import { resetHelixAskPublicLifecycleForTests } from "../services/helix-ask/runtime/public-lifecycle-store";

const priorEnv = { ...process.env };

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const parseSseEvents = (body: string): Array<{ event: string; data: Record<string, unknown> }> =>
  body.split(/\n\n+/).map((block) => block.trim()).filter(Boolean).map((block) => {
    const lines = block.split(/\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "";
    const encoded = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim()).join("\n");
    try {
      return { event, data: JSON.parse(encoded) as Record<string, unknown> };
    } catch {
      return { event, data: {} };
    }
  });

describe("Helix Ask G1 runtime identity route projection", () => {
  beforeEach(() => {
    resetHelixAskTurnTransportReplayForTests();
    resetHelixAskPublicLifecycleForTests();
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    // The provider is fake and bounded in this fixture. Keep the host-level
    // admission guard enabled while replacing its production-sized 1.5 GiB
    // burst reservation with the fixture's actual tiny allocation.
    process.env.RUNTIME_TASK_ACTIVE_USER_TURN_ESTIMATED_BURST_MB = "1";
    process.env.RUNTIME_MEMORY_HOST_FREE_RATIO_MIN = "0.001";
    process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS = "1";
  });

  afterEach(() => {
    resetHelixAskTurnTransportReplayForTests();
    resetHelixAskPublicLifecycleForTests();
    process.env = { ...priorEnv };
  });

  it("projects compatibility execution through JSON and the stored debug export", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "The deterministic JSON observation is 21.";
    const app = createApp();
    const turnId = `ask:g1-json-${Date.now()}`;
    const response = await request(app).post("/api/agi/ask/turn").send({
      agent_runtime: "codex",
      thread_id: `thread:${turnId}`,
      sessionId: `session:${turnId}`,
      turn_id: turnId,
      question: "Use the calculator observation.",
      workstation_gateway_call: {
        capability_id: "scientific-calculator.solve_expression",
        arguments: { expression: "3 * 7" },
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    expect(response.body.runtime_path_identity).toMatchObject({
      schema: "helix.ask.runtime_path_identity.v2",
      execution_path: "codex_compatibility_exec",
      actual_path: "codex_compatibility_exec",
      api_transport: "ask_turn_json",
    });
    expect(response.body.debug.runtime_path_identity).toEqual(response.body.runtime_path_identity);
    expect(response.body.public_lifecycle_projection).toMatchObject({
      stable_id_count: response.body.public_lifecycle_projection.event_count,
      full_events_field: "turn_transcript_events",
    });

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);
    expect(debugExport.body.payload.runtime_path_identity).toMatchObject({
      execution_path: "codex_compatibility_exec",
      api_transport: "ask_turn_json",
      identity_hash: response.body.runtime_path_identity.identity_hash,
    });
    expect(debugExport.body.payload.public_lifecycle_projection.stable_event_ids)
      .toEqual(response.body.public_lifecycle_projection.stable_event_ids);
    expect(response.body.public_lifecycle_projection.retrieval).toMatchObject({
      mode: "inline_and_pageable",
      endpoint: `/api/agi/ask/turn/${encodeURIComponent(turnId)}/lifecycle`,
      max_page_limit: 100,
    });
    const firstPage = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/lifecycle?limit=2&offset=0`)
      .expect(200);
    expect(firstPage.body).toMatchObject({
      schema: "helix.ask.public_lifecycle_page.v1",
      turn_id: turnId,
      offset: 0,
      limit: 2,
      returned_count: 2,
    });
    const secondPage = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/lifecycle?limit=100&offset=2`)
      .expect(200);
    const pagedIds = [...firstPage.body.events, ...secondPage.body.events]
      .map((event: Record<string, unknown>) => event.id);
    expect(pagedIds).toEqual(response.body.public_lifecycle_projection.stable_event_ids);
    await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/lifecycle?sessionId=wrong-session`)
      .expect(404);
  }, 30_000);

  it("projects the same compatibility family as SSE without calling it JSON", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "The deterministic streamed observation is 64.";
    const turnId = `ask:g1-sse-${Date.now()}`;
    const app = createApp();
    const response = await request(app).post("/api/agi/ask/turn/stream").send({
      agent_runtime: "codex",
      thread_id: `thread:${turnId}`,
      sessionId: `session:${turnId}`,
      turn_id: turnId,
      question: "Use the calculator observation.",
      workstation_gateway_call: {
        capability_id: "scientific-calculator.solve_expression",
        arguments: { expression: "8 * 8" },
      },
    });
    expect(response.status, response.text).toBe(200);
    const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

    expect(finalEvent?.data.runtime_path_identity).toMatchObject({
      schema: "helix.ask.runtime_path_identity.v2",
      execution_path: "codex_compatibility_exec",
      api_transport: "ask_turn_sse",
    });
    expect((finalEvent?.data.debug as Record<string, unknown>).runtime_path_identity)
      .toEqual(finalEvent?.data.runtime_path_identity);
    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);
    expect(debugExport.body.payload.runtime_path_identity).toMatchObject({
      execution_path: "codex_compatibility_exec",
      api_transport: "ask_turn_sse",
      identity_hash: (finalEvent?.data.runtime_path_identity as Record<string, unknown>).identity_hash,
    });
    const lifecyclePage = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/lifecycle?limit=100`)
      .expect(200);
    expect(lifecyclePage.body.event_count).toBe(
      (finalEvent?.data.public_lifecycle_projection as Record<string, unknown>).event_count,
    );
    expect(lifecyclePage.body.events.map((event: Record<string, unknown>) => event.id)).toEqual(
      (finalEvent?.data.public_lifecycle_projection as Record<string, unknown>).stable_event_ids,
    );
  }, 30_000);

  it("projects the Helix-native provider through JSON and debug export", async () => {
    const app = createApp();
    const turnId = `ask:g1-helix-${Date.now()}`;
    const response = await request(app).post("/api/agi/ask/turn").send({
      agent_runtime: "helix",
      sessionId: `session:${turnId}`,
      turn_id: turnId,
      workstation_gateway_call: {
        capability_id: "scientific-calculator.solve_expression",
        arguments: { expression: "6 * 7" },
      },
    }).expect(200);

    expect(response.body.runtime_path_identity).toMatchObject({
      execution_path: "helix_legacy_private_loop",
      api_transport: "ask_turn_json",
    });
    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);
    expect(debugExport.body.payload.runtime_path_identity).toMatchObject({
      execution_path: "helix_legacy_private_loop",
      api_transport: "ask_turn_json",
    });
  });

  it("projects the future-provider adapter through JSON and debug export", async () => {
    process.env.ENABLE_FUTURE_AGENT = "1";
    const app = createApp();
    const turnId = `ask:g1-future-${Date.now()}`;
    const response = await request(app).post("/api/agi/ask/turn").send({
      agent_runtime: "future",
      sessionId: `session:${turnId}`,
      turn_id: turnId,
      workstation_gateway_call: {
        capability_id: "scientific-calculator.solve_expression",
        arguments: { expression: "8 * 8" },
      },
    }).expect(200);

    expect(response.body.runtime_path_identity).toMatchObject({
      execution_path: "future_provider_adapter",
      api_transport: "ask_turn_json",
    });
    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);
    expect(debugExport.body.payload.runtime_path_identity).toMatchObject({
      execution_path: "future_provider_adapter",
      api_transport: "ask_turn_json",
    });
  });

  it("projects Helix-native and future-provider families through SSE and debug export", async () => {
    process.env.ENABLE_FUTURE_AGENT = "1";
    const app = createApp();
    const cases = [
      { runtime: "helix", expectedPath: "helix_legacy_private_loop", expression: "6 * 7" },
      { runtime: "future", expectedPath: "future_provider_adapter", expression: "8 * 8" },
    ];
    for (const entry of cases) {
      const turnId = `ask:g1-${entry.runtime}-sse-${Date.now()}`;
      const response = await request(app).post("/api/agi/ask/turn/stream").send({
        agent_runtime: entry.runtime,
        sessionId: `session:${turnId}`,
        turn_id: turnId,
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: { expression: entry.expression },
        },
      }).expect(200);
      const finalEvent = parseSseEvents(response.text).find((event) => event.event === "turn_final");
      expect(finalEvent?.data.runtime_path_identity).toMatchObject({
        execution_path: entry.expectedPath,
        api_transport: "ask_turn_sse",
      });
      const debugExport = await request(app)
        .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
        .expect(200);
      expect(debugExport.body.payload.runtime_path_identity).toMatchObject({
        execution_path: entry.expectedPath,
        api_transport: "ask_turn_sse",
      });
    }
  }, 60_000);

  it("preserves legacy-route transport identity across the internal Ask bridge", async () => {
    const turnId = `ask:g1-legacy-${Date.now()}`;
    const response = await request(createApp()).post("/api/agi/ask").send({
      question: "What tools are available for Helix Ask to use?",
      mode: "read",
      debug: true,
      sessionId: `session:${turnId}`,
      turn_id: turnId,
    }).expect(200);

    expect(response.body.legacy_ask_bridge).toMatchObject({
      source_route: "/api/agi/ask",
      target_route: "/api/agi/ask/turn",
    });
    expect(response.body.runtime_path_identity).toMatchObject({
      api_transport: "legacy_ask_json",
      transport_history: [
        { transport: "legacy_ask_json", execution_performed: false },
        { transport: "ask_turn_json", status: "bridged", execution_performed: true },
      ],
    });
  }, 60_000);

  it("labels early contract and account-policy failures before any runtime starts", async () => {
    const app = createApp();
    const invalid = await request(app).post("/api/agi/ask").send({
      question: 42,
      mode: "read",
      sessionId: "g1-invalid-session",
    }).expect(400);
    expect(invalid.body.runtime_path_identity).toMatchObject({
      execution_path: "pre_runtime_policy_boundary",
      api_transport: "legacy_ask_json",
      attempted_paths: [{ status: "not_started" }],
    });

    process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS = "0";
    const turnId = `ask:g1-policy-${Date.now()}`;
    const rejected = await request(app).post("/api/agi/ask/turn").send({
      agent_runtime: "helix",
      turn_id: turnId,
      sessionId: `session:${turnId}`,
      question: "Hello",
    }).expect(403);
    expect(rejected.body).toMatchObject({
      terminal_error_code: "runtime_agent_locked_by_account_policy",
      runtime_path_identity: {
        execution_path: "pre_runtime_policy_boundary",
        api_transport: "ask_turn_json",
        attempted_paths: [{ status: "not_started" }],
        runtime_limits: { runtime_started: false },
      },
    });

    const streamRejected = await request(app).post("/api/agi/ask/turn/stream").send({
      agent_runtime: "helix",
      turn_id: `${turnId}:stream`,
      sessionId: `session:${turnId}:stream`,
      question: "Hello",
    }).expect(200);
    const streamFinal = parseSseEvents(streamRejected.text).find((entry) => entry.event === "turn_final");
    expect(streamFinal?.data).toMatchObject({
      terminal_error_code: "runtime_agent_locked_by_account_policy",
      runtime_path_identity: {
        execution_path: "pre_runtime_policy_boundary",
        api_transport: "ask_turn_sse",
        attempted_paths: [{ status: "not_started" }],
      },
    });
  }, 30_000);
});
