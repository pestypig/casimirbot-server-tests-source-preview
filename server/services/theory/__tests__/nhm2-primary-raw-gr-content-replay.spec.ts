import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  NHM2_PRIMARY_RAW_CONTENT_POLICY,
  NHM2_PRIMARY_RAW_CONTENT_POLICY_ARTIFACT_ID,
  NHM2_PRIMARY_RAW_CONTENT_POLICY_CONTRACT_VERSION,
  NHM2_PRIMARY_RAW_REQUIRED_APPARATUS_TERMS,
  type Nhm2PrimaryRawRoleContentPolicyV1,
} from "../../../../shared/contracts/nhm2-primary-raw-content-policy.v1";
import {
  NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256,
  type Nhm2PrimaryRawOutputFamilyId,
  type Nhm2PrimaryRawOutputFileV1,
  type Nhm2PrimaryRawOutputManifestV1,
} from "../../../../shared/contracts/nhm2-primary-raw-output-manifest.v1";
import {
  replayNhm2PrimaryRawGrContent,
  type Nhm2PrimaryRawGrContentReplay,
} from "../nhm2-primary-raw-gr-content-replay";
import type {
  Nhm2PrimaryRawOutputFilesystemVerification,
  Nhm2PrimaryRawOutputVerifiedFile,
  Nhm2PrimaryRawOutputVerifiedNumericalFile,
  Nhm2PrimaryRawOutputVerifiedRecordFile,
} from "../nhm2-primary-raw-output-filesystem-verifier";

type VerifiedInput = Extract<
  Nhm2PrimaryRawOutputFilesystemVerification,
  { verified: true }
>;

type Fixture = {
  verification: VerifiedInput;
  numerical: Map<string, Nhm2PrimaryRawOutputVerifiedNumericalFile>;
  records: Map<string, Nhm2PrimaryRawOutputVerifiedRecordFile>;
};

const SAMPLE_COUNT = 64;
const WORLDLINE_COUNT = 24;
const WORLDLINE_SAMPLE_COUNT = SAMPLE_COUNT;
const TOTAL_WORLDLINE_SAMPLES = WORLDLINE_COUNT * WORLDLINE_SAMPLE_COUNT;
const DIRECTION_COUNT = 8_192;
const OBSERVER_CONDITIONS =
  NHM2_PRIMARY_RAW_CONTENT_POLICY.conventions.observerEnergyConditionOrder;
const OBSERVER_FORMULAS =
  NHM2_PRIMARY_RAW_CONTENT_POLICY.conventions.observerObjectiveFormulaIds;

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const roleKey = (family: string, role: string): string => `${family}:${role}`;

const policyFor = (
  family: Nhm2PrimaryRawOutputFamilyId,
  role: string,
): Nhm2PrimaryRawRoleContentPolicyV1 => {
  const policy = (
    NHM2_PRIMARY_RAW_CONTENT_POLICY.rolePolicies[family] as Record<
      string,
      Nhm2PrimaryRawRoleContentPolicyV1
    >
  )[role];
  if (policy == null) throw new Error(`policy missing: ${family}:${role}`);
  return policy;
};

const numericalBytes = (values: Float64Array): Buffer => {
  const bytes = Buffer.alloc(values.length * Float64Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index += 1)
    bytes.writeDoubleLE(values[index], index * Float64Array.BYTES_PER_ELEMENT);
  return bytes;
};

const makeNumerical = (input: {
  family: Nhm2PrimaryRawOutputFamilyId;
  role: string;
  rows: number;
  values?: Float64Array;
}): Nhm2PrimaryRawOutputVerifiedNumericalFile => {
  const policy = policyFor(input.family, input.role);
  if (policy.kind !== "numerical_array")
    throw new Error(`numerical policy required: ${input.family}:${input.role}`);
  const columns = policy.componentOrder.length;
  const values = input.values ?? new Float64Array(input.rows * columns);
  if (values.length !== input.rows * columns)
    throw new Error(`fixture shape mismatch: ${input.family}:${input.role}`);
  const bytes = numericalBytes(values);
  const digest = sha256(bytes);
  const descriptor: Nhm2PrimaryRawOutputFileV1 = {
    fileId: `${input.family}.${input.role}`,
    familyId: input.family,
    semanticRole: input.role,
    path: `raw/${input.family}/${input.role}.f64le`,
    sha256: digest,
    sizeBytes: bytes.byteLength,
    mediaType: "application/octet-stream",
    representation: {
      kind: "numerical_array",
      dtype: "float64",
      encoding: "raw_ieee754",
      endianness: "little",
      shape: [input.rows, columns],
      storageOrder: "row-major",
      componentOrder: [...policy.componentOrder],
      unit: policy.unit,
    },
  };
  return {
    kind: "numerical_array",
    descriptor,
    absolutePath: `C:/verified/${descriptor.path}`,
    observedSha256: digest,
    observedSizeBytes: bytes.byteLength,
    observedMtimeMs: 1,
    observedCtimeMs: 1,
    values,
  };
};

const recordsBytes = (
  records: ReadonlyArray<Record<string, unknown>>,
): Buffer =>
  Buffer.from(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );

