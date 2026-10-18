import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY,
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CANONICAL_JSON,
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ID,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-raw-replay-manifest.v1";
import {
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_NONDEGENERACY_CRITERION_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ALGORITHM_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_COVERAGE,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ENCLOSURE_METHOD,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_FORMULA_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_RECEIPT_CLAIM_LOCKS,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_CLAIM_LOCKS,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_KIND,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_PHASE,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS,
  canonicalNhm2SemiclassicalV2ScientificCandidateManifestJson,
  type Nhm2SemiclassicalV2ScientificCandidateManifestV1,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-scientific-candidate-manifest.v1";
import { NHM2_SEMICLASSICAL_TENSOR_COMPONENTS } from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v1";
import {
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_RELATIVE_PATH,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_MAX_PERSISTED_BYTES,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RECEIPT_LOCKS,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RELATIVE_PATH,
  Nhm2SemiclassicalV2ScientificPresealerError,
  hasValidNhm2SemiclassicalV2ScientificPresealServerReceiptIntegrity,
  presealNhm2SemiclassicalV2ScientificCandidate,
  type Nhm2SemiclassicalV2ScientificPresealerErrorCode,
  type PresealNhm2SemiclassicalV2ScientificCandidateInput,
} from "../nhm2-semiclassical-v2-scientific-presealer";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const objectIds: Record<string, string> = {
  geometry: "geometry-frozen-001",
  quantum_state: "quantum-state-frozen-001",
  chart: "chart-frozen-001",
  normalization: "normalization-frozen-001",
  smearing_definition: "smearing-frozen-001",
  sampling_basis: "sampling-basis-frozen-001",
};

const nondegenerateMetricBytes = (): Buffer => {
  const bytes = Buffer.alloc(
    64 * NHM2_SEMICLASSICAL_TENSOR_COMPONENTS.length * 8,
  );
  for (let sample = 0; sample < 64; sample += 1) {
    bytes.writeDoubleLE(2e-12 + sample * 1e-15, sample * 10 * 8);
  }
  return bytes;
};

const positiveMetricErrorBoundBytes = (): Buffer => {
  const bytes = Buffer.alloc(
    64 * NHM2_SEMICLASSICAL_TENSOR_COMPONENTS.length * 8,
  );
  for (let index = 0; index < 640; index += 1) {
    bytes.writeDoubleLE(1e-16, index * 8);
  }
  return bytes;
};

const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

type Fixture = {
  root: string;
  sourceRoot: string;
  workspaceRoot: string;
  outputRoot: string;
  sealedRoot: string;
  candidate: Nhm2SemiclassicalV2ScientificCandidateManifestV1;
  input: PresealNhm2SemiclassicalV2ScientificCandidateInput;
  scienceBytes: Map<string, Buffer>;
};

const writePortableFile = async (
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const target = path.resolve(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
};

const writeCandidate = async (
  fixture: Fixture,
  serialization: "canonical" | "pretty" = "canonical",
): Promise<void> => {
  const text =
    serialization === "canonical"
      ? canonicalNhm2SemiclassicalV2ScientificCandidateManifestJson(
          fixture.candidate,
        )
      : JSON.stringify(fixture.candidate, null, 2);
  await writePortableFile(
    fixture.sourceRoot,
    NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_RELATIVE_PATH,
    Buffer.from(text, "utf8"),
  );
};

const refreshMetricDerivationReceipt = async (
  fixture: Fixture,
): Promise<void> => {
  const entry = (inputId: string) => {
    const found = fixture.candidate.scientificInputs.find(
      (candidateEntry) => candidateEntry.inputId === inputId,
    );
    if (found == null) throw new Error(`Missing ${inputId} fixture entry.`);
    return found;
  };
  const receiptEntry = entry("metric_demand_derivation_receipt");
  const intervalTraceSha256 = digest(Buffer.from("interval-trace", "utf8"));
  const unsigned = {
    artifactId:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
    candidateId: fixture.candidate.candidate.candidateId,
    inputBindings: {
      geometrySha256: entry("geometry").sha256,
      chartSha256: entry("chart").sha256,
      samplingBasisSha256: entry("sampling_basis").sha256,
      smearingDefinitionSha256: entry("smearing_definition").sha256,
      normalizationSha256: entry("normalization").sha256,
      tolerancePolicySha256: entry("tolerance_policy").sha256,
    },
    derivation: {
      formulaId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_FORMULA_ID,
      algorithmId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ALGORITHM_ID,
      enclosureMethod:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ENCLOSURE_METHOD,
      coverage: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_COVERAGE,
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
      intervalTraceSha256,
    },
    implementation: {
      sourceSha256: digest(Buffer.from("metric-source", "utf8")),
      dependencyLockSha256: digest(Buffer.from("metric-lock", "utf8")),
      toolchainArtifactSha256: digest(Buffer.from("metric-toolchain", "utf8")),
      executableSha256: digest(Buffer.from("metric-executable", "utf8")),
    },
    execution: {
      authority: "executor_observed",
      gitCommitSha: "a".repeat(40),
      command: "nhm2-metric-demand-producer",
      argv: ["--frozen-candidate", fixture.candidate.candidate.candidateId],
      startedAt: "2026-08-09T11:59:58.000Z",
      completedAt: "2026-08-09T11:59:59.000Z",
      durationMs: 1000,
      exitCode: 0,
    },
    outputs: {
      centralTensor: {
        inputId: "metric_demand_tensor",
        sha256: entry("metric_demand_tensor").sha256,
        sizeBytes: 5120,
        freshness: "created_or_modified_during_execution",
      },
      deterministicAbsoluteErrorBound: {
        inputId: "metric_demand_absolute_error_bound",
        sha256: entry("metric_demand_absolute_error_bound").sha256,
        sizeBytes: 5120,
        unit: "J/m^3",
        shape: [64, 10],
        componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
        freshness: "created_or_modified_during_execution",
      },
      intervalTrace: {
        sha256: intervalTraceSha256,
        sizeBytes: 1024,
        freshness: "created_or_modified_during_execution",
      },
    },
    verificationStatus:
      "metric_demand_derivation_executor_provenance_unverified",
    claimLocks: { ...NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_RECEIPT_CLAIM_LOCKS },
  } as const;
  const unsignedIntegrity = {
    hashAlgorithm: "sha256" as const,
    canonicalization: "utf8_lexicographic_object_keys_json_v1" as const,
  };
  const receiptSha256 = digest(
    Buffer.from(
      canonicalJson({ ...unsigned, integrity: unsignedIntegrity }),
      "utf8",
    ),
  );
  const receipt = {
    ...unsigned,
    integrity: {
      ...unsignedIntegrity,
      receiptSha256,
    },
  };
  const bytes = Buffer.from(canonicalJson(receipt), "utf8");
  receiptEntry.sha256 = digest(bytes);
  receiptEntry.sizeBytes = bytes.byteLength;
  fixture.scienceBytes.set(receiptEntry.relativePath, bytes);
  await writePortableFile(fixture.sourceRoot, receiptEntry.relativePath, bytes);
};

const replaceMetricBytes = async (
  fixture: Fixture,
  bytes: Buffer,
): Promise<void> => {
  const entry = fixture.candidate.scientificInputs.find(
    (candidateEntry) => candidateEntry.inputId === "metric_demand_tensor",
  );
  if (entry == null) throw new Error("Metric fixture entry missing.");
  entry.sha256 = digest(bytes);
  entry.sizeBytes = bytes.byteLength;
  fixture.scienceBytes.set(entry.relativePath, bytes);
  await writePortableFile(fixture.sourceRoot, entry.relativePath, bytes);
  await refreshMetricDerivationReceipt(fixture);
  await writeCandidate(fixture);
};

const replaceMetricErrorBoundBytes = async (
  fixture: Fixture,
  bytes: Buffer,
): Promise<void> => {
  const entry = fixture.candidate.scientificInputs.find(
    (candidateEntry) =>
      candidateEntry.inputId === "metric_demand_absolute_error_bound",
  );
  if (entry == null)
    throw new Error("Metric error-bound fixture entry missing.");
  entry.sha256 = digest(bytes);
  entry.sizeBytes = bytes.byteLength;
  fixture.scienceBytes.set(entry.relativePath, bytes);
  await writePortableFile(fixture.sourceRoot, entry.relativePath, bytes);
  await refreshMetricDerivationReceipt(fixture);
  await writeCandidate(fixture);
};

const rewriteMetricDerivationReceipt = async (
  fixture: Fixture,
  mutate: (receipt: Record<string, any>) => void,
): Promise<void> => {
  const entry = fixture.candidate.scientificInputs.find(
    (candidateEntry) =>
      candidateEntry.inputId === "metric_demand_derivation_receipt",
  );
  if (entry == null)
    throw new Error("Metric derivation receipt fixture missing.");
  const existing = fixture.scienceBytes.get(entry.relativePath);
  if (existing == null)
    throw new Error("Metric derivation receipt bytes missing.");
  const receipt = JSON.parse(existing.toString("utf8")) as Record<string, any>;
  mutate(receipt);
  const { receiptSha256: _receiptSha256, ...unsignedIntegrity } =
    receipt.integrity as Record<string, unknown>;
  receipt.integrity = {
    ...unsignedIntegrity,
    receiptSha256: digest(
      Buffer.from(
        canonicalJson({ ...receipt, integrity: unsignedIntegrity }),
        "utf8",
      ),
    ),
  };
  const bytes = Buffer.from(canonicalJson(receipt), "utf8");
  entry.sha256 = digest(bytes);
  entry.sizeBytes = bytes.byteLength;
  fixture.scienceBytes.set(entry.relativePath, bytes);
  await writePortableFile(fixture.sourceRoot, entry.relativePath, bytes);
  await writeCandidate(fixture);
};

const buildFixture = async (): Promise<Fixture> => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-v2-scientific-presealer-"),
  );
  temporaryRoots.push(root);
  const sourceRoot = path.join(root, "source-science");
  const workspaceRoot = path.join(root, "server-workspace");
  const outputRoot = path.join(root, "preseal-output");
  const sealedScientificRootDirectory = "sealed/nhm2-v2/candidate-001/science";
  const sealedRoot = path.resolve(
    workspaceRoot,
    ...sealedScientificRootDirectory.split("/"),
  );
  const scienceBytes = new Map<string, Buffer>();
  const metricBytes = nondegenerateMetricBytes();
  const metricErrorBoundBytes = positiveMetricErrorBoundBytes();

  const scientificInputs =
    NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS.map(
      (inputId) => {
        if (inputId === "tolerance_policy") {
          const relativePath = "policy/approved-replay-policy.v1.json";
          const bytes = Buffer.from(
            NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CANONICAL_JSON,
            "utf8",
          );
          scienceBytes.set(relativePath, bytes);
          return {
            inputId,
            relativePath,
            sha256: digest(bytes),
            sizeBytes: bytes.byteLength,
            mediaType: "application/json",
            descriptor: {
              descriptorKind: "approved_replay_policy",
              scientificInputId: inputId,
              artifactId:
                NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ARTIFACT_ID,
              contractVersion:
                NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CONTRACT_VERSION,
              policyId: NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ID,
            },
          };
        }
        if (
          inputId === "metric_demand_tensor" ||
          inputId === "metric_demand_absolute_error_bound"
        ) {
          const relativePath =
            inputId === "metric_demand_tensor"
              ? "metric/metric-demand.float64le.bin"
              : "metric/metric-demand-error-bound.float64le.bin";
          const bytes =
            inputId === "metric_demand_tensor"
              ? metricBytes
              : metricErrorBoundBytes;
          scienceBytes.set(relativePath, bytes);
          return {
            inputId,
            relativePath,
            sha256: digest(bytes),
            sizeBytes: bytes.byteLength,
            mediaType: "application/octet-stream",
            descriptor: {
              descriptorKind:
                inputId === "metric_demand_tensor"
                  ? "metric_demand_tensor_float64"
                  : "metric_demand_absolute_error_bound_float64",
              scientificInputId: inputId,
              dtype: "float64",
              binaryEncoding: "raw_ieee754",
              endianness: "little",
              shape: [64, 10],
              storageOrder: "row-major",
              componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
              unit: "J/m^3",
            },
          };
        }
        if (inputId === "metric_demand_derivation_receipt") {
          const relativePath =
            "metric/metric-demand-derivation-receipt.v1.json";
          const bytes = Buffer.from("{}", "utf8");
          scienceBytes.set(relativePath, bytes);
          return {
            inputId,
            relativePath,
            sha256: digest(bytes),
            sizeBytes: bytes.byteLength,
            mediaType: "application/json",
            descriptor: {
              descriptorKind: "metric_demand_derivation_receipt",
              scientificInputId: inputId,
              artifactId:
                NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
              contractVersion:
                NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
              scientificObjectId: "nhm2-v2-candidate-001",
            },
          };
        }
        const relativePath = `science/${inputId}.v1.json`;
        const bytes = Buffer.from(
          JSON.stringify({ inputId, frozen: true, ordinal: scienceBytes.size }),
          "utf8",
        );
        scienceBytes.set(relativePath, bytes);
        return {
          inputId,
          relativePath,
          sha256: digest(bytes),
          sizeBytes: bytes.byteLength,
          mediaType: "application/json",
          descriptor: {
            descriptorKind: "frozen_scientific_artifact",
            scientificInputId: inputId,
            artifactId: `nhm2.test.${inputId}`,
            contractVersion: "nhm2_test_scientific_artifact/v1",
            scientificObjectId: objectIds[inputId] ?? `${inputId}-frozen-001`,
          },
        };
      },
    ) as Nhm2SemiclassicalV2ScientificCandidateManifestV1["scientificInputs"];

  const candidate: Nhm2SemiclassicalV2ScientificCandidateManifestV1 = {
    artifactId: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_CONTRACT_VERSION,
    phase: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_PHASE,
    candidateFrozenAt: "2026-08-09T12:00:00.000Z",
    candidate: {
      candidateId: "nhm2-v2-candidate-001",
      candidateManifestId: "nhm2-v2-candidate-manifest-001",
      selectedProfileId: "nhm2-nondegenerate-profile-001",
      candidateKind: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_KIND,
      geometryId: objectIds.geometry,
      quantumStateId: objectIds.quantum_state,
      chartId: objectIds.chart,
      normalizationId: objectIds.normalization,
      tolerancePolicyId: NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_ID,
      smearingFunctionId: objectIds.smearing_definition,
      samplingBasisId: objectIds.sampling_basis,
      nondegeneracyCriterionId:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_NONDEGENERACY_CRITERION_ID,
      metricDemandInputId: "metric_demand_tensor",
      metricDemandErrorBoundInputId: "metric_demand_absolute_error_bound",
      metricDemandDerivationWitnessInputId: "metric_demand_derivation_receipt",
      minimumMetricDemandFrobeniusSI:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.minimumMetricDemandFrobeniusSI,
      requiredNondegenerateSampleFraction:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.requiredMetricDemandSampleFraction,
      sampleCount: 64,
    },
    sourceProvenance: {
      sourceMode: "state_derived_not_declared_lever",
      meanRsetOrigin: "renormalized_quantum_state_expectation_value",
      noiseKernelOrigin:
        "connected_symmetrized_quantum_state_two_point_function",
      declaredLeverTensorUsed: false,
      inputClosureExcludesDeclaredLeverTensor: true,
    },
    scientificInputs,
    claimLocks: { ...NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_CLAIM_LOCKS },
  };
  const runPlans: PresealNhm2SemiclassicalV2ScientificCandidateInput["runPlans"] =
    [
      {
        role: "primary",
        planId: "primary-plan-001",
        scientificRootDirectory: sealedScientificRootDirectory,
        scientificRootAccess: "read_only_exact_sealed_inventory",
        implementationRootDirectory: "lanes/primary/toolchain-001",
        outputDirectory: "runs/primary/candidate-001",
        counterpartOutputs: "not_mounted",
        ambientRepository: "not_mounted",
      },
      {
        role: "independent",
        planId: "independent-plan-001",
        scientificRootDirectory: sealedScientificRootDirectory,
        scientificRootAccess: "read_only_exact_sealed_inventory",
        implementationRootDirectory: "lanes/independent/toolchain-001",
        outputDirectory: "runs/independent/candidate-001",
        counterpartOutputs: "not_mounted",
        ambientRepository: "not_mounted",
      },
    ];
  const times = [
    new Date("2026-08-09T12:00:01.000Z"),
    new Date("2026-08-09T12:00:02.000Z"),
  ];
  const fixture: Fixture = {
    root,
    sourceRoot,
    workspaceRoot,
    outputRoot,
    sealedRoot,
    candidate,
    scienceBytes,
    input: {
      candidateManifest: candidate,
      sourceScientificRootDirectory: sourceRoot,
      workspaceDirectory: workspaceRoot,
      sealedScientificRootDirectory,
      presealOutputDirectory: outputRoot,
      runPlans,
      now: () => times.shift() ?? new Date("2026-08-09T12:00:03.000Z"),
    },
  };
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(path.dirname(sealedRoot), { recursive: true });
  await fs.mkdir(outputRoot, { recursive: true });
  await refreshMetricDerivationReceipt(fixture);
  for (const [relativePath, bytes] of scienceBytes) {
    await writePortableFile(sourceRoot, relativePath, bytes);
  }
  await writeCandidate(fixture);
  return fixture;
};

