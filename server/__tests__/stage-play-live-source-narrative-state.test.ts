import { beforeEach, describe, expect, it } from "vitest";

import {
  configureStagePlayLiveSourceWatchJobPolicy,
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  getLatestStagePlayLiveSourceNarrativeState,
  getStagePlayLiveSourceNarrativeState,
  listStagePlayLiveSourceNarrativeStates,
  resetStagePlayLiveSourceNarrativeStoreForTest,
} from "../services/stage-play/stage-play-live-source-narrative-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  listStagePlayLiveSourceMailTranscriptEntries,
  resetStagePlayLiveSourceMailTranscriptStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-transcript-store";
import {
  recordLiveSourceMailDecisionForAsk,
} from "../services/stage-play/stage-play-visual-summary-mail-ingest";
import {
  runNextMailWakeRequest,
} from "../services/stage-play/stage-play-live-source-mail-wake-runner";

const threadId = "thread:stage-play-narrative-state";
const roomId = "room:stage-play-narrative-state";
const sourceId = "visual_source:stage-play-narrative-state";

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayLiveSourceMailTranscriptStoreForTest();
  resetStagePlayLiveSourceNarrativeStoreForTest();
});

const configureInterpretationPolicy = () =>
  configureStagePlayLiveSourceWatchJobPolicy({
    threadId,
    roomId,
    sourceIds: [sourceId],
    objectiveText: "Watch the visual source, interpret what is happening, predict likely next changes, and say what to watch next.",
    decisionPolicyPrompt: "Interpret each non-empty visual-summary mail batch against the current story and update watch-next targets.",
    importanceCriteria: ["scene changes", "new app/window content", "risk appears"],
    suppressCriteria: ["no meaningful visual change"],
  }).policy;

const enqueueVisualMail = (input: {
  suffix: string;
  summaryText: string;
  createdAt: string;
}) =>
  enqueueStagePlayLiveSourceMailItem({
    threadId,
    roomId,
    sourceId,
    sourceKind: "visual_frame",
    frameRef: `visual_frame:${input.suffix}`,
    evidenceRef: `visual_evidence:${input.suffix}`,
    summaryText: input.summaryText,
    createdAt: input.createdAt,
  });

