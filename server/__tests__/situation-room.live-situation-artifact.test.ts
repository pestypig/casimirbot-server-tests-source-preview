import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveLiveSituationArtifact,
  createLiveSituationArtifact,
  getActiveLiveSituationArtifactForThread,
  getLiveSituationArtifact,
  listLiveSituationArtifactDeltas,
  pauseLiveSituationArtifact,
  resetLiveSituationArtifacts,
  resumeLiveSituationArtifact,
  updateLiveSituationArtifact,
} from "../services/situation-room/live-situation-artifact-store";

describe("live situation artifact store", () => {
  beforeEach(() => {
    resetLiveSituationArtifacts();
  });

  it("creates a thread-owned compact live situation artifact", () => {
    const artifact = createLiveSituationArtifact({
      thread_id: "thread:live-artifact",
      created_turn_id: "turn:setup",
      session_id: "situation_goal:1",
      room_id: "room:minecraft-minehut",
      world_id: "minecraft:minehut",
      source_ids: ["source:minecraft-server"],
      objective: "Watch for danger or progress.",
      mode: "text_only",
    });

    expect(artifact).toMatchObject({
      schema: "helix.live_situation_artifact.v1",
      thread_id: "thread:live-artifact",
      created_turn_id: "turn:setup",
      context_policy: "compact_context_pack_only",
      raw_transcript_included: false,
      raw_audio_included: false,
      deterministic_content_role: "observation_not_assistant_answer",
    });
    expect(getLiveSituationArtifact(artifact.artifact_id)?.artifact_id).toBe(artifact.artifact_id);
    expect(getActiveLiveSituationArtifactForThread("thread:live-artifact")?.artifact_id).toBe(artifact.artifact_id);
  });

  it("updates with hash-backed deltas and lifecycle status changes", () => {
    const artifact = createLiveSituationArtifact({
      thread_id: "thread:live-artifact",
      created_turn_id: "turn:setup",
      room_id: "room:minecraft-minehut",
    });
    const update = updateLiveSituationArtifact({
      artifact_id: artifact.artifact_id,
      turn_id: "turn:aux",
      reason: "risk_update",
      current_state_lines: {
        risk: "Low health near hostile entities.",
      },
      evidence_refs: ["mc:event:damage"],
    });

    expect(update?.delta).toMatchObject({
      schema: "helix.live_situation_artifact_delta.v1",
      artifact_id: artifact.artifact_id,
      reason: "risk_update",
      changed_fields: expect.arrayContaining(["current_state_lines"]),
      evidence_refs: ["mc:event:damage"],
    });
    expect(update?.delta.previous_hash).not.toBe(update?.delta.next_hash);
    expect(listLiveSituationArtifactDeltas(artifact.artifact_id)).toHaveLength(1);
    expect(pauseLiveSituationArtifact(artifact.artifact_id)?.status).toBe("paused");
    expect(resumeLiveSituationArtifact(artifact.artifact_id)?.status).toBe("active");
    expect(archiveLiveSituationArtifact(artifact.artifact_id)?.status).toBe("completed");
  });
});
