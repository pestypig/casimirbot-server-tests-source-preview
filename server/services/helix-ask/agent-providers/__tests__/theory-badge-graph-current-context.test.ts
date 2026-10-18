import { describe, expect, it } from "vitest";

import {
  buildActiveTheoryBadgeGraphContextWorkstationGatewayCallRequests,
  readWorkstationGatewayCallRequestsForTurn,
} from "../explicit-workstation-gateway";
import { arbitrateAskSourceTarget } from "../../ask-source-target-arbitrator";
import { buildCodexTheoryReflectionReceiptAnswer } from "../codex-provider";
import { isAffirmativeTheoryBadgeGraphReflectionPrompt } from "../../theory-badge-graph-current-context-intent";
import { buildPromptDerivedTheoryReflectionGatewayCallRequests } from "../prompt-named-tool-requests";

const currentContext = {
  schema: "helix.theory_badge_graph_current_context.v1",
  panel_id: "theory-badge-graph",
  graph_id: "helix-theory-badge-graph/v1",
  selected_badge_ids: ["element.h.origin", "physics.quantum.energy_frequency"],
  active_badge_id: "physics.quantum.energy_frequency",
  combination_reader: {
    schema: "theory_badge_graph_combination_reader/v1",
    selectedBadges: [
      { id: "element.h.origin", title: "Hydrogen" },
      { id: "physics.quantum.energy_frequency", title: "Quantum Energy-Frequency Relation" },
    ],
    tracePathBadges: [{ id: "physics.atomic.transition_gap_frequency_context", title: "Transition Gap" }],
    intermediateBadges: [{ id: "physics.atomic.transition_gap_frequency_context", title: "Transition Gap" }],
    availableNextBadges: [{ id: "physics.radiation.mode_context", title: "Radiation Mode" }],
  },
  panel_open: true,
  active_panel: true,
  answer_authority: false,
  terminal_eligible: false,
};

const bodyFor = (question: string): Record<string, unknown> => ({
  question,
  workspace_context_snapshot: {
    activePanel: "theory-badge-graph",
    openPanels: ["theory-badge-graph"],
    activeTheoryBadgeGraphContext: currentContext,
  },
});

