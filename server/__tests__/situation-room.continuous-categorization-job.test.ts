import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore, getHelixThreadLedgerEvents } from "../services/helix-thread/ledger";
import { clearCategorizationEventsForTest } from "../services/situation-room/categorization-bus";
import {
  getContinuousCategorizationJob,
  listContinuousCategorizationJobReceipts,
  setContinuousCategorizationJobStatus,
  startContinuousCategorizationJob,
} from "../services/situation-room/continuous-categorization-job-store";
import { archiveCategorizationSession, listProfileSituationArchives } from "../services/situation-room/profile-situation-archive-store";
import { clearSyntheticEvidenceForTest } from "../services/situation-room/synthetic-evidence-ledger";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { ingestWorldEvent, resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const threadId = "helix-ask:desktop";
const profileId = "profile:datdampig";

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
  let latest = null as Awaited<ReturnType<typeof ingestWorldEvent>> | null;
  for (const event of readFixture(name)) {
    latest = await ingestWorldEvent(event, {
      appendToThread: true,
      threadId,
      turnId: "turn:categorization-job",
    });
  }
  return latest;
};

describe("continuous categorization jobs", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
  });

  it("updates a thread-owned Minecraft categorization job from source events without assistant answers", async () => {
    const { job, receipt } = startContinuousCategorizationJob({
      threadId,
      profileId,
      roomId: "room:minecraft-minehut",
      sourceFamily: "minecraft_events",
      sourceIds: ["source:minecraft-server"],
      worldId: "minecraft:minehut",
      objective: "Keep compact Minecraft evidence flowing for Cortana-style context.",
    });

    expect(receipt.action).toBe("start");
    expect(receipt.assistant_answer).toBe(false);

    const result = await replayFixture("chicken-egg-flow.jsonl");
    const updated = getContinuousCategorizationJob(job.job_id);

    expect(result?.continuous_categorization_job_receipts?.some((entry) => entry.action === "process_event")).toBe(true);
    expect(updated?.status).toBe("active");
    expect(updated?.counters.source_events_seen).toBe(3);
    expect(updated?.counters.synthetic_evidence).toBeGreaterThan(0);
    expect(updated?.counters.utility_hypotheses).toBeGreaterThan(0);
    expect(updated?.latest_summary).toMatch(/processed/i);

    const ledger = getHelixThreadLedgerEvents({ threadId });
    expect(ledger.some((event) => event.item_type === "toolObservation" && event.meta?.kind === "continuous_categorization_job_receipt")).toBe(true);
    expect(ledger.some((event) => event.item_type === "answer")).toBe(false);
  });

  it("does not update paused categorization jobs", async () => {
    const { job } = startContinuousCategorizationJob({
      threadId,
      profileId,
      roomId: "room:minecraft-minehut",
      sourceFamily: "minecraft_events",
      sourceIds: ["source:minecraft-server"],
      worldId: "minecraft:minehut",
      objective: "Pause test.",
    });
    setContinuousCategorizationJobStatus({
      jobId: job.job_id,
      status: "paused",
      action: "pause",
    });

    await replayFixture("chicken-egg-flow.jsonl");
    const updated = getContinuousCategorizationJob(job.job_id);

    expect(updated?.status).toBe("paused");
    expect(updated?.counters.source_events_seen).toBe(0);
    expect(listContinuousCategorizationJobReceipts(job.job_id).some((receipt) => receipt.action === "pause")).toBe(true);
  });

  it("archives stopped jobs to compact profile memory without raw logs", async () => {
    const { job } = startContinuousCategorizationJob({
      threadId,
      profileId,
      roomId: "room:minecraft-minehut",
      sourceFamily: "minecraft_events",
      sourceIds: ["source:minecraft-server"],
      worldId: "minecraft:minehut",
      objective: "Archive Minecraft run evidence.",
    });
    await replayFixture("chicken-egg-flow.jsonl");
    const stopped = setContinuousCategorizationJobStatus({
      jobId: job.job_id,
      status: "stopped",
      action: "stop",
    }).job;
    const archive = archiveCategorizationSession({
      job: stopped!,
      profileId,
    });

    expect(archive.profile_id).toBe(profileId);
    expect(archive.raw_logs_included).toBe(false);
    expect(archive.assistant_answer).toBe(false);
    expect(archive.evidence_index.length).toBeGreaterThan(0);
    expect(archive.learned_pattern_candidates.length).toBeGreaterThan(0);
    expect(getContinuousCategorizationJob(job.job_id)?.status).toBe("archived");
    expect(listProfileSituationArchives(profileId).some((entry) => entry.archive_id === archive.archive_id)).toBe(true);
  });
});
