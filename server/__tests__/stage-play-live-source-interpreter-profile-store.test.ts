import { describe, expect, it, beforeEach } from "vitest";
import {
  buildStagePlayLiveSourceInterpreterProfileComparisonV1,
  buildStagePlayLiveSourceInterpreterProfileV1,
  type StagePlayLiveSourceInterpreterProfileDomainV1,
  type StagePlayLiveSourceInterpreterProfileStatusV1,
} from "@shared/contracts/stage-play-live-source-interpreter-profile.v1";
import {
  getActiveInterpreterProfileForJob,
  getStagePlayLiveSourceInterpreterProfile,
  linkInterpreterProfileNote,
  listStagePlayLiveSourceInterpreterProfileComparisons,
  listStagePlayLiveSourceInterpreterProfiles,
  recordStagePlayLiveSourceInterpreterProfile,
  recordStagePlayLiveSourceInterpreterProfileComparison,
  resetStagePlayLiveSourceInterpreterProfileStoreForTest,
  setInterpreterProfileStatus,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-store";

const buildProfile = (input: {
  profileId: string;
  title?: string;
  domain?: StagePlayLiveSourceInterpreterProfileDomainV1;
  jobId?: string | null;
  status?: StagePlayLiveSourceInterpreterProfileStatusV1;
  updatedAt?: string;
}) =>
  buildStagePlayLiveSourceInterpreterProfileV1({
    profileId: input.profileId,
    title: input.title ?? "Minecraft Safety Coach",
    threadId: "thread-profile-store",
    roomId: "room-profile-store",
    environmentId: "env-profile-store",
    jobId: input.jobId ?? "job-profile-store",
    policyId: "policy-profile-store",
    sourceKinds: ["visual_frame"],
    domain: input.domain ?? "minecraft",
    objectiveText: "Watch the live source as a Minecraft safety coach.",
    interpretationGuidelines: "Separate observed hazards from inferred player intent.",
    lenses: ["hazards", "resources", "navigation"],
    salienceCriteria: ["hostile mob", "lava", "fall risk"],
    suppressCriteria: ["unchanged inventory"],
    riskCriteria: ["nearby hostile mob"],
    opportunityCriteria: ["visible resource"],
    voiceCalloutCriteria: ["urgent hazard"],
    evidenceRules: {
      preserveRawObservation: true,
      distinguishObservedVsInferred: true,
      requireEvidenceRefs: true,
      askWhenUncertain: true,
    },
    outputStyle: {
      textAnswerStyle: "brief_explanation",
      voiceStyle: "short_callout",
    },
    linkedNoteId: null,
    linkedNoteTitle: null,
    status: input.status ?? "active",
    evidenceRefs: ["watch_job_policy:policy-profile-store"],
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-08T00:00:00.000Z",
  });

describe("stage-play live-source interpreter profile store", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceInterpreterProfileStoreForTest();
  });

  it("prefers one active profile per job and domain while preserving history", () => {
    const first = recordStagePlayLiveSourceInterpreterProfile(buildProfile({
      profileId: "stage_play_live_source_interpreter_profile:first",
      updatedAt: "2026-06-08T00:00:01.000Z",
    }));
    const second = recordStagePlayLiveSourceInterpreterProfile(buildProfile({
      profileId: "stage_play_live_source_interpreter_profile:second",
      updatedAt: "2026-06-08T00:00:02.000Z",
    }));

    expect(first.status).toBe("active");
    expect(second.status).toBe("active");
    expect(getStagePlayLiveSourceInterpreterProfile(first.profileId)?.status).toBe("paused");
    expect(getActiveInterpreterProfileForJob({
      threadId: "thread-profile-store",
      jobId: "job-profile-store",
      domain: "minecraft",
    })?.profileId).toBe(second.profileId);
    expect(listStagePlayLiveSourceInterpreterProfiles({
      threadId: "thread-profile-store",
      jobId: "job-profile-store",
      domain: "minecraft",
    }).map((profile) => profile.profileId)).toEqual([
      first.profileId,
      second.profileId,
    ]);
  });

  it("keeps separate active profiles for different domains", () => {
    const minecraft = recordStagePlayLiveSourceInterpreterProfile(buildProfile({
      profileId: "stage_play_live_source_interpreter_profile:minecraft",
      domain: "minecraft",
      updatedAt: "2026-06-08T00:00:01.000Z",
    }));
    const browser = recordStagePlayLiveSourceInterpreterProfile(buildProfile({
      profileId: "stage_play_live_source_interpreter_profile:browser",
      domain: "browser",
      updatedAt: "2026-06-08T00:00:02.000Z",
    }));

    expect(getStagePlayLiveSourceInterpreterProfile(minecraft.profileId)?.status).toBe("active");
    expect(getStagePlayLiveSourceInterpreterProfile(browser.profileId)?.status).toBe("active");
  });

  it("archives profiles without deleting them and links editable note surfaces", () => {
    const profile = recordStagePlayLiveSourceInterpreterProfile(buildProfile({
      profileId: "stage_play_live_source_interpreter_profile:notes",
    }));
    const linked = linkInterpreterProfileNote({
      profileId: profile.profileId,
      linkedNoteId: "note:profile-guidelines",
      linkedNoteTitle: "Minecraft coach guidelines",
      updatedAt: "2026-06-08T00:00:03.000Z",
    });
    const archived = setInterpreterProfileStatus({
      profileId: profile.profileId,
      status: "archived",
      updatedAt: "2026-06-08T00:00:04.000Z",
    });

    expect(linked?.linkedNoteId).toBe("note:profile-guidelines");
    expect(archived?.status).toBe("archived");
    expect(listStagePlayLiveSourceInterpreterProfiles({
      threadId: "thread-profile-store",
      jobId: "job-profile-store",
    })).toHaveLength(0);
    expect(listStagePlayLiveSourceInterpreterProfiles({
      threadId: "thread-profile-store",
      jobId: "job-profile-store",
      includeArchived: true,
    }).map((item) => item.profileId)).toEqual([profile.profileId]);
  });

  it("records profile comparisons as evidence-only interpretation receipts", () => {
    const profile = recordStagePlayLiveSourceInterpreterProfile(buildProfile({
      profileId: "stage_play_live_source_interpreter_profile:compare",
    }));
    const comparison = recordStagePlayLiveSourceInterpreterProfileComparison(
      buildStagePlayLiveSourceInterpreterProfileComparisonV1({
        comparisonId: "stage_play_live_source_interpreter_profile_comparison:compare",
        profileId: profile.profileId,
        jobId: "job-profile-store",
        policyId: "policy-profile-store",
        mailIds: ["stage_play_live_source_mail:1", "stage_play_live_source_mail:2"],
        narrativeStateRef: "stage_play_live_source_narrative_state:1",
        observedFacts: ["Two compact visual summaries show a cave entrance."],
        inferredMeaning: ["The user may be navigating into a risky area."],
        matchedCriteria: ["cave entrance"],
        suppressedCriteria: [],
        riskMatches: ["dark cave"],
        opportunityMatches: ["visible resource"],
        voiceCalloutMatches: [],
        contradictions: [],
        uncertainties: ["Hostile mobs are not visible in the compact summaries."],
        recommendedDecision: "record_interpretation",
        recommendedNextWatch: ["watch for hostile mob movement"],
        evidenceRefs: [profile.profileId, "stage_play_live_source_mail:1"],
        createdAt: "2026-06-08T00:00:05.000Z",
      }),
    );

    expect(comparison.assistant_answer).toBe(false);
    expect(comparison.terminal_eligible).toBe(false);
    expect(listStagePlayLiveSourceInterpreterProfileComparisons({
      profileId: profile.profileId,
      mailId: "stage_play_live_source_mail:2",
    }).map((item) => item.comparisonId)).toEqual([comparison.comparisonId]);
  });
});
