import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { recordCategorizationEvent, clearCategorizationEventsForTest } from "../services/situation-room/categorization-bus";
import { clearInterpretedEventLogForTest } from "../services/situation-room/interpreted-event-log-store";
import {
  createLiveSituationArtifact,
  resetLiveSituationArtifacts,
} from "../services/situation-room/live-situation-artifact-store";
import { clearSyntheticEvidenceForTest, recordSyntheticEvidence } from "../services/situation-room/synthetic-evidence-ledger";
import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("interpreted event log and present-state projection", () => {
  beforeEach(() => {
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
    clearInterpretedEventLogForTest();
    resetLiveSituationArtifacts();
  });

  it("projects categorization and synthetic evidence as compact interpreted events", async () => {
    const app = createApp();
    recordCategorizationEvent({
      thread_id: "thread:interpreted-log",
      source_event_id: "world:event:1",
      source_family: "minecraft",
      category: "evidence",
      summary: "Dense chicken cluster observed in a compact area.",
      confidence: 0.62,
      evidence_refs: ["world:event:1"],
    });
    recordSyntheticEvidence({
      thread_id: "thread:interpreted-log",
      produced_by: "deterministic_reducer",
      claim: "A dense contained entity cluster may be useful as a farm hypothesis.",
      support_status: "partial",
      source_refs: ["world:event:1"],
    });

    const response = await request(app)
      .get("/api/agi/situation/interpreted-log")
      .query({ thread_id: "thread:interpreted-log", limit: 20 })
      .expect(200);

    expect(response.body.raw_logs_included).toBe(false);
    expect(response.body.events.some((event: { kind: string }) => event.kind === "categorization")).toBe(true);
    expect(response.body.events.some((event: { kind: string; assistant_answer: boolean }) =>
      event.kind === "synthetic_evidence" && event.assistant_answer === false,
    )).toBe(true);
  });

  it("records user steering and updates the present-state card without mutating answers", async () => {
    const app = createApp();
    const artifact = createLiveSituationArtifact({
      thread_id: "thread:steering",
      created_turn_id: "turn:setup",
      room_id: "room:minecraft-minehut",
      source_ids: ["source:minecraft-server"],
      objective: "Watch the Minecraft run.",
      mode: "text_only",
    });

    const steer = await request(app)
      .post("/api/agi/situation/interpreted-log/steer")
      .send({
        thread_id: "thread:steering",
        room_id: "room:minecraft-minehut",
        prompt: "I am actually building a lava-lit stair mine.",
      })
      .expect(200);

    expect(steer.body.steering.assistant_answer).toBe(false);
    expect(steer.body.interpreted_event.kind).toBe("user_steering");
    expect(steer.body.interpreted_event.raw_logs_included).toBe(false);
    expect(steer.body.live_artifact_delta.artifact_id).toBe(artifact.artifact_id);
    expect(steer.body.present_state_card.lines.some((line: { value: string }) =>
      /lava-lit stair mine/i.test(line.value),
    )).toBe(true);

    const log = await request(app)
      .get("/api/agi/situation/interpreted-log")
      .query({ thread_id: "thread:steering", room_id: "room:minecraft-minehut" })
      .expect(200);
    expect(log.body.events.some((event: { kind: string }) => event.kind === "user_steering")).toBe(true);
  });
});
