import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  NHM2_PRIMARY_RAW_OBSERVABLE_UNIT_BY_ID,
  NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS,
} from "../../../../shared/contracts/nhm2-primary-raw-content-policy.v1";
import { NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256 } from "../../../../shared/contracts/nhm2-primary-raw-output-manifest.v1";
import type { Nhm2PrimaryRawOutputFilesystemVerification } from "../nhm2-primary-raw-output-filesystem-verifier";
import {
  NHM2_SI_VACUUM_PERMITTIVITY_F_PER_M,
  computeNhm2PrimaryRawMaterialDynamicsThresholdSha256,
  replayNhm2PrimaryRawMaterialDynamicsContent,
  type Nhm2PrimaryRawMaterialDynamicsReplayInput,
  type Nhm2PrimaryRawMaterialDynamicsThresholds,
} from "../nhm2-primary-raw-material-dynamics-content-replay";

const MATERIAL_HASH = "1".repeat(64);
const COUPON_HASH = "2".repeat(64);

const thresholds: Nhm2PrimaryRawMaterialDynamicsThresholds = {
  relativeFloor: 1e-12,
  semiclassical: {
    rsetAbsoluteToleranceJPerM3: 1e-9,
    rsetRelativeTolerance: 1e-9,
    maxRelativeUncertainty95: 0.2,
    maxFinalBackreactionDeltaJPerM3: 0.051,
    maxBackreactionConvergenceRatio: 0.51,
  },
  maxwell: {
    correlationAbsoluteTolerance: 1e-18,
    correlationRelativeTolerance: 1e-12,
    stressAbsoluteTolerancePa: 1e-18,
    stressRelativeTolerance: 1e-12,
    forceAbsoluteToleranceN: 1e-18,
    forceRelativeTolerance: 1e-12,
    gradientAbsoluteToleranceNPerM: 1e-18,
    gradientRelativeTolerance: 1e-12,
    maxAbsoluteForceGradientNPerM: 1e-8,
  },
  mechanics: {
    residualAbsoluteToleranceN: 1e-12,
    residualRelativeTolerance: 1e-12,
    residualComparisonAbsoluteToleranceN: 1e-12,
    residualComparisonRelativeTolerance: 1e-12,
    minimumStructuralMargin: 0,
    minimumSourceRetentionMargin: 0,
    minimumOverlapRatio: 1,
    maxCycleEnergyJ: 2,
    maxWeightedHeatJ: 2,
    maxWeightedNoise: 2,
    maxTimingFraction: 1,
  },
  dynamics: {
    minimumRefinementOrder: 1.5,
    maxFinalIterationDelta: 0.051,
    maxPerturbationGrowthRate: 0.01,
    perturbationGrowthAbsoluteTolerance: 1e-12,
    minimumRayFrequency: 0.5,
    maximumCausalIntervalSquared: 0,
    minimumHyperbolicityMargin: 0.5,
    minimumNeighborhoodRobustMargin: 0.5,
    minimumNeighborhoodSamplesPerSide: 1,
  },
  observable: {
    predictionAbsoluteTolerance: 1e-12,
    predictionRelativeTolerance: 1e-12,
    uncertaintyAbsoluteTolerance: 1e-12,
    uncertaintyRelativeTolerance: 1e-12,
    maxPropagatedUncertainty95: 0.2,
  },
};

type FixtureOptions = {
  forgedRset?: boolean;
  missingCoupon?: boolean;
  overlapMissing?: boolean;
  observableDefinitionOrderMismatch?: boolean;
  observableSourceHashMismatch?: boolean;
  observableSourceUnverified?: boolean;
  observableComparisonOnlySource?: boolean;
  forgedObservableComparison?: boolean;
};

const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const floatBytes = (values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  return bytes;
};

