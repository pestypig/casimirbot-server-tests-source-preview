import { describe, expect, it } from "vitest";
import { boundHelixDebugExportEnvelopeForUi } from "../routes/agi.plan";

describe("Helix Ask UI debug export size bound", () => {
  it("does not reintroduce oversized critical rail fields during final compaction", () => {
    const largeRows = Array.from({ length: 80 }, (_, index) => ({
      index,
      source_image_ref: `data:image/png;base64,${"a".repeat(40_000)}`,
      crop_image_ref: `data:image/png;base64,${"b".repeat(40_000)}`,
      text_candidate: "t".repeat(10_000),
      latex_candidate: "l".repeat(10_000),
      uncertainty: ["u".repeat(10_000)],
    }));
    const bounded = boundHelixDebugExportEnvelopeForUi({
      schema: "helix.ask.debug_export.v1",
      active_turn_id: "ask:size-bound",
      selected_final_answer: "Grounded terminal answer.",
      final_answer_source: "provider_image_lens_observation_report",
      terminal_artifact_kind: "image_lens_observation_report",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_eligible: true,
      },
      capability_lane_call_results: largeRows,
      capability_lane_observation_packets: largeRows,
      runtime_lane_request_loop: { candidate: largeRows, capability_lane_call_results: largeRows },
      capability_lane_turn_timeline: largeRows,
      capability_lane_timeline_summary: { console_state_rows: largeRows },
      debug: {
        capability_lane_call_results: largeRows,
        capability_lane_observation_packets: largeRows,
      },
    });
    const serialized = JSON.stringify(bounded);

    expect(serialized.length).toBeLessThanOrEqual(750_000);
    expect(bounded.selected_final_answer).toBe("Grounded terminal answer.");
    expect(bounded.terminal_answer_authority).toBeTruthy();
    expect((bounded.debug_export_size_control as Record<string, unknown>)?.returned_chars).toBeLessThanOrEqual(750_000);
  });
});
