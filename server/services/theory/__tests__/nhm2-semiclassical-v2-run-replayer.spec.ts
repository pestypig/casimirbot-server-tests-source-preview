import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
import {
  NHM2_SEMICLASSICAL_CONSTRAINT_BRACKET_IDS,
  NHM2_SEMICLASSICAL_CONSTRAINT_COMPONENT_ORDER,
  NHM2_SEMICLASSICAL_NOISE_KERNEL_COMPONENT_PAIR_ORDER,
} from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v2";
import { NHM2_SEMICLASSICAL_TENSOR_COMPONENTS } from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v1";
import {
  replayNhm2SemiclassicalV2Run,
  type Nhm2SemiclassicalV2RunReplayerInput,
} from "../nhm2-semiclassical-v2-run-replayer";
import {
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_REPLAY_SCOPE_CONTRACT_VERSION,
  type Nhm2SemiclassicalV2MetricDemandDerivationReplayEvidence,
  type Nhm2SemiclassicalV2MetricDemandDerivationReplayScope,
} from "../nhm2-semiclassical-v2-metric-demand-derivation-replay-bridge";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

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

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 12));

const encodeFloat64Le = (values: Float64Array): Buffer => {
  const bytes = Buffer.alloc(values.length * 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat64(index * 8, values[index], true);
  }
  return bytes;
};

type Fixture = {
  input: Nhm2SemiclassicalV2RunReplayerInput;
  manifest: Nhm2SemiclassicalV2RawReplayManifestV1;
  outputRoot: string;
  firstArrayPath: string;
  derivationReceipt: FixtureDerivationReceipt;
};