const tensorRows = (...firstComponents: number[]): number[] =>
  firstComponents.flatMap((value) => [value, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const fixture = (
  options: FixtureOptions = {},
): Nhm2PrimaryRawMaterialDynamicsReplayInput => {
  const files: Array<Record<string, unknown>> = [];
  let nextId = 0;
  const addNumerical = (
    familyId: string,
    semanticRole: string,
    rows: number,
    columns: number,
    values: number[],
  ) => {
    const bytes = floatBytes(values);
    const fileId = `file_${String(nextId++).padStart(3, "0")}`;
    const path = `raw/${familyId}/${semanticRole}.f64`;
    const descriptor = {
      fileId,
      familyId,
      semanticRole,
      path,
      sha256: hash(bytes),
      sizeBytes: bytes.length,
      mediaType: "application/octet-stream",
      representation: {
        kind: "numerical_array",
        dtype: "float64",
        encoding: "raw_ieee754",
        endianness: "little",
        shape: [rows, columns],
        storageOrder: "row-major",
        componentOrder: Array.from(
          { length: columns },
          (_, index) => `c${index}`,
        ),
        unit: "candidate_normalized",
      },
    };
    files.push({
      kind: "numerical_array",
      descriptor,
      absolutePath: `C:/fixture/${path}`,
      observedSha256: descriptor.sha256,
      observedSizeBytes: descriptor.sizeBytes,
      observedMtimeMs: 1,
      observedCtimeMs: 1,
      values: new Float64Array(values),
    });
    return {
      familyId,
      semanticRole,
      fileId,
      sha256: descriptor.sha256,
    };
  };
  const addRecords = (
    familyId: string,
    semanticRole: string,
    rows: Array<Record<string, unknown>>,
  ) => {
    const source = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    const bytes = Buffer.from(source);
    const fileId = `file_${String(nextId++).padStart(3, "0")}`;
    const path = `raw/${familyId}/${semanticRole}.ndjson`;
    const descriptor = {
      fileId,
      familyId,
      semanticRole,
      path,
      sha256: hash(bytes),
      sizeBytes: bytes.length,
      mediaType: "application/x-ndjson",
      representation: {
        kind: "records",
        format: "ndjson",
        encoding: "utf8",
        recordMode: "record-stream",
        recordCount: rows.length,
        schema: {
          schemaId: `fixture_${semanticRole}`,
          schemaVersion: `fixture_${semanticRole}/v1`,
          primaryKey: [],
          fields: [],
        },
      },
    };
    files.push({
      kind: "records",
      descriptor,
      absolutePath: `C:/fixture/${path}`,
      observedSha256: descriptor.sha256,
      observedSizeBytes: descriptor.sizeBytes,
      observedMtimeMs: 1,
      observedCtimeMs: 1,
      records: rows,
    });
  };

  addNumerical(
    "semiclassical_state",
    "state_mode_coefficients",
    2,
    2,
    [1, 0, 1, 0],
  );
  addNumerical("semiclassical_state", "mode_basis_samples", 2, 2, [1, 0, 1, 0]);
  const deltaTensorProjectionSource = addNumerical(
    "semiclassical_state",
    "mode_tensor_contribution_components",
    2,
    10,
    tensorRows(2, 4),
  );
  addNumerical(
    "semiclassical_state",
    "renormalization_subtraction_samples",
    2,
    10,
    tensorRows(1, 1),
  );
  const comparisonOnlyRsetSource = addNumerical(
    "semiclassical_state",
    "renormalized_tensor_components",
    2,
    10,
    options.forgedRset ? tensorRows(0, 0) : tensorRows(1, 3),
  );
  addNumerical(
    "semiclassical_state",
    "uncertainty_samples",
    2,
    3,
    [0.9, 1, 1.1, 2.7, 3, 3.3],
  );
  addNumerical(
    "semiclassical_state",
    "backreaction_iteration_fields",
    3,
    10,
    tensorRows(0, 0.1, 0.15),
  );

  const e0 = NHM2_SI_VACUUM_PERMITTIVITY_F_PER_M;
  const electricGreen = [2, 2, 4, 4].flatMap((xx) => [
    xx,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  const electricCorrelation = [2, 2, 4, 4].flatMap((xx) => [xx, 0, 0, 0, 0, 0]);
  const magneticCorrelation = new Array(4 * 6).fill(0);
  const stress = [2, 2, 4, 4].flatMap((xx) => [
    0.5 * e0 * xx,
    0,
    0,
    -0.5 * e0 * xx,
    0,
    -0.5 * e0 * xx,
  ]);
  addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "matsubara_mode_samples",
    4,
    4,
    [300, 0, 1, 1, 300, 0, 1, 1, 300, 0, 1, 1, 300, 0, 1, 1],
  );
  const phaseProjectionSource = addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "electric_green_dyadic_components",
    4,
    18,
    electricGreen,
  );
  addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "magnetic_green_dyadic_components",
    4,
    18,
    new Array(4 * 18).fill(0),
  );
  addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "electric_field_correlation_components",
    4,
    6,
    electricCorrelation,
  );
  addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "magnetic_field_correlation_components",
    4,
    6,
    magneticCorrelation,
  );
  addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "integration_surface_samples",
    4,
    7,
    [
      0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1,
      0, 0, 1,
    ],
  );
  addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "maxwell_stress_components",
    4,
    6,
    stress,
  );
  addNumerical(
    "finite_temperature_finite_geometry_maxwell_stress",
    "force_gap_gradient_samples",
    2,
    3,
    [1, 2 * e0, 2 * e0, 2, 4 * e0, 2 * e0],
  );
  addRecords(
    "finite_temperature_finite_geometry_maxwell_stress",
    "material_region_records",
    [
      {
        material_region_id: "region",
        material_model_id: "model",
        measurement_receipt_sha256: MATERIAL_HASH,
      },
    ],
  );

  addRecords(
    "mechanical_support_control_margin",
    "stiffness_matrix_entries",
    Array.from({ length: 6 }, (_, index) => ({
      row_index: String(index),
      column_index: String(index),
      value: 1,
    })),
  );
  addRecords(
    "mechanical_support_control_margin",
    "material_constitutive_records",
    [
      {
        material_id: "material",
        model_id: "linear",
        coupon_receipt_sha256: COUPON_HASH,
      },
    ],
  );
  const forceProjectionSource = addNumerical(
    "mechanical_support_control_margin",
    "load_vector_components",
    2,
    3,
    [1, 1, 1, 1, 1, 1],
  );
  addNumerical(
    "mechanical_support_control_margin",
    "displacement_components",
    2,
    3,
    [1, 1, 1, 1, 1, 1],
  );
  addNumerical(
    "mechanical_support_control_margin",
    "residual_force_components",
    2,
    3,
    [0, 0, 0, 0, 0, 0],
  );
  addNumerical(
    "mechanical_support_control_margin",
    "support_retention_samples",
    2,
    5,
    options.overlapMissing
      ? [0.1, -1, 1, 0, 1, 0.2, 0, 0.9, -1, 1]
      : [0.2, 0, 0.8, -1, 1, 0.8, 1, 0.2, 0, 1],
  );
  addNumerical(
    "mechanical_support_control_margin",
    "active_control_cycle_samples",
    2,
    6,
    [0, 1, 0, 1, 0, 300, 1, 1, 1, 1, 1, 301],
  );
  addNumerical(
    "mechanical_support_control_margin",
    "energy_heat_noise_samples",
    2,
    4,
    [1, 1, 1, 0.5, 1, 1, 1, 0.5],
  );

  addRecords(
    "dynamic_backreaction_stability_causality",
    "evolution_grid_records",
    [
      { sample_id: "s0", region_id: "wall", time_index: "0", grid_index: "0" },
      { sample_id: "s1", region_id: "wall", time_index: "1", grid_index: "0" },
    ],
  );
  const geometryProjectionSource = addNumerical(
    "dynamic_backreaction_stability_causality",
    "evolved_geometry_components",
    2,
    20,
    Array.from({ length: 40 }, (_, index) => index / 40),
  );
  addNumerical(
    "dynamic_backreaction_stability_causality",
    "resolution_refinement_samples",
    3,
    3,
    [1, 4, 0, 2, 1, 0, 4, 0.25, 0],
  );
  addNumerical(
    "dynamic_backreaction_stability_causality",
    "backreaction_iteration_fields",
    3,
    10,
    tensorRows(0, 0.1, 0.15),
  );
  addNumerical(
    "dynamic_backreaction_stability_causality",
    "perturbation_mode_samples",
    2,
    4,
    [0, 1, 0, 0, 1, 1, 0, 0],
  );
  addNumerical(
    "dynamic_backreaction_stability_causality",
    "characteristic_ray_samples",
    2,
    7,
    [0, 0, 0, 0, 0, 1, 0.1, 1, 1, 0, 0, 0, 1, 0.2],
  );
  addNumerical(
    "dynamic_backreaction_stability_causality",
    "causal_screen_samples",
    2,
    5,
    [1, -1, 0, 0.1, 1, 1, -1, 1, 0.2, 1],
  );
  addNumerical(
    "dynamic_backreaction_stability_causality",
    "parameter_neighborhood_samples",
    2,
    3,
    [-1, 1, 0.1, 1, 1, 0.1],
  );
  addNumerical(
    "dynamic_backreaction_stability_causality",
    "constraint_residual_components",
    2,
    5,
    new Array(10).fill(0),
  );

  const definitionObservableIds = [...NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS];
  if (options.observableDefinitionOrderMismatch) {
    [definitionObservableIds[0], definitionObservableIds[1]] = [
      definitionObservableIds[1]!,
      definitionObservableIds[0]!,
    ];
  }
  const definitions = definitionObservableIds.map((observableId, index) => ({
    observable_id: observableId,
    target_time: `2026-07-19T00:00:0${index}.000Z`,
    unit: NHM2_PRIMARY_RAW_OBSERVABLE_UNIT_BY_ID[observableId],
    projection_id: `projection_${index}`,
  }));
  addRecords(
    "observable_projection",
    "observable_definition_records",
    definitions,
  );
  const projectionSources = [
    deltaTensorProjectionSource,
    phaseProjectionSource,
    geometryProjectionSource,
    forceProjectionSource,
    geometryProjectionSource,
    geometryProjectionSource,
  ];
  if (options.observableComparisonOnlySource) {
    projectionSources[0] = comparisonOnlyRsetSource;
  }
  if (options.observableSourceUnverified) {
    projectionSources[0] = {
      ...projectionSources[0]!,
      fileId: "not_in_verified_inventory",
    };
  }
  if (options.observableSourceHashMismatch) {
    projectionSources[0] = {
      ...projectionSources[0]!,
      sha256: "3".repeat(64),
    };
  }
  addRecords(
    "observable_projection",
    "projection_derivation_inputs",
    NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map((observableId, index) => ({
      input_id: `input_${index}`,
      observable_id: observableId,
      source_file_id: projectionSources[index]!.fileId,
      source_sha256: projectionSources[index]!.sha256,
    })),
  );
  addRecords(
    "observable_projection",
    "projection_operator_entries",
    NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map((observableId, index) => ({
      observable_id: observableId,
      source_index: String(index),
      coefficient: 2,
    })),
  );
  addNumerical(
    "observable_projection",
    "projection_source_values",
    6,
    1,
    [1, 2, 3, 4, 5, 6],
  );
  addNumerical(
    "observable_projection",
    "projection_jacobian_components",
    6,
    1,
    [1, 1, 1, 1, 1, 1],
  );
  addNumerical(
    "observable_projection",
    "projection_uncertainty_samples",
    6,
    3,
    [
      0.9, 1, 1.1, 1.9, 2, 2.1, 2.9, 3, 3.1, 3.9, 4, 4.1, 4.9, 5, 5.1, 5.9, 6,
      6.1,
    ],
  );
  addNumerical(
    "observable_projection",
    "observable_sample_vectors",
    6,
    3,
    options.forgedObservableComparison
      ? [0, 200, 9, 0, 400, 9, 0, 600, 9, 0, 800, 9, 0, 1000, 9, 0, 1200, 9]
      : [0, 2, 0.1, 0, 4, 0.1, 0, 6, 0.1, 0, 8, 0.1, 0, 10, 0.1, 0, 12, 0.1],
  );

  const descriptors = files.map((file) => file.descriptor);
  const rawVerification = {
    verified: true,
    violations: [],
    runRootRealPath: "C:/fixture",
    manifestPath: "C:/fixture/primary-raw-manifest.json",
    manifestSha256: "4".repeat(64),
    manifest: {
      contentPolicy: { sha256: NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256 },
      fileInventory: { files: descriptors },
    },
    files,
  } as unknown as Extract<
    Nhm2PrimaryRawOutputFilesystemVerification,
    { verified: true }
  >;
  return {
    rawVerification,
    receipts: {
      materialMeasurement: [{ sha256: MATERIAL_HASH, verified: true }],
      materialCoupon: options.missingCoupon
        ? []
        : [{ sha256: COUPON_HASH, verified: true }],
    },
    thresholds,
    thresholdBinding: {
      frozenBeforeReplay: true,
      sha256: computeNhm2PrimaryRawMaterialDynamicsThresholdSha256(thresholds),
    },
  };
};

