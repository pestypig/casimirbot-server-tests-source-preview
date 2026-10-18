import { describe, expect, it } from "vitest";
import {
  applyDocsRetrievalAuthority,
  buildDocsEvidencePassages,
  buildDocsSearchDocumentCandidates,
  buildDocsSearchTerms,
  rankDocsSearchHits,
  resolveAuthoritativeDocsTopicMatch,
  resolveDocsRetrievalAuthority,
} from "../docs-search";
import type { RepoSearchHit } from "../repo-search";

const hit = (filePath: string, text: string, term = "nhm2"): RepoSearchHit => ({
  filePath,
  line: 1,
  text,
  term,
});

describe("docs search taxonomy metadata", () => {
  it.each([
    [
      "What is the current NHM2 research position?",
      "nhm2",
      "docs/research/nhm2-current-status-whitepaper.md",
    ],
    [
      "What is the current Casimir-DP quantum foam study actually claiming?",
      "casimir-dp",
      "docs/research/casimir-dp-quantum-foam-study.md",
    ],
  ])("recognizes a primary taxonomy topic from a natural prompt: %s", (prompt, topicId, primaryPath) => {
    expect(resolveAuthoritativeDocsTopicMatch(prompt)).toMatchObject({
      topic_id: topicId,
      primary_path: primaryPath,
    });
  });

  it("does not overmatch a partial compound topic", () => {
    expect(resolveAuthoritativeDocsTopicMatch("Explain the Casimir effect generally.")).toBeNull();
  });

  it("assigns independent retrieval authority to canonical and superseded NHM2 papers", () => {
    expect(resolveDocsRetrievalAuthority(
      "docs/research/nhm2-current-status-whitepaper.md",
    )).toEqual({
      retrieval_status: "primary",
      topic_id: "nhm2",
      authority_rank: 100,
    });
    expect(resolveDocsRetrievalAuthority(
      "docs/research/nhm2-current-status-whitepaper-2026-04-03.md",
    )).toEqual({
      retrieval_status: "archive",
      topic_id: "nhm2",
      authority_rank: 10,
      superseded_by: "docs/research/nhm2-current-status-whitepaper.md",
    });
  });

  it("suppresses archival generations from default retrieval without deleting them", () => {
    const result = applyDocsRetrievalAuthority({
      hits: [
        hit(
          "docs/research/nhm2-current-status-whitepaper.md",
          "The maintained NHM2 status and claim boundary.",
        ),
        hit(
          "docs/research/nhm2-current-status-memo-2026-04-03.md",
          "An earlier NHM2 development status generation.",
        ),
        hit(
          "docs/audits/research/needle-hull-mark2/needle-hull-mark2-compact-note-2026-03-22.md",
          "Historical compact note for Needle Hull Mark 2.",
        ),
      ],
      query: "What is the current NHM2 research position?",
      searchPaths: ["docs"],
    });

    expect(result.admitted_hits.map((entry) => entry.filePath)).toEqual([
      "docs/research/nhm2-current-status-whitepaper.md",
    ]);
    expect(result.suppressed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "docs/research/nhm2-current-status-memo-2026-04-03.md",
        retrieval_status: "archive",
        reason: "archive_not_requested",
        superseded_by: "docs/research/nhm2-current-status-whitepaper.md",
      }),
      expect.objectContaining({
        path: "docs/audits/research/needle-hull-mark2/needle-hull-mark2-compact-note-2026-03-22.md",
        retrieval_status: "archive",
        reason: "archive_not_requested",
      }),
    ]));
  });

  it("admits an exact archived title without widening the whole search", () => {
    const result = applyDocsRetrievalAuthority({
      hits: [
        hit(
          "docs/research/nhm2-current-status-whitepaper-2026-04-03.md",
          "Dated NHM2 whitepaper text.",
        ),
        hit(
          "docs/research/nhm2-current-status-memo-2026-04-03.md",
          "Separate dated memo text.",
        ),
      ],
      query: "Find the NHM2 current status whitepaper 2026 04 03",
      searchPaths: ["docs/research"],
    });

    expect(result.admitted_hits.map((entry) => entry.filePath)).toEqual([
      "docs/research/nhm2-current-status-whitepaper-2026-04-03.md",
    ]);
    expect(result.suppressed).toEqual([
      expect.objectContaining({
        path: "docs/research/nhm2-current-status-memo-2026-04-03.md",
        reason: "archive_not_requested",
      }),
    ]);
  });

  it("admits an exact dated archive title when natural wording inserts 'dated'", () => {
    const result = applyDocsRetrievalAuthority({
      hits: [
        hit(
          "docs/research/nhm2-current-status-whitepaper-2026-04-03.md",
          "Dated NHM2 whitepaper text.",
        ),
      ],
      query: "NHM2 current status whitepaper dated 2026-04-03",
      searchPaths: ["docs"],
    });

    expect(result.admitted_hits).toHaveLength(1);
    expect(result.suppressed).toEqual([]);
  });

  it("allows an explicit archive scope for historical comparisons", () => {
    const result = applyDocsRetrievalAuthority({
      hits: [
        hit("docs/research/nhm2-current-status-whitepaper.md", "Current paper."),
        hit("docs/research/nhm2-current-status-memo-2026-04-03.md", "Historical memo."),
      ],
      query: "Compare the historical NHM2 versions",
      searchPaths: ["docs/research"],
      scope: "include_archive",
    });

    expect(result.admitted_document_count).toBe(2);
    expect(result.suppressed).toEqual([]);
  });

  it("ranks a numeric mechanics example for a natural number-word goal", () => {
    const query = "Can you make me glow for ten seconds in the connected Minecraft world?";
    const terms = buildDocsSearchTerms(query);
    const ranked = rankDocsSearchHits(
      [
        {
          filePath: "docs/game-mechanics/minecraft-command-playbook-v1.md",
          line: 52,
          text: "World operator and Server administrator modes can intentionally target",
          term: "world",
        },
        {
          filePath: "docs/game-mechanics/minecraft-command-playbook-v1.md",
          line: 78,
          text: "- temporary bound-player effect: `effect give @s minecraft:glowing 10 0 true`;",
          term: "10",
        },
        {
          filePath: "docs/game-mechanics/minecraft-command-playbook-v1.md",
          line: 86,
          text: "- bound-player title: `title @s title {\"text\":\"Helix is connected\"}`;",
          term: "connected",
        },
      ],
      query,
    );

    expect(terms).toContain("10");
    expect(ranked[0]).toMatchObject({ line: 78, term: "10" });
  });

  it("infers taxonomy classes from folder rules when no explicit document entry exists", () => {
    const candidates = buildDocsSearchDocumentCandidates(
      [
        hit(
          "docs/audits/research/ownership-maturity-utility-deep-research-2026-02-25.md",
          "Generated deep research packet for ownership maturity.",
          "research",
        ),
        hit(
          "docs/specs/warp-promotion-readiness-suite-contract-v1.md",
          "Specification contract for promotion readiness.",
          "contract",
        ),
        hit(
          "docs/audits/toe-sequence-forest-lane-closure-2026-02-19.md",
          "Historical audit trail for a superseded sequence lane.",
          "audit",
        ),
      ],
      "research contract audit",
      8,
    );

    expect(candidates.find((candidate) => candidate.path.startsWith("docs/audits/research/"))).toMatchObject({
      doc_class: "synthetic-research",
    });
    expect(candidates.find((candidate) => candidate.path.startsWith("docs/specs/"))).toMatchObject({
      doc_class: "current-development",
    });
    expect(candidates.find((candidate) => candidate.path === "docs/audits/toe-sequence-forest-lane-closure-2026-02-19.md")).toMatchObject({
      doc_class: "legacy-development",
    });
  });

  it("keeps explicit canonical whitepaper sidecar metadata above folder defaults", () => {
    const candidates = buildDocsSearchDocumentCandidates(
      [
        hit(
          "docs/research/nhm2-current-status-whitepaper.md",
          "NHM2 current status whitepaper.",
          "whitepaper",
        ),
      ],
      "NHM2 whitepaper",
      1,
    );

    expect(candidates[0]).toMatchObject({
      path: "docs/research/nhm2-current-status-whitepaper.md",
      doc_class: "canonical-research",
      bundle_kind: "equation-action-whitepaper",
      canonical: true,
      retrieval_status: "primary",
      retrieval_admission_reason: "default_primary",
      topic_id: "nhm2",
      authority_rank: 100,
      tool_hints: {
        calculatorReady: true,
      },
    });
    expect(candidates[0]?.sidecars).toEqual([
      "docs/research/nhm2-current-status-whitepaper.equation-actions.json",
      "docs/research/nhm2-current-status-whitepaper.equation-actions.source.json",
    ]);
  });

  it("materializes query-focused passages with stable line citations from a matched document", () => {
    const candidates = buildDocsSearchDocumentCandidates(
      [
        hit(
          "docs/research/nhm2-current-status-whitepaper.md",
          "NHM2 current status whitepaper.",
          "nhm2",
        ),
      ],
      "What is the main idea of the NHM2 current status whitepaper?",
      1,
    );

    const passages = buildDocsEvidencePassages(
      candidates,
      "What is the main idea of the NHM2 current status whitepaper?",
      4,
    );

    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]).toMatchObject({
      path: "docs/research/nhm2-current-status-whitepaper.md",
      section: "Abstract",
    });
    expect(passages[0]?.text_excerpt).toContain("NHM2");
    expect(passages[0]?.citation_ref).toMatch(/workspace:\/\/docs\/research\/nhm2-current-status-whitepaper\.md#line=\d+-\d+/);
    expect(passages[0]?.citation_label).toMatch(/line(?:s)? \d+/);
  });
});
