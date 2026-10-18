import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildHelixRuntimeStagePlayFallbackText } from "../services/helix-ask/live-source/stage-play-fallback-text";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/stage-play-fallback-text.ts"),
  "utf8",
);

describe("Helix Ask Stage Play fallback text extraction boundary", () => {
  it("keeps deterministic Stage Play fallback text helpers out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/stage-play-fallback-text");
    expect(routeSource).not.toMatch(/const\s+buildHelixRuntimeStagePlayFallbackText\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+stagePlayProjectionReasonLabel\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+collectStagePlayMissingEvidenceLabels\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+resolveStagePlaySourcePhrase\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+collectStagePlayReceiptStringRefs\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+formatStagePlayReceiptSourceLine\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+formatStagePlayReceiptReviewed\s*=\s*\(/);

    expect(serviceSource).toMatch(/export\s+const\s+buildHelixRuntimeStagePlayFallbackText\s*=/);
    expect(serviceSource).toMatch(/const\s+stagePlayProjectionReasonLabel\s*=/);
    expect(serviceSource).toMatch(/const\s+collectStagePlayMissingEvidenceLabels\s*=/);
    expect(serviceSource).toMatch(/const\s+resolveStagePlaySourcePhrase\s*=/);
    expect(serviceSource).toMatch(/const\s+collectStagePlayReceiptStringRefs\s*=/);
    expect(serviceSource).toMatch(/const\s+formatStagePlayReceiptSourceLine\s*=/);
    expect(serviceSource).toMatch(/const\s+formatStagePlayReceiptReviewed\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
  });

  it("preserves checkpoint-request fallback text", () => {
    const text = buildHelixRuntimeStagePlayFallbackText({
      artifacts: [
        {
          kind: "live_environment_tool_observation",
          payload: {
            tool_name: "live_env.request_stage_play_checkpoint",
            observation: {
              schema: "stage_play_checkpoint_request_result/v1",
              reason: "missing_audio",
              readyToRun: false,
              checkpointRequest: {
                checkpointRequestId: "checkpoint-1",
                status: "queued",
                missingEvidence: ["audio transcript", "objective"],
              },
            },
          },
        },
      ],
    });

    expect(text).toContain("Stage Play checkpoint request queued: checkpoint-1.");
    expect(text).toContain("Ready to run: no. Reason: missing audio.");
    expect(text).toContain("Missing evidence: audio transcript and objective.");
    expect(text).toContain("tool evidence only");
  });

  it("preserves reflection fallback text", () => {
    const text = buildHelixRuntimeStagePlayFallbackText({
      artifacts: [
        {
          kind: "live_environment_tool_observation",
          payload: {
            tool_name: "live_env.reflect_stage_play_context",
            observation: {
              schema: "stage_play_reflection_result/v1",
              graph: {
                graphId: "graph-1",
                sourceWindow: {
                  sources: [
                    {
                      sourceId: "visual-1",
                      modality: "visual_frame",
                      status: "active",
                      selectedForStagePlay: true,
                      routeTo: "narrative_stage_play",
                      evidenceRefs: ["visual_evidence:frame-1"],
                    },
                  ],
                },
                badges: [
                  {
                    missingEvidence: ["audio transcript"],
                  },
                ],
              },
              liveAnswerProjection: {
                projected: true,
                projectedLineKeys: ["risk", "next_check"],
                changedLineKeys: ["risk", "next_check"],
              },
              debugReceipt: {
                graphId: "graph-1",
                visualSourceStatus: [
                  {
                    modality: "visual_frame",
                    status: "active",
                    selectedForStagePlay: true,
                    routeTo: "narrative_stage_play",
                  },
                ],
                checkpointFreshness: {
                  modelReviewed: true,
                },
                sourceRefs: ["visual_evidence:frame-1"],
              },
            },
          },
        },
      ],
    });

    expect(text).toContain("Stage Play reflection succeeded and a model-reviewed checkpoint exists.");
    expect(text).toContain("Graph: graph-1");
    expect(text).toContain("Visual evidence: visual_evidence:frame-1");
    expect(text).toContain("projected risk and next_check as Live Interpretation");
    expect(text).toContain("audio/transcript grounding and a user objective/prediction target");
  });
});
