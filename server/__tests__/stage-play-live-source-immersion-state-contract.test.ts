import { describe, expect, it } from "vitest";
import type { StagePlayLiveSourceImmersionStateV1 } from "../../shared/contracts/stage-play-live-source-mail.v1";

describe("StagePlayLiveSourceImmersionStateV1", () => {
  it("keeps persistent live-source scene state evidence-only", () => {
    const state: StagePlayLiveSourceImmersionStateV1 = {
      artifactId: "stage_play_live_source_immersion_state",
      schemaVersion: "stage_play_live_source_immersion_state/v1",
      immersionStateId: "stage_play_live_source_immersion_state:test",
      jobId: "stage_play_live_source_job:test",
      policyId: "stage_play_live_source_watch_job_policy:test",
      profileId: "stage_play_live_source_interpreter_profile:test",
      threadId: "helix-ask:desktop",
      roomId: null,
      environmentId: null,
      sourceIds: ["visual_source:test"],
      latestMailIds: ["stage_play_live_source_mail:test"],
      latestEvidenceRefs: ["visual_evidence:test"],
      sourceIdentity: {
        label: "Minecraft YouTube video",
        confidence: 0.91,
        stable: true,
      },
      stableFacts: ["Minecraft UI", "block world", "player POV"],
      currentSceneFacts: ["wooden interior", "campfire visible"],
      changedFacts: ["player returned indoors"],
      uncertainties: ["audio context unavailable"],
      currentActivity: "interior_base",
      salience: {
        level: "medium",
        reasons: ["scene transition from outdoor exploration to interior base"],
        voiceCandidate: false,
      },
      prediction: {
        predictionId: "stage_play_live_source_prediction:test",
        text: "The next mail should show whether the player resumes inventory management or exits again.",
        horizonMs: 10_000,
        watchTargets: ["inventory UI", "doorway", "outdoor transition"],
        validationSignals: ["inventory opens", "player exits structure", "same interior remains"],
        confidence: 0.62,
      },
      lastValidation: {
        validationId: "stage_play_live_source_prediction_validation:test",
        priorPredictionId: "stage_play_live_source_prediction:prior",
        result: "partially_supported",
        evidenceSummary: "New mail confirmed an interior return but not inventory use.",
      },
      staleness: {
        state: "current",
        staleAfterMailId: null,
        supersededByStateId: null,
      },
      evidenceRefs: [
        "stage_play_live_source_immersion_state:test",
        "visual_evidence:test",
        "stage_play_live_source_mail:test",
      ],
      causalTrace: {
        schemaVersion: "live_source_causal_trace/v1",
        traceId: "live_source_trace:test",
        cycleId: "live_source_cycle:test",
        parentRefs: ["stage_play_live_source_mail:test"],
        causedBy: ["visual_evidence:test"],
        producedRefs: ["stage_play_live_source_immersion_state:test"],
        sourceIds: ["visual_source:test"],
        jobId: "stage_play_live_source_job:test",
        policyId: "stage_play_live_source_watch_job_policy:test",
        profileId: "stage_play_live_source_interpreter_profile:test",
        askTurnId: null,
        evidenceRefs: ["visual_evidence:test"],
      },
      createdAt: "2026-06-08T22:50:00.000Z",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    };

    expect(state.sourceIdentity.label).toBe("Minecraft YouTube video");
    expect(state.stableFacts).toContain("Minecraft UI");
    expect(state.lastValidation?.result).toBe("partially_supported");
    expect(state.assistant_answer).toBe(false);
    expect(state.terminal_eligible).toBe(false);
    expect(state.context_role).toBe("tool_evidence");
    expect(state.raw_content_included).toBe(false);
  });
});
