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

const PROCESS_NARRATION_RE = /Completed reasoning for|Planning reasoning turn|I ran a reasoning follow-up|Agent loop|Tool selected:/i;

describe("helix ask turn e10.9 final answer supremacy", () => {
  it("returns a user-facing assistant answer for active-document identity prompts", async () => {
    const app = createApp();
    const sessionId = `e109-doc-identity-${Date.now()}`;
    const openResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);
    const openedPath = openResponse.body?.workspace_action?.args?.path;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what paper am I viewing?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(response.body?.assistant_answer).toContain(openedPath);
    expect(response.body?.text).toBe(response.body?.assistant_answer);
    expect(response.body?.envelope?.answer ?? response.body?.assistant_answer).toContain(openedPath);
    expect(response.body?.assistant_answer).not.toMatch(PROCESS_NARRATION_RE);
  });

  it("keeps agent-loop process data out of the assistant answer for locate prompts", async () => {
    const app = createApp();
    const sessionId = `e109-locate-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "pull up a recent NHM2 mission time paper", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "where does this document mention centerline alpha?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.workspace_action?.action_id).toBe("locate_in_doc");
    expect(response.body?.assistant_answer).toMatch(/^Locations:/i);
    expect(response.body?.assistant_answer).toMatch(/\/docs\/.*:L\d+-L\d+/i);
    expect(response.body?.assistant_answer).toMatch(/shiftLapseCenterlineAlpha|centerline/i);
    expect(response.body?.assistant_answer).not.toMatch(/Use exact and variant phrase search|Confirm location candidates/i);
    const locateSteps = response.body?.step_results?.filter(
      (step: { artifact?: { action_id?: string } }) => step?.artifact?.action_id === "locate_in_doc",
    );
    const locateStep = locateSteps?.find(
      (step: { contract_pass?: boolean; artifact?: { args?: { locate_strategy?: string } } }) =>
        step?.contract_pass === true && step?.artifact?.args?.locate_strategy === "variant",
    );
    expect(locateSteps?.some((step: { contract_pass?: boolean }) => step.contract_pass === false)).toBe(true);
    expect(locateStep?.contract_pass).toBe(true);
    expect(locateStep?.actual_artifacts).toContain("doc_location_matches");
    expect(locateStep?.result_artifact?.match_count).toBeGreaterThan(0);
    expect(response.body?.assistant_answer).not.toMatch(PROCESS_NARRATION_RE);
    expect(response.body?.agent_loop_summary).toMatch(/Tool selected:/);
  });
});
