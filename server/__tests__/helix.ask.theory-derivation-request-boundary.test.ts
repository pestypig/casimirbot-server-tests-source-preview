import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  extractExplicitTheoryDerivationRequestAssignments,
  parseTheoryDerivationRequestArgs,
  THEORY_DERIVATION_REQUEST_INPUT_PROPERTIES,
} from "../services/helix-ask/theory-congruence/derivation-request";

describe("theory derivation request extraction boundary", () => {
  it("normalizes an explicit derivation request in the recrowned service", () => {
    expect(parseTheoryDerivationRequestArgs({
      operation: "compare",
      target: "nanoflare power",
      target_observable: "P_nano",
      scale_min_log10_m: 4,
      scale_max_log10_m: 7,
      coordinate_frame: "solar rest frame",
      initial_boundary_conditions: ["t = 0", 3, "r = R_sun"],
      formal_system: "ZFC",
      requested_precision: "1 percent",
      evidence_maturity_ceiling: "reduced_order",
    }, "fallback")).toEqual({
      operation: "compare",
      target: "nanoflare power",
      targetObservable: "P_nano",
      scaleLog10M: { min: 4, max: 7 },
      coordinateFrame: "solar rest frame",
      initialBoundaryConditions: ["t = 0", "r = R_sun"],
      formalSystem: "ZFC",
      requestedPrecision: "1 percent",
      evidenceMaturityCeiling: "reduced_order",
      normalizationStatus: "explicit",
    });
  });

  it("does not infer execution authority when operation is absent", () => {
    expect(parseTheoryDerivationRequestArgs({
      target: "derive this equation",
      target_observable: "x",
    }, "derive this equation")).toBeUndefined();
  });

  it("preserves canonical key-value assignments without inferring from prose", () => {
    const assignments = extractExplicitTheoryDerivationRequestAssignments(
      "Use the reflection capability. operation=compare; " +
      "target=Einstein field equation and stress-energy conservation; " +
      "target_observable=nabla_mu_T_mu_nu; coordinate_frame=local_orthonormal; " +
      "evidence_maturity_ceiling=diagnostic. Report the result.",
    );

    expect(assignments).toEqual({
      operation: "compare",
      target: "Einstein field equation and stress-energy conservation",
      target_observable: "nabla_mu_T_mu_nu",
      coordinate_frame: "local_orthonormal",
      evidence_maturity_ceiling: "diagnostic",
    });
    expect(parseTheoryDerivationRequestArgs(assignments, "fallback")).toMatchObject({
      operation: "compare",
      target: "Einstein field equation and stress-energy conservation",
      targetObservable: "nabla_mu_T_mu_nu",
      coordinateFrame: "local_orthonormal",
      evidenceMaturityCeiling: "diagnostic",
      normalizationStatus: "explicit",
    });
  });

  it("does not convert ordinary derivation prose into structured authority", () => {
    expect(extractExplicitTheoryDerivationRequestAssignments(
      "Compare these equations, derive c, and use diagnostic evidence.",
    )).toEqual({});
  });

  it("owns the capability schema fragment outside the retiring route", () => {
    expect(THEORY_DERIVATION_REQUEST_INPUT_PROPERTIES).toMatchObject({
      operation: { enum: ["compare", "predict", "derive", "explain", "prove", "bound"] },
      target_observable: { type: "string" },
      evidence_maturity_ceiling: {
        enum: ["exploratory", "reduced_order", "diagnostic", "certified"],
      },
    });
  });

  it("keeps agi.plan as a pointer-only compatibility consumer", () => {
    const routeSource = readFileSync(
      path.resolve(process.cwd(), "server/routes/agi.plan.ts"),
      "utf8",
    );
    expect(routeSource).toContain(
      'from "../services/helix-ask/theory-congruence/derivation-request"',
    );
    expect(routeSource).toContain("parseTheoryDerivationRequestArgs(stepArgs, args.prompt)");
    expect(routeSource).toContain("...THEORY_DERIVATION_REQUEST_INPUT_PROPERTIES");
    expect(routeSource).not.toContain("const theoryDerivationRequestArg =");
  });
});
