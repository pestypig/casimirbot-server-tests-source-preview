import { beforeEach, describe, expect, it } from "vitest";
import {
  getLatestStagePlayLiveSourceImmersionState,
  getStagePlayLiveSourceImmersionState,
  listStagePlayLiveSourceImmersionStates,
  recordStagePlayLiveSourceImmersionState,
  resetStagePlayLiveSourceImmersionStateStoreForTest,
} from "../services/stage-play/stage-play-live-source-immersion-state-store";
import {
  configureStagePlayLiveSourceWatchJobPolicy,
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";

describe("stage play live-source immersion state store", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayLiveSourceImmersionStateStoreForTest();
  });

  it("records current immersion state as evidence-only live-source context", () => {
    const state = recordStagePlayLiveSourceImmersionState({
      threadId: "helix-ask:desktop",
      jobId: "stage_play_live_source_job:test",
      policyId: "stage_play_live_source_watch_job_policy:test",
      profileId: "stage_play_live_source_interpreter_profile:test",
      sourceIds: ["visual_source:test"],
      latestMailIds: ["stage_play_live_source_mail:1"],
      latestEvidenceRefs: ["visual_evidence:1"],
      sourceIdentity: {
        label: "Minecraft YouTube video",
        confidence: 0.9,
        stable: true,
      },
      stableFacts: ["Minecraft UI", "block world"],
      currentSceneFacts: ["player is in a wooden base"],
      changedFacts: ["player returned indoors"],
      currentActivity: "interior_base",
      salience: {
        level: "medium",
        reasons: ["scene transition"],
        voiceCandidate: false,
      },
      createdAt: "2026-06-08T23:00:00.000Z",
    });

    expect(state.immersionStateId).toMatch(/^stage_play_live_source_immersion_state:/);
    expect(state.staleness.state).toBe("current");
    expect(state.stableFacts).toEqual(["Minecraft UI", "block world"]);
    expect(state.changedFacts).toEqual(["player returned indoors"]);
    expect(state.assistant_answer).toBe(false);
    expect(state.terminal_eligible).toBe(false);
    expect(state.context_role).toBe("tool_evidence");
    expect(state.raw_content_included).toBe(false);
    expect(getStagePlayLiveSourceImmersionState(state.immersionStateId)?.immersionStateId).toBe(state.immersionStateId);
  });

  it("carries stable facts forward unless contradicted and keeps changed facts scoped to the latest window", () => {
    const first = recordStagePlayLiveSourceImmersionState({
      threadId: "helix-ask:desktop",
      jobId: "stage_play_live_source_job:test",
      sourceIds: ["visual_source:test"],
      latestMailIds: ["stage_play_live_source_mail:1"],
      sourceIdentity: {
        label: "Minecraft YouTube video",
        confidence: 0.85,
        stable: true,
      },
      stableFacts: ["Minecraft UI", "block world", "player POV"],
      currentSceneFacts: ["inventory screen visible"],
      changedFacts: ["inventory opened"],
      currentActivity: "inventory_management",
      createdAt: "2026-06-08T23:01:00.000Z",
    });

    const second = recordStagePlayLiveSourceImmersionState({
      threadId: "helix-ask:desktop",
      jobId: "stage_play_live_source_job:test",
      sourceIds: ["visual_source:test"],
      latestMailIds: ["stage_play_live_source_mail:2"],
      stableFacts: ["YouTube playback"],
      contradictedStableFacts: ["player POV"],
      currentSceneFacts: ["camera shows outdoor forest"],
      changedFacts: ["player moved outdoors"],
      currentActivity: "outdoor_exploration",
      createdAt: "2026-06-08T23:01:10.000Z",
    });

    expect(second.stableFacts).toEqual(["Minecraft UI", "block world", "YouTube playback"]);
    expect(second.changedFacts).toEqual(["player moved outdoors"]);
    expect(second.changedFacts).not.toContain("inventory opened");
    expect(getStagePlayLiveSourceImmersionState(first.immersionStateId)?.staleness).toMatchObject({
      state: "superseded",
      supersededByStateId: second.immersionStateId,
    });
    expect(getLatestStagePlayLiveSourceImmersionState({
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:test",
    })?.immersionStateId).toBe(second.immersionStateId);
  });

  it("marks the current immersion state stale when new mail is enqueued", () => {
    const { jobState } = configureStagePlayLiveSourceWatchJobPolicy({
      threadId: "helix-ask:desktop",
      sourceIds: ["visual_source:test"],
      objectiveText: "Watch the visual source.",
      now: "2026-06-08T23:02:00.000Z",
    });
    const state = recordStagePlayLiveSourceImmersionState({
      threadId: "helix-ask:desktop",
      jobId: jobState.jobId,
      sourceIds: ["visual_source:test"],
      latestMailIds: ["stage_play_live_source_mail:prior"],
      stableFacts: ["Minecraft UI"],
      currentSceneFacts: ["player is underground"],
      changedFacts: ["entered cave"],
      currentActivity: "mining_or_cave",
      createdAt: "2026-06-08T23:02:01.000Z",
    });

    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:test",
      sourceKind: "visual_frame",
      frameRef: "visual_frame:next",
      evidenceRef: "visual_evidence:next",
      summaryText: "The next frame shows the player near a chest inside a base.",
      createdAt: "2026-06-08T23:02:10.000Z",
    });

    expect(getStagePlayLiveSourceImmersionState(state.immersionStateId)?.staleness).toMatchObject({
      state: "stale_after_new_mail",
      staleAfterMailId: mail.mailId,
    });
    expect(listStagePlayLiveSourceImmersionStates({
      threadId: "helix-ask:desktop",
      stalenessState: "stale_after_new_mail",
    })).toHaveLength(1);
  });
});
