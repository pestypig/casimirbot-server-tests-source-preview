import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveSituationArtifact,
  resetLiveSituationArtifacts,
  updateLiveSituationArtifact,
} from "../services/situation-room/live-situation-artifact-store";
import { resetSituationGoalSessions } from "../services/situation-room/situation-goal-session-store";
import { resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const createApp = async (): Promise<express.Express> => {
  const agi = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", agi.planRouter);
  return app;
};

describe("live situation artifact read route", () => {
  beforeEach(() => {
    resetLiveSituationArtifacts();
    resetSituationGoalSessions();
    resetWorldEventIngestState();
  });

  it("returns the active artifact and bounded deltas without raw logs", async () => {
    const app = await createApp();
    const artifact = createLiveSituationArtifact({
      thread_id: "helix-ask:test-live-read",
      created_turn_id: "turn:setup",
      session_id: "situation_goal:test-live-read",
      room_id: "room:minecraft-minehut",
      world_id: "minecraft:minehut",
      source_ids: ["source:minecraft-server"],
      objective: "Watch for danger and progress.",
      mode: "text_only",
      now: "2026-05-08T10:00:00.000Z",
    });
    updateLiveSituationArtifact({
      artifact_id: artifact.artifact_id,
      turn_id: "turn:aux",
      reason: "risk_update",
      current_state_lines: {
        risk: "DatDamPig is in danger at 4 health.",
      },
      evidence_refs: ["minecraft:event:risk"],
      now: "2026-05-08T10:00:05.000Z",
    });

    const response = await request(app)
      .get("/api/agi/situation/live-artifact")
      .query({ thread_id: "helix-ask:test-live-read", limit: 30 })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "helix.live_situation_artifact_read.v1",
      artifact: {
        schema: "helix.live_situation_artifact.v1",
        artifact_id: artifact.artifact_id,
        raw_audio_included: false,
        raw_transcript_included: false,
        deterministic_content_role: "observation_not_assistant_answer",
      },
      latest_context_pack: {
        schema: "helix.situation_context_pack.v1",
        raw_audio_included: false,
        raw_transcript_included: false,
        deterministic_content_role: "observation_not_assistant_answer",
      },
      debug: {
        thread_id: "helix-ask:test-live-read",
        artifact_id: artifact.artifact_id,
        delta_count: 1,
        raw_audio_included: false,
        raw_transcript_included: false,
        deterministic_content_role: "observation_not_assistant_answer",
      },
    });
    expect(response.body.deltas).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain("raw_world_events");
    expect(response.body.debug.raw_transcript_included).toBe(false);
    expect(response.body.debug.raw_audio_included).toBe(false);
  });
});
