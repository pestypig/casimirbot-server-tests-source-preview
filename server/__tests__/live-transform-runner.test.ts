import { describe, expect, it } from "vitest";
import { planLiveWorkstationPipeline } from "../services/helix-ask/live-workstation-pipeline-planner";
import { createLiveWorkstationPipeline } from "../services/situation-room/live-workstation-pipeline-store";
import { runLiveTransformsForSourceEvent } from "../services/situation-room/live-transform-runner";
import type { WorkstationLiveSourceEvent } from "@shared/helix-workstation-live-source";

const event: WorkstationLiveSourceEvent = {
  schema: "helix.workstation_live_source_event.v1",
  event_id: "evt:1",
  source_event_id: "evt:1",
  source_id: "source:browser-tab-transcript",
  environment_id: "env:1",
  thread_id: "helix-ask:test",
  seq: 1,
  tick_index: 1,
  ts: "2026-05-10T12:00:00.000Z",
  kind: "browser_audio_transcript",
  source_family: "browser_audio",
  event_type: "transcript_sentence",
  payload: { text: "The speaker says practice is more useful than arguing about labels." },
  evidence_refs: ["source:browser-tab-transcript:seq:1"],
  deterministic: true,
};

describe("live transform runner", () => {
  it("records deterministic summaries as transform results, not answers", () => {
    const plan = planLiveWorkstationPipeline({
      prompt: "Summarize each sentence from this live browser tab into a note.",
      sourceIds: [event.source_id],
      environmentId: "env:1",
    });
    const { pipeline } = createLiveWorkstationPipeline({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:test",
      objective: plan.objective,
      source_ids: [event.source_id],
      environment_id: "env:1",
      plan,
    });

    const results = runLiveTransformsForSourceEvent({ pipeline, event });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      schema: "helix.live_transform_result.v1",
      kind: "sentence_summary",
      model_invoked: false,
      deterministic: true,
    });
    expect(JSON.stringify(results[0])).not.toContain("assistant_text");
  });

  it("produces compact Moral comparison lines without raw transcript flags", () => {
    const plan = planLiveWorkstationPipeline({
      prompt: "Compare this live transcript to Moral philosophy.",
      sourceIds: [event.source_id],
      environmentId: "env:moral",
    });
    const { pipeline } = createLiveWorkstationPipeline({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:moral",
      objective: plan.objective,
      source_ids: [event.source_id],
      environment_id: "env:moral",
      plan,
    });

    const results = runLiveTransformsForSourceEvent({ pipeline, event });
    const philosophy = results.find((result) => result.kind === "philosophy_compare");

    expect(philosophy?.lines?.moral_parallel).toContain("observe");
    expect(philosophy?.model_invoked).toBe(false);
  });
});
