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

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const resultArtifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);
const latestSelection = (body: any): any =>
  resultArtifacts(body).find((artifact) => artifact?.kind === "latest_doc_selection") ??
  (body?.latest_doc_selection?.kind === "latest_doc_selection" ? body.latest_doc_selection : null);
const staleLatestAlias = "/docs/audits/research/warp-nhm2-solve-authority-audit-latest.md";
const staleDatedAliasTarget = "/docs/audits/research/warp-nhm2-solve-authority-audit-2026-04-02.md";

describe("helix ask E26 latest doc selection", () => {
  it("ranks newer high-topic NHM2 warp solve docs above stale latest aliases", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to the latest NHM2 warp solve doc",
        mode: "read",
        sessionId: `e26-latest-nhm2-solve-${Date.now()}`,
      })
      .expect(200);

    const selection = latestSelection(response.body);
    expect(selection).toBeTruthy();
    expect(selection?.candidates?.length).toBeGreaterThanOrEqual(2);
    expect(selection?.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "alias_vs_newer_file" })]),
    );
    expect(selection?.selected_path).toMatch(/^\/docs\//);
    expect(selection?.selected_path).not.toBe(staleLatestAlias);
    expect(selection?.selected_path).not.toBe(staleDatedAliasTarget);
    expect(selection?.selected_rank).toBe(1);
    expect(response.body?.open_doc_selected_path).toBe(selection?.selected_path);
    expect(response.body?.latest_doc_contract_pass).toBe(true);
    expect(answerText(response.body)).toContain(selection?.selected_path);
    expect(answerText(response.body)).toContain("Opened latest verified NHM2 warp solve candidate:");
    expect(answerText(response.body)).toMatch(/Document:\n- .+\n\s+Path: \/docs\//);
    expect(answerText(response.body)).not.toMatch(/^Opened document:/);
    expect(answerText(response.body)).toContain("Skipped stale latest alias:");
    expect(answerText(response.body)).toContain(`Path: ${staleLatestAlias}`);
  }, 60000);

  it("exposes latest-doc debug fields for open latest turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open the latest NHM2 doc",
        mode: "read",
        sessionId: `e26-latest-debug-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.latest_doc_candidate_count).toBeGreaterThan(0);
    expect(response.body?.latest_doc_selected_path).toMatch(/^\/docs\//);
    expect(response.body?.latest_doc_selected_rank).toBe(1);
    expect(["high", "medium", "low"]).toContain(response.body?.latest_doc_selection_confidence);
    expect(response.body?.latest_doc_contract_pass).toBe(true);
  }, 60000);

  it("opens the latest NHM2 whitepaper doc without requiring evidence-location output", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to the latest white paper doc about NHM2",
        mode: "read",
        sessionId: `e26-latest-whitepaper-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("latest_doc_navigation");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(response.body?.final_status).not.toBe("final_failure");
    expect(response.body?.open_doc_selected_path ?? response.body?.latest_doc_selected_path).toBe(
      "/docs/research/nhm2-current-status-whitepaper.md",
    );
    expect(answerText(response.body)).toContain("/docs/research/nhm2-current-status-whitepaper.md");
  }, 60000);

  it("does not apply latest-doc wording to explicit path opens", async () => {
    const app = createApp();
    const explicitPath = "/docs/helix-ask-readiness-debug-loop.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `open ${explicitPath}`,
        mode: "read",
        sessionId: `e26-explicit-open-${Date.now()}`,
      })
      .expect(200);

    expect(answerText(response.body)).toContain("Opened document:");
    expect(answerText(response.body)).toContain(`Path: ${explicitPath}`);
    expect(answerText(response.body)).not.toContain("latest verified");
    expect(response.body?.latest_doc_selection).toBeUndefined();
  }, 60000);

  it("returns typed unresolved failure when no latest-doc candidates exist", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to the latest zqxv nowhere antimatter oatmeal doc",
        mode: "read",
        sessionId: `e26-latest-missing-${Date.now()}`,
      })
      .expect(200);

    const selection = latestSelection(response.body);
    if (selection) {
      expect(selection.kind).toBe("latest_doc_selection");
      expect(selection.candidates).toEqual([]);
    }
    expect(response.body?.workspace_action).toBeNull();
    expect(response.body?.final_status).toBe("final_failure");
    expect(["open_doc_unresolved", "latest_doc_not_resolved"]).toContain(response.body?.terminal_error_code);
    expect(answerText(response.body)).toMatch(/No docs matched|Could not resolve|unresolved/i);
  }, 60000);
});
