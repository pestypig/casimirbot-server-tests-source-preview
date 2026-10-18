import { describe, expect, it } from "vitest";
import {
  compactDocsEvidenceArtifactForModel,
  compactScholarlyFullTextArtifactForModel,
} from "../model-context-economy";

describe("model context evidence passages", () => {
  it("re-enters local document passages with claim-usable line citations", () => {
    const packet = compactDocsEvidenceArtifactForModel({
      turnId: "ask:docs-passages",
      userRequested: "What is the main idea of the NHM2 whitepaper?",
      artifact: {
        kind: "doc_search_results",
        artifact_id: "ask:docs-passages:docs-search",
        payload: {
          capability_key: "docs.search",
          query: "NHM2 whitepaper",
          evidence_passages: [{
            path: "docs/research/nhm2-current-status-whitepaper.md",
            citation_ref: "workspace://docs/research/nhm2-current-status-whitepaper.md#line=5-5",
            citation_label: "NHM2 Current Status Whitepaper, line 5, Abstract",
            text_excerpt: "NHM2 is a same-chart metric-evaluation framework with bounded diagnostic claims.",
          }],
        },
      },
    });

    expect(packet?.status).toBe("succeeded");
    expect(packet?.found[0]).toContain("NHM2 Current Status Whitepaper, line 5, Abstract");
    expect(packet?.found[0]).toContain("bounded diagnostic claims");
    expect(packet?.support_refs).toContain(
      "workspace://docs/research/nhm2-current-status-whitepaper.md#line=5-5",
    );
  });

  it("re-enters scholarly passages with claim-adjacent page labels", () => {
    const packet = compactScholarlyFullTextArtifactForModel({
      turnId: "ask:paper-passages",
      userRequested: "What measurement does this paper report?",
      artifact: {
        kind: "scholarly_full_text_observation",
        artifact_id: "ask:paper-passages:full-text",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          artifact_id: "ask:paper-passages:full-text",
          capability: "scholarly-research.fetch_full_text",
          evidence_state: "full_text_usable",
          selected_chunks: [{
            page_start: 7,
            section_hint: "Results",
            text_excerpt: "The mean flux density was 4.0 +/- 0.8 mJy at 8.4 GHz.",
            citation_ref: "artifact://paper.pdf#page=7&char=400-470",
            citation_label: "Magnetar Flux Study, p. 7, Results",
            source_text_ref: "artifact://paper.pdf#page=7&char=400-470",
          }],
          page_text_refs: [],
          visual_candidates: [],
          missing_requirements: [],
        },
      },
    });

    expect(packet?.status).toBe("succeeded");
    expect(packet?.found.join(" ")).toContain("Magnetar Flux Study, p. 7, Results");
    expect(packet?.found.join(" ")).toContain("4.0 +/- 0.8 mJy");
    expect(packet?.proves[0]).toContain("cite this label next to supported claims");
  });
});
