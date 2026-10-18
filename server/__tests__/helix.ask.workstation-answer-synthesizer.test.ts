import { describe, expect, it } from "vitest";
import { synthesizeWorkstationToolAnswer } from "../services/helix-ask/workstation-answer-synthesizer";
import { planWorkstationToolUse } from "../services/helix-ask/workstation-tool-planner";

describe("Helix Ask workstation answer synthesizer", () => {
  it("reports solve-with-steps as the trace source when that capability was chosen", () => {
    const prompt = "Use the scientific calculator to check 12*7 and explain the result.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    expect(synthesizeWorkstationToolAnswer({ prompt, plan: plan! })).toContain(
      "Trace source: scientific-calculator.solve_with_steps.",
    );
  });

  it("reports solve-expression as the trace source for direct calculator solves", () => {
    const prompt = "Use the scientific calculator to solve 9*9.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    expect(synthesizeWorkstationToolAnswer({ prompt, plan: plan! })).toContain(
      "Trace source: scientific-calculator.solve_expression.",
    );
  });

  it("uses observed calculator evaluation results for function expressions", () => {
    const expression = "((sqrt(81)+ln(e^3))*7-5^2)/2";
    const prompt = `Use the scientific calculator to solve ${expression}.`;
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:function-expression",
        plan_id: plan!.plan_id,
        thread_id: "thread:test",
        turn_id: "turn:test",
        goal: prompt,
        subgoal: "Evaluate the supplied calculator expression.",
        tool_receipt_ids: ["calculator:receipt:function-expression"],
        supports_goal: true,
        summary: `Calculator verified ${expression} with result 29.5.`,
        evidence_refs: ["calculator:receipt:function-expression"],
        deterministic: true,
        model_invoked: false,
        created_at: "2026-06-16T00:00:00.000Z",
      },
    });

    expect(answer).toContain("Calculator verification plan completed.");
    expect(answer).toContain(`Expression: ${expression}`);
    expect(answer).toContain("Result: 29.5");
    expect(answer).toContain("Trace source: scientific-calculator.solve_expression.");
    expect(answer).not.toContain("available in the Scientific Calculator receipt/trace");
  });

  it("does not print null-ish calculator result metadata", () => {
    const prompt = "Use the scientific calculator to solve 2+2.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:null-unit",
        plan_id: plan!.plan_id,
        thread_id: "thread:test",
        turn_id: "turn:test",
        goal: prompt,
        subgoal: "Evaluate the supplied calculator expression.",
        tool_receipt_ids: ["calculator:receipt:null-unit"],
        supports_goal: true,
        result_text: "4 null",
        summary: "Calculator verified 2+2 with result 4 null.",
        evidence_refs: ["calculator:receipt:null-unit"],
        deterministic: true,
        model_invoked: false,
        created_at: "2026-06-16T00:00:00.000Z",
      },
    });

    expect(answer).toContain("Result: 4");
    expect(answer).not.toContain("Result: 4 null");
  });

  it("prefers the selected arithmetic expression result over stale terminal mirror text", () => {
    const prompt = "Open the scientific calculator, solve 2*(3+4), and explain the steps.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:stale-terminal-mirror",
        plan_id: plan!.plan_id,
        thread_id: "thread:test",
        turn_id: "turn:test",
        goal: prompt,
        subgoal: "Evaluate the supplied calculator expression.",
        tool_receipt_ids: ["calculator:receipt:stale-terminal-mirror"],
        supports_goal: true,
        terminal_text: [
          "I used the calculator result as a numeric subgoal, then continued the reasoning from that observation.",
          "Calculator subgoal: 2*(3+4)",
          "Result: 2",
          "Trace source: scientific-calculator.solve_expression.",
        ].join("\n"),
        answer_text: "The calculator solved 2*(3+4): 3+4 = 7, and 2*7 = 14.",
        summary: "Runtime calculator receipts and final answer cover the requested calculator requirements.",
        evidence_refs: ["calculator:receipt:stale-terminal-mirror"],
        deterministic: true,
        model_invoked: false,
        created_at: "2026-06-16T00:00:00.000Z",
      },
    });

    expect(answer).toContain("Calculator subgoal: 2*(3+4)");
    expect(answer).toContain("Result: 14");
    expect(answer).not.toContain("Result: 2\n");
  });

  it("parses calculator-backed result summaries from the equation tail, not the expression prefix", () => {
    const prompt = "Open the scientific calculator, solve 2*(3+4), and explain the steps.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:runtime-calculator-summary",
        plan_id: plan!.plan_id,
        thread_id: "thread:test",
        turn_id: "turn:test",
        goal: prompt,
        subgoal: "Evaluate the supplied calculator expression.",
        tool_receipt_ids: ["calculator:receipt:runtime-calculator-summary"],
        supports_goal: true,
        result_summary: "Calculator-backed result: 2*(3+4) = 14.",
        summary: "Calculator-backed result: 2*(3+4) = 14.",
        text: "Calculator-backed result: 2*(3+4) = 14.",
        evidence_refs: ["calculator:receipt:runtime-calculator-summary"],
        deterministic: true,
        model_invoked: false,
        created_at: "2026-06-16T00:00:00.000Z",
      },
    });

    expect(answer).toContain("Calculator subgoal: 2*(3+4)");
    expect(answer).toContain("Result: 14");
    expect(answer).not.toContain("Result: 2\n");
  });

  it("continues reasoning after calculator output for compound photon-energy prompts", () => {
    const prompt = "Explain photon energy using E=hf and calculate it for f=5e14 Hz.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({ prompt, plan: plan! });

    expect(answer).toContain("A photon is a single quantum of electromagnetic radiation.");
    expect(answer).toContain("Calculator subgoal: evaluate 6.62607015e-34*5e14.");
    expect(answer).toContain("Result: E = 3.313035e-19 J");
    expect(answer).toContain("Trace source: scientific-calculator.solve_expression.");
  });

  it("continues wavelength reasoning after a parenthesized calculator observation", () => {
    const prompt = "Use the scientific calculator to verify (3e8)/(5e14), then explain what that wavelength means for light.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({ prompt, plan: plan! });

    expect(answer).toContain("lambda = c/f");
    expect(answer).toContain("Calculator subgoal: evaluate (3e8)/(5e14).");
    expect(answer).toContain("Result: lambda = 6e-7 m");
    expect(answer).toContain("Trace source: scientific-calculator.solve_with_steps.");
  });

  it("continues kinetic-energy reasoning after calculator output", () => {
    const prompt = "Explain kinetic energy and calculate 0.5*2*12^2 with the scientific calculator.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({ prompt, plan: plan! });

    expect(answer).toContain("KE = 1/2 mv^2");
    expect(answer).toContain("Calculator subgoal: evaluate 0.5*2*12^2.");
    expect(answer).toContain("Result: KE = 144 J");
    expect(answer).toContain("Trace source: scientific-calculator.solve_expression.");
  });

  it("uses the solved linear-equation value in compound calculator answers", () => {
    const prompt = "UI calculator: Use the calculator to solve 3*x+9=0 and explain the root.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({ prompt, plan: plan! });

    expect(answer).toContain("Calculator subgoal: 3*x+9=0");
    expect(answer).toContain("Result: x = -3");
    expect(answer).not.toContain("available in the calculator receipt");
  });

  it("synthesizes a model-authored answer from theory reflection evidence", () => {
    const prompt = "Where does E=hf fit in the theory graph?";
    const plan = planWorkstationToolUse(prompt).tool_plan;
    const receipt = {
      reflectionV1: {
        evidenceForAsk: {
          summary: "The discussion appears near quantum energy and Solar Spectrum.",
        },
      },
    };
    const rawSummary = receipt.reflectionV1.evidenceForAsk.summary;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:test",
        thread_id: "thread:test",
        tool_receipt_id: "receipt:test",
        result: "supports_subgoal",
        summary: `Theory reflection located discussion context as evidence only: ${rawSummary}`,
        evidence_refs: ["workstation:theory-badge-graph.reflect_discussion_context"],
        model_invoked: false,
        deterministic_gate: true,
        created_at: new Date().toISOString(),
      },
    });

    expect(answer).toContain("E = hf means a photon's energy is proportional to its frequency.");
    expect(answer).toContain("Here, E is the photon energy, h is Planck's constant, and f is the light frequency.");
    expect(answer).toContain("The graph reflection observed: The discussion appears near quantum energy and Solar Spectrum.");
    expect(answer).toContain("That graph placement is context evidence, not a solve.");
    expect(answer).not.toBe(receipt.reflectionV1.evidenceForAsk.summary);
    expect(answer).toMatch(/evidence|not a solve/i);
  });

  it("answers main-components theory prompts as synthesis instead of raw graph placement", () => {
    const prompt =
      "Tell me about the Needle Hull Mark 2 full solve in the badge graph. What are its main components?";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:nhm2-components",
        thread_id: "thread:test",
        tool_receipt_id: "receipt:nhm2-components",
        result: "supports_subgoal",
        summary:
          "Theory reflection located discussion context as evidence only: The discussion appears near hull geometry, Casimir cavity coupling, stability checks, and terminal solver policy.",
        evidence_refs: ["workstation:theory-badge-graph.reflect_discussion_context"],
        model_invoked: false,
        deterministic_gate: true,
        created_at: new Date().toISOString(),
      },
    });

    expect(answer).toContain("Theory Badge Graph");
    expect(answer).toContain("hull geometry");
    expect(answer).toContain("Casimir cavity coupling");
    expect(answer).toContain("stability checks");
    expect(answer).toContain("terminal solver policy");
    expect(answer).toContain("Reflection support:");
    expect(answer).toContain("Any stronger physical or numeric conclusion still needs");
    expect(answer).not.toBe("The discussion appears near hull geometry, Casimir cavity coupling, stability checks, and terminal solver policy.");
  });

  it("retains arbitrary requested graph identities without promoting them to proof", () => {
    const prompt =
      "Locate the Alpha-7 boundary theory and the beta-field scale theory in the Theory Badge Graph. Explain their relationship without treating proximity as proof.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:requested-theory-identities",
        thread_id: "thread:test",
        tool_receipt_id: "receipt:requested-theory-identities",
        result: "supports_subgoal",
        summary:
          "Theory reflection located discussion context as evidence only: The graph returned nearby diagnostic and scale-boundary rows.",
        evidence_refs: ["workstation:theory-badge-graph.reflect_discussion_context"],
        model_invoked: false,
        deterministic_gate: true,
        created_at: new Date().toISOString(),
      },
    });

    expect(answer).toContain("Alpha-7 boundary theory");
    expect(answer).toContain("beta-field scale theory");
    expect(answer).toContain("query scope only");
    expect(answer).toContain("preserves the query scope");
    expect(answer).toContain("does not assert a registered relationship or proof");
  });

  it("does not invent a requested-identity line when the query names no graph target", () => {
    const prompt = "Explain how the Theory Badge Graph represents claim boundaries.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({ prompt, plan: plan! });

    expect(answer).not.toContain("Requested graph identities:");
  });

  it("keeps calculator numeric authority separate from theory reflection context", () => {
    const prompt = "Explain photon energy using E=hf and calculate it for f=5e14 Hz.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      evaluation: {
        schema: "helix.workstation_tool_evaluation.v1",
        evaluation_id: "eval:test",
        thread_id: "thread:test",
        tool_receipt_id: "receipt:test",
        result: "supports_subgoal",
        summary: "Theory reflection located discussion context as evidence only: Solar Spectrum context.",
        evidence_refs: ["workstation:theory-badge-graph.reflect_discussion_context"],
        model_invoked: false,
        deterministic_gate: true,
        created_at: new Date().toISOString(),
      },
    });

    expect(answer).toContain("Calculator subgoal");
    expect(answer).toContain("3.313035e-19 J");
    expect(answer).not.toContain("Solar Spectrum context");
  });

  it("synthesizes from both theory reflection context and calculator solve receipts", () => {
    const prompt = "Calculate photon energy for f=5e14 Hz and show where E=hf fits in the theory graph.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    const answer = synthesizeWorkstationToolAnswer({ prompt, plan: plan! });

    expect(answer).toContain("Calculator subgoal");
    expect(answer).toContain("3.313035e-19 J");
    expect(answer).toContain("Trace source: scientific-calculator.solve_expression.");
    expect(answer).toContain(
      "Evidence note: theory graph reflection supplied context; Scientific Calculator receipts supplied the numeric result.",
    );
  });

  it("synthesizes a bounded answer from Theory-Moral bridge evidence", () => {
    const prompt =
      "Reflect fairness and due process through entropy and conservation in the Theory Badge Graph and MoralGraph.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    expect(plan?.intent).toBe("theory_ideology_bridge_reflection");

    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      theoryIdeologyBridgeToolOutput: {
        bridge: {
          links: [
            {
              relation: "constrains",
              proceduralEffect: "Require revision triggers and uncertainty-aware next steps.",
            },
            {
              relation: "analogy_only",
              proceduralEffect:
                "Use conservation and boundary language as a constraint metaphor, not as final authority.",
            },
          ],
          missingEvidence: ["theory_counterpart:jurisdiction+boundary-conditions", "jurisdiction_context"],
        },
      },
    });

    expect(answer).toContain(
      "I treated the theory side as observable/mathematical constraint evidence and the Moral side as procedural justice evidence.",
    );
    expect(answer).toContain("Bridge links:");
    expect(answer).toContain("- constrains: Require revision triggers and uncertainty-aware next steps.");
    expect(answer).toContain("Missing checks: theory counterpart for jurisdiction + boundary conditions, jurisdiction context.");
    expect(answer).not.toContain("Missing checks: theory_context_reflection");
    expect(answer).toContain(
      "Boundary: physics, conservation, entropy, and self-organization can constrain how we reason about fairness, but they do not prove moral certainty or authorize execution.",
    );
    expect(answer).toContain("Procedural posture: use the bridge to ask better questions");
  });

  it("turns civilization bounds receipts into conflict-capacity reflection instead of receipt prose", () => {
    const prompt =
      "Use civilization bounds to assess a conflict recovery claim about marginal battlefield cost, defensive denial capacity, infrastructure stability, resource reserves, and buildout rates.";
    const plan = planWorkstationToolUse(prompt).tool_plan;

    expect(plan).toBeTruthy();
    expect(plan?.intent).toBe("civilization_bounds_reflection");

    const answer = synthesizeWorkstationToolAnswer({
      prompt,
      plan: plan!,
      civilizationScenarioFrameToolOutput: {
        frame: {
          family: "resource_reconstruction",
          boundaryKind: "planetary_civilization",
          developmentalStage: "collapse_or_repair",
          evidenceMode: "user_hypothesis",
          constraintProfiles: ["material_limited", "transport_limited", "governance_limited"],
          missingEvidence: ["material_inventory_receipts", "transport_route_and_latency_evidence"],
        },
      },
      civilizationBoundsToolOutput: {
        roadmap: {
          collaborationBound: { collaborationValue: 0.12 },
        },
      },
    });

    expect(answer).toContain("The procedural frame should inform the reflection, not replace it.");
    expect(answer).toContain("Frame hypothesis: resource_reconstruction / planetary_civilization");
    expect(answer).toContain("plausible constraint model, not an ultimatum or proof");
    expect(answer).toContain("You need the decision-relevant reserve, extraction, refining, manufacturing, transport");
    expect(answer).toContain("Boundary: the roadmap can organize what must be measured");
    expect(answer).not.toContain("Civilization Bounds Roadmap produced evidence-only system bounds");
  });
});