describe("Stage Play live-source narrative state", () => {
  it("creates narrative state from a record_interpretation decision", () => {
    configureInterpretationPolicy();
    const mail = enqueueVisualMail({
      suffix: "narrative-create",
      summaryText: "A dark app launcher shows Docs, Gmail, Drive, YouTube, and Instagram icons.",
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      decision: "record_interpretation",
      rationalePreview: "The compact visual mail shows a stable app-launcher scene.",
      interpretation: {
        currentSceneSummary: "A dark app launcher shows productivity and social app icons.",
        runningStorySummary: "The live source is currently on a dark app-launcher interface.",
        activeWindowOrScene: "dark app launcher",
        objects: ["Docs icon", "Gmail icon", "Drive icon", "YouTube icon", "Instagram icon"],
        userRelevantMeaning: "The source appears stable on an app-launcher interface rather than active video or gameplay.",
        watchNextTargets: ["opened app", "active window change"],
        watchNextReason: "Watch for a specific app opening or content replacing the launcher grid.",
        predictionText: "The next mail will likely either keep the launcher visible or show an app opened from the grid.",
        predictionHorizon: "next_mail",
        validationSignals: ["same launcher grid remains", "opened app replaces icon grid"],
      },
      nextLoopState: "armed_for_next_summary",
      modelReviewed: true,
    });

    expect(decision.decision).toBe("record_interpretation");
    expect(decision.narrativeStateRef).toMatch(/^stage_play_live_source_narrative_state:/);
    const narrative = getStagePlayLiveSourceNarrativeState(decision.narrativeStateRef ?? "");
    expect(narrative).toMatchObject({
      artifactId: "stage_play_live_source_narrative_state",
      mailBatchRefs: [mail.mailId],
      currentSceneSummary: "A dark app launcher shows productivity and social app icons.",
      watchNext: {
        targets: ["opened app", "active window change"],
        reason: "Watch for a specific app opening or content replacing the launcher grid.",
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("stales prior narrative on new mail and supersedes it with the next interpretation", () => {
    configureInterpretationPolicy();
    const firstMail = enqueueVisualMail({
      suffix: "narrative-first",
      summaryText: "The source shows a quiet app launcher.",
      createdAt: "2026-06-04T12:00:00.000Z",
    });
    const firstDecision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [firstMail.mailId],
      decision: "record_interpretation",
      rationalePreview: "First launcher interpretation.",
      interpretation: {
        currentSceneSummary: "The source shows a quiet app launcher.",
        watchNextTargets: ["opened app"],
        watchNextReason: "Watch for an app opening.",
      },
      nextLoopState: "armed_for_next_summary",
    });
    const firstNarrativeId = firstDecision.narrativeStateRef ?? "";

    const secondMail = enqueueVisualMail({
      suffix: "narrative-second",
      summaryText: "The launcher has changed to a document editor window.",
      createdAt: "2026-06-04T12:00:10.000Z",
    });
    expect(getStagePlayLiveSourceNarrativeState(firstNarrativeId)).toMatchObject({
      staleness: {
        state: "stale_after_new_mail",
        staleAfterMailId: secondMail.mailId,
      },
    });

    const secondDecision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [secondMail.mailId],
      decision: "record_interpretation",
      rationalePreview: "The source changed from launcher to editor.",
      interpretation: {
        currentSceneSummary: "The source now shows a document editor window.",
        runningStorySummary: "The source moved from launcher navigation into document editing.",
        meaningfulChanges: ["Prediction supported: opened app replaces icon grid."],
        watchNextTargets: ["document content", "typing activity"],
        watchNextReason: "Watch for text editing activity or a new document state.",
      },
      nextLoopState: "armed_for_next_summary",
    });

    expect(getStagePlayLiveSourceNarrativeState(firstNarrativeId)).toMatchObject({
      staleness: {
        state: "superseded",
        staleAfterMailId: secondMail.mailId,
        supersededByStateId: secondDecision.narrativeStateRef,
      },
    });
    expect(getLatestStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      sourceId,
      stalenessState: "current",
    })?.narrativeStateId).toBe(secondDecision.narrativeStateRef);
  });

  it("loads prior narrative and prediction context into wake prompts", async () => {
    configureInterpretationPolicy();
    const priorMail = enqueueVisualMail({
      suffix: "narrative-prior",
      summaryText: "The source shows a dark app launcher.",
      createdAt: "2026-06-04T12:00:00.000Z",
    });
    const priorDecision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [priorMail.mailId],
      decision: "record_interpretation",
      rationalePreview: "The source is on a launcher.",
      interpretation: {
        currentSceneSummary: "The source shows a dark app launcher.",
        runningStorySummary: "The live source has been stable on a dark app-launcher interface.",
        activeWindowOrScene: "dark app launcher",
        userRelevantMeaning: "The source appears stable on app navigation.",
        watchNextTargets: ["active window change", "opened app"],
        watchNextReason: "Watch for the launcher to transition into a specific app.",
        predictionText: "The next mail may show either the same launcher grid or an opened app replacing it.",
        predictionHorizon: "next_mail",
        predictionConfidence: 0.58,
        validationSignals: ["same launcher grid remains", "opened app replaces icon grid"],
      },
      nextLoopState: "armed_for_next_summary",
    });
    expect(listStagePlayLiveSourceNarrativeStates({ threadId })).toHaveLength(1);

    const nextMail = enqueueVisualMail({
      suffix: "narrative-next",
      summaryText: "The dark app launcher is still visible with productivity icons.",
      createdAt: "2026-06-04T12:00:10.000Z",
    });

    let wakePrompt = "";
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async (input) => {
        wakePrompt = input.prompt;
        return {
          turn_id: "ask:narrative-state-wake",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:narrative-state-wake",
                  decision: "record_interpretation",
                  mailIds: input.wakeRequest.mailIds,
                  narrativeStateRef: "stage_play_live_source_narrative_state:narrative-state-wake",
                },
              },
            },
          ],
        };
      },
    });

    expect(result?.status).toBe("completed");
    expect(wakePrompt).toContain("Latest narrative state:");
    expect(wakePrompt).toContain(priorDecision.narrativeStateRef);
    expect(wakePrompt).toContain("running_story_summary: The live source has been stable on a dark app-launcher interface.");
    expect(wakePrompt).toContain("targets: active window change, opened app");
    expect(wakePrompt).toContain("Prior prediction:");
    expect(wakePrompt).toContain("The next mail may show either the same launcher grid or an opened app replacing it.");
    expect(wakePrompt).toContain("validation_signals: same launcher grid remains | opened app replaces icon grid");
    expect(wakePrompt).toContain(nextMail.mailId);
  });

  it("records durable interpretation transcript rows from a completed wake", async () => {
    configureInterpretationPolicy();
    const mail = enqueueVisualMail({
      suffix: "wake-interpretation",
      summaryText: "The visual summary shows a document editor replacing the prior launcher.",
      createdAt: "2026-06-04T12:01:00.000Z",
    });

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:01.000Z",
      askTurnRunner: async (input) => {
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId: input.wakeRequest.threadId,
          roomId: input.wakeRequest.roomId,
          environmentId: input.wakeRequest.environmentId,
          mailIds: input.wakeRequest.mailIds,
          decision: "record_interpretation",
          rationalePreview: "The source moved from launcher navigation into document editing.",
          interpretation: {
            currentSceneSummary: "A document editor is now visible in the live source.",
            runningStorySummary: "The live source moved from launcher navigation into document editing.",
            activeWindowOrScene: "document editor",
            objects: ["document editor", "text workspace"],
            activities: ["document editing context became visible"],
            userRelevantMeaning: "The observed source is no longer just a launcher; it is now focused on a document editor.",
            meaningfulChanges: ["An app window replaced the launcher grid."],
            uncertainties: ["Exact document contents are not available from the compact summary."],
            watchNextTargets: ["typing activity", "document content change"],
            watchNextReason: "Watch whether text is edited or a different app replaces the editor.",
            predictionText: "The next mail will likely show either continued editing or another window change.",
            predictionHorizon: "next_mail",
            predictionConfidence: 0.6,
            validationSignals: ["same editor remains", "text changes", "new app replaces editor"],
          },
          nextLoopState: "armed_for_next_summary",
          modelReviewed: true,
          evidenceRefs: input.evidenceRefs,
          now: "2026-06-04T12:01:02.000Z",
        });
        return {
          turn_id: "ask:wake-interpretation",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: decision,
              },
            },
          ],
        };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-interpretation",
      decisionIds: [expect.stringMatching(/^stage_play_live_source_mail_decision:/)],
    });
    const transcriptEntries = listStagePlayLiveSourceMailTranscriptEntries({
      threadId,
      askTurnId: "ask:wake-interpretation",
    });
    const rowKinds = transcriptEntries.map((entry) => entry.row.rowKind);
    expect(rowKinds).toEqual(expect.arrayContaining([
      "mail_received",
      "mail_read_tool_call",
      "mail_read_receipt",
      "agent_decision",
      "interpretation",
      "watch_next",
      "prediction",
      "narrative_state",
      "loop_state",
    ]));
    expect(transcriptEntries.find((entry) => entry.row.rowKind === "mail_read_receipt")?.row.body)
      .toContain("Read 1 visual-summary mail item.");
    expect(transcriptEntries.find((entry) => entry.row.rowKind === "interpretation")?.row.body)
      .toContain("document editor");
    expect(transcriptEntries.find((entry) => entry.row.rowKind === "watch_next")?.row.body)
      .toContain("typing activity");
    expect(transcriptEntries.find((entry) => entry.row.rowKind === "loop_state")?.row.body)
      .toContain("Armed for the next live-source update.");
    expect(transcriptEntries.every((entry) =>
      entry.mailIds.includes(mail.mailId) &&
      entry.assistant_answer === false &&
      entry.terminal_eligible === false &&
      entry.context_role === "tool_evidence"
    )).toBe(true);
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining(transcriptEntries.map((entry) => entry.entryId)));
  });
});