const makeRecords = (input: {
  family: Nhm2PrimaryRawOutputFamilyId;
  role: string;
  records: Array<Record<string, unknown>>;
}): Nhm2PrimaryRawOutputVerifiedRecordFile => {
  const policy = policyFor(input.family, input.role);
  if (policy.kind !== "records")
    throw new Error(`record policy required: ${input.family}:${input.role}`);
  const bytes = recordsBytes(input.records);
  const digest = sha256(bytes);
  const descriptor: Nhm2PrimaryRawOutputFileV1 = {
    fileId: `${input.family}.${input.role}`,
    familyId: input.family,
    semanticRole: input.role,
    path: `raw/${input.family}/${input.role}.ndjson`,
    sha256: digest,
    sizeBytes: bytes.byteLength,
    mediaType: "application/x-ndjson",
    representation: {
      kind: "records",
      format: "ndjson",
      encoding: "utf8",
      recordMode: "record-stream",
      recordCount: input.records.length,
      schema: {
        schemaId: policy.schemaId,
        schemaVersion: policy.schemaVersion,
        primaryKey: [...policy.primaryKey],
        fields: policy.fields.map((field) => ({ ...field })),
      },
    },
  };
  return {
    kind: "records",
    descriptor,
    absolutePath: `C:/verified/${descriptor.path}`,
    observedSha256: digest,
    observedSizeBytes: bytes.byteLength,
    observedMtimeMs: 1,
    observedCtimeMs: 1,
    records: input.records,
  };
};

const minkowskiTensor10 = (): number[] => [-1, 0, 0, 0, 1, 0, 0, 1, 0, 1];

const repeatedRows = (rows: number, row: readonly number[]): Float64Array => {
  const values = new Float64Array(rows * row.length);
  for (let index = 0; index < rows; index += 1)
    values.set(row, index * row.length);
  return values;
};

const gridRecords = (): Array<Record<string, unknown>> =>
  Array.from({ length: SAMPLE_COUNT }, (_, index) => ({
    sample_id: `grid-${index}`,
    region_id: "wall",
    i: String(index),
    j: "0",
    k: "0",
  }));

const spatialRecords = (): Array<Record<string, unknown>> =>
  Array.from({ length: SAMPLE_COUNT }, (_, index) => ({
    sample_id: `observer-${index}`,
    region_id: "wall",
  }));

const observerBindingRecords = (): Array<Record<string, unknown>> =>
  Array.from(
    { length: SAMPLE_COUNT * OBSERVER_CONDITIONS.length },
    (_, row) => {
      const sample = Math.floor(row / OBSERVER_CONDITIONS.length);
      const condition = OBSERVER_CONDITIONS[row % OBSERVER_CONDITIONS.length]!;
      return {
        binding_id: `observer-${sample}:${condition}`,
        sample_id: `observer-${sample}`,
        energy_condition_id: condition,
        objective_formula_id: OBSERVER_FORMULAS[condition],
        optimum_row: String(row),
        trace_offset: String(row),
        trace_count: "1",
        adversarial_start_offset: String(row * 2),
        adversarial_start_count: "2",
        globality_offset: String(row * 3),
        globality_count: "3",
      };
    },
  );

const worldlineRecords = (): Array<Record<string, unknown>> =>
  Array.from({ length: WORLDLINE_COUNT }, (_, index) => ({
    worldline_id: `worldline-${index}`,
    region_id: "wall",
    sampling_family_id: "stationary",
    sample_offset: String(index * WORLDLINE_SAMPLE_COUNT),
    sample_count: String(WORLDLINE_SAMPLE_COUNT),
  }));

const interpolationRecords = (): Array<Record<string, unknown>> =>
  Array.from({ length: TOTAL_WORLDLINE_SAMPLES }, (_, row) => {
    const worldline = Math.floor(row / WORLDLINE_SAMPLE_COUNT);
    const local = row % WORLDLINE_SAMPLE_COUNT;
    return {
      worldline_id: `worldline-${worldline}`,
      worldline_sample_index: String(row),
      entry_index: "0",
      apparatus_sample_index: String(local),
      weight: 1,
    };
  });

const addFile = (
  fixture: Fixture,
  file: Nhm2PrimaryRawOutputVerifiedFile,
): void => {
  fixture.verification.files.push(file);
  fixture.verification.manifest.fileInventory.files.push(file.descriptor);
  if (file.kind === "numerical_array")
    fixture.numerical.set(
      roleKey(file.descriptor.familyId, file.descriptor.semanticRole),
      file,
    );
  else
    fixture.records.set(
      roleKey(file.descriptor.familyId, file.descriptor.semanticRole),
      file,
    );
};

