import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_PRIMARY_RAW_CONTENT_POLICY_ARTIFACT_ID,
  NHM2_PRIMARY_RAW_CONTENT_POLICY_CONTRACT_VERSION,
  NHM2_PRIMARY_RAW_OBSERVABLE_UNIT_BY_ID,
  NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS,
} from "../../../../shared/contracts/nhm2-primary-raw-content-policy.v1";
import {
  NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256,
  NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_ARTIFACT_ID,
  NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_CONTRACT_VERSION,
  type Nhm2PrimaryRawOutputFileV1,
  type Nhm2PrimaryRawOutputManifestV1,
} from "../../../../shared/contracts/nhm2-primary-raw-output-manifest.v1";
import {
  NHM2_PREDICTION_RUN1_BINDING_SET_ARTIFACT_ID,
  NHM2_PREDICTION_RUN1_BINDING_SET_CONTRACT_VERSION,
  NHM2_PREDICTION_RUN1_BOOTSTRAP_STATUS,
  NHM2_PREDICTION_RUN1_CLAIM_BOUNDARY,
  NHM2_PREDICTION_RUN1_OPERATOR_NORMALIZATION_EQUATION_ID,
  NHM2_PREDICTION_RUN1_UNIT_DIMENSION_REGISTRY_ARTIFACT_ID,
  NHM2_PREDICTION_RUN1_UNIT_DIMENSION_REGISTRY_CONTRACT_VERSION,
  NHM2_PREDICTION_RUN1_UNIT_DIMENSION_REGISTRY_SHA256,
  canonicalizeNhm2PredictionRun1Json,
  isNhm2PredictionRun1BootstrapArtifactV2,
  sha256Nhm2PredictionRun1Bytes,
  type Nhm2PredictionRun1BindingSetV2,
} from "../../../../shared/contracts/nhm2-prediction-run1-bootstrap.v2";
import {
  THEORY_RUNTIME_RECEIPT_ARTIFACT_ID,
  THEORY_RUNTIME_RECEIPT_SCHEMA_VERSION,
  type TheoryRuntimeReceiptV1,
} from "../../../../shared/contracts/theory-runtime-receipt.v1";
import type { Nhm2PrimaryRawOutputFilesystemVerification } from "../nhm2-primary-raw-output-filesystem-verifier";
import {
  NHM2_PRIMARY_RAW_MATERIAL_DYNAMICS_REPLAY_CONTRACT_VERSION,
  type Nhm2PrimaryRawMaterialDynamicsReplayResult,
} from "../nhm2-primary-raw-material-dynamics-content-replay";
import {
  Nhm2PredictionRun1BootstrapPublicationError,
  bindNhm2PredictionRun1ReceiptStore,
  compileNhm2PredictionRun1BootstrapV2,
  publishNhm2PredictionRun1BootstrapV2,
  type Nhm2PredictionRun1BootstrapCompilerInput,
} from "../nhm2-prediction-run1-bootstrap-compiler";
import {
  buildTheoryRuntimeFreshnessProof,
  classifyTheoryRuntimeArtifacts,
  snapshotTheoryRuntimeOutput,
  writeTheoryRuntimeOutputManifest,
  writeTheoryRuntimePreSpawnSnapshotCommitment,
} from "../runtime-artifact-manifest";
import {
  writeTheoryRuntimeReceiptArtifact,
  type TheoryRuntimePersistedReceiptRefV1,
} from "../theory-runtime-receipt-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true }).catch(() => undefined),
      ),
  );
});

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const floatBytes = (values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  return bytes;
};

const recordBytes = (records: readonly Record<string, unknown>[]): Buffer =>
  Buffer.from(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );

const iso = (milliseconds: number): string =>
  new Date(milliseconds).toISOString();

type Fixture = {
  projectRoot: string;
  root: string;
  sourcePaths: string[];
  rawVerification: Extract<
    Nhm2PrimaryRawOutputFilesystemVerification,
    { verified: true }
  >;
  replay: Nhm2PrimaryRawMaterialDynamicsReplayResult;
  receipt: TheoryRuntimeReceiptV1;
  receiptArtifact: TheoryRuntimePersistedReceiptRefV1;
  bindingSet: Nhm2PredictionRun1BindingSetV2;
  bindingBytes: Buffer;
  input: Nhm2PredictionRun1BootstrapCompilerInput;
};

const replayClosureSha256 = (payload: unknown): string =>
  createHash("sha256")
    .update("nhm2-primary-raw-material-dynamics-file-closure/v1\n")
    .update(canonicalizeNhm2PredictionRun1Json(payload))
    .digest("hex");

const makeCanonicalBytes = (value: unknown): Buffer =>
  Buffer.from(canonicalizeNhm2PredictionRun1Json(value), "utf8");

const makeReceiptBytes = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

