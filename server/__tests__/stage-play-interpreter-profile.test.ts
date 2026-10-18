import { beforeEach, describe, expect, it } from "vitest";
import { buildStagePlayLiveSourceInterpreterProfileV1 } from "@shared/contracts/stage-play-live-source-interpreter-profile.v1";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import {
  compileInterpreterProfileFromNote,
  createInterpreterProfileNote,
  openInterpreterProfileNote,
  resetStagePlayLiveSourceInterpreterProfileNotesForTest,
  syncInterpreterProfileNote,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-notes";
import { compareMailToInterpreterProfile } from "../services/stage-play/stage-play-live-source-interpreter-profile-comparison";
import {
  configureStagePlayLiveSourceWatchJobPolicy,
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";
import { runNextMailWakeRequest } from "../services/stage-play/stage-play-live-source-mail-wake-runner";
import {
  getActiveInterpreterProfileForJob,
  getStagePlayLiveSourceInterpreterProfileCriterionLedger,
  getStagePlayLiveSourceInterpreterProfile,
  listStagePlayLiveSourceInterpreterProfileCriterionLedger,
  listStagePlayLiveSourceInterpreterProfiles,
  recordStagePlayLiveSourceInterpreterProfile,
  resetStagePlayLiveSourceInterpreterProfileStoreForTest,
  setInterpreterProfileStatus,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-store";
import {
  getStagePlayLiveSourceNarrativeState,
  resetStagePlayLiveSourceNarrativeStoreForTest,
} from "../services/stage-play/stage-play-live-source-narrative-store";

const threadId = "thread:stage-play-interpreter-profile";
const roomId = "room:stage-play-interpreter-profile";
const environmentId = "env:stage-play-interpreter-profile";
const sourceId = "visual_source:stage-play-interpreter-profile";
const jobId = "stage_play_live_source_job:stage-play-interpreter-profile";
const policyId = "stage_play_live_source_watch_job_policy:stage-play-interpreter-profile";

beforeEach(() => {
  resetStagePlayLiveSourceInterpreterProfileStoreForTest();
  resetStagePlayLiveSourceInterpreterProfileNotesForTest();
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayLiveSourceNarrativeStoreForTest();
});

const recordMinecraftProfile = (input: {
  profileId?: string;
  title?: string;
  jobId?: string;
  policyId?: string;
  status?: "active" | "paused" | "archived";
  updatedAt?: string;
} = {}) =>
  recordStagePlayLiveSourceInterpreterProfile(
    buildStagePlayLiveSourceInterpreterProfileV1({
      profileId: input.profileId ?? "stage_play_live_source_interpreter_profile:minecraft-survival-coach",
      title: input.title ?? "Minecraft Survival Coach",
      threadId,
      roomId,
      environmentId,
      jobId: input.jobId ?? jobId,
      policyId: input.policyId ?? policyId,
      sourceKinds: ["visual_frame"],
      domain: "minecraft",
      objectiveText: "Watch Minecraft like a survival coach.",
      interpretationGuidelines: "Preserve visual observations, distinguish observed from inferred, and compare updates to survival priorities.",
      lenses: ["survival", "hazards", "resources"],
      salienceCriteria: ["cave exploration", "low light", "hostile mob"],
      suppressCriteria: ["routine walking"],
      riskCriteria: ["low light", "cave exploration", "lava", "hostile mob", "low health"],
      opportunityCriteria: ["rare resource"],
      voiceCalloutCriteria: ["hostile mob", "lava", "low health", "nightfall without shelter"],
      evidenceRules: {
        preserveRawObservation: true,
        distinguishObservedVsInferred: true,
        requireEvidenceRefs: true,
        askWhenUncertain: true,
      },
      outputStyle: {
        textAnswerStyle: "brief_explanation",
        voiceStyle: "warning_only",
      },
      linkedNoteId: null,
      linkedNoteTitle: null,
      status: input.status ?? "active",
      evidenceRefs: [jobId, policyId],
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: input.updatedAt ?? "2026-06-08T00:00:00.000Z",
    }),
  );

const enqueueMail = (summaryText: string, suffix: string) =>
  enqueueStagePlayLiveSourceMailItem({
    threadId,
    roomId,
    environmentId,
    sourceId,
    sourceKind: "visual_frame",
    frameRef: `visual_frame:${suffix}`,
    evidenceRef: `visual_evidence:${suffix}`,
    summaryText,
    confidence: 0.82,
    analysisState: "analysis_ready",
    createdAt: `2026-06-08T00:01:${suffix.padStart(2, "0")}.000Z`,
  });

describe("stage-play interpreter profile", () => {
  it("configures evidence-only profiles, title fallback, linked note metadata, and active selection", () => {
    const configured = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      environment_id: environmentId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        job_id: jobId,
        policy_id: policyId,
        objective_text: "Act like a Minecraft survival coach for this visual live source.",
        interpretation_guidelines: "Preserve observations and compare them to survival priorities.",
        create_linked_note: true,
      },
    });
    const payload = configured.observation as any;
    const profile = payload.profile;

    expect(profile).toMatchObject({
      artifactId: "stage_play_live_source_interpreter_profile",
      schemaVersion: "stage_play_live_source_interpreter_profile/v1",
      title: "Minecraft Survival Coach",
      domain: "minecraft",
      threadId,
      roomId,
      environmentId,
      jobId,
      policyId,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(profile.linkedNoteId).toBeTruthy();
    expect(profile.linkedNoteTitle).toContain("Minecraft Survival Coach");
    expect(configured.summary).toContain("Configured interpreter profile");
    expect(listStagePlayLiveSourceInterpreterProfiles({
      threadId,
      roomId,
      environmentId,
      jobId,
      policyId,
      domain: "minecraft",
    }).map((entry) => entry.profileId)).toEqual([profile.profileId]);
    expect(getActiveInterpreterProfileForJob({
      threadId,
      roomId,
      environmentId,
      jobId,
      policyId,
      domain: "minecraft",
      sourceKind: "visual_frame",
    })?.profileId).toBe(profile.profileId);

    setInterpreterProfileStatus({
      profileId: profile.profileId,
      status: "archived",
      updatedAt: "2026-06-08T00:00:05.000Z",
    });
    expect(getActiveInterpreterProfileForJob({
      threadId,
      roomId,
      environmentId,
      jobId,
      policyId,
      domain: "minecraft",
    })).toBeNull();
  });

  it.each([
    {
      summary: "The player is walking through a daylight forest with no visible threat.",
      suffix: "10",
      expectedSuppressed: ["routine walking"],
      expectedRisk: [],
      expectedVoice: [],
      expectedDecision: "wait_for_next_summary",
    },
    {
      summary: "The player approaches a cave entrance with low light and no visible torch cues.",
      suffix: "11",
      expectedSuppressed: [],
      expectedRisk: ["low light", "cave exploration", "minecraft hazard hint"],
      expectedVoice: [],
      expectedDecision: "record_interpretation",
    },
    {
      summary: "A hostile mob is nearby: a creeper stands close to the player.",
      suffix: "12",
      expectedSuppressed: [],
      expectedRisk: ["hostile mob", "minecraft hazard hint"],
      expectedVoice: ["hostile mob", "minecraft urgent hazard hint"],
      expectedDecision: "request_voice_callout",
    },
  ])("compares Minecraft profile mail and recommends $expectedDecision", ({
    summary,
    suffix,
    expectedSuppressed,
    expectedRisk,
    expectedVoice,
    expectedDecision,
  }) => {
    const profile = recordMinecraftProfile();
    const mail = enqueueMail(summary, suffix);
    const comparison = compareMailToInterpreterProfile({
      profile,
      mailItems: [mail],
      jobId,
      policyId,
      createdAt: "2026-06-08T00:02:00.000Z",
    });

    expect(comparison).toMatchObject({
      profileId: profile.profileId,
      mailIds: [mail.mailId],
      recommendedDecision: expectedDecision,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(comparison.suppressedCriteria).toEqual(expect.arrayContaining(expectedSuppressed));
    expect(comparison.riskMatches).toEqual(expect.arrayContaining(expectedRisk));
    expect(comparison.voiceCalloutMatches).toEqual(expect.arrayContaining(expectedVoice));
  });

  it("maintains criterion ledger state across repeated, resolved, contradicted, and uncertain comparisons", () => {
    const profile = recordMinecraftProfile();
    const caveMail = enqueueMail("The player approaches a cave entrance with low light and no visible torch cues.", "21");
    const firstComparison = compareMailToInterpreterProfile({
      profile,
      mailItems: [caveMail],
      jobId,
      policyId,
      createdAt: "2026-06-08T00:06:00.000Z",
    });
    const lowLightLedgerRef = firstComparison.criterionLedgerStatuses
      ?.find((entry) => entry.criterionText === "low light" && entry.criterionKind === "risk")
      ?.ledgerId;
    expect(lowLightLedgerRef).toBeTruthy();
    expect(getStagePlayLiveSourceInterpreterProfileCriterionLedger(lowLightLedgerRef!)).toMatchObject({
      artifactId: "stage_play_live_source_interpreter_profile_criterion_ledger",
      schemaVersion: "stage_play_live_source_interpreter_profile_criterion_ledger/v1",
      profileId: profile.profileId,
      criterionText: "low light",
      criterionKind: "risk",
      status: "matched",
      previousStatus: null,
      matchCount: 1,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });

    const secondCaveMail = enqueueMail("The cave remains dim with low light near the player.", "22");
    const secondComparison = compareMailToInterpreterProfile({
      profile,
      mailItems: [secondCaveMail],
      jobId,
      policyId,
      createdAt: "2026-06-08T00:06:10.000Z",
    });
    expect(secondComparison.criterionLedgerStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ledgerId: lowLightLedgerRef,
        criterionText: "low light",
        criterionKind: "risk",
        status: "still_matched",
        previousStatus: "matched",
      }),
    ]));
    expect(getStagePlayLiveSourceInterpreterProfileCriterionLedger(lowLightLedgerRef!)?.matchCount).toBe(2);

    const daylightMail = enqueueMail("The player is walking through a daylight forest with no visible threat.", "23");
    const resolvedComparison = compareMailToInterpreterProfile({
      profile,
      mailItems: [daylightMail],
      jobId,
      policyId,
      createdAt: "2026-06-08T00:06:20.000Z",
    });
    expect(resolvedComparison.criterionLedgerStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ledgerId: lowLightLedgerRef,
        criterionText: "low light",
        criterionKind: "risk",
        status: "resolved",
        previousStatus: "still_matched",
      }),
    ]));

    const mixedMail = enqueueMail("The player is routine walking while a hostile mob appears nearby.", "24");
    const contradictedComparison = compareMailToInterpreterProfile({
      profile,
      mailItems: [mixedMail],
      jobId,
      policyId,
      createdAt: "2026-06-08T00:06:30.000Z",
    });
    expect(contradictedComparison.criterionLedgerStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        criterionKind: "contradiction",
        status: "contradicted",
      }),
      expect.objectContaining({
        criterionKind: "uncertainty",
        status: "uncertain",
      }),
    ]));
    expect(listStagePlayLiveSourceInterpreterProfileCriterionLedger({
      profileId: profile.profileId,
      jobId,
      policyId,
      limit: 50,
    }).map((ledger) => ledger.status)).toEqual(expect.arrayContaining([
      "resolved",
      "contradicted",
      "uncertain",
    ]));
  });

  it("injects active profile guidance and observed-vs-inferred rules into wake prompts", async () => {
    const { policy } = configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      environmentId,
      sourceIds: [sourceId],
      objectiveText: "Watch Minecraft mail and interpret each batch through the active survival coach profile.",
      decisionPolicyPrompt: "Interpret each non-empty visual-summary mail batch against the profile.",
      importanceCriteria: ["hostile mob", "low light"],
      suppressCriteria: ["routine walking"],
      interpretationMode: "batch_interpretation",
      voicePolicy: {
        voiceEnabled: true,
        requiresConfirmation: true,
        allowedNow: false,
        reason: "confirmation_required",
      },
      createdAt: "2026-06-08T00:03:00.000Z",
    });
    const profile = recordMinecraftProfile({
      profileId: "stage_play_live_source_interpreter_profile:wake",
      jobId: policy.jobId,
      policyId: policy.policyId,
      updatedAt: "2026-06-08T00:03:01.000Z",
    });
    const mail = enqueueMail("Minecraft scene at a cave entrance with low light.", "13");
    let prompt = "";

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      environmentId,
      jobId: policy.jobId,
      askTurnRunner: async (input) => {
        prompt = input.prompt;
        return {
          turn_id: "ask:stage-play-interpreter-profile-wake",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake",
                  decision: "record_interpretation",
                  mailIds: input.wakeRequest.mailIds,
                  interpreterProfileRef: profile.profileId,
                },
              },
            },
          ],
        };
      },
      now: "2026-06-08T00:03:03.000Z",
    });

    expect(result?.status).toBe("completed");
    expect(prompt).toContain("Active interpreter profile:");
    expect(prompt).toContain("Title: Minecraft Survival Coach");
    expect(prompt).toContain("Guidelines:");
    expect(prompt).toContain("Preserve visual observations");
    expect(prompt).toContain("Salience criteria:");
    expect(prompt).toContain("- low light");
    expect(prompt).toContain("Risk criteria:");
    expect(prompt).toContain("- cave exploration");
    expect(prompt).toContain("Voice callout criteria:");
    expect(prompt).toContain("- hostile mob");
    expect(prompt).toContain("Evidence rules:");
    expect(prompt).toContain("- preserve raw observation: true");
    expect(prompt).toContain("- distinguish observed vs inferred: true");
    expect(prompt).toContain("Preserve observed facts from the mail summaries.");
    expect(prompt).toContain("Do not overwrite observations with profile assumptions.");
    expect(prompt).toContain(mail.mailId);
  });

  it("records profile comparison refs and carries them into narrative evidence", () => {
    const profile = recordMinecraftProfile();
    const mail = enqueueMail("A cave entrance with low light appears in the latest visual summary.", "14");
    const comparison = compareMailToInterpreterProfile({
      profile,
      mailItems: [mail],
      jobId,
      policyId,
      createdAt: "2026-06-08T00:04:00.000Z",
    });

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      environment_id: environmentId,
      args: {
        room_id: roomId,
        mail_ids: [mail.mailId],
        decision: "record_interpretation",
        rationale_preview: "The active profile matched cave low-light risk.",
        interpreter_profile_ref: profile.profileId,
        profile_comparison_refs: [comparison.comparisonId],
        matched_criteria: comparison.matchedCriteria,
        suppressed_criteria: comparison.suppressedCriteria,
        observed_facts: comparison.observedFacts,
        inferred_meaning: comparison.inferredMeaning,
        interpretation: {
          currentSceneSummary: "A cave entrance with low light is visible.",
          runningStorySummary: "The user is approaching a risky low-light Minecraft area.",
          setting: "Minecraft cave edge",
          entities: ["player"],
          objects: ["cave entrance"],
          activities: ["approaching cave"],
          userRelevantMeaning: "The player is near low-light cave terrain; watch for mobs or missing torch cues.",
          meaningfulChanges: ["Low-light cave risk became visible."],
          uncertainties: ["No hostile mob is confirmed."],
          watchNextTargets: ["hostile mobs", "torch cues"],
          watchNextReason: "Low light can become urgent if a mob appears or the player lacks lighting.",
        },
      },
    });
    const decision = decisionObservation.observation as any;
    const narrative = getStagePlayLiveSourceNarrativeState(decision.narrativeStateRef);

    expect(decision).toMatchObject({
      decision: "record_interpretation",
      interpreterProfileRef: profile.profileId,
      profileComparisonRefs: [comparison.comparisonId],
      matchedCriteria: comparison.matchedCriteria,
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(narrative?.evidenceRefs).toEqual(expect.arrayContaining([
      profile.profileId,
      comparison.comparisonId,
      mail.mailId,
    ]));
  });

  it("creates, opens, compiles, and safely rejects invalid linked profile notes", () => {
    const profile = recordMinecraftProfile({
      profileId: "stage_play_live_source_interpreter_profile:note",
    });
    const note = createInterpreterProfileNote({
      profileId: profile.profileId,
      now: "2026-06-08T00:05:00.000Z",
    });

    expect(note).toMatchObject({
      artifactId: "stage_play_live_source_interpreter_profile_note",
      profileId: profile.profileId,
      title: "Minecraft Survival Coach Guidelines",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(openInterpreterProfileNote({ profileId: profile.profileId })?.noteId).toBe(note.noteId);

    syncInterpreterProfileNote({
      noteId: note.noteId,
      body: note.body.replace("Watch Minecraft like a survival coach.", "Watch Minecraft caves with warning-only callouts."),
      updatedAt: "2026-06-08T00:05:01.000Z",
    });
    const compiled = compileInterpreterProfileFromNote({
      noteId: note.noteId,
      updatedAt: "2026-06-08T00:05:02.000Z",
    });
    expect(compiled.ok).toBe(true);
    expect(compiled.profile?.objectiveText).toBe("Watch Minecraft caves with warning-only callouts.");

    const priorProfile = getStagePlayLiveSourceInterpreterProfile(profile.profileId);
    syncInterpreterProfileNote({
      noteId: note.noteId,
      body: [
        "# Broken Profile",
        "",
        "## Objective",
        "",
        "## Interpretation Guidelines",
        "",
      ].join("\n"),
      updatedAt: "2026-06-08T00:05:03.000Z",
    });
    const failed = compileInterpreterProfileFromNote({
      noteId: note.noteId,
      updatedAt: "2026-06-08T00:05:04.000Z",
    });

    expect(failed.ok).toBe(false);
    expect(failed.note.compileStatus).toBe("compile_failed");
    expect(failed.issues).toEqual(expect.arrayContaining([
      "Objective section is required",
      "Interpretation Guidelines section is required",
    ]));
    expect(getStagePlayLiveSourceInterpreterProfile(profile.profileId)?.objectiveText)
      .toBe(priorProfile?.objectiveText);
  });
});
