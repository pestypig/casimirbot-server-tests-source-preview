import { describe, expect, it } from "vitest";

import {
  buildGenericCompoundContinuationReviewGuidance,
  extractCodexCapabilityLaneRequestCandidate,
  extractCodexCapabilityLaneRequestCandidates,
  stripCodexCapabilityLaneRequestMarkers,
} from "../codex-provider";

describe("Codex capability-lane request parsing", () => {
  it("keeps dynamic same-capability steps available during compound terminal review", () => {
    const guidance = buildGenericCompoundContinuationReviewGuidance([
      "com.casimirbot.minecraft.command",
    ]).join("\n");

    expect(guidance).toContain("compound prompt contract");
    expect(guidance).toContain("empty next_admissible_affordances");
    expect(guidance).toContain("does not prohibit Codex");
    expect(guidance).toContain("com.casimirbot.minecraft.command");
  });

  it("does not reinterpret a structured Master Problem answer as an unknown capability lane", () => {
    const answer = JSON.stringify({
      master_problem_v1: {
        request: {
          operation: "compare",
          targetObservable: "nabla_mu_T_mu_nu",
        },
        compileStatus: "partially_executable",
      },
      requested_capability: "helix_ask.reflect_theory_context",
      terminal_eligible: false,
    });

    expect(extractCodexCapabilityLaneRequestCandidate(answer)).toBeNull();
    expect(extractCodexCapabilityLaneRequestCandidates(answer)).toEqual([]);
  });

  it("preserves an explicitly named capability-lane request", () => {
    const request =
      "HELIX_CAPABILITY_LANE_REQUEST_JSON: " +
      JSON.stringify({
        capability: "visual_analysis.inspect_image_region",
        source_id: "image:current",
        bbox_px: { x: 0, y: 0, width: 10, height: 10 },
      });

    expect(extractCodexCapabilityLaneRequestCandidate(request)).toMatchObject({
      capability: "visual_analysis.inspect_image_region",
    });
  });

  it("unwraps a continuation affordance envelope to its lane request", () => {
    const request =
      "HELIX_CAPABILITY_LANE_REQUEST_JSON: " +
      JSON.stringify({
        affordance_id: "turn:procedure:evaluate-closure",
        reason: "Evaluate the prepared procedure.",
        lane_request: {
          capability: "theory-experiment-procedure.evaluate_closure",
          procedure_id: "turn:procedure",
          procedure_sha256: "sha256:procedure",
        },
      });

    expect(extractCodexCapabilityLaneRequestCandidate(request)).toEqual({
      capability: "theory-experiment-procedure.evaluate_closure",
      procedure_id: "turn:procedure",
      procedure_sha256: "sha256:procedure",
    });
  });

  it("translates the legacy workstation marker without exposing it as answer text", () => {
    const request =
      "HELIX_WORKSTATION_TOOL_REQUEST_JSON: " +
      JSON.stringify({
        capability_id: "docs.search",
        arguments: { query: "NHM tube", max_hits: 5 },
      });

    expect(extractCodexCapabilityLaneRequestCandidate(request)).toMatchObject({
      capability_id: "docs.search",
      arguments: { query: "NHM tube", max_hits: 5 },
    });
    expect(stripCodexCapabilityLaneRequestMarkers(request)).toBe("");
  });

  it("accepts a multiline capability_id envelope with trailing provider prose", () => {
    const request = [
      "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
      "{",
      '  "capability_id": "com.casimirbot.minecraft.player.guardian.execute",',
      '  "arguments": {',
      '    "program_id": "guardian:multiline"',
      "  }",
      "}",
      "I will wait for the observation before answering.",
    ].join("\n");

    expect(extractCodexCapabilityLaneRequestCandidate(request)).toEqual({
      capability_id:
        "com.casimirbot.minecraft.player.guardian.execute",
      arguments: { program_id: "guardian:multiline" },
    });
  });

  it("does not infer an incomplete marked JSON request", () => {
    const request =
      'HELIX_CAPABILITY_LANE_REQUEST_JSON:{"capability":"docs.search","arguments":{"query":"unfinished"}';

    expect(extractCodexCapabilityLaneRequestCandidate(request)).toBeNull();
  });

  it("recovers a one-character structured marker near miss without exposing it as answer text", () => {
    const request =
      "HELICX_CAPABILITY_LANE_REQUEST_JSON: " +
      JSON.stringify({
        capability: "com.casimirbot.minecraft.command",
        command: "gamerule doDaylightCycle true",
      });

    expect(extractCodexCapabilityLaneRequestCandidate(request)).toEqual({
      capability: "com.casimirbot.minecraft.command",
      command: "gamerule doDaylightCycle true",
    });
    expect(stripCodexCapabilityLaneRequestMarkers(request)).toBe("");
  });

  it("does not reinterpret unrelated marker-like prose as a capability request", () => {
    const answer =
      'HELLO_CAPABILITY_LANE_REQUEST_JSON: {"operation":"compare"}';

    expect(extractCodexCapabilityLaneRequestCandidate(answer)).toBeNull();
    expect(stripCodexCapabilityLaneRequestMarkers(answer)).toBe(answer);
  });

  it("rejects an explicitly wrapped lane object that omits its capability", () => {
    const request = JSON.stringify({
      capability_lane_call: {
        operation: "compare",
        target_observable: "nabla_mu_T_mu_nu",
      },
    });

    expect(extractCodexCapabilityLaneRequestCandidates(request)).toEqual([]);
  });
});
