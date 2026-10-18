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

const answerText = (body: any): string =>
  String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

const actionsOf = (body: any): any[] =>
  (body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);

const startDocAndNoteContext = async (app: express.Express, sessionId: string): Promise<void> => {
  await request(app)
    .post("/api/agi/ask/turn")
    .send({
      question: "open the newest warp travel-time profile writeup",
      mode: "read",
      debug: true,
      sessionId,
    })
    .expect(200);

  await request(app)
    .post("/api/agi/ask/turn")
    .send({
      question: "make a note called browser loop scratch",
      mode: "read",
      debug: true,
      sessionId,
    })
    .expect(200);
};

describe("helix ask E46 compound argument partition", () => {
  it("partitions locate source query from note mutation target", async () => {
    const app = createApp();
    const sessionId = `e46-partition-${Date.now()}`;
    await startDocAndNoteContext(app, sessionId);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find where this doc talks about resolution sensitivity and add that location to browser loop scratch",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const partition = response.body?.compound_argument_partition ?? response.body?.universal_goal_frame?.compound_argument_partition;
    expect(partition?.source_query).toBe("resolution sensitivity");
    expect(partition?.operation).toBe("locate_in_doc");
    expect(partition?.mutation_target?.title).toBe("browser loop scratch");
    expect(partition?.phrase_detector_authority).toBe("hint_only");

    const locateActions = actionsOf(response.body).filter(
      (action) => action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc",
    );
    expect(locateActions.length).toBeGreaterThan(0);
    expect(locateActions.every((action) => action?.args?.query === "resolution sensitivity")).toBe(true);
    expect(JSON.stringify(locateActions)).not.toMatch(/add that location to browser loop scratch/i);

    const appendAction = actionsOf(response.body).find(
      (action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note",
    );
    expect(appendAction?.args?.title).toBe("browser loop scratch");
  }, 90000);

  it("renders locate-to-note final answer from clean artifact labels", async () => {
    const app = createApp();
    const sessionId = `e46-final-${Date.now()}`;
    await startDocAndNoteContext(app, sessionId);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find where this doc talks about resolution sensitivity and add that location to browser loop scratch",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const answer = answerText(response.body);
    expect(answer).toMatch(/Updated browser loop scratch/i);
    expect(answer).toMatch(/Location:/i);
    expect(answer).not.toMatch(/resolution sensitivity and add that location/i);
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  }, 90000);
});
