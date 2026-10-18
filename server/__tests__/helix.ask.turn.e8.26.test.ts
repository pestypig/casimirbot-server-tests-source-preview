import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask turn e8.26 retrieval pending + workspace receipt normalization", () => {
  it("returns deterministic workspace receipt text for workspace-only turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e826-workspace-receipt",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.turn_contract?.terminal_kind).toBe("conversation");
    expect(String(response.body?.text ?? "")).toBe("Executed workstation-notes.open.");
  });

  it("keeps retrieval pending ownership and resolves pending before new plan", async () => {
    const app = createApp();
    const sessionId = "e826-retrieval-pending-roundtrip";

    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this doc with my notes and tell me differences",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(first.body?.route_reason_code).toBe("clarify:missing_args");
    expect(first.body?.pending_server_request?.kind).toBe("clarify");
    expect(first.body?.pending_server_request?.pending_scope).toBe("artifact_gate");

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md with note bridge notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(second.body?.pending_transition_trace).not.toContain("artifact_gate_intent_switch_abort");
    expect(second.body?.pending_transition_trace).not.toContain("artifact_gate_conversation_escape_abort");
    expect(second.body?.pending_status_before).toBe("pending");
    expect(second.body?.pending_status_after).toBe("resolved");
    expect(second.body?.pending_server_request ?? null).toBeNull();
    expect(second.body?.route_reason_code).toBe("dispatch:act");
  });
});
