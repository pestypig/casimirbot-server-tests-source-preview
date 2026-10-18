import { beforeEach, describe, expect, it } from "vitest";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../../../situation-room/live-source-chunk-buffer";
import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../registry";
import { LIVE_PIPELINE_SET_RATE_CAPABILITY } from
  "../live-pipeline-control";

describe("live pipeline control gateway", () => {
  beforeEach(() => resetLiveSourceChunkBufferForTest());

  it("publishes and executes the conversation-scoped cadence capability", async () => {
    const threadId = "helix-ask:test:live-pipeline-control";
    upsertLiveSourceProducer({
      sourceId: "visual_source:live-pipeline-control",
      threadId,
      modality: "visual_frame",
      status: "active",
      captureMode: "interval",
      cadenceMs: 15_000,
    });

    expect(
      listWorkstationGatewayCapabilities({ mode: "act" }).capabilities.some(
        (entry) =>
          entry.capability_id === LIVE_PIPELINE_SET_RATE_CAPABILITY,
      ),
    ).toBe(true);

    const result = await callWorkstationGatewayCapability({
      capabilityId: LIVE_PIPELINE_SET_RATE_CAPABILITY,
      mode: "act",
      conversationThreadId: threadId,
      turnId: "ask:test:live-pipeline-control:turn",
      arguments: {
        cadence_ms: 10_000,
        capture_mode: "interval",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.capability_id).toBe(LIVE_PIPELINE_SET_RATE_CAPABILITY);
    expect(result.observation).toMatchObject({
      schema: "helix.visual_producer_cadence_receipt.v1",
      action_id: LIVE_PIPELINE_SET_RATE_CAPABILITY,
      source_id: "visual_source:live-pipeline-control",
      cadence_ms: 10_000,
      capture_mode: "interval",
      ok: true,
    });
  });

  it("fails closed when a model-supplied source belongs to another thread", async () => {
    upsertLiveSourceProducer({
      sourceId: "visual_source:other-thread",
      threadId: "helix-ask:test:other-thread",
      modality: "visual_frame",
      status: "active",
      captureMode: "interval",
      cadenceMs: 15_000,
    });

    const result = await callWorkstationGatewayCapability({
      capabilityId: LIVE_PIPELINE_SET_RATE_CAPABILITY,
      mode: "act",
      conversationThreadId: "helix-ask:test:current-thread",
      arguments: {
        source_id: "visual_source:other-thread",
        cadence_ms: 10_000,
        capture_mode: "interval",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("wrong_conversation_source");
    expect(result.terminal_eligible).toBe(false);
  });
});
