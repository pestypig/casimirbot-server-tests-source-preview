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

describe("situation standby observation route", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    vi.resetModules();
  });

  it("appends salience receipts as toolObservation items, not answers", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/standby-observation")
      .send({
        thread_id: "thread:e86",
        turn_id: "turn:e86",
        session_id: "session:e86",
        room_id: "room:e86",
        graph_id: "graph:e86",
        salience_receipt: {
          schema: "helix.situation_salience_receipt.v1",
          receipt_id: "salience:e86",
          room_id: "room:e86",
          graph_id: "graph:e86",
          signal_ids: ["signal:e86"],
          priority: "warn",
          reason: "risk_detected",
          should_notify_helix: true,
          should_speak: false,
          should_request_user_input: false,
          dedupe_key: "room:e86:risk",
          cooldown_ms: 45000,
          summary: "Risk signal detected.",
          evidence_refs: ["world:31"],
          ts: "2026-05-05T12:00:00.000Z",
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({ ok: true, appended: true });
    const events = getHelixThreadLedgerEvents({ threadId: "thread:e86" });
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      event_type: "item_completed",
      item_type: "toolObservation",
      item_stream: "observation",
    });
    expect(events.at(-1)?.observation_ref?.receipt).toMatchObject({
      schema: "helix.situation_standby_observation.v1",
      salience_receipt: { receipt_id: "salience:e86" },
    });
  }, 15000);

  it("creates a server request when the salience receipt requires user input", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/standby-observation")
      .send({
        thread_id: "thread:e86-request",
        turn_id: "turn:e86-request",
        room_id: "room:e86-request",
        salience_receipt: {
          schema: "helix.situation_salience_receipt.v1",
          receipt_id: "salience:e86-request",
          room_id: "room:e86-request",
          signal_ids: ["signal:e86-request"],
          priority: "action",
          reason: "permission_needed",
          should_notify_helix: true,
          should_speak: false,
          should_request_user_input: true,
          dedupe_key: "room:e86-request:permission",
          cooldown_ms: 45000,
          summary: "Capture permission is needed.",
          evidence_refs: [],
          ts: "2026-05-05T12:00:00.000Z",
        },
      })
      .expect(200);

    const events = getHelixThreadLedgerEvents({ threadId: "thread:e86-request" });
    expect(events.some((event) => event.event_type === "server_request_created")).toBe(true);
  }, 15000);
});

