import { describe, expect, it } from "vitest";
import { detectContextualToolAdmissionSuppression } from "../../contextual-tool-admission";
import { readWorkstationGatewayCallRequestsForTurn } from "../explicit-workstation-gateway";

type MatrixCase = {
  label: string;
  prompt: string;
  capabilities: string[];
};

const cases: MatrixCase[] = [
  {
    label: "PubMed supporting metadata",
    prompt: "Use https://pubmed.ncbi.nlm.nih.gov/2813384/ as supporting paper metadata.",
    capabilities: ["scholarly-research.lookup_papers"],
  },
  {
    label: "direct PDF full text",
    prompt:
      "Fetch and parse https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf as supporting evidence.",
    capabilities: ["scholarly-research.fetch_full_text"],
  },
  {
    label: "DOI lookup then dependent fetch",
    prompt:
      "Look up DOI 10.1073/pnas.86.20.8152, fetch accessible full text if available, and summarize the evidence.",
    capabilities: ["scholarly-research.lookup_papers"],
  },
  {
    label: "direct arXiv full text",
    prompt: "Fetch and parse the full text for arXiv gr-qc/9510071.",
    capabilities: ["scholarly-research.fetch_full_text"],
  },
  {
    label: "mixed supporting source portfolio",
    prompt: [
      "Treat these as supporting sources:",
      "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013",
      "https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
    ].join(" "),
    capabilities: [
      "scholarly-research.fetch_full_text",
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ],
  },
  {
    label: "fully negated scholarly URLs",
    prompt: [
      "Do not fetch, look up, open, or search any source now.",
      "These URLs are examples only: https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "and https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf.",
    ].join(" "),
    capabilities: [],
  },
  {
    label: "quoted scholarly command",
    prompt: 'Explain the quoted instruction "Look up PMID 2813384 and fetch the paper" without running it.',
    capabilities: [],
  },
  {
    label: "metadata lookup with full-text prohibition",
    prompt: "Look up PMID 2813384 and report its metadata. Do not fetch full text.",
    capabilities: ["scholarly-research.lookup_papers"],
  },
  {
    label: "affirmative repo search",
    prompt: "Search the repo for scholarly-research-intent.ts.",
    capabilities: ["repo.search"],
  },
  {
    label: "negated repo search",
    prompt:
      "Do not search the repo for scholarly-research-intent.ts; explain where such logic would normally live.",
    capabilities: [],
  },
  {
    label: "repo plus exact PubMed metadata",
    prompt: [
      "Search the repo for scholarly-research-intent.ts and use",
      "https://pubmed.ncbi.nlm.nih.gov/2813384/ as supporting paper metadata.",
      "Do not search the general web.",
    ].join(" "),
    capabilities: ["scholarly-research.lookup_papers", "repo.search"],
  },
  {
    label: "quoted repo command",
    prompt:
      'The UI says "Search the repo for scholarly-research-intent.ts"; explain that label without running tools.',
    capabilities: [],
  },
  {
    label: "negated web search",
    prompt: "Do not search the web. Explain what current evidence would be needed.",
    capabilities: [],
  },
  {
    label: "affirmative calculator",
    prompt: "Use the scientific calculator to compute (8 * 9) + 1.",
    capabilities: ["scientific-calculator.solve_expression"],
  },
  {
    label: "quoted theory reflection",
    prompt: 'Explain the phrase "reflect this in the theory badge graph" without running it.',
    capabilities: [],
  },
  {
    label: "negated DOI example",
    prompt: "DOI 10.1073/pnas.86.20.8152 is an example identifier only. Do not look it up or fetch it.",
    capabilities: [],
  },
  {
    label: "DOI metadata only",
    prompt: "Look up DOI 10.1073/pnas.86.20.8152 metadata only; do not fetch full text.",
    capabilities: ["scholarly-research.lookup_papers"],
  },
  {
    label: "future PMID lookup",
    prompt:
      "Later, if needed, look up PMID 2813384. For now explain the evidence boundary without running tools.",
    capabilities: [],
  },
  {
    label: "historical PMID lookup",
    prompt: "Earlier I looked up PMID 2813384. Explain that prior request without running tools.",
    capabilities: [],
  },
  {
    label: "conditional PMID lookup",
    prompt: "If needed later, look up PMID 2813384; do not run tools now.",
    capabilities: [],
  },
  {
    label: "explicit current web search",
    prompt: "Search the web for current OpenAI API status and cite the sources you use.",
    capabilities: ["internet-search.search_web"],
  },
  {
    label: "scholarly URL with query state",
    prompt:
      "Use https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013;jsessionid=synthetic-session-id as a supporting scholarly source.",
    capabilities: ["scholarly-research.fetch_full_text"],
  },
  {
    label: "runtime-owned theory reflection fallback",
    prompt: "Reflect the superconductivity discussion in the theory badge graph.",
    capabilities: [],
  },
  {
    label: "theory context plus affirmative calculator",
    prompt: "Reflect the critical-surface relation in the theory badge graph and calculate (8 * 9) + 1.",
    capabilities: ["scientific-calculator.solve_expression"],
  },
  {
    label: "explicit web and scholarly evidence families",
    prompt:
      "Search the web for current reporting and look up PMID 2813384 as scholarly metadata; cite each evidence family separately.",
    capabilities: ["scholarly-research.lookup_papers", "internet-search.search_web"],
  },
  {
    label: "screen-visible scholarly command",
    prompt: 'The screen says "Fetch arXiv gr-qc/9510071". Explain the displayed text without running tools.',
    capabilities: [],
  },
];

describe("tool enactment adversarial matrix", () => {
  it("classifies a quoted PMID request as scholarly context", () => {
    expect(detectContextualToolAdmissionSuppression(
      'Explain the quoted instruction "Look up PMID 2813384 and fetch the paper" without running it.',
    )).toMatchObject({
      suppression_reason: "quoted_tool_command",
      verb_or_cue: "scholarly-research.lookup_papers",
    });
  });

  it.each(cases)("admits only intended tools: $label", ({ label, prompt, capabilities }) => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: prompt,
      },
    });

    expect(requests.map((request) => request.capability_id)).toEqual(capabilities);
  });

  it("preserves the DOI lookup-to-fetch dependency", () => {
    const [request] = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Look up DOI 10.1073/pnas.86.20.8152, fetch accessible full text if available, and summarize the evidence.",
      },
    });

    expect(request).toMatchObject({
      capability_id: "scholarly-research.lookup_papers",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        query: "DOI:10.1073/pnas.86.20.8152",
        allow_scholarly_dependent_chain: true,
      },
    });
  });

  it("does not parse scholarly URL state as calculator input", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013;jsessionid=synthetic-session-id as a supporting scholarly source.",
      },
    });

    expect(requests.map((request) => request.capability_id)).not.toContain(
      "scientific-calculator.solve_expression",
    );
  });
});
