import { describe, expect, it } from "vitest";
import { buildTheoryContextReflectionV1 } from "../../../../shared/contracts/theory-context-reflection.v1";
import { buildIdeologyContextReflectionV1 } from "../../../../shared/ideology-context-reflection";
import { validateTheoryIdeologyBridgeV1 } from "../../../../shared/theory-ideology-bridge";
import { evaluateWorkstationToolReceipt } from "../workstation-tool-evaluator";
import {
  HELIX_ASK_THEORY_IDEOLOGY_BRIDGE_TOOL_NAME,
  runHelixAskTheoryIdeologyBridgeTool,
  theoryIdeologyBridgeHandler,
  theoryIdeologyBridgeSpec,
} from "../../../skills/helix-ask.theory-ideology-bridge";

const generatedAt = "2026-06-05T00:00:00.000Z";

function theoryReflection() {
  return buildTheoryContextReflectionV1({
    generatedAt,
    reflectionId: "theory-context-reflection:tool-test",
    graphId: "theory-badge-graph:test",
    input: {
      prompt: "entropy conservation boundary observation",
      conversationContext: null,
      mentionedEquations: [],
      mentionedSymbols: [],
      mentionedDomains: [],
      source: "helix_ask",
      confidenceMode: "soft_locator",
    },
    exactMatches: [
      {
        badgeId: "theory.entropy-boundary",
        title: "Entropy Boundary",
        score: 0.88,
        reasons: ["entropy drift boundary conservation"],
        matchedSymbols: [],
        matchedEquationFamilies: [],
        matchedRepoPaths: [],
        claimBoundaryNotes: ["Use as observation evidence, not final authority."],
      },
    ],
    likelyMatches: [],
    inferredDomains: [],
    overlay: {
      centerBadgeIds: ["theory.entropy-boundary"],
      highlightedBadgeIds: ["theory.entropy-boundary"],
      highlightedEdgeIds: [],
      heatByBadgeId: { "theory.entropy-boundary": 0.88 },
      exactBadgeIds: ["theory.entropy-boundary"],
      likelyBadgeIds: [],
      softRegion: null,
    },
    evidenceForAsk: {
      summary: "Entropy and boundary evidence are claim-boundary context.",
      claimBoundaries: ["Preserve analogy boundaries."],
      recommendedNextActions: [],
    },
  });
}

function ideologyReflection() {
  return buildIdeologyContextReflectionV1({
    generatedAt,
    reflectionId: "ideology-context-reflection:tool-test",
    graph: {
      graphId: "moral-graph:test",
      rootId: "wisdom-first-principles",
      source: "docs/ethos/ideology.json",
    },
    input: {
      kind: "user_prompt",
      summary: "Connect entropy and conservation to fairness without overclaiming.",
      refs: ["turn:bridge"],
    },
    matches: {
      exact: [
        {
          nodeId: "fairness-due-process-and-justification",
          label: "Fairness, Due Process, and Justification",
          score: 0.9,
          reasons: ["fairness due process"],
          tags: ["lens"],
          pathToRoot: ["wisdom-first-principles", "fairness-due-process-and-justification"],
        },
      ],
      likely: [
        {
          nodeId: "impermanence-entropy-and-revision",
          label: "Impermanence, Entropy, and Revision",
          score: 0.78,
          reasons: ["entropy revision"],
          tags: ["lens"],
          pathToRoot: ["wisdom-first-principles", "impermanence-entropy-and-revision"],
        },
      ],
      inferred_lenses: [],
    },
    activated_traits: [],
    claim_boundaries: {
      diagnostic_only: true,
      avoid_character_judgment: true,
      needs_user_confirmation: true,
    },
    recommended_actions: [],
  });
}

