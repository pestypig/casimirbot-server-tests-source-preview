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

describe("helix ask turn e9.3 composed research and precedence", () => {
  it("keeps workspace precedence for copy-selection-to-note utterance", async () => {
    const app = createApp();
    const sessionId = "e93-workspace-precedence";

    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note called e93 note", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "copy this selection to note e93 note", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.turn_contract?.terminal_kind).toBe("conversation");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_selection_to_note");
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  });

  it("builds a composed workspace->reasoning->workspace plan for doc+repo+note prompts", async () => {
    const app = createApp();
    const sessionId = "e93-composed-research";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "read the current doc, check related files in the repo, then append findings to note e93 note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items) ? response.body.planner_contract.plan_items : [];
    expect(planItems.length).toBeGreaterThanOrEqual(3);
    expect(planItems[0]?.lane).toBe("workspace");
    expect(planItems[1]?.lane).toBe("reasoning");
    expect(planItems[2]?.lane).toBe("workspace");
    expect(planItems[2]?.action?.panel_id).toBe("workstation-notes");
    expect(planItems[2]?.action?.action_id).toBe("append_to_note");
    expect(String(response.body?.text ?? "").toLowerCase()).not.toContain("missing_action_payload");
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  });

  it("uses true doc-to-doc compare framing for explicit two-path prompts", async () => {
    const app = createApp();
    const sessionId = "e93-doc-doc-compare";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare /docs/a.md with /docs/b.md and tell me deltas",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const text = String(response.body?.text ?? "");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(text).toContain("Document A");
    expect(text).toContain("Document B");
    expect(text.toLowerCase()).not.toContain("against note");
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  }, 20000);
});
