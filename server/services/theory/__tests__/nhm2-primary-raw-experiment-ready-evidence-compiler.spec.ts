import { describe, expect, it } from "vitest";

import { isCasimirFiniteTemperatureFiniteGeometryMaxwellStress } from "../../../../shared/contracts/casimir-finite-temperature-finite-geometry-maxwell-stress.v1";
import { isNhm2ContinuousObserverOptimizer } from "../../../../shared/contracts/nhm2-continuous-observer-optimizer.v1";
import { isNhm2CovariantConservation } from "../../../../shared/contracts/nhm2-covariant-conservation.v1";
import { isNhm2DynamicBackreactionStabilityCausality } from "../../../../shared/contracts/nhm2-dynamic-backreaction-stability-causality.v1";
import { isNhm2FullApparatusSourceTensor } from "../../../../shared/contracts/nhm2-full-apparatus-source-tensor.v1";
import { isNhm2MechanicalSupportControlMargin } from "../../../../shared/contracts/nhm2-mechanical-support-control-margin.v1";
import { isNhm2SemiclassicalStateRealizabilityV2 as isNhm2SemiclassicalStateRealizability } from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v2";
import { isNhm2WorldlineQeiCoverage } from "../../../../shared/contracts/nhm2-worldline-qei-coverage.v1";
import {
  NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_IDS,
  compileNhm2PrimaryRawExperimentReadyEvidence,
  compileNhm2PrimaryRawExperimentReadyEvidenceFromFilesystem,
  type CompileNhm2PrimaryRawExperimentReadyEvidenceInput,
} from "../nhm2-primary-raw-experiment-ready-evidence-compiler";
import { replayNhm2PrimaryRawGrContent } from "../nhm2-primary-raw-gr-content-replay";
import {
  replayNhm2PrimaryRawMaterialDynamicsContent,
  type Nhm2PrimaryRawMaterialDynamicsReplayInput,
} from "../nhm2-primary-raw-material-dynamics-content-replay";
import type { Nhm2PrimaryRawOutputFilesystemVerification } from "../nhm2-primary-raw-output-filesystem-verifier";

const rawVerification: Nhm2PrimaryRawOutputFilesystemVerification = {
  verified: false,
  violations: [{ code: "filesystem_file_changed" }],
  runRootRealPath: null,
  manifestPath: null,
  manifestSha256: null,
  manifest: null,
  files: [],
};

const materialDynamicsReplayContext = {
  receipts: { materialMeasurement: [], materialCoupon: [] },
  // The replay rejects unverified raw bytes before consulting thresholds.
  thresholds: {},
  thresholdBinding: {
    frozenBeforeReplay: true,
    sha256: "0".repeat(64),
  },
} as unknown as Omit<
  Nhm2PrimaryRawMaterialDynamicsReplayInput,
  "rawVerification"
>;

const exactInput = (): CompileNhm2PrimaryRawExperimentReadyEvidenceInput => {
  const grReplay = replayNhm2PrimaryRawGrContent(rawVerification);
  const materialDynamicsReplay = replayNhm2PrimaryRawMaterialDynamicsContent({
    ...materialDynamicsReplayContext,
    rawVerification,
  });
  return {
    rawVerification,
    grReplay,
    materialDynamicsReplay,
    materialDynamicsReplayContext,
  };
};

