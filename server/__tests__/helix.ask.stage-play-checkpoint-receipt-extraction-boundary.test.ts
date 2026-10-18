import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStagePlayAskCheckpointReceiptPayload,
  collectStagePlayCheckpointEvidenceRefs,
  collectStagePlaySourceWindowRefsForReceipt,
  readStagePlayGraphRecord,
  readStagePlayLiveAnswerProjectionRecord,
  readStagePlayReflectionObservationFromArtifacts,
  readStagePlaySourceWindowRecord,
  type StagePlayCheckpointReceiptArtifactLike,
} from "../services/helix-ask/live-source/stage-play-checkpoint-receipt";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/live-source/stage-play-checkpoint-receipt.ts");

describe("stage play checkpoint receipt extraction boundary", () => {
  it("keeps checkpoint receipt readers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/live-source/stage-play-checkpoint-receipt");
    expect(routeSource).toContain("buildStagePlayAskCheckpointReceiptPayload");
    expect(routeSource).not.toMatch(/const readStagePlayReflectionObservationFromArtifacts\s*=/);
    expect(routeSource).not.toMatch(/const readStagePlayGraphRecord\s*=/);
    expect(routeSource).not.toMatch(/const readStagePlaySourceWindowRecord\s*=/);
    expect(routeSource).not.toMatch(/const readStagePlayLiveAnswerProjectionRecord\s*=/);
    expect(routeSource).not.toMatch(/const collectStagePlayCheckpointEvidenceRefs\s*=/);
    expect(routeSource).not.toMatch(/const collectStagePlaySourceWindowRefsForReceipt\s*=/);
    expect(routeSource).not.toMatch(/const stagePlay = readStagePlayReflectionObservationFromArtifacts\(args\.artifacts\)/);
    expect(routeSource).not.toMatch(/const completedSolverPath\s*=\s*\n\s*Boolean\(args\.payload\.ask_turn_solver_trace\)/);
    expect(routeSource).toMatch(/const maybeRecordStagePlayAskCheckpointReceipt\s*=/);
    expect(routeSource).toContain("recordStagePlayAskCheckpointReceipt(receiptPayload)");
    expect(routeSource).toContain("completeStagePlayCheckpointRequestForGraph");
    expect(routeSource).toContain("args.payload.stage_play_ask_checkpoint_receipt = receipt");
    expect(routeSource).toContain("args.payload.stage_play_checkpoint_queue_completion = checkpointQueueCompletion");

    expect(serviceSource).toContain("export const readStagePlayReflectionObservationFromArtifacts");
    expect(serviceSource).toContain("export const collectStagePlayCheckpointEvidenceRefs");
    expect(serviceSource).toContain("export const buildStagePlayAskCheckpointReceiptPayload");
    expect(serviceSource).not.toContain("recordStagePlayAskCheckpointReceipt(");
    expect(serviceSource).not.toContain("completeStagePlayCheckpointRequestForGraph");
    expect(serviceSource).not.toContain("stage_play_checkpoint_queue_completion");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
  });

  it("reads the latest Stage Play reflection observation and preserves checkpoint refs", () => {
    const artifacts: StagePlayCheckpointReceiptArtifactLike[] = [
      {
        artifact_id: "older",
        kind: "live_environment_tool_observation",
        payload: {
          tool_name: "live_env.reflect_stage_play_context",
          observation: { schema: "stage_play_reflection_result/v1", graph: { graphId: "old-graph" } },
        },
      },
      {
        artifact_id: "reflection-artifact",
        kind: "live_environment_tool_observation",
        payload: {
          tool_name: "live_env.reflect_stage_play_context",
          observation_id: "obs-1",
          evidence_refs: ["tool-ref"],
          observation: {
            schema: "stage_play_reflection_result/v1",
            graph: {
              graphId: "graph-1",
              evidenceRefs: ["graph-ref"],
              sourceWindow: {
                latestSourceDescriptorRefs: ["descriptor-ref"],
                latestSourceProducerRefs: ["producer-ref"],
                latestRawSessionBufferRefs: ["raw-ref"],
                latestObservationRefs: ["observation-ref"],
                latestSnapshotRefs: ["snapshot-ref"],
                latestDeltaOverlayRefs: ["delta-ref"],
                latestNavigationRefs: ["nav-ref"],
                sourceRoutes: [{ sourceId: "screen", routeTo: "narrative_stage_play" }],
                sources: [
                  {
                    sourceId: "screen",
                    modality: "visual_frame",
                    evidenceRefs: ["source-ref"],
                  },
                ],
              },
            },
            liveAnswerProjection: {
              deltaId: "delta-1",
              environmentId: "env-1",
              changedLineKeys: ["line-1"],
            },
          },
        },
      },
    ];

    const stagePlay = readStagePlayReflectionObservationFromArtifacts(artifacts);
    expect(stagePlay?.artifact.artifact_id).toBe("reflection-artifact");

    const graph = readStagePlayGraphRecord(stagePlay!.observation);
    const sourceWindow = readStagePlaySourceWindowRecord(graph);
    const projection = readStagePlayLiveAnswerProjectionRecord(stagePlay!.observation);

    expect(graph?.graphId).toBe("graph-1");
    expect(sourceWindow).toBeTruthy();
    expect(projection?.deltaId).toBe("delta-1");

    expect(collectStagePlayCheckpointEvidenceRefs({
      stagePlayArtifact: stagePlay!.artifact,
      toolPayload: stagePlay!.toolPayload,
      observation: stagePlay!.observation,
      graph,
      liveAnswerProjection: projection,
      turnId: "ask:turn",
      finalAnswerDraftRef: "draft-ref",
    })).toEqual([
      "reflection-artifact",
      "obs-1",
      "graph-1",
      "delta-1",
      "env-1",
      "ask:turn:agent_runtime_loop",
      "ask:turn:agent_step_decision",
      "ask:turn:ask_turn_solver_trace",
      "draft-ref",
      "live_answer_line:line-1",
      "tool-ref",
      "graph-ref",
    ]);

    expect(collectStagePlaySourceWindowRefsForReceipt(graph, sourceWindow)).toEqual([
      "graph-1",
      "descriptor-ref",
      "producer-ref",
      "raw-ref",
      "observation-ref",
      "snapshot-ref",
      "delta-ref",
      "nav-ref",
      "source_route:screen:narrative_stage_play",
      "screen",
      "screen:visual_frame",
      "source-ref",
    ]);

    expect(buildStagePlayAskCheckpointReceiptPayload({
      payload: {
        ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1" },
        final_answer_source: "final_answer_draft",
        terminal_artifact_kind: "model_synthesized_answer",
        thread_id: "thread-1",
      },
      turnId: "ask:turn",
      artifacts,
      finalAnswerDraft: {
        text: "Checkpoint answer",
        authority: "model_synthesized",
      },
      finalAnswerDraftRef: "draft-ref",
      createdAt: "2026-06-28T00:00:00.000Z",
    })).toMatchObject({
      threadId: "thread-1",
      environmentId: "env-1",
      graphId: "graph-1",
      askTurnId: "ask:turn",
      solverTraceRef: "ask:turn:ask_turn_solver_trace",
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "final_answer_draft",
      completedSolverPath: true,
      answerText: "Checkpoint answer",
      sourceArtifactRefs: ["reflection-artifact", "draft-ref", "ask:turn:ask_turn_solver_trace"],
      createdAt: "2026-06-28T00:00:00.000Z",
    });
  });
});