describe("Helix Ask Theory-Moral bridge tool", () => {
  it("returns a valid evidence-only bridge", async () => {
    const output = await runHelixAskTheoryIdeologyBridgeTool({
      prompt: "Bridge entropy, conservation, fairness, and due process.",
      refs: ["turn:bridge"],
      theoryReflection: theoryReflection(),
      ideologyReflection: ideologyReflection(),
    });

    expect(validateTheoryIdeologyBridgeV1(output.bridge)).toEqual([]);
    expect(output.bridge.artifactId).toBe("theory_ideology_bridge");
    expect(output.bridge.schemaVersion).toBe("theory_ideology_bridge/v1");
    expect(output.bridge.links.map((link) => link.relation)).toEqual(
      expect.arrayContaining(["constrains", "analogy_only"]),
    );
    expect(output.bridge.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      context_role: "tool_policy",
      ask_context_policy: "evidence_only",
      agent_executable: false,
      moral_finality: false,
      execution_permission: false,
      physics_proves_morality: false,
    });
  });

  it("can suppress recommended actions without changing bridge authority", async () => {
    const output = await theoryIdeologyBridgeHandler({
      prompt: "Bridge observation with fairness.",
      theoryReflection: theoryReflection(),
      ideologyReflection: ideologyReflection(),
      options: { includeRecommendedActions: false },
    }, {});

    const result = output as Awaited<ReturnType<typeof runHelixAskTheoryIdeologyBridgeTool>>;
    expect(validateTheoryIdeologyBridgeV1(result.bridge)).toEqual([]);
    expect(result.bridge.recommendedActions).toEqual([]);
  });

  it("rejects invalid ideology reflection input", async () => {
    await expect(
      theoryIdeologyBridgeHandler({
        prompt: "Bridge observation with fairness.",
        ideologyReflection: { artifactId: "wrong" },
      }, {}),
    ).rejects.toThrow(/invalid_ideology_reflection/);
  });

  it("keeps forbidden physics-as-morality claims invalid", async () => {
    const output = await runHelixAskTheoryIdeologyBridgeTool({
      prompt: "Bridge entropy and fairness.",
      theoryReflection: theoryReflection(),
      ideologyReflection: ideologyReflection(),
    });
    const issues = validateTheoryIdeologyBridgeV1({
      ...output.bridge,
      links: [
        {
          ...output.bridge.links[0],
          explanation: "physics proves morality",
        },
      ],
    });

    expect(issues.some((issue) => issue.includes("forbidden theory-ideology overclaim text"))).toBe(true);
  });

  it("can be evaluated as bridge evidence, not final answer authority", async () => {
    const output = await runHelixAskTheoryIdeologyBridgeTool({
      prompt: "Bridge entropy and fairness.",
      theoryReflection: theoryReflection(),
      ideologyReflection: ideologyReflection(),
    });
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:bridge",
      turn_id: "turn:bridge",
      receipt: {
        ok: true,
        receipt_id: "receipt:bridge",
        kind: "helix_theory_ideology_bridge_tool_result",
        artifact: {
          kind: "helix_theory_ideology_bridge_tool_result",
          tool_id: HELIX_ASK_THEORY_IDEOLOGY_BRIDGE_TOOL_NAME,
          ...output,
        },
        evidence_refs: ["turn:bridge", output.bridge.bridgeId],
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toContain(
      "Theory/Moral bridge produced evidence-only procedural constraints",
    );
    expect(evaluation.model_invoked).toBe(false);
    expect(evaluation.deterministic_gate).toBe(true);
  });

  it("registers as deterministic non-privileged diagnostic tool metadata", () => {
    expect(theoryIdeologyBridgeSpec.name).toBe(HELIX_ASK_THEORY_IDEOLOGY_BRIDGE_TOOL_NAME);
    expect(theoryIdeologyBridgeSpec.deterministic).toBe(true);
    expect(theoryIdeologyBridgeSpec.risk).toMatchObject({
      writesFiles: false,
      touchesNetwork: false,
      privileged: false,
    });
    expect(theoryIdeologyBridgeSpec.provenance).toMatchObject({
      maturity: "diagnostic",
      certifying: false,
      metadataComplete: true,
      sourceClass: "declared",
    });
  });
});
