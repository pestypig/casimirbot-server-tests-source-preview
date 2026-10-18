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

describe("helix ask turn e8.34 reasoning final quality contract", () => {
  it("returns non-generic explain output for deictic explain prompts", async () => {
    const app = createApp();
    const sessionId = "e834-explain";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what is this?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const text = String(response.body?.text ?? "");
    expect(text.toLowerCase()).toContain("explained");
    expect(text.toLowerCase()).toContain("key claim:");
    expect(text.toLowerCase()).not.toContain("request scope:");
    expect(response.body?.quality_contract_intent_family).toBe("explain");
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(response.body?.quality_contract_fail_reason ?? null).toBeNull();
  });

  it("maps deictic doc phrasing to workspace-context explain path", async () => {
    const app = createApp();
    const sessionId = "e834-deictic-doc";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what is this doc", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.needs_retrieval).toBe(false);
    const text = String(response.body?.text ?? "");
    expect(text.toLowerCase()).toContain("explained");
    expect(text.toLowerCase()).toContain("key claim:");
    expect(response.body?.quality_contract_intent_family).toBe("explain");
    expect(response.body?.quality_contract_pass).toBe(true);
  });

  it("maps locate-in-doc prompts to workspace-context locate contract", async () => {
    const app = createApp();
    const sessionId = "e834-doc-locate";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "Where in this doc does it talk about alpha centerline?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("locate_in_doc");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("locations:");
    expect(String(response.body?.text ?? "")).toMatch(/(?:^|\n)-\s+/);
    expect(String(response.body?.text ?? "").toLowerCase()).not.toContain("completed reasoning for");
    expect(response.body?.quality_contract_intent_family).toBe("doc_locate");
    expect(response.body?.quality_contract_pass).toBe(true);
  });

  it("returns compare output with concrete difference bullets", async () => {
    const app = createApp();
    const sessionId = "e834-compare";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called nhm2 scratch", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with note nhm2 scratch and tell me differences", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const text = String(response.body?.text ?? "");
    expect(text.toLowerCase()).toContain("key differences:");
    expect(text).toMatch(/(?:^|\n)-\s+/);
    expect(response.body?.quality_contract_intent_family).toBe("compare");
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(response.body?.quality_contract_fail_reason ?? null).toBeNull();
  });

  it("keeps doc identity answer explicit", async () => {
    const app = createApp();
    const sessionId = "e834-doc-identity";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what doc are we on?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("currently on");
  });

  it("maps phrasing variant to canonical doc identity action", async () => {
    const app = createApp();
    const sessionId = "e834-doc-identity-variant";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what is the doc we are looking at?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("currently on");
  });

  it("splits doc identity + explain into workspace-context reasoning path", async () => {
    const app = createApp();
    const sessionId = "e834-doc-identity-explain";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what doc are we on and explain the key claim", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items) ? response.body.planner_contract.plan_items : [];
    expect(planItems.length).toBeGreaterThanOrEqual(2);
    expect(planItems[0]?.lane).toBe("workspace");
    expect(planItems[1]?.lane).toBe("reasoning");
    const text = String(response.body?.text ?? "");
    expect(text.toLowerCase()).toContain("explained");
    expect(text.toLowerCase()).toContain("key claim:");
    expect(response.body?.quality_contract_intent_family).toBe("explain");
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(response.body?.quality_contract_fail_reason ?? null).toBeNull();
  });

  it("treats differences/deltas phrasing as compare-style final output", async () => {
    const app = createApp();
    const sessionId = "e834-differences-deltas";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called delta note", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "summarize differences and add to note delta note", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const text = String(response.body?.text ?? "");
    expect(text.toLowerCase()).toContain("key differences:");
    expect(text).toMatch(/(?:^|\n)-\s+/);
    expect(response.body?.quality_contract_intent_family).toBe("compare");
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(response.body?.quality_contract_fail_reason ?? null).toBeNull();
  });

  it("adds clipboard write step for compare-and-copy-result workflow", async () => {
    const app = createApp();
    const sessionId = "e834-compare-copy-clipboard";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called clipboard note", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with note clipboard note and copy result to clipboard", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items) ? response.body.planner_contract.plan_items : [];
    const traceItems = Array.isArray(response.body?.execution_trace) ? response.body.execution_trace : [];
    const clipboardPlan = planItems.find((step: any) => step?.id === "workspace_action_write_clipboard");
    expect(clipboardPlan?.lane).toBe("workspace");
    expect(clipboardPlan?.action?.panel_id).toBe("workstation-clipboard-history");
    expect(clipboardPlan?.action?.action_id).toBe("write_clipboard");
    expect(clipboardPlan?.action?.args?.text).toBe("{{reasoning_followup_text}}");
    const clipboardTrace = traceItems.find((step: any) => step?.id === "workspace_action_write_clipboard");
    expect(clipboardTrace?.status).toBe("completed");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("key differences:");
    expect(response.body?.quality_contract_pass).toBe(true);
  });
});
