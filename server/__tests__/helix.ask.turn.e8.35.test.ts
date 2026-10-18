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

describe("helix ask turn e8.35 core contract invariants", () => {
  it("keeps clarify route coupled with pending request artifact", async () => {
    const app = createApp();
    const sessionId = "e835-clarify-coupling";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(String(response.body?.route_reason_code ?? "")).toBe("clarify:planner_repair_required");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(Array.isArray(response.body?.invariant_violations)).toBe(true);
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  });

  it("resolves ambiguous target follow-up to dispatch:act without stale clarify route", async () => {
    const app = createApp();
    const sessionId = "e835-ambiguous-followup";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(response.body?.pending_server_request ?? null).toBeNull();
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  });
});

