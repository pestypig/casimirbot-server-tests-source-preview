import { describe, expect, it } from "vitest";

import { interpretHelixAskPrompt } from "../services/helix-ask/prompt-interpretation";

const cues = (prompt: string): string[] =>
  interpretHelixAskPrompt(prompt).contextual_tool_mentions.map((entry) => entry.verb_or_cue);

const reasons = (prompt: string): string[] =>
  interpretHelixAskPrompt(prompt).contextual_tool_mentions.map((entry) => entry.reason);

const commandFamilies = (prompt: string): string[] =>
  interpretHelixAskPrompt(prompt).executable_operator_commands.map((entry) => entry.action_family);

describe("Helix Ask prompt interpretation", () => {
  it("records negated interval language as contextual cadence, not executable control", () => {
    const interpretation = interpretHelixAskPrompt("I haven't started the interval yet");

    expect(interpretation).toMatchObject({
      schema: "helix.prompt_interpretation.v1",
      assistant_answer: false,
      raw_content_included: false,
      control_command_detected: false,
    });
    expect(interpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "interval_cadence",
          reason: "negated",
        }),
      ]),
    );
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("records future click preconditions as contextual", () => {
    expect(cues("Review the current screen before I click Start.")).toContain("click");
    expect(reasons("Review the current screen before I click Start.")).toContain("future");
    expect(commandFamilies("Review the current screen before I click Start.")).toEqual([]);
  });

  it("records historical refresh language as context", () => {
    const interpretation = interpretHelixAskPrompt("What changed after the source refreshed?");

    expect(interpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "refresh",
          reason: "historical",
        }),
      ]),
    );
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("records conditional repair language as context", () => {
    const interpretation = interpretHelixAskPrompt("If we later run repair, what should I watch for?");

    expect(interpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "run_repair",
          reason: "conditional",
        }),
      ]),
    );
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("treats capture-running prompts as status questions, not mutating actions", () => {
    const interpretation = interpretHelixAskPrompt("Was capture running?");

    expect(interpretation.status_question_detected).toBe(true);
    expect(interpretation.control_command_detected).toBe(false);
    expect(interpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "capture",
          reason: "status_question",
        }),
      ]),
    );
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("treats set_rate diagnosis as historical debug context", () => {
    const interpretation = interpretHelixAskPrompt("Why did it call set_rate?");

    expect(interpretation.debug_or_history_question_detected).toBe(true);
    expect(interpretation.control_command_detected).toBe(false);
    expect(interpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "set_rate",
          reason: "historical",
        }),
      ]),
    );
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("does not treat casual debug check wording as a debug diagnosis request", () => {
    const interpretation = interpretHelixAskPrompt(
      "Helix console debug check: answer in one short sentence and include whether this is a new Helix Ask turn.",
    );

    expect(interpretation.debug_or_history_question_detected).toBe(false);
    expect(interpretation.control_command_detected).toBe(false);
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("still treats explicit debug export inspection as debug diagnosis", () => {
    const interpretation = interpretHelixAskPrompt("Inspect the debug export for the previous turn and explain why it failed.");

    expect(interpretation.debug_or_history_question_detected).toBe(true);
    expect(interpretation.control_command_detected).toBe(false);
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("treats screen-visible Start text as content context", () => {
    const interpretation = interpretHelixAskPrompt("The screen shows a Start button.");

    expect(interpretation.content_question_detected).toBe(true);
    expect(interpretation.control_command_detected).toBe(false);
    expect(interpretation.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "start",
          reason: "screen_visible_text",
        }),
      ]),
    );
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("records open/run nothing as negative constraints with no executable commands", () => {
    const interpretation = interpretHelixAskPrompt("Open nothing and run nothing; just reason from what we already know.");

    expect(interpretation.negative_constraints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/open nothing/i),
        expect.stringMatching(/run nothing/i),
      ]),
    );
    expect(interpretation.control_command_detected).toBe(false);
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("records contextual docs-viewer open language without executable commands", () => {
    const cases = [
      ["Do not open the docs viewer; just explain what the docs viewer is for.", "negated"],
      ["Explain what would happen if I opened the docs viewer.", "conditional"],
      ['"Open the docs viewer" is the command I typed; explain what it means.', "quoted"],
      ["I opened the docs viewer earlier; what is it for?", "historical"],
    ] as const;

    for (const [prompt, reason] of cases) {
      const interpretation = interpretHelixAskPrompt(prompt);
      expect(interpretation.contextual_tool_mentions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            verb_or_cue: expect.stringMatching(/^docs_viewer\./),
            reason,
          }),
        ]),
      );
      expect(interpretation.executable_operator_commands).toEqual([]);
    }
  });

  it("records contextual calculator language without executable commands", () => {
    const cases = [
      ["Do not open the scientific calculator; just explain what E = h * f is missing.", "negated", "calculator"],
      ["Before I later put E = h * f into the calculator, tell me what evidence would be needed.", "future", "calculator"],
      [
        "Why did the previous turn call scientific-calculator.solve_expression, and was that justified?",
        "historical",
        "scientific-calculator.solve_expression",
      ],
      ["The screen label says 'open the calculator'; describe what that label means without opening it.", "quoted", "quoted_tool_text"],
    ] as const;

    for (const [prompt, reason, cue] of cases) {
      const interpretation = interpretHelixAskPrompt(prompt);
      expect(interpretation.contextual_tool_mentions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            verb_or_cue: cue,
            reason,
          }),
        ]),
      );
      expect(interpretation.executable_operator_commands).toEqual([]);
    }
  });

  it("records without-opening calculator wording as a negative constraint", () => {
    const interpretation = interpretHelixAskPrompt(
      "The screen label says 'open the calculator'; describe what that label means without opening it.",
    );

    expect(interpretation.negative_constraints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/without opening/i),
      ]),
    );
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("records affirmative visual cadence as an executable operator command", () => {
    const interpretation = interpretHelixAskPrompt("Set the visual capture interval to 10 seconds.");

    expect(interpretation.control_command_detected).toBe(true);
    expect(interpretation.contextual_tool_mentions).toEqual([]);
    expect(interpretation.executable_operator_commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_family: "live_pipeline.set_rate",
        }),
      ]),
    );
  });

  it("records affirmative click as a workstation executable command", () => {
    const interpretation = interpretHelixAskPrompt("Click Start and tell me whether the click was accepted.");

    expect(interpretation.control_command_detected).toBe(true);
    expect(interpretation.status_question_detected).toBe(true);
    expect(interpretation.executable_operator_commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_family: "workstation_action.click",
        }),
      ]),
    );
  });

  it("records affirmative prompt-only goal creation as a goal-session operator command", () => {
    const interpretation = interpretHelixAskPrompt(
      "Create a goal to refactor the goal-session UI so it supports pause, resume, edit, archive, and expanded details. Work until tests pass.",
    );

    expect(interpretation.control_command_detected).toBe(true);
    expect(interpretation.executable_operator_commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_family: "live_env.start_agent_goal_session",
        }),
      ]),
    );
  });

  it("keeps goal-statement writing as non-executable model text", () => {
    const interpretation = interpretHelixAskPrompt("Write me a goal statement for a project roadmap.");

    expect(interpretation.control_command_detected).toBe(false);
    expect(interpretation.executable_operator_commands).toEqual([]);
  });

  it("builds a compound prompt contract without splitting the root prompt into separate turns", () => {
    const interpretation = interpretHelixAskPrompt(`
      Explain why large prompts are being split.
      Compare against Codex compaction.
      Identify exact code changes.
      Include tests.
    `);

    expect(interpretation.compound_contract).toMatchObject({
      schema: "helix.compound_prompt_contract.v1",
      assistant_answer: false,
      raw_content_included: false,
      output_contract: expect.objectContaining({
        allow_partial_answer: false,
      }),
    });
    expect(interpretation.compound_contract?.requirements.map((entry) => entry.text)).toEqual([
      "Explain why large prompts are being split.",
      "Compare against Codex compaction.",
      "Identify exact code changes.",
      "Include tests.",
    ]);
    expect(interpretation.compound_contract?.requirements.every((entry) => entry.status === "pending")).toBe(true);
  });

  it("keeps report-only freshness language as a constraint instead of a second required subgoal", () => {
    const interpretation = interpretHelixAskPrompt(
      "Check my current Minecraft player's health, air, and position. Report only fresh measured values from the paired Fabric environment.",
    );

    expect(interpretation.compound_contract?.requirements).toEqual([
      expect.objectContaining({
        id: "R1",
        kind: "instruction",
        required: true,
      }),
      expect.objectContaining({
        id: "R2",
        kind: "constraint",
        required: false,
      }),
    ]);
    expect(interpretation.compound_contract?.global_constraints).toEqual([
      "Report only fresh measured values from the paired Fabric environment.",
    ]);
  });

  it("builds a compound contract for coordinated research, locator, and synthesis prompts", () => {
    const interpretation = interpretHelixAskPrompt(
      "Use scholarly research to find papers about photosynthesis quantum coherence and microtubule Orch-OR claims, then use the Theory Badge Graph locator / theory locator to place the relevant claims and synthesize the uncertainty with citations. Do not write files.",
    );

    expect(interpretation.negative_constraints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/do not write/i),
      ]),
    );
    expect(interpretation.compound_contract).toMatchObject({
      schema: "helix.compound_prompt_contract.v1",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(interpretation.compound_contract?.requirements.map((entry) => entry.text)).toEqual([
      "Use scholarly research to find papers about photosynthesis quantum coherence and microtubule Orch-OR claims",
      "use the Theory Badge Graph locator / theory locator to place the relevant claims",
      "synthesize the uncertainty with citations.",
    ]);
  });

  it("keeps each affirmative operation in a coordinated environment course independently accountable", () => {
    const interpretation = interpretHelixAskPrompt(
      "Complete the G2 fluid micro-course: inspect the current player state, perform the bounded look/sprint/jump, interact with the verified reachable target, equip the stick, craft four oak planks, verify every checkpoint, and release all controls.",
    );

    expect(
      interpretation.compound_contract?.requirements.map((entry) => entry.text),
    ).toEqual([
      "Complete the G2 fluid micro-course: inspect the current player state",
      "perform the bounded look/sprint/jump",
      "interact with the verified reachable target",
      "equip the stick",
      "craft four oak planks",
      "verify every checkpoint",
      "release all controls.",
    ]);
    expect(
      interpretation.compound_contract?.output_contract.allow_partial_answer,
    ).toBe(false);
  });

  it("does not promote coordinated verbs under one prohibition into positive requirements", () => {
    const interpretation = interpretHelixAskPrompt(
      "Using the active Minecraft Fabric environment, make one fresh read-only check and report the world status. Do not move anything, use server commands, or change the world.",
    );

    expect(interpretation.negative_constraints).toEqual(
      expect.arrayContaining([expect.stringMatching(/do not move/i)]),
    );
    expect(
      interpretation.compound_contract?.requirements.some((entry) =>
        /^use server commands/i.test(entry.text),
      ) ?? false,
    ).toBe(false);
  });

  it("keeps inspect-only operational constraints out of terminal answer coverage", () => {
    const interpretation = interpretHelixAskPrompt(
      "Inspect the conformed scientific-evidence enrollment and show the maximum claim ceiling. Inspect only; do not prepare, evaluate, or start any runtime.",
    );
    const requirements = interpretation.compound_contract?.requirements ?? [];
    const operationalConstraint = requirements.find((entry) =>
      /do not prepare, evaluate, or start any runtime/i.test(entry.text),
    );

    expect(operationalConstraint).toMatchObject({
      kind: "constraint",
      required: false,
    });
    expect(interpretation.compound_contract?.global_constraints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/do not prepare, evaluate, or start any runtime/i),
      ]),
    );
    expect(interpretation.negative_constraints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/do not prepare/i),
      ]),
    );
  });
});