const buildFixture = (): Fixture => {
  const manifest = {
    contentPolicy: {
      artifactId: NHM2_PRIMARY_RAW_CONTENT_POLICY_ARTIFACT_ID,
      contractVersion: NHM2_PRIMARY_RAW_CONTENT_POLICY_CONTRACT_VERSION,
      sha256: NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256,
    },
    identity: { candidateId: "flat-space-candidate" },
    execution: { runId: "flat-space-run" },
    fileInventory: { files: [] as Nhm2PrimaryRawOutputFileV1[] },
  } as unknown as Nhm2PrimaryRawOutputManifestV1;
  const verification: VerifiedInput = {
    verified: true,
    violations: [],
    runRootRealPath: "C:/verified",
    manifestPath: "C:/verified/raw-manifest.json",
    manifestSha256: "a".repeat(64),
    manifest,
    files: [],
  };
  const fixture: Fixture = {
    verification,
    numerical: new Map(),
    records: new Map(),
  };

  const semiclassicalSource = makeNumerical({
    family: "semiclassical_state",
    role: "mode_tensor_contribution_components",
    rows: SAMPLE_COUNT,
  });
  const semiclassicalConstitutive = makeRecords({
    family: "semiclassical_state",
    role: "renormalization_inputs",
    records: Array.from({ length: 4 }, (_, index) => ({
      parameter_id: `renormalization-${index}`,
      value: 0,
      source_sha256: sha256(`renormalization-${index}`),
    })),
  });
  const electromagneticSource = makeNumerical({
    family: "finite_temperature_finite_geometry_maxwell_stress",
    role: "electric_field_correlation_components",
    rows: SAMPLE_COUNT,
  });
  const electromagneticConstitutive = makeRecords({
    family: "finite_temperature_finite_geometry_maxwell_stress",
    role: "material_region_records",
    records: Array.from({ length: 2 }, (_, index) => ({
      material_region_id: `material-${index}`,
      material_model_id: `model-${index}`,
      measurement_receipt_sha256: sha256(`measurement-${index}`),
    })),
  });
  const mechanicalSource = makeNumerical({
    family: "mechanical_support_control_margin",
    role: "load_vector_components",
    rows: SAMPLE_COUNT,
  });
  const controlSource = makeNumerical({
    family: "mechanical_support_control_margin",
    role: "active_control_cycle_samples",
    rows: SAMPLE_COUNT,
  });
  const thermalSource = makeNumerical({
    family: "mechanical_support_control_margin",
    role: "energy_heat_noise_samples",
    rows: SAMPLE_COUNT,
  });
  const mechanicalReturnSource = makeNumerical({
    family: "mechanical_support_control_margin",
    role: "displacement_components",
    rows: SAMPLE_COUNT,
  });
  const mechanicalConstitutive = makeRecords({
    family: "mechanical_support_control_margin",
    role: "material_constitutive_records",
    records: [
      {
        material_id: "support-material",
        model_id: "fixture-linear-elastic",
        coupon_receipt_sha256: sha256("fixture-coupon"),
      },
    ],
  });
  const controlConstitutive = makeRecords({
    family: "mechanical_support_control_margin",
    role: "boundary_condition_records",
    records: [
      {
        boundary_id: "control-boundary",
        node_set_ref: "fixture-node-set",
        condition_id: "fixture-control",
        value_ref: "fixture-control-values",
      },
    ],
  });
  const switchingSource = makeNumerical({
    family: "dynamic_backreaction_stability_causality",
    role: "evolved_source_components",
    rows: 16,
  });
  const switchingConstitutive = makeRecords({
    family: "dynamic_backreaction_stability_causality",
    role: "evolution_grid_records",
    records: Array.from({ length: 16 }, (_, index) => ({
      sample_id: `evolution-${index}`,
      region_id: "wall",
      time_index: String(index),
      grid_index: String(index),
    })),
  });
  for (const file of [
    semiclassicalSource,
    semiclassicalConstitutive,
    electromagneticSource,
    electromagneticConstitutive,
    mechanicalSource,
    controlSource,
    thermalSource,
    mechanicalReturnSource,
    mechanicalConstitutive,
    controlConstitutive,
    switchingSource,
    switchingConstitutive,
  ])
    addFile(fixture, file);

  const term = makeNumerical({
    family: "full_apparatus_source_tensor",
    role: "term_tensor_components",
    rows: SAMPLE_COUNT * NHM2_PRIMARY_RAW_REQUIRED_APPARATUS_TERMS.length,
  });
  addFile(fixture, term);
  const termSources = {
    casimir_material_field: [semiclassicalSource, semiclassicalConstitutive],
    supports: [mechanicalSource, mechanicalConstitutive],
    anchors: [mechanicalSource, mechanicalConstitutive],
    housing: [mechanicalSource, mechanicalConstitutive],
    controls: [controlSource, controlConstitutive],
    switching_return: [switchingSource, switchingConstitutive],
    thermal_return: [thermalSource, mechanicalConstitutive],
    electromagnetic_return: [
      electromagneticSource,
      electromagneticConstitutive,
    ],
    mechanical_return: [mechanicalReturnSource, mechanicalConstitutive],
  } as const;
  addFile(
    fixture,
    makeRecords({
      family: "full_apparatus_source_tensor",
      role: "apparatus_term_ledger",
      records: NHM2_PRIMARY_RAW_REQUIRED_APPARATUS_TERMS.map(
        (termCategory, index) => {
          const [sourceFile, constitutiveFile] = termSources[termCategory];
          return {
            term_id: `flat-${termCategory}`,
            term_category: termCategory,
            producer_id: "fixture-solver",
            source_field_ref: sourceFile.descriptor.path,
            source_file_id: sourceFile.descriptor.fileId,
            source_sha256: sourceFile.observedSha256,
            constitutive_file_id: constitutiveFile.descriptor.fileId,
            constitutive_sha256: constitutiveFile.observedSha256,
            tensor_file_id: term.descriptor.fileId,
            sample_offset: String(index * SAMPLE_COUNT),
            sample_count: String(SAMPLE_COUNT),
            coefficient: 1,
            tensor_sha256: term.observedSha256,
            returned_to_source_tensor: true,
            metric_target_dependency_count: "0",
            forbidden_target_echo_count: "0",
          };
        },
      ),
    }),
  );
  addFile(
    fixture,
    makeRecords({
      family: "full_apparatus_source_tensor",
      role: "grid_topology_records",
      records: gridRecords(),
    }),
  );
  const apparatusCoordinates = new Float64Array(SAMPLE_COUNT * 4);
  for (let row = 0; row < SAMPLE_COUNT; row += 1)
    apparatusCoordinates[row * 4] = row;
  addFile(
    fixture,
    makeNumerical({
      family: "full_apparatus_source_tensor",
      role: "coordinate_samples",
      rows: SAMPLE_COUNT,
      values: apparatusCoordinates,
    }),
  );
  for (const [role, columns, row] of [
    ["total_tensor_components", 10, Array(10).fill(0)],
    ["metric_tensor_components", 10, minkowskiTensor10()],
    ["metric_required_tensor_components", 10, Array(10).fill(0)],
    ["residual_components", 10, Array(10).fill(0)],
    ["integration_weight_mask_samples", 2, [1, 1]],
  ] as const) {
    expect(row).toHaveLength(columns);
    addFile(
      fixture,
      makeNumerical({
        family: "full_apparatus_source_tensor",
        role,
        rows: SAMPLE_COUNT,
        values: repeatedRows(SAMPLE_COUNT, row),
      }),
    );
  }

  for (const [role, row] of [
    ["connection_coefficient_components", Array(64).fill(0)],
    ["tensor_derivative_components", Array(40).fill(0)],
    ["divergence_components", Array(4).fill(0)],
    ["switching_transition_components", Array(10).fill(0)],
    ["support_control_source_components", Array(10).fill(0)],
    ["boundary_normal_weight_samples", [1, 0, 0, 0, 1]],
    ["boundary_flux_components", Array(4).fill(0)],
    ["cycle_energy_samples", [0, 0, 0, 0, 0]],
  ] as const) {
    const values = repeatedRows(SAMPLE_COUNT, row);
    if (role === "cycle_energy_samples") {
      for (let index = 0; index < SAMPLE_COUNT; index += 1)
        values[index * row.length] = index;
    }
    addFile(
      fixture,
      makeNumerical({
        family: "covariant_conservation",
        role,
        rows: SAMPLE_COUNT,
        values,
      }),
    );
  }

  addFile(
    fixture,
    makeRecords({
      family: "continuous_observer_optimizer",
      role: "spatial_sample_index",
      records: spatialRecords(),
    }),
  );
  addFile(
    fixture,
    makeRecords({
      family: "continuous_observer_optimizer",
      role: "energy_condition_optimizer_bindings",
      records: observerBindingRecords(),
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "timelike_observer_vectors",
      rows: SAMPLE_COUNT,
      values: repeatedRows(SAMPLE_COUNT, [1, 0, 0, 0]),
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "condition_optimum_timelike_vectors",
      rows: SAMPLE_COUNT * OBSERVER_CONDITIONS.length,
      values: repeatedRows(
        SAMPLE_COUNT * OBSERVER_CONDITIONS.length,
        [1, 0, 0, 0],
      ),
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "condition_optimum_objective_samples",
      rows: SAMPLE_COUNT * OBSERVER_CONDITIONS.length,
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "null_direction_vectors",
      rows: DIRECTION_COUNT,
      values: (() => {
        const values = new Float64Array(DIRECTION_COUNT * 4);
        const directionsPerSample = DIRECTION_COUNT / SAMPLE_COUNT;
        for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
          for (
            let direction = 0;
            direction < directionsPerSample;
            direction += 1
          ) {
            const row = sample * directionsPerSample + direction;
            const angle = (2 * Math.PI * direction) / directionsPerSample;
            values[row * 4] = 1;
            values[row * 4 + 1] = Math.cos(angle);
            values[row * 4 + 2] = Math.sin(angle);
          }
        }
        return values;
      })(),
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "tensor_contraction_samples",
      rows: DIRECTION_COUNT,
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "energy_condition_extrema",
      rows: SAMPLE_COUNT,
    }),
  );
  const optimizerBindingCount = SAMPLE_COUNT * OBSERVER_CONDITIONS.length;
  const optimizerTrace = new Float64Array(optimizerBindingCount * 3);
  const adversarialStarts = new Float64Array(optimizerBindingCount * 2 * 4);
  const globalitySearch = new Float64Array(optimizerBindingCount * 3 * 2);
  for (let binding = 0; binding < optimizerBindingCount; binding += 1) {
    optimizerTrace[binding * 3] = 0;
    for (let start = 0; start < 2; start += 1) {
      const row = binding * 2 + start;
      const rapidity = start === 0 ? -1e-3 : 1e-3;
      adversarialStarts[row * 4] = Math.cosh(rapidity);
      adversarialStarts[row * 4 + 1] = Math.sinh(rapidity);
    }
    const globalityOffset = binding * 3;
    for (let level = 0; level < 3; level += 1) {
      globalitySearch[(globalityOffset + level) * 2] = level + 1;
      globalitySearch[(globalityOffset + level) * 2 + 1] = level === 0 ? 1 : 2;
    }
  }
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "optimizer_trace_samples",
      rows: optimizerBindingCount,
      values: optimizerTrace,
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "optimizer_trace_objective_samples",
      rows: optimizerBindingCount,
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "adversarial_start_samples",
      rows: optimizerBindingCount * 2,
      values: adversarialStarts,
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "adversarial_start_objective_samples",
      rows: optimizerBindingCount * 2,
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "globality_search_samples",
      rows: optimizerBindingCount * 3,
      values: globalitySearch,
    }),
  );
  addFile(
    fixture,
    makeNumerical({
      family: "continuous_observer_optimizer",
      role: "globality_objective_samples",
      rows: optimizerBindingCount * 3,
    }),
  );

  addFile(
    fixture,
    makeRecords({
      family: "worldline_qei",
      role: "worldline_catalog",
      records: worldlineRecords(),
    }),
  );
  addFile(
    fixture,
    makeRecords({
      family: "worldline_qei",
      role: "worldline_apparatus_interpolation_entries",
      records: interpolationRecords(),
    }),
  );
  const trajectory = new Float64Array(TOTAL_WORLDLINE_SAMPLES * 4);
  const properTime = new Float64Array(TOTAL_WORLDLINE_SAMPLES * 2);
  const sampling = new Float64Array(TOTAL_WORLDLINE_SAMPLES * 4);
  const integrand = new Float64Array(TOTAL_WORLDLINE_SAMPLES * 3);
  for (let worldline = 0; worldline < WORLDLINE_COUNT; worldline += 1) {
    for (let local = 0; local < WORLDLINE_SAMPLE_COUNT; local += 1) {
      const row = worldline * WORLDLINE_SAMPLE_COUNT + local;
      trajectory[row * 4] = local;
      properTime[row * 2] = local;
      properTime[row * 2 + 1] = 1 / WORLDLINE_SAMPLE_COUNT;
      sampling[row * 4] = local;
      sampling[row * 4 + 1] = 1;
      integrand[row * 3] = local;
      integrand[row * 3 + 2] = 1 / WORLDLINE_SAMPLE_COUNT;
    }
  }
  for (const [role, rows, values] of [
    ["trajectory_components", TOTAL_WORLDLINE_SAMPLES, trajectory],
    ["proper_time_samples", TOTAL_WORLDLINE_SAMPLES, properTime],
    [
      "four_velocity_components",
      TOTAL_WORLDLINE_SAMPLES,
      repeatedRows(TOTAL_WORLDLINE_SAMPLES, [1, 0, 0, 0]),
    ],
    [
      "acceleration_curvature_components",
      TOTAL_WORLDLINE_SAMPLES,
      new Float64Array(TOTAL_WORLDLINE_SAMPLES * 8),
    ],
    [
      "pulled_back_tensor_components",
      TOTAL_WORLDLINE_SAMPLES,
      new Float64Array(TOTAL_WORLDLINE_SAMPLES * 10),
    ],
    [
      "pulled_back_metric_components",
      TOTAL_WORLDLINE_SAMPLES,
      repeatedRows(TOTAL_WORLDLINE_SAMPLES, minkowskiTensor10()),
    ],
    [
      "contracted_tensor_samples",
      TOTAL_WORLDLINE_SAMPLES,
      new Float64Array(TOTAL_WORLDLINE_SAMPLES),
    ],
    ["sampling_function_samples", TOTAL_WORLDLINE_SAMPLES, sampling],
    ["quadrature_integrand_samples", TOTAL_WORLDLINE_SAMPLES, integrand],
    [
      "theorem_bound_inputs",
      WORLDLINE_COUNT,
      repeatedRows(WORLDLINE_COUNT, [0, 0, 63, 1]),
    ],
  ] as const) {
    addFile(
      fixture,
      makeNumerical({ family: "worldline_qei", role, rows, values }),
    );
  }
  return fixture;
};

