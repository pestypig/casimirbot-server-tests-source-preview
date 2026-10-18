import { describe, expect, it } from "vitest";
import {
  buildActiveDocsContextWorkstationGatewayCallRequests,
  buildExplicitProviderGatewayCallInput,
  buildPlannerDerivedWorkstationGatewayCallRequests,
  buildPromptNamedCapabilityGatewayCallRequests,
  buildStructuredAdmissionWorkstationGatewayCallRequests,
  buildPromptDerivedRepoSearchGatewayCallRequests,
  buildPromptDerivedVoiceGatewayCallRequests,
  buildPromptDerivedWorkspaceStatusGatewayCallRequests,
  readWorkstationGatewayCallRequestsForTurn,
  resolveExplicitGatewayConversationThreadId,
  runExplicitWorkstationGatewayCalls,
  selectScholarlyPortfolioDependencySeedResult,
  shouldAutoExecuteDependentCompoundRequest,
} from "../explicit-workstation-gateway";
import {
  buildCompoundCapabilityDependencyGatewayCallRequests,
  buildCompoundDependencyRailStatus,
  buildDependentCompoundCapabilityGatewayCallRequest,
  buildTurnCompoundDependencyPlan,
} from "../provider-compound-capability-planner";
import { PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS } from "../../provider-agent-capability-contract";
import type { HelixAgentProvider } from "../types";
import { runHelixCapabilityLaneOneShotRequests } from "../../capability-lanes/one-shot-runner";
import { resetInterimVoiceCalloutsForTest } from "../../interim-voice-callout-store";
import { runtimeMemoryGovernor } from "../../../runtime/runtime-memory-governor";
import { ensureCodexPreGatewayRouteAuthority } from "../codex-provider";
import { hasExplicitScholarlyProviderRecordAuditIntent } from "../prompt-named-tool-requests";
import { buildMinecraftMechanicsDocsWorkstationGatewayCallRequests } from "../active-context-tool-requests";
import { buildCommittedAskRoute } from "../../committed-ask-route";

const docSnapshot = {
  activePanel: "scientific-calculator",
  activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
};

const capabilities = (requests: Record<string, unknown>[]): string[] =>
  requests.map((request) => String(request.capability_id));

describe("explicit gateway conversation identity", () => {
  it("uses the Ask API sessionId as the trusted conversation thread", () => {
    expect(
      resolveExplicitGatewayConversationThreadId({
        thread_id: "ask:test:current-turn",
        sessionId: "helix-ask:test:camel-session",
      }),
    ).toBe("helix-ask:test:camel-session");
  });

  it("prefers the admitted source thread over conflicting envelope aliases", () => {
    expect(
      resolveExplicitGatewayConversationThreadId({
        thread_id: "ask:test:current-turn",
        sessionId: "helix-ask:test:stale-session",
        source_target_intent: {
          thread_id: "helix-ask:test:admitted-source",
        },
      }),
    ).toBe("helix-ask:test:admitted-source");
  });
});

const buildTestProvider = (id: "helix" | "codex"): HelixAgentProvider => ({
  id,
  label: id === "helix" ? "Helix Ask Native" : "Codex Workstation Mode",
  permissionProfile: {
    id: id === "helix" ? "helix-native" : "read-observe-act",
    label: "Read/observe plus non-mutating workstation action",
    allows: {
      observe: true,
      read: true,
      act: true,
      write: false,
      shell: false,
      codeMutation: false,
    },
  },
  enabled: () => true,
  supports: {
    streaming: id === "helix",
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: id,
    response_type: "test",
    final_status: "test",
  }),
});

