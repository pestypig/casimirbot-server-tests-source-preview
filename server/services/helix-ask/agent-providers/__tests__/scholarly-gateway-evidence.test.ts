import { describe, expect, it } from "vitest";
import type { HelixWorkstationGatewayCallResult } from "../../workstation-tool-gateway/types";
import {
  enrichScholarlyNumericArgumentsFromGatewayResults,
  hasRuntimeSelectedUsableScholarlyLookupEvidence,
  hasRuntimeSelectedUsableScholarlyFullTextEvidence,
  isRuntimeSelectedUsableScholarlyLookupResult,
  scholarlyObservedResultIdsFromGatewayResults,
} from "../scholarly-gateway-evidence";

const fullTextResult = (input: {
  artifactId: string;
  sourceUrl: string;
  cacheHash?: string;
}): HelixWorkstationGatewayCallResult => ({
  ok: true,
  capability_id: "scholarly-research.fetch_full_text",
  gateway_admission: {
    requested_capability: "scholarly-research.fetch_full_text",
  },
  observation_packet: {
    observation_ref: `${input.artifactId}:packet`,
    produced_artifact_refs: [input.artifactId],
  },
  observation: {
    schema: "helix.scholarly_full_text_observation.v1",
    artifact_id: input.artifactId,
    source_url: input.sourceUrl,
    cache_integrity_hash: input.cacheHash ?? input.sourceUrl,
    evidence_state: "full_text_usable",
    selected_chunks: [{ paper_result_id: "paper:1", page_number: 2, text: "4.0 mJy" }],
  },
  artifact_refs: [input.artifactId],
} as unknown as HelixWorkstationGatewayCallResult);

const partialLookupResult = (): HelixWorkstationGatewayCallResult => ({
  ok: false,
  capability_id: "scholarly-research.lookup_papers",
  gateway_admission: {
    requested_capability: "scholarly-research.lookup_papers",
  },
  observation_packet: {
    observation_ref: "ask:magnetar:lookup:packet",
    produced_artifact_refs: ["ask:magnetar:lookup"],
  },
  observation: {
    schema: "helix.scholarly_research_observation.v1",
    artifact_id: "ask:magnetar:lookup",
    evidence_state: "lookup_weak_match",
    selected_for_answer: false,
    papers: [
      {
        result_id: "arxiv:magnetar-review",
        title: "Magnetars: neutron stars with huge magnetic storms",
        evidence_refs: ["arxiv:1211.2086v1"],
        identifiers: { arxiv_id: "1211.2086v1" },
      },
      {
        result_id: "arxiv:neutron-star-review",
        title: "Exploring the neutron star zoo: An observational review",
        evidence_refs: ["arxiv:2405.02368v1"],
        identifiers: { arxiv_id: "2405.02368v1" },
      },
    ],
  },
  artifact_refs: ["ask:magnetar:lookup"],
  error: "semantic_scholar_http_429",
} as unknown as HelixWorkstationGatewayCallResult);

describe("scholarly gateway evidence handoff", () => {
  it("binds one unambiguous full-text observation into a later numeric call", () => {
    const result = fullTextResult({
      artifactId: "ask:paper:full-text",
      sourceUrl: "https://arxiv.org/pdf/1902.10712v1.pdf",
    });

    expect(enrichScholarlyNumericArgumentsFromGatewayResults(
      [result],
      { requested_variables: ["flux_density_mjy"] },
    )).toMatchObject({
      requested_variables: ["flux_density_mjy"],
      source_ref: "ask:paper:full-text",
      full_text_observation: {
        artifact_id: "ask:paper:full-text",
        evidence_state: "full_text_usable",
      },
    });
  });

  it("does not guess between distinct full-text sources without an exact source ref", () => {
    const first = fullTextResult({
      artifactId: "ask:paper:first",
      sourceUrl: "https://example.test/first.pdf",
    });
    const second = fullTextResult({
      artifactId: "ask:paper:second",
      sourceUrl: "https://example.test/second.pdf",
    });
    const args = { requested_variables: ["flux_density_mjy"] };

    expect(enrichScholarlyNumericArgumentsFromGatewayResults([first, second], args)).toEqual(args);
  });

  it("recognizes exact runtime-selected full-text artifact authority", () => {
    const result = fullTextResult({
      artifactId: "ask:paper:full-text",
      sourceUrl: "https://arxiv.org/pdf/1902.10712v1.pdf",
    });

    expect(scholarlyObservedResultIdsFromGatewayResults([result])).toEqual([
      "ask:paper:full-text",
      "paper:1",
    ]);
    expect(hasRuntimeSelectedUsableScholarlyFullTextEvidence({
      gatewayCallResults: [result],
      selectedResultIds: ["ask:paper:full-text"],
    })).toBe(true);
    expect(hasRuntimeSelectedUsableScholarlyFullTextEvidence({
      gatewayCallResults: [result],
      selectedResultIds: ["ask:paper:unknown"],
    })).toBe(false);
  });

  it("recognizes exact runtime-selected papers from a partially failed lookup", () => {
    const result = partialLookupResult();

    expect(isRuntimeSelectedUsableScholarlyLookupResult({
      result,
      selectedResultIds: ["arxiv:magnetar-review"],
    })).toBe(true);
    expect(hasRuntimeSelectedUsableScholarlyLookupEvidence({
      gatewayCallResults: [result],
      selectedResultIds: ["arxiv:magnetar-review", "arxiv:neutron-star-review"],
    })).toBe(true);
    expect(hasRuntimeSelectedUsableScholarlyLookupEvidence({
      gatewayCallResults: [result],
      selectedResultIds: ["arxiv:magnetar-review", "arxiv:unknown"],
    })).toBe(false);
  });
});