const refreshNumericalHash = (
  file: Nhm2PrimaryRawOutputVerifiedNumericalFile,
): void => {
  const bytes = numericalBytes(file.values);
  const digest = sha256(bytes);
  file.observedSha256 = digest;
  file.observedSizeBytes = bytes.byteLength;
  file.descriptor.sha256 = digest;
  file.descriptor.sizeBytes = bytes.byteLength;
};

const mutateNumerical = (
  fixture: Fixture,
  family: Nhm2PrimaryRawOutputFamilyId,
  role: string,
  mutate: (values: Float64Array) => void,
): void => {
  const file = fixture.numerical.get(roleKey(family, role));
  if (file == null)
    throw new Error(`numerical fixture missing: ${family}:${role}`);
  mutate(file.values);
  refreshNumericalHash(file);
};

const refreshRecordHash = (
  file: Nhm2PrimaryRawOutputVerifiedRecordFile,
): void => {
  const records = file.records as Array<Record<string, unknown>>;
  const bytes = recordsBytes(records);
  const digest = sha256(bytes);
  file.observedSha256 = digest;
  file.observedSizeBytes = bytes.byteLength;
  file.descriptor.sha256 = digest;
  file.descriptor.sizeBytes = bytes.byteLength;
  if (file.descriptor.representation.kind === "records")
    file.descriptor.representation.recordCount = records.length;
};

