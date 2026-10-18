import express from "express";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore } from "../services/helix-thread/ledger";
import { clearCategorizationEventsForTest } from "../services/situation-room/categorization-bus";
import { clearSyntheticEvidenceForTest } from "../services/situation-room/synthetic-evidence-ledger";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { ingestWorldEvent, resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const threadId = "helix-ask:desktop";

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
      turnId: "turn:semantic-context",
    });
  }
};

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("Helix Ask Minecraft semantic context", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
  });

  it("does not promote legacy unbound semantic utility events into answer authority", async () => {
    const app = await createApp();
    await replayFixture("chicken-egg-flow.jsonl");

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Is this a chicken farm and what are the chickens useful for in Minecraft?",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    expect(response.body.final_answer_source).not.toBe("artifact_synthesis");
    expect(response.body.source_target_intent).toMatchObject({
      target_source: "model_only",
      target_kind: "general_background",
    });
    expect(String(response.body.answer)).not.toMatch(
      /Semantic reference|egg-source farm|Status: confirmed/i,
    );
    expect(response.body.situation_context_pack).toBeUndefined();
  }, 60000);

  it("fails closed when legacy unbound world events are the only current-state evidence", async () => {
    const app = await createApp();
    await replayFixture("random-animals-no-farm.jsonl");

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Is this chicken area a farm in Minecraft?",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    expect(response.body.ok).toBe(false);
    expect(response.body.response_type).toBe("final_failure");
    expect(response.body.final_answer_source).toBe("typed_failure");
    expect([
      "capability_itinerary_observations_missing",
      "direct_answer_unavailable",
    ]).toContain(response.body.terminal_error_code);
    expect(String(response.body.answer)).not.toMatch(
      /confidence 0\.35|Containment context is not established/i,
    );
  }, 60000);
});
