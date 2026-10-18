import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { planRouter } from "../routes/agi.plan";
import { clearClarificationNeedsForTest } from "../services/situation-room/clarification-need-detector";
import { clearClarificationQuestionProposalsForTest } from "../services/situation-room/clarification-question-planner";
import { clearClarificationQuestionStoreForTest } from "../services/situation-room/clarification-question-store";
import { clearContinuousCategorizationJobsForTest, startContinuousCategorizationJob } from "../services/situation-room/continuous-categorization-job-store";
import { clearGameUtilityHypothesesForTest } from "../services/situation-room/minecraft-entity-utility-reducer";
import { clearInterpretedEventLogForTest } from "../services/situation-room/interpreted-event-log-store";
import { clearPatternConfirmationsForTest } from "../services/situation-room/pattern-confirmation-evaluator";
import { clearPatternCandidatesForTest } from "../services/situation-room/pattern-candidate-ledger";
import { clearSubgoalEvaluationsForTest, listSubgoalEvaluations } from "../services/helix-ask/subgoal-evaluator";
import { clearSyntheticEvidenceForTest } from "../services/situation-room/synthetic-evidence-ledger";
import { clearSteeringMemoryForTest } from "../services/situation-room/steering-memory-store";
import { clearUserSteeringEvidenceForTest, listUserSteeringEvidence } from "../services/situation-room/user-steering-ingest";
import { ingestWorldEvent, resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const threadId = "thread:clarification";
const roomId = "room:minecraft-minehut";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft/world-sense", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

const replayFixture = async (name: string) => {
  for (const event of readFixture(name)) {
    await ingestWorldEvent(event, {
      appendToThread: true,
      threadId,
      turnId: "turn:clarification",
    });
  }
};

describe("clarification dialogue loop", () => {
  beforeEach(() => {
    clearClarificationNeedsForTest();
    clearClarificationQuestionProposalsForTest();
    clearClarificationQuestionStoreForTest();
    clearContinuousCategorizationJobsForTest();
    clearGameUtilityHypothesesForTest();
    clearInterpretedEventLogForTest();
    clearPatternConfirmationsForTest();
    clearPatternCandidatesForTest();
    clearSubgoalEvaluationsForTest();
    clearSteeringMemoryForTest();
    clearSyntheticEvidenceForTest();
    clearUserSteeringEvidenceForTest();
    resetWorldEventIngestState();
  });

  it("queues a question for an ambiguous contained chicken cluster", async () => {
    const app = createApp();
    startContinuousCategorizationJob({
      threadId,
      profileId: "DatDamPig",
      roomId,
      sourceFamily: "minecraft_events",
      sourceIds: ["source:minecraft-server"],
      worldId: "minecraft:minehut",
      objective: "Clarify Minecraft hypotheses.",
    });
    await replayFixture("contained-chicken-cluster.jsonl");

    const response = await request(app)
      .get("/api/agi/situation/clarification-dialogue")
      .query({ thread_id: threadId, room_id: roomId })
      .expect(200);

    expect(response.body.assistant_answer).toBe(false);
    expect(response.body.needs.length).toBeGreaterThan(0);
    expect(response.body.proposals.some((proposal: { question: string; assistant_answer: boolean }) =>
      /animal cluster|farm|temporary storage/i.test(proposal.question) && proposal.assistant_answer === false,
    )).toBe(true);
    expect(response.body.proposals.filter((proposal: { surface_policy: string }) => proposal.surface_policy === "show_text")).toHaveLength(1);
  });

  it("exposes one pending request-input question and suppresses duplicates by cooldown", async () => {
    const app = createApp();
    startContinuousCategorizationJob({
      threadId,
      profileId: "DatDamPig",
      roomId,
      sourceFamily: "minecraft_events",
      sourceIds: ["source:minecraft-server"],
      worldId: "minecraft:minehut",
      objective: "Clarify Minecraft hypotheses.",
    });
    await replayFixture("contained-chicken-cluster.jsonl");

    const first = await request(app)
      .get("/api/agi/situation/clarification-dialogue/pending")
      .query({ thread_id: threadId, room_id: roomId })
      .expect(200);

    expect(first.body.pending).toHaveLength(1);
    expect(first.body.request_user_input.assistant_answer).toBe(false);
    expect(first.body.request_user_input.question).toMatch(/farm|temporary storage|animal cluster/i);

    const second = await request(app)
      .post("/api/agi/situation/clarification-dialogue/rank-latest")
      .send({ thread_id: threadId, room_id: roomId })
      .expect(200);

    expect(second.body.rankings.some((ranking: { suppress_reason?: string | null }) =>
      ranking.suppress_reason === "cooldown",
    )).toBe(true);
  });

  it("records a user answer as steering evidence and updates subgoals", async () => {
    const app = createApp();
    const answer = await request(app)
      .post("/api/agi/situation/clarification-dialogue/answer")
      .send({
        thread_id: threadId,
        room_id: roomId,
        need_id: "clarification_need:test",
        user_claim: "Yes, this is my chicken farm.",
        target_hypothesis_ids: ["game_utility:chicken"],
        effect: "confirm",
      })
      .expect(200);

    expect(answer.body.steering_evidence.assistant_answer).toBe(false);
    expect(answer.body.steering_evidence.raw_content_included).toBe(false);
    expect(answer.body.applied.synthetic_evidence.assistant_answer).toBe(false);
    expect(listUserSteeringEvidence(threadId)).toHaveLength(1);
    expect(listSubgoalEvaluations(threadId).some((entry) => /chicken farm/i.test(entry.goal_label))).toBe(true);
  });

  it("answers by question_id, writes steering memory, and archives compact memory", async () => {
    const app = createApp();
    startContinuousCategorizationJob({
      threadId,
      profileId: "DatDamPig",
      roomId,
      sourceFamily: "minecraft_events",
      sourceIds: ["source:minecraft-server"],
      worldId: "minecraft:minehut",
      objective: "Clarify Minecraft hypotheses.",
    });
    await replayFixture("contained-chicken-cluster.jsonl");

    const pending = await request(app)
      .get("/api/agi/situation/clarification-dialogue/pending")
      .query({ thread_id: threadId, room_id: roomId })
      .expect(200);

    const questionId = pending.body.pending[0].question_id;
    const answer = await request(app)
      .post("/api/agi/situation/clarification-dialogue/answer")
      .send({
        thread_id: threadId,
        room_id: roomId,
        question_id: questionId,
        answer: "This is my chicken farm.",
        profile_id: "DatDamPig",
      })
      .expect(200);

    expect(answer.body.answered_question.status).toBe("answered");
    expect(answer.body.steering_memory.assistant_answer).toBe(false);
    expect(answer.body.pattern_confirmation.promotion_allowed).toBe(false);

    const memory = await request(app)
      .get("/api/agi/situation/steering-memory")
      .query({ profile_id: "DatDamPig", thread_id: threadId })
      .expect(200);

    expect(memory.body.memories).toHaveLength(1);
    expect(memory.body.memories[0].raw_content_included).toBe(false);

    const archive = await request(app)
      .post("/api/agi/situation/steering-memory/archive")
      .send({ profile_id: "DatDamPig", thread_id: threadId })
      .expect(200);

    expect(archive.body.archive.memories).toHaveLength(1);
    expect(archive.body.archive.raw_logs_included).toBe(false);
    expect(archive.body.archive.assistant_answer).toBe(false);
  });
});
