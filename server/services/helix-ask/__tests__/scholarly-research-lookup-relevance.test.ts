import { describe, expect, it } from "vitest";
import {
  runScholarlyResearchLookup,
  type ScholarlyFetch,
} from "../retrieval/scholarly-research-lookup";

describe("scholarly research lookup relevance", () => {
  it("resolves an exact PMID through PubMed without applying broad-topic relevance rejection", async () => {
    const fetchImpl: ScholarlyFetch = async (url) => {
      expect(url).toContain("db=pubmed&id=2813384");
      return {
        ok: true,
        status: 200,
        text: async () => [
          "<?xml version=\"1.0\"?>",
          "<PubmedArticleSet><PubmedArticle>",
          "<MedlineCitation><PMID Version=\"1\">2813384</PMID><Article>",
          "<Journal><JournalIssue><PubDate><Year>1989</Year></PubDate></JournalIssue><Title>Proceedings of the National Academy of Sciences</Title></Journal>",
          "<ArticleTitle>Hypothesis: microtubules, a key to Alzheimer disease</ArticleTitle>",
          "<Abstract><AbstractText>Microtubule impairment is proposed as a mechanism in Alzheimer disease.</AbstractText></Abstract>",
          "<AuthorList><Author><LastName>Matsuyama</LastName><ForeName>H</ForeName></Author></AuthorList>",
          "</Article></MedlineCitation>",
          "<PubmedData><ArticleIdList>",
          "<ArticleId IdType=\"pubmed\">2813384</ArticleId>",
          "<ArticleId IdType=\"doi\">10.1073/pnas.86.20.8152</ArticleId>",
          "<ArticleId IdType=\"pmc\">PMC298233</ArticleId>",
          "</ArticleIdList></PubmedData>",
          "</PubmedArticle></PubmedArticleSet>",
        ].join(""),
      };
    };

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:pubmed-exact-pmid",
      callId: "call:pubmed-exact-pmid",
      query: "PMID:2813384",
      providers: ["pubmed"],
      limit: 3,
      fetchImpl,
    });

    expect(observation).toMatchObject({
      evidence_state: "lookup_usable",
      selected_for_answer: true,
      providers_called: ["pubmed"],
      papers: [{
        title: "Hypothesis: microtubules, a key to Alzheimer disease",
        identifiers: {
          pmid: "2813384",
          pmcid: "PMC298233",
          doi: "10.1073/pnas.86.20.8152",
        },
      }],
      lookup_relevance_gate: {
        status: "satisfied",
        candidate_evaluations: [expect.objectContaining({
          supported: true,
          reason: "exact_identifier_match",
        })],
      },
    });
  });

  it("admits a claim-relevant paper across inflections without treating retry modifiers as topic terms", async () => {
    const fetchImpl: ScholarlyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            paperId: "qi-negative-energy",
            title: "Quantum Inequalities and Negative Energy",
            abstract:
              "We derive bounds for sampling functions along timelike worldlines and examine the duration of sampled energy densities.",
            authors: [{ name: "A. Researcher" }],
            year: 2000,
            externalIds: { ArXiv: "gr-qc/0000001" },
            isOpenAccess: true,
            openAccessPdf: { url: "https://arxiv.org/pdf/gr-qc/0000001.pdf" },
          },
        ],
      }),
    });

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:quantum-inequality-relevance",
      callId: "call:quantum-inequality-relevance",
      query:
        "Worldline quantum inequalities bound sampled time-averaged negative energy and depend on sampling functions and duration review arxiv",
      providers: ["semantic_scholar"],
      limit: 5,
      fetchImpl,
    });

    expect(observation.evidence_state).toBe("lookup_usable");
    expect(observation.selected_for_answer).toBe(true);
    expect(observation.papers[0]?.title).toBe("Quantum Inequalities and Negative Energy");
    expect(observation.lookup_relevance_gate).toMatchObject({
      status: "satisfied",
      required_any: expect.arrayContaining(["worldline", "quantum", "inequality", "sampl", "duration"]),
      candidate_evaluations: [
        expect.objectContaining({
          supported: true,
          reason: "bounded_topic_overlap_satisfied",
          matched_tokens: expect.arrayContaining(["worldline", "quantum", "inequality", "sampl", "duration"]),
        }),
      ],
    });
    expect(observation.lookup_relevance_gate?.required_any).not.toEqual(
      expect.arrayContaining(["review", "arxiv"]),
    );
  });

  it("continues to reject an unrelated runtime-verification paper", async () => {
    const fetchImpl: ScholarlyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            paperId: "runtime-verification",
            title: "Runtime Safety Verification of Neural Network Controlled Systems",
            abstract:
              "Reachability analysis supervises a neural controller over time and models energy, field state, and duration near unsafe regions.",
            authors: [{ name: "B. Engineer" }],
            year: 2024,
            externalIds: { ArXiv: "2408.08592" },
          },
        ],
      }),
    });

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:quantum-inequality-off-topic",
      callId: "call:quantum-inequality-off-topic",
      query: "quantum inequalities sampled negative energy duration worldline field state time",
      providers: ["semantic_scholar"],
      limit: 5,
      fetchImpl,
    });

    expect(observation.evidence_state).toBe("lookup_weak_match");
    expect(observation.selected_for_answer).toBe(false);
    expect(observation).toMatchObject({
      semantic_relevance_authority: "runtime_agent",
      deterministic_lookup_relevance_role: "advisory_only",
      runtime_agent_semantic_selection_required: true,
    });
    expect(observation.lookup_relevance_gate).toMatchObject({
      semantic_relevance_authority: "runtime_agent",
      deterministic_lookup_relevance_role: "advisory_only",
      runtime_agent_semantic_selection_required: true,
    });
    expect(observation.scholarly_lookup_recovery_affordance).toMatchObject({
      reason: "lookup_weak_match",
      rejected_results: [
        expect.objectContaining({
          title: "Runtime Safety Verification of Neural Network Controlled Systems",
          reason: "missing_primary_topic_anchor",
          matched_tokens: expect.arrayContaining(["time", "energy", "field", "state", "duration"]),
          matched_anchor_tokens: ["duration"],
        }),
      ],
    });
  });

  it("does not treat conversational request wording as scholarly topic evidence", async () => {
    const fetchImpl: ScholarlyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            paperId: "unrelated-drugs-title",
            title: "Don't Give Me Drugs",
            abstract: "A discussion unrelated to compact stars or magnetic fields.",
            authors: [{ name: "C. Author" }],
            year: 2019,
          },
        ],
      }),
    });

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:natural-magnetar-request-relevance",
      callId: "call:natural-magnetar-request-relevance",
      query: "give me a good primary about magnetars that we can work with",
      providers: ["semantic_scholar"],
      limit: 5,
      fetchImpl,
    });

    expect(observation.evidence_state).toBe("lookup_weak_match");
    expect(observation.selected_for_answer).toBe(false);
    expect(observation.lookup_relevance_gate?.required_any).toContain("magnetar");
    expect(observation.lookup_relevance_gate?.required_any).not.toEqual(
      expect.arrayContaining(["give", "me", "good", "about", "we"]),
    );
    expect(observation.lookup_relevance_gate?.candidate_evaluations).toEqual([
      expect.objectContaining({
        supported: false,
        matched_tokens: [],
      }),
    ]);
    expect(observation.next_affordances.length).toBeGreaterThan(0);
  });

  it("keeps generic recovery queries bounded instead of compounding retry modifiers", async () => {
    const fetchImpl: ScholarlyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:bounded-magnetar-recovery",
      callId: "call:bounded-magnetar-recovery",
      query: "magnetar primary research review arxiv",
      providers: ["semantic_scholar"],
      limit: 5,
      fetchImpl,
    });

    const recoveryQueries = observation.next_affordances
      .map((affordance) => affordance.query)
      .filter((query): query is string => Boolean(query));
    expect(recoveryQueries.length).toBeLessThanOrEqual(3);
    expect(recoveryQueries).toEqual(expect.arrayContaining([
      "magnetar primary",
      "magnetar primary review",
      "magnetar primary arxiv",
    ]));
    expect(recoveryQueries.join(" ")).not.toMatch(/review\s+review|arxiv\s+arxiv|review\s+arxiv\s+(?:review|arxiv)/i);
  });

  it("rejects generic quantum-inequality constraint matches without the negative-energy anchor", async () => {
    const fetchImpl: ScholarlyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            paperId: "qubo-inequalities",
            title: "Encoding Inequality Constraints for Quantum Optimization",
            abstract: "We transform inequality constraints into QUBO penalty functions for quantum annealing.",
            authors: [{ name: "A. Optimizer" }],
            year: 2022,
            externalIds: { ArXiv: "2211.13914" },
            isOpenAccess: true,
            openAccessPdf: { url: "https://arxiv.org/pdf/2211.13914.pdf" },
          },
          {
            paperId: "negative-energy-qei",
            title: "Quantum Inequalities and Negative Energy",
            abstract: "Timelike sampling bounds constrain the magnitude and duration of negative energy density.",
            authors: [{ name: "B. Relativist" }],
            year: 1999,
            externalIds: { ArXiv: "gr-qc/9900001" },
            isOpenAccess: true,
            openAccessPdf: { url: "https://arxiv.org/pdf/gr-qc/9900001.pdf" },
          },
        ],
      }),
    });

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:negative-energy-domain-anchor",
      callId: "call:negative-energy-domain-anchor",
      query: "quantum-inequality constraints on negative energy",
      providers: ["semantic_scholar"],
      limit: 5,
      fetchImpl,
    });

    expect(observation.evidence_state).toBe("lookup_usable");
    expect(observation.papers.map((paper) => paper.title)).toEqual([
      "Quantum Inequalities and Negative Energy",
    ]);
    expect(observation.lookup_relevance_gate?.candidate_evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          result_id: expect.stringContaining("semantic_scholar:"),
          supported: false,
          reason: "missing_primary_topic_anchor",
          anchor_tokens: ["negative"],
          matched_anchor_tokens: [],
        }),
      ]),
    );
  });

  it("builds an arXiv field query from bounded topic terms instead of one encoded prose value", async () => {
    let observedSearchQuery = "";
    const fetchImpl: ScholarlyFetch = async (url) => {
      observedSearchQuery = new URL(url).searchParams.get("search_query") ?? "";
      return {
        ok: true,
        status: 200,
        text: async () => "<?xml version=\"1.0\"?><feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>",
      };
    };

    await runScholarlyResearchLookup({
      turnId: "ask:arxiv-topic-query",
      callId: "call:arxiv-topic-query",
      query:
        "Find scholarly references supporting worldline quantum inequalities negative energy duration",
      providers: ["arxiv"],
      limit: 5,
      fetchImpl,
    });

    expect(observedSearchQuery).toBe(
      "all:worldline AND all:negative AND all:duration AND all:quantum AND all:inequalities",
    );
  });
});
