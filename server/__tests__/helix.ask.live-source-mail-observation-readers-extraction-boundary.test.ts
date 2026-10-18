import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  artifactHasSatisfyingStagePlayProcessedMailPacket,
  artifactIndexInList,
  collectStagePlayCurrentBatchMailIds,
  collectStagePlayMailIdsFromRecord,
  hasStagePlayInterpreterProfileConfigObservation,
  hasStagePlayLiveSourceMailDecisionObservation,
  hasStagePlayLiveSourceWatchJobPolicyObservation,
  hasStagePlayRequestVoiceCalloutDecisionObservation,
  isStagePlayInterpreterProfileComparisonObservationArtifact,
  isStagePlayInterpreterProfileConfigObservationArtifact,
  isStagePlayLiveSourceMailReadObservationArtifact,
  isStagePlayLiveSourceMailDecisionObservationArtifact,
  isStagePlayLiveSourceWatchJobPolicyObservationArtifact,
  latestLiveEnvironmentToolObservationArtifact,
  latestLiveEnvironmentToolObservationRecord,
  latestStagePlayInterpreterProfileComparisonObservation,
  latestStagePlayLiveSourceMailDecisionObservation,
  latestStagePlayLiveSourceMailReadObservation,
  latestStagePlayLiveSourceWatchJobPolicy,
  latestStagePlayLiveSourceWatchJobPolicyObservation,
  latestStagePlayProcessedMailPacketRecordFromArtifacts,
  processedMailReadObservationHasPacket,
  processedMailReadObservationMissingRawMailIds,
  processedMailReadObservationNeedsProcessFallback,
  readAskTurnLiveEnvironmentObservationRecord,
  readStagePlayProcessedMailPacketRecommendedNext,
  readStagePlayProcessedMailPacketRecordsFromArtifact,
  stagePlayProcessedMailPacketAllowsDirectCheckpointSummary,
  stagePlayProcessedMailPacketHasSatisfyingContent,
  stagePlayProcessedMailPacketRequiresDecision,
} from "../services/helix-ask/live-source/mail-observation-readers";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/live-source/mail-observation-readers.ts");

