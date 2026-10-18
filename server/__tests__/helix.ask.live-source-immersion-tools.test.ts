import { beforeEach, describe, expect, it } from "vitest";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import { buildLiveEnvironmentRuntimePacket } from "../services/situation-room/live-environment-runtime-packet-builder";
import {
  configureStagePlayLiveSourceWatchJobPolicy,
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import { resetStagePlayLiveSourceInterpreterProfileStoreForTest } from "../services/stage-play/stage-play-live-source-interpreter-profile-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";

const threadId = "helix-ask:desktop";
const roomId = "room:live-source-immersion-tools";
const sourceId = "visual_source:live-source-immersion-tools";

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceInterpreterProfileStoreForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
});

const seedPolicyAndMail = () => {
  const configured = configureStagePlayLiveSourceWatchJobPolicy({
    threadId,
    roomId,
    sourceIds: [sourceId],
    objectiveText: "Watch the Minecraft visual source and predict what happens next.",
    interpretationMode: "prediction_watch",
    mailProcessingMode: "micro_batch",
    outputCadence: "only_salient",
    now: "2026-06-08T20:00:00.000Z",
  });
  const firstMail = enqueueStagePlayLiveSourceMailItem({
    threadId,
    roomId,
    sourceId,
    sourceKind: "visual_frame",
    frameRef: "visual_frame:immersion-tools:1",
    evidenceRef: "visual_evidence:immersion-tools:1",
    summaryText: "Minecraft video shows an interior base with a chest and crafting area.",
    createdAt: "2026-06-08T20:00:01.000Z",
  });
  const secondMail = enqueueStagePlayLiveSourceMailItem({
    threadId,
    roomId,
    sourceId,
    sourceKind: "visual_frame",
    frameRef: "visual_frame:immersion-tools:2",
    evidenceRef: "visual_evidence:immersion-tools:2",
    summaryText: "Minecraft player moves into a dark cave with a pickaxe and torch.",
    createdAt: "2026-06-08T20:00:02.000Z",
  });
  return {
    configured,
    mail: [firstMail, secondMail],
  };
};

describe("live-source immersion and loop health tools", () => {
  it("advertises the immersion update, prediction validation, and loop health tools", () => {
    const packet = buildLiveEnvironmentRuntimePacket({
      threadId,
      roomId,
      now: "2026-06-08T20:00:00.000Z",
    });

    expect(packet.available_tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool_id: "live_env.update_live_source_immersion_state", creates_assistant_answer: false }),
      expect.objectContaining({ tool_id: "live_env.validate_live_source_prediction", creates_assistant_answer: false }),
      expect.objectContaining({ tool_id: "live_env.query_live_source_loop_health", creates_assistant_answer: false }),
    ]));
  });

  it("updates immersion state from latest mail and validates the prior prediction as evidence-only receipts", () => {
    const { configured, mail } = seedPolicyAndMail();

    const updateObservation = executeLiveEnvironmentTool({
      thread_id: threadId,
      tool_name: "live_env.update_live_source_immersion_state",
      args: {
        room_id: roomId,
        source_id: sourceId,
        mail_ids: mail.map((item) => item.mailId),
        prediction_text: "The next Minecraft scene may continue cave exploration or reveal a mining risk.",
      },
    });
    expect(updateObservation.ok).toBe(true);
    expect(updateObservation.observation?.assistant_answer).toBe(false);
    expect(updateObservation.observation?.terminal_eligible).toBe(false);
    expect(updateObservation.observation?.context_role).toBe("tool_evidence");
    expect(updateObservation.observation?.immersionStateId).toMatch(/^stage_play_live_source_immersion_state:/);
    expect(updateObservation.observation?.currentActivity).toBe("mining_or_cave");
    expect(updateObservation.observation?.prediction?.predictionId).toMatch(/^stage_play_live_source_prediction:/);
    expect(updateObservation.observation?.currentPolicyRef).toBe(configured.policy.policyId);

    const newerMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:immersion-tools:3",
      evidenceRef: "visual_evidence:immersion-tools:3",
      summaryText: "The Minecraft video remains in a dark cave while the player keeps mining stone.",
      createdAt: "2026-06-08T20:00:03.000Z",
    });
    const validationObservation = executeLiveEnvironmentTool({
      thread_id: threadId,
      tool_name: "live_env.validate_live_source_prediction",
      args: {
        room_id: roomId,
        source_id: sourceId,
        mail_ids: [newerMail.mailId],
      },
    });

    expect(validationObservation.ok).toBe(true);
    expect(validationObservation.observation?.assistant_answer).toBe(false);
    expect(validationObservation.observation?.terminal_eligible).toBe(false);
    expect(validationObservation.observation?.context_role).toBe("tool_evidence");
    expect(validationObservation.observation?.result).not.toBe("no_prior_prediction");
    expect(validationObservation.observation?.validationId).toMatch(/^stage_play_live_source_prediction_validation:/);
  });

  it("reports OS-style loop health with next useful tool and current refs", () => {
    const { configured, mail } = seedPolicyAndMail();
    executeLiveEnvironmentTool({
      thread_id: threadId,
      tool_name: "live_env.configure_interpreter_profile",
      args: {
        room_id: roomId,
        source_kinds: ["visual_frame"],
        job_id: configured.jobState.jobId,
        policy_id: configured.policy.policyId,
        objective_text: "Interpret Minecraft visual source updates.",
        interpretation_guidelines: "Track observed facts, cave risk, and next watch targets.",
        title: "Minecraft Visual Watcher",
        domain: "minecraft",
      },
    });
    executeLiveEnvironmentTool({
      thread_id: threadId,
      tool_name: "live_env.update_live_source_immersion_state",
      args: {
        room_id: roomId,
        source_id: sourceId,
        mail_ids: mail.map((item) => item.mailId),
      },
    });

    const healthObservation = executeLiveEnvironmentTool({
      thread_id: threadId,
      tool_name: "live_env.query_live_source_loop_health",
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });

    expect(healthObservation.ok).toBe(true);
    expect(healthObservation.observation?.assistant_answer).toBe(false);
    expect(healthObservation.observation?.terminal_eligible).toBe(false);
    expect(healthObservation.observation?.context_role).toBe("tool_evidence");
    expect(healthObservation.observation?.health).toMatch(/green|catching_up|deferred_for_pressure|stale_source|missing_profile|blocked/);
    expect(healthObservation.observation?.currentPolicyRef).toMatch(/^stage_play_live_source_watch_job_policy:/);
    expect(healthObservation.observation?.latestImmersionStateRef).toMatch(/^stage_play_live_source_immersion_state:/);
    expect(healthObservation.observation?.latestPredictionRef).toMatch(/^stage_play_live_source_prediction:/);
    expect(healthObservation.observation?.nextUsefulTool === null || typeof healthObservation.observation?.nextUsefulTool === "string").toBe(true);
  });
});
