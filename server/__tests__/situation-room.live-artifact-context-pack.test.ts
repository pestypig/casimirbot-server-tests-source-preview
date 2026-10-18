import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveSituationArtifact,
  resetLiveSituationArtifacts,
} from "../services/situation-room/live-situation-artifact-store";
import { startContinuousCategorizationJob } from "../services/situation-room/continuous-categorization-job-store";
import { buildSituationContextPack } from "../services/situation-room/situation-context-pack";
import { resetSituationGoalSessions } from "../services/situation-room/situation-goal-session-store";
import { resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

describe("live situation artifact context pack", () => {
  beforeEach(() => {
    resetLiveSituationArtifacts();
    resetSituationGoalSessions();
    resetWorldEventIngestState();
  });

  it("reads the active live artifact rather than raw panel state", () => {
    const artifact = createLiveSituationArtifact({
      thread_id: "thread:context-pack",
      created_turn_id: "turn:setup",
      room_id: "room:minecraft-minehut",
      world_id: "minecraft:minehut",
      source_ids: ["source:minecraft-server"],
      objective: "Watch for danger and progress.",
      mode: "text_only",
    });

    const pack = buildSituationContextPack({
      threadId: "thread:context-pack",
      roomId: "room:minecraft-minehut",
    });

    expect(pack.live_situation_artifact).toMatchObject({
      artifact_id: artifact.artifact_id,
      objective: "Watch for danger and progress.",
      current_state_lines: {
        now: expect.any(String),
        last_decision: expect.any(String),
      },
    });
    expect(pack.context_policy).toBe("compact_context_pack_only");
    expect(pack.raw_transcript_included).toBe(false);
    expect(pack.raw_audio_included).toBe(false);
    expect(pack.deterministic_content_role).toBe("observation_not_assistant_answer");
  });

  it("includes active categorization jobs as compact evidence controls", () => {
    const { job } = startContinuousCategorizationJob({
      threadId: "thread:context-pack",
      profileId: "DatDamPig",
      roomId: "room:minecraft-minehut",
      sourceFamily: "minecraft_events",
      sourceIds: ["source:minecraft-server"],
      worldId: "minecraft:minehut",
      objective: "Categorize Minehut world evidence.",
    });

    const pack = buildSituationContextPack({
      threadId: "thread:context-pack",
      roomId: "room:minecraft-minehut",
    });

    expect(pack.active_categorization_jobs?.[0]).toMatchObject({
      job_id: job.job_id,
      source_family: "minecraft_events",
      status: "active",
      raw_logs_included: false,
      assistant_answer: false,
    });
  });
});
