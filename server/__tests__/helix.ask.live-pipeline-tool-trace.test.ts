import { describe, expect, it } from "vitest";

import {
  buildLivePipelineActionEnvelope,
  buildLivePipelineToolTraceDisclosure,
  buildLivePipelineWorkstationActions,
} from "../services/helix-ask/live-pipeline-tool-trace";

describe("Helix Ask live pipeline tool trace disclosure", () => {
  it("converts live pipeline actions into workstation disclosure items", () => {
    const disclosure = buildLivePipelineToolTraceDisclosure({
      turnId: "turn:live",
      actions: [
        "situation-room.pipeline.compose",
        "situation-room.pipeline.execute",
        "situation-room.pipeline.inspect",
        "situation-room.live-source.set_rate",
      ],
      pipelineId: "live_pipeline:test",
      pipelineReceiptId: "live_source_pipeline_receipt:test",
    });

    expect(disclosure.items.some((item) => item.tool === "situation-room.pipeline.compose")).toBe(true);
    expect(disclosure.items.find((item) => item.tool === "situation-room.pipeline.compose")?.authority).toBe("evidence_only");
    expect(disclosure.items.find((item) => item.tool === "situation-room.pipeline.execute")?.authority).toBe("mutation_receipt");
    expect(disclosure.items.find((item) => item.tool === "situation-room.pipeline.inspect")?.authority).toBe("runtime_observation");
    expect(disclosure.items.find((item) => item.tool === "situation-room.live-source.set_rate")?.authority).toBe("mutation_receipt");
    expect(disclosure.assistant_answer).toBe(false);
    expect(disclosure.terminal_eligible).toBe(false);
    expect(disclosure.answerNote).toBe(
      "Evidence note: Live Answer pipeline receipts supplied workstation state and runtime observations; they are not raw logs or a standalone answer.",
    );
  });

  it("builds a suppressed action envelope for disclosure without dispatch", () => {
    const envelope = buildLivePipelineActionEnvelope({
      actions: ["situation-room.pipeline.compose", "situation-room.pipeline.execute"],
      pipelineId: "live_pipeline:test",
      pipelineReceiptId: "live_source_pipeline_receipt:test",
    });

    expect(envelope.workstation_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ panel_id: "situation-room", action_id: "pipeline.compose" }),
      expect.objectContaining({ panel_id: "situation-room", action_id: "pipeline.execute" }),
    ]));
    expect(envelope.governance.dispatch).toBe("suppress");
  });

  it("deduplicates actions while preserving pipeline provenance args", () => {
    const actions = buildLivePipelineWorkstationActions({
      actions: ["situation-room.pipeline.inspect", "situation-room.pipeline.inspect"],
      pipelineId: "live_pipeline:test",
      pipelineReceiptId: "live_source_pipeline_receipt:test",
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      panel_id: "situation-room",
      action_id: "pipeline.inspect",
      args: {
        pipeline_id: "live_pipeline:test",
        pipeline_receipt_id: "live_source_pipeline_receipt:test",
      },
    });
  });
});