type FixtureDerivationReceipt = {
  derivation: { intervalTraceSha256: string };
  implementation: {
    sourceSha256: string;
    dependencyLockSha256: string;
    toolchainArtifactSha256: string;
    executableSha256: string;
  };
  execution: {
    gitCommitSha: string;
    command: string;
    argv: string[];
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  outputs: { intervalTrace: { sizeBytes: number } };
};

const cloneInput = (
  input: Nhm2SemiclassicalV2RunReplayerInput,
): Nhm2SemiclassicalV2RunReplayerInput => ({
  manifest: {
    ...input.manifest,
    bytes: Buffer.from(input.manifest.bytes),
  },
  trusted: structuredClone(input.trusted),
});

async function buildFixture(
  options: { nonfiniteNoise?: boolean; meanDemandFailure?: boolean } = {},
): Promise<Fixture> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-v2-run-replayer-"),
  );
  temporaryRoots.push(root);
  const scientificRoot = path.join(root, "scientific");
  const implementationRoot = path.join(root, "implementation");
  const outputRoot = path.join(root, "output");
  await Promise.all(
    [scientificRoot, implementationRoot, outputRoot].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  );
  await pause();
  const frozenAt = new Date().toISOString();

  const sampleCount = 64;
  const scientificLogicalRoot = "inputs/frozen";
  const implementationLogicalRoot = "inputs/primary";
  const outputLogicalRoot = "artifacts/semiclassical-v2/primary";
  const entries: Nhm2SemiclassicalV2RawReplayInputEntryV1[] = [];
  let derivationReceipt: FixtureDerivationReceipt | null = null;
  const metricDemand = new Float64Array(sampleCount * 10);
  const metricDemandErrorBound = new Float64Array(sampleCount * 10);
  metricDemandErrorBound.fill(1e-12);
  for (let point = 0; point < sampleCount; point += 1) {
    metricDemand[point * 10] = 100;
  }

  for (const inputId of NHM2_SEMICLASSICAL_V2_RAW_REPLAY_REQUIRED_INPUT_IDS) {
    const scientific = (
      NHM2_SEMICLASSICAL_V2_RAW_REPLAY_SCIENTIFIC_INPUT_IDS as readonly string[]
    ).includes(inputId);
    const filesystemRoot = scientific ? scientificRoot : implementationRoot;
    const logicalRoot = scientific
      ? scientificLogicalRoot
      : implementationLogicalRoot;
    const metricDemandArray =
      inputId === "metric_demand_tensor" ||
      inputId === "metric_demand_absolute_error_bound";
    const extension = metricDemandArray ? "f64le" : "bin";
    const relativePath = `${inputId}.${extension}`;
    let bytes =
      inputId === "tolerance_policy"
        ? Buffer.from(
            NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CANONICAL_JSON,
            "utf8",
          )
        : metricDemandArray
          ? encodeFloat64Le(
              inputId === "metric_demand_tensor"
                ? metricDemand
                : metricDemandErrorBound,
            )
          : scientific
            ? Buffer.from(canonicalJson({ inputId, frozen: true }), "utf8")
            : Buffer.from(`toolchain:${inputId}:primary`, "utf8");
    if (inputId === "metric_demand_derivation_receipt") {
      const byId = new Map(entries.map((entry) => [entry.inputId, entry]));
      const derivationStartedAt = new Date(
        Date.parse(frozenAt) - 2_000,
      ).toISOString();
      const derivationCompletedAt = new Date(
        Date.parse(frozenAt) - 1_000,
      ).toISOString();
      const unsignedReceipt = {
        artifactId: "nhm2.semiclassical_v2_metric_demand_derivation_receipt",
        contractVersion:
          "nhm2_semiclassical_v2_metric_demand_derivation_receipt/v1",
        candidateId: "nhm2-semiclassical-v2-candidate-001",
        inputBindings: {
          geometrySha256: byId.get("geometry")!.sha256,
          chartSha256: byId.get("chart")!.sha256,
          samplingBasisSha256: byId.get("sampling_basis")!.sha256,
          smearingDefinitionSha256: byId.get("smearing_definition")!.sha256,
          normalizationSha256: byId.get("normalization")!.sha256,
          tolerancePolicySha256: byId.get("tolerance_policy")!.sha256,
        },
        derivation: {
          formulaId:
            "einstein_tensor_orthonormal_tetrad_pullback_spacetime_smear/v1",
          algorithmId:
            "componentwise_outward_interval_plus_quadrature_discretization_truncation_bound/v1",
          enclosureMethod:
            "componentwise_outward_rounded_interval_plus_discretization_truncation_tail_bound",
          coverage: "all_64_samples_all_10_symmetric_tensor_components",
          relativeEnclosureTarget: 0.01,
          boundScope:
            "deterministic_numerical_error_only_physical_constant_uncertainty_excluded",
          zeroBoundDisposition:
            "strictly_positive_componentwise_bounds_required_pending_exact_zero_derivation_replay",
          constants: {
            speedOfLightMetersPerSecond: 299792458,
            newtonianGravitationalConstantSI: 6.6743e-11,
            newtonianGravitationalConstantStandardUncertaintySI: 1.5e-15,
            einsteinCouplingConvention: "T_hat_ab=(c^4/(8*pi*G))*G_hat_ab",
          },
          intervalTraceSha256: sha256("fixture-interval-trace"),
        },
        implementation: {
          sourceSha256: sha256("fixture-derivation-source"),
          dependencyLockSha256: sha256("fixture-derivation-dependencies"),
          toolchainArtifactSha256: sha256("fixture-derivation-toolchain"),
          executableSha256: sha256("fixture-derivation-executable"),
        },
        execution: {
          authority: "executor_observed",
          gitCommitSha: "b".repeat(40),
          command: "derivation-solver",
          argv: ["--frozen-candidate", "nhm2-semiclassical-v2-candidate-001"],
          startedAt: derivationStartedAt,
          completedAt: derivationCompletedAt,
          durationMs: 1_000,
          exitCode: 0,
        },
        outputs: {
          centralTensor: {
            inputId: "metric_demand_tensor",
            sha256: byId.get("metric_demand_tensor")!.sha256,
            sizeBytes: 5120,
            freshness: "created_or_modified_during_execution",
          },
          deterministicAbsoluteErrorBound: {
            inputId: "metric_demand_absolute_error_bound",
            sha256: byId.get("metric_demand_absolute_error_bound")!.sha256,
            sizeBytes: 5120,
            unit: "J/m^3",
            shape: [64, 10],
            componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
            freshness: "created_or_modified_during_execution",
          },
          intervalTrace: {
            sha256: sha256("fixture-interval-trace"),
            sizeBytes: 4096,
            freshness: "created_or_modified_during_execution",
          },
        },
        verificationStatus:
          "metric_demand_derivation_executor_provenance_unverified",
        claimLocks: {
          derivationReplayAuthority: false,
          deterministicErrorBoundAuthority: false,
          diagnosticPass: false,
          theoryClosure: false,
          physicalViability: false,
        },
        integrity: {
          hashAlgorithm: "sha256",
          canonicalization: "utf8_lexicographic_object_keys_json_v1",
        },
      };
      const receipt = {
        ...unsignedReceipt,
        integrity: {
          ...unsignedReceipt.integrity,
          receiptSha256: sha256(canonicalJson(unsignedReceipt)),
        },
      };
      derivationReceipt = receipt as FixtureDerivationReceipt;
      bytes = Buffer.from(canonicalJson(receipt), "utf8");
    }
    await fs.writeFile(path.join(filesystemRoot, relativePath), bytes, {
      flag: "wx",
    });
    const base = {
      inputId,
      path: `${logicalRoot}/${relativePath}`,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      mediaType:
        metricDemandArray || !scientific
          ? "application/octet-stream"
          : "application/json",
      freshness: "preexisting_unchanged" as const,
      observedAt: "",
    };
    entries.push(
      metricDemandArray
        ? {
            ...base,
            inputId,
            dtype: "float64",
            binaryEncoding: "raw_ieee754",
            endianness: "little",
            shape: [sampleCount, 10],
            storageOrder: "row-major",
            componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
            unit: "J/m^3",
          }
        : (base as Nhm2SemiclassicalV2RawReplayInputEntryV1),
    );
  }

  await pause();
  const sealedAt = new Date().toISOString();
  for (const entry of entries) entry.observedAt = sealedAt;
  await pause();
  const startedAt = new Date().toISOString();

  let ordinal = 0;
  const descriptors: Nhm2SemiclassicalV2RawReplayArrayV1[] = [];
  let firstArrayPath = "";
  const writeArray = async (
    role: string,
    shape: number[],
    componentOrder: readonly string[],
    unit: string,
    values: Float64Array,
  ): Promise<Nhm2SemiclassicalV2RawReplayArrayV1> => {
    const fileName = `${ordinal.toString().padStart(2, "0")}-${role.replaceAll(".", "-")}.f64le`;
    ordinal += 1;
    if (firstArrayPath.length === 0)
      firstArrayPath = path.join(outputRoot, fileName);
    const bytes = encodeFloat64Le(values);
    await fs.writeFile(path.join(outputRoot, fileName), bytes, { flag: "wx" });
    const descriptor: Nhm2SemiclassicalV2RawReplayArrayV1 = {
      role,
      path: `${outputLogicalRoot}/${fileName}`,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      freshness: "new",
      observedAt: "",
      dtype: "float64",
      binaryEncoding: "raw_ieee754",
      endianness: "little",
      shape,
      storageOrder: "row-major",
      componentOrder: [...componentOrder],
      unit,
    };
    descriptors.push(descriptor);
    return descriptor;
  };

  const noiseLength = sampleCount * sampleCount * 100;
  const noise = new Float64Array(noiseLength);
  for (let index = 0; index < sampleCount * 10; index += 1) {
    const point = Math.floor(index / 10);
    const component = index % 10;
    const offset =
      (point * sampleCount + point) * 100 + component * 10 + component;
    noise[offset] = 1;
  }
  if (options.nonfiniteNoise) noise[0] = Number.NaN;
  const mean = new Float64Array(sampleCount * 10);
  if (!options.meanDemandFailure) {
    for (let point = 0; point < sampleCount; point += 1) mean[point * 10] = 100;
  }
  const weights = new Float64Array(sampleCount);
  weights.fill(1 / sampleCount);
  const constraintLength = sampleCount * 4;
  const target = new Float64Array(constraintLength);
  target.fill(1);
  const computed = Float64Array.from(target);
  computed[0] += 1e-4;
  const residual = new Float64Array(constraintLength);
  residual[0] = 1e-4;
  const zeros = () => new Float64Array(constraintLength);

  const noiseKernel = await writeArray(
    "noise_kernel",
    [sampleCount, sampleCount, 100],
    NHM2_SEMICLASSICAL_NOISE_KERNEL_COMPONENT_PAIR_ORDER,
    "(J/m^3)^2",
    noise,
  );
  const noiseUncertainty = await writeArray(
    "noise_kernel_absolute_uncertainty95",
    [sampleCount, sampleCount, 100],
    NHM2_SEMICLASSICAL_NOISE_KERNEL_COMPONENT_PAIR_ORDER,
    "(J/m^3)^2",
    new Float64Array(noiseLength),
  );
  const meanRset = await writeArray(
    "mean_rset",
    [sampleCount, 10],
    NHM2_SEMICLASSICAL_TENSOR_COMPONENTS,
    "J/m^3",
    mean,
  );
  const meanRsetAbsoluteUncertainty95 = await writeArray(
    "mean_rset_absolute_uncertainty95",
    [sampleCount, 10],
    NHM2_SEMICLASSICAL_TENSOR_COMPONENTS,
    "J/m^3",
    new Float64Array(mean.length),
  );
  const smearingWeights = await writeArray(
    "smearing_weights",
    [sampleCount],
    ["weight"],
    "dimensionless",
    weights,
  );
  const constraintArray = (role: string, values: Float64Array) =>
    writeArray(
      role,
      [sampleCount, 4],
      NHM2_SEMICLASSICAL_CONSTRAINT_COMPONENT_ORDER,
      "dimensionless",
      values,
    );
  const brackets =
    [] as Nhm2SemiclassicalV2RawReplayManifestV1["arrays"]["brackets"];
  for (const bracketId of NHM2_SEMICLASSICAL_CONSTRAINT_BRACKET_IDS) {
    brackets.push({
      bracketId,
      computed: await constraintArray(
        `constraint_bracket.${bracketId}.computed`,
        computed,
      ),
      target: await constraintArray(
        `constraint_bracket.${bracketId}.target`,
        target,
      ),
      residual: await constraintArray(
        `constraint_bracket.${bracketId}.residual`,
        residual,
      ),
      absoluteUncertainty95: await constraintArray(
        `constraint_bracket.${bracketId}.absolute_uncertainty95`,
        zeros(),
      ),
    });
  }
  const antisymmetry = {
    forward: await constraintArray("antisymmetry.forward", zeros()),
    reverse: await constraintArray("antisymmetry.reverse", zeros()),
    residual: await constraintArray("antisymmetry.residual", zeros()),
    absoluteUncertainty95: await constraintArray(
      "antisymmetry.absolute_uncertainty95",
      zeros(),
    ),
  };
  const jacobi = {
    term1: await constraintArray("jacobi.term_1", zeros()),
    term2: await constraintArray("jacobi.term_2", zeros()),
    term3: await constraintArray("jacobi.term_3", zeros()),
    residual: await constraintArray("jacobi.residual", zeros()),
    absoluteUncertainty95: await constraintArray(
      "jacobi.absolute_uncertainty95",
      zeros(),
    ),
  };
  const regulatorLevels =
    [] as Nhm2SemiclassicalV2RawReplayManifestV1["arrays"]["regulatorLevels"];
  for (const [level, scale, magnitude] of [
    [0, 1, 0.04],
    [1, 0.5, 0.01],
    [2, 0.25, 0.0025],
  ] as const) {
    const levelResidual = zeros();
    levelResidual[0] = magnitude;
    regulatorLevels.push({
      ordinal: level,
      levelId: `regulator-level-${level}`,
      scale,
      residual: await constraintArray(
        `regulator_level.${level}.residual`,
        levelResidual,
      ),
      absoluteUncertainty95: await constraintArray(
        `regulator_level.${level}.absolute_uncertainty95`,
        zeros(),
      ),
    });
  }

  await pause();
  const completedAt = new Date().toISOString();
  const generatedAt = completedAt;
  for (const descriptor of descriptors) descriptor.observedAt = generatedAt;
  const inputById = new Map(
    entries.map((entry) => [entry.inputId, entry] as const),
  );
  const roots = {
    scientificRootDirectory: scientificLogicalRoot,
    implementationRootDirectory: implementationLogicalRoot,
  };
  const manifest: Nhm2SemiclassicalV2RawReplayManifestV1 = {
    artifactId: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_MANIFEST_ARTIFACT_ID,
    contractVersion: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_MANIFEST_CONTRACT_VERSION,
    manifestFrozenAt: frozenAt,
    generatedAt,
    candidate: {
      candidateId: "nhm2-semiclassical-v2-candidate-001",
      candidateManifestId: "nhm2-candidate-manifest-001",
      selectedProfileId: "nhm2-profile-nondegenerate-001",
      candidateKind: "frozen_nondegenerate_nhm2_semiclassical_candidate",
      geometryId: "nhm2-geometry-nondegenerate-001",
      quantumStateId: "hadamard-state-001",
      chartId: "nhm2-cartesian-chart-001",
      normalizationId: "nhm2-semiclassical-normalization-001",
      tolerancePolicyId: NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ID,
      smearingFunctionId: "compact-smearing-function-001",
      samplingBasisId: "bilocal-sampling-basis-001",
      nondegeneracyCriterionId: "positive-metric-demand-frobenius-001",
      metricDemandInputId: "metric_demand_tensor",
      metricDemandErrorBoundInputId: "metric_demand_absolute_error_bound",
      metricDemandDerivationWitnessInputId: "metric_demand_derivation_receipt",
      minimumMetricDemandFrobeniusSI:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.minimumMetricDemandFrobeniusSI,
      requiredMetricDemandSampleFraction:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.requiredMetricDemandSampleFraction,
      sampleCount,
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
      comparisonPairId: "nhm2-semiclassical-v2-pair-001",
      role: "primary",
      implementationId: "primary-semiclassical-solver",
      implementationVersion: "1.0.0",
      sourceIdentity: {
        identityId: "primary-source-tree",
        inputId: "implementation_source",
        sha256: inputById.get("implementation_source")!.sha256,
      },
      dependencyIdentity: {
        identityId: "primary-dependency-lock",
        inputId: "dependency_lock",
        sha256: inputById.get("dependency_lock")!.sha256,
      },
      executableIdentity: {
        identityId: "primary-executable",
        inputId: "executable",
        sha256: inputById.get("executable")!.sha256,
      },
      inputExposure: {
        scientificRoot: "read_only_exact_inventory",
        implementationRoot: "executor_owned_toolchain_not_data_input",
        counterpartOutputs: "not_mounted",
        ambientRepository: "not_mounted",
      },
    },
    execution: {
      commitSha: "a".repeat(40),
      command: "node",
      argv: ["solver/primary.mjs", "--frozen-candidate"],
      workingDirectory: ".",
      outputDirectory: outputLogicalRoot,
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      exitCode: 0,
      terminationSignal: null,
    },
    inputClosure: {
      manifestDeclaresFrozenBeforeExecution: true,
      scientificPresealBinding: {
        artifactId: "nhm2.semiclassical_v2_scientific_preseal",
        contractVersion: "nhm2_semiclassical_v2_scientific_preseal/v2",
        sealKey: sha256(
          "nhm2-semiclassical-v2-deterministic-seal-key/v2\nnhm2-semiclassical-v2-candidate-001",
        ),
        candidateManifestSha256: inputById.get("candidate_manifest")!.sha256,
        scientificContentSha256: sha256("scientific-content"),
        sealedInventorySha256: sha256("sealed-inventory"),
        sealedAt,
      },
      ...roots,
      algorithm: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_INPUT_CLOSURE_ALGORITHM,
      ordering: NHM2_SEMICLASSICAL_V2_RAW_REPLAY_INPUT_ORDERING,
      entries,
      excludedInputIds: [
        ...NHM2_SEMICLASSICAL_V2_RAW_REPLAY_FORBIDDEN_INPUT_IDS,
      ],
      scientificClosureSha256:
        computeNhm2SemiclassicalV2RawReplayInputClosureSha256(
          entries,
          "scientific",
          roots,
        ),
      completeClosureSha256:
        computeNhm2SemiclassicalV2RawReplayInputClosureSha256(
          entries,
          "complete",
          roots,
        ),
    },
    arrays: {
      noiseKernel,
      noiseKernelAbsoluteUncertainty95: noiseUncertainty,
      meanRset,
      meanRsetAbsoluteUncertainty95,
      smearingWeights,
      brackets,
      antisymmetry,
      jacobi,
      regulatorLevels,
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
  const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
  const manifestRelativePath = "raw-replay-manifest.json";
  await fs.writeFile(
    path.join(outputRoot, manifestRelativePath),
    manifestBytes,
    { flag: "wx" },
  );
  await pause();
  const manifestObservedAt = new Date().toISOString();
  const input: Nhm2SemiclassicalV2RunReplayerInput = {
    manifest: {
      bytes: manifestBytes,
      sha256: sha256(manifestBytes),
      sizeBytes: manifestBytes.byteLength,
      mediaType: "application/json",
      relativePath: manifestRelativePath,
      observedAt: manifestObservedAt,
    },
    trusted: {
      manifestFrozenAt: manifest.manifestFrozenAt,
      generatedAt: manifest.generatedAt,
      candidate: structuredClone(manifest.candidate),
      implementation: structuredClone(manifest.implementation),
      execution: structuredClone(manifest.execution),
      scientificPresealBinding: structuredClone(
        manifest.inputClosure.scientificPresealBinding,
      ),
      manifestInputClosureSnapshot: structuredClone(manifest.inputClosure),
      roots: {
        scientific: scientificRoot,
        implementation: implementationRoot,
        output: outputRoot,
      },
    },
  };
  return {
    input,
    manifest,
    outputRoot,
    firstArrayPath,
    derivationReceipt: derivationReceipt!,
  };
}

const forgedDerivationReplayEvidence = (
  fixture: Fixture,
  overrides: Partial<Nhm2SemiclassicalV2MetricDemandDerivationReplayScope> = {},
): Nhm2SemiclassicalV2MetricDemandDerivationReplayEvidence => {
  const manifest = fixture.manifest;
  const byId = new Map(
    manifest.inputClosure.entries.map((entry) => [entry.inputId, entry]),
  );
  const receipt = fixture.derivationReceipt;
  const scope: Nhm2SemiclassicalV2MetricDemandDerivationReplayScope =
    Object.freeze({
      contractVersion:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_REPLAY_SCOPE_CONTRACT_VERSION,
      candidateId: manifest.candidate.candidateId,
      candidateManifestSha256: byId.get("candidate_manifest")!.sha256,
      scientificPresealSealKey:
        manifest.inputClosure.scientificPresealBinding.sealKey,
      scientificPresealScientificContentSha256:
        manifest.inputClosure.scientificPresealBinding.scientificContentSha256,
      scientificPresealSealedInventorySha256:
        manifest.inputClosure.scientificPresealBinding.sealedInventorySha256,
      scientificPresealSealedAt:
        manifest.inputClosure.scientificPresealBinding.sealedAt,
      scientificClosureSha256: manifest.inputClosure.scientificClosureSha256,
      completeClosureSha256: manifest.inputClosure.completeClosureSha256,
      metricDemandDerivationReceiptSha256: byId.get(
        "metric_demand_derivation_receipt",
      )!.sha256,
      intervalTraceSha256: receipt.derivation.intervalTraceSha256,
      intervalTraceSizeBytes: receipt.outputs.intervalTrace.sizeBytes,
      approvedReplayPolicySha256: byId.get("tolerance_policy")!.sha256,
      centralTensorSha256: byId.get("metric_demand_tensor")!.sha256,
      centralTensorSizeBytes: byId.get("metric_demand_tensor")!.sizeBytes,
      absoluteErrorBoundSha256: byId.get("metric_demand_absolute_error_bound")!
        .sha256,
      absoluteErrorBoundSizeBytes: byId.get(
        "metric_demand_absolute_error_bound",
      )!.sizeBytes,
      rawReplayManifestSha256: fixture.input.manifest.sha256,
      rawReplayManifestSizeBytes: fixture.input.manifest.sizeBytes,
      manifestFrozenAt: manifest.manifestFrozenAt,
      manifestGeneratedAt: manifest.generatedAt,
      manifestObservedAt: fixture.input.manifest.observedAt,
      implementationRole: manifest.implementation.role,
      implementationId: manifest.implementation.implementationId,
      implementationVersion: manifest.implementation.implementationVersion,
      implementationSourceSha256: manifest.implementation.sourceIdentity.sha256,
      implementationDependencyLockSha256:
        manifest.implementation.dependencyIdentity.sha256,
      implementationExecutableSha256:
        manifest.implementation.executableIdentity.sha256,
      executionCommitSha: manifest.execution.commitSha,
      executionCommand: manifest.execution.command,
      executionArgvSha256: sha256(canonicalJson(manifest.execution.argv)),
      executionWorkingDirectory: manifest.execution.workingDirectory,
      executionOutputDirectory: manifest.execution.outputDirectory,
      executionStartedAt: manifest.execution.startedAt,
      executionCompletedAt: manifest.execution.completedAt,
      executionDurationMs: manifest.execution.durationMs,
      metricDemandDerivationSourceSha256: receipt.implementation.sourceSha256,
      metricDemandDerivationDependencyLockSha256:
        receipt.implementation.dependencyLockSha256,
      metricDemandDerivationToolchainArtifactSha256:
        receipt.implementation.toolchainArtifactSha256,
      metricDemandDerivationExecutableSha256:
        receipt.implementation.executableSha256,
      metricDemandDerivationGitCommitSha: receipt.execution.gitCommitSha,
      metricDemandDerivationCommand: receipt.execution.command,
      metricDemandDerivationArgvSha256: sha256(
        canonicalJson(receipt.execution.argv),
      ),
      metricDemandDerivationStartedAt: receipt.execution.startedAt,
      metricDemandDerivationCompletedAt: receipt.execution.completedAt,
      metricDemandDerivationDurationMs: receipt.execution.durationMs,
      ...overrides,
    });
  return Object.freeze({
    capability: Object.freeze(
      Object.assign(Object.create(null), {
        completeIndependentDerivationEstablished: true,
      }),
    ) as never,
    scope,
  });
};

describe("NHM2 semiclassical-v2 secure single-run replay", () => {
  it("rejects a self-consistent superseded v1 raw-manifest identity", async () => {
    const fixture = await buildFixture();
    (
      fixture.manifest as unknown as { contractVersion: string }
    ).contractVersion = "nhm2_semiclassical_v2_raw_replay_manifest/v1";
    const bytes = Buffer.from(canonicalJson(fixture.manifest), "utf8");
    (fixture.input.manifest as { bytes: Buffer }).bytes = bytes;
    (fixture.input.manifest as { sha256: string }).sha256 = sha256(bytes);
    (fixture.input.manifest as { sizeBytes: number }).sizeBytes =
      bytes.byteLength;

    const result = await replayNhm2SemiclassicalV2Run(fixture.input);

    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]).toMatchObject({
      code: "manifest_structural_invalid",
    });
  });
  it("reopens the exact run inventories, decodes unique full buffers, and keeps every promotion claim locked", async () => {
    const fixture = await buildFixture();
    const result = await replayNhm2SemiclassicalV2Run(fixture.input);

    expect(result.verificationState).toBe(
      "bounded_filesystem_snapshots_replayed",
    );
    if (result.verificationState !== "bounded_filesystem_snapshots_replayed")
      return;
    expect(result.calculationDisposition).toBe("blocked");
    expect(result.candidateDisposition).toBe("blocked");
    expect(result.replay.blockers).toEqual([
      "metric_demand_derivation_executor_provenance_unverified",
      "interval_trace_not_server_replayed",
    ]);
    expect(result.provenance.files).toHaveLength(59);
    expect(
      result.provenance.files.some((file) => file.scope === "manifest"),
    ).toBe(true);
    expect(result.replay.metrics.inputContent).toMatchObject({
      allValuesFinite: true,
      buffersUniqueAndNonShared: true,
      arraysAreFullBufferViews: true,
    });
    expect(result.replay.inputBindings).toMatchObject({
      manifestDeclaresFrozenBeforeExecution: true,
      preexecutionFreezeVerified: false,
    });
    expect(result.provenance.scientificPresealBinding).toEqual(
      fixture.manifest.inputClosure.scientificPresealBinding,
    );
    expect(result.provenance.scientificPresealBindingStatus).toBe(
      "producer_echo_matches_trusted_binding_not_persistence_receipt",
    );
    expect(Object.isFrozen(result.provenance.scientificPresealBinding)).toBe(
      true,
    );
    expect(
      Reflect.set(
        result.provenance.scientificPresealBinding,
        "sealedAt",
        "2099-01-01T00:00:00.000Z",
      ),
    ).toBe(false);
    expect(Object.isFrozen(result.replay)).toBe(true);
    expect(Object.isFrozen(result.replay.inputBindings)).toBe(true);
    expect(
      Reflect.set(
        result.replay.inputBindings,
        "preexecutionFreezeVerified",
        true,
      ),
    ).toBe(false);
    expect(
      result.provenance.files
        .filter((file) => file.scope === "run_output")
        .every(
          (file) =>
            file.freshness ===
            "created_or_modified_within_trusted_execution_interval",
        ),
    ).toBe(true);
    expect(
      result.provenance.files.find((file) => file.scope === "manifest")
        ?.freshness,
    ).toBe("created_or_modified_post_execution_before_observation");
    expect(result.claimLocks).toMatchObject({
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
      physicalViabilityEstablished: false,
      propulsionEstablished: false,
      transportEstablished: false,
    });
    expect(result.authorityBlockers).toContain(
      "preexecution_scientific_input_seal_not_verified",
    );
    expect(result.authorityBlockers).toContain(
      "independent_implementation_agreement_not_established",
    );
    expect(result.authorityBlockers).toContain(
      "run_output_absent_prestate_not_verified",
    );
    expect(result.authorityBlockers).toContain(
      "manifest_absent_prestate_not_verified",
    );
    expect(result.authorityBlockers).toContain(
      "server_authorized_run_root_not_established",
    );
    expect(result.authorityBlockers).toContain(
      "same_user_run_output_mutation_exclusion_not_os_enforced",
    );
  });

  it("rejects a plain token even when accompanied by the exact derived receipt and full run scope", async () => {
    const fixture = await buildFixture();
    const result = await replayNhm2SemiclassicalV2Run(
      fixture.input,
      forgedDerivationReplayEvidence(fixture),
    );

    expect(result.verificationState).toBe(
      "bounded_filesystem_snapshots_replayed",
    );
    if (result.verificationState !== "bounded_filesystem_snapshots_replayed")
      return;
    expect(result.replay.blockers).toEqual([
      "metric_demand_derivation_executor_provenance_unverified",
      "interval_trace_not_server_replayed",
    ]);
    expect(result.calculationDisposition).toBe("blocked");
    expect(result.claimLocks.theoryGraphNoiseKernelLampPromotable).toBe(false);
    expect(result.claimLocks.theoryGraphConstraintAlgebraLampPromotable).toBe(
      false,
    );
    expect(result.claimLocks.physicalViabilityEstablished).toBe(false);
  });

  it.each([
    [
      "candidate manifest",
      "candidateManifestSha256",
      sha256("other-candidate"),
    ],
    [
      "scientific preseal",
      "scientificPresealSealedInventorySha256",
      sha256("other-preseal"),
    ],
    [
      "raw replay manifest",
      "rawReplayManifestSha256",
      sha256("other-run-manifest"),
    ],
    [
      "derivation receipt",
      "metricDemandDerivationReceiptSha256",
      sha256("other-derivation-receipt"),
    ],
    ["interval trace", "intervalTraceSha256", sha256("other-trace")],
    ["run execution", "executionCommand", "retuned-solver"],
  ] as const)(
    "does not reuse derivation replay evidence across a different %s scope",
    async (_label, key, value) => {
      const fixture = await buildFixture();
      const result = await replayNhm2SemiclassicalV2Run(
        fixture.input,
        forgedDerivationReplayEvidence(fixture, { [key]: value }),
      );

      expect(result.verificationState).toBe(
        "bounded_filesystem_snapshots_replayed",
      );
      if (result.verificationState !== "bounded_filesystem_snapshots_replayed")
        return;
      expect(result.replay.blockers).toEqual([
        "metric_demand_derivation_executor_provenance_unverified",
        "interval_trace_not_server_replayed",
      ]);
      expect(result.claimLocks.theoryGraphNoiseKernelLampPromotable).toBe(
        false,
      );
      expect(result.claimLocks.theoryGraphConstraintAlgebraLampPromotable).toBe(
        false,
      );
      expect(result.claimLocks.physicalViabilityEstablished).toBe(false);
    },
  );

  it("fails closed on Proxy, accessor, and symbol-bearing run evidence without invoking getters", async () => {
    const fixture = await buildFixture();
    let getterInvoked = false;
    const accessorEvidence = Object.create(null);
    Object.defineProperty(accessorEvidence, "capability", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        throw new Error("must_not_invoke_evidence_getter");
      },
    });
    Object.defineProperty(accessorEvidence, "scope", {
      enumerable: true,
      value: forgedDerivationReplayEvidence(fixture).scope,
    });
    const exact = forgedDerivationReplayEvidence(fixture);
    const symbolEvidence = Object.assign(Object.create(null), exact, {
      [Symbol("hidden-authority")]: true,
    });
    const hostileEvidence = [
      new Proxy(Object.create(null), {
        getPrototypeOf: () => {
          throw new Error("hostile_get_prototype_of");
        },
      }),
      accessorEvidence,
      symbolEvidence,
    ];

    for (const evidence of hostileEvidence) {
      const result = await replayNhm2SemiclassicalV2Run(
        fixture.input,
        evidence as never,
      );
      expect(result.verificationState).toBe(
        "bounded_filesystem_snapshots_replayed",
      );
      if (result.verificationState !== "bounded_filesystem_snapshots_replayed")
        continue;
      expect(result.replay.blockers).toEqual([
        "metric_demand_derivation_executor_provenance_unverified",
        "interval_trace_not_server_replayed",
      ]);
      expect(result.claimLocks.theoryGraphNoiseKernelLampPromotable).toBe(
        false,
      );
      expect(result.claimLocks.physicalViabilityEstablished).toBe(false);
    }
    expect(getterInvoked).toBe(false);
  });

  it("preserves an honestly replayed frozen-limit failure with full provenance instead of inviting retuning", async () => {
    const fixture = await buildFixture({ meanDemandFailure: true });
    const result = await replayNhm2SemiclassicalV2Run(fixture.input);

    expect(result.verificationState).toBe(
      "bounded_filesystem_snapshots_replayed",
    );
    if (result.verificationState !== "bounded_filesystem_snapshots_replayed")
      return;
    expect(result.calculationDisposition).toBe("blocked");
    expect(result.candidateDisposition).toBe("blocked");
    expect(result.replay.status).toBe("blocked");
    expect(result.replay.blockers).toContain(
      "mean_metric_demand_closure_exceeds_tolerance",
    );
    expect(result.replay.metrics.meanMetricDemandClosure).toMatchObject({
      passingSampleCount: 0,
      allSamplesWithinTolerance: false,
    });
    expect(
      result.replay.metrics.meanMetricDemandClosure
        ?.maximumPointwiseRelativeUpper95,
    ).toBeCloseTo(1, 12);
    expect(result.provenance.files).toHaveLength(59);
    expect(result.violations).toEqual([]);
    expect(
      result.claimLocks.independentImplementationAgreementEstablished,
    ).toBe(false);
    expect(result.claimLocks.theoryGraphNoiseKernelLampPromotable).toBe(false);
    expect(result.claimLocks.theoryGraphConstraintAlgebraLampPromotable).toBe(
      false,
    );
    expect(result.claimLocks.physicalViabilityEstablished).toBe(false);
  });

  it("rejects a producer-pretty-printed manifest even when its new hash and size are trusted", async () => {
    const fixture = await buildFixture();
    const prettyBytes = Buffer.from(
      JSON.stringify(fixture.manifest, null, 2),
      "utf8",
    );
    const input = cloneInput(fixture.input);
    (input.manifest as { bytes: Buffer }).bytes = prettyBytes;
    (input.manifest as { sha256: string }).sha256 = sha256(prettyBytes);
    (input.manifest as { sizeBytes: number }).sizeBytes =
      prettyBytes.byteLength;

    const result = await replayNhm2SemiclassicalV2Run(input);
    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]?.code).toBe("manifest_json_not_canonical");
  });

  it("fails exact trusted execution cross-binding before reading producer files", async () => {
    const fixture = await buildFixture();
    const input = cloneInput(fixture.input);
    (input.trusted.execution as { command: string }).command = "retuned-solver";

    const result = await replayNhm2SemiclassicalV2Run(input);
    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]?.code).toBe("trusted_run_binding_mismatch");
  });

  it("rejects missing or retuned trusted scientific-preseal bindings without granting seal authority", async () => {
    const fixture = await buildFixture();

    const missing = cloneInput(fixture.input) as unknown as {
      trusted: Record<string, unknown>;
    };
    delete missing.trusted.scientificPresealBinding;
    const missingResult = await replayNhm2SemiclassicalV2Run(
      missing as unknown as Nhm2SemiclassicalV2RunReplayerInput,
    );
    expect(missingResult.verificationState).toBe("blocked");
    expect(missingResult.violations[0]?.code).toBe("replayer_input_invalid");

    for (const mutate of [
      (input: Nhm2SemiclassicalV2RunReplayerInput) => {
        (
          input.trusted.scientificPresealBinding as {
            sealedInventorySha256: string;
          }
        ).sealedInventorySha256 = sha256("retuned-sealed-inventory");
      },
      (input: Nhm2SemiclassicalV2RunReplayerInput) => {
        (
          input.trusted.scientificPresealBinding as { sealKey: string }
        ).sealKey = sha256("retuned-seal-key");
      },
      (input: Nhm2SemiclassicalV2RunReplayerInput) => {
        const original = Date.parse(
          input.trusted.scientificPresealBinding.sealedAt,
        );
        (
          input.trusted.scientificPresealBinding as { sealedAt: string }
        ).sealedAt = new Date(original + 1).toISOString();
      },
    ]) {
      const input = cloneInput(fixture.input);
      mutate(input);
      const result = await replayNhm2SemiclassicalV2Run(input);
      expect(result.verificationState).toBe("blocked");
      expect(result.violations[0]?.code).toBe("trusted_run_binding_mismatch");
      expect(result.claimLocks.preexecutionScientificInputSealVerified).toBe(
        false,
      );
    }
  });

  it("rejects an output whose metadata proves it predates the trusted execution", async () => {
    const fixture = await buildFixture();
    const stale = new Date(
      Date.parse(fixture.manifest.execution.startedAt) - 60_000,
    );
    await fs.utimes(fixture.firstArrayPath, stale, stale);

    const result = await replayNhm2SemiclassicalV2Run(fixture.input);
    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]?.code).toBe(
      "output_freshness_outside_execution_interval",
    );
  });

  it("fails closed on nonfinite raw Float64 output before scientific replay", async () => {
    const fixture = await buildFixture({ nonfiniteNoise: true });
    const result = await replayNhm2SemiclassicalV2Run(fixture.input);

    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]).toMatchObject({
      code: "secure_filesystem_read_failed",
    });
    expect(result.violations[0]?.detail).toContain("output_float64_non_finite");
  });

  it("rejects an undeclared output file because the run-owned inventory must be exact", async () => {
    const fixture = await buildFixture();
    await fs.writeFile(
      path.join(fixture.outputRoot, "producer-debug.log"),
      "extra",
    );

    const result = await replayNhm2SemiclassicalV2Run(fixture.input);
    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]).toMatchObject({
      code: "secure_filesystem_read_failed",
    });
    expect(result.violations[0]?.detail).toContain("output_inventory_mismatch");
  });

  it("rejects a trailing byte appended after the trusted array size and hash were bound", async () => {
    const fixture = await buildFixture();
    await fs.appendFile(fixture.firstArrayPath, Buffer.from([0]));

    const result = await replayNhm2SemiclassicalV2Run(fixture.input);
    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]).toMatchObject({
      code: "secure_filesystem_read_failed",
    });
    expect(result.violations[0]?.detail).toContain("output_size_mismatch");
  });

  it("rejects a trusted interval whose exact duration does not match its endpoints", async () => {
    const fixture = await buildFixture();
    const input = cloneInput(fixture.input);
    (input.trusted.execution as { durationMs: number }).durationMs += 1;

    const result = await replayNhm2SemiclassicalV2Run(input);
    expect(result.verificationState).toBe("blocked");
    expect(result.violations[0]?.code).toBe(
      "trusted_execution_interval_invalid",
    );
  });

  it("returns a typed blocked result for malformed nested trusted bindings", async () => {
    const fixture = await buildFixture();
    const nullExecution = cloneInput(fixture.input) as unknown as {
      trusted: { execution: unknown };
    };
    nullExecution.trusted.execution = null;
    const nullResult = await replayNhm2SemiclassicalV2Run(
      nullExecution as unknown as Nhm2SemiclassicalV2RunReplayerInput,
    );
    expect(nullResult.verificationState).toBe("blocked");
    expect(nullResult.violations[0]?.code).toBe("replayer_input_invalid");

    const numericRoot = cloneInput(fixture.input) as unknown as {
      trusted: { roots: { scientific: unknown } };
    };
    numericRoot.trusted.roots.scientific = 7;
    const rootResult = await replayNhm2SemiclassicalV2Run(
      numericRoot as unknown as Nhm2SemiclassicalV2RunReplayerInput,
    );
    expect(rootResult.verificationState).toBe("blocked");
    expect(rootResult.violations[0]?.code).toBe("replayer_input_invalid");
  });
});