const expectAllClaimsClosed = (result: Nhm2PrimaryRawGrContentReplay): void => {
  expect(result.claimBoundary).toMatchObject({
    diagnosticOnly: true,
    theoryClosureClaimAllowed: false,
    physicalViabilityClaimAllowed: false,
    transportClaimAllowed: false,
    propulsionClaimAllowed: false,
    routeEtaClaimAllowed: false,
    speedClaimAllowed: false,
    empiricalReceiptsRequired: true,
  });
};

describe("NHM2 primary raw GR content replay", () => {
  it("recomputes the available flat-space algebra and blocks scientifically unbound closure", () => {
    const fixture = buildFixture();
    const result = replayNhm2PrimaryRawGrContent(fixture.verification);

    expect(result.inputVerificationAccepted).toBe(true);
    expect(result.rawFileHashClosure?.entryCount).toBe(
      fixture.verification.files.length,
    );
    expect(result.families.full_apparatus_source_tensor.disposition).toBe(
      "pass",
    );
    expect(result.families.covariant_conservation.disposition).toBe("pass");
    expect(result.families.continuous_observer_optimizer.disposition).toBe(
      "blocked",
    );
    expect(result.families.worldline_qei.disposition).toBe("blocked");
    expect(
      result.families.full_apparatus_source_tensor.metrics
        .activeTensorValueCount,
    ).toBe(SAMPLE_COUNT * 10);
    expect(
      result.families.full_apparatus_source_tensor.metrics.requiredTermCount,
    ).toBe(NHM2_PRIMARY_RAW_REQUIRED_APPARATUS_TERMS.length);
    expect(
      result.families.full_apparatus_source_tensor.metrics
        .coveredRequiredTermCount,
    ).toBe(NHM2_PRIMARY_RAW_REQUIRED_APPARATUS_TERMS.length);
    expect(
      result.families.full_apparatus_source_tensor.metrics.sourceBindingCount,
    ).toBe(NHM2_PRIMARY_RAW_REQUIRED_APPARATUS_TERMS.length);
    expect(
      result.families.continuous_observer_optimizer.metrics.directionCount,
    ).toBe(DIRECTION_COUNT);
    expect(result.families.worldline_qei.metrics.worldlineCount).toBe(
      WORLDLINE_COUNT,
    );
    expect(result.families.worldline_qei.metrics.minimumMargin).toBe(1);
    expect(
      result.families.covariant_conservation.metrics
        .fourComponentTransitionResidualRelative,
    ).toBe(0);
    expect(result.families.continuous_observer_optimizer.blockers).toEqual([
      "observer_continuous_globality_unproven",
    ]);
    expect(result.families.worldline_qei.blockers).toEqual([
      "qei_theorem_bound_derivation_unbound",
    ]);
    expect(
      result.families.worldline_qei.metrics
        .maximumInterpolationWeightNormalizationError,
    ).toBe(0);
    expect(
      result.families.worldline_qei.metrics.metricPullbackComparisonMaxAbs,
    ).toBe(0);
    expect(result.assumptions).toMatchObject({
      metricSignature: "-+++",
      tensorVariance: "covariant",
      spacetimeVectorVariance: "contravariant",
    });
    expectAllClaimsClosed(result);
  });

  it("blocks a ledger that omits a required apparatus contribution", () => {
    const fixture = buildFixture();
    const ledger = fixture.records.get(
      roleKey("full_apparatus_source_tensor", "apparatus_term_ledger"),
    );
    if (ledger == null) throw new Error("apparatus ledger fixture missing");
    const records = ledger.records as Array<Record<string, unknown>>;
    const omitted = records.findIndex(
      (record) => record.term_category === "mechanical_return",
    );
    records.splice(omitted, 1);
    refreshRecordHash(ledger);

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.full_apparatus_source_tensor.disposition).toBe(
      "blocked",
    );
    expect(result.families.full_apparatus_source_tensor.blockers).toContain(
      "apparatus_required_term_missing:mechanical_return",
    );
  });

  it("blocks a source term whose declared raw-source hash is not bound", () => {
    const fixture = buildFixture();
    const ledger = fixture.records.get(
      roleKey("full_apparatus_source_tensor", "apparatus_term_ledger"),
    );
    if (ledger == null) throw new Error("apparatus ledger fixture missing");
    (ledger.records[0] as Record<string, unknown>).source_sha256 = "0".repeat(
      64,
    );
    refreshRecordHash(ledger);

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.full_apparatus_source_tensor.disposition).toBe(
      "blocked",
    );
    expect(result.families.full_apparatus_source_tensor.blockers).toContain(
      "apparatus_source_binding_invalid:casimir_material_field",
    );
  });

  it("blocks a source term bound only to a producer comparison array", () => {
    const fixture = buildFixture();
    const comparison = makeNumerical({
      family: "finite_temperature_finite_geometry_maxwell_stress",
      role: "maxwell_stress_components",
      rows: SAMPLE_COUNT,
    });
    addFile(fixture, comparison);
    const ledger = fixture.records.get(
      roleKey("full_apparatus_source_tensor", "apparatus_term_ledger"),
    );
    if (ledger == null) throw new Error("apparatus ledger fixture missing");
    const electromagnetic = ledger.records.find(
      (record) => record.term_category === "electromagnetic_return",
    );
    if (electromagnetic == null)
      throw new Error("electromagnetic return term missing");
    electromagnetic.source_field_ref = comparison.descriptor.path;
    electromagnetic.source_file_id = comparison.descriptor.fileId;
    electromagnetic.source_sha256 = comparison.observedSha256;
    refreshRecordHash(ledger);

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.full_apparatus_source_tensor.disposition).toBe(
      "blocked",
    );
    expect(result.families.full_apparatus_source_tensor.blockers).toContain(
      "apparatus_source_binding_invalid:electromagnetic_return",
    );
  });

  it("fails a ledger that declares any metric-target dependency", () => {
    const fixture = buildFixture();
    const ledger = fixture.records.get(
      roleKey("full_apparatus_source_tensor", "apparatus_term_ledger"),
    );
    if (ledger == null) throw new Error("apparatus ledger fixture missing");
    (
      ledger.records[0] as Record<string, unknown>
    ).metric_target_dependency_count = "1";
    refreshRecordHash(ledger);

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.full_apparatus_source_tensor.disposition).toBe(
      "fail",
    );
    expect(result.families.full_apparatus_source_tensor.failures).toContain(
      "apparatus_metric_target_dependency:casimir_material_field",
    );
  });

  it.each([
    {
      label: "producer total",
      family: "full_apparatus_source_tensor" as const,
      role: "total_tensor_components",
      diagnostic: "full_apparatus_source_tensor" as const,
      failure: "producer_total_tensor_comparison_mismatch",
      disposition: "fail" as const,
    },
    {
      label: "producer residual",
      family: "full_apparatus_source_tensor" as const,
      role: "residual_components",
      diagnostic: "full_apparatus_source_tensor" as const,
      failure: "producer_residual_tensor_comparison_mismatch",
      disposition: "fail" as const,
    },
    {
      label: "producer divergence",
      family: "covariant_conservation" as const,
      role: "divergence_components",
      diagnostic: "covariant_conservation" as const,
      failure: "producer_divergence_comparison_mismatch",
      disposition: "fail" as const,
    },
    {
      label: "producer observer contraction",
      family: "continuous_observer_optimizer" as const,
      role: "tensor_contraction_samples",
      diagnostic: "continuous_observer_optimizer" as const,
      failure: "producer_observer_contraction_comparison_mismatch",
      disposition: "blocked" as const,
    },
    {
      label: "producer observer optimum objective",
      family: "continuous_observer_optimizer" as const,
      role: "condition_optimum_objective_samples",
      diagnostic: "continuous_observer_optimizer" as const,
      failure: "producer_optimum_objective_comparison_mismatch",
      disposition: "blocked" as const,
    },
    {
      label: "producer observer trace objective",
      family: "continuous_observer_optimizer" as const,
      role: "optimizer_trace_objective_samples",
      diagnostic: "continuous_observer_optimizer" as const,
      failure: "optimizer_trace_result_comparison_mismatch:0",
      disposition: "blocked" as const,
    },
    {
      label: "producer tensor pullback",
      family: "worldline_qei" as const,
      role: "pulled_back_tensor_components",
      diagnostic: "worldline_qei" as const,
      failure: "producer_qei_tensor_pullback_comparison_mismatch",
      disposition: "blocked" as const,
    },
    {
      label: "producer metric pullback",
      family: "worldline_qei" as const,
      role: "pulled_back_metric_components",
      diagnostic: "worldline_qei" as const,
      failure: "producer_qei_metric_pullback_comparison_mismatch",
      disposition: "blocked" as const,
    },
    {
      label: "producer QEI contraction",
      family: "worldline_qei" as const,
      role: "contracted_tensor_samples",
      diagnostic: "worldline_qei" as const,
      failure: "producer_qei_contraction_comparison_mismatch",
      disposition: "blocked" as const,
    },
    {
      label: "producer QEI integrand",
      family: "worldline_qei" as const,
      role: "quadrature_integrand_samples",
      diagnostic: "worldline_qei" as const,
      failure: "producer_qei_integrand_comparison_mismatch",
      disposition: "blocked" as const,
    },
  ])("does not allow a forged $label comparison array to pass", (testCase) => {
    const fixture = buildFixture();
    mutateNumerical(fixture, testCase.family, testCase.role, (values) => {
      values[0] = 1;
    });

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    const diagnostic = result.families[testCase.diagnostic];
    expect(diagnostic.disposition).toBe(testCase.disposition);
    expect(diagnostic.failures).toContain(testCase.failure);
    expectAllClaimsClosed(result);
  });

  it("replays all four transition components instead of checking only T00", () => {
    const fixture = buildFixture();
    mutateNumerical(
      fixture,
      "covariant_conservation",
      "switching_transition_components",
      (values) => {
        values[1] = 1;
      },
    );

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.covariant_conservation.disposition).toBe("fail");
    expect(result.families.covariant_conservation.failures).toContain(
      "four_component_transition_balance_threshold_breach",
    );
  });

  it("blocks duplicated null-direction coverage as vacuous", () => {
    const fixture = buildFixture();
    mutateNumerical(
      fixture,
      "continuous_observer_optimizer",
      "null_direction_vectors",
      (values) => {
        for (let row = 0; row < DIRECTION_COUNT; row += 1) {
          values[row * 4] = 1;
          values[row * 4 + 1] = 1;
          values[row * 4 + 2] = 0;
          values[row * 4 + 3] = 0;
        }
      },
    );

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.continuous_observer_optimizer.disposition).toBe(
      "blocked",
    );
    expect(result.families.continuous_observer_optimizer.blockers).toContain(
      "null_direction_coverage_duplicated:0",
    );
  });

  it("blocks a QEI interpolation ledger whose weights do not normalize", () => {
    const fixture = buildFixture();
    const interpolation = fixture.records.get(
      roleKey("worldline_qei", "worldline_apparatus_interpolation_entries"),
    );
    if (interpolation == null) throw new Error("interpolation fixture missing");
    (interpolation.records[0] as Record<string, unknown>).weight = 0.5;
    refreshRecordHash(interpolation);

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.worldline_qei.disposition).toBe("blocked");
    expect(result.families.worldline_qei.blockers).toContain(
      "worldline_interpolation_weights_invalid:0",
    );
  });

  it("blocks an observer result binding with the wrong objective formula", () => {
    const fixture = buildFixture();
    const bindings = fixture.records.get(
      roleKey(
        "continuous_observer_optimizer",
        "energy_condition_optimizer_bindings",
      ),
    );
    if (bindings == null) throw new Error("observer binding fixture missing");
    (bindings.records[0] as Record<string, unknown>).objective_formula_id =
      "wrong-formula/v1";
    refreshRecordHash(bindings);

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.continuous_observer_optimizer.disposition).toBe(
      "blocked",
    );
    expect(result.families.continuous_observer_optimizer.blockers).toContain(
      "observer_optimizer_binding_invalid:0",
    );
  });

  it("blocks vacuous worldline coverage instead of treating an empty catalog as a QEI pass", () => {
    const fixture = buildFixture();
    const catalog = fixture.records.get(
      roleKey("worldline_qei", "worldline_catalog"),
    );
    if (catalog == null) throw new Error("worldline catalog fixture missing");
    (catalog.records as Array<Record<string, unknown>>).splice(0);
    refreshRecordHash(catalog);

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.families.worldline_qei.disposition).toBe("blocked");
    expect(result.families.worldline_qei.blockers).toContain(
      "worldline_catalog_coverage_vacuous_or_inconsistent",
    );
    expectAllClaimsClosed(result);
  });

  it("blocks an unverified filesystem result before reading any producer data", () => {
    const fixture = buildFixture();
    const unverified = {
      verified: false,
      violations: [{ code: "filesystem_missing_file", path: "raw/missing" }],
      runRootRealPath: null,
      manifestPath: null,
      manifestSha256: null,
      manifest: null,
      files: [],
    } as unknown as Nhm2PrimaryRawOutputFilesystemVerification;

    const result = replayNhm2PrimaryRawGrContent(unverified);
    expect(result.inputVerificationAccepted).toBe(false);
    expect(
      Object.values(result.families).every(
        (diagnostic) => diagnostic.disposition === "blocked",
      ),
    ).toBe(true);
    expectAllClaimsClosed(result);
    expect(fixture.verification.verified).toBe(true);
  });

  it("blocks in-memory mutation that no longer matches the filesystem-verified byte hash", () => {
    const fixture = buildFixture();
    const total = fixture.numerical.get(
      roleKey("full_apparatus_source_tensor", "total_tensor_components"),
    );
    if (total == null) throw new Error("total fixture missing");
    total.values[0] = 1;

    const result = replayNhm2PrimaryRawGrContent(fixture.verification);
    expect(result.inputVerificationAccepted).toBe(false);
    expect(result.families.full_apparatus_source_tensor.blockers[0]).toContain(
      "verified_typed_data_hash_mismatch",
    );
  });
});