describe("Helix Ask live-source mail observation reader extraction boundary", () => {
  it("keeps processed mail observation readers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/live-source/mail-observation-readers");
    expect(routeSource).not.toMatch(/const\s+readAskTurnLiveEnvironmentObservationRecord\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+readStagePlayProcessedMailPacketRecordsFromArtifact\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+stagePlayProcessedMailPacketHasSatisfyingContent\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+artifactHasSatisfyingStagePlayProcessedMailPacket\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestStagePlayProcessedMailPacketRecordFromArtifacts\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+collectStagePlayMailIdsFromRecord\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+collectStagePlayCurrentBatchMailIds\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+processedMailReadObservationHasPacket\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+processedMailReadObservationMissingRawMailIds\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+processedMailReadObservationNeedsProcessFallback\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestLiveEnvironmentToolObservationArtifact\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestLiveEnvironmentToolObservationRecord\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+artifactIndexInList\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+isStagePlayLiveSourceMailDecisionObservationArtifact\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+isStagePlayLiveSourceWatchJobPolicyObservationArtifact\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+isStagePlayInterpreterProfileConfigObservationArtifact\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+isStagePlayInterpreterProfileComparisonObservationArtifact\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestStagePlayLiveSourceMailReadObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasStagePlayLiveSourceMailDecisionObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasStagePlayRequestVoiceCalloutDecisionObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestStagePlayLiveSourceMailDecisionObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasStagePlayLiveSourceWatchJobPolicyObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasStagePlayInterpreterProfileConfigObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestStagePlayInterpreterProfileComparisonObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestStagePlayLiveSourceWatchJobPolicyObservation\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+latestStagePlayLiveSourceWatchJobPolicy\s*=\s*\(/);
    expect(routeSource).not.toContain("STAGE_PLAY_PROCESSED_MAIL_RECOMMENDATIONS_REQUIRING_DECISION");
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnLiveEnvironmentObservationRecord\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readStagePlayProcessedMailPacketRecordsFromArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+stagePlayProcessedMailPacketRequiresDecision\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+artifactHasSatisfyingStagePlayProcessedMailPacket\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestStagePlayProcessedMailPacketRecordFromArtifacts\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectStagePlayMailIdsFromRecord\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectStagePlayCurrentBatchMailIds\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+processedMailReadObservationHasPacket\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+processedMailReadObservationMissingRawMailIds\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+processedMailReadObservationNeedsProcessFallback\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestLiveEnvironmentToolObservationArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestLiveEnvironmentToolObservationRecord\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+artifactIndexInList\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isStagePlayLiveSourceMailDecisionObservationArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isStagePlayLiveSourceWatchJobPolicyObservationArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isStagePlayInterpreterProfileConfigObservationArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isStagePlayInterpreterProfileComparisonObservationArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestStagePlayLiveSourceMailReadObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hasStagePlayLiveSourceMailDecisionObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hasStagePlayRequestVoiceCalloutDecisionObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestStagePlayLiveSourceMailDecisionObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hasStagePlayLiveSourceWatchJobPolicyObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hasStagePlayInterpreterProfileConfigObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestStagePlayInterpreterProfileComparisonObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestStagePlayLiveSourceWatchJobPolicyObservation\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+latestStagePlayLiveSourceWatchJobPolicy\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves nested live-environment observation unwrapping", () => {
    expect(readAskTurnLiveEnvironmentObservationRecord({
      kind: "live_environment_tool_observation",
      payload: {
        observation: {
          observation: {
            schemaVersion: "stage_play_processed_live_source_mail_read_result/v1",
            readId: "read:1",
          },
        },
      },
    })).toEqual({
      schemaVersion: "stage_play_processed_live_source_mail_read_result/v1",
      readId: "read:1",
    });

    expect(readAskTurnLiveEnvironmentObservationRecord({
      kind: "tool_observation",
      payload: { observation: { readId: "ignored" } },
    })).toBeNull();
  });

  it("preserves processed packet extraction and mail-read artifact detection", () => {
    const artifact = {
      kind: "live_environment_tool_observation",
      payload: {
        ok: true,
        tool_name: "live_env.read_processed_live_source_mail",
        observation: {
          packets: [
            { packetId: "stage_play_processed_mail_packet:1", observedFacts: ["light changed"] },
            { packetId: "other:2", observedFacts: ["ignored"] },
          ],
        },
      },
    };

    expect(isStagePlayLiveSourceMailReadObservationArtifact(artifact)).toBe(true);
    expect(readStagePlayProcessedMailPacketRecordsFromArtifact(artifact)).toEqual([
      { packetId: "stage_play_processed_mail_packet:1", observedFacts: ["light changed"] },
    ]);

    expect(isStagePlayLiveSourceMailReadObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        ok: false,
        tool_name: "live_env.read_processed_live_source_mail",
        observation: {},
      },
    })).toBe(false);
  });

  it("preserves processed packet content and recommendation decisions", () => {
    const directPacket = { changedFacts: ["door opened"], recommendedNext: "record_observation" };
    const decisionPacket = { recommended_next: "request_more_evidence" };

    expect(stagePlayProcessedMailPacketHasSatisfyingContent(directPacket)).toBe(true);
    expect(readStagePlayProcessedMailPacketRecommendedNext(decisionPacket)).toBe("request_more_evidence");
    expect(stagePlayProcessedMailPacketRequiresDecision(decisionPacket)).toBe(true);
    expect(stagePlayProcessedMailPacketAllowsDirectCheckpointSummary(decisionPacket)).toBe(false);
    expect(stagePlayProcessedMailPacketAllowsDirectCheckpointSummary(directPacket)).toBe(true);
  });

  it("preserves artifact-level packet satisfaction and latest packet lookup", () => {
    const first = {
      kind: "stage_play_processed_mail_packet",
      payload: { packetId: "stage_play_processed_mail_packet:first" },
    };
    const second = {
      kind: "live_environment_tool_observation",
      payload: {
        observation: {
          packets: [
            { packetId: "stage_play_processed_mail_packet:second", inferredFacts: ["movement"] },
          ],
        },
      },
    };

    expect(artifactHasSatisfyingStagePlayProcessedMailPacket(first)).toBe(false);
    expect(artifactHasSatisfyingStagePlayProcessedMailPacket(second)).toBe(true);
    expect(latestStagePlayProcessedMailPacketRecordFromArtifacts([first, second])).toEqual({
      packetId: "stage_play_processed_mail_packet:second",
      inferredFacts: ["movement"],
    });
  });

  it("preserves mail id collection across payload, observation, items, and packets", () => {
    expect(collectStagePlayMailIdsFromRecord({
      mailIds: ["mail:1", "mail:2", "mail:1", ""],
      mail_id: "mail:3",
    })).toEqual(["mail:1", "mail:2", "mail:3"]);

    expect(collectStagePlayCurrentBatchMailIds([
      {
        kind: "live_environment_tool_observation",
        payload: {
          mailId: "mail:payload",
          observation: {
            mail_ids: ["mail:observation"],
            items: [{ mailId: "mail:item" }],
            packets: [
              {
                packetId: "stage_play_processed_mail_packet:nested",
                mailIds: ["mail:packet", "mail:item"],
              },
            ],
          },
        },
      },
    ])).toEqual(["mail:payload", "mail:observation", "mail:packet", "mail:item"]);
  });

  it("preserves processed-mail packet and process-fallback observation predicates", () => {
    expect(processedMailReadObservationHasPacket({
      processedPacketRefs: ["stage_play_processed_mail_packet:ref"],
    })).toBe(true);
    expect(processedMailReadObservationHasPacket({
      packets: [{ packetId: "stage_play_processed_mail_packet:packet", observedFacts: ["visible"] }],
    })).toBe(true);
    expect(processedMailReadObservationHasPacket({
      packets: [{ packetId: "stage_play_processed_mail_packet:empty" }],
    })).toBe(false);

    expect(processedMailReadObservationMissingRawMailIds({
      missingRawMailIds: ["mail:1", ""],
      missing_raw_mail_ids: ["mail:2", "mail:1"],
    })).toEqual(["mail:1", "mail:2"]);

    expect(processedMailReadObservationNeedsProcessFallback({
      fallbackTool: "live_env.process_live_source_mail",
    })).toBe(true);
    expect(processedMailReadObservationNeedsProcessFallback({
      missing_raw_mail_ids: ["mail:missing"],
    })).toBe(true);
    expect(processedMailReadObservationNeedsProcessFallback({
      schema: "stage_play_processed_live_source_mail_read_result/v1",
      ok: false,
    })).toBe(true);
    expect(processedMailReadObservationNeedsProcessFallback({
      processed_packet_refs: ["stage_play_processed_mail_packet:done"],
      fallbackTool: "live_env.process_live_source_mail",
    })).toBe(false);
  });

  it("preserves latest live-environment tool observation lookup and artifact indexing", () => {
    const artifacts = [
      {
        kind: "live_environment_tool_observation",
        artifact_id: "artifact:first",
        payload: {
          tool_name: "live_env.read_processed_live_source_mail",
          observation: { readId: "read:first" },
        },
      },
      {
        kind: "live_environment_tool_observation",
        artifact_id: "artifact:other",
        payload: {
          tool_name: "live_env.process_live_source_mail",
          observation: { processId: "process:other" },
        },
      },
      {
        kind: "live_environment_tool_observation",
        artifact_id: "artifact:last",
        payload: {
          tool_name: "live_env.read_processed_live_source_mail",
          observation: { readId: "read:last" },
        },
      },
    ];

    const latest = latestLiveEnvironmentToolObservationArtifact(
      artifacts,
      "live_env.read_processed_live_source_mail",
    );

    expect(latest?.artifact_id).toBe("artifact:last");
    expect(latestLiveEnvironmentToolObservationRecord(
      artifacts,
      "live_env.read_processed_live_source_mail",
    )).toEqual({ readId: "read:last" });
    expect(artifactIndexInList(artifacts, latest)).toBe(2);
    expect(artifactIndexInList(artifacts, null)).toBe(-1);
    expect(latestLiveEnvironmentToolObservationArtifact(artifacts, "live_env.missing")).toBeNull();
  });

  it("preserves live-source decision and profile artifact predicates", () => {
    expect(isStagePlayLiveSourceMailDecisionObservationArtifact({
      kind: "stage_play_live_source_mail_decision",
      payload: {},
    })).toBe(true);
    expect(isStagePlayLiveSourceMailDecisionObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        observation: { decisionId: "decision:1" },
      },
    })).toBe(true);

    expect(isStagePlayLiveSourceWatchJobPolicyObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        ok: true,
        tool_name: "live_env.configure_live_source_watch_job",
        observation: {},
      },
    })).toBe(true);
    expect(isStagePlayLiveSourceWatchJobPolicyObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        observation: {
          policy: {
            artifactId: "stage_play_live_source_watch_job_policy",
          },
        },
      },
    })).toBe(true);

    expect(isStagePlayInterpreterProfileConfigObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        ok: true,
        tool_name: "live_env.configure_interpreter_profile",
        observation: {},
      },
    })).toBe(true);
    expect(isStagePlayInterpreterProfileConfigObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        observation: {
          profile: {
            schemaVersion: "stage_play_live_source_interpreter_profile/v1",
          },
        },
      },
    })).toBe(true);

    expect(isStagePlayInterpreterProfileComparisonObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        ok: true,
        tool_name: "live_env.compare_mail_to_interpreter_profile",
        observation: {},
      },
    })).toBe(true);
    expect(isStagePlayInterpreterProfileComparisonObservationArtifact({
      kind: "live_environment_tool_observation",
      payload: {
        observation: {
          comparisonId: "comparison:1",
        },
      },
    })).toBe(true);
  });

  it("preserves aggregate live-source observation readers", () => {
    const artifacts = [
      {
        kind: "live_environment_tool_observation",
        payload: {
          tool_name: "live_env.read_processed_live_source_mail",
          observation: { readId: "read:1" },
        },
      },
      {
        kind: "stage_play_live_source_mail_decision",
        payload: { decision: "draft_text_answer" },
      },
      {
        kind: "live_environment_tool_observation",
        payload: {
          observation: {
            decisionId: "decision:voice",
            decision: "request_voice_callout",
          },
        },
      },
      {
        kind: "live_environment_tool_observation",
        payload: {
          observation: {
            policy: { artifactId: "stage_play_live_source_watch_job_policy" },
          },
        },
      },
      {
        kind: "live_environment_tool_observation",
        payload: {
          observation: {
            profile: { artifactId: "stage_play_live_source_interpreter_profile" },
          },
        },
      },
      {
        kind: "live_environment_tool_observation",
        payload: {
          observation: {
            comparisonId: "comparison:latest",
          },
        },
      },
    ];

    expect(latestStagePlayLiveSourceMailReadObservation(artifacts)).toEqual({ readId: "read:1" });
    expect(hasStagePlayLiveSourceMailDecisionObservation(artifacts)).toBe(true);
    expect(hasStagePlayRequestVoiceCalloutDecisionObservation(artifacts)).toBe(true);
    expect(latestStagePlayLiveSourceMailDecisionObservation(artifacts)).toEqual({
      decisionId: "decision:voice",
      decision: "request_voice_callout",
    });
    expect(hasStagePlayLiveSourceWatchJobPolicyObservation(artifacts)).toBe(true);
    expect(hasStagePlayInterpreterProfileConfigObservation(artifacts)).toBe(true);
    expect(latestStagePlayLiveSourceWatchJobPolicyObservation(artifacts)).toEqual({
      policy: { artifactId: "stage_play_live_source_watch_job_policy" },
    });
    expect(latestStagePlayInterpreterProfileComparisonObservation(artifacts)).toEqual({
      comparisonId: "comparison:latest",
    });
  });

  it("preserves latest live-source watch-job policy resolution", () => {
    expect(latestStagePlayLiveSourceWatchJobPolicy([
      {
        kind: "live_source_mail_context_pack",
        payload: {
          activeWatchJobs: [
            { objectiveText: "first context policy" },
            { objectiveText: "latest context policy" },
          ],
        },
      },
    ])).toEqual({ objectiveText: "latest context policy" });

    expect(latestStagePlayLiveSourceWatchJobPolicy([
      {
        kind: "live_source_mail_context_pack",
        payload: {
          activeWatchJobs: [{ objectiveText: "context fallback policy" }],
        },
      },
      {
        kind: "live_environment_tool_observation",
        payload: {
          observation: {
            policy: {
              artifactId: "stage_play_live_source_watch_job_policy",
              objectiveText: "observation policy",
            },
          },
        },
      },
    ])).toEqual({
      artifactId: "stage_play_live_source_watch_job_policy",
      objectiveText: "observation policy",
    });
  });
});