describe("NHM2 primary raw material/dynamics outer replay", () => {
  it("does not let a forged producer RSET comparison pass an unresolved semiclassical kernel", () => {
    const result = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ forgedRset: true }),
    );

    expect(result.families.semiclassical.status).toBe("blocked");
    expect(result.families.semiclassical.breaches).toContain(
      "comparison_cross_check_failed:semiclassical_rset",
    );
    expect(
      result.families.semiclassical.metrics
        .reconstructedTensorComponentsJPerM3[0],
    ).toBe(1);
  });

  it("records a mechanical overlap breach while the nonlinear solve remains blocked", () => {
    const result = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ overlapMissing: true }),
    );

    expect(result.families.mechanics.status).toBe("blocked");
    expect(result.families.mechanics.metrics.overlapRatio).toBeCloseTo(0.5);
    expect(result.families.mechanics.breaches).toContain(
      "mechanical_support_retention_overlap_missing",
    );
  });

  it("blocks unverified coupon material and unresolved BSSN equations", () => {
    const result = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ missingCoupon: true }),
    );

    expect(result.families.mechanics.status).toBe("blocked");
    expect(result.families.mechanics.blockers).toContain(
      `material_coupon_receipt_unverified:${COUPON_HASH}`,
    );
    expect(result.families.dynamics.status).toBe("blocked");
    expect(result.families.dynamics.blockers).toContain(
      "bssn_evolution_equations_unresolved",
    );
    expect(
      result.families.dynamics.metrics.producerConstraintResidualHasAuthority,
    ).toBe(false);
  });

  it("deterministically replays the frozen six-observable order while dimensional normalization remains blocked", () => {
    const first = replayNhm2PrimaryRawMaterialDynamicsContent(fixture());
    const second = replayNhm2PrimaryRawMaterialDynamicsContent(fixture());

    expect(NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS).toEqual([
      "DeltaTmunu_xt",
      "delta_phi_f",
      "delta_tau",
      "delta_F",
      "h00_proxy",
      "R_0i0j",
    ]);
    expect(first.families.semiclassical.status).toBe("blocked");
    expect(first.families.semiclassical.blockers).toContain(
      "semiclassical_mode_equation_kernel_unreplayed",
    );
    expect(first.families.maxwell.status).toBe("blocked");
    expect(first.families.maxwell.blockers).toContain(
      "finite_geometry_maxwell_green_operator_kernel_unreplayed",
    );
    expect(first.families.mechanics.status).toBe("blocked");
    expect(first.families.mechanics.blockers).toContain(
      "nonlinear_fea_constitutive_assembly_unreplayed",
    );
    expect(first.unresolvedKernelBlockers).toEqual(
      expect.arrayContaining([
        "semiclassical_mode_equation_kernel_unreplayed",
        "finite_geometry_maxwell_green_operator_kernel_unreplayed",
        "nonlinear_fea_constitutive_assembly_unreplayed",
        "bssn_evolution_equations_unresolved",
        "observable_projection_source_component_unit_conversion_unresolved",
      ]),
    );
    expect(
      first.families.maxwell.metrics.maxwellStressComponentsPa[0],
    ).toBeCloseTo(NHM2_SI_VACUUM_PERMITTIVITY_F_PER_M, 20);
    expect(first.families.maxwell.metrics.normalForceByGapN).toEqual([
      2 * NHM2_SI_VACUUM_PERMITTIVITY_F_PER_M,
      4 * NHM2_SI_VACUUM_PERMITTIVITY_F_PER_M,
    ]);
    expect(first.families.maxwell.metrics.forceGradientNPerM).toEqual([
      2 * NHM2_SI_VACUUM_PERMITTIVITY_F_PER_M,
      2 * NHM2_SI_VACUUM_PERMITTIVITY_F_PER_M,
    ]);
    expect(first.families.observableProjection.status).toBe("blocked");
    expect(first.families.observableProjection.blockers).toContain(
      "observable_projection_source_component_unit_conversion_unresolved",
    );
    expect(first.families.observableProjection.metrics.observableIds).toEqual(
      NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS,
    );
    expect(
      first.families.observableProjection.metrics
        .verifiedDerivationSourceBindings,
    ).toHaveLength(6);
    expect(
      first.families.observableProjection.metrics
        .dimensionalNormalizationResolved,
    ).toBe(false);
    expect(
      first.families.observableProjection.metrics
        .comparisonSampleVectorsHaveAuthority,
    ).toBe(false);
    expect(first.families.observableProjection.metrics.predictedValues).toEqual(
      [2, 4, 6, 8, 10, 12],
    );
    expect(
      first.families.observableProjection.metrics.propagatedUncertainty95,
    ).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.1, 12),
        expect.closeTo(0.1, 12),
        expect.closeTo(0.1, 12),
        expect.closeTo(0.1, 12),
        expect.closeTo(0.1, 12),
        expect.closeTo(0.1, 12),
      ]),
    );
    expect(first.families.maxwell.metrics).toEqual(
      second.families.maxwell.metrics,
    );
    expect(first.families.observableProjection.metrics).toEqual(
      second.families.observableProjection.metrics,
    );
    expect(first.fileHashClosure?.closureSha256).toBe(
      second.fileHashClosure?.closureSha256,
    );
    expect(first.claimBoundary.physicalViabilityEstablished).toBe(false);
  });

  it("rejects reordered observable definitions instead of changing the frozen identity order", () => {
    const result = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ observableDefinitionOrderMismatch: true }),
    );

    expect(result.families.observableProjection.status).toBe("blocked");
    expect(result.families.observableProjection.blockers).toContain(
      "observable_definition_identity_order_or_unit_mismatch",
    );
    expect(result.families.observableProjection.metrics.observableIds).toEqual(
      NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS,
    );
  });

  it("requires every derivation source id and hash to close against the verified raw inventory", () => {
    const unverified = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ observableSourceUnverified: true }),
    );
    const wrongHash = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ observableSourceHashMismatch: true }),
    );

    expect(unverified.families.observableProjection.blockers).toEqual(
      expect.arrayContaining([
        "observable_derivation_source_file_unverified:DeltaTmunu_xt",
        "observable_derivation_source_hash_closure_incomplete",
      ]),
    );
    expect(wrongHash.families.observableProjection.blockers).toEqual(
      expect.arrayContaining([
        "observable_derivation_source_hash_mismatch:DeltaTmunu_xt",
        "observable_derivation_source_hash_closure_incomplete",
      ]),
    );
  });

  it("rejects an upstream comparison-only role as an observable derivation source", () => {
    const result = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ observableComparisonOnlySource: true }),
    );

    expect(result.families.observableProjection.blockers).toEqual(
      expect.arrayContaining([
        "observable_derivation_source_role_not_allowed:DeltaTmunu_xt",
        "observable_derivation_source_hash_closure_incomplete",
      ]),
    );
  });

  it("keeps comparison-only observable samples from controlling authoritative predictions", () => {
    const baseline = replayNhm2PrimaryRawMaterialDynamicsContent(fixture());
    const forged = replayNhm2PrimaryRawMaterialDynamicsContent(
      fixture({ forgedObservableComparison: true }),
    );

    expect(
      forged.families.observableProjection.metrics.predictedValues,
    ).toEqual(baseline.families.observableProjection.metrics.predictedValues);
    expect(
      forged.families.observableProjection.metrics
        .comparisonSampleVectorsHaveAuthority,
    ).toBe(false);
    expect(forged.families.observableProjection.breaches).toContain(
      "comparison_cross_check_failed:observable_predicted_values",
    );
  });

  it("fails closed when raw filesystem verification is not verified", () => {
    const input = fixture();
    input.rawVerification = {
      verified: false,
      violations: [{ code: "file_sha256_mismatch" }],
      runRootRealPath: null,
      manifestPath: null,
      manifestSha256: null,
      manifest: null,
      files: [],
    };

    const result = replayNhm2PrimaryRawMaterialDynamicsContent(input);

    expect(result.acceptedInput).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.inputBlockers).toEqual([
      "raw_filesystem_verification_required",
    ]);
  });
});
