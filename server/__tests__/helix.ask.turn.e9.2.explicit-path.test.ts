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

describe("helix ask turn e9.2 explicit-path budget and policy source", () => {
  it("returns typed clarify (not 500) when explicit-path compare exceeds turn budget", async () => {
    const app = createApp();
    const sessionId = "e92-explicit-path-budget";
    const largeTail = "x".repeat(4600);
    const question = `compare /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md with /docs/audits/research/selected-family/nhm2-shift-lapse/warp-nhm2-mission-time-comparison-2026-04-23.md and tell me deltas ${largeTail}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question, mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.dispatch_policy).toBe("needs_user_input");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.pending_scope).toBe("artifact_gate");
    expect(response.body?.pending_server_request?.required_fields ?? []).toContain("retrieval_scope");
    expect(response.body?.turn_contract?.terminal_kind).toBe("clarify");
  });

  it("keeps workspace+reasoning compare turns policy-aligned to workspace_context_reasoning", async () => {
    const app = createApp();
    const sessionId = "e92-policy-source-hybrid";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note called e92 note", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with note e92 note and tell me differences", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.turn_contract?.terminal_kind).toBe("reasoning");
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  });
});
