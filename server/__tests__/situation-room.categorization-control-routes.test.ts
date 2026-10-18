import express from "express";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore } from "../services/helix-thread/ledger";
import { clearCategorizationEventsForTest } from "../services/situation-room/categorization-bus";
import { clearLearningPromotionRecordsForTest } from "../services/situation-room/learning-promotion";
import { clearSyntheticEvidenceForTest } from "../services/situation-room/synthetic-evidence-ledger";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { ingestWorldEvent, resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const threadId = "helix-ask:desktop";
const profileId = `profile:test-routes:${Date.now()}`;
const profileArchivePath = path.resolve(
  process.cwd(),
  ".cal/profile-archives",
  `${profileId.replace(/[^a-zA-Z0-9_.-]/g, "_")}.jsonl`,
);

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft/world-sense", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const replayFixture = async (name: string) => {
  for (const event of readFixture(name)) {
    await ingestWorldEvent(event, {
      appendToThread: true,
      threadId,
      turnId: "turn:categorization-routes",
    });
  }
};

describe("categorization control and archive routes", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
    clearLearningPromotionRecordsForTest();
  });

  afterEach(() => {
    if (fs.existsSync(profileArchivePath)) {
      fs.rmSync(profileArchivePath, { force: true });
    }
  });

  it("starts, queries, archives, recalls, replays, and compares a categorization job", async () => {
    const app = await createApp();

    const start = await request(app)
      .post("/api/agi/situation/categorization-jobs/start")
      .send({
        thread_id: threadId,
        profile_id: profileId,
        room_id: "room:minecraft-minehut",
        source_family: "minecraft_events",
        source_ids: ["source:minecraft-server"],
        world_id: "minecraft:minehut",
        objective: "Route-level Minecraft categorization job.",
      })
      .expect(200);
    const jobId = start.body.job.job_id as string;
    expect(start.body.receipt.assistant_answer).toBe(false);

    await replayFixture("chicken-egg-flow.jsonl");

    const jobs = await request(app)
      .get("/api/agi/situation/categorization-jobs")
      .query({ thread_id: threadId, room_id: "room:minecraft-minehut" })
      .expect(200);
    expect(jobs.body.jobs[0].counters.source_events_seen).toBe(3);
    expect(jobs.body.raw_logs_included).toBe(false);

    const compactWindow = await request(app)
      .post("/api/agi/situation/event-window/query")
      .send({ thread_id: threadId, room_id: "room:minecraft-minehut", include_raw_events: false })
      .expect(200);
    expect(compactWindow.body.result.raw_content_included).toBe(false);
    expect(compactWindow.body.result.events.some((event: Record<string, unknown>) => "raw_event" in event)).toBe(false);

    const archive = await request(app)
      .post(`/api/agi/situation/categorization-jobs/${encodeURIComponent(jobId)}/archive`)
      .send({ profile_id: profileId })
      .expect(200);
    expect(archive.body.archive.raw_logs_included).toBe(false);
    expect(archive.body.archive.evidence_index.length).toBeGreaterThan(0);
    const archiveId = archive.body.archive.archive_id as string;

    const archives = await request(app)
      .get("/api/agi/situation/profile-archives")
      .query({ profile_id: profileId })
      .expect(200);
    expect(archives.body.archives.some((entry: Record<string, unknown>) => entry.archive_id === archiveId)).toBe(true);

    const replay = await request(app)
      .post(`/api/agi/situation/profile-archives/${encodeURIComponent(archiveId)}/replay`)
      .send({ profile_id: profileId, max_events: 10 })
      .expect(200);
    expect(replay.body.result.replay_thread_id).toMatch(/^helix-replay:/);
    expect(replay.body.result.raw_content_included).toBe(false);

    const compare = await request(app)
      .post(`/api/agi/situation/profile-archives/${encodeURIComponent(archiveId)}/compare-current`)
      .send({ profile_id: profileId, thread_id: threadId })
      .expect(200);
    expect(compare.body.comparison.raw_logs_included).toBe(false);
  }, 20000);

  it("promotes a pattern candidate only through explicit promotion route", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/categorization-jobs/start")
      .send({
        thread_id: threadId,
        room_id: "room:minecraft-minehut",
        source_family: "minecraft_events",
        source_ids: ["source:minecraft-server"],
        world_id: "minecraft:minehut",
        objective: "Promotion route test.",
      })
      .expect(200);
    await replayFixture("chicken-egg-flow.jsonl");

    const candidates = await request(app)
      .get("/api/agi/situation/pattern-candidates")
      .query({ thread_id: threadId })
      .expect(200);
    const candidate = candidates.body.candidates.find((entry: Record<string, unknown>) =>
      String(entry.pattern_label).includes("egg-source"),
    );
    expect(candidate.status).toBe("candidate");

    const promoted = await request(app)
      .post(`/api/agi/situation/pattern-candidates/${encodeURIComponent(candidate.candidate_id)}/promote`)
      .send({ thread_id: threadId, observed_replay_count: 2, required_replay_count: 2 })
      .expect(200);
    expect(promoted.body.promotion.decision).toBe("promoted");
    expect(promoted.body.candidate.status).toBe("promoted");
    expect(promoted.body.promotion.assistant_answer).toBe(false);
  }, 20000);
});
