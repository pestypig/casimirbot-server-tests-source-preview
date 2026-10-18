import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { NHM2_SEMICLASSICAL_V2_PAIR_ARRAY_ROLES } from "../../../../shared/contracts/nhm2-semiclassical-v2-pair-agreement.v1";
import {
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY,
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CANONICAL_JSON,
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ID,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_FORBIDDEN_INPUT_IDS,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_FORMULAS,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_INPUT_CLOSURE_ALGORITHM,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_INPUT_ORDERING,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_MANIFEST_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_MANIFEST_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_REQUIRED_INPUT_IDS,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_SCIENTIFIC_INPUT_IDS,
  computeNhm2SemiclassicalV2RawReplayInputClosureSha256,
  type Nhm2SemiclassicalV2RawReplayArrayV1,
  type Nhm2SemiclassicalV2RawReplayInputEntryV1,
  type Nhm2SemiclassicalV2RawReplayManifestV1,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-raw-replay-manifest.v1";
import { NHM2_SEMICLASSICAL_TENSOR_COMPONENTS } from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v1";
import {
  NHM2_SEMICLASSICAL_CONSTRAINT_COMPONENT_ORDER,
  NHM2_SEMICLASSICAL_NOISE_KERNEL_COMPONENT_PAIR_ORDER,
} from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v2";
import type { Nhm2SemiclassicalV2ContentReplayResult } from "../nhm2-semiclassical-v2-content-replay";
import {
  compareNhm2SemiclassicalV2Pair,
  type Nhm2SemiclassicalV2CompletedRunSnapshotV1,
  type Nhm2SemiclassicalV2PairComparatorInputV1,
} from "../nhm2-semiclassical-v2-pair-comparator";
import {
  NHM2_SECURE_RUN_OUTPUT_READER_AUTHORITY_BLOCKERS,
  NHM2_SECURE_RUN_OUTPUT_READER_CLAIM_BOUNDARY,
  NHM2_SECURE_RUN_OUTPUT_READER_VERSION,
} from "../nhm2-secure-run-output-reader";
import {
  NHM2_SEMICLASSICAL_V2_RUN_REPLAYER_AUTHORITY_BLOCKERS,
  NHM2_SEMICLASSICAL_V2_RUN_REPLAYER_CONTRACT_VERSION,
  type Nhm2SemiclassicalV2RunReplayerFileReceipt,
} from "../nhm2-semiclassical-v2-run-replayer";

const digest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const digestText = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const receiptClosure = (
  files: readonly Nhm2SemiclassicalV2RunReplayerFileReceipt[],
): string =>
  digestText(
    `nhm2-semiclassical-v2-current-readback/v2\n${canonicalJson(
      [...files]
        .sort((left, right) =>
          Buffer.compare(
            Buffer.from(left.logicalPath),
            Buffer.from(right.logicalPath),
          ),
        )
        .map((file) => ({
          scope: file.scope,
          semanticId: file.semanticId,
          logicalPath: file.logicalPath,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
          mediaType: file.mediaType,
          filesystemIdentity: file.filesystemIdentity,
        })),
    )}`,
  );

const freezeContainers = <T>(value: T): T => {
  if (
    value == null ||
    typeof value !== "object" ||
    Buffer.isBuffer(value) ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    freezeContainers(nested);
  }
  return Object.freeze(value);
};

const residual = () => ({
  residualLInf: 0,
  absoluteUncertainty95: 0,
  residualUpper95: 0,
  producerResidualMismatchLInf: 0,
  tolerance: 0.1,
});

const replay = (
  manifest: Nhm2SemiclassicalV2RawReplayManifestV1,
): Nhm2SemiclassicalV2ContentReplayResult => {
  const entries = new Map(
    manifest.inputClosure.entries.map(
      (entry) => [entry.inputId, entry] as const,
    ),
  );
  return freezeContainers({
    contractVersion: "nhm2_semiclassical_v2_content_replay/v2",
    calculationOnly: true,
    serverOwned: true,
    status: "blocked",
    inputBindings: {
      policyId: manifest.candidate.tolerancePolicyId,
      candidateId: manifest.candidate.candidateId,
      geometrySha256: entries.get("geometry")!.sha256,
      quantumStateSha256: entries.get("quantum_state")!.sha256,
      chartId: manifest.candidate.chartId,
      chartSha256: entries.get("chart")!.sha256,
      normalizationId: manifest.candidate.normalizationId,
      normalizationSha256: entries.get("normalization")!.sha256,
      sourceTensorProvenance: "state_derived_not_declared_lever",
      declaredLeverTensorUsed: false,
      manifestDeclaresFrozenBeforeExecution: true,
      preexecutionFreezeVerified: false,
    },
    metrics: {
      inputContent: {
        float64ArrayCount: 34,
        float64ValueCount: 828_736,
        allValuesFinite: true,
        allAbsoluteUncertaintiesNonnegative: true,
        buffersUniqueAndNonShared: true,
        arraysAreFullBufferViews: true,
      },
      noise: {
        sampleCount: 64,
        covarianceDimension: 640,
        exchangeResidualUpper95SI: 0,
        exchangeToleranceSI: 1e-12,
        exchangeSymmetryBasis: "raw_bilocal_component_pair_storage",
        symmetricTensorBasis:
          "orthonormal_symmetric_tensor_sqrt_component_multiplicity",
        covarianceSmearingMethod:
          "diag_sqrt_point_weights_tensor_sqrt_component_multiplicity_bilateral",
        psdCertificateMethod:
          "shifted_semidefinite_cholesky_with_residual_spectral_bound",
        psdInput: "central_symmetric_weighted_covariance",
        psdCertificationDisposition: "tolerance_certified",
        psdDiagonalShiftSI: 5e-13,
        psdResidualAllowanceSI: 5e-13,
        minimumShiftedCholeskyPivotSI: 1,
        psdToleranceSI: 1e-12,
        factorizationResidualInfinityNormUpperSI: 0,
        factorizationRoundoffModel: "ieee754_gamma_n_absolute_bound",
        maximumZeroPivotCouplingResidualSI: 0,
        negativeWitnessRayleighQuotientSI: null,
        maximumGershgorinRadiusUpper95SI: 1,
        maximumEigenvalueUpper95SI: 1,
        covarianceTolerancePositiveSemidefiniteCertified: true,
      },
      mean: {
        smearingWeightSum: 1,
        smearedTensorComponentsSI: [1, 0, 0, 0, 1, 0, 0, 1, 0, 1],
        symmetricTensorFrobeniusSI: 2,
        normalizationFloorSI: 1e-12,
        normalizationScaleSI: 2,
        fluctuationAmplitudeUpper95SI: 0,
        fluctuationToMeanRatioUpper95: 0,
        fluctuationRatioTolerance: 1,
      },
      metricDemand: {
        minimumPointwiseSymmetricTensorFrobeniusSI: 1,
        argminPointIndex: 0,
        maximumPointwiseSymmetricTensorFrobeniusSI: 1,
        argmaxPointIndex: 0,
        minimumPointwiseSymmetricTensorFrobeniusLowerBoundSI: 1 - 4e-12,
        argminLowerBoundPointIndex: 0,
        maximumPointwiseDeterministicErrorFrobeniusSI: 4e-12,
        argmaxDeterministicErrorPointIndex: 0,
        minimumRequiredFrobeniusSI: 1e-12,
        qualifyingSampleCount: 64,
        qualifyingSampleFraction: 1,
        requiredSampleFraction: 1,
        strictlyNondegenerate: true,
      },
      meanMetricDemandClosure: {
        sampleCount: 64,
        relativeUpper95Tolerance: 0.1,
        requiredPassingSampleCount: 64,
        passingSampleCount: 64,
        maximumPointwiseRelativeUpper95: 0,
        argmaxPointIndex: 0,
        residualFrobeniusUpper95AtWorstPointSI: 0,
        metricDemandDeterministicErrorFrobeniusAtWorstPointSI: 4e-12,
        metricDemandFrobeniusLowerBoundAtWorstPointSI: 1 - 4e-12,
        denominatorAtWorstPointSI: 1,
        argmaxComponentIndex: 0,
        argmaxComponentContributionRelativeUpper95: 0,
        allSamplesWithinTolerance: true,
      },
      brackets: {
        H_H: residual(),
        H_Hi: residual(),
        Hi_Hj: residual(),
      },
      antisymmetry: residual(),
      jacobi: residual(),
      regulator: {
        levelCount: 3,
        spacing: [2, 2],
        residualUpper95ByLevel: [0.04, 0.02, 0.01],
        observedOrders: [1, 1],
        minimumObservedOrder: 1,
        requiredMinimumOrder: 1,
        monotone: true,
        finalResidualUpper95: 0.01,
        tolerance: 0.1,
      },
    },
    issues: [
      {
        code: "metric_demand_derivation_executor_provenance_unverified",
        disposition: "blocked",
      },
      {
        code: "interval_trace_not_server_replayed",
        disposition: "blocked",
      },
    ],
    blockers: [
      "metric_demand_derivation_executor_provenance_unverified",
      "interval_trace_not_server_replayed",
    ],
    claimLocks: {
      independentImplementationAgreementEstablished: false,
      theoryGraphSemiclassicalLampsPromotable: false,
      theoryClosureEstablished: false,
      physicalViabilityEstablished: false,
      propulsionEstablished: false,
      transportEstablished: false,
      routeEtaEstablished: false,
      certifiedSpeedEstablished: false,
      empiricalValidationEstablished: false,
    },
  } as Nhm2SemiclassicalV2ContentReplayResult);
};

type SnapshotOptions = {
  changedRole?: string;
  changedValue?: number;
  descriptorUnitRole?: string;
  descriptorDrift?: Readonly<{
    role: string;
    field:
      | "shape"
      | "componentOrder"
      | "unit"
      | "dtype"
      | "binaryEncoding"
      | "endianness"
      | "storageOrder";
  }>;
  omitRole?: string;
  extraRegulatorLevel?: boolean;
  mutateReplay?: (value: Record<string, any>) => void;
  mutateManifest?: (value: Record<string, any>) => void;
  mutateRunReplay?: (value: Record<string, any>) => void;
};

const buildLegacySnapshot = (
  implementationRole: "primary" | "independent",
  options: SnapshotOptions = {},
): any => {
  const outputDirectory = `output-${implementationRole}`;
  const descriptors = new Map<string, Nhm2SemiclassicalV2RawReplayArrayV1>();
  const files = [];
  const roles = [
    ...NHM2_SEMICLASSICAL_V2_PAIR_ARRAY_ROLES,
    ...(options.extraRegulatorLevel
      ? [
          "regulator_level.3.residual",
          "regulator_level.3.absolute_uncertainty95",
        ]
      : []),
  ];
  for (const [ordinal, role] of roles.entries()) {
    if (role === options.omitRole) continue;
    const bytes = Buffer.alloc(16);
    bytes.writeDoubleLE(
      role === options.changedRole
        ? (options.changedValue ?? ordinal + 2)
        : ordinal + 1,
      0,
    );
    bytes.writeDoubleLE(-(ordinal + 1), 8);
    const relativePath = `${role.replace(/[^a-zA-Z0-9]+/g, "_")}.f64`;
    const descriptor: Nhm2SemiclassicalV2RawReplayArrayV1 = {
      role,
      path: `${outputDirectory}/${relativePath}`,
      sha256: digest(bytes),
      sizeBytes: bytes.length,
      freshness: "new",
      observedAt: "2026-08-10T00:00:02.000Z",
      dtype: "float64",
      binaryEncoding: "raw_ieee754",
      endianness: "little",
      shape: [2],
      storageOrder: "row-major",
      componentOrder: ["value"],
      unit:
        role === options.descriptorUnitRole ? "drifted-unit" : "dimensionless",
    };
    if (options.descriptorDrift?.role === role) {
      switch (options.descriptorDrift.field) {
        case "shape":
          descriptor.shape = [1, 2];
          break;
        case "componentOrder":
          descriptor.componentOrder = ["drifted"];
          break;
        case "unit":
          descriptor.unit = "drifted-unit";
          break;
        case "dtype":
          (descriptor as any).dtype = "float32";
          break;
        case "binaryEncoding":
          (descriptor as any).binaryEncoding = "text";
          break;
        case "endianness":
          (descriptor as any).endianness = "big";
          break;
        case "storageOrder":
          (descriptor as any).storageOrder = "column-major";
          break;
      }
    }
    descriptors.set(role, descriptor);
    files.push({
      relativePath,
      absolutePath: `C:/runs/${outputDirectory}/${relativePath}`,
      sha256: descriptor.sha256,
      sizeBytes: BigInt(bytes.length),
      bytes,
      decoded: {
        kind: "float64_le" as const,
        shape: [2],
        finiteValuesVerified: true as const,
      },
      filesystemIdentity: {
        dev: "1",
        ino: String(ordinal + 1),
        sizeBytes: String(bytes.length),
        mtimeNs: "1",
        ctimeNs: "1",
      },
    });
  }
  const d = (role: string) => descriptors.get(role)!;
  const bracket = (id: "H_H" | "H_Hi" | "Hi_Hj") => ({
    bracketId: id,
    computed: d(`constraint_bracket.${id}.computed`),
    target: d(`constraint_bracket.${id}.target`),
    residual: d(`constraint_bracket.${id}.residual`),
    absoluteUncertainty95: d(`constraint_bracket.${id}.absolute_uncertainty95`),
  });
  const regulatorLevel = (ordinal: number) => ({
    ordinal,
    levelId: `level_${ordinal}`,
    scale: 1 / 2 ** ordinal,
    residual: d(`regulator_level.${ordinal}.residual`),
    absoluteUncertainty95: d(
      `regulator_level.${ordinal}.absolute_uncertainty95`,
    ),
  });
  const manifest = {
    implementation: {
      comparisonPairId: "pair-a",
      role: implementationRole,
    },
    execution: { outputDirectory },
    arrays: {
      noiseKernel: d("noise_kernel"),
      noiseKernelAbsoluteUncertainty95: d(
        "noise_kernel_absolute_uncertainty95",
      ),
      meanRset: d("mean_rset"),
      meanRsetAbsoluteUncertainty95: d("mean_rset_absolute_uncertainty95"),
      smearingWeights: d("smearing_weights"),
      brackets: [bracket("H_H"), bracket("H_Hi"), bracket("Hi_Hj")],
      antisymmetry: {
        forward: d("antisymmetry.forward"),
        reverse: d("antisymmetry.reverse"),
        residual: d("antisymmetry.residual"),
        absoluteUncertainty95: d("antisymmetry.absolute_uncertainty95"),
      },
      jacobi: {
        term1: d("jacobi.term_1"),
        term2: d("jacobi.term_2"),
        term3: d("jacobi.term_3"),
        residual: d("jacobi.residual"),
        absoluteUncertainty95: d("jacobi.absolute_uncertainty95"),
      },
      regulatorLevels: Array.from(
        { length: options.extraRegulatorLevel ? 4 : 3 },
        (_, index) => regulatorLevel(index),
      ),
    },
  } as any;
  if (options.omitRole === "noise_kernel")
    manifest.arrays.noiseKernel = undefined;

  let replayValue = replay(manifest) as unknown as Record<string, any>;
  if (options.mutateReplay) {
    const mutableReplay = {
      ...replayValue,
      inputBindings: { ...replayValue.inputBindings },
      metrics: {
        ...replayValue.metrics,
        inputContent: { ...replayValue.metrics.inputContent },
        noise: { ...replayValue.metrics.noise },
        mean: {
          ...replayValue.metrics.mean,
          smearedTensorComponentsSI: [
            ...replayValue.metrics.mean.smearedTensorComponentsSI,
          ],
        },
        metricDemand: { ...replayValue.metrics.metricDemand },
        meanMetricDemandClosure: {
          ...replayValue.metrics.meanMetricDemandClosure,
        },
        brackets: {
          H_H: { ...replayValue.metrics.brackets.H_H },
          H_Hi: { ...replayValue.metrics.brackets.H_Hi },
          Hi_Hj: { ...replayValue.metrics.brackets.Hi_Hj },
        },
        antisymmetry: { ...replayValue.metrics.antisymmetry },
        jacobi: { ...replayValue.metrics.jacobi },
        regulator: {
          ...replayValue.metrics.regulator,
          spacing: [...replayValue.metrics.regulator.spacing],
          residualUpper95ByLevel: [
            ...replayValue.metrics.regulator.residualUpper95ByLevel,
          ],
          observedOrders: [...replayValue.metrics.regulator.observedOrders],
        },
      },
      issues: [...replayValue.issues],
      blockers: [...replayValue.blockers],
      claimLocks: { ...replayValue.claimLocks },
    };
    options.mutateReplay(mutableReplay);
    replayValue = mutableReplay;
  }

  return freezeContainers({
    completionState: "completed" as const,
    manifest,
    outputSnapshot: {
      contractVersion: NHM2_SECURE_RUN_OUTPUT_READER_VERSION,
      readState: "bounded_bytes_read_authority_neutral" as const,
      runDirectoryRealPath: `C:/runs/${outputDirectory}`,
      aggregateSizeBytes: files.reduce(
        (total, file) => total + file.sizeBytes,
        0n,
      ),
      files,
      blockers: [],
      claimBoundary: {},
    } as any,
    replay: replayValue as unknown as Nhm2SemiclassicalV2ContentReplayResult,
  });
};

const validRoleSpec = (role: string) => {
  if (role.startsWith("noise_kernel")) {
    return {
      shape: [64, 64, 100],
      componentOrder: [...NHM2_SEMICLASSICAL_NOISE_KERNEL_COMPONENT_PAIR_ORDER],
      unit: "(J/m^3)^2",
    };
  }
  if (role === "mean_rset" || role === "mean_rset_absolute_uncertainty95") {
    return {
      shape: [64, 10],
      componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
      unit: "J/m^3",
    };
  }
  if (role === "smearing_weights") {
    return { shape: [64], componentOrder: ["weight"], unit: "dimensionless" };
  }
  return {
    shape: [64, 4],
    componentOrder: [...NHM2_SEMICLASSICAL_CONSTRAINT_COMPONENT_ORDER],
    unit: "dimensionless",
  };
};

const buildSnapshot = (
  implementationRole: "primary" | "independent",
  options: SnapshotOptions = {},
): Nhm2SemiclassicalV2CompletedRunSnapshotV1 => {
  const side = implementationRole === "primary" ? 1 : 2;
  const scientificRootDirectory = "scientific/frozen";
  const implementationRootDirectory = `implementations/${implementationRole}`;
  const outputDirectory = `outputs/${implementationRole}`;
  const frozenAt = "2026-08-10T00:00:00.000Z";
  const sealedAt = "2026-08-10T00:00:01.000Z";
  const startedAt = "2026-08-10T00:00:02.000Z";
  const completedAt = "2026-08-10T00:00:03.000Z";
  const generatedAt = "2026-08-10T00:00:04.000Z";
  const manifestObservedAt = "2026-08-10T00:00:05.000Z";
  const candidateId = "candidate-a";
  const metricBytes = Buffer.alloc(64 * 10 * 8);
  const metricErrorBytes = Buffer.alloc(64 * 10 * 8);
  for (let point = 0; point < 64; point += 1) {
    metricBytes.writeDoubleLE(1, point * 10 * 8);
  }
  for (let index = 0; index < 64 * 10; index += 1) {
    metricErrorBytes.writeDoubleLE(1e-12, index * 8);
  }
  const entries: Nhm2SemiclassicalV2RawReplayInputEntryV1[] =
    NHM2_SEMICLASSICAL_V2_RAW_REPLAY_REQUIRED_INPUT_IDS.map((inputId) => {
      const scientific = (
        NHM2_SEMICLASSICAL_V2_RAW_REPLAY_SCIENTIFIC_INPUT_IDS as readonly string[]
      ).includes(inputId);
      const root = scientific
        ? scientificRootDirectory
        : implementationRootDirectory;
      const bytes =
        inputId === "tolerance_policy"
          ? Buffer.from(
              NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CANONICAL_JSON,
            )
          : inputId === "metric_demand_tensor" ||
              inputId === "metric_demand_absolute_error_bound"
            ? inputId === "metric_demand_tensor"
              ? metricBytes
              : metricErrorBytes
            : Buffer.from(
                scientific
                  ? canonicalJson({ frozen: true, inputId })
                  : `toolchain:${implementationRole}:${inputId}`,
              );
      const base = {
        inputId,
        path: `${root}/${inputId}.${inputId === "metric_demand_tensor" || inputId === "metric_demand_absolute_error_bound" ? "f64le" : "bin"}`,
        sha256: digest(bytes),
        sizeBytes: bytes.length,
        mediaType:
          inputId === "tolerance_policy"
            ? "application/json"
            : inputId === "metric_demand_tensor" ||
                inputId === "metric_demand_absolute_error_bound" ||
                !scientific
              ? "application/octet-stream"
              : "application/json",
        freshness: "preexisting_unchanged" as const,
        observedAt: sealedAt,
      };
      return inputId === "metric_demand_tensor" ||
        inputId === "metric_demand_absolute_error_bound"
        ? ({
            ...base,
            inputId,
            dtype: "float64",
            binaryEncoding: "raw_ieee754",
            endianness: "little",
            shape: [64, 10],
            storageOrder: "row-major",
            componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
            unit: "J/m^3",
          } as Nhm2SemiclassicalV2RawReplayInputEntryV1)
        : (base as Nhm2SemiclassicalV2RawReplayInputEntryV1);
    });
  const entriesById = new Map(entries.map((entry) => [entry.inputId, entry]));
  const roles = [
    ...NHM2_SEMICLASSICAL_V2_PAIR_ARRAY_ROLES,
    ...(options.extraRegulatorLevel
      ? [
          "regulator_level.3.residual",
          "regulator_level.3.absolute_uncertainty95",
        ]
      : []),
  ];
  const descriptors = new Map<string, Nhm2SemiclassicalV2RawReplayArrayV1>();
  const outputFiles: any[] = [];
  for (const [ordinal, role] of roles.entries()) {
    if (role === options.omitRole) continue;
    const spec = validRoleSpec(role);
    const valueCount = spec.shape.reduce((product, axis) => product * axis, 1);
    const bytes = Buffer.alloc(valueCount * 8);
    bytes.writeDoubleLE(
      role === options.changedRole
        ? (options.changedValue ?? 999)
        : ordinal + 1,
      0,
    );
    const relativePath = `${ordinal.toString().padStart(2, "0")}-${role.replace(/[^a-zA-Z0-9]+/g, "_")}.f64`;
    const descriptor: Nhm2SemiclassicalV2RawReplayArrayV1 = {
      role,
      path: `${outputDirectory}/${relativePath}`,
      sha256: digest(bytes),
      sizeBytes: bytes.length,
      freshness: "new",
      observedAt: generatedAt,
      dtype: "float64",
      binaryEncoding: "raw_ieee754",
      endianness: "little",
      shape: [...spec.shape],
      storageOrder: "row-major",
      componentOrder: [...spec.componentOrder],
      unit: role === options.descriptorUnitRole ? "drifted-unit" : spec.unit,
    };
    if (options.descriptorDrift?.role === role) {
      const field = options.descriptorDrift.field;
      if (field === "shape") descriptor.shape = [1, 2];
      else if (field === "componentOrder")
        descriptor.componentOrder = ["drifted"];
      else if (field === "unit") descriptor.unit = "drifted-unit";
      else if (field === "dtype") (descriptor as any).dtype = "float32";
      else if (field === "binaryEncoding")
        (descriptor as any).binaryEncoding = "text";
      else if (field === "endianness") (descriptor as any).endianness = "big";
      else (descriptor as any).storageOrder = "column-major";
    }
    descriptors.set(role, descriptor);
    outputFiles.push({
      relativePath,
      absolutePath: `C:/runs/${outputDirectory}/${relativePath}`,
      sha256: descriptor.sha256,
      sizeBytes: BigInt(bytes.length),
      bytes,
      decoded: {
        kind: "float64_le",
        shape: [...descriptor.shape],
        finiteValuesVerified: true,
      },
      filesystemIdentity: {
        dev: String(side),
        ino: String(ordinal + 1),
        sizeBytes: String(bytes.length),
        mtimeNs: "3",
        ctimeNs: "3",
      },
    });
  }
  const d = (role: string) => descriptors.get(role)!;
  const bracket = (id: "H_H" | "H_Hi" | "Hi_Hj") => ({
    bracketId: id,
    computed: d(`constraint_bracket.${id}.computed`),
    target: d(`constraint_bracket.${id}.target`),
    residual: d(`constraint_bracket.${id}.residual`),
    absoluteUncertainty95: d(`constraint_bracket.${id}.absolute_uncertainty95`),
  });
  const level = (ordinal: number) => ({
    ordinal,
    levelId: `level-${ordinal}`,
    scale: 1 / 2 ** ordinal,
    residual: d(`regulator_level.${ordinal}.residual`),
    absoluteUncertainty95: d(
      `regulator_level.${ordinal}.absolute_uncertainty95`,
    ),
  });
  const roots = { scientificRootDirectory, implementationRootDirectory };
  const manifest: any = {
    artifactId: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_MANIFEST_ARTIFACT_ID,
    contractVersion: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_MANIFEST_CONTRACT_VERSION,
    manifestFrozenAt: frozenAt,
    generatedAt,
    candidate: {
      candidateId,
      candidateManifestId: "candidate-manifest-a",
      selectedProfileId: "profile-a",
      candidateKind: "frozen_nondegenerate_nhm2_semiclassical_candidate",
      geometryId: "geometry-a",
      quantumStateId: "state-a",
      chartId: "chart-a",
      normalizationId: "normalization-a",
      tolerancePolicyId: NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ID,
      smearingFunctionId: "smearing-a",
      samplingBasisId: "basis-a",
      nondegeneracyCriterionId: "nondegenerate-a",
      metricDemandInputId: "metric_demand_tensor",
      metricDemandErrorBoundInputId: "metric_demand_absolute_error_bound",
      metricDemandDerivationWitnessInputId: "metric_demand_derivation_receipt",
      minimumMetricDemandFrobeniusSI:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.minimumMetricDemandFrobeniusSI,
      requiredMetricDemandSampleFraction:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.requiredMetricDemandSampleFraction,
      sampleCount: 64,
      frozenAt,
    },
    sourceProvenance: {
      sourceMode: "state_derived_not_declared_lever",
      meanRsetOrigin: "renormalized_quantum_state_expectation_value",
      noiseKernelOrigin:
        "connected_symmetrized_quantum_state_two_point_function",
      declaredLeverTensorUsed: false,
      inputClosureExcludesDeclaredLeverTensor: true,
    },
    numericalPolicy: {
      frozenAt,
      formulas: { ...NHM2_SEMICLASSICAL_V2_RAW_REPLAY_FORMULAS },
      units: {
        noiseKernel: "(J/m^3)^2",
        meanRset: "J/m^3",
        meanRsetAbsoluteUncertainty95: "J/m^3",
        metricDemandAbsoluteErrorBound: "J/m^3",
        smearingWeights: "dimensionless",
        normalizedConstraints: "dimensionless",
        regulatorScale: "dimensionless",
      },
      tolerances: {
        ...NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.tolerances,
      },
    },
    implementation: {
      comparisonPairId: "pair-a",
      role: implementationRole,
      implementationId: `${implementationRole}-implementation`,
      implementationVersion: "1.0.0",
      sourceIdentity: {
        identityId: `${implementationRole}-source`,
        inputId: "implementation_source",
        sha256: entriesById.get("implementation_source")!.sha256,
      },
      dependencyIdentity: {
        identityId: `${implementationRole}-dependencies`,
        inputId: "dependency_lock",
        sha256: entriesById.get("dependency_lock")!.sha256,
      },
      executableIdentity: {
        identityId: `${implementationRole}-executable`,
        inputId: "executable",
        sha256: entriesById.get("executable")!.sha256,
      },
      inputExposure: {
        scientificRoot: "read_only_exact_inventory",
        implementationRoot: "executor_owned_toolchain_not_data_input",
        counterpartOutputs: "not_mounted",
        ambientRepository: "not_mounted",
      },
    },
    execution: {
      commitSha:
        implementationRole === "primary" ? "a".repeat(40) : "b".repeat(40),
      command: "node",
      argv: [`solver-${implementationRole}.mjs`],
      workingDirectory: ".",
      outputDirectory,
      startedAt,
      completedAt,
      durationMs: 1000,
      exitCode: 0,
      terminationSignal: null,
    },
    inputClosure: {
      manifestDeclaresFrozenBeforeExecution: true,
      scientificPresealBinding: {
        artifactId: "nhm2.semiclassical_v2_scientific_preseal",
        contractVersion: "nhm2_semiclassical_v2_scientific_preseal/v2",
        sealKey: digestText(
          `nhm2-semiclassical-v2-deterministic-seal-key/v2\n${candidateId}`,
        ),
        candidateManifestSha256: entriesById.get("candidate_manifest")!.sha256,
        scientificContentSha256: digestText("scientific-content-a"),
        sealedInventorySha256: digestText("sealed-inventory-a"),
        sealedAt,
      },
      ...roots,
      algorithm: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_INPUT_CLOSURE_ALGORITHM,
      ordering: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_INPUT_ORDERING,
      entries,
      excludedInputIds: [
        ...NHM2_SEMICLASSICAL_V2_RAW_REPLAY_FORBIDDEN_INPUT_IDS,
      ],
      scientificClosureSha256: "",
      completeClosureSha256: "",
    },
    arrays: {
      noiseKernel: d("noise_kernel"),
      noiseKernelAbsoluteUncertainty95: d(
        "noise_kernel_absolute_uncertainty95",
      ),
      meanRset: d("mean_rset"),
      meanRsetAbsoluteUncertainty95: d("mean_rset_absolute_uncertainty95"),
      smearingWeights: d("smearing_weights"),
      brackets: [bracket("H_H"), bracket("H_Hi"), bracket("Hi_Hj")],
      antisymmetry: {
        forward: d("antisymmetry.forward"),
        reverse: d("antisymmetry.reverse"),
        residual: d("antisymmetry.residual"),
        absoluteUncertainty95: d("antisymmetry.absolute_uncertainty95"),
      },
      jacobi: {
        term1: d("jacobi.term_1"),
        term2: d("jacobi.term_2"),
        term3: d("jacobi.term_3"),
        residual: d("jacobi.residual"),
        absoluteUncertainty95: d("jacobi.absolute_uncertainty95"),
      },
      regulatorLevels: Array.from(
        { length: options.extraRegulatorLevel ? 4 : 3 },
        (_, index) => level(index),
      ),
    },
    claimLocks: {
      diagnosticOnly: true,
      replayAuthority: false,
      theoryGraphPromotion: false,
      theoryClosure: false,
      physicalViability: false,
      propulsion: false,
      transport: false,
      routeEta: false,
      certifiedSpeed: false,
      empiricalValidation: false,
    },
  };
  manifest.inputClosure.scientificClosureSha256 =
    computeNhm2SemiclassicalV2RawReplayInputClosureSha256(
      entries,
      "scientific",
      roots,
    );
  manifest.inputClosure.completeClosureSha256 =
    computeNhm2SemiclassicalV2RawReplayInputClosureSha256(
      entries,
      "complete",
      roots,
    );
  if (options.omitRole === "noise_kernel") manifest.arrays.noiseKernel = null;
  options.mutateManifest?.(manifest);
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const manifestRelativePath = "raw-replay-manifest.json";
  const manifestSha256 = digest(manifestBytes);
  const manifestIdentity = {
    dev: String(side),
    ino: "999",
    sizeBytes: String(manifestBytes.length),
    mtimeNs: "4",
    ctimeNs: "4",
  };
  outputFiles.push({
    relativePath: manifestRelativePath,
    absolutePath: `C:/runs/${outputDirectory}/${manifestRelativePath}`,
    sha256: manifestSha256,
    sizeBytes: BigInt(manifestBytes.length),
    bytes: manifestBytes,
    decoded: { kind: "bytes" },
    filesystemIdentity: manifestIdentity,
  });

  let replayValue = replay(manifest) as unknown as Record<string, any>;
  if (options.mutateReplay) {
    replayValue = structuredClone(replayValue);
    options.mutateReplay(replayValue);
  }
  const receipts: Nhm2SemiclassicalV2RunReplayerFileReceipt[] = entries.map(
    (entry, index) => {
      const scientific = (
        NHM2_SEMICLASSICAL_V2_RAW_REPLAY_SCIENTIFIC_INPUT_IDS as readonly string[]
      ).includes(entry.inputId);
      const root = scientific
        ? scientificRootDirectory
        : implementationRootDirectory;
      return {
        scope: scientific ? "scientific_input" : "implementation_input",
        semanticId: entry.inputId,
        logicalPath: entry.path,
        relativePath: entry.path.slice(root.length + 1),
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        mediaType: entry.mediaType,
        encoding:
          entry.inputId === "metric_demand_tensor" ||
          entry.inputId === "metric_demand_absolute_error_bound"
            ? "raw_ieee754_float64_little_endian"
            : "bytes",
        freshness:
          "snapshot_bytes_match_manifest_metadata_compatible_not_presealed",
        filesystemIdentity: {
          dev: String(side),
          ino: String(1000 + index),
          sizeBytes: String(entry.sizeBytes),
          mtimeNs: "1",
          ctimeNs: "1",
        },
      };
    },
  );
  for (const descriptor of descriptors.values()) {
    const relativePath = descriptor.path.slice(outputDirectory.length + 1);
    const file = outputFiles.find(
      (entry) => entry.relativePath === relativePath,
    )!;
    receipts.push({
      scope: "run_output",
      semanticId: descriptor.role,
      logicalPath: descriptor.path,
      relativePath,
      sha256: descriptor.sha256,
      sizeBytes: descriptor.sizeBytes,
      mediaType: "application/vnd.nhm2.raw-float64-le",
      encoding: "raw_ieee754_float64_little_endian",
      freshness: "created_or_modified_within_trusted_execution_interval",
      filesystemIdentity: file.filesystemIdentity,
    });
  }
  receipts.push({
    scope: "manifest",
    semanticId: "raw_replay_manifest",
    logicalPath: `${outputDirectory}/${manifestRelativePath}`,
    relativePath: manifestRelativePath,
    sha256: manifestSha256,
    sizeBytes: manifestBytes.length,
    mediaType: "application/json",
    encoding: "bytes",
    freshness: "created_or_modified_post_execution_before_observation",
    filesystemIdentity: manifestIdentity,
  });
  const runReplay: any = {
    contractVersion: NHM2_SEMICLASSICAL_V2_RUN_REPLAYER_CONTRACT_VERSION,
    serverOwned: true,
    diagnosticOnly: true,
    verificationState: "bounded_filesystem_snapshots_replayed",
    calculationDisposition: "blocked",
    candidateDisposition: "blocked",
    manifest: {
      relativePath: manifestRelativePath,
      sha256: manifestSha256,
      sizeBytes: manifestBytes.length,
      mediaType: "application/json",
      canonicalJsonVerified: true,
      structuralContractVerified: true,
      filesystemReadbackVerified: true,
    },
    provenance: {
      commitSha: manifest.execution.commitSha,
      command: manifest.execution.command,
      argv: [...manifest.execution.argv],
      workingDirectory: ".",
      startedAt,
      completedAt,
      durationMs: 1000,
      manifestObservedAt,
      scientificPresealBinding: {
        ...manifest.inputClosure.scientificPresealBinding,
      },
      scientificPresealBindingStatus:
        "producer_echo_matches_trusted_binding_not_persistence_receipt",
      scientificClosureSha256: manifest.inputClosure.scientificClosureSha256,
      completeClosureSha256: manifest.inputClosure.completeClosureSha256,
      files: receipts,
      readbackClosureSha256: receiptClosure(receipts),
    },
    replay: replayValue,
    authorityState: "blocked_pending_preseal_and_independent_reproduction",
    authorityBlockers: [
      ...NHM2_SEMICLASSICAL_V2_RUN_REPLAYER_AUTHORITY_BLOCKERS,
    ],
    claimLocks: {
      boundedFilesystemSnapshotReadbackEstablished: true,
      currentGlobalFilesystemStateEstablished: false,
      serverAuthorizedRootsVerified: false,
      sameUserMutationExclusionVerified: false,
      contentReplayCalculationCompleted: true,
      preexecutionScientificInputSealVerified: false,
      inputExposureNotMountedVerified: false,
      runOutputCreationFromAbsentPrestateVerified: false,
      manifestCreationFromAbsentPrestateVerified: false,
      independentImplementationAgreementEstablished: false,
      theoryGraphNoiseKernelLampPromotable: false,
      theoryGraphConstraintAlgebraLampPromotable: false,
      experimentReadyTheoryClosureEstablished: false,
      physicalViabilityEstablished: false,
      propulsionEstablished: false,
      transportEstablished: false,
      routeEtaEstablished: false,
      certifiedSpeedEstablished: false,
      empiricalValidationEstablished: false,
    },
    violations: [],
  };
  options.mutateRunReplay?.(runReplay);
  return freezeContainers({
    completionState: "completed" as const,
    manifest,
    manifestBinding: {
      bytes: manifestBytes,
      sha256: manifestSha256,
      sizeBytes: manifestBytes.length,
      mediaType: "application/json" as const,
      relativePath: manifestRelativePath,
      observedAt: manifestObservedAt,
    },
    outputSnapshot: {
      contractVersion: NHM2_SECURE_RUN_OUTPUT_READER_VERSION,
      readState: "bounded_bytes_read_authority_neutral" as const,
      runDirectoryRealPath: `C:/runs/${outputDirectory}`,
      aggregateSizeBytes: outputFiles.reduce(
        (sum, file) => sum + file.sizeBytes,
        0n,
      ),
      files: outputFiles,
      blockers: [...NHM2_SECURE_RUN_OUTPUT_READER_AUTHORITY_BLOCKERS],
      claimBoundary: { ...NHM2_SECURE_RUN_OUTPUT_READER_CLAIM_BOUNDARY },
    },
    runReplay,
  });
};

const pair = (
  independentOptions: SnapshotOptions = {},
  primaryOptions: SnapshotOptions = {},
): Nhm2SemiclassicalV2PairComparatorInputV1 =>
  freezeContainers({
    primary: buildSnapshot("primary", primaryOptions),
    independent: buildSnapshot("independent", independentOptions),
  });

const replaceSnapshot = (
  snapshot: Nhm2SemiclassicalV2CompletedRunSnapshotV1,
  replacement: Partial<Nhm2SemiclassicalV2CompletedRunSnapshotV1>,
): Nhm2SemiclassicalV2CompletedRunSnapshotV1 =>
  freezeContainers({ ...snapshot, ...replacement });

const compareSnapshots = (
  primary: Nhm2SemiclassicalV2CompletedRunSnapshotV1,
  independent: Nhm2SemiclassicalV2CompletedRunSnapshotV1,
) => compareNhm2SemiclassicalV2Pair(freezeContainers({ primary, independent }));

const frozenMeanDemandFailure = (): SnapshotOptions => ({
  mutateReplay: (value) => {
    value.status = "blocked";
    value.metrics.meanMetricDemandClosure.passingSampleCount = 0;
    value.metrics.meanMetricDemandClosure.maximumPointwiseRelativeUpper95 = 1;
    value.metrics.meanMetricDemandClosure.residualFrobeniusUpper95AtWorstPointSI = 1;
    value.metrics.meanMetricDemandClosure.argmaxComponentContributionRelativeUpper95 = 1;
    value.metrics.meanMetricDemandClosure.allSamplesWithinTolerance = false;
    value.issues = [
      {
        code: "mean_metric_demand_closure_exceeds_tolerance",
        disposition: "fail",
      },
      {
        code: "metric_demand_derivation_executor_provenance_unverified",
        disposition: "blocked",
      },
      {
        code: "interval_trace_not_server_replayed",
        disposition: "blocked",
      },
    ];
    value.blockers = [
      "mean_metric_demand_closure_exceeds_tolerance",
      "metric_demand_derivation_executor_provenance_unverified",
      "interval_trace_not_server_replayed",
    ];
  },
  mutateRunReplay: (value) => {
    value.calculationDisposition = "blocked";
    value.candidateDisposition = "blocked";
  },
});

describe("NHM2 semiclassical-v2 pair comparator", () => {
  it("rejects superseded v1 run-replayer and content-replay identities", () => {
    const oldRun = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateRunReplay: (value) => {
          value.contractVersion = "nhm2_semiclassical_v2_run_replayer/v1";
        },
      }),
    );
    expect(oldRun.status).toBe("blocked");
    expect(oldRun.blockers).toContain(
      "independent:run_replay_manifest_science_binding_invalid",
    );

    const oldContent = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateReplay: (value) => {
          value.contractVersion = "nhm2_semiclassical_v2_content_replay/v1";
        },
      }),
    );
    expect(oldContent.status).toBe("blocked");
    expect(oldContent.blockers).toEqual(
      expect.arrayContaining([
        "independent:run_replay_manifest_science_binding_invalid",
        "independent:successful_authority_locked_content_replay_required",
      ]),
    );
  });
  it("compares all 32 raw roles and 108 replay metric leaves while derivation authority remains blocked", () => {
    const result = compareNhm2SemiclassicalV2Pair(pair());

    expect(result.status).toBe("blocked");
    expect(result.candidateDisposition).toBe("indeterminate");
    expect(result.candidateRetuningAuthorized).toBe(false);
    expect(result.failureAgreementProjection).toBeNull();
    expect(result.arrayComparisons).toHaveLength(32);
    expect(result.arrayComparisons.every((entry) => entry.bytesEqual)).toBe(
      true,
    );
    expect(result.replayMetricComparisons).toHaveLength(108);
    expect(
      result.replayMetricComparisons.every((entry) => entry.valuesEqual),
    ).toBe(true);
    expect(result.agreementProjection).toBeNull();
    expect(result.replayMetricCoverage).toMatchObject({
      metricLeafCount: 108,
      observedPrimaryLeafCount: 108,
      observedIndependentLeafCount: 108,
      primarySchemaExact: true,
      independentSchemaExact: true,
    });
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
    expect(result.contentReplayRecomputedByComparator).toBe(false);
    expect(result.agreementProjectionAuthority).toBe(false);
    expect(result.failureAgreementProjectionAuthority).toBe(false);
    expect(result.claimLocks.contentReplayRecomputedByComparator).toBe(false);
    expect(result.claimLocks.agreementProjectionAuthoritative).toBe(false);
    expect(result.claimLocks.failureAgreementProjectionAuthoritative).toBe(
      false,
    );
    expect(result.claimLocks.candidateRetuningAuthorized).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "primary:metric_demand_derivation_executor_provenance_unverified",
        "primary:interval_trace_not_server_replayed",
        "independent:metric_demand_derivation_executor_provenance_unverified",
        "independent:interval_trace_not_server_replayed",
      ]),
    );
  });

  it("preserves exact independent agreement on a frozen candidate failure without authorizing retuning or lamps", () => {
    const failure = frozenMeanDemandFailure();
    const result = compareNhm2SemiclassicalV2Pair(pair(failure, failure));

    expect(result.status).toBe("blocked");
    expect(result.candidateDisposition).toBe("indeterminate");
    expect(result.agreementProjection).toBeNull();
    expect(result.failureAgreementProjection).toBeNull();
    expect(result.arrayComparisons).toHaveLength(32);
    expect(result.replayMetricComparisons).toHaveLength(108);
    expect(result.candidateRetuningAuthorized).toBe(false);
    expect(result.claimLocks.terminalCandidateFailureReceiptCreated).toBe(
      false,
    );
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
  });

  it("does not call a one-sided frozen failure an agreed terminal outcome", () => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair(frozenMeanDemandFailure()),
    );

    expect(result.status).toBe("blocked");
    expect(result.candidateDisposition).toBe("indeterminate");
    expect(result.failureAgreementProjection).toBeNull();
    expect(result.replayEnvelopeExact).toBe(false);
    expect(result.issues).toContain("content_replay_envelope_mismatch");
  });

  it.each(NHM2_SEMICLASSICAL_V2_PAIR_ARRAY_ROLES)(
    "exhaustively detects a byte disagreement in raw role %s",
    (role) => {
      const result = compareNhm2SemiclassicalV2Pair(
        pair({ changedRole: role, changedValue: 999 }),
      );

      expect(result.status).toBe("blocked");
      expect(result.arrayComparisons).toHaveLength(32);
      const row = result.arrayComparisons.find(
        (entry) => entry.arrayRole === role,
      );
      expect(row).toMatchObject({ bytesEqual: false, status: "fail" });
      expect(row?.numericDelta).toMatchObject({
        decodableAsFiniteFloat64: true,
        worstIndex: 0,
      });
    },
  );

  it("blocks a missing role and an extra regulator-role inventory", () => {
    const missing = compareNhm2SemiclassicalV2Pair(
      pair({ omitRole: "noise_kernel" }),
    );
    const extra = compareNhm2SemiclassicalV2Pair(
      pair({ extraRegulatorLevel: true }),
    );

    expect(missing.status).toBe("blocked");
    expect(missing.blockers).toContain(
      "independent:exact_ordered_raw_role_inventory_required",
    );
    expect(extra.status).toBe("blocked");
    expect(extra.blockers).toContain(
      "independent:exact_ordered_raw_role_inventory_required",
    );
  });

  it("reports descriptor unit drift independently of exact byte equality", () => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair({ descriptorUnitRole: "mean_rset" }),
    );
    const row = result.arrayComparisons.find(
      (entry) => entry.arrayRole === "mean_rset",
    );

    expect(result.status).toBe("blocked");
    expect(row?.bytesEqual).toBe(true);
    expect(row?.descriptorChecks.unit).toBe(false);
    expect(
      result.blockers.some((blocker) =>
        blocker.startsWith("independent:raw_manifest_invalid:"),
      ),
    ).toBe(true);
  });

  it.each([
    ["shape", "shape"],
    ["componentOrder", "componentOrder"],
    ["unit", "unit"],
    ["dtype", "dtype"],
    ["binaryEncoding", "binaryEncoding"],
    ["endianness", "endianness"],
    ["storageOrder", "storageOrder"],
  ] as const)("detects descriptor %s drift", (field, check) => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair({ descriptorDrift: { role: "mean_rset", field } }),
    );
    const row = result.arrayComparisons.find(
      (entry) => entry.arrayRole === "mean_rset",
    );

    expect(result.status === "fail" || result.status === "blocked").toBe(true);
    expect(row?.descriptorChecks[check]).toBe(false);
    expect(result.agreementProjection).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "blocks non-finite raw Float64 content (%s)",
    (value) => {
      const result = compareNhm2SemiclassicalV2Pair(
        pair({ changedRole: "noise_kernel", changedValue: value }),
      );
      expect(result.status).toBe("blocked");
      expect(result.blockers).toContain(
        "raw_output_nonfinite_or_undecodable:noise_kernel",
      );
    },
  );

  it("fails a finite content-replay metric leaf mismatch while retaining full coverage", () => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateReplay: (value) => {
          value.metrics.mean.smearingWeightSum = 0.5;
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.replayMetricComparisons).toHaveLength(108);
    expect(
      result.replayMetricComparisons.find(
        (entry) => entry.metricLeafId === "metrics.mean.smearingWeightSum",
      ),
    ).toMatchObject({ valuesEqual: false, absoluteDelta: 0.5, status: "fail" });
  });

  it("covers and exactly compares every new demand-error and demand-lower replay leaf", () => {
    const cases = [
      [
        "metrics.metricDemand.minimumPointwiseSymmetricTensorFrobeniusLowerBoundSI",
        (value: Record<string, any>) => {
          value.metrics.metricDemand.minimumPointwiseSymmetricTensorFrobeniusLowerBoundSI = 0.5;
        },
      ],
      [
        "metrics.metricDemand.argminLowerBoundPointIndex",
        (value: Record<string, any>) => {
          value.metrics.metricDemand.argminLowerBoundPointIndex = 1;
        },
      ],
      [
        "metrics.metricDemand.maximumPointwiseDeterministicErrorFrobeniusSI",
        (value: Record<string, any>) => {
          value.metrics.metricDemand.maximumPointwiseDeterministicErrorFrobeniusSI = 8e-12;
        },
      ],
      [
        "metrics.metricDemand.argmaxDeterministicErrorPointIndex",
        (value: Record<string, any>) => {
          value.metrics.metricDemand.argmaxDeterministicErrorPointIndex = 1;
        },
      ],
      [
        "metrics.meanMetricDemandClosure.metricDemandDeterministicErrorFrobeniusAtWorstPointSI",
        (value: Record<string, any>) => {
          value.metrics.meanMetricDemandClosure.metricDemandDeterministicErrorFrobeniusAtWorstPointSI = 8e-12;
        },
      ],
      [
        "metrics.meanMetricDemandClosure.metricDemandFrobeniusLowerBoundAtWorstPointSI",
        (value: Record<string, any>) => {
          value.metrics.meanMetricDemandClosure.metricDemandFrobeniusLowerBoundAtWorstPointSI = 0.5;
        },
      ],
    ] as const;

    for (const [leafId, mutateReplay] of cases) {
      const result = compareNhm2SemiclassicalV2Pair(pair({ mutateReplay }));
      expect(result.status).toBe("blocked");
      expect(result.replayMetricComparisons).toHaveLength(108);
      expect(
        result.replayMetricComparisons.find(
          (entry) => entry.metricLeafId === leafId,
        ),
      ).toMatchObject({ valuesEqual: false, status: "fail" });
    }
  });

  it.each([
    "metrics.metricDemand.argminLowerBoundPointIndex",
    "metrics.metricDemand.argmaxDeterministicErrorPointIndex",
  ] as const)("blocks non-integer index leaf %s", (leafId) => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateReplay: (value) => {
          if (leafId.endsWith("argminLowerBoundPointIndex")) {
            value.metrics.metricDemand.argminLowerBoundPointIndex = 0.5;
          } else {
            value.metrics.metricDemand.argmaxDeterministicErrorPointIndex = 0.5;
          }
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(`replay_metric_leaf_invalid:${leafId}`);
  });

  it("compares every fixed numeric-array element and nullable metric exactly", () => {
    const arrayMismatch = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateReplay: (value) => {
          value.metrics.mean.smearedTensorComponentsSI[9] = 2;
        },
      }),
    );
    const nullMismatch = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateReplay: (value) => {
          value.metrics.noise.negativeWitnessRayleighQuotientSI = 0;
        },
      }),
    );

    expect(
      arrayMismatch.replayMetricComparisons.find(
        (entry) =>
          entry.metricLeafId === "metrics.mean.smearedTensorComponentsSI[9]",
      ),
    ).toMatchObject({ valuesEqual: false, status: "fail" });
    expect(
      nullMismatch.replayMetricComparisons.find(
        (entry) =>
          entry.metricLeafId ===
          "metrics.noise.negativeWitnessRayleighQuotientSI",
      ),
    ).toMatchObject({
      primaryKind: "null",
      independentKind: "finite_number",
      valuesEqual: false,
      status: "fail",
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "blocks non-finite replay metric leaves (%s)",
    (metricValue) => {
      const result = compareNhm2SemiclassicalV2Pair(
        pair({
          mutateReplay: (value) => {
            value.metrics.mean.smearingWeightSum = metricValue;
          },
        }),
      );
      expect(result.status).toBe("blocked");
      expect(result.blockers).toContain(
        "replay_metric_leaf_invalid:metrics.mean.smearingWeightSum",
      );
    },
  );

  it("blocks replay metric schema drift instead of silently ignoring a new leaf", () => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateReplay: (value) => {
          value.metrics.mean.unfrozenNewMetric = 1;
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "independent:content_replay_metric_schema_drift",
    );
    expect(result.replayMetricCoverage.independentSchemaExact).toBe(false);
  });

  it.each(["missing", "wrong_kind"] as const)(
    "blocks replay metric %s drift",
    (variant) => {
      const result = compareNhm2SemiclassicalV2Pair(
        pair({
          mutateReplay: (value) => {
            if (variant === "missing")
              delete value.metrics.mean.smearingWeightSum;
            else value.metrics.mean.smearingWeightSum = "1";
          },
        }),
      );

      expect(result.status).toBe("blocked");
      expect(result.blockers).toContain(
        "replay_metric_leaf_invalid:metrics.mean.smearingWeightSum",
      );
      expect(result.agreementProjection).toBeNull();
    },
  );

  it("compares statuses, issues, blockers, enums, booleans, counts, and nulls outside metrics exactly", () => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateReplay: (value) => {
          value.status = "fail";
          value.issues.push({
            code: "fluctuation_ratio_exceeds_tolerance",
            disposition: "fail",
          });
          value.blockers.push("array_nonfinite");
          value.inputBindings.preexecutionFreezeVerified = true;
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.replayEnvelopeExact).toBe(false);
    expect(result.issues).toContain("content_replay_envelope_mismatch");
    expect(result.blockers).toContain(
      "independent:successful_authority_locked_content_replay_required",
    );
  });

  it("blocks both lanes when their identically schema-invalid manifests otherwise bind to their bytes and replays", () => {
    const addUnknownManifestField = (manifest: Record<string, any>) => {
      manifest.unfrozenSchemaExtension = { wouldOtherwiseMatch: true };
    };
    const result = compareNhm2SemiclassicalV2Pair(
      pair(
        { mutateManifest: addUnknownManifestField },
        { mutateManifest: addUnknownManifestField },
      ),
    );

    expect(result.status).toBe("blocked");
    expect(
      result.blockers.some((blocker) =>
        blocker.startsWith("primary:raw_manifest_invalid:"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((blocker) =>
        blocker.startsWith("independent:raw_manifest_invalid:"),
      ),
    ).toBe(true);
    expect(result.agreementProjection).toBeNull();
  });

  it("blocks a fabricated content replay even when its full metric payload would compare equal", () => {
    const result = compareNhm2SemiclassicalV2Pair(
      pair({
        mutateRunReplay: (runReplay) => {
          const fabricatedReplay = structuredClone(runReplay.replay);
          fabricatedReplay.inputBindings.candidateId = "fabricated-candidate";
          runReplay.replay = fabricatedReplay;
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "independent:run_replay_manifest_science_binding_invalid",
    );
    expect(result.agreementProjection).toBeNull();
  });

  it("blocks cross-swapped replay, manifest binding, manifest, and secure-read byte snapshots", () => {
    const primary = buildSnapshot("primary");
    const independent = buildSnapshot("independent", {
      changedRole: "mean_rset",
      changedValue: 999,
    });
    const cases = [
      [
        "run replay",
        replaceSnapshot(independent, { runReplay: primary.runReplay }),
      ],
      [
        "manifest binding",
        replaceSnapshot(independent, {
          manifestBinding: primary.manifestBinding,
        }),
      ],
      [
        "manifest",
        replaceSnapshot(independent, { manifest: primary.manifest }),
      ],
      [
        "secure-read bytes",
        replaceSnapshot(independent, {
          outputSnapshot: primary.outputSnapshot,
        }),
      ],
    ] as const;

    for (const [label, swappedIndependent] of cases) {
      const result = compareSnapshots(primary, swappedIndependent);
      expect(result.status, label).toBe("blocked");
      expect(result.blockers.length, label).toBeGreaterThan(0);
      expect(result.agreementProjection, label).toBeNull();
    }
  });

  it("blocks non-exact secure reader result shapes before comparison authority", () => {
    const primary = buildSnapshot("primary");
    const independent = buildSnapshot("independent");
    const malformedOutputSnapshot = freezeContainers({
      ...independent.outputSnapshot,
      fabricatedReadAuthority: true,
    });
    const result = compareSnapshots(
      primary,
      replaceSnapshot(independent, {
        outputSnapshot: malformedOutputSnapshot as any,
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "independent:secure_output_snapshot_invalid",
    );
    expect(result.agreementProjection).toBeNull();
  });

  it("deep-freezes every nested result and preserves calculation-only false authority claims", () => {
    const result = compareNhm2SemiclassicalV2Pair(pair());
    const before = result.arrayComparisons[0].numericDelta.maximumAbsoluteDelta;

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.arrayComparisons)).toBe(true);
    expect(Object.isFrozen(result.arrayComparisons[0].numericDelta)).toBe(true);
    expect(Object.isFrozen(result.replayMetricCoverage.metricLeafIds)).toBe(
      true,
    );
    expect(() => {
      (result.arrayComparisons[0].numericDelta as any).maximumAbsoluteDelta = 9;
    }).toThrow();
    expect(result.arrayComparisons[0].numericDelta.maximumAbsoluteDelta).toBe(
      before,
    );
    expect(
      result.claimLocks.independentImplementationAgreementEstablished,
    ).toBe(false);
    expect(result.claimLocks.physicalViabilityEstablished).toBe(false);
  });
});
