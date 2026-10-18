import { describe, expect, it } from "vitest";

import {
  buildUserPromptConversationWorkspaceSnapshot,
  isLoopbackUserPromptBaseUrl,
  mergeUserPromptWorkspaceSnapshots,
  resolveUserPromptScenarioThreadId,
  summarizeTurn,
  type UserPromptScenario,
} from "../../scripts/helix-ask-user-prompt-corpus-probe";

const modelOnlyScenario: UserPromptScenario = {
  id: "model-only-control",
  category: "negated_context",
  prompt: "Explain a hypothesis and a theory without workstation tools.",
  expected_tool_mode: "none",
  expected_maximum_observations: 0,
  expected_terminal_kinds: ["direct_answer_text"],
  expected_answer_patterns: ["hypothesis", "theory"],
  expected_minimum_answer_chars: 40,
};

describe("Helix Ask natural prompt corpus scoring", () => {
  it("permits automatic developer probe sessions only on loopback URLs", () => {
    expect(isLoopbackUserPromptBaseUrl("http://127.0.0.1:1498")).toBe(true);
    expect(isLoopbackUserPromptBaseUrl("http://localhost:1522")).toBe(true);
    expect(isLoopbackUserPromptBaseUrl("http://[::1]:1498")).toBe(true);
    expect(isLoopbackUserPromptBaseUrl("https://casimirbot.example")).toBe(false);
    expect(isLoopbackUserPromptBaseUrl("not-a-url")).toBe(false);
  });

  it("keeps journey scenarios on one thread while isolating unrelated scenarios", () => {
    const first = { ...modelOnlyScenario, id: "journey-first", thread_group: "docs journey" };
    const second = { ...modelOnlyScenario, id: "journey-second", thread_group: "docs journey" };
    const isolated = { ...modelOnlyScenario, id: "isolated" };

    expect(resolveUserPromptScenarioThreadId(first, "run-1"))
      .toBe(resolveUserPromptScenarioThreadId(second, "run-1"));
    expect(resolveUserPromptScenarioThreadId(isolated, "run-1"))
      .not.toBe(resolveUserPromptScenarioThreadId(first, "run-1"));
  });

  it("carries the prior visible answer as bounded referent context for journey follow-ups", () => {
    expect(buildUserPromptConversationWorkspaceSnapshot({
      turn_id: "ask:prior",
      user_prompt: "Find the NHM2 whitepaper.",
      assistant_text:
        "The canonical file is docs/research/nhm2-current-status-whitepaper.md.",
    })).toMatchObject({
      activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
      active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
      activePanel: "docs-viewer",
      hasDocContext: true,
      source: "user_prompt_corpus_prior_answer",
      chat_referent_context: {
        previous_assistant_final_answer: {
          source_ref: "chat.final_answer.previous:ask:prior",
          text: expect.stringContaining("nhm2-current-status-whitepaper.md"),
        },
        previous_user_message: {
          text: "Find the NHM2 whitepaper.",
        },
      },
    });
  });

  it("retains the active document when a later answer does not repeat its path", () => {
    expect(buildUserPromptConversationWorkspaceSnapshot({
      turn_id: "ask:followup",
      user_prompt: "What is the main idea?",
      assistant_text: "The main idea is disciplined evidence boundaries.",
      active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
    })).toMatchObject({
      activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
      activePanel: "docs-viewer",
      hasDocContext: true,
    });
  });

  it("projects a bounded recent-answer history for realistic multi-turn referents", () => {
    const snapshot = buildUserPromptConversationWorkspaceSnapshot({
      turn_id: "ask:latest",
      user_prompt: "Correct that overclaim.",
      assistant_text: "I could not complete this turn because terminal authority blocked it.",
      recent_assistant_answers: [
        {
          turn_id: "ask:latest",
          assistant_text: "I could not complete this turn because terminal authority blocked it.",
        },
        {
          turn_id: "ask:substantive",
          assistant_text: "The Casimir-DP study keeps the quantitative bridge blocked.",
        },
      ],
    });

    expect(
      (snapshot?.chat_referent_context as Record<string, unknown>)
        .recent_assistant_final_answers,
    ).toEqual([
      expect.objectContaining({
        reply_id: "ask:latest",
        text: expect.stringContaining("could not complete"),
      }),
      expect.objectContaining({
        reply_id: "ask:substantive",
        text: expect.stringContaining("Casimir-DP study"),
      }),
    ]);
  });

  it("preserves configured bounded panel context when conversation context is added", () => {
    expect(mergeUserPromptWorkspaceSnapshots({
      activePanel: "workstation-notes",
      notes_context: { notes: [] },
    }, {
      chat_referent_context: { previous_user_message: { text: "Check my notes." } },
    })).toMatchObject({
      activePanel: "workstation-notes",
      notes_context: { notes: [] },
      chat_referent_context: {
        previous_user_message: { text: "Check my notes." },
      },
    });
  });

  it("does not treat model-only policy refs as executed tool observations", () => {
    const result = summarizeTurn(modelOnlyScenario, {
      selected_final_answer:
        "A hypothesis is a specific testable proposal, while a theory is a broad explanation supported by repeated evidence.",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "agent_provider_codex",
      codex_parity_agent_spine_rail_table: {
        rail_status: "selected_not_executed",
        codex_parity_class: "selected_not_executed",
        first_broken_rail: "capability_execution",
        requested_capability: "model_only",
        selected_capability: "model_only",
        admitted_capability: "model_only",
        executed_capability: null,
        observation_ref: "policy:model_only:placeholder",
      },
    }, {});

    expect(result).toMatchObject({
      verdict: "PASS",
      lifecycle_failure_stage: "not_required",
      executed_capabilities: [],
      answer_quality_flags: [],
    });
  });

  it("still rejects real tool execution in a model-only control", () => {
    const result = summarizeTurn(modelOnlyScenario, {
      selected_final_answer:
        "A hypothesis is a specific testable proposal, while a theory is a broad explanation supported by repeated evidence.",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "agent_provider_codex",
      codex_parity_agent_spine_rail_table: {
        rail_status: "complete",
        codex_parity_class: "complete",
        executed_capability: "docs.search",
        observation_ref: "artifact:docs.search:1",
      },
    }, {});

    expect(result.verdict).toBe("WARN");
    expect(result.lifecycle_failure_stage).toBe("unexpected_tool_lifecycle");
    expect(result.answer_quality_flags).toEqual(
      expect.arrayContaining(["unexpected_tool_execution:docs.search"]),
    );
  });

  it("fails a required tool case when the gateway receipt is blocked despite a plausible answer", () => {
    const result = summarizeTurn({
      id: "calculator-blocked",
      category: "calculator",
      prompt: "Calculate 2*pi*3.",
      expected_tool_mode: "required",
      expected_capability_patterns: ["^scientific-calculator\\.solve_expression$"],
      expected_minimum_observations: 1,
      expected_answer_patterns: ["18\\.849"],
    }, {
      selected_final_answer: "The answer is approximately 18.8495559215.",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "agent_provider_codex",
      workstation_gateway_call_results: [{
        capability_id: "scientific-calculator.solve_expression",
        ok: false,
        observation_packet: {
          status: "blocked",
          observation_ref: "artifact:calculator:blocked",
        },
        tool_lifecycle_trace: {
          failure_reason: "expression_evaluation_failed",
        },
      }],
      codex_parity_agent_spine_rail_table: {
        rail_status: "complete",
        codex_parity_class: "complete",
        executed_capability: "scientific-calculator.solve_expression",
        observation_ref: "artifact:calculator:blocked",
        reentry_status: "reentered",
      },
    }, {});

    expect(result).toMatchObject({
      verdict: "FAIL",
      lifecycle_failure_stage: "capability_execution",
      expected_capabilities_successful: false,
    });
    expect(result.answer_quality_flags).toEqual(expect.arrayContaining([
      "expected_capability_not_successful:^scientific-calculator\\.solve_expression$",
      expect.stringContaining("tool_observation_failed:scientific-calculator.solve_expression:blocked"),
    ]));
  });

  it("passes a required tool case only when the expected gateway observation succeeds", () => {
    const result = summarizeTurn({
      id: "workspace-status-success",
      category: "workspace_status",
      prompt: "What is the current workstation status?",
      expected_tool_mode: "required",
      expected_capability_patterns: ["^workspace_os\\.status$"],
      expected_minimum_observations: 1,
      expected_answer_patterns: ["available"],
    }, {
      selected_final_answer: "The workspace status reports 19 capabilities available and normal memory pressure.",
      terminal_artifact_kind: "workspace_status_answer",
      final_answer_source: "agent_provider_codex",
      workstation_gateway_call_results: [{
        capability_id: "workspace_os.status",
        ok: true,
        observation_packet: {
          status: "succeeded",
          observation_ref: "artifact:workspace-status:1",
        },
      }],
      codex_parity_agent_spine_rail_table: {
        rail_status: "complete",
        codex_parity_class: "complete",
        executed_capability: "workspace_os.status",
        observation_ref: "artifact:workspace-status:1",
        reentry_status: "reentered",
      },
    }, {});

    expect(result).toMatchObject({
      verdict: "PASS",
      lifecycle_failure_stage: "complete",
      expected_capabilities_successful: true,
    });
  });

  it("accepts a grounded conversational continuation when a tool refresh is optional", () => {
    const result = summarizeTurn({
      id: "optional-procedure-followup",
      category: "compound",
      prompt: "Which missing requirement blocks real execution first?",
      expected_tool_mode: "optional",
      expected_capability_patterns: ["^theory-experiment-procedure\\.prepare$"],
      expected_answer_patterns: ["block", "evidence"],
    }, {
      selected_final_answer:
        "The first blocker is the unbound example identity. Evidence naming the registered case and its boundary conditions would satisfy it.",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "agent_provider_codex",
      codex_parity_agent_spine_rail_table: {
        rail_status: "complete",
        codex_parity_class: "complete",
        requested_capability: "model_only",
        selected_capability: "model_only",
        admitted_capability: "model_only",
      },
    }, {});

    expect(result).toMatchObject({
      verdict: "PASS",
      lifecycle_failure_stage: "complete",
      executed_capabilities: [],
      expected_capabilities_successful: true,
      answer_quality_flags: [],
    });
  });

  it("requires a complete observation lifecycle when an optional tool is used", () => {
    const result = summarizeTurn({
      id: "optional-procedure-refresh",
      category: "compound",
      prompt: "Refresh the closure evidence if needed.",
      expected_tool_mode: "optional",
      expected_capability_patterns: ["^theory-experiment-procedure\\.prepare$"],
      expected_answer_patterns: ["block", "evidence"],
    }, {
      selected_final_answer:
        "The first blocker is the semantic boundary, based on the refreshed evidence.",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "agent_provider_codex",
      workstation_gateway_call_results: [{
        capability_id: "theory-experiment-procedure.prepare",
        ok: false,
        observation_packet: {
          status: "blocked",
          observation_ref: "artifact:procedure:blocked",
        },
        tool_lifecycle_trace: {
          failure_reason: "procedure_preparation_failed",
        },
      }],
      codex_parity_agent_spine_rail_table: {
        rail_status: "complete",
        codex_parity_class: "complete",
        executed_capability: "theory-experiment-procedure.prepare",
        observation_ref: "artifact:procedure:blocked",
        reentry_status: "reentered",
      },
    }, {});

    expect(result).toMatchObject({
      verdict: "FAIL",
      lifecycle_failure_stage: "capability_execution",
      expected_capabilities_successful: false,
    });
    expect(result.answer_quality_flags).toEqual(expect.arrayContaining([
      "optional_tool_not_successful:^theory-experiment-procedure\\.prepare$",
      expect.stringContaining("tool_observation_failed:theory-experiment-procedure.prepare:blocked"),
    ]));
  });

  it("accepts a completed governed client lane without inventing a gateway call", () => {
    const result = summarizeTurn({
      id: "voice-client-lane-success",
      category: "voice_delivery",
      prompt: "Say this aloud: The evidence is diagnostic, not conclusive.",
      expected_tool_mode: "required",
      expected_capability_patterns: ["^text_to_speech\\.speak_text$"],
      expected_minimum_observations: 1,
      expected_answer_patterns: ["diagnostic"],
      expected_minimum_answer_chars: 20,
    }, {
      selected_final_answer: "The evidence is diagnostic, not conclusive.",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      compound_subgoal_rail_statuses: [{
        requested_capability: "text_to_speech.speak_text",
        selected_capability: "text_to_speech.speak_text",
        executed_capability: "text_to_speech.speak_text",
        observation_kind: "capability_lane_observation_packet",
        observation_ref: "artifact:voice:1",
        satisfaction: "satisfied",
        rail_status: "complete",
      }],
      codex_parity_agent_spine_rail_table: {
        rail_status: "complete",
        codex_parity_class: "complete",
        executed_capability: "text_to_speech.speak_text",
        observation_ref: "artifact:voice:1",
        reentry_status: "handoff_terminal_allowed",
      },
    }, {});

    expect(result).toMatchObject({
      verdict: "PASS",
      lifecycle_failure_stage: "complete",
      expected_capabilities_successful: true,
      gateway_call_results: [],
    });
  });
});
