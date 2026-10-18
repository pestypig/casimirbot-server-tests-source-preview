import { describe, expect, it } from "vitest";
import {
  buildCalculatorCandidateHints,
  detectUnderdeterminedTrianglePrompt,
  draftUnitConversionCalculatorSubgoalsForPrompt,
  extractCalculatorNumericNormalizations,
  normalizeCalculatorCompoundLengthPhrases,
  runCalculatorCompoundChain,
  runCalculatorModelAuthoredChain,
} from "../services/helix-ask/calculator-compound-chain";

describe("Helix Ask calculator compound chain", () => {
  it("normalizes mixed-number notation in calculator candidate hints", () => {
    const hints = buildCalculatorCandidateHints({
      prompt: "Convert 9 1/8 inches to decimal inches.",
      turnId: "turn:test",
    });

    expect(extractCalculatorNumericNormalizations("9 1/8 inches")).toEqual([
      expect.objectContaining({
        raw_token: "9 1/8",
        normalized_expression: "73/8",
        decimal_value: 9.125,
      }),
    ]);
    expect(hints.numeric_normalizations).toEqual([
      expect.objectContaining({
        raw_token: "9 1/8",
        normalized_expression: "73/8",
      }),
    ]);
    expect(hints.expression_rules.join(" ")).toContain("9 1/8 must become 73/8");
  });

  it("marks longest-side-only triangle prompts as underdetermined", () => {
    const prompt =
      "if the longest side of a triangle is 9 1/8 inches long, how long are the other 2 sides? Can you write the equation and solve?";
    const hints = buildCalculatorCandidateHints({
      prompt,
      turnId: "turn:test",
    });

    expect(detectUnderdeterminedTrianglePrompt(prompt)).toBe(true);
    expect(hints.numeric_normalizations).toEqual([
      expect.objectContaining({
        raw_token: "9 1/8",
        normalized_expression: "73/8",
        decimal_value: 9.125,
      }),
    ]);
    expect(hints.problem_interpretation).toMatchObject({
      prompt_kind: "underdetermined_triangle",
      determination_status: "underdetermined",
      needs_more_information: true,
      safe_to_calculate: false,
      missing_constraints: expect.arrayContaining(["triangle_type", "angle", "another_side", "side_ratio"]),
      clarifying_question: expect.stringContaining("triangle type"),
    });
  });

  it("combines spoken same-unit fractional side lengths before triangle determination", () => {
    const prompt =
      "If the longest side of a triangle is 9 inches and 1/8 inches, what are the other two sides of the triangle? How long is that? And make an equation for that and solve it with the calculator";
    const hints = buildCalculatorCandidateHints({
      prompt,
      turnId: "turn:test",
    });

    expect(normalizeCalculatorCompoundLengthPhrases("9 inches and 1/8 inches")).toBe("9 1/8 inches");
    expect(detectUnderdeterminedTrianglePrompt(prompt)).toBe(true);
    expect(hints.numeric_normalizations).toEqual([
      expect.objectContaining({
        raw_token: "9 1/8",
        normalized_expression: "73/8",
        decimal_value: 9.125,
      }),
    ]);
    expect(hints.problem_interpretation).toMatchObject({
      prompt_kind: "underdetermined_triangle",
      determination_status: "underdetermined",
      needs_more_information: true,
      safe_to_calculate: false,
      missing_constraints: expect.arrayContaining(["triangle_type", "angle", "another_side", "side_ratio"]),
      clarifying_question: expect.stringContaining("triangle type"),
    });
  });

  it("marks exact-triangle solve prompts with only a longest side as underdetermined", () => {
    const prompt = "Solve the exact triangle if the longest side is 9 1/8 in.";
    const hints = buildCalculatorCandidateHints({
      prompt,
      turnId: "turn:test",
    });

    expect(detectUnderdeterminedTrianglePrompt(prompt)).toBe(true);
    expect(hints.problem_interpretation).toMatchObject({
      prompt_kind: "underdetermined_triangle",
      determination_status: "underdetermined",
      needs_more_information: true,
      safe_to_calculate: false,
      clarifying_question: expect.stringContaining("perimeter/area"),
    });
  });

  it("compiles explicit mixed-number inch-to-meter conversions into calculator subgoals", () => {
    const prompt = "Convert 9 1/8 inches to meters.";
    const hints = buildCalculatorCandidateHints({
      prompt,
      turnId: "turn:test",
    });
    const subgoals = draftUnitConversionCalculatorSubgoalsForPrompt(prompt);

    expect(hints.problem_interpretation).toMatchObject({
      prompt_kind: "unit_conversion",
      determination_status: "needs_unit_conversion",
      safe_to_calculate: true,
      givens: ["length = 73/8 in"],
      unknowns: ["length in m"],
    });
    expect(subgoals).toEqual([
      expect.objectContaining({
        id: "unit_conversion_length",
        expression: "(73/8)*0.0254",
        expected_quantity: "length",
        expected_unit: "m",
        equation: "in_to_m",
      }),
    ]);

    const chain = runCalculatorModelAuthoredChain({
      prompt,
      threadId: "thread:test",
      turnId: "turn:test",
      subgoals,
      deterministic: true,
      modelInvoked: false,
    });

    expect(chain).not.toBeNull();
    expect(chain?.receipts[0]).toMatchObject({
      expression: "(73/8)*0.0254",
      result_text: "0.231775",
      result_unit: "m",
      result_quantity: "length",
    });
    expect(chain?.evaluation).toMatchObject({
      deterministic: true,
      model_invoked: false,
    });
  });

  it("plans and validates wavelength, photon energy, and eV conversion from frequency", () => {
    const chain = runCalculatorCompoundChain({
      prompt: "Given light frequency 6e14 Hz, use the calculator to compute wavelength, photon energy in joules, and photon energy in eV. Explain the result.",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).not.toBeNull();
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.id)).toEqual([
      "wavelength",
      "photon_energy_j",
      "photon_energy_ev",
    ]);
    expect(chain?.validations.every((validation) => validation.satisfied)).toBe(true);
    expect(chain?.evaluation.supports_goal).toBe(true);
    expect(chain?.answer_text).toContain("Wavelength:");
    expect(chain?.answer_text).toContain("Photon energy:");
    expect(chain?.artifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining([
        "calculator_compound_plan",
        "calculator_receipt",
        "calculator_subgoal_receipts",
        "calculator_result_validations",
        "workstation_tool_evaluation",
        "tool_observation_continuation",
        "reasoning_continuation_result",
      ]),
    );
  });

  it("does not require eV wording to decompose frequency wavelength and energy prompts", () => {
    const chain = runCalculatorCompoundChain({
      prompt: "A photon has frequency 6e14 Hz. Use the scientific calculator to find its wavelength and energy.",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).not.toBeNull();
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.id)).toEqual([
      "wavelength",
      "photon_energy_j",
    ]);
    expect(chain?.validations.every((validation) => validation.satisfied)).toBe(true);
    expect(chain?.answer_text).toContain("Wavelength:");
    expect(chain?.answer_text).toContain("Photon energy:");
    expect(chain?.answer_text).toContain("No electronvolt conversion was required");
  });

  it("plans frequency from wavelength before joule and eV conversion for natural compound prompts", () => {
    const chain = runCalculatorCompoundChain({
      prompt: "Use calculator compute frequency from 500 nm then energy J then eV",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).not.toBeNull();
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.id)).toEqual([
      "photon_frequency",
      "photon_energy_j",
      "photon_energy_ev",
    ]);
    expect(chain?.receipts[0]).toMatchObject({
      result_unit: "Hz",
      result_quantity: "frequency",
    });
    expect(chain?.validations.every((validation) => validation.satisfied)).toBe(true);
    expect(chain?.answer_text).toContain("Frequency:");
    expect(chain?.answer_text).toContain("Photon energy:");
  });

  it("plans Casimir cavity mode frequency before photon energy", () => {
    const chain = runCalculatorCompoundChain({
      prompt: "Map Casimir cavity mode energy to first principles, then calculate a mode frequency for L=1e-6 m and n=1, and the photon energy of that mode.",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).not.toBeNull();
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.id)).toEqual([
      "casimir_cavity_mode_frequency",
      "casimir_mode_photon_energy",
    ]);
    expect(chain?.receipts[0]).toMatchObject({
      result_unit: "Hz",
      result_quantity: "frequency",
    });
    expect(chain?.receipts[1]).toMatchObject({
      result_unit: "J",
      result_quantity: "energy",
    });
    expect(chain?.answer_text).toContain("Mode frequency:");
    expect(chain?.answer_text).toContain("Photon energy:");
    expect(chain?.answer_text).toContain("not a backend Casimir field solve");
  });

  it("chains kinetic energy calculations before comparing doubled speed", () => {
    const chain = runCalculatorCompoundChain({
      prompt: "A 2 kg object moves at 15 m/s, then doubles speed. Use the calculator to compute both kinetic energies and compare them.",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).not.toBeNull();
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.expression)).toEqual([
      "0.5*2*15^2",
      "0.5*2*30^2",
      "900/225",
    ]);
    expect(chain?.answer_text).toContain("Initial kinetic energy: 225 J.");
    expect(chain?.answer_text).toContain("Kinetic energy after speed doubles: 900 J.");
    expect(chain?.answer_text).toContain("Ratio: 4.");
  });

  it("chains uncertainty momentum and electron kinetic-energy estimates", () => {
    const chain = runCalculatorCompoundChain({
      prompt:
        "Use the calculator panel to solve this uncertainty relation. Let dx = 2.0e-10 m. Calculate minimum dp from dx dp >= hbar/2, then estimate electron kinetic energy p^2/(2*m_e) in joules and eV.",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).not.toBeNull();
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.id)).toEqual([
      "minimum_momentum_uncertainty",
      "minimum_kinetic_energy_j",
      "minimum_kinetic_energy_ev",
    ]);
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.expression)).toEqual([
      "1.054571817e-34/(2*2e-10)",
      expect.stringContaining("^2/(2*9.1093837015e-31)"),
      expect.stringContaining("/1.602176634e-19"),
    ]);
    expect(chain?.validations.every((validation) => validation.satisfied)).toBe(true);
    expect(chain?.answer_text).toContain("Minimum momentum uncertainty:");
    expect(chain?.answer_text).toContain("Minimum kinetic energy:");
    expect(chain?.answer_text).toContain("Delta x Delta p >= hbar/2");
  });

  it("normalizes spoken quadratic wording before planning dependent evaluations", () => {
    const chain = runCalculatorCompoundChain({
      prompt: "Solve x squared minus 4 equals 0 then use scientific calculator to evaluate x squared plus 3 for each root",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).not.toBeNull();
    expect(chain?.plan.subgoals.map((subgoal) => subgoal.id)).toEqual([
      "solve_roots",
      "evaluate_positive_root",
      "evaluate_negative_root",
    ]);
    expect(chain?.validations.every((validation) => validation.satisfied)).toBe(true);
    expect(chain?.answer_text).toContain("Roots: x = -2, 2.");
    expect(chain?.answer_text).toContain("For x = 2, x^2 + 3 = 7.");
    expect(chain?.answer_text).toContain("For x = -2, x^2 + 3 = 7.");
  });

  it("keeps unrelated one-step calculator prompts outside the compound chain", () => {
    const chain = runCalculatorCompoundChain({
      prompt: "Use calculator compute kinetic energy KE=0.5*2*15^2 joules",
      threadId: "thread:test",
      turnId: "turn:test",
    });

    expect(chain).toBeNull();
  });

  it("rejects partial model-authored chains when any proposed expression is invalid", () => {
    const chain = runCalculatorModelAuthoredChain({
      prompt:
        "Use the scientific calculator to compute kinetic energy for mass 2 kg and speed 15 m per s then compute maximum height with g 9.80665.",
      threadId: "thread:test",
      turnId: "turn:test",
      subgoals: [
        {
          id: "compute_initial_kinetic_energy",
          label: "Compute initial kinetic energy",
          expression: "0.5*2*15^2",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "KE = 0.5*m*v^2",
        },
        {
          id: "compute_maximum_height",
          label: "Compute maximum height",
          expression: "0.5*2*15^2/(2*9 80665)",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "h = KE/(m*g)",
        },
      ],
    });

    expect(chain).toBeNull();
  });

  it("rejects model-authored height expressions that contradict energy conversion", () => {
    const chain = runCalculatorModelAuthoredChain({
      prompt:
        "Use the scientific calculator. A 0.20 kg ball moves at 18 m/s. Compute its kinetic energy and the maximum height it could reach if all kinetic energy converts to gravitational potential energy using g = 9.80665 m/s^2.",
      threadId: "thread:test",
      turnId: "turn:test",
      subgoals: [
        {
          id: "kinetic_energy",
          label: "Compute kinetic energy",
          expression: "0.5*0.2*18^2",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "KE = 0.5*m*v^2",
          variables: [
            { symbol: "m", value: "0.2", unit: "kg", meaning: "mass" },
            { symbol: "v", value: "18", unit: "m/s", meaning: "speed" },
          ],
        },
        {
          id: "maximum_height",
          label: "Compute maximum height",
          expression: "0.2*0.5*18^2/9.80665",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "h = KE/(m*g)",
          variables: [
            { symbol: "m", value: "0.2", unit: "kg", meaning: "mass" },
            { symbol: "g", value: "9.80665", unit: "m/s^2", meaning: "gravity" },
          ],
        },
      ],
    });

    expect(chain).toBeNull();
  });

  it("corrects model-authored photon frequency quantity and unit metadata", () => {
    const chain = runCalculatorModelAuthoredChain({
      prompt: "Use the scientific calculator to compute photon energy for 500 nm light in joules and eV.",
      threadId: "thread:test",
      turnId: "turn:test",
      subgoals: [
        {
          id: "calculate_frequency",
          label: "Calculate the frequency of the photon",
          expression: "3e8/(500e-9)",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "f = c / lambda",
        },
        {
          id: "calculate_photon_energy_joules",
          label: "Calculate photon energy in joules",
          expression: "6.62607015e-34*(3e8/(500e-9))",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "E = h f",
          depends_on: ["calculate_frequency"],
        },
        {
          id: "calculate_photon_energy_ev",
          label: "Convert photon energy to eV",
          expression: "(6.62607015e-34*(3e8/(500e-9)))/(1.602176634e-19)",
          expected_quantity: "energy",
          expected_unit: "eV",
          equation: "E_eV = E_J / e",
          depends_on: ["calculate_photon_energy_joules"],
        },
      ],
    });

    expect(chain).not.toBeNull();
    const frequencyReceipt = chain?.receipts.find((receipt) => receipt.subgoal_id === "calculate_frequency");
    const frequencyValidation = chain?.validations.find((validation) => validation.subgoal_id === "calculate_frequency");
    expect(frequencyReceipt?.result_unit).toBe("Hz");
    expect(frequencyReceipt?.result_quantity).toBe("frequency");
    expect(frequencyValidation).toMatchObject({
      expected_quantity: "frequency",
      expected_unit: "Hz",
      satisfied: true,
    });
  });
});
