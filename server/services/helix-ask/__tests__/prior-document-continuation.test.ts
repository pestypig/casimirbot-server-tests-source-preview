import { describe, expect, it } from "vitest";
import { buildPriorDocumentContinuationHint } from "../prior-document-continuation";

describe("prior document continuation", () => {
  it("builds an exact-path bounded docs search from admitted cited evidence", () => {
    const hint = buildPriorDocumentContinuationHint({
      turnId: "ask:turn-2",
      prompt:
        "Stay with that same document and explain one equation family.",
      packet: {
        schema: "helix.conversation_memory_packet.v1",
        allowed_for_current_goal: true,
        allowed_use: "reuse_prior_evidence_refs",
        reusable_evidence_refs: [
          "artifact://receipt/not-a-document",
          "docs/research/casimir-dp-quantum-foam-study.md:120-148",
        ],
      },
    });

    expect(hint).toMatchObject({
      capability_id: "docs.search",
      source_document_path:
        "docs/research/casimir-dp-quantum-foam-study.md",
      lane_request: {
        capability: "docs.search",
        paths: ["docs/research/casimir-dp-quantum-foam-study.md"],
        max_hits: 12,
      },
      admissible: true,
      terminal_eligible: false,
    });
  });

  it.each([
    {
      allowed_for_current_goal: false,
      allowed_use: "reuse_prior_evidence_refs",
      reusable_evidence_refs: ["docs/research/paper.md:10-12"],
    },
    {
      allowed_for_current_goal: true,
      allowed_use: "conversational_continuity",
      reusable_evidence_refs: ["docs/research/paper.md:10-12"],
    },
    {
      allowed_for_current_goal: true,
      allowed_use: "reuse_prior_evidence_refs",
      reusable_evidence_refs: ["artifact://receipt/old", "../outside.md"],
    },
  ])("rejects unadmitted, non-evidence, or unsafe refs", (packet) => {
    expect(
      buildPriorDocumentContinuationHint({
        turnId: "ask:turn-2",
        prompt: "Use that same document.",
        packet: {
          schema: "helix.conversation_memory_packet.v1",
          ...packet,
        },
      }),
    ).toBeNull();
  });
});
