import { describe, expect, it } from "vitest";
import {
  isLiveWorkstationPipelineIntent,
  planLiveWorkstationPipeline,
} from "../services/helix-ask/live-workstation-pipeline-planner";

describe("live workstation pipeline planner", () => {
  it("plans sentence summaries into a note sink", () => {
    const plan = planLiveWorkstationPipeline({
      prompt: "Summarize each sentence from this live browser tab into a note.",
      sourceIds: ["source:browser-tab-transcript"],
    });

    expect(isLiveWorkstationPipelineIntent("Summarize each sentence from this live browser tab into a note.")).toBe(true);
    expect(plan.pipeline_recipe_id).toBe("transcript_sentence_note");
    expect(plan.transforms.map((transform) => transform.kind)).toEqual(["sentence_summary"]);
    expect(plan.sinks.map((sink) => sink.kind)).toEqual(expect.arrayContaining(["workstation_note", "live_answer_environment"]));
    expect(plan.missing_bindings).toEqual([]);
  });

  it("plans Moral comparison as a bounded transform pipeline", () => {
    const plan = planLiveWorkstationPipeline({
      prompt: "Watch this live transcript and compare each segment to Moral philosophy.",
      sourceIds: ["source:browser-tab-transcript"],
    });

    expect(plan.pipeline_recipe_id).toBe("philosophy_compare");
    expect(plan.transforms.map((transform) => transform.kind)).toEqual(["sentence_summary", "philosophy_compare"]);
    expect(plan.line_schema.map((line) => line.key)).toContain("moral_parallel");
    expect(plan.raw_transcript_included).toBeUndefined();
  });

  it("plans derived prime gap live outputs against the canonical prime stream source", () => {
    const prompt = "Create a live output from the prime stream that tracks prime gaps.";
    const plan = planLiveWorkstationPipeline({ prompt });

    expect(isLiveWorkstationPipelineIntent(prompt)).toBe(true);
    expect(plan.pipeline_recipe_id).toBe("prime_gap_tracker");
    expect(plan.source_requirements).toEqual(["calculator_stream"]);
    expect(plan.missing_bindings).toEqual([]);
    expect(plan.transforms.map((transform) => transform.kind)).toEqual(["sequence_gap_analyzer"]);
    expect(plan.line_schema.map((line) => line.key)).toEqual(
      expect.arrayContaining(["latest_prime", "previous_prime", "gap", "largest_gap", "gap_trend"]),
    );
  });

  it("returns missing source requirements instead of silently starting capture", () => {
    const plan = planLiveWorkstationPipeline({
      prompt: "Track this physics simulation and write a rolling methods note every 20 samples.",
    });

    expect(plan.pipeline_recipe_id).toBe("methods_note_writer");
    expect(plan.missing_bindings).toEqual(["physics_simulation"]);
    expect(plan.next_actions[0]).toMatchObject({ action: "request_live_source" });
  });
});