describe("NHM2 primary raw experiment-ready evidence compiler", () => {
  it("offers a production entry point that reopens filesystem evidence and constructs replays internally", async () => {
    const result =
      await compileNhm2PrimaryRawExperimentReadyEvidenceFromFilesystem({
        filesystem: {
          runRoot: `${process.cwd()}/definitely-missing-nhm2-raw-run-root`,
          manifestPath: "raw-output-manifest.json",
          trusted: {} as never,
        },
        materialDynamicsReplayContext,
      });

    expect(result.acceptedInput).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("raw_filesystem_verification_required");
    expect(result.replayIntegrity).toMatchObject({
      grExactMatch: true,
      materialDynamicsExactMatch: true,
    });
    expect(result.claimBoundary.physicalViabilityEstablished).toBe(false);
  });

  it("maps incomplete replay into all eight contract families while remaining blocked", () => {
    const result = compileNhm2PrimaryRawExperimentReadyEvidence(exactInput());

    expect(result.replayIntegrity.grExactMatch).toBe(true);
    expect(result.replayIntegrity.materialDynamicsExactMatch).toBe(true);
    expect(result.acceptedInput).toBe(false);
    expect(result.status).toBe("blocked");
    expect(Object.keys(result.evidence).sort()).toEqual(
      [...NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_IDS].sort(),
    );
    expect(
      Object.values(result.evidence).every(
        (entry) => entry.status === "blocked" && entry.ready === false,
      ),
    ).toBe(true);

    expect(result.evidence.semiclassical_state.blockers).toEqual(
      expect.arrayContaining([
        "semiclassical_mode_equation_kernel_unreplayed",
        "hadamard_state_admissibility_unreplayed",
        "renormalization_counterterm_and_ward_identity_unreplayed",
        "qei_semiclassical_state_identity_binding_unresolved",
        "connected_stress_noise_kernel_replay_unimplemented",
        "semiclassical_constraint_algebra_replay_unimplemented",
      ]),
    );
    expect(result.evidence.continuous_observer_optimizer.blockers).toContain(
      "continuous_global_observer_optimality_proof_unresolved",
    );
    expect(result.evidence.worldline_qei.blockers).toContain(
      "applicable_qei_theorem_binding_unresolved",
    );
    expect(result.evidence.worldline_qei.blockers).toEqual(
      expect.arrayContaining([
        "duty_scaled_stress_energy_authority_prohibited_unresolved",
        "cartesian_domain_coverage_proof_unresolved",
      ]),
    );
    expect(
      result.evidence.finite_temperature_finite_geometry_maxwell_stress
        .blockers,
    ).toContain("finite_geometry_maxwell_green_operator_kernel_unreplayed");
    expect(
      result.evidence.mechanical_support_control_margin.blockers,
    ).toContain("nonlinear_fea_constitutive_assembly_unreplayed");
    expect(
      result.evidence.dynamic_backreaction_stability_causality.blockers,
    ).toContain("bssn_evolution_equations_unresolved");

    expect(
      isNhm2FullApparatusSourceTensor(
        result.evidence.full_apparatus_source_tensor.artifact,
      ),
    ).toBe(true);
    expect(
      isNhm2SemiclassicalStateRealizability(
        result.evidence.semiclassical_state.artifact,
      ),
    ).toBe(true);
    expect(
      isNhm2CovariantConservation(
        result.evidence.covariant_conservation.artifact,
      ),
    ).toBe(true);
    expect(
      isNhm2ContinuousObserverOptimizer(
        result.evidence.continuous_observer_optimizer.artifact,
      ),
    ).toBe(true);
    expect(
      isNhm2WorldlineQeiCoverage(result.evidence.worldline_qei.artifact),
    ).toBe(true);
    expect(
      isNhm2DynamicBackreactionStabilityCausality(
        result.evidence.dynamic_backreaction_stability_causality.artifact,
      ),
    ).toBe(true);
    expect(
      isCasimirFiniteTemperatureFiniteGeometryMaxwellStress(
        result.evidence.finite_temperature_finite_geometry_maxwell_stress
          .artifact,
      ),
    ).toBe(true);
    expect(
      isNhm2MechanicalSupportControlMargin(
        result.evidence.mechanical_support_control_margin.artifact,
      ),
    ).toBe(true);
    expect(result.claimBoundary).toMatchObject({
      experimentReadyTheoryClosureClaimAllowed: false,
      theoryClosureEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      certifiedSpeedEstablished: false,
      empiricalValidationEstablished: false,
    });
  });

  it("treats producer-forged pass fields as replay-integrity failures and uses recomputed metrics", () => {
    const input = exactInput();
    const forgedGr = structuredClone(input.grReplay) as unknown as Record<
      string,
      unknown
    >;
    const grFamilies = forgedGr.families as Record<
      string,
      {
        disposition: string;
        blockers: string[];
        failures: string[];
        metrics: Record<string, unknown>;
      }
    >;
    for (const family of Object.values(grFamilies)) {
      family.disposition = "pass";
      family.blockers = [];
      family.failures = [];
    }
    grFamilies.full_apparatus_source_tensor.metrics.sampleCount = 999_999;
    forgedGr.inputVerificationAccepted = true;

    const forgedMaterial = structuredClone(
      input.materialDynamicsReplay,
    ) as unknown as Record<string, unknown>;
    forgedMaterial.status = "pass";
    forgedMaterial.acceptedInput = true;
    forgedMaterial.inputBlockers = [];
    const materialFamilies = forgedMaterial.families as Record<
      string,
      {
        status: string;
        blockers: string[];
        breaches: string[];
        metrics: Record<string, unknown>;
      }
    >;
    for (const family of Object.values(materialFamilies)) {
      family.status = "pass";
      family.blockers = [];
      family.breaches = [];
    }
    materialFamilies.semiclassical.metrics.sampleCount = 999_999;

    const result = compileNhm2PrimaryRawExperimentReadyEvidence({
      ...input,
      grReplay: forgedGr as never,
      materialDynamicsReplay: forgedMaterial as never,
    });

    expect(result.replayIntegrity.grExactMatch).toBe(false);
    expect(result.replayIntegrity.materialDynamicsExactMatch).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "provided_gr_replay_not_exact_outer_recomputation",
        "provided_material_dynamics_replay_not_exact_outer_recomputation",
      ]),
    );
    expect(result.acceptedInput).toBe(false);
    expect(result.status).toBe("blocked");
    expect(
      result.evidence.full_apparatus_source_tensor.replayMetrics.sampleCount,
    ).not.toBe(999_999);
    expect(
      result.evidence.semiclassical_state.replayMetrics.sampleCount,
    ).not.toBe(999_999);
    expect(
      Object.values(result.evidence).every((entry) => entry.ready === false),
    ).toBe(true);
    expect(result.claimBoundary.physicalViabilityEstablished).toBe(false);
    expect(result.claimBoundary.transportEstablished).toBe(false);
  });
});
