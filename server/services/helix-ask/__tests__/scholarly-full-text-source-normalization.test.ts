import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  rerankCachedScholarlyFullTextPassages,
  runScholarlyFullTextFetch,
} from "../retrieval/scholarly-full-text-fetch";
import { normalizeScholarlyFullTextSourceUrl } from "../scholarly-research-intent";

describe("scholarly full-text source normalization", () => {
  it("canonicalizes arXiv abstract and extensionless PDF URLs without changing other sources", () => {
    expect(normalizeScholarlyFullTextSourceUrl("https://arxiv.org/abs/gr-qc/9510071"))
      .toBe("https://arxiv.org/pdf/gr-qc/9510071.pdf");
    expect(normalizeScholarlyFullTextSourceUrl("http://www.arxiv.org/pdf/2401.12345v2"))
      .toBe("https://arxiv.org/pdf/2401.12345v2.pdf");
    expect(normalizeScholarlyFullTextSourceUrl("https://doi.org/10.1103/PhysRevD.53.5496"))
      .toBe("https://doi.org/10.1103/PhysRevD.53.5496");
  });

  it("fetches a direct arXiv abstract source from the canonical PDF endpoint", async () => {
    const fetchedUrls: string[] = [];
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const observation = await runScholarlyFullTextFetch({
      turnId: "ask:scholarly-arxiv-abstract-source",
      callId: "call:scholarly-arxiv-abstract-source",
      query: "fetch and parse the full text for arXiv gr-qc/9510071",
      sourceUrl: "https://arxiv.org/abs/gr-qc/9510071",
      cachePdf: false,
      fetchImpl: async (url) => {
        fetchedUrls.push(url);
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/pdf" },
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      },
      extractPdfTextImpl: async () => ({
        totalPages: 26,
        pages: [{
          page: 4,
          text: "Equation (1) bounds the Lorentzian time-average of negative energy density along an inertial observer worldline and states its sampling-duration assumptions.",
        }],
      }),
    });

    expect(fetchedUrls).toEqual(["https://arxiv.org/pdf/gr-qc/9510071.pdf"]);
    expect(observation).toMatchObject({
      source_url: "https://arxiv.org/pdf/gr-qc/9510071.pdf",
      source_kind: "pdf",
      total_pages: 26,
      pages_parsed: 1,
      evidence_state: "full_text_usable",
    });
  });

  it("preserves an exact paper result id when fetching by id and source URL", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const observation = await runScholarlyFullTextFetch({
      turnId: "ask:scholarly-paper-id-continuity",
      callId: "call:scholarly-paper-id-continuity",
      query: "arXiv:2105.03079",
      paperResultId: "arxiv:selected-paper",
      sourceUrl: "https://arxiv.org/pdf/2105.03079.pdf",
      cachePdf: false,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
      extractPdfTextImpl: async () => ({
        totalPages: 2,
        pages: [{
          page: 2,
          text:
            "Assumptions. The derivation uses a unit lapse and flat spatial slices before evaluating all timelike observers.",
        }],
      }),
    });

    expect(observation).toMatchObject({
      paper_result_id: "arxiv:selected-paper",
      selected_chunks: [expect.objectContaining({
        paper_result_id: "arxiv:selected-paper",
      })],
      citation_packet: {
        source: expect.objectContaining({
          paper_result_id: "arxiv:selected-paper",
        }),
      },
    });
  });

  it("reranks a trusted cached PDF for the current follow-up question", async () => {
    const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "helix-scholarly-cache-"));
    const cachePath = path.join(cacheRoot, "paper.pdf");
    await fs.writeFile(cachePath, new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]));
    try {
      const passages = await rerankCachedScholarlyFullTextPassages({
        cachePath,
        cacheRoot,
        query: "Which assumption mismatch matters most?",
        paperResultId: "arxiv:selected-paper",
        title: "Generic warp drives",
        sourcePdfRef: "artifact://scholarly-pdf/paper.pdf",
        extractPdfTextImpl: async () => ({
          totalPages: 4,
          pages: [{
            page: 4,
            text: [
              "The flow vector and its derivatives are assumed to be smooth and bounded.",
              "The ADM-like decomposition uses unit lapse and a flat spatial three-metric.",
            ].join(" "),
          }],
        }),
      });

      expect(passages[0]).toMatchObject({
        paper_result_id: "arxiv:selected-paper",
        page_start: 4,
      });
      expect(passages.map((entry) => entry.text_excerpt).join(" ")).toContain(
        "unit lapse and a flat spatial three-metric",
      );
    } finally {
      await fs.rm(cacheRoot, { recursive: true, force: true });
    }
  });

  it("ranks an exact quoted passage ahead of generic title and abstract vocabulary", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const observation = await runScholarlyFullTextFetch({
      turnId: "ask:scholarly-exact-passage-ranking",
      callId: "call:scholarly-exact-passage-ranking",
      query: [
        "page 3",
        '"show that line energy is linear with line width within error bars"',
        '"Our preliminary calculations above show that the magnetic flux tube shape can be determined conclusively"',
      ].join(" "),
      paper: {
        result_id: "arxiv:magnetar-lines",
        title: "Probing Magnetars Using Spectral Lines with Future Telescopes",
        abstract: "Line energy, width, and depth constrain magnetar emission geometry.",
        authors: [{ name: "D. Kirmizibayrak" }],
        year: 2022,
        identifiers: { arxiv_id: "2202.09424v1" },
        evidence_refs: ["arxiv:2202.09424v1"],
        source_providers: ["arxiv"],
        confidence: "high",
      },
      sourceUrl: "https://arxiv.org/pdf/2202.09424v1.pdf",
      cachePdf: false,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
      extractPdfTextImpl: async () => ({
        totalPages: 3,
        pages: [
          {
            page: 1,
            text: "Abstract. Probing magnetars with spectral lines relates line energy, width, and depth to emission geometry and future telescopes.",
          },
          {
            page: 3,
            text: [
              "Results.",
              "We show that line energy is linear with line width within error bars.",
              "Our preliminary calculations above show that the magnetic flux tube shape can be determined conclusively if width, depth and energy are studied concurrently.",
            ].join(" "),
          },
        ],
      }),
      maxPages: 3,
      maxChunks: 2,
    });

    expect(observation.selected_chunks[0]).toMatchObject({
      page_start: 3,
      section_hint: "Results",
    });
    expect(observation.selected_chunks[0].text_excerpt).toContain(
      "show that line energy is linear with line width within error bars",
    );
    expect(observation.selected_chunks[0].citation_label).toBe(
      "Probing Magnetars Using Spectral Lines with Future Telescopes, p. 3, Results",
    );
    expect(observation.citation_packet).toMatchObject({
      schema: "helix.scholarly_citation_packet.v1",
      citation_instruction: "cite_claims_with_passage_labels",
    });
    expect(observation.citation_packet?.passages[0]).toMatchObject({
      page: 3,
      citation_label: "Probing Magnetars Using Spectral Lines with Future Telescopes, p. 3, Results",
    });
  });
});
