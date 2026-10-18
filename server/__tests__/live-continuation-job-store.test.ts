import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_CONTINUATION_LANES,
  getActiveLiveContinuationJobForRoom,
  listLiveContinuationJobs,
  pauseLiveContinuationJob,
  resetLiveContinuationJobsForTest,
  resumeLiveContinuationJob,
  stopLiveContinuationJob,
  upsertLiveContinuationJob,
} from "../services/situation-room/live-continuation-job-store";

describe("live continuation job store", () => {
  beforeEach(() => {
    resetLiveContinuationJobsForTest();
  });

  it("upserts a single-agent continuation baton for an existing Helix Ask thread", () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      environment_id: "env:minecraft",
      contract_id: "contract:live",
      source_ids: ["source:paper", "source:paper", " source:visual "],
      objective: "Watch my Minecraft run and flag danger or progress.",
      voice_policy: "confirm_speak_required",
      lanes_enabled: ["source_health", "prediction_reflection", "voice_gate"],
      cooldowns: {
        callout_dedupe_keys: { "risk:cave": "2026-06-02T02:00:00.000Z" },
        min_tick_interval_ms: 15000,
      },
      last_observation_refs: ["world-event:1", "world-event:1"],
      now: "2026-06-02T02:00:00.000Z",
    });

    expect(job).toMatchObject({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      environment_id: "env:minecraft",
      contract_id: "contract:live",
      source_ids: ["source:paper", "source:visual"],
      objective: "Watch my Minecraft run and flag danger or progress.",
      status: "active",
      mode: "single_agent",
      voice_policy: "confirm_speak_required",
      evidence_threshold: "observed",
      lanes_enabled: ["prediction_reflection", "source_health", "voice_gate"],
      cooldowns: {
        callout_dedupe_keys: { "risk:cave": "2026-06-02T02:00:00.000Z" },
        last_tick_at: null,
        min_tick_interval_ms: 15000,
      },
      last_observation_refs: ["world-event:1"],
      created_at: "2026-06-02T02:00:00.000Z",
      updated_at: "2026-06-02T02:00:00.000Z",
    });
    expect(job.job_id).toMatch(/^live_continuation:/);
    expect(getActiveLiveContinuationJobForRoom("room:overworld")?.job_id).toBe(job.job_id);
  });

  it("keeps existing cooldowns and created_at when upserting the same baton", () => {
    const first = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run.",
      now: "2026-06-02T02:00:00.000Z",
    });
    const second = upsertLiveContinuationJob({
      job_id: first.job_id,
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper", "source:visual"],
      objective: "Watch my Minecraft run.",
      cooldowns: {
        last_tick_at: "2026-06-02T02:00:10.000Z",
      },
      last_observation_refs: ["world-event:2"],
      now: "2026-06-02T02:00:12.000Z",
    });

    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at).toBe("2026-06-02T02:00:12.000Z");
    expect(second.source_ids).toEqual(["source:paper", "source:visual"]);
    expect(second.cooldowns.last_tick_at).toBe("2026-06-02T02:00:10.000Z");
    expect(second.cooldowns.min_tick_interval_ms).toBe(5000);
    expect(second.last_observation_refs).toEqual(["world-event:2"]);
  });

  it("lists, pauses, resumes, and stops jobs without creating chats", () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run.",
      now: "2026-06-02T02:00:00.000Z",
    });

    expect(pauseLiveContinuationJob(job.job_id, "2026-06-02T02:00:01.000Z")?.status).toBe("paused");
    expect(getActiveLiveContinuationJobForRoom("room:overworld")).toBeNull();
    expect(resumeLiveContinuationJob(job.job_id, "2026-06-02T02:00:02.000Z")?.status).toBe("active");
    expect(stopLiveContinuationJob(job.job_id, "2026-06-02T02:00:03.000Z")?.status).toBe("stopped");
    expect(listLiveContinuationJobs({ roomId: "room:overworld" })).toEqual([]);
    expect(listLiveContinuationJobs({ roomId: "room:overworld", includeStopped: true })).toHaveLength(1);
  });

  it("defaults to all single-agent lanes and propose-only voice policy", () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      objective: "Watch my Minecraft run.",
    });

    expect(job.mode).toBe("single_agent");
    expect(job.voice_policy).toBe("propose_only");
    expect(job.evidence_threshold).toBe("observed");
    expect(job.lanes_enabled).toEqual(DEFAULT_LIVE_CONTINUATION_LANES);
  });
});