describe("explicit workstation gateway derived calls", () => {
  it("forwards an exact runtime receipt in the provider control envelope", () => {
    const accountContext = {
      session_id: "session:runtime-receipt",
      profile_id: "profile:runtime-receipt",
      account_policy: {
        account_type: "developer",
      },
    } as any;
    const snakeReceipt = {
      schema: "helix.runtime_tool_confirmation_receipt/v1",
      receiptId: "receipt:formal",
    };
    const camelReceipt = {
      schema: "helix.runtime_tool_confirmation_receipt/v1",
      receiptId: "receipt:numerical",
    };

    const formal = buildExplicitProviderGatewayCallInput({
      request: {
        capability_id: "theory-formal-verifier.start",
        mode: "act",
        arguments: {
          prepared_request_id: "prepared:formal",
          plan_id: "plan:formal",
        },
        approval_receipt: snakeReceipt,
      },
      accountContext,
      agentRuntime: "codex",
      turnId: "turn:formal",
      iteration: 1,
    });
    const numerical = buildExplicitProviderGatewayCallInput({
      request: {
        capabilityId: "theory-independent-numerical-verifier.start",
        mode: "act",
        args: {
          plan_id: "plan:numerical",
        },
        approvalReceipt: camelReceipt,
      },
      accountContext,
      agentRuntime: "codex",
      turnId: "turn:numerical",
      iteration: 2,
    });
    const legacy = buildExplicitProviderGatewayCallInput({
      request: {
        capability_id: "theory-formal-verifier.start",
        mode: "act",
        arguments: {
          prepared_request_id: "prepared:legacy",
          plan_id: "plan:legacy",
        },
        approval_token: "legacy-confirmation",
      },
      accountContext,
      agentRuntime: "codex",
      turnId: "turn:legacy",
      iteration: 3,
    });

    expect(formal).toMatchObject({
      accountContext,
      capabilityId: "theory-formal-verifier.start",
      approvalReceipt: snakeReceipt,
      turnId: "turn:formal",
    });
    expect(formal.approvalToken).toBeNull();
    expect(formal.approvalReceipt).toBe(snakeReceipt);
    expect(numerical).toMatchObject({
      accountContext,
      capabilityId: "theory-independent-numerical-verifier.start",
      approvalReceipt: camelReceipt,
      turnId: "turn:numerical",
    });
    expect(numerical.approvalToken).toBeNull();
    expect(numerical.approvalReceipt).toBe(camelReceipt);
    expect(legacy).toMatchObject({
      approvalReceipt: undefined,
      approvalToken: "legacy-confirmation",
    });
    expect(formal.arguments).not.toHaveProperty("approval_receipt");
    expect(numerical.arguments).not.toHaveProperty("approvalReceipt");
  });

  it("deduplicates repeated explicit scholarly lookup requests before dispatch", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use scholarly-research.lookup_papers for quantum inequality sampling constraints.",
        workstation_gateway_calls: [
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "quantum inequality sampling constraints",
              limit: 3,
            },
          },
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "quantum inequality sampling constraints",
              limit: 3,
            },
          },
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "quantum inequality sampling constraints",
              limit: 3,
            },
          },
        ],
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
  });

  it("preserves distinct scholarly claim queries while deduplicating exact repeats", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Search the four claims separately and fetch the best three accessible sources.",
        workstation_gateway_calls: [
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "worldline quantum inequalities sampling functions",
              limit: 3,
            },
          },
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "negative energy magnitude duration scaling",
              limit: 3,
            },
          },
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "quantum interest positive energy overcompensation",
              limit: 3,
            },
          },
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "quantum inequalities wormholes warp drives",
              limit: 3,
            },
          },
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "worldline quantum inequalities sampling functions",
              limit: 3,
            },
          },
        ],
      },
    });

    expect(requests).toHaveLength(4);
    expect(
      requests.map(
        (request) => (request.arguments as Record<string, unknown>).query,
      ),
    ).toEqual([
      "worldline quantum inequalities sampling functions",
      "negative energy magnitude duration scaling",
      "quantum interest positive energy overcompensation",
      "quantum inequalities wormholes warp drives",
    ]);
  });

  it("carries an affirmative best-three full-text contract onto an explicit scholarly lookup portfolio", () => {
    const lookupCalls = Array.from({ length: 10 }, (_, index) => ({
      capability_id: "scholarly-research.lookup_papers",
      mode: "read",
      arguments: { query: `quantum inequality claim ${index + 1}`, limit: 3 },
    }));
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: [
          "Find scholarly references supporting the quantum-inequality claims we discussed.",
          "Search arXiv and the other scholarly providers. Build a claim-to-citation map,",
          "identify which papers have accessible full text, and fetch the best three accessible sources.",
          "Clearly distinguish metadata-only evidence from full-text evidence.",
        ].join(" "),
        workstation_gateway_calls: lookupCalls,
      },
    });

    expect(requests).toHaveLength(10);
    expect(
      requests
        .slice(0, -1)
        .every((request) => request.compound_outcome === undefined),
    ).toBe(true);
    expect(requests.at(-1)).toMatchObject({
      capability_id: "scholarly-research.lookup_papers",
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        query: "quantum inequality claim 10",
        allow_scholarly_dependent_chain: true,
        requested_full_text_count: 3,
        scholarly_claim_portfolio: true,
        source_target_intent: {
          compound_outcome: "scholarly_research_workflow",
          claim_portfolio_closer: true,
        },
      },
    });
  });

  it("keeps the best-three full-text chain when the prompt also specifies conditional retry behavior", () => {
    const promptText = [
      "Find three unique, directly relevant primary papers supporting quantum-inequality constraints on negative energy, traversable wormholes, or warp drives.",
      "Search the scholarly providers, deduplicate papers across DOI, arXiv, title, and provider records, and fetch full text for three unique sources.",
      "If a fetch fails or duplicates an existing paper, continue searching.",
      "Build a claim-to-citation map using page- or equation-level support from fetched text.",
    ].join(" ");
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: promptText,
        workstation_gateway_calls: [
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "quantum inequalities wormholes warp drives",
              limit: 6,
            },
          },
        ],
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      capability_id: "scholarly-research.lookup_papers",
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        query: "quantum inequalities wormholes warp drives",
        allow_scholarly_dependent_chain: true,
        requested_full_text_count: 3,
      },
    });
  });

  it("keeps citation-level equation support in the automatic scholarly full-text workflow", () => {
    const promptText = [
      "Find three unique, directly relevant primary papers supporting quantum-inequality constraints on negative energy, traversable wormholes, or warp drives.",
      "Search the scholarly providers, deduplicate papers across DOI, arXiv, title, and provider records, and fetch full text for three unique sources.",
      "If a fetch fails or duplicates an existing paper, continue searching.",
      "Build a claim-to-citation map using page- or equation-level support from fetched text.",
      "Clearly distinguish full-text evidence from metadata-only evidence, and do not count duplicate provider records as separate sources.",
    ].join(" ");
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: promptText,
      },
    });

    expect(requests).toHaveLength(3);
    expect(requests.map((request) => (request.arguments as any).query)).toEqual(
      [
        "quantum-inequality constraints on negative energy",
        "quantum-inequality constraints on traversable wormholes",
        "quantum-inequality constraints on warp drives",
      ],
    );
    expect(
      requests
        .slice(0, -1)
        .every((request) => request.compound_outcome === undefined),
    ).toBe(true);
    expect(requests.at(-1)).toMatchObject({
      capability_id: "scholarly-research.lookup_papers",
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        query: "quantum-inequality constraints on warp drives",
        allow_scholarly_dependent_chain: true,
        requested_full_text_count: 3,
        scholarly_claim_portfolio: true,
        source_target_intent: {
          query_derivation: "direct_multi_topic_scholarly_portfolio",
          claim_index: 2,
          claim_count: 3,
          claim_portfolio_closer: true,
        },
      },
    });
  });

  it("routes an exact-source provider-record audit through lookup before its dependent full-text fetch", () => {
    const promptText = [
      "Search scholarly providers for Quantum Field Theory Constrains Traversable Wormhole Geometries by Ford and Roman,",
      "DOI 10.1103/PhysRevD.53.5496, arXiv gr-qc/9510071.",
      "Deduplicate all provider records using DOI, arXiv ID, and normalized title.",
      "Fetch and parse full text for the exact paper once.",
      "Report provider-record count, unique-paper count, matched identities, PDF total and parsed pages.",
      "Do not count duplicate provider records as separate papers and do not search for unrelated papers.",
    ].join(" ");

    expect(
      capabilities(
        buildPromptNamedCapabilityGatewayCallRequests({ question: promptText }),
      ),
    ).not.toContain("scholarly-research.fetch_full_text");

    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: promptText,
      },
    });

    const scholarlyRequests = requests.filter((request) =>
      String(request.capability_id).startsWith("scholarly-research."),
    );
    expect(capabilities(scholarlyRequests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(scholarlyRequests[0]).toMatchObject({
      capability_id: "scholarly-research.lookup_papers",
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        allow_scholarly_dependent_chain: true,
        requested_full_text_count: 1,
        source_target_intent: {
          doi: "10.1103/physrevd.53.5496",
          arxiv_id: "gr-qc/9510071",
          full_text_requested: true,
        },
      },
    });
  });

  it("keeps an exact direct full-text request direct when provider lookup is not requested", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: [
          "Fetch and parse the full text for arXiv gr-qc/9510071.",
          "Return the paper title, parsed page count, and one page-numbered passage.",
          "Do not search for other papers.",
        ].join(" "),
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
  });

  it("routes DOI full-text requests through metadata resolution before dependent fetch", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: [
          "Look up DOI 10.1073/pnas.86.20.8152, fetch accessible full text if available,",
          "and summarize only what the fetched evidence supports about microtubules.",
          "Do not search the repo or the general web.",
        ].join(" "),
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(requests[0]).toMatchObject({
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        mode: "doi_lookup",
        allow_scholarly_dependent_chain: true,
        source_target_intent: {
          planned_scholarly_capability_chain: {
            planned_capabilities: [
              "scholarly-research.lookup_papers",
              "scholarly-research.fetch_full_text",
            ],
            requested_workflow: "full_text_summary",
          },
        },
      },
    });
  });

  it("keeps an explicit supporting-source portfolio exact and does not parse URL state as calculator math", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: [
          "Evaluate the hypothesis rather than merely reporting retrieval status: a multiscale holographic self might preserve coarse information without making every process a subject.",
          "Treat these as supporting sources, continue reasoning if one is unavailable, and keep evidence boundaries explicit.",
          "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013;jsessionid=synthetic-session-id",
          "https://pubmed.ncbi.nlm.nih.gov/2813384/",
          "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
          "Do not search the repo.",
        ].join(" "),
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.fetch_full_text",
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ]);
    expect(
      requests.map(
        (request) =>
          (request.arguments as Record<string, any>).source_target_intent
            .source_portfolio_index,
      ),
    ).toEqual([0, 1, 2]);
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
  });

  it("does not execute tools for fully negated scholarly URL examples", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: [
          "Do not fetch, look up, open, or search any source now.",
          "These URLs are examples only: https://pubmed.ncbi.nlm.nih.gov/2813384/",
          "and https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf.",
          "Explain what evidence would be needed without claiming those papers were inspected.",
        ].join(" "),
      },
    });

    expect(requests).toEqual([]);
  });

  it("does not infer a provider-record audit from an explicitly negated provider-search clause", () => {
    expect(
      hasExplicitScholarlyProviderRecordAuditIntent(
        [
          "Do not search scholarly providers or collect provider records.",
          "Fetch and parse the full text for arXiv gr-qc/9510071 only.",
        ].join(" "),
      ),
    ).toBe(false);
  });

  it.each([
    [
      "quoted",
      'Explain the instruction "Search scholarly providers and report provider-record count."',
    ],
    [
      "historical",
      "Earlier I searched scholarly providers and reported the provider-record count.",
    ],
    [
      "future",
      "Later, search scholarly providers and report the provider-record count.",
    ],
    [
      "conditional",
      "If needed, search scholarly providers and report the provider-record count.",
    ],
    [
      "screen-visible",
      "The screen says Search scholarly providers and report the provider-record count.",
    ],
  ])(
    "does not infer a provider-record audit from %s text",
    (_label, promptText) => {
      expect(hasExplicitScholarlyProviderRecordAuditIntent(promptText)).toBe(
        false,
      );
    },
  );

  it("preserves a current provider-record audit beside historical and negative constraints", () => {
    expect(
      hasExplicitScholarlyProviderRecordAuditIntent(
        [
          "Earlier I fetched this arXiv paper directly.",
          "Now search scholarly providers for DOI 10.1103/PhysRevD.53.5496.",
          "Report provider-record count and unique-paper count.",
          "Do not count duplicate provider records as separate papers.",
        ].join(" "),
      ),
    ).toBe(true);
  });

  it("does not infer a full-text chain for negated explicit scholarly lookup calls", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Search scholarly metadata for quantum inequalities, but do not fetch, open, or parse full text.",
        workstation_gateway_calls: [
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: { query: "quantum inequalities" },
          },
        ],
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("compound_outcome");
    expect(requests[0]).not.toHaveProperty("dependent_capability_id");
    expect(requests[0].arguments).not.toHaveProperty(
      "allow_scholarly_dependent_chain",
    );
  });

  it("executes metadata lookup when only downstream full-text work is negated", () => {
    const promptText = [
      "LOOKUP_SMOKE_03 — Search arXiv for “Quantum Field Theory Constrains Traversable Wormhole Geometries” by Ford and Roman.",
      "Use scholarly lookup only and return the title, authors, DOI, and arXiv ID.",
      "Do not fetch full text or inspect PDF pages.",
    ].join(" ");
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: promptText,
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      capability_id: "scholarly-research.lookup_papers",
      mode: "read",
      arguments: {
        query:
          "Quantum Field Theory Constrains Traversable Wormhole Geometries",
        mode: "paper_search",
        scholarly_intent: {
          scholarly_query:
            "Quantum Field Theory Constrains Traversable Wormhole Geometries",
          query_normalization_reasons: ["quoted_topic_selected"],
          requested_workflow: "metadata_search",
          requires_full_text: false,
          terminal_evidence_requirement: "metadata",
        },
        source_target_intent: {
          target_source: "scholarly_research",
          target_kind: "research_paper_search",
        },
      },
    });
    expect(requests[0]).not.toHaveProperty("compound_outcome");
    expect(requests[0]).not.toHaveProperty("dependent_capability_id");
    expect(requests[0].arguments).not.toHaveProperty(
      "allow_scholarly_dependent_chain",
    );
  });

  it("does not execute lookup from negated, quoted, historical, or future-only scholarly text", () => {
    const prompts = [
      "Do not search arXiv for Ford and Roman; answer from general knowledge.",
      '"Search arXiv for Ford and Roman" was the prior instruction; explain what it means.',
      "I searched arXiv for Ford and Roman earlier; summarize what that request meant.",
      "Later, if needed, search arXiv for Ford and Roman; for now answer from general knowledge.",
    ];

    for (const question of prompts) {
      expect(
        readWorkstationGatewayCallRequestsForTurn({
          includePlannerDerived: true,
          body: { agent_runtime: "codex", question },
        }),
      ).toEqual([]);
    }
  });

  it("seeds a scholarly portfolio fetch from the latest successful lookup when the closer lookup failed", () => {
    const success = {
      capability_id: "scholarly-research.lookup_papers",
      ok: true,
    } as any;
    const failedCloser = {
      capability_id: "scholarly-research.lookup_papers",
      ok: false,
    } as any;

    expect(
      selectScholarlyPortfolioDependencySeedResult(
        [success, failedCloser],
        failedCloser,
      ),
    ).toBe(success);
    expect(
      selectScholarlyPortfolioDependencySeedResult(
        [failedCloser],
        failedCloser,
      ),
    ).toBe(failedCloser);
  });

  it("keeps a quoted search identifier out of a calculator-only itinerary", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the Scientific Calculator to compute (8 * 9) + 1. The string `internet-search.search_web` is only a non-executable example. Report the numeric result only.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "scientific-calculator.solve_expression",
    ]);
    expect(requests[0]).toMatchObject({
      arguments: {
        expression: "(8*9)+1",
      },
    });
  });

  it("resolves a natural deictic calculator check from the previous answer", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: "Check that in the calculator.",
        workspace_context_snapshot: {
          chat_referent_context: {
            previous_assistant_final_answer: {
              role: "assistant",
              source_ref: "chat.final_answer.previous:calculator-result",
              text: "The factor change is 4 / 2 = 2, so the line energy doubles.",
            },
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "scientific-calculator.solve_expression",
    ]);
    expect(requests[0]).toMatchObject({
      arguments: {
        expression: "4/2",
      },
    });
  });

  it("preserves calculator constants and common operator glyphs in natural prompts", () => {
    const cases = [
      [
        "Calculate 2*pi*3 and show the result in the scientific calculator.",
        "2*pi*3",
      ],
      [
        "Calculate 2π*3 and show the result in the scientific calculator.",
        "2pi*3",
      ],
      ["Use the scientific calculator to calculate sqrt(9) + 2.", "sqrt(9)+2"],
      ["Calculate 6 ÷ 3 × 4 in the calculator.", "6/3*4"],
    ] as const;

    for (const [question, expression] of cases) {
      const requests = readWorkstationGatewayCallRequestsForTurn({
        includePlannerDerived: true,
        body: { agent_runtime: "codex", question },
      });
      expect(capabilities(requests)).toContain(
        "scientific-calculator.solve_expression",
      );
      expect(
        requests.find(
          (request) =>
            request.capability_id === "scientific-calculator.solve_expression",
        ),
      ).toMatchObject({
        arguments: { expression },
      });
    }
  });

  it("prefers the prompt-named calculator expression over a malformed structured duplicate", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Calculate 2*pi*3 and show the result in the scientific calculator.",
        source_target_intent: {
          selected_capability: "scientific-calculator.solve_expression",
          args: {
            expression: "2*",
          },
        },
      },
    });

    const calculatorRequests = requests.filter(
      (request) =>
        request.capability_id === "scientific-calculator.solve_expression",
    );
    expect(calculatorRequests).toHaveLength(1);
    expect(calculatorRequests[0]).toMatchObject({
      arguments: {
        expression: "2*pi*3",
      },
    });
  });

  it("does not execute calculator text from contextual or negated prompts with constants", () => {
    const prompts = [
      'The screen says "Calculate 2*pi*3"; explain that label without running it.',
      "Do not calculate 2*pi*3; just tell me what pi means.",
      "Later we could calculate 2*pi*3, but do not run the calculator now.",
    ];

    for (const question of prompts) {
      expect(
        readWorkstationGatewayCallRequestsForTurn({
          includePlannerDerived: true,
          body: { agent_runtime: "codex", question },
        }),
      ).toEqual([]);
    }
  });

  it("does not execute generated capabilities outside the committed route", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: "Use the Scientific Calculator to compute 8*9.",
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: "ask:route-filter",
          route: {
            source_target: "calculator_stream",
          },
          canonical_goal: {
            goal_kind: "calculator_solve",
            required_terminal_kind: "workstation_tool_evaluation",
          },
          capability_policy: {
            allowed_tool_families: [
              "scientific_calculator",
              "calculator",
              "workstation_action",
            ],
            suppressed_tool_families: [],
          },
          terminal_product: {
            allowed_terminal_artifact_kinds: ["workstation_tool_evaluation"],
            forbidden_terminal_artifact_kinds: [],
            evidence_reentry_required: true,
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "scientific-calculator.solve_expression",
    ]);
  });

  it("filters a Minecraft command negated in ordinary language while retaining Player Embodiment", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Step off the test platform using one bounded survival_tas guardian program. Do not use commands or teleportation.",
        workstation_gateway_calls: [
          {
            capability_id: "com.casimirbot.minecraft.command",
            mode: "write",
            arguments: {
              command:
                "execute as @s at @s run setblock ~ ~ ~ minecraft:water",
              category: "world_build",
              effect: "world_mutation",
            },
          },
          {
            capability_id: "com.casimirbot.minecraft.player.guardian.execute",
            mode: "write",
            arguments: {
              action_kind: "execute_reactive_program",
            },
          },
        ],
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: "ask:guardian-command-negation",
          route: { source_target: "live_environment" },
          canonical_goal: {
            goal_kind: "environment_action_workflow",
            required_terminal_kind: "model_synthesized_answer",
          },
          capability_policy: {
            allowed_tool_families: ["live_environment"],
            suppressed_tool_families: [],
          },
          terminal_product: {
            allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
            forbidden_terminal_artifact_kinds: [],
            evidence_reentry_required: true,
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "com.casimirbot.minecraft.player.guardian.execute",
    ]);
  });

  it("filters an ambient docs request out of a committed Theory-only route", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect local adaptation through the Theory Badge Graph. Do not use web or paper evidence yet.",
        workstation_gateway_call_requests: [
          {
            capability_id: "docs.search",
            mode: "read",
            arguments: { query: "nhm2 current status whitepaper" },
          },
          {
            capability_id: "theory-badge-graph.reflect_discussion_context",
            mode: "read",
            arguments: { prompt: "local adaptation" },
          },
        ],
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: "ask:theory-route-filter",
          route: { source_target: "theory_locator" },
          canonical_goal: {
            goal_kind: "theory_locator",
            required_terminal_kind: "theory_context_reflection_answer",
          },
          capability_policy: {
            allowed_tool_families: [
              "workstation_tool_gateway",
              "theory_locator",
            ],
            suppressed_tool_families: [],
          },
          terminal_product: {
            allowed_terminal_artifact_kinds: [
              "theory_context_reflection_answer",
            ],
            forbidden_terminal_artifact_kinds: [],
            evidence_reentry_required: true,
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([]);
  });

  it("commits Theory route authority before provider gateway request filtering", () => {
    const body: Record<string, unknown> = {
      agent_runtime: "codex",
      question:
        "Reflect local adaptation through the Theory Badge Graph. Do not use web or paper evidence yet.",
      tool_call_admission_decision: {
        admitted_capability: "docs.search",
        selected_capability: "docs.search",
        requested_capability: "docs.search",
        admitted_tool_families: ["docs_viewer"],
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: "ask:pre-gateway-theory-route",
        route: { source_target: "docs_viewer" },
        canonical_goal: {
          goal_kind: "docs_viewer",
          required_terminal_kind: "compound_evidence_synthesis_answer",
          allowed_terminal_artifact_kinds: [
            "compound_evidence_synthesis_answer",
          ],
          forbidden_terminal_artifact_kinds: [],
        },
        capability_policy: {
          allowed_tool_families: ["docs_viewer"],
          suppressed_tool_families: [],
          required_capability_families: ["docs_viewer"],
        },
        terminal_product: {
          allowed_terminal_artifact_kinds: [
            "compound_evidence_synthesis_answer",
          ],
          forbidden_terminal_artifact_kinds: [],
          evidence_reentry_required: true,
          required_terminal_product: "compound_evidence_synthesis_answer",
        },
      },
      capability_itinerary: {
        terminal_success_criteria: {
          compound_terminal_policy:
            "synthesize_from_satisfied_subgoal_observations",
          required_terminal_kind: "compound_evidence_synthesis_answer",
        },
        compound_capability_contract: {
          subgoals: [
            {
              capability_family: "docs_viewer",
              requested_capability: "docs.search",
            },
            {
              capability_family: "theory_locator",
              requested_capability: "helix_ask.reflect_theory_context",
            },
          ],
        },
      },
      workstation_gateway_call_requests: [
        {
          capability_id: "docs.search",
          mode: "read",
          arguments: { query: "nhm2 current status whitepaper" },
        },
        {
          capability_id: "theory-badge-graph.reflect_discussion_context",
          mode: "read",
          arguments: { prompt: "local adaptation" },
        },
      ],
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:pre-gateway-theory-route",
      selectedRoute: "/ask",
    });
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body,
    });

    expect(body.committed_ask_route).toMatchObject({
      route: { source_target: "theory_locator" },
      canonical_goal: {
        goal_kind: "theory_locator",
        required_terminal_kind: "theory_context_reflection_answer",
      },
      terminal_product: {
        required_terminal_product: "theory_context_reflection_answer",
      },
    });
    expect(capabilities(requests)).toEqual([]);
  });

  it("repairs stale generic route authority from the admitted docs.search runtime capability", () => {
    const body: Record<string, unknown> = {
      agent_runtime: "codex",
      question:
        "According to the currently open NHM2 status whitepaper, what are the three most important unresolved technical blockers? Use only the current document.",
      tool_call_admission_decision: {
        requested_capability: "docs.search",
        selected_capability: "docs.search",
        admitted_capability: "docs.search",
        admitted_tool_families: ["docs_viewer"],
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: "ask:pre-gateway-docs-route",
        route: {
          source_target: "agent_provider_gateway_turn",
          target_kind: "agent_provider_gateway_turn",
          strength: "hard",
          route_reason: "source_target_admission_trace",
        },
        canonical_goal: {
          goal_kind: "agent_provider_gateway_turn",
          required_terminal_kind: "scholarly_exploratory_candidates",
          allowed_terminal_artifact_kinds: [
            "final_answer_draft",
            "compound_evidence_synthesis_answer",
            "model_synthesized_answer",
          ],
          forbidden_terminal_artifact_kinds: [],
        },
        capability_policy: {
          allowed_tool_families: ["docs_viewer"],
          suppressed_tool_families: [],
          required_capability_families: ["docs_viewer"],
        },
        terminal_product: {
          allowed_terminal_artifact_kinds: [
            "final_answer_draft",
            "compound_evidence_synthesis_answer",
            "model_synthesized_answer",
          ],
          forbidden_terminal_artifact_kinds: [],
          evidence_reentry_required: false,
          followup_reasoning_required: false,
          required_terminal_product: "compound_evidence_synthesis_answer",
        },
      },
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:pre-gateway-docs-route",
      selectedRoute: "/ask",
    });

    expect(body.committed_ask_route).toMatchObject({
      route: {
        source_target: "docs_viewer",
        target_kind: "docs_viewer",
      },
      canonical_goal: {
        goal_kind: "docs",
        required_terminal_kind: "model_synthesized_answer",
      },
      terminal_product: {
        evidence_reentry_required: true,
        required_terminal_product: "model_synthesized_answer",
      },
    });
  });

  it("ignores a legacy Realtime transport label when deriving semantic route authority", () => {
    const body: Record<string, unknown> = {
      agent_runtime: "codex",
      question: "Okay, can you look for papers about a magnetar?",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/research/example.md",
      },
      route_metadata: {
        schema: "helix.ask.route_metadata.v1",
        source: "realtime_stage_play",
        invocationKind: "stage_play_realtime_transcript_handoff",
        sourceTarget: "operator_text",
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          source: "stage_play_realtime_handoff",
          target_source: "operator_text",
          target_kind: "realtime_transcript",
          strength: "hard",
          allow_no_tool_direct: true,
        },
      },
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:legacy-realtime-magnetar-papers",
      selectedRoute: "/ask",
    });
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body,
    });

    expect(body.source_target_intent).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(capabilities(requests)).toContain(
      "scholarly-research.lookup_papers",
    );
    expect(capabilities(requests)).not.toContain("docs.search");
    expect(body.committed_ask_route).toMatchObject({
      route: {
        source_target: "scholarly_research",
        target_kind: "scholarly_research",
      },
      terminal_product: {
        evidence_reentry_required: true,
      },
    });
  });

  it("repairs stale model-only authority for a natural selected-paper follow-up", () => {
    const body: Record<string, unknown> = {
      agent_runtime: "codex",
      question: "Let's use this one. Pull out the useful parts.",
      runtime_goal_session: {
        allowed_workstation_tools: ["scholarly-research.lookup_papers"],
      },
      workspace_context_snapshot: {
        chat_referent_context: {
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "magnetar-paper",
            source_ref: "chat.final_answer.previous:magnetar-paper",
            text: [
              "Use Thompson and Duncan (1995), The soft gamma repeaters as very strongly magnetized neutron stars - I.",
              "DOI: 10.1093/mnras/275.2.255.",
            ].join(" "),
          },
        },
      },
      source_target_intent: {
        target_source: "unknown",
        target_kind: "unknown",
        requested_outputs: ["direct_answer_text"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text"],
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "model_only",
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text"],
      },
      tool_call_admission_decision: {
        required: false,
        admitted_tool_families: ["model_only"],
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: "ask:natural-selected-paper-followup",
        route: {
          source_target: "unknown",
          target_kind: "unknown",
          route_reason: "no_explicit_source_target",
        },
        canonical_goal: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: ["direct_answer_text"],
          forbidden_terminal_artifact_kinds: [],
        },
        capability_policy: {
          allowed_tool_families: ["model_only"],
          suppressed_tool_families: [],
          required_capability_families: [],
        },
        terminal_product: {
          allowed_terminal_artifact_kinds: ["direct_answer_text"],
          forbidden_terminal_artifact_kinds: [],
          evidence_reentry_required: false,
          followup_reasoning_required: false,
          required_terminal_product: "direct_answer_text",
        },
      },
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:natural-selected-paper-followup",
      selectedRoute: "/ask",
    });

    expect(body.source_target_intent).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research_followup",
      requested_outputs: expect.arrayContaining(["scholarly_full_text"]),
      allow_no_tool_direct: false,
    });
    expect(body.route_product_contract).toMatchObject({
      source_target: "scholarly_research",
      goal_kind: "scholarly_research_followup",
      required_terminal_kind: "scholarly_research_answer",
      evidence_reentry_required: true,
      forbidden_terminal_artifact_kinds: expect.arrayContaining([
        "direct_answer_text",
      ]),
    });
    expect(body.canonical_goal_frame).toMatchObject({
      goal_kind: "scholarly_research_followup",
      required_terminal_kind: "scholarly_research_answer",
      forbidden_terminal_artifact_kinds: expect.arrayContaining([
        "direct_answer_text",
      ]),
    });
    expect(body.tool_call_admission_decision).toMatchObject({
      required: true,
      compound_requested_capabilities: expect.arrayContaining([
        "scholarly-research.lookup_papers",
        "scholarly-research.fetch_full_text",
      ]),
    });
    expect(body.runtime_goal_session).toMatchObject({
      allowed_workstation_tools: expect.arrayContaining([
        "scholarly-research.lookup_papers",
        "scholarly-research.fetch_full_text",
      ]),
    });
    expect(body.committed_ask_route).toMatchObject({
      route: { source_target: "scholarly_research" },
      canonical_goal: {
        required_terminal_kind: "scholarly_research_answer",
      },
      terminal_product: {
        evidence_reentry_required: true,
        required_terminal_product: "scholarly_research_answer",
      },
    });
  });

  it("admits affirmative interface-language preference prompts onto the account-session gateway action", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: "Set the workstation interface language to Hawaiian.",
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "account_session.set_interface_language",
        mode: "act",
        arguments: expect.objectContaining({
          language: "haw",
          source_target_intent: expect.objectContaining({
            target_source: "account_session",
            target_kind: "interface_language_preference",
            preference_key: "interfaceLanguage",
          }),
        }),
      }),
    ]);
  });

  it("admits other supported interface language names from affirmative prompts", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: "Switch the UI language to Spanish.",
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "account_session.set_interface_language",
        mode: "act",
        arguments: expect.objectContaining({
          language: "es",
        }),
      }),
    ]);
  });

  it("does not admit contextual, negated, future, or screen-visible interface language mentions", () => {
    const prompts = [
      "Do not set the workstation interface language to Hawaiian.",
      "Before I switch the UI language to Spanish, explain the setting.",
      "The screen label says set interface language to Hawaiian.",
      "In the future we might change the account language to French.",
      "What does account_session.set_interface_language mean?",
      "Use English examples while explaining the interface language setting.",
      "Use the workstation agent to verify which panel is active, tell me you're checking, then give me the verified result when it returns.",
    ];

    for (const question of prompts) {
      expect(
        readWorkstationGatewayCallRequestsForTurn({
          includePlannerDerived: true,
          body: {
            agent_runtime: "codex",
            question,
          },
        }),
      ).toEqual([]);
    }
  });

  it("routes the Live verification prompt to active context without admitting a language mutation", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the workstation agent to verify which panel is active, tell me you're checking, then give me the verified result when it returns.",
        workspace_context_snapshot: {
          activePanel: "account-session",
          openPanels: ["account-session"],
        },
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "workstation.active_context",
        mode: "read",
      }),
    ]);
  });

  it("fails closed for mutating requests carried by a read-only Realtime handoff", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: "Set the workstation interface language to Hawaiian.",
        routeMetadata: {
          source: "realtime_stage_play",
          invocationKind: "stage_play_realtime_transcript_handoff",
          forbiddenCapabilities: [
            "workstation_mutation",
            "workstation_action_execution",
          ],
          source_target_intent: {
            admitted_readonly_handoff: true,
          },
          realtimeWorkerAdmission: {
            dispatch: {
              read_only: true,
              workstation_action_execution_allowed: false,
            },
          },
        },
      },
    });

    expect(requests).toEqual([]);
  });

  it("materializes retained current-document context even when another panel is focused", () => {
    const requests = buildActiveDocsContextWorkstationGatewayCallRequests({
      question:
        "From this current document, summarize the main claim boundary.",
      workspace_context_snapshot: docSnapshot,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      capability_id: "docs.search",
      mode: "read",
      arguments: {
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        source_target_intent: expect.objectContaining({
          retained_source_context: true,
          active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        }),
      },
    });
  });

  it("materializes every hard active-document turn that requires an observation", () => {
    const question =
      "So can you tell me about the warp profile? Is it a relativistic profile? And how fast does that go, like in terms of saving time? I think we have some comparisons on days that it saves?";
    const requests = buildActiveDocsContextWorkstationGatewayCallRequests({
      question,
      source_target_intent: {
        target_source: "active_doc",
        target_kind: "active_doc",
        strength: "hard",
        must_enter_backend_ask: true,
        allow_no_tool_direct: false,
        precedence_reason: "active_workspace_source_resolution",
        active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
      },
      workspace_context_snapshot: {
        ...docSnapshot,
        chat_referent_context: {
          previous_assistant_final_answer: {
            text: "The NHM2 whitepaper audits the lapse, shift, clocking interpretation, and profile-scoped trip comparisons.",
            source_ref: "chat.final_answer:nhm2-summary",
          },
        },
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_active_doc_required_observation",
        capability_id: "docs.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: expect.stringContaining("comparisons on days"),
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          source_target_intent: expect.objectContaining({
            target_source: "active_doc",
            active_doc_required_observation: true,
            active_doc_evidence_followup: false,
            evidence_query_derivation: "current_prompt_only",
          }),
        }),
      }),
    ]);
    expect(
      (requests[0]?.arguments as Record<string, unknown>)?.exact_terms,
    ).toBeUndefined();
  });

  it("materializes a named local document summary request without requiring active document context", () => {
    const requests = buildActiveDocsContextWorkstationGatewayCallRequests({
      question:
        'Ok we have a doc called "Casimir Dp Quantum Foam Study" what this about?',
    });

    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_named_doc_summary_query",
        capability_id: "docs.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: "Casimir Dp Quantum Foam Study",
          paths: ["docs"],
          source_target_intent: expect.objectContaining({
            target_source: "docs_viewer",
            target_kind: "named_doc",
            named_doc_query: "Casimir Dp Quantum Foam Study",
          }),
        }),
      }),
    ]);
  });

  it("materializes a natural local topic-document lookup without model-dependent tool selection", () => {
    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({
        question:
          "Find the local document about Helix Ask terminal authority and tell me which document you used.",
      }),
    ).toEqual([
      expect.objectContaining({
        derivation_source: "helix_topic_doc_lookup_query",
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: "Helix Ask terminal authority",
          paths: ["docs"],
          source_target_intent: expect.objectContaining({
            target_source: "docs_viewer",
            target_kind: "topic_doc",
            topic_doc_query: "Helix Ask terminal authority",
          }),
        }),
      }),
    ]);
  });

  it("materializes a hard search of our docs as a bounded docs.search request", () => {
    const requests = buildActiveDocsContextWorkstationGatewayCallRequests({
      question:
        "Search our docs for NHM2 and summarize its treatment of boundary conditions.",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_topic_doc_lookup_query",
        capability_id: "docs.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: "NHM2",
          paths: ["docs"],
          source_target_intent: expect.objectContaining({
            target_source: "docs_viewer",
            target_kind: "topic_doc",
            topic_doc_query: "NHM2",
          }),
        }),
      }),
    ]);
  });

  it.each([
    "Do not search our docs for NHM2; explain the wording only.",
    "Later, search our docs for NHM2, but not now.",
    "Earlier I searched our docs for NHM2 and summarized it.",
    'The screen says "Search our docs for NHM2"; explain that visible text.',
    '"Search our docs for NHM2" was my previous prompt; do not search now.',
  ])("does not materialize contextual our-docs language: %s", (question) => {
    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({
        question,
      }),
    ).toEqual([]);
  });

  it("keeps affirmative our-docs retrieval when an unrelated web route is negated", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Search our docs for NHM2 and summarize its treatment of boundary conditions; do not browse the web.",
      },
    });

    expect(capabilities(requests)).toEqual(["docs.search"]);
  });

  it("keeps contextual named-document wording dormant", () => {
    const prompts = [
      'Do not find the document called "Casimir Dp Quantum Foam Study"; explain what that request would do.',
      'Later, find the document called "Casimir Dp Quantum Foam Study" and explain it, but not now.',
      'Earlier I asked about a document called "Casimir Dp Quantum Foam Study"; explain why evidence was needed.',
      'The screen says "find the document called Casimir Dp Quantum Foam Study and explain it"; explain the wording only.',
    ];

    for (const question of prompts) {
      expect(
        buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
      ).toEqual([]);
    }
  });

  it("does not materialize retained docs from contextual or negated current-document mentions", () => {
    const prompts = [
      "I am not asking about this current document; explain what document observations are.",
      "Before I summarize the current document, explain what evidence would be needed.",
      "The previous answer mentioned the current document; explain why that was not enough.",
      'The screen shows text that says "summarize this current document"; explain the wording.',
      "If we later use the open document, explain what observation would be required.",
    ];

    for (const question of prompts) {
      expect(
        buildActiveDocsContextWorkstationGatewayCallRequests({
          question,
          workspace_context_snapshot: docSnapshot,
        }),
      ).toEqual([]);
    }
  });

  it("does not turn contextual explicit docs paths into document-summary execution", () => {
    const prompts = [
      "Do not open or summarize docs/research/nhm2-current-status-whitepaper.md; explain what that request would do.",
      "In the future, open docs/research/nhm2-current-status-whitepaper.md and summarize it, but not now.",
      "Before I summarize docs/research/nhm2-current-status-whitepaper.md, explain what evidence would be required.",
      'The screen says "Open docs/research/nhm2-current-status-whitepaper.md and summarize it"; explain the wording only.',
      'Earlier I asked, "Open docs/research/nhm2-current-status-whitepaper.md and summarize it"; explain why that needed evidence.',
    ];

    for (const question of prompts) {
      expect(
        buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
      ).toEqual([]);
    }
  });

  it("keeps an affirmative explicit docs summary when an unrelated web tool is negated", () => {
    const requests = buildActiveDocsContextWorkstationGatewayCallRequests({
      question:
        "Open docs/research/nhm2-current-status-whitepaper.md and summarize it in three bullets; do not browse the web.",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        }),
      }),
    ]);
  });

  it("binds an explicit docs locator prompt to its file and exact terms despite a no-summary constraint", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Find every occurrence of alpha = 0.7 and alpha = 0.995. For each occurrence, provide the enclosing sentence and its nearest section heading. Do not summarize or infer.";
    const requests = buildActiveDocsContextWorkstationGatewayCallRequests({
      question,
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: "alpha = 0.7 alpha = 0.995",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          exact_terms: ["alpha = 0.7", "alpha = 0.995"],
          max_hits: 40,
        }),
      }),
    ]);
  });

  it("preserves exact document bounds when structured source admission selects docs search", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Find every occurrence of alpha = 0.7 and alpha = 0.995. For each occurrence, provide the enclosing sentence and its nearest section heading. Do not summarize or infer.";
    const requests = readWorkstationGatewayCallRequestsForTurn({
      body: {
        question,
        source_target_intent: {
          selected_capability: "docs-viewer.search_docs",
          mandatory_next_tool: {
            args: { query: question, paths: ["docs"] },
          },
        },
      },
      includePlannerDerived: true,
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        derivation_source: "helix_structured_source_target_admission",
        arguments: expect.objectContaining({
          query: "alpha = 0.7 alpha = 0.995",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          exact_terms: ["alpha = 0.7", "alpha = 0.995"],
          max_hits: 40,
        }),
      }),
    ]);
  });

  it("binds a zero-result locator request even when it asks only for count and evidence locations", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Find every occurrence of alpha = 0.123456. Return only the occurrence count and evidence locations. Do not infer alternatives.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: "alpha = 0.123456",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          exact_terms: ["alpha = 0.123456"],
        }),
      }),
    ]);
  });

  it("binds an explicit heading request to a bounded section observation", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Under section \u201c6.7 Twin Paradox trip clocking interpretation,\u201d extract every sentence containing alpha. Preserve the original wording and line numbers. Do not summarize.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: "6.7 Twin Paradox trip clocking interpretation",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          section_heading: "6.7 Twin Paradox trip clocking interpretation",
          section_contains_terms: ["alpha"],
        }),
      }),
    ]);
  });

  it("keeps section filter exclusions out of the literal contains terms", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Within section \u201c6.7 Twin Paradox trip clocking interpretation,\u201d return only complete prose sentences containing the literal lowercase token alpha. Exclude display equations, headings, identifiers, and sentence fragments. Preserve original wording and line numbers. Do not summarize.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: "6.7 Twin Paradox trip clocking interpretation",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          section_heading: "6.7 Twin Paradox trip clocking interpretation",
          section_contains_terms: ["alpha"],
        }),
      }),
    ]);
  });

  it("keeps repeated case-sensitive section contains clauses as separate terms", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Within section \u201c6.7 Twin Paradox trip clocking interpretation,\u201d find source lines containing alpha and source lines containing Alpha. Group results by the exact case-sensitive term and preserve line numbers. Do not summarize.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          section_heading: "6.7 Twin Paradox trip clocking interpretation",
          section_contains_terms: ["alpha", "Alpha"],
        }),
      }),
    ]);
  });

  it("binds a quoted section heading introduced by a boundary request", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Return the heading line number, first nonblank content line, and last nonblank content line belonging only to section \u201c6.7 Twin Paradox trip clocking interpretation.\u201d Do not include anything from section 6.8.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: "6.7 Twin Paradox trip clocking interpretation",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          section_heading: "6.7 Twin Paradox trip clocking interpretation",
          section_contains_terms: [],
        }),
      }),
    ]);
  });

  it("keeps an affirmative missing-section lookup despite a bounded no-substitution constraint", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Under section \u201c99.9 Deliberately Missing Section,\u201d find every source line containing alpha. Return only: heading found or not found, match count, and evidence locations. Do not substitute another section or search outside the named section.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: "99.9 Deliberately Missing Section",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          section_heading: "99.9 Deliberately Missing Section",
          section_contains_terms: ["alpha"],
        }),
      }),
    ]);
  });

  it("normalizes exact case-sensitive term wording for a different named section", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Within section \u201c6.8 Profile-scoped trip clocking index,\u201d return every source line containing the exact case-sensitive term alpha. Preserve complete lines and line numbers. Do not include evidence from other sections.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          section_heading: "6.8 Profile-scoped trip clocking index",
          section_contains_terms: ["alpha"],
          section_match_unit: "line",
        }),
      }),
    ]);
  });

  it("stops a section term before a new Output instruction", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Within section \u201c6.8 Profile-scoped trip clocking index,\u201d return only source lines containing the exact case-sensitive term alpha. Output exactly the matching line number and complete source line. Do not output the section heading, explanatory text, or any nonmatching line.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          section_contains_terms: ["alpha"],
          section_match_unit: "line",
        }),
      }),
    ]);
  });

  it("binds two quoted section headings for a bounded comparison", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Compare only sections \u201c6.7 Twin Paradox trip clocking interpretation\u201d and \u201c6.8 Profile-scoped trip clocking index.\u201d For each section, list every source line containing the exact case-sensitive term alpha, preserving complete lines and line numbers. Keep results separated by section and use no evidence from elsewhere.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          section_heading: "6.7 Twin Paradox trip clocking interpretation",
          section_headings: [
            "6.7 Twin Paradox trip clocking interpretation",
            "6.8 Profile-scoped trip clocking index",
          ],
          section_contains_terms: ["alpha"],
          section_match_unit: "line",
        }),
      }),
    ]);
  });

  it("keeps a backtick-quoted term exact before formatting instructions", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Compare only sections \u201c6.7 Twin Paradox trip clocking interpretation\u201d and \u201c99.9 Deliberately Missing Section.\u201d For each section, report whether its heading was found, then list every source line containing the exact case-sensitive term `alpha` with complete lines and line numbers. Report zero matches explicitly. Do not substitute another section or use evidence from elsewhere.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        arguments: expect.objectContaining({
          section_headings: [
            "6.7 Twin Paradox trip clocking interpretation",
            "99.9 Deliberately Missing Section",
          ],
          section_contains_terms: ["alpha"],
          section_match_unit: "line",
        }),
      }),
    ]);
  });

  it("stops an unquoted term before a with-complete-lines format phrase", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Compare only sections \u201c6.7 Twin Paradox trip clocking interpretation\u201d and \u201c99.9 Deliberately Missing Section.\u201d For each section, report whether its heading was found, then list every source line containing the exact case-sensitive term alpha with complete lines and line numbers. Report zero matches explicitly. Do not substitute another section or use evidence from elsewhere.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question })[0],
    ).toMatchObject({
      arguments: {
        section_contains_terms: ["alpha"],
        section_match_unit: "line",
      },
    });
  });

  it("retains four headings when list commas appear inside curly quotes", () => {
    const question =
      "Open docs/research/nhm2-current-status-whitepaper.md. Check sections \u201c6.7 Twin Paradox trip clocking interpretation,\u201d \u201c6.8 Profile-scoped trip clocking index,\u201d \u201c98.8 Missing Section A,\u201d and \u201c99.9 Missing Section B.\u201d For each section, report heading found or not found and the count of source lines containing alpha. Do not substitute headings or use evidence from another section.";

    expect(
      buildActiveDocsContextWorkstationGatewayCallRequests({ question })[0],
    ).toMatchObject({
      arguments: {
        section_headings: [
          "6.7 Twin Paradox trip clocking interpretation",
          "6.8 Profile-scoped trip clocking index",
          "98.8 Missing Section A",
          "99.9 Missing Section B",
        ],
        section_contains_terms: ["alpha"],
        section_match_unit: "line",
      },
    });
  });

  it("does not execute contextual explicit docs locator wording", () => {
    const prompts = [
      "Do not find or locate alpha = 0.7 in docs/research/nhm2-current-status-whitepaper.md.",
      "Later, find every occurrence of alpha = 0.7 in docs/research/nhm2-current-status-whitepaper.md, but not now.",
      "If we find alpha = 0.7 in docs/research/nhm2-current-status-whitepaper.md, explain the workflow first.",
      "Earlier I asked to find alpha = 0.7 in docs/research/nhm2-current-status-whitepaper.md; explain why that needed evidence.",
      'The screen says "find alpha = 0.7 in docs/research/nhm2-current-status-whitepaper.md"; explain the text only.',
    ];

    for (const question of prompts) {
      expect(
        buildActiveDocsContextWorkstationGatewayCallRequests({ question }),
      ).toEqual([]);
    }
  });

  it("keeps docs and calculator requests in one Codex workstation itinerary", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the current document, calculate 8*9, and explain what this proves about the Codex workstation loop.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(requests[1]).toMatchObject({
      capability_id: "scientific-calculator.solve_expression",
      arguments: {
        expression: "8*9",
      },
    });
  });

  it("keeps docs, calculator, and repo search requests in one bounded itinerary", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the open document, calculate 8*9, search the repo for workstation_gateway, then synthesize the implication.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "repo.search",
    ]);
    expect(requests[2]).toMatchObject({
      capability_id: "repo.search",
      arguments: {
        query: "workstation_gateway",
      },
    });
  });

  it("keeps the live Codex compound wording as docs, calculator, and repo requests", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the current document, calculate 6*7, search the repo for workstation_gateway, then summarize what the observations prove and do not prove.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "repo.search",
    ]);
    expect(
      requests.find(
        (request) =>
          request.capability_id === "scientific-calculator.solve_expression",
      ),
    ).toMatchObject({
      arguments: {
        expression: "6*7",
      },
    });
    expect(
      requests.find((request) => request.capability_id === "repo.search"),
    ).toMatchObject({
      arguments: {
        query: "workstation_gateway",
      },
    });
  });

  it("maps explicit calculator capability wording in mixed docs prompts", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use scientific-calculator.solve_expression for 8*9 and also use the current document observation.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toContain("docs.search");
    expect(capabilities(requests)).toContain(
      "scientific-calculator.solve_expression",
    );
    expect(
      requests.find(
        (request) =>
          request.capability_id === "scientific-calculator.solve_expression",
      ),
    ).toMatchObject({
      arguments: {
        expression: "8*9",
      },
    });
  });

  it("preserves scientific notation in prompt-named calculator expressions", () => {
    const expression = "2.26e18*164.8*1.602176634e-19";
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question: `Use scientific-calculator.solve_expression with expression: ${expression}. Report only from the calculator receipt.`,
    });

    expect(capabilities(requests)).toEqual([
      "scientific-calculator.solve_expression",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "scientific-calculator.solve_expression",
      arguments: {
        expression,
        source_target_intent: expect.objectContaining({
          target_source: "scientific_calculator",
          target_kind: "calculator_solve",
          expression,
        }),
      },
    });
  });

  it("preserves exact calculus function expressions in prompt-named calculator requests", () => {
    const expression = "integrate(x^2+3*x,x)";
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question: `Call scientific-calculator.solve_expression with this exact expression: ${expression}. Wait for calculator_receipt and answer from workstation_tool_evaluation.`,
    });

    expect(capabilities(requests)).toEqual([
      "scientific-calculator.solve_expression",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "scientific-calculator.solve_expression",
      arguments: {
        expression,
        source_target_intent: expect.objectContaining({
          target_source: "scientific_calculator",
          target_kind: "calculator_solve",
          expression,
        }),
      },
    });
  });

  it("maps safe docs-viewer search aliases onto the canonical docs.search gateway", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use docs-viewer.locate_in_doc for docs/research/nhm2-current-status-whitepaper.md with query claim boundary.",
    });

    expect(capabilities(requests)).toEqual(["docs.search"]);
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      capability_id: "docs.search",
      mode: "read",
      arguments: {
        query: "claim boundary",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        source_target_intent: expect.objectContaining({
          target_source: "docs",
          target_kind: "docs_search",
          alias_capability: "docs-viewer.locate_in_doc",
          requested_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        }),
      },
    });
  });

  it("maps safe docs-viewer open aliases onto the canonical open_doc gateway", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use docs-viewer.open_doc_by_path for docs/research/nhm2-current-status-whitepaper.md.",
    });

    expect(capabilities(requests)).toEqual(["docs-viewer.open_doc"]);
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      capability_id: "docs-viewer.open_doc",
      mode: "act",
      arguments: {
        path: "docs/research/nhm2-current-status-whitepaper.md",
        source_target_intent: expect.objectContaining({
          target_source: "docs",
          target_kind: "docs_open_doc",
          alias_capability: "docs-viewer.open_doc_by_path",
          requested_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        }),
      },
    });
  });

  it("maps structured docs-viewer route aliases onto canonical docs gateway capabilities", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      question: "Use docs aliases.",
      source_target_intent: {
        selected_capability: "docs-viewer.summarize_doc",
        args: {
          query: "claim boundary",
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        },
      },
      route_metadata: {
        source_target_intent: {
          selected_capability: "docs-viewer.open",
          args: {
            path: "docs/helix-ask-flow.md",
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "docs-viewer.open_doc",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "docs.search",
      arguments: {
        query: "claim boundary",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        source_target_intent: expect.objectContaining({
          alias_capability: "docs-viewer.summarize_doc",
        }),
      },
    });
    expect(requests[1]).toMatchObject({
      capability_id: "docs-viewer.open_doc",
      arguments: {
        path: "docs/helix-ask-flow.md",
        source_target_intent: expect.objectContaining({
          alias_capability: "docs-viewer.open",
        }),
      },
    });
  });

  it("binds a natural Minecraft mechanics docs admission to the active room environment", () => {
    const question =
      "Before changing Minecraft, look up the connected environment mechanics for how to give my player a temporary glowing effect and cite the exact source line. Do not execute a command.";
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      question,
      source_target_intent: {
        selected_capability: "docs-viewer.search_docs",
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "docs.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: question,
          environment_scope: "active_room_environment",
          source_target_intent: expect.objectContaining({
            target_source: "docs",
            target_kind: "environment_mechanics_docs",
            environment_scope: "active_room_environment",
          }),
        }),
      }),
    ]);
  });

  it("materializes a natural Minecraft mechanics lookup from the user goal alone", () => {
    const question =
      "For this test, look up the connected Minecraft environment mechanics for how to give my player a temporary glowing effect and cite the exact source line. Do not execute a command.";
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question,
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_minecraft_mechanics_docs_intent",
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          query: question,
          environment_scope: "active_room_environment",
          source_target_intent: expect.objectContaining({
            target_kind: "environment_mechanics_docs",
            execution_intent: "none",
          }),
        }),
      }),
    ]);
  });

  it("does not append a Minecraft action request when the user asks only for exact command syntax", () => {
    const question =
      "Before doing anything in Minecraft, look up the connected environment mechanics for how to capture only the exact wall footprint as a rollback checkpoint. Cite the exact source file and line range and give the exact command form. Do not execute any Minecraft command.";
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question,
        trusted_room_environment_intent_context: {
          schema: "helix.trusted_room_environment_intent_context.v1",
          trusted_environment_domain: "minecraft",
          source: "authenticated_room_environment_subject",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    });

    expect(capabilities(requests)).toEqual(["docs.search"]);
    expect(requests[0]).toMatchObject({
      arguments: {
        source_target_intent: {
          execution_intent: "none",
        },
      },
    });
  });

  it("grounds an affirmative natural Minecraft command with room-scoped mechanics evidence before the model authors the command", () => {
    const question =
      "Can you make me glow for ten seconds in the connected Minecraft world?";

    expect(
      buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({ question }),
    ).toEqual([
      expect.objectContaining({
        derivation_source: "helix_minecraft_command_mechanics_grounding",
        capability_id: "docs.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: question,
          environment_scope: "active_room_environment",
          source_target_intent: expect.objectContaining({
            target_kind: "environment_mechanics_docs",
            execution_intent: "ground_model_authored_environment_command",
            terminal_eligible: false,
          }),
        }),
      }),
    ]);
  });

  it("does not force World Authority command grounding over an authenticated natural Player Embodiment request", () => {
    const question =
      "Step off this ledge, save me from the fall with my water bucket, verify I landed safely, pick the water back up, and release control.";

    expect(
      buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({
        question,
        trusted_room_environment_intent_context: {
          schema: "helix.trusted_room_environment_intent_context.v1",
          trusted_environment_domain: "minecraft",
          source: "authenticated_room_environment_subject",
          authorized_player_action_capability_ids: [
            "com.casimirbot.minecraft.player.guardian.execute",
          ],
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      }),
    ).toEqual([]);
  });

  it("does not inject mechanics docs for a read-only Minecraft command-catalog query", () => {
    const question =
      'Use only com.casimirbot.minecraft.command.catalog against the paired live Fabric source. Query the current command tree with path_prefix "helixgame checkpoint" and limit 64. Report the fresh catalog entries. Do not execute any command and do not use another tool.';

    expect(
      buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({
        question,
        trusted_room_environment_intent_context: {
          schema: "helix.trusted_room_environment_intent_context.v1",
          trusted_environment_domain: "minecraft",
          source: "authenticated_room_environment_subject",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      }),
    ).toEqual([]);
  });

  it("does not inject mechanics docs when an affirmative Minecraft command call is schema-complete", () => {
    const question =
      'Run exactly one command in the paired Minecraft Fabric environment. Use com.casimirbot.minecraft.command with command "helixgame checkpoint status", category "query", and effect "read_only". Do not run any other command.';

    expect(
      buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({
        question,
        trusted_room_environment_intent_context: {
          schema: "helix.trusted_room_environment_intent_context.v1",
          trusted_environment_domain: "minecraft",
          source: "authenticated_room_environment_subject",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      }),
    ).toEqual([]);
  });

  it("honors an isolated exact command even when its redundant risk label needs server canonicalization", () => {
    const question =
      'Run exactly one command in the paired Minecraft Fabric environment. Use com.casimirbot.minecraft.command with command "time query daytime", category "server_query", and effect "read_only". Do not run any other command or tool.';

    expect(
      buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({
        question,
        trusted_room_environment_intent_context: {
          schema: "helix.trusted_room_environment_intent_context.v1",
          trusted_environment_domain: "minecraft",
          source: "authenticated_room_environment_subject",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      }),
    ).toEqual([]);
  });

  it("grounds a semantic structure action from an authenticated Minecraft room even when the prompt omits the game name", () => {
    const question =
      "At my current safe plains site, build a freestanding stone-brick wall five blocks long north-south and three blocks high. Inspect first, capture a rollback checkpoint, and do not build if no safe site is verified.";
    const trustedRoomEnvironment = {
      schema: "helix.trusted_room_environment_intent_context.v1",
      trusted_environment_domain: "minecraft",
      source: "authenticated_room_environment_subject",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    };

    expect(
      buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({
        question,
        trusted_room_environment_intent_context: trustedRoomEnvironment,
      }),
    ).toEqual([
      expect.objectContaining({
        derivation_source: "helix_minecraft_command_mechanics_grounding",
        capability_id: "docs.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: question,
          environment_scope: "active_room_environment",
          source_target_intent: expect.objectContaining({
            target_kind: "environment_mechanics_docs",
            execution_intent: "ground_model_authored_environment_command",
            terminal_eligible: false,
          }),
        }),
      }),
    ]);
  });

  it("orders room-scoped mechanics evidence before runtime-authored Minecraft action observations", () => {
    const question =
      "At my current safe plains site, build a freestanding stone-brick wall five blocks long north-south and three blocks high. Inspect first, capture a rollback checkpoint, and do not build if no safe site is verified.";
    const turnId = "ask:test:semantic-wall-mechanics-order";
    const body: Record<string, unknown> = {
      agent_runtime: "codex",
      question,
      trusted_room_environment_intent_context: {
        schema: "helix.trusted_room_environment_intent_context.v1",
        trusted_environment_domain: "minecraft",
        source: "authenticated_room_environment_subject",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      source_target_intent: {
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
      },
      capability_selection_result: {
        selected_capability:
          "com.casimirbot.minecraft.spatial_region.inspect",
      },
      canonical_goal_frame: {
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      tool_call_admission_decision: {
        source_target: "live_environment",
        admitted_tool_families: ["live_environment"],
        requested_capability:
          "com.casimirbot.minecraft.spatial_region.inspect",
        compound_requested_capabilities: [
          "com.casimirbot.minecraft.spatial_region.inspect",
          "com.casimirbot.minecraft.command.catalog",
          "com.casimirbot.minecraft.command",
        ],
      },
    };
    body.committed_ask_route = buildCommittedAskRoute({
      turnId,
      promptText: question,
      selectedRoute: "environment_connector_capability",
      payload: body,
    });

    expect(
      (body.committed_ask_route as {
        capability_policy: { allowed_tool_families: string[] };
      }).capability_policy.allowed_tool_families,
    ).toEqual(expect.arrayContaining(["live_environment", "docs_viewer"]));
    expect(
      capabilities(
        readWorkstationGatewayCallRequestsForTurn({
          includePlannerDerived: true,
          body,
        }),
      ),
    ).toEqual(["docs.search"]);
  });

  it("retains read-only Minecraft mechanics grounding inside a committed live-environment command route", () => {
    const question =
      "Can you make me glow for ten seconds in the connected Minecraft world?";
    const turnId = "ask:test:minecraft-command-mechanics-grounding";
    const body: Record<string, unknown> = {
      agent_runtime: "codex",
      question,
      source_target_intent: {
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
      },
      canonical_goal_frame: {
        goal_kind: "live_environment",
        required_terminal_kind: "model_synthesized_answer",
      },
      tool_call_admission_decision: {
        source_target: "live_environment",
        admitted_tool_families: ["live_environment", "workstation_action"],
        requested_capability: "com.casimirbot.minecraft.command",
        admitted_capability: "com.casimirbot.minecraft.command",
      },
      capability_plan: {
        selected_capability: "com.casimirbot.minecraft.command",
        source_target: "live_environment",
        family: "live_environment",
      },
    };
    body.committed_ask_route = buildCommittedAskRoute({
      turnId,
      promptText: question,
      selectedRoute: "environment_connector_capability",
      payload: body,
    });

    expect(
      (body.committed_ask_route as {
        capability_policy: {
          allowed_tool_families: string[];
          required_capability_families: string[];
        };
      }).capability_policy,
    ).toMatchObject({
      allowed_tool_families: expect.arrayContaining([
        "live_environment",
        "docs_viewer",
      ]),
      required_capability_families: ["live_environment"],
    });
    expect(
      capabilities(
        readWorkstationGatewayCallRequestsForTurn({
          includePlannerDerived: true,
          body,
        }),
      ),
    ).toContain("docs.search");
  });

  it.each([
    "Do not make me glow in the connected Minecraft world.",
    "Later I may ask you to make me glow in Minecraft.",
    "If I join again, make me glow in Minecraft.",
    'The screen says "Can you make me glow in Minecraft?"',
    '"Make me glow in Minecraft" is only an example request.',
    "Historically, I asked you to make me glow in Minecraft.",
    "Can you explain how to make me glow in Minecraft?",
    "Explain glowing in Minecraft, but do not apply it.",
  ])(
    "does not prefetch command mechanics for contextual or non-executing wording: %s",
    (question) => {
      expect(
        buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({ question }),
      ).toEqual([]);
    },
  );

  it.each([
    'The room transcript contains "build a freestanding stone-brick wall beside me."',
    "If the area is clear later, build a freestanding stone-brick wall beside me.",
    "At my current site, do not build a freestanding stone-brick wall beside me.",
    "Historically, we built a freestanding stone-brick wall beside me.",
  ])(
    "does not prefetch mechanics from trusted room scope for non-executing structure wording: %s",
    (question) => {
      expect(
        buildMinecraftMechanicsDocsWorkstationGatewayCallRequests({
          question,
          trusted_room_environment_intent_context: {
            schema: "helix.trusted_room_environment_intent_context.v1",
            trusted_environment_domain: "minecraft",
            source: "authenticated_room_environment_subject",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        }),
      ).toEqual([]);
    },
  );

  it("maps structured capability catalog admissions onto the executable catalog gateway", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      question: "what tools are available to use with this agent?",
      source_target_intent: {
        selected_capability: "capability_catalog",
        required_terminal_kind: "capability_help_summary",
      },
    });

    expect(capabilities(requests)).toEqual([
      "helix_ask.inspect_capability_catalog",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "helix_ask.inspect_capability_catalog",
      mode: "observe",
      arguments: {
        query: "what tools are available to use with this agent?",
        source_target_intent: expect.objectContaining({
          target_source: "capability_catalog",
          target_kind: "capability_catalog_runtime",
          alias_capability: "capability_catalog",
        }),
      },
    });
  });

  it("keeps structured repo admission authoritative over capability names in the query", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        question: "Where is workspace_os.status implemented?",
        source_target_intent: {
          selected_capability: "repo-code.search_concept",
          target_source: "repo_code",
          args: { query: "workspace_os.status" },
        },
      },
    });

    expect(capabilities(requests)).toEqual(["repo.search"]);
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_structured_source_target_admission",
      capability_id: "repo.search",
      arguments: {
        query: "workspace_os.status",
        source_target_intent: expect.objectContaining({
          target_source: "repo_code",
          target_kind: "repo_search",
          alias_capability: "repo-code.search_concept",
        }),
      },
    });
  });

  it("does not turn scholarly and Image Lens capability questions into research calls", () => {
    const question =
      "does your tool for research papers allow you to pick papers you are able to parse? or do you check what papers are openable to then use image lens?";
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: { question, agent_runtime: "codex" },
    });

    expect(requests).toEqual([]);
  });

  it("does not execute a catalog lookup for contextual capability-question wording", () => {
    const prompts = [
      "The screen says 'does your research paper tool use image lens?'; explain that sentence only.",
      "Earlier I asked whether your research paper tool can use image lens; explain why it was ambiguous.",
    ];
    for (const question of prompts) {
      const requests = readWorkstationGatewayCallRequestsForTurn({
        includePlannerDerived: true,
        body: { question, agent_runtime: "codex" },
      });
      expect(
        requests.some(
          (request) =>
            request.capability_id === "helix_ask.inspect_capability_catalog",
        ),
      ).toBe(false);
    }
  });

  it("does not map quoted, negated, future, or unsafe docs-viewer alias prompts", () => {
    const prompts = [
      "The text says docs-viewer.locate_in_doc; explain that phrase only.",
      "Do not run docs-viewer.search_docs for claim boundary; explain what it would do.",
      "The UI label contains docs-viewer.open_doc_by_path.",
      "In the future we might use docs-viewer.summarize_doc for this.",
      "Use docs-viewer.open_doc_by_path for C:/Users/dan/secret.md.",
      "Use docs-viewer.open_doc_by_path for ../secret.md.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("maps safe repo and internet route aliases onto canonical search gateways", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use repo-code.search_concept for workstation_gateway; use internet_search.web_research for public corroboration.",
    });

    expect(capabilities(requests)).toEqual([
      "repo.search",
      "internet-search.search_web",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "repo.search",
      mode: "read",
      arguments: {
        query: "workstation_gateway",
        source_target_intent: expect.objectContaining({
          target_source: "repo_code",
          target_kind: "repo_search",
          alias_capability: "repo-code.search_concept",
        }),
      },
    });
    expect(requests[1]).toMatchObject({
      capability_id: "internet-search.search_web",
      mode: "read",
      arguments: {
        query: "public corroboration",
        source_target_intent: expect.objectContaining({
          target_source: "internet",
          target_kind: "internet_search",
          alias_capability: "internet_search.web_research",
        }),
      },
    });
  });

  it("maps structured repo and internet route aliases onto canonical search gateways", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      question: "Use search aliases.",
      source_target_intent: {
        selected_capability: "repo-code.search_concept",
        args: {
          query: "workstation_gateway",
        },
      },
      route_metadata: {
        source_target_intent: {
          selected_capability: "internet_search.web_research",
          args: {
            query: "public corroboration",
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "repo.search",
      "internet-search.search_web",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "repo.search",
      arguments: {
        query: "workstation_gateway",
        source_target_intent: expect.objectContaining({
          alias_capability: "repo-code.search_concept",
        }),
      },
    });
    expect(requests[1]).toMatchObject({
      capability_id: "internet-search.search_web",
      arguments: {
        query: "public corroboration",
        source_target_intent: expect.objectContaining({
          alias_capability: "internet_search.web_research",
        }),
      },
    });
  });

  it("does not map quoted, negated, future, or UI-label repo/internet alias prompts", () => {
    const prompts = [
      "The text says repo-code.search_concept; explain that phrase only.",
      "Do not run repo-code.search_concept for workstation_gateway; explain what it would do.",
      "The UI label contains internet_search.web_research.",
      "In the future we might use internet_search.web_research for this.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("maps safe theory and civilization route aliases onto canonical reflection gateways", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use helix_ask.reflect_theory_context for QEI margin; use helix_ask.reflect_civilization_bounds for transport energy limits.",
    });

    expect(capabilities(requests)).toEqual([
      "helix_ask.reflect_theory_context",
      "civilization-bounds.reflect_system_bounds",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "helix_ask.reflect_theory_context",
      mode: "read",
      arguments: {
        prompt: "QEI margin",
        source_target_intent: expect.objectContaining({
          target_source: "theory_badge_graph",
          target_kind: "theory_context_reflection",
        }),
      },
    });
    expect(requests[1]).toMatchObject({
      capability_id: "civilization-bounds.reflect_system_bounds",
      mode: "read",
      arguments: {
        prompt: "transport energy limits",
        source_target_intent: expect.objectContaining({
          target_source: "civilization_bounds",
          target_kind: "civilization_bounds_reflection",
          alias_capability: "helix_ask.reflect_civilization_bounds",
        }),
      },
    });
  });

  it("maps safe theory frontier conjecture aliases onto the canonical workbench gateway", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use propose_frontier_conjectures for missing badge bridges between QEI margin and source residual.",
    });

    expect(capabilities(requests)).toEqual([
      "theory-badge-graph.propose_frontier_conjectures",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "theory-badge-graph.propose_frontier_conjectures",
      mode: "read",
      arguments: {
        prompt: "missing badge bridges between QEI margin and source residual",
        build_explanation_plan: true,
        source_target_intent: expect.objectContaining({
          target_source: "theory_badge_graph",
          target_kind: "theory_frontier_conjecture_workbench",
          alias_capability: "propose_frontier_conjectures",
        }),
      },
    });
  });

  it("maps structured theory and civilization route aliases onto canonical reflection gateways", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      question: "Use reflection aliases.",
      source_target_intent: {
        selected_capability: "helix_ask.reflect_theory_context",
        args: {
          query: "QEI margin",
        },
      },
      route_metadata: {
        source_target_intent: {
          selected_capability: "helix_ask.reflect_civilization_bounds",
          args: {
            query: "transport energy limits",
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "helix_ask.reflect_theory_context",
      "civilization-bounds.reflect_system_bounds",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "helix_ask.reflect_theory_context",
      arguments: {
        prompt: "QEI margin",
        source_target_intent: expect.objectContaining({
          alias_capability: undefined,
        }),
      },
    });
    expect(requests[1]).toMatchObject({
      capability_id: "civilization-bounds.reflect_system_bounds",
      arguments: {
        prompt: "transport energy limits",
        source_target_intent: expect.objectContaining({
          alias_capability: "helix_ask.reflect_civilization_bounds",
        }),
      },
    });
  });

  it("maps structured Moral Graph substrate admission onto the living-substrate gateway", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      question:
        "Use the Moral Graph to reason from organism boundary, sensing, and homeostasis.",
      source_target_intent: {
        selected_capability: "moral-graph.reflect_living_substrate_context",
        args: {
          query: "organism boundary, sensing, and homeostasis",
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_living_substrate_context",
    ]);
    expect(requests[0]).toMatchObject({
      schema: "helix.workstation_gateway.structured_admission_call_request.v1",
      derivation_source: "helix_structured_source_target_admission",
      capability_id: "moral-graph.reflect_living_substrate_context",
      mode: "read",
      arguments: {
        prompt: "organism boundary, sensing, and homeostasis",
        conversation_context: expect.stringContaining("Moral Graph"),
        include_theory_bridge: true,
        include_recommended_actions: true,
        source_target_intent: expect.objectContaining({
          target_source: "moral_graph",
          target_kind: "moral_living_substrate_reflection",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
    });
  });

  it("does not map quoted, negated, future, or UI-label reflection alias prompts", () => {
    const prompts = [
      "The text says helix_ask.reflect_theory_context; explain that phrase only.",
      "Do not run helix_ask.reflect_theory_context for QEI margin; explain what it would do.",
      "The UI label contains helix_ask.reflect_civilization_bounds.",
      "In the future we might use helix_ask.reflect_civilization_bounds for this.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("does not map quoted, negated, future, or UI-label frontier conjecture prompts", () => {
    const prompts = [
      "The text says propose_frontier_conjectures; explain that phrase only.",
      "Do not run theory-badge-graph.propose_frontier_conjectures for QEI margin.",
      "The UI label contains frontier_conjecture_workbench.",
      "In the future we might use theory_frontier_conjectures for this.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("maps safe calculator route aliases onto the canonical solve_expression gateway", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use scientific-calculator.solve_with_steps for 8*9, then explain the observed result.",
    });

    expect(capabilities(requests)).toEqual([
      "scientific-calculator.solve_expression",
    ]);
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      capability_id: "scientific-calculator.solve_expression",
      mode: "read",
      arguments: {
        expression: "8*9",
        source_target_intent: expect.objectContaining({
          target_source: "scientific_calculator",
          target_kind: "calculator_solve",
          alias_capability: "scientific-calculator.solve_with_steps",
          expression: "8*9",
        }),
      },
    });
  });

  it("maps structured calculator route aliases onto the canonical solve_expression gateway", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      question: "Use the calculator alias.",
      source_target_intent: {
        selected_capability: "scientific-calculator.solve",
        args: {
          expression: "6*7",
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "scientific-calculator.solve_expression",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "scientific-calculator.solve_expression",
      mode: "read",
      arguments: {
        expression: "6*7",
        source_target_intent: expect.objectContaining({
          selected_capability: "scientific-calculator.solve",
          alias_capability: "scientific-calculator.solve",
        }),
      },
    });
  });

  it("does not map quoted or negated calculator route alias prompts", () => {
    const prompts = [
      "The text says scientific-calculator.solve_with_steps; explain that phrase only.",
      "Do not run scientific-calculator.solve for 8*9; explain what it would do.",
      "The UI label contains scientific-calculator.solve.",
      "In the future we might use scientific-calculator.solve_with_steps for this.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("admits prompt-named docs and calculator while deferring theory to the Codex runtime", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Codex workstation focused retest: use exactly these workstation observations before answering: docs.search for docs/research/nhm2-current-status-whitepaper.md with query claim boundary; scientific-calculator.solve_expression with expression 8*9; theory-badge-graph.reflect_discussion_context for NHM2 claim boundary. Answer what those observations support and what remains unproven.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(
      requests.find((request) => request.capability_id === "docs.search"),
    ).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      arguments: {
        query: "claim boundary",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
      },
    });
    expect(
      requests.find(
        (request) =>
          request.capability_id === "scientific-calculator.solve_expression",
      ),
    ).toMatchObject({
      arguments: {
        expression: "8*9",
      },
    });
    expect(
      requests.find(
        (request) =>
          request.capability_id === "helix_ask.reflect_theory_context",
      ),
    ).toBeUndefined();
  });

  it("admits prompt-named Moral Graph living-substrate reflection as a gateway observation", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use moral-graph.reflect_living_substrate_context for organism boundary, sensing, homeostasis, entropy pressure, and non-human living systems, then reason from the observation.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_living_substrate_context",
    ]);
    expect(requests[0]).toMatchObject({
      schema:
        "helix.workstation_gateway.prompt_named_capability_call_request.v1",
      derivation_source: "helix_prompt_named_capability",
      capability_id: "moral-graph.reflect_living_substrate_context",
      mode: "read",
      arguments: {
        prompt: expect.stringContaining("organism boundary"),
        conversation_context: expect.stringContaining(
          "moral-graph.reflect_living_substrate_context",
        ),
        include_theory_bridge: true,
        include_recommended_actions: true,
        source_target_intent: expect.objectContaining({
          target_source: "moral_graph",
          target_kind: "moral_living_substrate_reflection",
          selected_capability: "moral-graph.reflect_living_substrate_context",
          explicit_capability: true,
        }),
      },
    });
  });

  it("admits prompt-named general Moral Graph reflection as a gateway observation", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use moral-graph.reflect_context for inherited conditioning, purpose as inquiry, and recognition before transcendence. Explain what the procedural derivation supports.",
      },
    });

    expect(capabilities(requests)).toEqual(["moral-graph.reflect_context"]);
    expect(requests[0]).toMatchObject({
      schema:
        "helix.workstation_gateway.prompt_named_capability_call_request.v1",
      derivation_source: "helix_prompt_named_capability",
      capability_id: "moral-graph.reflect_context",
      mode: "read",
      arguments: {
        prompt: expect.stringContaining("inherited conditioning"),
        conversation_context: expect.stringContaining(
          "moral-graph.reflect_context",
        ),
        include_locator: true,
        include_fruition: true,
        include_procedural_classification: true,
        include_recommended_actions: true,
        include_admissions: true,
        source_target_intent: expect.objectContaining({
          target_source: "moral_graph",
          target_kind: "moral_graph_reflection",
          selected_capability: "moral-graph.reflect_context",
          explicit_capability: true,
        }),
      },
    });
  });

  it("admits natural-language Moral Graph reflection without admitting web for broad research wording", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect this philosophy through the moral badge graph using the research and evidence already in the procedural system: inherited conditioning, purpose as inquiry, and goalpost integrity.",
      },
    });

    expect(capabilities(requests)).toEqual(["moral-graph.reflect_context"]);
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_derived_moral_graph_reflection",
      capability_id: "moral-graph.reflect_context",
      arguments: {
        source_target_intent: expect.objectContaining({
          target_source: "moral_graph",
          target_kind: "moral_graph_reflection",
        }),
      },
    });
  });

  it("admits implicit agency-disclosure procedural prompts as Moral Graph reflection", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect on a case where withheld information caused someone else to lose the ability to plan, adapt, choose, or protect themselves. Do not judge the person's character; trace what choices were lost and what disclosure would have preserved agency.",
      },
    });

    expect(capabilities(requests)).toEqual(["moral-graph.reflect_context"]);
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_derived_moral_graph_reflection",
      capability_id: "moral-graph.reflect_context",
      arguments: {
        source_target_intent: expect.objectContaining({
          target_source: "moral_graph",
          target_kind: "moral_graph_reflection",
        }),
      },
    });
  });

  it("does not admit Moral Graph or web tools for generic reflection wording", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: "Reflect on this.",
      },
    });

    expect(capabilities(requests)).not.toContain("moral-graph.reflect_context");
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
  });

  it("keeps browser-style Moral Graph procedural evidence prompts on the Moral Graph lane", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect this philosophy through the moral badge graph using the research and evidence already in the procedural system: inherited conditioning, purpose as inquiry, inspiration without imitation, goalpost integrity, and recognition before transcendence. Explain what the procedural chain supports; do not use internet search.",
      },
    });

    expect(capabilities(requests)).toEqual(["moral-graph.reflect_context"]);
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
    expect(capabilities(requests)).not.toContain(
      "theory-badge-graph.reflect_discussion_context",
    );
    expect(capabilities(requests)).not.toContain(
      "civilization-bounds.reflect_system_bounds",
    );
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_derived_moral_graph_reflection",
      capability_id: "moral-graph.reflect_context",
      arguments: {
        source_target_intent: expect.objectContaining({
          target_source: "moral_graph",
          target_kind: "moral_graph_reflection",
        }),
      },
    });
  });

  it("keeps explicitly requested web search adjacent to general Moral Graph reflection", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use moral-graph.reflect_context for purpose as inquiry, and also search web sources for current evidence.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_context",
      "internet-search.search_web",
    ]);
    expect(
      (requests[0].arguments as Record<string, any>).next_affordances,
    ).toBeUndefined();
  });

  it("does not execute contextual or screen-visible general Moral Graph mentions", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          'The screen shows "moral-graph.reflect_context"; do not run it. Explain why broad evidence wording should not admit web search.',
      },
    });

    expect(capabilities(requests)).not.toContain("moral-graph.reflect_context");
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
  });

  it("does not execute conceptual no-run Moral Graph tool explanations", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "What is the Moral Graph reflection tool? Explain conceptually. Do not run it.",
      },
    });

    expect(capabilities(requests)).not.toContain("moral-graph.reflect_context");
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
  });

  it("does not admit tools from conceptual no-run tool identifier explanations", () => {
    const prompts = [
      "What is the Moral Graph reflection tool? Explain conceptually. Do not run it.",
      "What is the Moral Badge Graph reflection tool? Explain conceptually. Do not run it.",
      "In plain English, describe what the string `internet-search.search_web` looks like as a tool identifier. Do not run it.",
      "Explain `scientific-calculator.solve_expression` as a tool identifier. Do not run it.",
      "Describe `repo.search` as a capability name. Do not run it.",
      "Define `scholarly-research.lookup_papers` as a capability identifier. Do not call it.",
    ];

    for (const question of prompts) {
      const requests = readWorkstationGatewayCallRequestsForTurn({
        includePlannerDerived: true,
        body: {
          agent_runtime: "codex",
          question,
        },
      });

      expect(capabilities(requests), question).toEqual([]);
    }
  });

  it("does not execute contextual or screen-visible implicit procedural badge mentions", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          'The screen shows "withheld information caused someone to lose the ability to plan"; explain why quoted text should not run Moral Graph or web tools.',
      },
    });

    expect(capabilities(requests)).not.toContain("moral-graph.reflect_context");
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
  });

  it("does not admit web search from broad research wording in implicit Moral Graph prompts", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect on the evidence and research around withheld information causing affected parties to lose the ability to plan and adapt. Trace the agency-preserving disclosure questions without using web search.",
      },
    });

    expect(capabilities(requests)).toEqual(["moral-graph.reflect_context"]);
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
  });

  it("keeps broad moral-substrate wording from admitting inferred internet search beside the primary reflection", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use moral-graph.reflect_living_substrate_context for organism boundary, sensing, homeostasis, personhood, law, civilization, and non-human living systems. Explain what the procedural chain supports.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_living_substrate_context",
    ]);
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
  });

  it("defers non-explicit external research as a Moral Graph substrate next affordance", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use moral-graph.reflect_living_substrate_context for organism boundary, sensing, homeostasis, personhood, law, civilization, and non-human living systems. Explain what the procedural chain supports.",
        source_target_intent: {
          selected_capability: "moral-graph.reflect_living_substrate_context",
          args: {
            query:
              "organism boundary, sensing, homeostasis, personhood, law, civilization",
          },
        },
        route_metadata: {
          source_target_intent: {
            selected_capability: "internet-search.search_web",
            args: {
              query: "organism personhood law civilization moral status",
            },
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_living_substrate_context",
    ]);
    const args = requests[0].arguments as Record<string, any>;
    expect(args.next_affordances).toEqual([
      expect.objectContaining({
        source: "helix_moral_graph_primary_request_reduction",
        capability: "internet-search.search_web",
        purpose: "codex_selected_followup_tool",
        reason: "available_after_moral_graph_observation_reentry",
        query: "organism personhood law civilization moral status",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(args.source_target_intent.next_affordances).toEqual(
      args.next_affordances,
    );
  });

  it("keeps explicitly requested external research adjacent to Moral Graph substrate reflection", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use moral-graph.reflect_living_substrate_context for organism boundary and sensing, and also search web sources for current evidence.",
        source_target_intent: {
          selected_capability: "moral-graph.reflect_living_substrate_context",
          args: {
            query: "organism boundary and sensing",
          },
        },
        route_metadata: {
          source_target_intent: {
            selected_capability: "internet-search.search_web",
            args: {
              query: "current evidence organism sensing moral status",
            },
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_living_substrate_context",
      "internet-search.search_web",
    ]);
    expect(
      (requests[0].arguments as Record<string, any>).next_affordances,
    ).toBeUndefined();
  });

  it("keeps explicit Moral Graph reflection primary when adjacent evidence families are negated", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use moral-graph.reflect_context. Reflect on delayed disclosure in a shared obligation. Identify the dependency, who needed the information, what deadline preserved agency, and what repair path should be considered. Do not use calculator, image, PDF, page, or web evidence.",
        workspace_context_snapshot: {
          activePanel: "image-lens",
          focusedPanel: "image-lens",
          openPanels: [
            "image-lens",
            "postulate-board",
            "scientific-calculator",
          ],
          activeCalculatorContext: {
            expression: "8*9",
            result: 72,
          },
        },
        route_metadata: {
          source_target_intent: {
            selected_capability: "scholarly-research.lookup_papers",
            args: {
              query: "delayed disclosure shared obligation agency harm",
            },
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual(["moral-graph.reflect_context"]);
    expect(capabilities(requests)).not.toContain(
      "scholarly-research.lookup_papers",
    );
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
    const args = requests[0].arguments as Record<string, any>;
    expect(args.next_affordances).toBeUndefined();
    expect(args.source_target_intent).toMatchObject({
      rejected_adjacent_tool_families: expect.arrayContaining([
        "external_evidence",
        "page_evidence",
      ]),
      rejected_adjacent_capabilities: expect.arrayContaining([
        expect.objectContaining({
          capability: "scholarly-research.lookup_papers",
          reason: "negative_evidence_constraint",
          forbidden_families: expect.arrayContaining([
            "external_evidence",
            "page_evidence",
          ]),
          terminal_eligible: false,
          assistant_answer: false,
        }),
      ]),
    });
  });

  it("does not admit internet search from local current-whitepaper evidence wording", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Codex workstation API debug retest: use the current NHM2 whitepaper as bounded document evidence, calculate 8 * 9 with scientific-calculator.solve_expression, and reflect through the theory badge graph for the claim boundary. Answer what the evidence supports and what remains unproven.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(capabilities(requests)).not.toContain("internet-search.search_web");
    expect(
      requests.find(
        (request) =>
          request.capability_id === "helix_ask.reflect_theory_context",
      ),
    ).toBeUndefined();
  });

  it.each([
    "What is the current NHM2 research position? Explain it in plain English.",
    "What is the current Casimir-DP quantum foam study actually claiming?",
  ])("keeps soft current project-research wording from executing web search: %s", (question) => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question,
      },
    });

    expect(capabilities(requests)).not.toContain("internet-search.search_web");
  });

  it("does not admit internet search from scientific Image Lens exact-row retry wording", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the current page 5 crop ref and equation candidate as the target. Re-crop the exact row containing only equation (7), but do not require overlap with the prior page-level candidate if the crop text exactly matches the same equation. Promote only if the row crop is single-line, non-truncated, has LaTeX, and supports exact equation admissibility.",
      },
    });

    expect(capabilities(requests)).not.toContain("internet-search.search_web");
    expect(capabilities(requests)).not.toContain(
      "scholarly-research.lookup_papers",
    );
  });

  it("defers affirmative natural-language theory reflection fetch prompts to the runtime", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: "ok, can you fetch the theory reflection for fusion?",
      },
    });

    expect(capabilities(requests)).toEqual([]);
  });

  it("does not admit contextual, negated, future, quoted, UI-label, or mixed non-command theory reflection mentions", () => {
    const prompts = [
      "Do not fetch the theory reflection for fusion; explain what that would do.",
      "In the future we might fetch the theory reflection for fusion.",
      "The UI label says theory reflection for fusion.",
      'The phrase is "fetch the theory reflection for fusion"; explain it only.',
      "I am not asking you to fetch the theory reflection for fusion, just define the phrase.",
      "After you fetch the theory reflection for fusion, what would happen?",
    ];

    for (const question of prompts) {
      expect(
        readWorkstationGatewayCallRequestsForTurn({
          includePlannerDerived: true,
          body: {
            agent_runtime: "codex",
            question,
          },
        }),
      ).toEqual([]);
    }
  });

  it("admits explicitly named scholarly and internet capabilities without inferring either from prose", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use scholarly-research.lookup_papers for quantum inequality sampling, and internet-search.search_web for public corroboration.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
      "internet-search.search_web",
    ]);
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      arguments: {
        query: "quantum inequality sampling",
      },
    });
    expect(requests[1]).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      arguments: {
        query: "public corroboration",
      },
    });
  });

  it("routes an explicitly named full-text fetch directly from an arXiv PDF URL", () => {
    const prompt =
      "Use scholarly-research.fetch_full_text directly on https://arxiv.org/pdf/2401.12345. Report only whether machine-readable full text was obtained. Do not run scholarly-research.lookup_papers or use Image Lens.";

    const namedRequests = buildPromptNamedCapabilityGatewayCallRequests({
      question: prompt,
    });
    expect(capabilities(namedRequests)).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
    expect(namedRequests[0]).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      arguments: {
        source_url: "https://arxiv.org/pdf/2401.12345.pdf",
        source_target_intent: {
          target_source: "scholarly_research",
          target_kind: "research_paper_full_text",
          arxiv_id: "2401.12345",
        },
      },
    });

    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: { agent_runtime: "codex", question: prompt },
    });
    expect(capabilities(requests)).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
  });

  it("routes a natural-language old-style arXiv fetch despite narrower search negation", () => {
    const prompt =
      "FULLTEXT_SMOKE_01 — Fetch and parse the full text for arXiv gr-qc/9510071. Return the title, parsed page count, and one page-numbered equation. Do not search for other papers.";

    const namedRequests = buildPromptNamedCapabilityGatewayCallRequests({
      question: prompt,
    });
    expect(capabilities(namedRequests)).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
    expect(namedRequests[0]).toMatchObject({
      arguments: {
        source_url: "https://arxiv.org/pdf/gr-qc/9510071.pdf",
        source_target_intent: {
          target_source: "scholarly_research",
          target_kind: "research_paper_full_text",
          arxiv_id: "gr-qc/9510071",
        },
      },
    });

    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: { agent_runtime: "codex", question: prompt },
    });
    expect(capabilities(requests)).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
  });

  it("keeps lookup-first routing when the operator explicitly requests lookup then full text", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use scholarly-research.lookup_papers to resolve https://arxiv.org/abs/2401.12345, then use scholarly-research.fetch_full_text and report whether machine-readable full text was obtained.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_scholarly_workflow_planner",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        allow_scholarly_dependent_chain: true,
      },
    });
  });

  it("plans up to three distinct accessible full-text fetches when explicitly requested", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Find research papers about quantum inequality sampling constraints in curved spacetime. Fetch the best three accessible sources and summarize only from full text.",
      },
    });
    const lookupRequest = requests[0];
    expect(lookupRequest).toMatchObject({
      capability_id: "scholarly-research.lookup_papers",
      arguments: {
        requested_full_text_count: 3,
        allow_scholarly_dependent_chain: true,
      },
    });

    const papers = [1, 2, 3].map((ordinal) => ({
      result_id: `paper:qei-${ordinal}`,
      title: `Quantum inequality sampling constraints in curved spacetime ${ordinal}`,
      abstract:
        "Quantum inequality sampling constraints bound negative energy in curved spacetime.",
      identifiers: {
        arxiv_id: `2607.0000${ordinal}`,
        pdf_url: `https://arxiv.org/pdf/2607.0000${ordinal}.pdf`,
      },
    }));
    const lookupResult = {
      capability_id: "scholarly-research.lookup_papers",
      ok: true,
      gateway_admission: { source_target_intent: {} },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        query: "quantum inequality sampling constraints curved spacetime",
        papers,
      },
      observation_packet: {
        produced_artifact_refs: ["observation:lookup"],
        state_delta: {},
        suggested_next_steps: [],
      },
    } as any;

    const fetchOne = buildDependentCompoundCapabilityGatewayCallRequest({
      request: lookupRequest,
      result: lookupResult,
      results: [lookupResult],
      turnId: "turn:three-full-texts",
    });
    expect(fetchOne).toMatchObject({
      capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        paper_result_id: "paper:qei-1",
        requested_full_text_count: 3,
        full_text_fetch_index: 1,
        selected_full_text_paper_ids: ["paper:qei-1"],
      },
    });

    const makeFetchResult = (paperResultId: string) =>
      ({
        capability_id: "scholarly-research.fetch_full_text",
        ok: true,
        observation: {
          evidence_state: "full_text_usable",
          paper_result_id: paperResultId,
        },
        observation_packet: {
          produced_artifact_refs: [`observation:${paperResultId}`],
          state_delta: {},
        },
      }) as any;
    const fetchOneResult = makeFetchResult("paper:qei-1");
    const fetchTwo = buildDependentCompoundCapabilityGatewayCallRequest({
      request: fetchOne!,
      result: fetchOneResult,
      results: [lookupResult, fetchOneResult],
      turnId: "turn:three-full-texts",
    });
    expect(fetchTwo).toMatchObject({
      capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        paper_result_id: "paper:qei-2",
        full_text_fetch_index: 2,
        selected_full_text_paper_ids: ["paper:qei-1", "paper:qei-2"],
      },
    });

    const fetchTwoResult = makeFetchResult("paper:qei-2");
    const fetchThree = buildDependentCompoundCapabilityGatewayCallRequest({
      request: fetchTwo!,
      result: fetchTwoResult,
      results: [lookupResult, fetchOneResult, fetchTwoResult],
      turnId: "turn:three-full-texts",
    });
    expect(fetchThree).toMatchObject({
      capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        paper_result_id: "paper:qei-3",
        full_text_fetch_index: 3,
        selected_full_text_paper_ids: [
          "paper:qei-1",
          "paper:qei-2",
          "paper:qei-3",
        ],
      },
    });

    const fetchThreeResult = makeFetchResult("paper:qei-3");
    expect(
      buildDependentCompoundCapabilityGatewayCallRequest({
        request: fetchThree!,
        result: fetchThreeResult,
        results: [
          lookupResult,
          fetchOneResult,
          fetchTwoResult,
          fetchThreeResult,
        ],
        turnId: "turn:three-full-texts",
      }),
    ).toBeNull();
  });

  it("does not spend the three-source budget on a cross-provider duplicate paper", () => {
    const title =
      "Quantum Field Theory Constrains Traversable Wormhole Geometries";
    const lookupRequest = {
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      capability_id: "scholarly-research.lookup_papers",
      arguments: {
        query: "quantum inequality negative energy traversable wormholes",
        scholarly_claim_portfolio: true,
        allow_scholarly_dependent_chain: true,
        requested_full_text_count: 3,
        scholarly_intent: { requested_workflow: "full_text_summary" },
      },
    } as any;
    const papers = [
      {
        result_id: "arxiv:ford-roman",
        title,
        abstract:
          "Quantum inequalities bound sampled negative energy and constrain wormholes.",
        identifiers: {
          arxiv_id: "gr-qc/9510071",
          pdf_url: "https://arxiv.org/pdf/gr-qc/9510071.pdf",
        },
      },
      {
        result_id: "semantic:ford-roman",
        title,
        abstract:
          "Quantum inequalities bound sampled negative energy and constrain wormholes.",
        identifiers: {
          doi: "10.1103/PhysRevD.53.5496",
          pdf_url: "https://arxiv.org/pdf/gr-qc/9510071",
        },
      },
      {
        result_id: "arxiv:fewster-roman",
        title:
          "Problems with Wormholes Which Involve Arbitrarily Small Amounts of Exotic Matter",
        abstract:
          "A null-contracted quantum inequality constrains negative energy in traversable wormholes.",
        identifiers: {
          arxiv_id: "gr-qc/0510079",
          pdf_url: "https://arxiv.org/pdf/gr-qc/0510079.pdf",
        },
      },
    ];
    const lookupResult = {
      capability_id: "scholarly-research.lookup_papers",
      ok: true,
      gateway_admission: { source_target_intent: {} },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        query: "quantum inequality negative energy traversable wormholes",
        papers,
      },
      observation_packet: {
        produced_artifact_refs: ["observation:cross-provider-lookup"],
        state_delta: {},
        suggested_next_steps: [],
      },
    } as any;
    const makeFetchResult = (paperResultId: string) =>
      ({
        capability_id: "scholarly-research.fetch_full_text",
        ok: true,
        observation: {
          evidence_state: "full_text_usable",
          paper_result_id: paperResultId,
        },
        observation_packet: {
          produced_artifact_refs: [`observation:${paperResultId}`],
          state_delta: {},
        },
      }) as any;

    const fetchOne = buildDependentCompoundCapabilityGatewayCallRequest({
      request: lookupRequest,
      result: lookupResult,
      results: [lookupResult],
      turnId: "turn:cross-provider-full-text-dedupe",
    })!;
    expect((fetchOne.arguments as any).papers).toHaveLength(2);
    expect((fetchOne.arguments as any).paper_result_id).toBe(
      "arxiv:ford-roman",
    );

    const fetchOneResult = makeFetchResult("arxiv:ford-roman");
    const fetchTwo = buildDependentCompoundCapabilityGatewayCallRequest({
      request: fetchOne,
      result: fetchOneResult,
      results: [lookupResult, fetchOneResult],
      turnId: "turn:cross-provider-full-text-dedupe",
    })!;
    expect((fetchTwo.arguments as any).paper_result_id).toBe(
      "arxiv:fewster-roman",
    );

    const fetchTwoResult = makeFetchResult("arxiv:fewster-roman");
    expect(
      buildDependentCompoundCapabilityGatewayCallRequest({
        request: fetchTwo,
        result: fetchTwoResult,
        results: [lookupResult, fetchOneResult, fetchTwoResult],
        turnId: "turn:cross-provider-full-text-dedupe",
      }),
    ).toBeNull();
  });

  it("aggregates resolved claim lookups before choosing three accessible full-text sources", () => {
    const body = {
      agent_runtime: "codex",
      question: [
        "Use the scientific claims in your immediately previous answer.",
        "Decompose them separately, search arXiv and the other scholarly providers,",
        "return a diverse claim-to-citation map, identify accessible full text,",
        "and fetch the best three accessible sources.",
        "Distinguish metadata-only evidence from full-text evidence.",
      ].join(" "),
      workspace_context_snapshot: {
        chat_referent_context: {
          schema: "helix.ask.chat_referent_context.v1",
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "reply-claim-portfolio",
            source_ref: "chat.final_answer.previous:reply-claim-portfolio",
            text: [
              "- Quantum inequalities bound sampled negative energy along an observer worldline.",
              "- Longer sampling durations tighten negative-energy magnitude limits.",
              "- Quantum interest requires compensating positive-energy pulses.",
              "- Quantum inequalities constrain traversable wormhole and warp-drive geometries.",
            ].join("\n"),
          },
        },
      },
    };
    const lookups = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body,
    }).filter(
      (request) => request.capability_id === "scholarly-research.lookup_papers",
    );

    expect(lookups).toHaveLength(4);
    const portfolioCloser = lookups.at(-1)!;
    expect(portfolioCloser).toMatchObject({
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        requested_full_text_count: 3,
        scholarly_claim_portfolio: true,
      },
    });

    const lookupResults = lookups.map((request: any, index) => {
      const resultId = `paper:claim-${index + 1}`;
      return {
        capability_id: "scholarly-research.lookup_papers",
        ok: true,
        gateway_admission: {
          source_target_intent: request.arguments.source_target_intent,
        },
        observation: {
          schema: "helix.scholarly_research_observation.v1",
          query: request.arguments.query,
          papers: [
            {
              result_id: resultId,
              title: request.arguments.query,
              abstract: request.arguments.query,
              provider: "arxiv",
              identifiers: {
                arxiv_id: `2607.1000${index + 1}`,
                pdf_url: `https://arxiv.org/pdf/2607.1000${index + 1}.pdf`,
              },
            },
          ],
        },
        observation_packet: {
          produced_artifact_refs: [`observation:claim-${index + 1}`],
          state_delta: {},
          suggested_next_steps: [],
        },
      } as any;
    });

    const firstFetch = buildDependentCompoundCapabilityGatewayCallRequest({
      request: portfolioCloser,
      result: lookupResults.at(-1)!,
      results: lookupResults,
      turnId: "turn:claim-portfolio",
    });

    expect(firstFetch).toMatchObject({
      capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        requested_full_text_count: 3,
        full_text_fetch_index: 1,
        paper_result_id: "paper:claim-1",
        selected_full_text_paper_ids: ["paper:claim-1"],
      },
    });
    expect(
      (firstFetch as any).arguments.papers.map((paper: any) => paper.result_id),
    ).toEqual([
      "paper:claim-1",
      "paper:claim-2",
      "paper:claim-3",
      "paper:claim-4",
    ]);
    expect(
      (firstFetch as any).arguments.source_target_intent.source_refs,
    ).toEqual([
      "observation:claim-1",
      "observation:claim-2",
      "observation:claim-3",
      "observation:claim-4",
    ]);
  });

  it("defers an ordinary deictic paper query to the runtime agent", () => {
    const body = {
      agent_runtime: "codex",
      turn_id: "ask:compound-docs-scholarly-referent",
      thread_id: "thread:compound-docs-scholarly-referent",
      question:
        "Find one accessible primary paper that gives the strongest reality check on that assumption, then compare it with the NHM2 whitepaper and cite both.",
      workspace_context_snapshot: {
        chat_referent_context: {
          schema: "helix.ask.chat_referent_context.v1",
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "reply-nhm2-assumption",
            source_ref:
              "chat.final_answer.previous:reply-nhm2-assumption",
            text: [
              "NHM2 assumes its scalar wall/source proxy can be closed into a conserved same-basis physical stress-energy tensor.",
              "Quantum-inequality and material gates remain unproven.",
            ].join(" "),
          },
        },
      },
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:compound-docs-scholarly-referent",
      selectedRoute: "/ask",
    });

    expect(body).toMatchObject({
      canonical_goal_frame: {
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        allows_workspace_context: true,
        allows_prior_artifacts: true,
      },
      route_product_contract: {
        source_target: "compound_evidence",
        required_terminal_kind: "compound_evidence_synthesis_answer",
        evidence_reentry_required: true,
        followup_reasoning_required: true,
      },
      tool_call_admission_decision: {
        admitted_tool_families: expect.arrayContaining([
          "docs_viewer",
          "scholarly_research",
        ]),
        compound_requested_capabilities: expect.arrayContaining([
          "docs.search",
          "scholarly-research.lookup_papers",
        ]),
      },
    });

    const lookups = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body,
    }).filter(
      (request) =>
        request.capability_id === "scholarly-research.lookup_papers",
    );

    expect(lookups).toEqual([]);
  });

  it("preserves explicit local Docs plus arXiv comparison authority before gateway execution", () => {
    const body = {
      agent_runtime: "codex",
      turn_id: "ask:compound-docs-explicit-arxiv",
      thread_id: "thread:compound-docs-explicit-arxiv",
      question:
        "Open the NHM2 current status whitepaper in the local docs and compare its source-closure caution with the primary paper arXiv:2105.03079. Explain where they agree and where the paper does not validate NHM2, citing both sources.",
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: body.turn_id,
      selectedRoute: "/ask/turn",
    });

    expect(body).toMatchObject({
      source_target_intent: {
        explicit_cues: expect.arrayContaining([
          "compound_local_docs_external_scholarly_comparison",
        ]),
      },
      canonical_goal_frame: {
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      route_product_contract: {
        source_target: "compound_evidence",
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      tool_call_admission_decision: {
        admitted_tool_families: expect.arrayContaining([
          "docs_viewer",
          "scholarly_research",
        ]),
        compound_requested_capabilities: expect.arrayContaining([
          "docs.search",
          "scholarly-research.lookup_papers",
        ]),
      },
    });

    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body,
    });
    expect(requests.map((request) => request.capability_id)).toEqual(
      expect.arrayContaining([
        "docs.search",
        "scholarly-research.lookup_papers",
      ]),
    );
  });

  it("ranks claim-relevant accessible papers ahead of generic quantum-information matches", () => {
    const claimQueries = [
      "Quantum inequalities bound sampled negative energy along an observer worldline.",
      "Longer sampling durations tighten negative-energy magnitude limits.",
      "Quantum interest requires compensating positive-energy pulses.",
      "Quantum inequalities constrain traversable wormhole and warp-drive geometries.",
    ];
    const makePaper = (
      resultId: string,
      title: string,
      abstract: string,
      arxivId: string,
    ) => ({
      result_id: resultId,
      title,
      abstract,
      provider: "arxiv",
      identifiers: {
        arxiv_id: arxivId,
        pdf_url: `https://arxiv.org/pdf/${arxivId}.pdf`,
      },
    });
    const papersByClaim = [
      [
        makePaper(
          "paper:quantum-noise",
          "Deviation bounds and concentration inequalities for quantum noises",
          "Concentration bounds for stochastic quantum information systems.",
          "2607.20001",
        ),
        makePaper(
          "paper:ford-roman",
          "Quantum Field Theory Constrains Traversable Wormhole Geometries",
          "Quantum inequalities bound negative energy sampled on timelike worldlines and restrict traversable wormholes.",
          "gr-qc/9510071",
        ),
      ],
      [
        makePaper(
          "paper:marginal-bounds",
          "New Quantum Bounds for Inequalities involving Marginal Expectations",
          "Bounds on marginal expectations in quantum information and Bell scenarios.",
          "2607.20002",
        ),
      ],
      [
        makePaper(
          "paper:ford-review",
          "Negative Energy Densities in Quantum Field Theory",
          "Quantum inequalities limit the magnitude and duration of negative energy and describe quantum interest.",
          "0911.3597",
        ),
      ],
      [
        makePaper(
          "paper:contextuality",
          "Characterising and bounding the set of quantum behaviours in contextuality scenarios",
          "Quantum contextuality bounds and Bell-type inequalities.",
          "2607.20003",
        ),
        makePaper(
          "paper:fewster-roman",
          "Problems with wormholes which involve arbitrarily small amounts of exotic matter",
          "A null-contracted quantum inequality constrains traversable wormholes and negative exotic matter.",
          "gr-qc/0510079",
        ),
      ],
    ];
    const lookupResults = claimQueries.map((query, index) => ({
      capability_id: "scholarly-research.lookup_papers",
      ok: true,
      gateway_admission: { source_target_intent: {} },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        query,
        papers: papersByClaim[index],
      },
      observation_packet: {
        produced_artifact_refs: [`observation:relevance-${index + 1}`],
        state_delta: {},
        suggested_next_steps: [],
      },
    })) as any[];
    const request = {
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      capability_id: "scholarly-research.lookup_papers",
      arguments: {
        query: claimQueries.at(-1),
        scholarly_claim_portfolio: true,
        allow_scholarly_dependent_chain: true,
        requested_full_text_count: 3,
        scholarly_intent: { requested_workflow: "full_text_summary" },
      },
    };

    const firstFetch = buildDependentCompoundCapabilityGatewayCallRequest({
      request,
      result: lookupResults.at(-1),
      results: lookupResults,
      turnId: "turn:claim-relevance-ranking",
    });
    expect(firstFetch).toMatchObject({
      capability_id: "scholarly-research.fetch_full_text",
      arguments: { paper_result_id: "paper:ford-roman" },
    });

    const fetchedIds = [(firstFetch as any).arguments.paper_result_id];
    let nextRequest = firstFetch as any;
    for (let index = 0; index < 2; index += 1) {
      const fetchedId = nextRequest.arguments.paper_result_id;
      const fetchResult = {
        capability_id: "scholarly-research.fetch_full_text",
        ok: true,
        observation: {
          evidence_state: "full_text_usable",
          paper_result_id: fetchedId,
        },
        observation_packet: {
          produced_artifact_refs: [`observation:${fetchedId}`],
          state_delta: {},
        },
      } as any;
      nextRequest = buildDependentCompoundCapabilityGatewayCallRequest({
        request: nextRequest,
        result: fetchResult,
        results: [...lookupResults, fetchResult],
        turnId: "turn:claim-relevance-ranking",
      }) as any;
      fetchedIds.push(nextRequest.arguments.paper_result_id);
    }
    expect(fetchedIds).toEqual([
      "paper:ford-roman",
      "paper:ford-review",
      "paper:fewster-roman",
    ]);
    expect(fetchedIds).not.toContain("paper:quantum-noise");
    expect(fetchedIds).not.toContain("paper:marginal-bounds");
    expect(fetchedIds).not.toContain("paper:contextuality");
    expect(nextRequest.arguments.source_target_intent.source_refs).toEqual([
      "observation:relevance-1",
      "observation:relevance-2",
      "observation:relevance-3",
      "observation:relevance-4",
    ]);
  });

  it("routes explicit arXiv PDF page Image Lens extraction as scholarly full-text workflow, not numeric extraction", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          'Use the paper titled "General Relativity and Weyl Frames" with arXiv id 1106.5543v1. Fetch the PDF, render page 1 into Image Lens, and extract the first displayed equation or equation-like row. Do not run a new broad lookup unless the arXiv fetch fails.',
        workspace_context_snapshot: {
          activePanel: "image-lens",
          focusedPanel: "image-lens",
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
    expect(requests[0]).toMatchObject({
      derivation_source: "helix_prompt_named_capability",
      arguments: {
        source_url: "https://arxiv.org/pdf/1106.5543v1.pdf",
        source_target_intent: expect.objectContaining({
          target_source: "scholarly_research",
          target_kind: "research_paper_full_text",
          arxiv_id: "1106.5543v1",
        }),
      },
    });
    expect(JSON.stringify(requests)).not.toContain(
      "scholarly-research.extract_numeric_parameters",
    );
  });

  it("does not let sentence-leading words leak into mixed prompt calculator expressions", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the current document and scientific-calculator.solve_expression for 8*9. Explain both observations and keep the claim boundary clear.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(
      requests.find(
        (request) =>
          request.capability_id === "scientific-calculator.solve_expression",
      ),
    ).toMatchObject({
      arguments: {
        expression: "8*9",
      },
    });
  });

  it("preserves direct structured read-only capability admissions in a mixed itinerary", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question: "Use docs.search and theory reflection before answering.",
      source_target_intent: {
        selected_capability: "docs.search",
        args: {
          query: "Helix Ask workstation loop",
          paths: ["docs/helix-ask-flow.md"],
        },
      },
      route_metadata: {
        source_target_intent: {
          selected_capability: "theory-badge-graph.reflect_discussion_context",
          args: {
            query:
              "Reflect QEI margin and claim boundary against the theory graph.",
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "helix_ask.reflect_theory_context",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "docs.search",
      mode: "read",
      arguments: {
        query: "Helix Ask workstation loop",
        paths: ["docs/helix-ask-flow.md"],
      },
    });
    expect(requests[1]).toMatchObject({
      capability_id: "helix_ask.reflect_theory_context",
      mode: "read",
      arguments: {
        prompt:
          "Reflect QEI margin and claim boundary against the theory graph.",
      },
    });
  });

  it("normalizes structured workspace_diagnostic admission to workspace_os.status execution", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question: "Use workspace_os.status to inspect workstation status.",
      source_target_intent: {
        selected_capability: "workspace_diagnostic",
        target_source: "workspace_diagnostic",
        target_kind: "workspace_diagnostic",
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "workspace_os.status",
        mode: "observe",
        arguments: {
          source_target_intent: expect.objectContaining({
            selected_capability: "workspace_diagnostic",
          }),
        },
      }),
    ]);
  });

  it("maps admitted visual source context to the bounded SituationRun gateway", () => {
    const requests = buildStructuredAdmissionWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question: "What is happening right now in the visual screen capture?",
      sessionId: "helix-ask:test:visual-source",
      source_target_intent: {
        target_source: "visual_capture",
        target_kind: "visual_capture",
        strength: "hard",
        selected_capability: "image_lens.inspect",
      },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_structured_source_target_admission",
        capability_id: "situation-room.describe_visual_capture",
        mode: "read",
        arguments: {
          thread_id: "helix-ask:test:visual-source",
          prompt: "What is happening right now in the visual screen capture?",
          source_target_intent: expect.objectContaining({
            target_source: "visual_capture",
            target_kind: "visual_capture",
            selected_capability: "situation-room.describe_visual_capture",
            alias_capability: "image_lens.inspect",
          }),
        },
      }),
    ]);
  });

  it("maps theory reflection planner steps into the workstation gateway", () => {
    const requests = buildPlannerDerivedWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Reflect QEI margin and source residual against the theory badge graph, then explain the claim boundary.",
    });

    expect(capabilities(requests)).toEqual([
      "helix_ask.reflect_theory_context",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "helix_ask.reflect_theory_context",
      mode: "read",
      arguments: {
        prompt: expect.stringContaining("QEI margin"),
      },
    });
  });

  it("maps Moral Graph living-substrate planner steps into the workstation gateway", () => {
    const requests = buildPlannerDerivedWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use the Moral Graph to derive moral relevance from organism boundary, sensing, homeostasis, entropy pressure, and non-human living systems.",
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_living_substrate_context",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "moral-graph.reflect_living_substrate_context",
      mode: "read",
      arguments: {
        prompt: expect.stringContaining("organism boundary"),
        include_theory_bridge: true,
        include_recommended_actions: true,
        source_target_intent: expect.objectContaining({
          target_source: "moral_graph",
          target_kind: "moral_living_substrate_reflection",
          intent: "moral_living_substrate_reflection",
          step_id: "reflect_moral_living_substrate_context",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
    });
  });

  it("maps theory-first Moral Graph substrate prompts to theory then Moral substrate gateway calls", () => {
    const requests = buildPlannerDerivedWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use the Moral Graph with Hameroff Orch OR microtubule physics, organism sensing, homeostasis, and Fourier frequency mapping as the mechanism, then translate living-system dynamics into moral obligations and constraints.",
    });

    expect(capabilities(requests)).toEqual([
      "moral-graph.reflect_living_substrate_context",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "moral-graph.reflect_living_substrate_context",
      arguments: {
        source_target_intent: expect.objectContaining({
          depends_on: [],
        }),
      },
    });
    const args = requests[0].arguments as Record<string, any>;
    expect(args.next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "helix_ask.reflect_theory_context",
          purpose: "codex_selected_followup_tool",
          reason: "available_after_observation_reentry",
        }),
      ]),
    );
    expect(args.source_target_intent.next_affordances).toEqual(
      args.next_affordances,
    );
  });

  it("keeps planner-derived theory plus calculator chains to a primary reflection request", () => {
    const requests = buildPlannerDerivedWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Reflect photon energy through the theory badge graph and calculate 6.626e-34 * 5e14.",
    });

    expect(capabilities(requests)).toEqual([
      "helix_ask.reflect_theory_context",
    ]);
    const args = requests[0].arguments as Record<string, any>;
    expect(args.next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "scientific-calculator.solve_expression",
          purpose: "codex_selected_followup_tool",
          expression: "6.626e-34*5e14",
        }),
      ]),
    );
    expect(args.source_target_intent.next_affordances).toEqual(
      args.next_affordances,
    );
  });

  it("does not turn unrelated workstation panel action plans into gateway calls", () => {
    const requests = buildPlannerDerivedWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question:
        'Run panel action panel_id=narrator action_id=narrator.debug_auto_speak_probe text="probe".',
    });

    expect(requests).toEqual([]);
  });

  it("maps civilization bounds planner steps into the workstation gateway", () => {
    const requests = buildPlannerDerivedWorkstationGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Reflect the civilization bounds and collaboration constraints for this system.",
    });

    expect(capabilities(requests)).toEqual([
      "civilization-bounds.reflect_system_bounds",
    ]);
    expect(requests[0]).toMatchObject({
      capability_id: "civilization-bounds.reflect_system_bounds",
      mode: "read",
    });
  });

  it("does not derive repo search from negated repo-search wording", () => {
    const requests = buildPromptDerivedRepoSearchGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Do not search the repo for workstation_gateway; just explain what evidence would be needed.",
    });

    expect(requests).toEqual([]);
  });

  it("does not derive repo search from scholarly URL tokens or scientific source wording", () => {
    const requests = buildPromptDerivedRepoSearchGatewayCallRequests({
      agent_runtime: "codex",
      question: [
        "If consciousness is holographic, a small region may reconstruct a fuzzy image from the original coherent source.",
        "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013;jsessionid=synthetic-session-id",
        "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
      ].join(" "),
    });

    expect(requests).toEqual([]);
  });

  it("retains an affirmative repo search when a scholarly URL is supporting context", () => {
    const requests = buildPromptDerivedRepoSearchGatewayCallRequests({
      agent_runtime: "codex",
      question: [
        "Search the repo for scholarly-research-intent.ts and compare the implementation with this source:",
        "https://pubmed.ncbi.nlm.nih.gov/2813384/",
      ].join(" "),
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "repo.search",
        arguments: expect.objectContaining({
          query: "scholarly-research-intent.ts",
        }),
      }),
    ]);
  });

  it("retains repo search and exact PMID metadata when only general web search is negated", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question: [
          "Search the repo for scholarly-research-intent.ts and use",
          "https://pubmed.ncbi.nlm.nih.gov/2813384/ as supporting paper metadata.",
          "Explain exact PMID routing and distinguish code evidence from paper evidence.",
          "Do not search the general web.",
        ].join(" "),
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
      "repo.search",
    ]);
    expect(requests[0]).toMatchObject({
      arguments: {
        query: "PMID:2813384",
        providers: ["pubmed"],
      },
    });
    expect(requests[1]).toMatchObject({
      arguments: { query: "scholarly-research-intent.ts" },
    });
  });

  it("keeps PMID metadata lookup while honoring a full-text prohibition", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Look up PMID 2813384 and report its metadata. Do not fetch full text.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(requests[0]).toMatchObject({
      arguments: {
        query: "PMID:2813384",
        providers: ["pubmed"],
      },
    });
  });

  it("does not execute a future PMID lookup", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Later, if needed, look up PMID 2813384. For now explain the evidence boundary without running tools.",
      },
    });

    expect(requests).toEqual([]);
  });

  it("keeps an explicit general-web citation request in the internet family", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Search the web for current OpenAI API status and cite the sources you use.",
      },
    });

    expect(capabilities(requests)).toEqual(["internet-search.search_web"]);
  });

  it("does not add general web search for a supplied scholarly source", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013 as a supporting scholarly source for this claim.",
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
  });

  it("maps natural repo search variants named in the contract", () => {
    const prompts = [
      "Find workstation_gateway in the repository.",
      "Look in the codebase for workstation_gateway.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptDerivedRepoSearchGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([
        expect.objectContaining({
          capability_id: "repo.search",
          mode: "read",
          arguments: expect.objectContaining({
            query: "workstation_gateway",
          }),
        }),
      ]);
    }
  });

  it("derives a focused repo query for implementation how-questions", () => {
    const requests = buildPromptDerivedRepoSearchGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "how tell me from the code repo search, how does the locator work for theory badge graph?",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "repo.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: "theory badge graph locator",
          query_terms: expect.arrayContaining([
            "Theory Badge Graph reflection produced",
            "theory-badge-overlap-locator",
            "theory-context-reflection-tool",
            "runHelixTheoryContextReflectionTool",
            "reflect_discussion_context",
            "located_badge_ids",
          ]),
          source_target_intent: expect.objectContaining({
            query: "theory badge graph locator",
            query_derivation: expect.objectContaining({
              schema: "helix.repo_search_query_derivation.v1",
              derived_query: "theory badge graph locator",
              derived_terms: expect.arrayContaining([
                "theory-badge-overlap-locator",
                "theory-context-reflection-tool",
                "runHelixTheoryContextReflectionTool",
              ]),
              rejected_terms: ["how"],
              assistant_answer: false,
              raw_content_included: false,
            }),
          }),
        }),
      }),
    ]);
  });

  it("keeps underspecified affirmative repo search as an explicit blocked-capable request", () => {
    const requests = buildPromptDerivedRepoSearchGatewayCallRequests({
      agent_runtime: "codex",
      question: "Search the repo and tell me what you find.",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "repo.search",
        mode: "read",
        arguments: expect.objectContaining({
          source_target_intent: expect.objectContaining({
            target_source: "repo_code",
            target_kind: "repo_search",
            blocked_reason: "missing_query",
          }),
        }),
      }),
    ]);
    expect(
      (requests[0].arguments as Record<string, unknown>).query,
    ).toBeUndefined();
  });

  it("turns underspecified repo search into a typed gateway block instead of silently dropping it", async () => {
    const results = await runExplicitWorkstationGatewayCalls({
      agentRuntime: "codex",
      body: {
        agent_runtime: "codex",
        question: "Search the repo and tell me what you find.",
      },
      turnId: "ask:test:repo-search-missing-query",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: false,
      capability_id: "repo.search",
      error: "missing_query",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "missing_query",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("materializes natural implementation-location language as repo.search", () => {
    const requests = buildPromptDerivedRepoSearchGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Find where the Helix Ask terminal authority is implemented in this codebase and name the most relevant file.",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "repo.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: "Helix Ask terminal authority",
          source_target_intent: expect.objectContaining({
            target_source: "repo_code",
            target_kind: "repo_search",
          }),
        }),
      }),
    ]);
  });

  it("maps workspace status prompts to workspace_os.status observations", () => {
    const requests = buildPromptDerivedWorkspaceStatusGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Check the workspace OS status and tell me which capabilities are available.",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "workspace_os.status",
        mode: "observe",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "workspace_os",
            target_kind: "workspace_status",
            reason_codes: expect.arrayContaining(["workspace_os_phrase"]),
          }),
        },
      }),
    ]);
  });

  it("keeps a hard workstation-status route from inheriting a current-web search", () => {
    const body: Record<string, unknown> = {
      agent_runtime: "codex",
      question: "What is the current workstation status?",
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: "ask:test:natural-workstation-status",
      selectedRoute: "/ask/turn",
    });
    const requests = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });

    expect(body.committed_ask_route).toMatchObject({
      route: { source_target: "workspace_diagnostic" },
      capability_policy: {
        allowed_tool_families: ["workspace_diagnostic"],
      },
    });
    expect(capabilities(requests)).toEqual(["workspace_os.status"]);
  });

  it("maps affirmative voice-lane prompts to text-to-speech gateway requests", () => {
    const requests = buildPromptDerivedVoiceGatewayCallRequests({
      agent_runtime: "codex",
      question: "Use the voice lane to say checking now",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "text_to_speech.speak_text",
        mode: "act",
        arguments: expect.objectContaining({
          text: "checking now",
          kind: "tool_progress",
          source_target_intent: expect.objectContaining({
            target_source: "voice_delivery",
            target_kind: "text_to_speech",
          }),
        }),
      }),
    ]);
  });

  it("extracts quoted TTS payloads before post-reentry instructions", () => {
    const question =
      "Live browser voice-tool test: use the governed text_to_speech.speak_text voice lane to say exactly 'browser voice receipt check'. After the receipt re-enters, answer in one sentence with the receipt playback_status.";

    expect(
      buildPromptNamedCapabilityGatewayCallRequests({
        agent_runtime: "codex",
        question,
      }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "text_to_speech.speak_text",
        mode: "act",
        arguments: expect.objectContaining({
          text: "browser voice receipt check",
          kind: "tool_progress",
          source_target_intent: expect.objectContaining({
            target_source: "voice_delivery",
            target_kind: "text_to_speech",
          }),
        }),
      }),
    ]);
    expect(
      buildPromptDerivedVoiceGatewayCallRequests({
        agent_runtime: "codex",
        question,
      }),
    ).toEqual([]);

    expect(
      buildPromptDerivedVoiceGatewayCallRequests({
        agent_runtime: "codex",
        question:
          "Live browser voice-tool test: use the governed voice lane to say exactly 'browser voice receipt check'. After the receipt re-enters, answer in one sentence with the receipt playback_status.",
      }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "text_to_speech.speak_text",
        arguments: expect.objectContaining({
          text: "browser voice receipt check",
        }),
      }),
    ]);
  });

  it("does not map quoted voice tool mentions to voice gateway requests", () => {
    const requests = buildPromptDerivedVoiceGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "The text says live_env.request_interim_voice_callout; explain it only.",
    });

    expect(requests).toEqual([]);
  });

  it("does not map negated speak-aloud instructions to voice gateway requests", () => {
    const requests = buildPromptDerivedVoiceGatewayCallRequests({
      agent_runtime: "codex",
      question: "Do not speak aloud, just explain the voice tool.",
    });

    expect(requests).toEqual([]);
  });

  it("does not map client read-aloud projection wording to provider voice gateway requests", () => {
    const prompts = [
      "Use client.read_aloud to read the answer.",
      "Click Read aloud after the answer is done.",
      "The UI button says Read aloud; explain that button.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptDerivedVoiceGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("does not treat broad translate prompts as active translation surface reads", () => {
    const prompts = [
      "Translate thank you to French.",
      "Translate this text.",
      "Translate the visible section of this document.",
      "Use the translation lane for this text.",
      "Start translating this document.",
      "Later we might translate the visible section, but not now.",
      "Do not translate or read the active translation surface.",
    ];

    for (const question of prompts) {
      const requests = readWorkstationGatewayCallRequestsForTurn({
        includePlannerDerived: true,
        body: {
          turn_id: "ask:test:broad-translate-not-surface",
          agent_runtime: "codex",
          question,
          workspace_context_snapshot: {
            activePanel: "docs-viewer",
            activeDocPath: "docs/helix-ask-flow.md",
            activeTranslationAccountLocale: "es-MX",
            activeTranslationTargetLanguage: "es",
            activeTranslationBlocks: [
              {
                unit_id: "doc-unit:1",
                translated_text: "Translated sentence.",
              },
            ],
          },
        },
      });

      expect(capabilities(requests)).not.toContain(
        "docs-viewer.read_active_translation",
      );
    }
  });

  it("keeps explicit existing translation surface prompts on the surface reader", () => {
    const prompts = [
      "Read the active translation surface.",
      "Inspect the translated surface.",
      "What translated text is currently visible?",
      "Read the visible already-translated section.",
    ];

    for (const question of prompts) {
      const requests = readWorkstationGatewayCallRequestsForTurn({
        includePlannerDerived: true,
        body: {
          turn_id: "ask:test:existing-translation-surface",
          agent_runtime: "codex",
          question,
          workspace_context_snapshot: {
            activePanel: "docs-viewer",
            activeDocPath: "docs/helix-ask-flow.md",
            activeTranslationAccountLocale: "es-MX",
            activeTranslationTargetLanguage: "es",
            activeTranslationBlocks: [
              {
                unit_id: "doc-unit:1",
                translated_text: "Translated sentence.",
                status: "ready",
              },
            ],
          },
        },
      });

      expect(capabilities(requests)).toContain(
        "docs-viewer.read_active_translation",
      );
      const translationRequest = requests.find(
        (request) =>
          request.capability_id === "docs-viewer.read_active_translation",
      );
      expect(translationRequest?.arguments).toMatchObject({
        account_locale: "es-MX",
        target_language: "es",
        source_target_intent: {
          account_locale: "es-MX",
          target_language: "es",
        },
      });
    }
  });

  it("keeps structured live translation lane calls observation-only and separate from surface reads", async () => {
    const body = {
      turn_id: "ask:test:structured-live-translation-lane",
      agent_runtime: "codex",
      question:
        "Use the structured lane call result, not the docs translation surface.",
      capability_lane_call: {
        capability: "live_translation.translate_text",
        text: "thank you",
        target_language: "fr",
        source_language: "en",
        chunk_id: "chunk:test:thank-you",
        requested_backend_provider: "live_translation.local_runtime",
      },
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
      },
    };

    const lane = await runHelixCapabilityLaneOneShotRequests({
      provider: buildTestProvider("codex"),
      body,
      turnId: "ask:test:structured-live-translation-lane",
      env: {} as NodeJS.ProcessEnv,
    });
    const requests = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });

    expect(capabilities(requests)).not.toContain(
      "docs-viewer.read_active_translation",
    );
    expect(lane.call_results).toHaveLength(1);
    expect(lane.call_results[0]).toMatchObject({
      ok: true,
      capability: "live_translation.translate_text",
      lane_id: "live_translation",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(lane.observation_packets[0]).toMatchObject({
      capability_key: "live_translation.translate_text",
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("still routes read-aloud existing translated surfaces through surface observation before narrator", async () => {
    const body = {
      turn_id: "ask:test:read-aloud-existing-translated-surface",
      agent_runtime: "codex",
      question: "Read aloud the visible translated section of this document.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
        activeTranslationAccountLocale: "es-MX",
        activeTranslationTargetLanguage: "es",
        activeTranslationBlocks: [
          {
            unit_id: "doc-unit:1",
            source_text: "Helix Ask flow",
            translated_text: "Flujo de Helix Ask",
            locale: "es",
            status: "ready",
          },
        ],
      },
    };
    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      capability_id: "docs-viewer.read_active_translation",
      dependent_capability_id: "live_env.narrator_say",
    });

    const results = await runExplicitWorkstationGatewayCalls({
      agentRuntime: "codex",
      turnId: "ask:test:read-aloud-existing-translated-surface",
      body,
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "docs-viewer.read_active_translation",
    ]);
    expect(results[0]).toMatchObject({
      ok: true,
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        text: "Flujo de Helix Ask",
        translation: {
          account_locale: "es-MX",
          target_language: "es",
        },
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("runs the derived voice gateway request as a non-terminal receipt", async () => {
    resetInterimVoiceCalloutsForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapUsed: 120 * 1024 * 1024,
        heapTotal: 512 * 1024 * 1024,
        rss: 640 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });
    const results = await runExplicitWorkstationGatewayCalls({
      agentRuntime: "codex",
      body: {
        agent_runtime: "codex",
        question: "Use the voice lane to say checking now",
      },
      turnId: "ask:test:explicit-derived-voice",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      capability_id: "text_to_speech.speak_text",
      observation: {
        schema: "helix.interim_voice_callout_tool_result.v1",
        request: {
          text: "checking now",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        receipt: {
          status: "awaiting_client_playback",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(results[0]?.observation_packet.state_delta).toMatchObject({
      text_to_speech_client_playback_handoff: {
        schema: "helix.interim_voice_callout_tool_result.v1",
        request: {
          text: "checking now",
          assistant_answer: false,
          terminal_eligible: false,
        },
        receipt: {
          status: "awaiting_client_playback",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
    });
  });

  it("does not treat backend voice retry queue as a successful client handoff", async () => {
    resetInterimVoiceCalloutsForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapUsed: 3_000 * 1024 * 1024,
        heapTotal: 3_100 * 1024 * 1024,
        rss: 3_200 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });

    try {
      const results = await runExplicitWorkstationGatewayCalls({
        agentRuntime: "codex",
        body: {
          agent_runtime: "codex",
          question: "Use the voice lane to say checking now",
        },
        turnId: "ask:test:explicit-derived-voice-capacity-blocked",
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        ok: false,
        capability_id: "text_to_speech.speak_text",
        observation: {
          receipt: {
            status: "queued_for_retry",
            playback_status: "unavailable",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
          host_projection: {
            playback_status: "queued_for_retry",
            normalized_playback_status: "unavailable",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
        observation_packet: {
          status: "blocked",
        },
        error: "queued_for_retry",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      });
    } finally {
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
      resetInterimVoiceCalloutsForTest();
    }
  });

  it("maps named workspace_os.status capability prompts to observations", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use workspace_os.status to inspect workstation status. Answer only from that observation.",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "workspace_os.status",
        mode: "observe",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "workspace_os",
            target_kind: "workspace_status",
            reason_codes: expect.arrayContaining(["prompt_named_capability"]),
          }),
        },
      }),
    ]);
  });

  it("does not map negated named workspace_os.status capability prompts", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Do not use workspace_os.status; explain what that capability would observe later.",
    });

    expect(requests).toEqual([]);
  });

  it("admits named context-feed query capabilities as read-only gateway observations", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use live_env.query_visual_summaries, live_env.query_translation_segments, live_env.query_microdeck_outputs, live_env.query_packet_traces, and live_env.query_automation_policies.",
    });

    expect(capabilities(requests)).toEqual([
      "live_env.query_visual_summaries",
      "live_env.query_translation_segments",
      "live_env.query_microdeck_outputs",
      "live_env.query_packet_traces",
      "live_env.query_automation_policies",
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        mode: "read",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "live_environment_context_feed",
            explicit_cues: expect.arrayContaining(["prompt_named_capability"]),
          }),
        },
      });
    }
  });

  it("does not map quoted or negated context-feed capability prompts", () => {
    const prompts = [
      "The text says live_env.query_visual_summaries; explain that phrase only.",
      "Do not run live_env.query_packet_traces; explain what packet traces would show.",
      "The UI label contains live_env.query_automation_policies.",
      "In the future we might use live_env.query_translation_segments.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("admits named live-source state read capabilities as read-only gateway observations", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use live_env.query_live_source_quality, live_env.query_workstation_goal_context, and live_env.summarize_live_source_current_state.",
    });

    expect(capabilities(requests)).toEqual([
      "live_env.query_live_source_quality",
      "live_env.query_workstation_goal_context",
      "live_env.summarize_live_source_current_state",
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        mode: "read",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "live_source_state",
            explicit_cues: expect.arrayContaining(["prompt_named_capability"]),
          }),
        },
      });
    }
  });

  it("does not map quoted or negated live-source state read capability prompts", () => {
    const prompts = [
      "The text says live_env.query_live_source_quality; explain that phrase only.",
      "Do not run live_env.query_workstation_goal_context; explain what it would observe.",
      "The UI label contains live_env.summarize_live_source_current_state.",
      "In the future we might use live_env.query_live_source_quality.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("admits named situation/stage state read capabilities as read-only gateway observations", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use live_env.query_event_log, live_env.query_world_events, live_env.query_navigation_state, live_env.query_stage_sources, live_env.query_constructs, and live_env.query_job_evidence.",
    });

    expect(capabilities(requests)).toEqual([
      "live_env.query_event_log",
      "live_env.query_world_events",
      "live_env.query_navigation_state",
      "live_env.query_stage_sources",
      "live_env.query_constructs",
      "live_env.query_job_evidence",
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        mode: "read",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "situation_stage_state",
            explicit_cues: expect.arrayContaining(["prompt_named_capability"]),
          }),
        },
      });
    }
  });

  it("does not map quoted or negated situation/stage state read capability prompts", () => {
    const prompts = [
      "The text says live_env.query_event_log; explain that phrase only.",
      "Do not run live_env.query_stage_sources; explain what stage sources are.",
      "The UI label contains live_env.query_navigation_state.",
      "In the future we might use live_env.query_job_evidence.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("admits named live-source mailbox read capabilities as read-only gateway observations", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use live_env.check_live_source_mail, live_env.read_live_source_mail, live_env.read_processed_live_source_mail, and live_env.reflect_live_source_mail_loop.",
    });

    expect(capabilities(requests)).toEqual([
      "live_env.check_live_source_mail",
      "live_env.read_live_source_mail",
      "live_env.read_processed_live_source_mail",
      "live_env.reflect_live_source_mail_loop",
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        mode: "read",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "live_source_mailbox",
            explicit_cues: expect.arrayContaining(["prompt_named_capability"]),
          }),
        },
      });
    }
  });

  it("does not map quoted or negated live-source mailbox capability prompts", () => {
    const prompts = [
      "The text says live_env.check_live_source_mail; explain that phrase only.",
      "Do not run live_env.read_live_source_mail; explain what it would read.",
      "The UI label contains live_env.read_processed_live_source_mail.",
      "In the future we might use live_env.reflect_live_source_mail_loop.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("admits named live-source interpreter/prediction reads as read-only gateway observations", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use live_env.compare_mail_to_interpreter_profile, live_env.validate_live_source_prediction, live_env.predict_live_source_immediate, and live_env.compare_live_source_prediction.",
    });

    expect(capabilities(requests)).toEqual([
      "live_env.compare_mail_to_interpreter_profile",
      "live_env.validate_live_source_prediction",
      "live_env.predict_live_source_immediate",
      "live_env.compare_live_source_prediction",
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        mode: "read",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "live_source_interpreter_prediction",
            explicit_cues: expect.arrayContaining(["prompt_named_capability"]),
          }),
        },
      });
    }
  });

  it("does not map quoted or negated live-source interpreter/prediction prompts", () => {
    const prompts = [
      "The text says live_env.compare_mail_to_interpreter_profile; explain that phrase only.",
      "Do not run live_env.validate_live_source_prediction; explain what it would validate.",
      "The UI label contains live_env.predict_live_source_immediate.",
      "In the future we might use live_env.compare_live_source_prediction.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("admits named Stage Play builder read/eval capabilities as read-only gateway observations", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use live_env.describe_stage_builder, live_env.validate_stage_play_graph, and live_env.plan_stage_play_job.",
    });

    expect(capabilities(requests)).toEqual([
      "live_env.describe_stage_builder",
      "live_env.validate_stage_play_graph",
      "live_env.plan_stage_play_job",
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        mode: "read",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "stage_play_builder",
            explicit_cues: expect.arrayContaining(["prompt_named_capability"]),
          }),
        },
      });
    }
  });

  it("does not map quoted or negated Stage Play builder capability prompts", () => {
    const prompts = [
      "The text says live_env.describe_stage_builder; explain that phrase only.",
      "Do not run live_env.validate_stage_play_graph; explain what it would validate.",
      "The UI label contains live_env.plan_stage_play_job.",
      "In the future we might use live_env.describe_stage_builder.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("admits named visual observer read/test capabilities without exposing visual observer controls", () => {
    const requests = buildPromptNamedCapabilityGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Use live_env.query_visual_observer_profiles, then live_env.test_visual_observer_profile, then live_env.compare_visual_observer_profiles for this source summary.",
    });

    expect(capabilities(requests)).toEqual([
      "live_env.query_visual_observer_profiles",
      "live_env.test_visual_observer_profile",
      "live_env.compare_visual_observer_profiles",
    ]);
    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "live_env.query_visual_observer_profiles",
        mode: "read",
        arguments: expect.objectContaining({
          source_target_intent: expect.objectContaining({
            target_source: "visual_observer",
            explicit_cues: expect.arrayContaining(["prompt_named_capability"]),
          }),
        }),
      }),
      expect.objectContaining({
        capability_id: "live_env.test_visual_observer_profile",
        mode: "read",
      }),
      expect.objectContaining({
        capability_id: "live_env.compare_visual_observer_profiles",
        mode: "read",
      }),
    ]);
  });

  it("does not map quoted or negated visual observer capability prompts", () => {
    const prompts = [
      "The text says live_env.test_visual_observer_profile; explain that phrase only.",
      "Do not run live_env.compare_visual_observer_profiles; explain what it would compare.",
      "The UI button is labeled live_env.query_visual_observer_profiles.",
      "In the future we might use live_env.test_visual_observer_profile.",
    ];

    for (const question of prompts) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("does not map held-back side-effect or mutating live_env capabilities into provider gateway requests", () => {
    const prompts = [
      "Use live_env.narrator_bind_stream for transcript stream.",
      "Use narrator.bind_stream for transcript stream.",
      "Use live_env.record_voice_steering now.",
      "Use live_env.process_live_source_mail now.",
      "Use live_env.apply_visual_observer_profile now.",
      "Use live_env.evaluate_goal_satisfaction now.",
      "Use live_env.pause_workstation_loop now.",
      "Use live_env.configure_route_watch now.",
      "Use live_env.repair_workstation_source now.",
    ];

    for (const question of prompts) {
      expect(
        readWorkstationGatewayCallRequestsForTurn({
          includePlannerDerived: true,
          body: {
            agent_runtime: "codex",
            question,
          },
        }),
      ).toEqual([]);
    }
  });

  it("does not admit non-shared provider classifications except canonical voice aliases", () => {
    const canonicalVoiceAliases = new Set(["narrator.say"]);

    for (const classification of PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS) {
      if (classification.provider_availability.codex_workstation) continue;
      const requests = readWorkstationGatewayCallRequestsForTurn({
        includePlannerDerived: true,
        body: {
          agent_runtime: "codex",
          question: `Use ${classification.capability_id} now.`,
        },
      });

      expect(
        capabilities(requests),
        classification.capability_id,
      ).not.toContain(classification.capability_id);
      if (canonicalVoiceAliases.has(classification.capability_id)) {
        expect(capabilities(requests)).toEqual(["text_to_speech.speak_text"]);
      } else {
        expect(requests, classification.capability_id).toEqual([]);
      }
    }
  });

  it("keeps workspace status in a compound read-only itinerary", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use the current document, check workspace OS status, calculate 6*7, and search the repo for workstation_gateway.",
        workspace_context_snapshot: docSnapshot,
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "workspace_os.status",
      "scientific-calculator.solve_expression",
      "repo.search",
    ]);
  });

  it("keeps repo search while deferring reflection in compound prompts", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect QEI margin against the theory badge graph and search the repo for workstation_gateway before answering.",
      },
    });

    expect(capabilities(requests)).toEqual(["repo.search"]);
    expect(capabilities(requests)).not.toContain(
      "helix_ask.reflect_theory_context",
    );
    expect(requests[0]).toMatchObject({
      capability_id: "repo.search",
      arguments: {
        query: "workstation_gateway",
      },
    });
  });

  it("defers scientific Image Lens evidence reflection and keeps unrelated search tools suppressed", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect the promoted equation evidence to the Theory Badge Graph with diagnostic-only boundaries and report calculator template admissibility. Include source/hash and evidence depth from the prior scientific sidecar.",
        route_metadata: {
          schema: "helix.ask.route_metadata.v1",
          source: "hard_tool_backend_entrypoint",
          sourceTarget: "scientific_image_evidence",
          requiredToolFamily: "visual_analysis",
          source_target_intent: {
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            must_enter_backend_ask: true,
            allow_client_shortcut: false,
          },
          mandatory_next_tool: {
            tool_name: "visual_analysis.inspect_image_region",
            missing_required_evidence: "scientific_evidence_sidecar",
            canonical_goal: "scientific_image",
          },
        },
      },
    });

    expect(capabilities(requests)).toEqual([]);
    expect(JSON.stringify(requests)).not.toMatch(
      /scholarly-research\.lookup_papers|internet-search\.search_web|repo\.search/,
    );
  });

  it("keeps the Codex workstation acceptance prompt as a multi-tool itinerary", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "use this current NHM2 document, calculate 6*7, search research papers on arXiv for quantum inequalities and warp constraints, reflect QEI margin through theory badge graph, and reflect civilization bounds",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "civilization-bounds.reflect_system_bounds",
      "scholarly-research.lookup_papers",
    ]);
    expect(
      requests.find((request) => request.capability_id === "docs.search"),
    ).toMatchObject({
      arguments: {
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        source_target_intent: expect.objectContaining({
          retained_source_context: true,
        }),
      },
    });
    expect(
      requests.find(
        (request) =>
          request.capability_id === "scientific-calculator.solve_expression",
      ),
    ).toMatchObject({
      arguments: {
        expression: "6*7",
      },
    });
  });

  it("keeps named whitepaper evidence and scholarly corroboration in Codex compound prompts", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "I am trying to judge whether the NHM2 Casimir tile generation idea is a serious diagnostic engineering direction, a speculative metaphor, or something in between. Use the NHM2 whitepaper as document evidence, calculate 6 * 7 as a small scalar sanity check, reflect through the theory badge graph for where the claim should be bounded, apply civilization bounds for what social/energy/material conditions would have to be true, and check scholarly papers for corroboration. Give me a practical answer: what can I responsibly believe from this evidence, what remains unproven, and what should I test next?",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "civilization-bounds.reflect_system_bounds",
      "scholarly-research.lookup_papers",
    ]);
    expect(
      requests.find((request) => request.capability_id === "docs.search"),
    ).toMatchObject({
      arguments: {
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
      },
    });
    expect(
      requests.find(
        (request) =>
          request.capability_id === "scholarly-research.lookup_papers",
      ),
    ).toMatchObject({
      arguments: {
        source_target_intent: expect.objectContaining({
          target_kind: "research_paper_search",
        }),
      },
    });
  });

  it("binds anaphoric numeric research follow-ups to the latest theory reflection equation context", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "ok, can you grab numerics that we can use for these equations based on what the equation means? Use research papers to cite",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          latest_theory_reflection_equation_context: {
            schema: "helix.latest_theory_reflection_equation_context.v1",
            source: "theory_map_overlay_live_answer_context",
            reflection_id: "reflection:fusion",
            summary:
              "Theory Badge Graph reflection found physics.nuclear.reaction.thermonuclear_rate_context as a fusion-adjacent calculator template.",
            calculator_payloads: [
              {
                badge_id: "physics.nuclear.reaction.thermonuclear_rate_context",
                badge_title: "Thermonuclear Rate Context",
                payload_id: "thermonuclear-rate-context",
                expression:
                  "rate_proxy_m3_s = n1_m3 * n2_m3 * sigma_m2 * v_m_s",
                target_variable: "rate_proxy_m3_s",
                claim_boundary_notes: ["diagnostic/proxy only"],
              },
            ],
            matched_badges: [
              {
                badge_id: "physics.nuclear.reaction.thermonuclear_rate_context",
                title: "Thermonuclear Rate Context",
                matched_equation_families: [
                  "thermonuclear reaction rate",
                  "fusion cross section",
                ],
                matched_symbols: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
              },
            ],
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            context_role: "tool_evidence",
            ask_context_policy: "evidence_only",
          },
        },
      },
    });

    const scholarlyRequest = requests.find(
      (request) => request.capability_id === "scholarly-research.lookup_papers",
    );
    expect(scholarlyRequest).toMatchObject({
      derivation_source: "helix_compound_capability_dependency_planner",
      compound_outcome: "research_quantify_reflect",
      arguments: {
        allow_scholarly_dependent_chain: true,
        requested_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
      },
    });
    const args = scholarlyRequest?.arguments as Record<string, unknown>;
    expect(String(args.query)).toMatch(/thermonuclear reaction rate/i);
    expect(String(args.query)).toMatch(/fusion cross section/i);
    expect(String(args.query)).not.toMatch(
      /genome|sign-language|deformable-object/i,
    );
    expect(args.variable_source_plan).toMatchObject({
      formula_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
      prior_theory_formula_context: {
        schema: "helix.prior_theory_formula_context.v1",
        source_ref: "reflection:fusion",
        formulas: ["rate_proxy_m3_s = n1_m3 * n2_m3 * sigma_m2 * v_m_s"],
        variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
    });
    expect(
      (args.source_target_intent as Record<string, any>).query_plan,
    ).toMatchObject({
      schema: "helix.scholarly_variable_source_query_plan.v1",
      prior_theory_formula_context: {
        formulas: ["rate_proxy_m3_s = n1_m3 * n2_m3 * sigma_m2 * v_m_s"],
      },
    });
  });

  it("treats cited source-bound formula numerics as scholarly evidence collection before calculator binding", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Based on the prior Theory Badge Graph plasma beta formulas beta = p_Pa / p_B, p_Pa = n_m3 * T_eV * e_charge, and p_B = B_T^2 / (2 * mu0), find cited research-paper numerical values we could use for n_m3, T_eV, and B_T. Return suggestions with units and explain whether they are sufficiently source-bound for calculator binding.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
    expect(capabilities(requests)).toContain(
      "scholarly-research.lookup_papers",
    );
    const scholarlyRequest = requests.find(
      (request) => request.capability_id === "scholarly-research.lookup_papers",
    );
    expect(scholarlyRequest).toMatchObject({
      derivation_source: "helix_compound_capability_dependency_planner",
      compound_outcome: "research_quantify_reflect",
      arguments: {
        requested_variables: ["n_m3", "T_eV", "B_T"],
        allow_scholarly_dependent_chain: true,
      },
    });
    expect(JSON.stringify(scholarlyRequest)).toMatch(
      /source[-_ ]?bound|calculator binding|unit/i,
    );
  });

  it("routes paper-backed theory formula binding to scholarly lookup instead of docs search", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Reflect a fusion-adjacent Theory Badge Graph formula suitable for paper-backed numeric binding. Return the formula, variables, and the next research evidence needed. Do not run the calculator yet.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(capabilities(requests)).not.toContain("docs.search");
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
    const scholarlyRequest = requests[0] as Record<string, any>;
    expect(scholarlyRequest).toMatchObject({
      derivation_source: "helix_compound_capability_dependency_planner",
      compound_outcome: "research_quantify_reflect",
      arguments: {
        allow_scholarly_dependent_chain: true,
      },
    });
    expect(
      scholarlyRequest.arguments.source_target_intent.next_affordances,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "helix_ask.reflect_theory_context",
        }),
      ]),
    );
    expect(
      JSON.stringify(scholarlyRequest.arguments.source_requirement_plan),
    ).toMatch(/calculator_requires_bound_expression/);
  });

  it("does not let planner-derived calculator execution override a negated calculator instruction", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "patched-compound-flow-178301-step1: Reflect a fusion-adjacent Theory Badge Graph formula suitable for paper-backed numeric binding. Return the formula, variables, and the next research evidence needed. Do not run the calculator yet.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
    expect(JSON.stringify(requests)).not.toContain('"expression":"-178301-"');
  });

  it("defers theory-only formula discovery without pre-running research or calculator", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Find a fusion-adjacent formula from the Theory Badge Graph that could be numerically evaluated later. Return the formula, variables, and what each variable physically means. Do not use research papers or the calculator yet.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(capabilities(requests)).toEqual([]);
    expect(capabilities(requests)).not.toContain(
      "scholarly-research.lookup_papers",
    );
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
  });

  it("honors negated scholarly research cues even when research papers are mentioned", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Find a formula from the Theory Badge Graph for later paper-backed evaluation, but do not use research papers yet and do not run the calculator.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(capabilities(requests)).toEqual([]);
    expect(JSON.stringify(requests)).not.toMatch(
      /scholarly-research\.lookup_papers|scientific-calculator\.solve_expression/,
    );
  });

  it("does not treat Postulate Board Image Lens evidence refs as a fresh scholarly lookup request", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Revise this Postulate Board draft so its evidence refs cite the actual promoted page-grounded equation row, page number, crop ref, Image Lens source/hash, and evidence depth. Keep it candidate / diagnostic-only. Do not promote a badge or calculator payload.",
        workspace_context_snapshot: {
          activePanel: "postulate-board",
          focusedPanel: "image-lens",
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
        },
      },
    });

    expect(capabilities(requests)).not.toContain(
      "scholarly-research.lookup_papers",
    );
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
  });

  it("routes paper-backed numeric binding for a prior formula to scholarly research without docs or calculator", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Using the formula from the previous answer, find paper-backed numeric values or ranges for the variables. Prefer scholarly sources with units and citations. If retrieval is weak, explain the mismatch and suggest a better query. Do not run the calculator yet.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(capabilities(requests)).not.toContain("docs.search");
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
  });

  it("does not admit tools for conditional prior-evidence calculator follow-up without a bound expression", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "If the previous answer has enough cited unit-bearing values, bind the formula into a numeric expression and run the calculator. Then explain what the result means and what the evidence does not prove.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(requests).toEqual([]);
  });

  it("still admits calculator for conditional follow-up when a concrete expression is supplied", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "If the previous answer has enough cited unit-bearing values, run the calculator with expression: 6.626e-34 * 5e14.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(capabilities(requests)).toContain(
      "scientific-calculator.solve_expression",
    );
    expect(
      requests.find(
        (request) =>
          request.capability_id === "scientific-calculator.solve_expression",
      ),
    ).toMatchObject({
      arguments: {
        expression: "6.626e-34*5e14",
      },
    });
  });

  it("still admits scholarly lookup when the follow-up explicitly asks to retry retrieval", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "If the previous answer did not have enough cited unit-bearing values, search again for more scholarly papers with usable numeric values and units. Do not run the calculator yet.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
        },
      },
    });

    expect(capabilities(requests)).toContain(
      "scholarly-research.lookup_papers",
    );
    expect(capabilities(requests)).not.toContain(
      "scientific-calculator.solve_expression",
    );
  });

  it("keeps formula research compound planning to one primary request with next affordances", () => {
    const requests = buildCompoundCapabilityDependencyGatewayCallRequests({
      agent_runtime: "codex",
      question:
        "Find cited research-paper numerical values for plasma beta formula beta = p_Pa / p_B using scholarly papers and web sources, then reflect the claim boundary through the theory badge graph and civilization bounds before any calculator binding.",
      workspace_context_snapshot: {
        activePanel: "scientific-calculator",
        focusedPanel: "scientific-calculator",
      },
    });

    expect(capabilities(requests)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    const args = requests[0].arguments as Record<string, any>;
    expect(args.next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "internet-search.search_web" }),
        expect.objectContaining({
          capability: "helix_ask.reflect_theory_context",
        }),
        expect.objectContaining({
          capability: "civilization-bounds.reflect_system_bounds",
        }),
      ]),
    );
    expect(JSON.stringify(args.next_affordances)).not.toMatch(
      /scientific-calculator\.solve_expression/,
    );
    expect(args.source_target_intent.next_affordances).toEqual(
      args.next_affordances,
    );
  });

  it("does not auto-execute research-chain dependent requests that Codex should choose after re-entry", () => {
    expect(
      shouldAutoExecuteDependentCompoundRequest({
        compound_outcome: "research_quantify_reflect",
        capability_id: "scholarly-research.fetch_full_text",
        mode: "read",
      }),
    ).toBe(false);
    expect(
      shouldAutoExecuteDependentCompoundRequest({
        compound_outcome: "research_quantify_reflect",
        capability_id: "scholarly-research.extract_numeric_parameters",
        mode: "read",
      }),
    ).toBe(false);
    expect(
      shouldAutoExecuteDependentCompoundRequest({
        compound_outcome: "research_quantify_reflect",
        capability_id: "scientific-calculator.solve_expression",
        mode: "read",
      }),
    ).toBe(false);
    expect(
      shouldAutoExecuteDependentCompoundRequest({
        compound_outcome: "read_aloud_surface",
        capability_id: "live_env.narrator_say",
        mode: "act",
      }),
    ).toBe(false);
    expect(
      shouldAutoExecuteDependentCompoundRequest({
        compound_outcome: "unrelated_direct_actuator",
        capability_id: "live_env.narrator_say",
        mode: "act",
      }),
    ).toBe(true);
  });

  it("emits a scholarly recovery affordance instead of fetching full text for irrelevant formula-bound lookup results", () => {
    const variableSourcePlan = {
      schema: "helix.variable_source_plan.v1",
      source: "helix_compound_capability_dependency_planner",
      formula_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
      entries: [
        {
          variable: "n1_m3",
          source_classes: [
            "fusion plasma parameter table",
            "reactant density diagnostic",
          ],
          search_terms: [
            "reactant number density",
            "ion density",
            "fusion plasma parameters",
          ],
          extraction_aliases: ["n1", "reactant density"],
        },
        {
          variable: "sigma_m2",
          source_classes: [
            "fusion cross-section data",
            "Maxwellian-averaged reactivity table",
          ],
          search_terms: [
            "fusion cross section",
            "Maxwellian averaged reactivity",
            "sigma v",
          ],
          extraction_aliases: ["sigma", "cross section"],
        },
      ],
      query_terms: [
        "fusion",
        "thermonuclear reaction rate",
        "fusion cross section",
        "n1_m3",
        "n2_m3",
        "sigma_m2",
        "v_m_s",
      ],
      retrieval_intent:
        "Find papers that report unit-bearing physical quantities needed to bind the formula variables.",
      assistant_answer: false,
      raw_content_included: false,
    };
    const request = {
      compound_outcome: "research_quantify_reflect",
      subgoal_id: "research_quantify_reflect:scholarly_evidence",
      capability_id: "scholarly-research.lookup_papers",
      arguments: {
        query:
          "fusion thermonuclear reaction rate parameter table fusion cross section n1_m3 n2_m3 sigma_m2 v_m_s",
        allow_scholarly_dependent_chain: true,
        requested_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
        variable_source_plan: variableSourcePlan,
      },
    };
    const result = {
      schema: "helix.workstation_tool_gateway.call_result.v1",
      manifest_version: "test",
      ok: true,
      agent_runtime: "codex",
      capability_id: "scholarly-research.lookup_papers",
      mode: "read",
      gateway_admission: {
        schema: "helix.workstation_tool_gateway.admission.v1",
        requested_capability: "scholarly-research.lookup_papers",
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        admission_reason: "test",
        source_target_intent: {
          source: "helix_compound_capability_dependency_planner",
          target_source: "scholarly_research",
          target_kind: "scholarly_lookup",
          compound_outcome: "research_quantify_reflect",
          subgoal_id: "research_quantify_reflect:scholarly_evidence",
          subgoal_ordinal: 1,
          required_observation_kind: "helix.scholarly_research_observation.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        query:
          "fusion thermonuclear reaction rate parameter table fusion cross section n1_m3 n2_m3 sigma_m2 v_m_s",
        papers: [
          {
            result_id: "paper:genome-remapping",
            title: "Fast genome remapping with sampling optimization",
            abstract:
              "We present a genome assembly polishing method for sequence remapping.",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: "turn:scholarly-recovery",
        iteration: 1,
        call_id: "call:lookup",
        decision_id: "decision:lookup",
        capability_key: "scholarly-research.lookup_papers",
        panel_id: "scholarly-research",
        action: "lookup_papers",
        status: "succeeded",
        produced_artifact_refs: ["observation:lookup"],
        observation_summary: "lookup returned irrelevant papers",
        receipts: [],
        missing_requirements: [],
        state_delta: {},
        suggested_next_steps: ["answer"],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_lifecycle_trace: {},
      tool_followup_decision: {},
      artifact_refs: ["observation:lookup"],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    } as any;

    const dependent = buildDependentCompoundCapabilityGatewayCallRequest({
      request,
      result,
      turnId: "turn:scholarly-recovery",
    });

    expect(dependent).toBeNull();
    expect(result.observation.lookup_relevance_gate).toMatchObject({
      status: "blocked",
      code: "lookup_result_irrelevant",
      rejected_results: [
        {
          result_id: "paper:genome-remapping",
          reasons: expect.arrayContaining([
            "missing_required_topic_terms",
            "missing_formula_source_terms",
          ]),
        },
      ],
    });
    expect(
      result.observation.scholarly_lookup_recovery_affordance,
    ).toMatchObject({
      schema: "helix.scholarly_lookup_recovery_affordance.v1",
      status: "available",
      recommended_next_capability: "scholarly-research.lookup_papers",
      expected_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
      next_affordances: expect.arrayContaining([
        expect.objectContaining({
          capability: "scholarly-research.lookup_papers",
          purpose: "retry_with_refined_query",
          reason: "low_relevance_results",
        }),
        expect.objectContaining({
          capability: "scholarly-research.fetch_full_text",
          reason: "blocked_until_relevant_source_ref_exists",
        }),
      ]),
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(
      JSON.stringify(result.observation.scholarly_lookup_recovery_affordance),
    ).toMatch(/deuterium tritium fusion/i);
    expect(
      JSON.stringify(result.observation.scholarly_lookup_recovery_affordance),
    ).toMatch(/sigma v/i);
    expect(
      result.observation_packet.state_delta
        .scholarly_lookup_recovery_affordance,
    ).toBe(result.observation.scholarly_lookup_recovery_affordance);
    expect(result.observation_packet.suggested_next_steps).toEqual(
      expect.arrayContaining(["use_another_tool", "repair", "fail_closed"]),
    );
    const railStatus = buildCompoundDependencyRailStatus({
      request,
      result,
      dependentRequest: dependent,
    });
    expect(railStatus).toMatchObject({
      rail_status: "blocked",
      subgoals: [
        expect.objectContaining({
          requested_capability: "scholarly-research.lookup_papers",
          executed_capability: "scholarly-research.lookup_papers",
          evidence_gathered: true,
          evidence_quality: "low_relevance",
          evidence_quality_satisfied: false,
          satisfied: false,
          rail_status: "evidence_gathered_not_satisfied",
          rail_failure_code: "lookup_result_irrelevant",
        }),
      ],
      first_broken_rail: expect.objectContaining({
        capability_id: "scholarly-research.fetch_full_text",
        reason: "lookup_result_irrelevant",
      }),
    });
    const turnPlan = buildTurnCompoundDependencyPlan({
      turnId: "turn:scholarly-recovery",
      results: [result],
    });
    expect(turnPlan).toMatchObject({
      schema: "helix.compound_capability_dependency_turn_plan.v1",
      rail_status: "blocked",
      satisfied_subgoal_count: 0,
      ordered_subgoals: [
        expect.objectContaining({
          subgoal_id: "research_quantify_reflect:scholarly_evidence",
          requested_capability: "scholarly-research.lookup_papers",
          executed_capability: "scholarly-research.lookup_papers",
          evidence_gathered: true,
          evidence_quality: "low_relevance",
          evidence_quality_satisfied: false,
          satisfied: false,
          rail_status: "evidence_gathered_not_satisfied",
          rail_failure_code: "lookup_result_irrelevant",
        }),
      ],
      first_broken_rail: expect.objectContaining({
        subgoal_id: "research_quantify_reflect:scholarly_evidence",
        rail_failure_code: "lookup_result_irrelevant",
      }),
    });
  });

  it("blocks calculator planning after formula-bound numeric extraction emits recovery evidence", () => {
    const variableSourcePlan = {
      schema: "helix.variable_source_plan.v1",
      source: "helix_compound_capability_dependency_planner",
      formula_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
      prior_theory_formula_context: {
        schema: "helix.prior_theory_formula_context.v1",
        source_ref: "reflection:fusion",
        formulas: ["rate_proxy_m3_s = n1_m3 * n2_m3 * sigma_m2 * v_m_s"],
        variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
        query_terms: ["thermonuclear reaction rate", "fusion cross section"],
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
      entries: [
        {
          variable: "n1_m3",
          source_classes: ["fusion plasma parameter table"],
          search_terms: ["reactant number density", "ion density"],
          extraction_aliases: ["n1", "reactant density"],
        },
        {
          variable: "n2_m3",
          source_classes: ["fusion plasma parameter table"],
          search_terms: ["reactant number density", "ion density"],
          extraction_aliases: ["n2", "reactant density"],
        },
        {
          variable: "sigma_m2",
          source_classes: ["fusion cross-section data"],
          search_terms: ["fusion cross section", "sigma v"],
          extraction_aliases: ["sigma", "cross section"],
        },
        {
          variable: "v_m_s",
          source_classes: [
            "relative velocity model",
            "Maxwellian-averaged reactivity table",
          ],
          search_terms: ["relative velocity", "Maxwellian averaged reactivity"],
          extraction_aliases: ["v", "relative velocity"],
        },
      ],
      query_terms: [
        "fusion",
        "thermonuclear reaction rate",
        "fusion cross section",
        "sigma v",
      ],
      retrieval_intent:
        "Find papers that report unit-bearing physical quantities needed to bind the formula variables.",
      assistant_answer: false,
      raw_content_included: false,
    };
    const theoryResult = {
      ok: true,
      capability_id: "theory-badge-graph.reflect_discussion_context",
      gateway_admission: {
        requested_capability: "theory-badge-graph.reflect_discussion_context",
      },
      observation: {
        calculator_payloads: [
          {
            expression: "rate_proxy_m3_s = n1_m3 * n2_m3 * sigma_m2 * v_m_s",
            badge_id: "physics.nuclear.reaction.thermonuclear_rate_context",
            payload_id: "thermonuclear-rate-context",
          },
        ],
      },
      observation_packet: {
        produced_artifact_refs: ["observation:theory"],
      },
      artifact_refs: ["observation:theory"],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    } as any;
    const numericResult = {
      ok: false,
      capability_id: "scholarly-research.extract_numeric_parameters",
      gateway_admission: {
        requested_capability: "scholarly-research.extract_numeric_parameters",
      },
      observation: {
        schema: "helix.scholarly_numeric_parameter_observation.v1",
        requested_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
        parameters: [],
        missing_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
        missing_requirements: ["missing_requested_numeric_variables"],
        variable_source_plan: variableSourcePlan,
        scholarly_numeric_recovery_affordance: {
          schema: "helix.scholarly_numeric_recovery_affordance.v1",
          status: "available",
          reason: "missing_requested_numeric_variables",
          recommended_next_capability: "scholarly-research.lookup_papers",
          missing_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
          recovery_queries: [
            "D-T fusion plasma deuterium tritium number density cross section relative velocity thermonuclear reaction rate",
          ],
          variable_source_plan: variableSourcePlan,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        selected_for_answer: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        produced_artifact_refs: ["observation:numeric"],
        state_delta: {
          scholarly_numeric_recovery_affordance: {
            schema: "helix.scholarly_numeric_recovery_affordance.v1",
            missing_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
          },
        },
      },
      artifact_refs: ["observation:numeric"],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      error: "missing_requested_numeric_variables",
    } as any;
    const request = {
      compound_outcome: "research_quantify_reflect",
      subgoal_id: "research_quantify_reflect:numeric_parameters",
      capability_id: "scholarly-research.extract_numeric_parameters",
      arguments: {
        variable_source_plan: variableSourcePlan,
        source_target_intent: {
          required_observation_kind:
            "helix.scholarly_numeric_parameter_observation.v1",
          subgoal_ordinal: 3,
        },
      },
    };

    const dependent = buildDependentCompoundCapabilityGatewayCallRequest({
      request,
      result: numericResult,
      results: [theoryResult, numericResult],
      turnId: "turn:fusion-numeric-recovery",
    });
    const railStatus = buildCompoundDependencyRailStatus({
      request,
      result: numericResult,
      results: [theoryResult, numericResult],
      dependentRequest: dependent,
    });

    expect(dependent).toBeNull();
    expect(railStatus).toMatchObject({
      schema: "helix.compound_capability_dependency_plan.v1",
      rail_status: "blocked",
      typed_affordance_binding: {
        status: "blocked",
        reason: "missing_numeric_value_evidence",
        missing_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
        rejected_expression:
          "rate_proxy_m3_s = n1_m3 * n2_m3 * sigma_m2 * v_m_s",
      },
      first_broken_rail: {
        capability_id: "scholarly-research.extract_numeric_parameters",
        reason: "missing_requested_numeric_variables",
      },
    });
    expect(JSON.stringify(railStatus)).toMatch(
      /scientific-calculator\.solve_expression/,
    );
    expect(JSON.stringify(railStatus)).toMatch(
      /missing_numeric_value_evidence/,
    );
    expect(
      JSON.stringify(
        numericResult.observation.scholarly_numeric_recovery_affordance,
      ),
    ).toMatch(/D-T fusion plasma/i);
  });

  it("blocks mutating live_env controls embedded in otherwise safe compound prompts", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use this current document, calculate 6*7, search research papers on arXiv for quantum inequalities, reflect the claim boundary through the theory badge graph, then use live_env.pause_workstation_loop and live_env.repair_workstation_source before answering.",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          focusedPanel: "docs-viewer",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "scholarly-research.lookup_papers",
    ]);
    expect(capabilities(requests)).not.toContain(
      "live_env.pause_workstation_loop",
    );
    expect(capabilities(requests)).not.toContain(
      "live_env.repair_workstation_source",
    );
  });

  it("keeps read-only live_env context queries available inside mixed compound prompts", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use this current document, calculate 6*7, run live_env.query_trace_memory, live_env.query_narrator_events, and live_env.query_audio_transcripts, then use live_env.pause_workstation_loop only if it is safe.",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          focusedPanel: "docs-viewer",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
    });

    expect(capabilities(requests)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "live_env.query_audio_transcripts",
      "live_env.query_trace_memory",
      "live_env.query_narrator_events",
    ]);
    expect(capabilities(requests)).not.toContain(
      "live_env.pause_workstation_loop",
    );
    for (const capabilityId of [
      "live_env.query_trace_memory",
      "live_env.query_narrator_events",
      "live_env.query_audio_transcripts",
    ]) {
      expect(
        requests.find((request) => request.capability_id === capabilityId),
      ).toMatchObject({
        mode: "read",
        arguments: {
          source_target_intent: expect.objectContaining({
            target_source: "live_environment_context_feed",
            target_kind: capabilityId,
          }),
        },
      });
    }
  });

  it("does not derive another workstation call during provider reasoning resume", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        provider_reasoning_resume: true,
        question: "Summarize the observation and provide the final answer.",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          focusedPanel: "docs-viewer",
          openPanels: ["docs-viewer"],
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
    });

    expect(requests).toEqual([]);
  });
});