describe("Theory Badge Graph current-context admission", () => {
  const levelOnePrompt =
    "Reflect the idea that deterministic microscopic laws can produce probabilistic macroscopic observations when information is lost through coarse-graining with the Theory Badge Graph.";
  const levelThreePrompt =
    "Now compare two interpretations with the Theory Badge Graph: first, that macroscopic probability is epistemic because coarse-graining hides deterministic microstates; second, that probability is fundamental rather than caused by missing information. Show where the graph supports or fails to represent each interpretation.";

  it("routes a long direct semantic subject through the Theory locator instead of model-only synthesis", () => {
    expect(isAffirmativeTheoryBadgeGraphReflectionPrompt(levelOnePrompt)).toBe(true);

    const intent = arbitrateAskSourceTarget({
      turnId: "ask:test:theory-level-one",
      threadId: "thread:test",
      promptText: levelOnePrompt,
    });

    expect(intent).toMatchObject({
      target_source: "theory_locator",
      target_kind: "theory_locator",
      strength: "hard",
      precedence_reason: "affirmative_theory_badge_graph_reflection_source_target",
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(intent.explicit_cues).toContain("affirmative_theory_badge_graph_reflection");

    const [request] = buildPromptDerivedTheoryReflectionGatewayCallRequests({ question: levelOnePrompt });
    expect(request).toMatchObject({
      capability_id: "helix_ask.reflect_theory_context",
      arguments: {
        prompt: expect.stringContaining("deterministic microscopic laws"),
        conversation_context: levelOnePrompt,
      },
    });
  });

  it("routes the exact Level 3 discourse-prefixed comparison through the Theory capability lane", () => {
    expect(isAffirmativeTheoryBadgeGraphReflectionPrompt(levelThreePrompt)).toBe(true);

    const intent = arbitrateAskSourceTarget({
      turnId: "ask:test:theory-level-three",
      threadId: "thread:test",
      promptText: levelThreePrompt,
    });

    expect(intent).toMatchObject({
      target_source: "theory_locator",
      target_kind: "theory_locator",
      strength: "hard",
      precedence_reason: "affirmative_theory_badge_graph_reflection_source_target",
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });

    const [request] = buildPromptDerivedTheoryReflectionGatewayCallRequests({ question: levelThreePrompt });
    expect(request).toMatchObject({
      capability_id: "helix_ask.reflect_theory_context",
      arguments: {
        prompt: expect.stringContaining("compare two interpretations"),
        conversation_context: levelThreePrompt,
      },
    });
  });

  it.each([
    "Now compare determinism and probability with the Theory Badge Graph.",
    "Next, compare determinism and probability with the Theory Badge Graph.",
    "Then reflect this interpretation with the Theory Badge Graph.",
    "Now reflect what we learned from this paper, the equation search, and the calculator check into the Theory Badge Graph. Separate what the evidence supports from what remains unresolved.",
  ])("admits an affirmative discourse-prefixed Theory command: %s", (question) => {
    expect(isAffirmativeTheoryBadgeGraphReflectionPrompt(question)).toBe(true);
    expect(buildPromptDerivedTheoryReflectionGatewayCallRequests({ question })).toHaveLength(1);
  });

  it.each([
    'The phrase "Reflect deterministic laws with the Theory Badge Graph" is only an example.',
    "Do not reflect deterministic laws with the Theory Badge Graph.",
    "Now do not compare deterministic laws with the Theory Badge Graph.",
    "Next time, compare deterministic laws with the Theory Badge Graph.",
    "If we continue, then compare deterministic laws with the Theory Badge Graph.",
    "If we later reflect deterministic laws with the Theory Badge Graph, what might happen?",
    "Previously I asked you to reflect deterministic laws with the Theory Badge Graph.",
    'Previously I said "Now compare deterministic laws with the Theory Badge Graph."',
    "The UI label says Reflect deterministic laws with the Theory Badge Graph.",
    "The button says Now compare deterministic laws with the Theory Badge Graph.",
  ])("does not execute a contextual direct-reflection mention: %s", (question) => {
    expect(isAffirmativeTheoryBadgeGraphReflectionPrompt(question)).toBe(false);
    expect(buildPromptDerivedTheoryReflectionGatewayCallRequests({ question })).toEqual([]);
  });

  it("admits a bounded read for a deictic current-selection question", () => {
    const requests = buildActiveTheoryBadgeGraphContextWorkstationGatewayCallRequests(
      bodyFor("What do these selected badges imply, and which branches are possible next?"),
    );

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: "theory-badge-graph.current_context",
        mode: "read",
        arguments: expect.objectContaining({
          current_context: currentContext,
          source_target_intent: expect.objectContaining({
            target_kind: "theory_badge_graph_current_context",
            deictic_prompt: true,
            terminal_eligible: false,
            assistant_answer: false,
          }),
        }),
      }),
    ]);
  });

  it("recognizes the workstation-visibility phrasing used for the current graph state", () => {
    const question =
      "Is the current state of the theory badge graph visible to the workstation tool so it can refer to the badges the user selected and their possibilities?";
    const requests = buildActiveTheoryBadgeGraphContextWorkstationGatewayCallRequests(bodyFor(question));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ capability_id: "theory-badge-graph.current_context" });
  });

  it("admits a natural request to explain the current Theory Badge Graph context", () => {
    const question = "Show me the current Theory Badge Graph context and explain what is represented.";
    const intent = arbitrateAskSourceTarget({
      turnId: "ask:test:theory-natural-current-context",
      threadId: "thread:test",
      promptText: question,
    });

    expect(intent).toMatchObject({
      target_source: "theory_locator",
      target_kind: "theory_locator",
      strength: "hard",
      precedence_reason: "theory_badge_graph_current_context_source_target",
    });
    expect(buildActiveTheoryBadgeGraphContextWorkstationGatewayCallRequests(bodyFor(question))).toEqual([
      expect.objectContaining({ capability_id: "theory-badge-graph.current_context" }),
    ]);
  });

  it.each([
    "Do not show me the current Theory Badge Graph context or explain what is represented.",
    "If we continue later, show me the current Theory Badge Graph context.",
    "Previously you showed me the current Theory Badge Graph context.",
    'The screen says "Show me the current Theory Badge Graph context."',
  ])("does not execute a contextual current-graph mention: %s", (question) => {
    expect(buildActiveTheoryBadgeGraphContextWorkstationGatewayCallRequests(bodyFor(question))).toEqual([]);
  });

  it("arbitrates the deictic selection as a hard Theory source target", () => {
    const intent = arbitrateAskSourceTarget({
      turnId: "ask:test:theory-current-context",
      threadId: "thread:test",
      promptText: "What do these selected badges imply, and which branches are possible next?",
    });

    expect(intent).toMatchObject({
      target_source: "theory_locator",
      target_kind: "theory_locator",
      strength: "hard",
      precedence_reason: "theory_badge_graph_current_context_source_target",
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(intent.explicit_cues).toContain("current_theory_badge_graph_selection");
    expect(intent.suppressed_routes).toEqual(expect.arrayContaining([
      "model_only_concept",
      "no_tool_direct",
      "panel_generated_answer",
    ]));
  });

  it("keeps an affirmative read-only mixed intent admitted without treating the no-change clause as negation", () => {
    const requests = buildActiveTheoryBadgeGraphContextWorkstationGatewayCallRequests(bodyFor(
      "Explain what these selected badges imply, but do not change the selection.",
    ));
    expect(requests).toHaveLength(1);
  });

  it.each([
    "Do not inspect these selected badges or explain their possible branches.",
    "If I select these badges later, explain which branch would be possible.",
    "Previously these selected badges implied a different branch; what happened then?",
    "The screen says ‘these selected badges’; explain that phrase only.",
    "The label \"What do these selected badges imply?\" is visible on the page.",
  ])("does not admit contextual, negated, future, historical, or quoted text: %s", (question) => {
    expect(buildActiveTheoryBadgeGraphContextWorkstationGatewayCallRequests(bodyFor(question))).toEqual([]);
  });

  it("keeps the exact current selection while deferring the authored Theory reflection to the runtime", () => {
    const body = {
      ...bodyFor("What do these selected badges imply, and which branches are possible next?"),
      source_target_intent: {
        selected_capability: "helix_ask.reflect_theory_context",
        query: "What do these selected badges imply, and which branches are possible next?",
        target_kind: "theory_locator",
      },
    };
    const requests = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });
    const capabilities = requests.map((request) => request.capability_id);

    expect(capabilities).toContain("theory-badge-graph.current_context");
    expect(capabilities).not.toContain("theory-badge-graph.reflect_discussion_context");
  });

  it("does not add a web-search edge for the live current-graph prompt", () => {
    const question =
      "Looking at the current Theory Badge Graph arrangement I set up, what do these selected badges imply together? Identify the selected badges, their connection trace and intermediate badges, and the possibilities currently available next. Distinguish my chosen arrangement from what established physics actually supports.";
    const requests = readWorkstationGatewayCallRequestsForTurn({
      body: {
        ...bodyFor(question),
        source_target_intent: {
          selected_capability: "helix_ask.reflect_theory_context",
          query: question,
          target_source: "theory_locator",
          target_kind: "theory_locator",
        },
      },
      includePlannerDerived: true,
    });
    const capabilities = requests.map((request) => request.capability_id);

    expect(capabilities).toContain("theory-badge-graph.current_context");
    expect(capabilities).not.toContain("theory-badge-graph.reflect_discussion_context");
    expect(capabilities).not.toContain("internet-search.search_web");
  });

  it("does not invent a Theory reflection call when the runtime requests only current graph context", () => {
    const question = [
      "Looking at the current Theory Badge Graph arrangement I set up, what do these selected badges imply together?",
      "Identify the selected badges, their connection trace and intermediate badges, and the possibilities currently available next.",
      "Distinguish my chosen arrangement from what established physics actually supports.",
    ].join(" ");
    const body = {
      ...bodyFor(question),
      workstation_gateway_calls: [{
        capability_id: "theory-badge-graph.current_context",
        mode: "read",
        arguments: { current_context: currentContext },
      }],
    };

    const requests = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });

    expect(requests.map((request) => request.capability_id)).toEqual([
      "theory-badge-graph.current_context",
    ]);
  });

  it("re-enters exact manual graph context into the Theory receipt answer without promoting it to proof", () => {
    const result = buildCodexTheoryReflectionReceiptAnswer({
      turnId: "ask:test:theory-current-context-answer",
      threadId: "thread:test",
      promptText: "What do these selected badges imply and what is possible next?",
      normalizedArtifacts: [
        {
          artifact_id: "artifact:current-context",
          kind: "theory_badge_graph_current_context",
          capability_key: "theory-badge-graph.current_context",
          payload: {
            combination_reader: {
              selected_badges: [
                { id: "element.h.origin", title: "Hydrogen" },
                { id: "physics.quantum.energy_frequency", title: "Quantum Energy-Frequency Relation" },
              ],
              trace_path_badges: [
                { id: "element.h.origin", title: "Hydrogen" },
                { id: "physics.atomic.transition_gap_frequency_context", title: "Transition Gap" },
                { id: "physics.quantum.energy_frequency", title: "Quantum Energy-Frequency Relation" },
              ],
              intermediate_badges: [
                { id: "physics.atomic.transition_gap_frequency_context", title: "Transition Gap" },
              ],
              available_next_badges: [
                { id: "physics.radiation.mode_context", title: "Radiation Mode" },
              ],
              implication_summary: ["The path requires a declared atomic transition gap."],
              boundary_context: {
                notes: ["Element identity alone does not choose a frequency."],
              },
            },
          },
        },
        {
          artifact_id: "artifact:reflection",
          kind: "helix_theory_context_reflection_tool_receipt",
          capability_key: "theory-badge-graph.reflect_discussion_context",
          payload: {
            summary: "The reflection locates the selection in atomic-radiation context.",
            exact_badge_ids: ["physics.atomic.transition_gap_frequency_context"],
            claim_boundary_notes: ["A compatible path is not an observed transition."],
          },
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.answer).toMatchObject({
      selected_observation_refs: ["artifact:current-context", "artifact:reflection"],
      support_refs: ["artifact:current-context", "artifact:reflection"],
      terminal_eligible: true,
      assistant_answer: false,
    });
    const text = String(result?.answer.text);
    expect(text).toContain("Current user-configured graph state:");
    expect(text).toContain("Hydrogen (`element.h.origin`)");
    expect(text).toContain("Intermediate bridge badges");
    expect(text).toContain("Available next badges");
    expect(text).toContain("Manual badge selection records the operator's chosen arrangement; it is not proof");
    expect(text).toContain("Element identity alone does not choose a frequency.");
  });

});
