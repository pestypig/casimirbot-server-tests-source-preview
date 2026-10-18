import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("workstation tool observation route", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    vi.resetModules();
  });

  it("appends a setup execution receipt as a linked toolObservation item", async () => {
    const app = await createApp();
    const receipt = {
      schema: "helix.situation_setup_receipt.v1",
      ok: true,
      correlation: {
        setup_call_id: "situation-setup:test:abc",
        thread_id: "thread:e75",
        turn_id: "turn:e75",
        dynamic_tool_item_id: "turn:e75:situation_room_setup:dynamic_tool_call",
      },
      setup_status: "complete",
      lifecycle_status: "executed",
      executed_action_id: "situation-room-pipelines.setup_from_prompt",
      executed_at: "2026-05-04T00:00:00.000Z",
      graph_id: "graph:e75",
      job_ids: ["job:a", "job:b"],
      attachment_policy: "manual_only",
      context_injection: "explicit_attachment_only",
      command_lane_enabled: false,
      output_mode: "visual_only",
      message: "Executed.",
    };

    const response = await request(app)
      .post("/api/agi/workstation/tool-observation")
      .send({
        schema: "helix.workstation.tool_observation.v1",
        thread_id: "thread:e75",
        turn_id: "turn:e75",
        setup_call_id: "situation-setup:test:abc",
        action: {
          panel_id: "situation-room-pipelines",
          action_id: "setup_from_prompt",
        },
        receipt,
        ok: true,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      appended: true,
      thread_id: "thread:e75",
      turn_id: "turn:e75",
      setup_call_id: "situation-setup:test:abc",
    });
    const events = getHelixThreadLedgerEvents({ threadId: "thread:e75" }).filter(
      (entry) => entry.observation_ref?.setup_call_id === "situation-setup:test:abc",
    );
    expect(events.length).toBeGreaterThan(0);
    const event = events.at(-1);
    expect(event).toMatchObject({
      event_type: "item_completed",
      item_type: "toolObservation",
      item_stream: "observation",
      source_item_ids: ["turn:e75:situation_room_setup:dynamic_tool_call"],
    });
    expect(event?.observation_ref?.receipt).toMatchObject({
      graph_id: "graph:e75",
      correlation: { setup_call_id: "situation-setup:test:abc" },
    });
  }, 15000);

  it("fails open when thread context is missing", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/workstation/tool-observation")
      .send({
        schema: "helix.workstation.tool_observation.v1",
        setup_call_id: "situation-setup:test:no-thread",
        action: {
          panel_id: "situation-room-pipelines",
          action_id: "setup_from_prompt",
        },
        receipt: { schema: "helix.situation_setup_receipt.v1", ok: true },
        ok: true,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      appended: false,
      reason: "missing_thread_context",
    });
  });

  it("returns a deterministic error for invalid schema", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/workstation/tool-observation")
      .send({
        schema: "wrong",
        action: { panel_id: "situation-room-pipelines", action_id: "setup_from_prompt" },
        receipt: {},
        ok: true,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      ok: false,
      error: "invalid_workstation_tool_observation",
    });
  });
});