const expectCode = async (
  promise: Promise<unknown>,
  code: Nhm2SemiclassicalV2ScientificPresealerErrorCode,
): Promise<Nhm2SemiclassicalV2ScientificPresealerError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2SemiclassicalV2ScientificPresealerError);
    expect((error as Nhm2SemiclassicalV2ScientificPresealerError).code).toBe(
      code,
    );
    return error as Nhm2SemiclassicalV2ScientificPresealerError;
  }
  throw new Error(`Expected presealer error ${code}.`);
};

describe.sequential("NHM2 semiclassical-v2 scientific presealer", () => {
  it("securely stages, rereads, exclusively persists, and receipts one exact 23-file seal", async () => {
    const fixture = await buildFixture();
    const result = await presealNhm2SemiclassicalV2ScientificCandidate(
      fixture.input,
    );

    expect(result.preseal.stagedInputs).toHaveLength(23);
    expect(result.preseal.stagedInputs.map((entry) => entry.inputId)).toEqual([
      "candidate_manifest",
      ...NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS,
    ]);
    expect(result.preseal).not.toHaveProperty("committedAt");
    expect(result.preseal.metricDemandNondegeneracy).toMatchObject({
      authority: "server_recomputed_from_staged_metric_and_error_float64_bytes",
      observedNondegenerateSampleCount: 64,
      observedNondegenerateSampleFraction: 1,
      allValuesFinite: true,
      passesFrozenScreen: true,
      regionalPhysicalNondegeneracyAuthority: false,
    });
    expect(result.preseal.metricDemandDerivationBinding).toMatchObject({
      metricDemandInputId: "metric_demand_tensor",
      errorBoundInputId: "metric_demand_absolute_error_bound",
      relativeEnclosureTarget: 0.01,
      verificationStatus:
        "metric_demand_derivation_executor_provenance_unverified",
      blockers: [
        "metric_demand_derivation_executor_provenance_unverified",
        "interval_trace_not_server_replayed",
      ],
    });
    expect(result.receipt).toMatchObject({
      authority: "server_observed_persistence_readback",
      persistenceState: "created_exclusively",
      sealedAt: "2026-08-09T12:00:01.000Z",
      persistenceObservedAt: "2026-08-09T12:00:02.000Z",
      locks: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RECEIPT_LOCKS,
    });
    expect(
      Object.values(result.receipt.locks).every((value) => value === false),
    ).toBe(true);
    expect(result.receipt.locks).toMatchObject({
      serverAuthorizedRootLeaseEstablished: false,
      sameUserMutationExclusionEstablished: false,
    });
    expect(result.receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      hasValidNhm2SemiclassicalV2ScientificPresealServerReceiptIntegrity(
        result.receipt,
      ),
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.preseal)).toBe(true);
    expect(Object.isFrozen(result.preseal.stagedInputs)).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.artifact.filesystemIdentity)).toBe(
      true,
    );
    const persistedPath = path.join(
      fixture.outputRoot,
      NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RELATIVE_PATH,
    );
    const persistedBytes = await fs.readFile(persistedPath);
    expect(result.receipt.artifact).toMatchObject({
      absolutePath: persistedPath,
      sha256: digest(persistedBytes),
      sizeBytes: String(persistedBytes.byteLength),
      filesystemIdentity: {
        sizeBytes: String(persistedBytes.byteLength),
      },
    });
    expect(result.receipt.artifact.filesystemIdentity.dev).not.toBe("");
    expect(result.receipt.artifact.filesystemIdentity.ino).not.toBe("");
    const stagedEntries = await fs.readdir(fixture.sealedRoot, {
      recursive: true,
      withFileTypes: true,
    });
    expect(stagedEntries.filter((entry) => entry.isFile())).toHaveLength(23);
  });

  it("allows exact idempotent readback but rejects a different second seal", async () => {
    const fixture = await buildFixture();
    const first = await presealNhm2SemiclassicalV2ScientificCandidate(
      fixture.input,
    );
    fixture.input.now = () => new Date("2026-08-09T12:00:03.000Z");
    const second = await presealNhm2SemiclassicalV2ScientificCandidate(
      fixture.input,
    );
    expect(second.preseal).toEqual(first.preseal);
    expect(second.receipt.persistenceState).toBe("exact_idempotent_readback");

    fixture.candidate.candidate.selectedProfileId =
      "nhm2-nondegenerate-profile-conflicting";
    await writeCandidate(fixture);
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
      "scientific_preseal_second_seal_conflict",
    );
  });

  it("snapshots mutable inputs before awaits and returns an immutable integrity-bound result", async () => {
    const fixture = await buildFixture();
    const originalCandidateId = fixture.candidate.candidate.candidateId;
    const originalScientificRootDirectory =
      fixture.input.sealedScientificRootDirectory;
    const originalPrimaryOutput = fixture.input.runPlans[0].outputDirectory;
    const times = [
      new Date("2026-08-09T12:00:01.000Z"),
      new Date("2026-08-09T12:00:02.000Z"),
    ];
    let mutated = false;
    fixture.input.now = () => {
      if (!mutated) {
        mutated = true;
        fixture.candidate.candidate.candidateId = "attacker-mutated-candidate";
        (
          fixture.input as PresealNhm2SemiclassicalV2ScientificCandidateInput
        ).sealedScientificRootDirectory = "attacker/rebound/science";
        (
          fixture.input
            .runPlans[0] as PresealNhm2SemiclassicalV2ScientificCandidateInput["runPlans"][0]
        ).outputDirectory = "attacker/rebound/output";
      }
      return times.shift() ?? new Date("2026-08-09T12:00:03.000Z");
    };

    const result = await presealNhm2SemiclassicalV2ScientificCandidate(
      fixture.input,
    );
    expect(mutated).toBe(true);
    expect(result.preseal.candidateBinding.candidateId).toBe(
      originalCandidateId,
    );
    expect(result.preseal.sealedScientificRootDirectory).toBe(
      originalScientificRootDirectory,
    );
    expect(result.preseal.runPlans[0].outputDirectory).toBe(
      originalPrimaryOutput,
    );

    expect(() => {
      (result.receipt.artifact as { sha256: string }).sha256 = "0".repeat(64);
    }).toThrow(TypeError);
    const tampered = structuredClone(result.receipt) as {
      persistenceState: string;
    } & typeof result.receipt;
    tampered.persistenceState = "exact_idempotent_readback";
    expect(
      hasValidNhm2SemiclassicalV2ScientificPresealServerReceiptIntegrity(
        tampered,
      ),
    ).toBe(false);
    expect(
      hasValidNhm2SemiclassicalV2ScientificPresealServerReceiptIntegrity(
        result.receipt,
      ),
    ).toBe(true);
  });

  it("rejects equal, regressing, and future injected clock semantics", async () => {
    const equalSeal = await buildFixture();
    equalSeal.input.now = () => new Date(equalSeal.candidate.candidateFrozenAt);
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(equalSeal.input),
      "scientific_preseal_invalid",
    );
    expect((await fs.stat(equalSeal.sealedRoot)).isDirectory()).toBe(true);

    const equalObservation = await buildFixture();
    const equalTimes = [
      new Date("2026-08-09T12:00:01.000Z"),
      new Date("2026-08-09T12:00:01.000Z"),
    ];
    equalObservation.input.now = () =>
      equalTimes.shift() ?? new Date("2026-08-09T12:00:01.000Z");
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(equalObservation.input),
      "scientific_preseal_invalid",
    );
    expect(
      await fs.stat(
        path.join(
          equalObservation.outputRoot,
          NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RELATIVE_PATH,
        ),
      ),
    ).toBeDefined();

    const future = await buildFixture();
    future.input.now = () => new Date(Date.now() + 60_000);
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(future.input),
      "scientific_preseal_invalid",
    );
    expect((await fs.stat(future.sealedRoot)).isDirectory()).toBe(true);
  });

  it("rejects pretty noncanonical candidate bytes and changed source bytes", async () => {
    const pretty = await buildFixture();
    await writeCandidate(pretty, "pretty");
    const prettyError = await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(pretty.input),
      "source_scientific_inventory_invalid",
    );
    expect(["output_size_mismatch", "output_sha256_mismatch"]).toContain(
      prettyError.detailCode,
    );

    const changed = await buildFixture();
    const geometry = changed.candidate.scientificInputs.find(
      (entry) => entry.inputId === "geometry",
    );
    if (geometry == null) throw new Error("Geometry fixture missing.");
    await writePortableFile(
      changed.sourceRoot,
      geometry.relativePath,
      Buffer.from("changed-after-freeze", "utf8"),
    );
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(changed.input),
      "source_scientific_inventory_invalid",
    );
  });

  it.each([
    [
      "duplicate",
      (fixture: Fixture) => {
        fixture.candidate.scientificInputs[1].relativePath =
          fixture.candidate.scientificInputs[0].relativePath;
      },
    ],
    [
      "case-fold alias",
      (fixture: Fixture) => {
        fixture.candidate.scientificInputs[1].relativePath =
          fixture.candidate.scientificInputs[0].relativePath.toLocaleUpperCase(
            "en-US",
          );
      },
    ],
  ])(
    "rejects %s scientific paths before filesystem admission",
    async (_label, mutate) => {
      const fixture = await buildFixture();
      mutate(fixture);
      await expectCode(
        presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
        "candidate_manifest_invalid",
      );
    },
  );

  it("forbids declared-lever identities before filesystem admission", async () => {
    const fixture = await buildFixture();
    const geometry = fixture.candidate.scientificInputs.find(
      (entry) => entry.inputId === "geometry",
    );
    if (geometry?.descriptor.descriptorKind !== "frozen_scientific_artifact") {
      throw new Error("Geometry descriptor fixture missing.");
    }
    geometry.descriptor.scientificObjectId = "declared_lever_tensor";
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
      "candidate_manifest_invalid",
    );
  });

  it("rejects an extra undeclared source-science file", async () => {
    const fixture = await buildFixture();
    await writePortableFile(
      fixture.sourceRoot,
      "science/undeclared-shadow.json",
      Buffer.from("{}", "utf8"),
    );
    const error = await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
      "source_scientific_inventory_invalid",
    );
    expect(error.detailCode).toBe("output_inventory_mismatch");
  });

  it.each([
    [
      "sparse",
      () => {
        const bytes = Buffer.alloc(640 * 8);
        bytes.writeDoubleLE(2e-12, 0);
        return bytes;
      },
      "metric_demand_nondegeneracy_failed",
    ],
    ["zero", () => Buffer.alloc(640 * 8), "metric_demand_nondegeneracy_failed"],
    [
      "nonfinite",
      () => {
        const bytes = nondegenerateMetricBytes();
        bytes.writeDoubleLE(Number.NaN, 17 * 8);
        return bytes;
      },
      "source_scientific_inventory_invalid",
    ],
  ] as const)("rejects %s metric demand", async (_label, makeBytes, code) => {
    const fixture = await buildFixture();
    await replaceMetricBytes(fixture, makeBytes());
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
      code,
    );
  });

  it("uses symmetric-tensor multiplicities for off-diagonal metric demand", async () => {
    const fixture = await buildFixture();
    const bytes = Buffer.alloc(64 * 10 * 8);
    for (let sample = 0; sample < 64; sample += 1) {
      bytes.writeDoubleLE(0.8e-12, (sample * 10 + 1) * 8);
    }
    await replaceMetricBytes(fixture, bytes);

    const result = await presealNhm2SemiclassicalV2ScientificCandidate(
      fixture.input,
    );
    expect(
      result.preseal.metricDemandNondegeneracy.minimumObservedSampleFrobeniusSI,
    ).toBeCloseTo(Math.sqrt(2) * 0.8e-12, 24);
  });

  it.each([
    [
      "one positive and 639 zero",
      () => {
        const bytes = Buffer.alloc(640 * 8);
        bytes.writeDoubleLE(Number.MIN_VALUE, 0);
        return bytes;
      },
    ],
    [
      "one zero and 639 positive",
      () => {
        const bytes = positiveMetricErrorBoundBytes();
        bytes.writeDoubleLE(0, 0);
        return bytes;
      },
    ],
  ] as const)(
    "rejects a %s demand-error array without a replayed componentwise zero proof",
    async (_label, makeBytes) => {
      const fixture = await buildFixture();
      await replaceMetricErrorBoundBytes(fixture, makeBytes());
      await expectCode(
        presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
        "metric_demand_nondegeneracy_failed",
      );
    },
  );

  it("rejects demand-error arrays that exceed the frozen one-percent enclosure", async () => {
    const fixture = await buildFixture();
    const bytes = positiveMetricErrorBoundBytes();
    for (let sample = 0; sample < 64; sample += 1) {
      bytes.writeDoubleLE(1e-13, sample * 10 * 8);
    }
    await replaceMetricErrorBoundBytes(fixture, bytes);
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
      "metric_demand_nondegeneracy_failed",
    );
  });

  it.each([
    [
      "smearing binding",
      (receipt: Record<string, any>) => {
        receipt.inputBindings.smearingDefinitionSha256 = "f".repeat(64);
      },
    ],
    [
      "relative enclosure target",
      (receipt: Record<string, any>) => {
        receipt.derivation.relativeEnclosureTarget = 0.02;
      },
    ],
  ] as const)(
    "rejects a self-integrity-consistent derivation receipt with a retuned %s",
    async (_label, mutate) => {
      const fixture = await buildFixture();
      await rewriteMetricDerivationReceipt(fixture, mutate);
      const error = await expectCode(
        presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
        "metric_demand_nondegeneracy_failed",
      );
      expect(error.detailCode).toBe(
        "metric_demand_derivation_executor_provenance_unverified",
      );
    },
  );

  it("rejects negative and non-finite demand-error bytes", async () => {
    for (const value of [-1e-16, Number.NaN]) {
      const fixture = await buildFixture();
      const bytes = positiveMetricErrorBoundBytes();
      bytes.writeDoubleLE(value, 0);
      await replaceMetricErrorBoundBytes(fixture, bytes);
      const error = await expectCode(
        presealNhm2SemiclassicalV2ScientificCandidate(fixture.input),
        value < 0
          ? "metric_demand_nondegeneracy_failed"
          : "source_scientific_inventory_invalid",
      );
      expect(error).toBeInstanceOf(Nhm2SemiclassicalV2ScientificPresealerError);
    }
  });

  it("never overwrites an existing sealed root or malformed output", async () => {
    const sealed = await buildFixture();
    await fs.mkdir(sealed.sealedRoot, { recursive: true });
    await writePortableFile(
      sealed.sealedRoot,
      "prior.txt",
      Buffer.from("prior", "utf8"),
    );
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(sealed.input),
      "sealed_scientific_root_exists",
    );
    expect(
      await fs.readFile(path.join(sealed.sealedRoot, "prior.txt"), "utf8"),
    ).toBe("prior");

    const output = await buildFixture();
    await fs.mkdir(output.outputRoot, { recursive: true });
    await fs.writeFile(
      path.join(
        output.outputRoot,
        NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RELATIVE_PATH,
      ),
      "{}",
      "utf8",
    );
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(output.input),
      "scientific_preseal_output_invalid",
    );
    expect(
      await fs.readFile(
        path.join(
          output.outputRoot,
          NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RELATIVE_PATH,
        ),
        "utf8",
      ),
    ).toBe("{}");
  });

  it("bounds existing-preseal reads and rejects hard-linked artifacts without deleting them", async () => {
    const oversized = await buildFixture();
    const oversizedPath = path.join(
      oversized.outputRoot,
      NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RELATIVE_PATH,
    );
    const oversizedLength =
      Number(NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_MAX_PERSISTED_BYTES) + 1;
    await fs.writeFile(oversizedPath, Buffer.alloc(oversizedLength));
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(oversized.input),
      "scientific_preseal_output_invalid",
    );
    expect((await fs.stat(oversizedPath)).size).toBe(oversizedLength);

    const hardlinked = await buildFixture();
    const originalPath = path.join(hardlinked.root, "hardlink-origin.json");
    const hardlinkedPath = path.join(
      hardlinked.outputRoot,
      NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_RELATIVE_PATH,
    );
    await fs.writeFile(originalPath, "{}", "utf8");
    await fs.link(originalPath, hardlinkedPath);
    await expectCode(
      presealNhm2SemiclassicalV2ScientificCandidate(hardlinked.input),
      "scientific_preseal_output_invalid",
    );
    expect((await fs.stat(originalPath, { bigint: true })).nlink).toBe(2n);
    expect((await fs.stat(hardlinkedPath, { bigint: true })).nlink).toBe(2n);
  });
});