const buildFixture = async (): Promise<Fixture> => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-prediction-run1-v2-"),
  );
  roots.push(projectRoot);
  const root = path.join(projectRoot, "artifacts", "run-source-1");
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  const now = Date.now();
  const before = await snapshotTheoryRuntimeOutput({
    projectRoot,
    outputDirectory: realRoot,
  });
  const beforeCommitment = await writeTheoryRuntimePreSpawnSnapshotCommitment({
    projectRoot,
    requestId: "request-source-run-1",
    runtimeId: "warp.full_solve.campaign",
    outputDirectory: realRoot,
    beforeCapturedAt: iso(now),
    gitSha: "a".repeat(40),
    sourceTreeSha256: "f".repeat(64),
    worktreeClean: true,
    before,
  });
  const startedMs = Date.parse(beforeCommitment.committedAt) + 1_000;
  const startedAt = iso(startedMs);
  const completedAt = iso(startedMs + 120_000);
  const bindingGeneratedAt = iso(startedMs + 122_000);
  const bindingFrozenAt = iso(startedMs + 125_000);
  const generatedAt = iso(startedMs + 130_000);
  const frozenAt = iso(startedMs + 140_000);
  const plannedStartAt = iso(startedMs + 160_000);
  const freshFileTime = new Date(startedMs + 500);
  const targetTimes = NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map((_, index) =>
    iso(startedMs + 170_000 + index * 1_000),
  );
  const descriptors: Nhm2PrimaryRawOutputFileV1[] = [];
  const verifiedFiles: Array<
    Extract<
      Nhm2PrimaryRawOutputFilesystemVerification,
      { verified: true }
    >["files"][number]
  > = [];

  const writeNumerical = async (input: {
    fileId: string;
    familyId: string;
    semanticRole: string;
    unit: string;
    componentOrder: string[];
    rows: number;
    values: number[];
  }): Promise<Nhm2PrimaryRawOutputFileV1> => {
    const relativePath = `raw/${input.fileId}.f64`;
    const absolutePath = path.join(realRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const bytes = floatBytes(input.values);
    await fs.writeFile(absolutePath, bytes, { flag: "wx" });
    await fs.utimes(absolutePath, freshFileTime, freshFileTime);
    const stat = await fs.lstat(absolutePath);
    const descriptor = {
      fileId: input.fileId,
      familyId: input.familyId,
      semanticRole: input.semanticRole,
      path: relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      mediaType: "application/octet-stream",
      representation: {
        kind: "numerical_array",
        dtype: "float64",
        encoding: "raw_ieee754",
        endianness: "little",
        shape: [input.rows, input.componentOrder.length],
        storageOrder: "row-major",
        componentOrder: input.componentOrder,
        unit: input.unit,
      },
    } as Nhm2PrimaryRawOutputFileV1;
    descriptors.push(descriptor);
    verifiedFiles.push({
      kind: "numerical_array",
      descriptor,
      absolutePath,
      observedSha256: descriptor.sha256,
      observedSizeBytes: descriptor.sizeBytes,
      observedMtimeMs: stat.mtimeMs,
      observedCtimeMs: stat.ctimeMs,
      values: new Float64Array(input.values),
    });
    return descriptor;
  };

  const writeRecords = async (input: {
    fileId: string;
    semanticRole: string;
    records: Record<string, unknown>[];
    fields: Array<{
      name: string;
      type: "string" | "int64" | "float64" | "timestamp_iso8601" | "sha256";
      unit: string | null;
    }>;
  }): Promise<Nhm2PrimaryRawOutputFileV1> => {
    const relativePath = `raw/${input.fileId}.ndjson`;
    const absolutePath = path.join(realRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const bytes = recordBytes(input.records);
    await fs.writeFile(absolutePath, bytes, { flag: "wx" });
    await fs.utimes(absolutePath, freshFileTime, freshFileTime);
    const stat = await fs.lstat(absolutePath);
    const descriptor = {
      fileId: input.fileId,
      familyId: "observable_projection",
      semanticRole: input.semanticRole,
      path: relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      mediaType: "application/x-ndjson",
      representation: {
        kind: "records",
        format: "ndjson",
        encoding: "utf8",
        recordMode: "record-stream",
        recordCount: input.records.length,
        schema: {
          schemaId: `nhm2_test_${input.semanticRole}`,
          schemaVersion: `nhm2_test_${input.semanticRole}/v1`,
          primaryKey: [],
          fields: input.fields.map((field) => ({ ...field, nullable: false })),
        },
      },
    } as Nhm2PrimaryRawOutputFileV1;
    descriptors.push(descriptor);
    verifiedFiles.push({
      kind: "records",
      descriptor,
      absolutePath,
      observedSha256: descriptor.sha256,
      observedSizeBytes: descriptor.sizeBytes,
      observedMtimeMs: stat.mtimeMs,
      observedCtimeMs: stat.ctimeMs,
      records: input.records,
    });
    return descriptor;
  };

  const sourceSpecs = [
    {
      familyId: "semiclassical_state",
      semanticRole: "mode_tensor_contribution_components",
      unit: "J/m^3",
      components: [
        "t00",
        "t01",
        "t02",
        "t03",
        "t11",
        "t12",
        "t13",
        "t22",
        "t23",
        "t33",
      ],
    },
    {
      familyId: "finite_temperature_finite_geometry_maxwell_stress",
      semanticRole: "electric_green_dyadic_components",
      unit: "candidate_normalized",
      components: Array.from({ length: 18 }, (_, index) => `g${index}`),
    },
    {
      familyId: "dynamic_backreaction_stability_causality",
      semanticRole: "evolved_geometry_components",
      unit: "candidate_normalized",
      components: Array.from({ length: 20 }, (_, index) => `geometry_${index}`),
    },
    {
      familyId: "mechanical_support_control_margin",
      semanticRole: "load_vector_components",
      unit: "N",
      components: ["x", "y", "z"],
    },
    {
      familyId: "dynamic_backreaction_stability_causality",
      semanticRole: "gauge_field_components",
      unit: "candidate_normalized",
      components: ["c0", "c1", "c2", "c3"],
    },
    {
      familyId: "dynamic_backreaction_stability_causality",
      semanticRole: "characteristic_ray_samples",
      unit: "candidate_normalized",
      components: [
        "affine_parameter",
        "t",
        "x",
        "y",
        "z",
        "frequency",
        "expansion",
      ],
    },
  ];
  const sourceDescriptors: Nhm2PrimaryRawOutputFileV1[] = [];
  for (const [index, spec] of sourceSpecs.entries()) {
    sourceDescriptors.push(
      await writeNumerical({
        fileId: `source_${index}`,
        familyId: spec.familyId,
        semanticRole: spec.semanticRole,
        unit: spec.unit,
        componentOrder: spec.components,
        rows: 1,
        values: [index + 1, ...new Array(spec.components.length - 1).fill(0)],
      }),
    );
  }
  const definitions = NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map(
    (observableId, index) => ({
      observable_id: observableId,
      target_time: targetTimes[index],
      unit: NHM2_PRIMARY_RAW_OBSERVABLE_UNIT_BY_ID[observableId],
      projection_id: `projection_${index}`,
    }),
  );
  const definitionDescriptor = await writeRecords({
    fileId: "observable_definitions",
    semanticRole: "observable_definition_records",
    records: definitions,
    fields: [
      { name: "observable_id", type: "string", unit: null },
      { name: "target_time", type: "timestamp_iso8601", unit: null },
      { name: "unit", type: "string", unit: null },
      { name: "projection_id", type: "string", unit: null },
    ],
  });
  const derivationDescriptor = await writeRecords({
    fileId: "projection_derivations",
    semanticRole: "projection_derivation_inputs",
    records: NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map(
      (observableId, index) => ({
        input_id: `input_${index}`,
        observable_id: observableId,
        source_file_id: sourceDescriptors[index]!.fileId,
        source_sha256: sourceDescriptors[index]!.sha256,
      }),
    ),
    fields: [
      { name: "input_id", type: "string", unit: null },
      { name: "observable_id", type: "string", unit: null },
      { name: "source_file_id", type: "string", unit: null },
      { name: "source_sha256", type: "sha256", unit: null },
    ],
  });
  const operatorDescriptor = await writeRecords({
    fileId: "projection_operators",
    semanticRole: "projection_operator_entries",
    records: NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map(
      (observableId, index) => ({
        observable_id: observableId,
        source_index: String(index),
        coefficient: 2,
      }),
    ),
    fields: [
      { name: "observable_id", type: "string", unit: null },
      { name: "source_index", type: "int64", unit: null },
      { name: "coefficient", type: "float64", unit: "candidate_normalized" },
    ],
  });
  const projectionSourceDescriptor = await writeNumerical({
    fileId: "projection_source_values",
    familyId: "observable_projection",
    semanticRole: "projection_source_values",
    unit: "candidate_normalized",
    componentOrder: ["value"],
    rows: 6,
    values: [1, 2, 3, 4, 5, 6],
  });
  const jacobianDescriptor = await writeNumerical({
    fileId: "projection_jacobian",
    familyId: "observable_projection",
    semanticRole: "projection_jacobian_components",
    unit: "candidate_normalized",
    componentOrder: ["value"],
    rows: 6,
    values: [2, 2, 2, 2, 2, 2],
  });
  const uncertaintyValues = [1, 2, 3, 4, 5, 6].flatMap((central) => [
    central - 0.1,
    central,
    central + 0.1,
  ]);
  const uncertaintyDescriptor = await writeNumerical({
    fileId: "projection_uncertainty",
    familyId: "observable_projection",
    semanticRole: "projection_uncertainty_samples",
    unit: "candidate_normalized",
    componentOrder: ["lower95", "central", "upper95"],
    rows: 6,
    values: uncertaintyValues,
  });

  expect(definitionDescriptor.fileId).toBe("observable_definitions");
  expect(derivationDescriptor.fileId).toBe("projection_derivations");
  expect(projectionSourceDescriptor.fileId).toBe("projection_source_values");
  expect(jacobianDescriptor.fileId).toBe("projection_jacobian");

  descriptors.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );
  verifiedFiles.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.descriptor.path),
      Buffer.from(right.descriptor.path),
    ),
  );
  const manifest: Nhm2PrimaryRawOutputManifestV1 = {
    artifactId: NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_ARTIFACT_ID,
    contractVersion: NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_CONTRACT_VERSION,
    contentPolicy: {
      artifactId: NHM2_PRIMARY_RAW_CONTENT_POLICY_ARTIFACT_ID,
      contractVersion: NHM2_PRIMARY_RAW_CONTENT_POLICY_CONTRACT_VERSION,
      sha256: NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256,
    },
    generatedAt: completedAt,
    identity: {
      candidateId: "candidate-source-run-1",
      laneId: "nhm2_shift_lapse",
      selectedProfileId: "profile-nhm2-theory-candidate",
      chartId: "chart-same-1",
      candidateManifest: {
        inputId: "candidate_manifest",
        sha256: "1".repeat(64),
      },
      selectedProfile: { inputId: "selected_profile", sha256: "2".repeat(64) },
      chartDefinition: { inputId: "chart_definition", sha256: "3".repeat(64) },
      atlas: { inputId: "layered_ledger_atlas", sha256: "4".repeat(64) },
      units: { inputId: "units_definition", sha256: "5".repeat(64) },
      normalization: {
        inputId: "normalization_definition",
        sha256: "6".repeat(64),
      },
    },
    execution: {
      planRole: "primary_numerical",
      requestId: "request-source-run-1",
      runId: "run-source-1",
      runtimeId: "warp.full_solve.campaign",
      receiptId: "receipt-source-run-1",
      sourceCommitSha: "a".repeat(40),
      solver: {
        solverId: "solver-primary",
        solverVersion: "1.0.0",
        implementationId: "implementation-primary",
        input: { inputId: "solver_artifact", sha256: "7".repeat(64) },
      },
      environment: {
        environmentId: "environment-primary",
        input: { inputId: "environment_lock", sha256: "8".repeat(64) },
      },
      producerBundle: {
        bundleId: "bundle-primary",
        input: { inputId: "producer_bundle", sha256: "9".repeat(64) },
      },
      invocation: {
        command: "primary-solver",
        argv: ["--run", "run-source-1"],
        workingDirectory: realRoot,
      },
      startedAt,
      completedAt,
      durationMs: 120_000,
      deterministicSeed: "seed-001",
      exitCode: 0,
      terminationSignal: null,
    },
    inputClosure: {
      frozenBeforeExecution: true,
      digestAlgorithm: "sha256_canonical_input_inventory_v1",
      ordering: "utf8_path_bytes_ascending",
      entries: [],
      closureSha256: "b".repeat(64),
    },
    familyDag: {
      ordering: "nhm2_primary_raw_family_topological_v1",
      nodes: [],
    },
    fileInventory: {
      ordering: "utf8_path_bytes_ascending",
      files: descriptors,
    },
    claimBoundary: {
      rawOutputEvidenceOnly: true,
      scientificEvaluationExternal: true,
      scientificConclusionEncoded: false,
      theoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedClaimAllowed: false,
      empiricalReceiptsRequired: true,
    },
  };
  const manifestPath = path.join(realRoot, "primary-raw-manifest.json");
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  await fs.writeFile(manifestPath, manifestBytes, { flag: "wx" });
  await fs.utimes(manifestPath, freshFileTime, freshFileTime);
  const manifestSha256 = sha256(manifestBytes);
  const rawVerification = {
    verified: true,
    violations: [],
    runRootRealPath: realRoot,
    manifestPath,
    manifestSha256,
    manifest,
    files: verifiedFiles,
  } as Extract<Nhm2PrimaryRawOutputFilesystemVerification, { verified: true }>;

  const closureFiles = descriptors.map((descriptor) => ({
    familyId: descriptor.familyId,
    semanticRole: descriptor.semanticRole,
    fileId: descriptor.fileId,
    path: descriptor.path,
    sha256: descriptor.sha256,
    sizeBytes: descriptor.sizeBytes,
  }));
  const closurePayload = {
    manifestSha256,
    contentPolicySha256: NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256,
    files: closureFiles,
  };
  const replay = {
    contractVersion: NHM2_PRIMARY_RAW_MATERIAL_DYNAMICS_REPLAY_CONTRACT_VERSION,
    status: "blocked",
    acceptedInput: true,
    inputBlockers: [],
    fileHashClosure: {
      verified: true,
      ...closurePayload,
      closureSha256: replayClosureSha256(closurePayload),
    },
    families: {
      semiclassical: {
        status: "blocked",
        metrics: {},
        comparisonCrossChecks: [],
        breaches: [],
        blockers: ["semiclassical_mode_equation_kernel_unreplayed"],
      },
      maxwell: {
        status: "blocked",
        metrics: {},
        comparisonCrossChecks: [],
        breaches: [],
        blockers: ["finite_geometry_maxwell_green_operator_kernel_unreplayed"],
      },
      mechanics: {
        status: "blocked",
        metrics: {},
        comparisonCrossChecks: [],
        breaches: [],
        blockers: ["nonlinear_fea_constitutive_assembly_unreplayed"],
      },
      dynamics: {
        status: "blocked",
        metrics: {},
        comparisonCrossChecks: [],
        breaches: [],
        blockers: ["bssn_evolution_equations_unresolved"],
      },
      observableProjection: {
        status: "blocked",
        metrics: {
          observableIds: [...NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS],
          sourceValueCount: 6,
          verifiedDerivationSourceBindings:
            NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map(
              (observableId, index) => ({
                observableId,
                sourceFileId: sourceDescriptors[index]!.fileId,
                sourceFamilyId: sourceDescriptors[index]!.familyId,
                sourceSemanticRole: sourceDescriptors[index]!.semanticRole,
                sourceSha256: sourceDescriptors[index]!.sha256,
              }),
            ),
          predictedValues: [2, 4, 6, 8, 10, 12],
          propagatedUncertainty95: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
          dimensionalNormalizationResolved: false,
          comparisonSampleVectorsHaveAuthority: false,
        },
        comparisonCrossChecks: [],
        breaches: [],
        blockers: [
          "observable_projection_source_component_unit_conversion_unresolved",
        ],
      },
    },
    unresolvedKernelBlockers: [
      "semiclassical_mode_equation_kernel_unreplayed",
      "finite_geometry_maxwell_green_operator_kernel_unreplayed",
      "nonlinear_fea_constitutive_assembly_unreplayed",
      "bssn_evolution_equations_unresolved",
      "observable_projection_source_component_unit_conversion_unresolved",
    ],
    claimBoundary: {
      diagnosticReplayOnly: true,
      theoryClosureEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      certifiedSpeedEstablished: false,
      empiricalValidationEstablished: false,
    },
  } as unknown as Nhm2PrimaryRawMaterialDynamicsReplayResult;

  const after = await snapshotTheoryRuntimeOutput({
    projectRoot,
    outputDirectory: realRoot,
  });
  const runtimeEntries = classifyTheoryRuntimeArtifacts({ before, after });
  const runtimeArtifactManifest = await writeTheoryRuntimeOutputManifest({
    projectRoot,
    outputDirectory: realRoot,
    requestId: manifest.execution.requestId,
    runtimeId: manifest.execution.runtimeId,
    gitSha: manifest.execution.sourceCommitSha,
    startedAt,
    completedAt,
    generatedAt: iso(startedMs + 121_000),
    entries: runtimeEntries,
    freshnessProof: buildTheoryRuntimeFreshnessProof({
      before,
      after,
      beforeCapturedAt: iso(now),
      afterCapturedAt: completedAt,
      beforeCommitmentPath: beforeCommitment.path,
      beforeCommitmentSha256: beforeCommitment.sha256,
    }),
  });

  const receipt: TheoryRuntimeReceiptV1 = {
    artifactId: THEORY_RUNTIME_RECEIPT_ARTIFACT_ID,
    schemaVersion: THEORY_RUNTIME_RECEIPT_SCHEMA_VERSION,
    generatedAt: iso(startedMs + 121_000),
    receiptId: manifest.execution.receiptId,
    runtimeId: manifest.execution.runtimeId,
    graphId: "nhm2-primary-run",
    badgeIds: [],
    command: "primary-solver",
    args: {
      requestId: manifest.execution.requestId,
      runId: manifest.execution.runId,
    },
    status: "completed",
    outputs: {
      artifacts: runtimeEntries.map((entry) => entry.path),
      scalars: {},
      units: {},
      gates: { runtime: "pass" },
      missingSignals: [],
      warnings: [],
      artifactManifest: runtimeArtifactManifest,
    },
    provenance: {
      gitSha: manifest.execution.sourceCommitSha,
      startedAt,
      completedAt,
      durationMs: manifest.execution.durationMs,
    },
    execution: {
      command: "primary-solver",
      args: ["--run", manifest.execution.runId],
      cwd: projectRoot,
      environment: {},
      outputDirectory: path.relative(projectRoot, realRoot).replace(/\\/g, "/"),
      outputDirectoryBound: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: null,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "reduced_order",
      promotionAllowed: false,
      promotionBlockedBy: ["experiment_required"],
    },
  };
  const receiptArtifact = await writeTheoryRuntimeReceiptArtifact({
    projectRoot,
    requestId: manifest.execution.requestId,
    receipt,
  });
  const sourceReceiptStoreBinding = await bindNhm2PredictionRun1ReceiptStore({
    projectRoot,
  });

  const bindingSet: Nhm2PredictionRun1BindingSetV2 = {
    artifactId: NHM2_PREDICTION_RUN1_BINDING_SET_ARTIFACT_ID,
    contractVersion: NHM2_PREDICTION_RUN1_BINDING_SET_CONTRACT_VERSION,
    generatedAt: bindingGeneratedAt,
    frozenAt: bindingFrozenAt,
    bindingSetId: "binding-set-source-run-1",
    plannedSourceRun: {
      candidateId: manifest.identity.candidateId,
      selectedProfileId: manifest.identity.selectedProfileId,
      requestId: manifest.execution.requestId,
      runId: manifest.execution.runId,
      runtimeId: manifest.execution.runtimeId,
    },
    model: {
      modelId: "nhm2-observable-projection",
      parameterSetId: "parameters-source-run-1",
      uncertaintyBudgetId: "uncertainty-source-run-1",
    },
    unitDimensionRegistry: {
      artifactId: NHM2_PREDICTION_RUN1_UNIT_DIMENSION_REGISTRY_ARTIFACT_ID,
      contractVersion:
        NHM2_PREDICTION_RUN1_UNIT_DIMENSION_REGISTRY_CONTRACT_VERSION,
      sha256: NHM2_PREDICTION_RUN1_UNIT_DIMENSION_REGISTRY_SHA256,
    },
    observableBindings: NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS.map(
      (observableId, index) => {
        const source = sourceDescriptors[index]!;
        const targetUnit = NHM2_PRIMARY_RAW_OBSERVABLE_UNIT_BY_ID[observableId];
        const sourceUnit =
          source.representation.kind === "numerical_array"
            ? source.representation.unit
            : "invalid";
        const conversionEquation =
          sourceUnit === targetUnit
            ? "identity_unit_conversion/v1"
            : "linear_scale_offset_unit_conversion/v1";
        return {
          observableId,
          projectionId: `projection_${index}`,
          sourceComponent: {
            familyId: source.familyId,
            semanticRole: source.semanticRole,
            fileId: source.fileId,
            sha256: source.sha256,
            rowIndex: 0,
            componentIndex: 0,
            component:
              source.representation.kind === "numerical_array"
                ? source.representation.componentOrder[0]!
                : "invalid",
            sourceUnit,
          },
          operator: {
            fileId: operatorDescriptor.fileId,
            sha256: operatorDescriptor.sha256,
            rowIndex: index,
            sourceIndex: index,
            coefficient: 2,
            coefficientStorageUnit: "candidate_normalized",
            coefficientNormalization: {
              equationId:
                NHM2_PREDICTION_RUN1_OPERATOR_NORMALIZATION_EQUATION_ID,
              equationVersion: "1.0.0",
              inputUnit: "candidate_normalized",
              outputUnit: "1",
              parameters: { scale: 1, offset: 0 },
            },
            coefficientUnit: "1",
          },
          normalization: {
            equationId: "identity_source_normalization/v1",
            equationVersion: "1.0.0",
            inputUnit: sourceUnit,
            outputUnit: sourceUnit,
            parameters: { scale: 1, offset: 0 },
          },
          conversion: {
            equationId: conversionEquation,
            equationVersion: "1.0.0",
            sourceUnit,
            targetUnit,
            parameters: {
              scale: 1,
              offset: 0,
              scaleUnit: `${targetUnit} per ${sourceUnit}`,
              offsetUnit: targetUnit,
            },
          },
          uncertainty: {
            fileId: uncertaintyDescriptor.fileId,
            sha256: uncertaintyDescriptor.sha256,
            rowIndex: index,
            lowerComponent: "lower95",
            centralComponent: "central",
            upperComponent: "upper95",
            sourceUnit: "candidate_normalized",
            targetUnit,
            conversion: {
              equationId: "linear_scale_offset_unit_conversion/v1",
              equationVersion: "1.0.0",
              sourceUnit: "candidate_normalized",
              targetUnit,
              parameters: {
                scale: 1,
                offset: 0,
                scaleUnit: `${targetUnit} per candidate_normalized`,
                offsetUnit: targetUnit,
              },
            },
            propagationEquationId:
              "independent_interval95_linear_propagation/v1",
            propagationEquationVersion: "1.0.0",
            coverageProbability: 0.95,
            correlationAssumption: "independent_terms",
          },
        };
      },
    ),
    claimBoundary: { ...NHM2_PREDICTION_RUN1_CLAIM_BOUNDARY },
  };
  const bindingBytes = makeCanonicalBytes(bindingSet);
  const input: Nhm2PredictionRun1BootstrapCompilerInput = {
    rawVerification,
    materialDynamicsReplay: replay,
    sourceReceiptStoreBinding,
    bindingSet: {
      bytes: bindingBytes,
      expectedSha256: sha256(bindingBytes),
    },
    generatedAt,
    frozenAt,
    bootstrapId: "nhm2-run1-bootstrap-001",
    targetRunReservation: {
      candidateId: "candidate-target-run-2",
      manifestId: "manifest-target-run-2",
      requestId: "request-target-run-2",
      runId: "run-target-2",
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      plannedStartAt,
    },
  };
  return {
    projectRoot,
    root: realRoot,
    sourcePaths: sourceDescriptors.map((descriptor) =>
      path.join(realRoot, ...descriptor.path.split("/")),
    ),
    rawVerification,
    replay,
    receipt,
    receiptArtifact,
    bindingSet,
    bindingBytes,
    input,
  };
};

