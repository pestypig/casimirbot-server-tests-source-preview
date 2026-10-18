import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { planRouter, resetHelixAskDebugPayloadCacheForTests } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

afterEach(() => {
  resetHelixAskDebugPayloadCacheForTests();
});

describe("Helix Ask debug-export terminal projection mirrors", () => {
  it("syncs capability help terminal authority into debug-export payload mirrors", async () => {
    const app = createApp();
    const sessionId = `debug-terminal-projection-${Date.now()}`;
    const ask = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What tools are available for the helix ask to use?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: false,
        },
      })
      .expect(200);

    expect(ask.body?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(ask.body?.terminal_error_code ?? null).toBeNull();

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(ask.body.turn_id))}/debug-export`)
      .expect(200);

    const payload = debugExport.body?.payload;
    expect(payload?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(payload?.final_answer_source).toBe(ask.body.final_answer_source);
    expect(payload?.response_type).toBe("final_answer");
    expect(payload?.final_status).toBe("final_answer");
    expect(payload?.terminal_error_code ?? null).toBeNull();
    expect(payload?.terminal_presentation?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(payload?.terminal_authority_single_writer?.selected_terminal_artifact_kind).toBe("capability_help_summary");
    expect(payload?.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      selected_terminal_product: {
        kind: "capability_help_summary",
        allowed_by_route: true,
      },
      visible_answer_source: ask.body.final_answer_source,
      failure_rail: null,
    });
    expect(payload?.debug?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(payload?.debug?.final_answer_source).toBe(ask.body.final_answer_source);
    expect(payload?.debug?.terminal_error_code ?? null).toBeNull();
    expect(payload?.debug?.ask_turn_procedure_trace).toEqual(payload?.ask_turn_procedure_trace);
    expect(payload?.codex_parity_agent_spine_rail_table).toMatchObject({
      selected_terminal_kind: "capability_help_summary",
      visible_terminal_kind: "capability_help_summary",
      rail_status: "complete",
      first_broken_rail: null,
    });
  }, 60000);
});
