import { describe, expect, it } from "vitest";

import { summarizeHelixTerminalRejectionObservationForDebugExport } from "../terminal-rejection-debug-export";

describe("terminal rejection debug export", () => {
  it("preserves the gate, stable reason codes, and evidence refs without answer authority", () => {
    const summary = summarizeHelixTerminalRejectionObservationForDebugExport({
      schema: "helix.terminal_rejection_observation.v1",
      turn_id: "ask:test:quality-repair",
      observation_id: "ask:test:quality-repair:terminal_rejection:1",
      rejected_candidate_kind: "model_synthesized_answer",
      rejected_candidate_ref: "ask:test:quality-repair:candidate:1",
      rejection_reason: "route_requires_synthesis",
      gate: "provider_route_product_quality_gate",
      reason_codes: ["invalid_page_evidence_links"],
      evidence_refs: ["ask:test:quality-repair:observation:1"],
      recoverable: true,
      failure_class: "terminal_authority",
      retryability: "retryable",
      next_affordances: [{ decision: "answer", reason: "Repair the synthesis." }],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      hidden_raw_candidate_text: "must not be exported",
    });

    expect(summary).toMatchObject({
      gate: "provider_route_product_quality_gate",
      reason_codes: ["invalid_page_evidence_links"],
      evidence_refs: ["ask:test:quality-repair:observation:1"],
      recoverable: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(summary).not.toHaveProperty("hidden_raw_candidate_text");
  });
});
