import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  listLiveAgenticReviewRequests,
  resetLiveAgenticReviews,
} from "../services/situation-room/live-agentic-review-runner";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";

const createApp = async (): Promise<{ app: express.Express }> => {
  const agi = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", agi.planRouter);
  return { app };
};

describe("live agentic review boundary", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveAgenticReviews();
    __resetHelixThreadLedgerStore();
  });

  it("records review requests as tool observations, not assistant answers", async () => {
    const { app } = await createApp();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:review",
      created_turn_id: "turn:equation",
      objective: "Explain live equation values in context.",
      source_ids: ["source:calculator-equation-live"],
      preset: "calculator_equation_interpreter",
      mode: "text_only",
      now: "2026-05-12T12:00:00.000Z",
    });

    const response = await request(app)
      .post("/api/agi/situation/live-agentic-review/request")
      .send({
        thread_id: "helix-ask:review",
        environment_id: environment.environment_id,
        question: "Explain the latest equation result.",
        trigger: "manual_button",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      schema: "helix.live_agentic_review_receipt.v1",
      ok: true,
      request: {
        schema: "helix.live_agentic_review_request.v1",
        thread_id: "helix-ask:review",
        environment_id: environment.environment_id,
        question: "Explain the latest equation result.",
      },
    });
    expect(listLiveAgenticReviewRequests()).toHaveLength(1);

    const ledgerEvents = getHelixThreadLedgerEvents({ threadId: "helix-ask:review" });
    expect(ledgerEvents.some((event) => event.item_type === "toolObservation" && event.meta?.kind === "live_agentic_review_request")).toBe(true);
    expect(ledgerEvents.some((event) => event.item_type === "answer")).toBe(false);
    expect(ledgerEvents.every((event) => !event.assistant_text)).toBe(true);
  }, 60000);
});