const replaceBinding = (
  fixture: Fixture,
  value: unknown,
): Nhm2PredictionRun1BootstrapCompilerInput => {
  const bytes = makeCanonicalBytes(value);
  return {
    ...fixture.input,
    bindingSet: { bytes, expectedSha256: sha256(bytes) },
  };
};

const overwritePersistedReceipt = async (
  fixture: Fixture,
  value: unknown,
): Promise<void> => {
  const bytes = makeReceiptBytes(value);
  await fs.writeFile(
    path.join(fixture.projectRoot, ...fixture.receiptArtifact.path.split("/")),
    bytes,
  );
};

describe("NHM2 run-1 frozen-prediction bootstrap compiler v2", () => {
  it("keeps current v1 raw output not_ready at the dimensional-conversion blocker", async () => {
    const fixture = await buildFixture();
    const result = await compileNhm2PredictionRun1BootstrapV2({
      ...fixture.input,
      bindingSet: null,
    });

    expect(result).toEqual({
      status: "not_ready",
      blockers: [
        "observable_projection_source_component_unit_conversion_unresolved",
      ],
      artifact: null,
    });
  });

  it("recomputes and freezes exactly six ordered observables with no target receipt", async () => {
    const fixture = await buildFixture();
    const result = await compileNhm2PredictionRun1BootstrapV2(fixture.input);

    expect(result.status).toBe(NHM2_PREDICTION_RUN1_BOOTSTRAP_STATUS);
    if (result.artifact == null) throw new Error(result.blockers.join(","));
    expect(isNhm2PredictionRun1BootstrapArtifactV2(result.artifact)).toBe(true);
    expect(
      result.artifact.predictionSet.entries.map((entry) => entry.observableId),
    ).toEqual(NHM2_PRIMARY_RAW_REQUIRED_OBSERVABLE_IDS);
    expect(
      result.artifact.predictionSet.entries.map((entry) => entry.centralValue),
    ).toEqual([2, 4, 6, 8, 10, 12]);
    expect(result.artifact.targetRunReservation.receipt).toBeNull();
    expect(result.artifact.claimBoundary).toEqual(
      NHM2_PREDICTION_RUN1_CLAIM_BOUNDARY,
    );
  });

  it("rejects copied or forged replay predictions instead of trusting them", async () => {
    const fixture = await buildFixture();
    const replay = structuredClone(fixture.replay);
    replay.families.observableProjection.metrics.predictedValues[0] = 999;
    const result = await compileNhm2PredictionRun1BootstrapV2({
      ...fixture.input,
      materialDynamicsReplay: replay,
    });

    expect(result.status).toBe("not_ready");
    expect(result.blockers).toContain(
      "material_dynamics_replay_observable_metrics_mismatch",
    );
  });

  it("reopens source bytes and ignores caller-paired receipt bytes and hashes", async () => {
    const reopenedFixture = await buildFixture();
    const inMemorySource = reopenedFixture.rawVerification.files.find(
      (file) => file.descriptor.fileId === "source_0",
    );
    if (inMemorySource?.kind !== "numerical_array")
      throw new Error("source fixture missing");
    inMemorySource.values[0] = 999;
    const reopened = await compileNhm2PredictionRun1BootstrapV2(
      reopenedFixture.input,
    );
    if (reopened.artifact == null) throw new Error(reopened.blockers.join(","));
    expect(reopened.artifact.predictionSet.entries[0]?.centralValue).toBe(2);

    const receiptFixture = await buildFixture();
    const forgedCallerPair = {
      ...receiptFixture.input,
      sourceReceipt: {
        bytes: Buffer.from('{"status":"completed"}'),
        expectedSha256: "f".repeat(64),
      },
    } as Nhm2PredictionRun1BootstrapCompilerInput & {
      sourceReceipt: { bytes: Uint8Array; expectedSha256: string };
    };
    const forgedReceiptHash =
      await compileNhm2PredictionRun1BootstrapV2(forgedCallerPair);
    expect(forgedReceiptHash.status).toBe(
      NHM2_PREDICTION_RUN1_BOOTSTRAP_STATUS,
    );

    const clonedBinding = await compileNhm2PredictionRun1BootstrapV2({
      ...receiptFixture.input,
      sourceReceiptStoreBinding: {
        ...receiptFixture.input.sourceReceiptStoreBinding!,
      },
    });
    expect(clonedBinding).toEqual({
      status: "not_ready",
      blockers: ["source_runtime_receipt_store_binding_unverified"],
      artifact: null,
    });
  });

  it("rejects unknown conversion equations and explicit unit mismatches", async () => {
    const unknownFixture = await buildFixture();
    const unknown = structuredClone(
      unknownFixture.bindingSet,
    ) as unknown as Record<string, unknown>;
    const unknownBindings = unknown.observableBindings as Array<
      Record<string, unknown>
    >;
    (unknownBindings[0]!.conversion as Record<string, unknown>).equationId =
      "unknown_conversion/v99";
    const unknownResult = await compileNhm2PredictionRun1BootstrapV2(
      replaceBinding(unknownFixture, unknown),
    );
    expect(unknownResult.status).toBe("not_ready");
    expect(
      unknownResult.blockers.some((entry) =>
        entry.includes("binding_set_invalid"),
      ),
    ).toBe(true);

    const unitFixture = await buildFixture();
    const mismatch = structuredClone(
      unitFixture.bindingSet,
    ) as unknown as Record<string, unknown>;
    const mismatchBindings = mismatch.observableBindings as Array<
      Record<string, unknown>
    >;
    (
      mismatchBindings[0]!.sourceComponent as Record<string, unknown>
    ).sourceUnit = "Pa";
    const mismatchResult = await compileNhm2PredictionRun1BootstrapV2(
      replaceBinding(unitFixture, mismatch),
    );
    expect(mismatchResult.status).toBe("not_ready");
  });

  it("requires governed dimensional composition for conversions and coefficients", async () => {
    const conversionFixture = await buildFixture();
    const arbitrary = structuredClone(
      conversionFixture.bindingSet,
    ) as unknown as Record<string, unknown>;
    const arbitraryBindings = arbitrary.observableBindings as Array<
      Record<string, unknown>
    >;
    const first = arbitraryBindings[0]!;
    (first.sourceComponent as Record<string, unknown>).sourceUnit = "N";
    const normalization = first.normalization as Record<string, unknown>;
    normalization.inputUnit = "N";
    normalization.outputUnit = "N";
    const conversion = first.conversion as Record<string, unknown>;
    conversion.sourceUnit = "N";
    const parameters = conversion.parameters as Record<string, unknown>;
    parameters.scaleUnit = "J/m^3 per N";
    const arbitraryResult = await compileNhm2PredictionRun1BootstrapV2(
      replaceBinding(conversionFixture, arbitrary),
    );
    expect(arbitraryResult.status).toBe("not_ready");
    expect(arbitraryResult.blockers).toContain(
      "binding_set_invalid:binding_set_exact_six_bindings_invalid",
    );

    const coefficientFixture = await buildFixture();
    const nonDimensionless = structuredClone(
      coefficientFixture.bindingSet,
    ) as unknown as Record<string, unknown>;
    const coefficientBindings = nonDimensionless.observableBindings as Array<
      Record<string, unknown>
    >;
    const operator = coefficientBindings[0]!.operator as Record<
      string,
      unknown
    >;
    operator.coefficientUnit = "candidate_normalized";
    const coefficientResult = await compileNhm2PredictionRun1BootstrapV2(
      replaceBinding(coefficientFixture, nonDimensionless),
    );
    expect(coefficientResult.status).toBe("not_ready");
    expect(coefficientResult.blockers).toContain(
      "binding_set_invalid:binding_set_exact_six_bindings_invalid",
    );
  });

  it("rejects immutable-receipt substitution by a different receipt identity", async () => {
    const fixture = await buildFixture();
    const substituted = structuredClone(fixture.receipt);
    substituted.receiptId = "receipt-substituted";
    await overwritePersistedReceipt(fixture, substituted);

    const result = await compileNhm2PredictionRun1BootstrapV2(fixture.input);

    expect(result.status).toBe("not_ready");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^source_runtime_receipt_store_resolution_failed:/,
        ),
        "source_runtime_receipt_immutable_artifact_missing",
      ]),
    );
  });

  it("rejects preexisting receipt evidence and stale source timestamps", async () => {
    const preexistingFixture = await buildFixture();
    const receipt = structuredClone(preexistingFixture.receipt);
    receipt.outputs.artifactManifest!.entries[1]!.freshness = "preexisting";
    await overwritePersistedReceipt(preexistingFixture, receipt);
    const preexisting = await compileNhm2PredictionRun1BootstrapV2(
      preexistingFixture.input,
    );
    expect(preexisting.status).toBe("not_ready");
    expect(
      preexisting.blockers.some((entry) =>
        entry.startsWith("source_runtime_receipt_file_freshness_not_new:"),
      ),
    ).toBe(true);

    const staleFixture = await buildFixture();
    const stalePath = staleFixture.sourcePaths[0]!;
    const stale = new Date(
      Date.parse(staleFixture.rawVerification.manifest.execution.startedAt) -
        60_000,
    );
    await fs.utimes(stalePath, stale, stale);
    const staleResult = await compileNhm2PredictionRun1BootstrapV2(
      staleFixture.input,
    );
    expect(staleResult.status).toBe("not_ready");
    expect(
      staleResult.blockers.some((entry) =>
        entry.startsWith("source_file_freshness_outside_execution_interval:"),
      ),
    ).toBe(true);
  });

  it("rejects source symlinks and hardlinks after filesystem verification", async () => {
    const hardlinkFixture = await buildFixture();
    const target = hardlinkFixture.sourcePaths[0]!;
    const external = path.join(
      path.dirname(hardlinkFixture.root),
      `hardlink-${Date.now()}.f64`,
    );
    roots.push(external);
    await fs.copyFile(target, external);
    await fs.rm(target);
    await fs.link(external, target);
    const hardlinked = await compileNhm2PredictionRun1BootstrapV2(
      hardlinkFixture.input,
    );
    expect(hardlinked.status).toBe("not_ready");
    expect(
      hardlinked.blockers.some((entry) =>
        entry.startsWith("source_file_hardlink_forbidden:"),
      ),
    ).toBe(true);

    const symlinkFixture = await buildFixture();
    const symlinkTarget = symlinkFixture.sourcePaths[0]!;
    const symlinkSource = path.join(
      path.dirname(symlinkFixture.root),
      `symlink-${Date.now()}.f64`,
    );
    roots.push(symlinkSource);
    await fs.copyFile(symlinkTarget, symlinkSource);
    await fs.rm(symlinkTarget);
    try {
      await fs.symlink(symlinkSource, symlinkTarget, "file");
    } catch {
      return;
    }
    const linked = await compileNhm2PredictionRun1BootstrapV2(
      symlinkFixture.input,
    );
    expect(linked.status).toBe("not_ready");
    expect(
      linked.blockers.some((entry) =>
        entry.startsWith("source_file_symlink_or_reparse:"),
      ),
    ).toBe(true);
  });

  it("publishes canonical JSON once and rejects overwrite and path escape", async () => {
    const fixture = await buildFixture();
    const compiled = await compileNhm2PredictionRun1BootstrapV2(fixture.input);
    if (compiled.artifact == null) throw new Error(compiled.blockers.join(","));
    const publicationRoot = path.join(fixture.root, "publication");
    const parent = path.join(publicationRoot, "frozen");
    await fs.mkdir(parent, { recursive: true });
    const published = await publishNhm2PredictionRun1BootstrapV2({
      artifact: compiled.artifact,
      publicationRoot,
      relativePath: "frozen/run1-bootstrap.v2.json",
    });
    const bytes = await fs.readFile(published.absolutePath);
    expect(bytes.toString("utf8")).toBe(
      canonicalizeNhm2PredictionRun1Json(compiled.artifact),
    );
    expect(published.sha256).toBe(sha256Nhm2PredictionRun1Bytes(bytes));
    await expect(
      publishNhm2PredictionRun1BootstrapV2({
        artifact: compiled.artifact,
        publicationRoot,
        relativePath: "frozen/run1-bootstrap.v2.json",
      }),
    ).rejects.toMatchObject({ code: "publication_overwrite_forbidden" });
    await expect(
      publishNhm2PredictionRun1BootstrapV2({
        artifact: compiled.artifact,
        publicationRoot,
        relativePath: "../escape.json",
      }),
    ).rejects.toBeInstanceOf(Nhm2PredictionRun1BootstrapPublicationError);
  });

  it("fails closed on oversized and deeply nested binding JSON", async () => {
    const oversizedFixture = await buildFixture();
    const oversizedBytes = Buffer.from(
      `{"value":"${"x".repeat(2 * 1024 * 1024)}"}`,
    );
    const oversized = await compileNhm2PredictionRun1BootstrapV2({
      ...oversizedFixture.input,
      bindingSet: {
        bytes: oversizedBytes,
        expectedSha256: sha256(oversizedBytes),
      },
    });
    expect(oversized.status).toBe("not_ready");
    expect(oversized.blockers).toContain("binding_set_resource_limit_exceeded");

    const deepFixture = await buildFixture();
    let deep: Record<string, unknown> = {};
    const root: Record<string, unknown> = deep;
    for (let index = 0; index < 40; index += 1) {
      const next: Record<string, unknown> = {};
      deep.next = next;
      deep = next;
    }
    const deepBytes = Buffer.from(JSON.stringify(root));
    const deeplyNested = await compileNhm2PredictionRun1BootstrapV2({
      ...deepFixture.input,
      bindingSet: { bytes: deepBytes, expectedSha256: sha256(deepBytes) },
    });
    expect(deeplyNested.status).toBe("not_ready");
    expect(deeplyNested.blockers).toContain(
      "binding_set_bootstrap_json_resource_limit_exceeded",
    );
  });
});
