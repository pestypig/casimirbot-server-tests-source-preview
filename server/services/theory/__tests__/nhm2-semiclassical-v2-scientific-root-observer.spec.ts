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
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_RAW_BINDING,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-raw-replay-manifest.v1";
import {
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_COVERAGE,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ENCLOSURE_METHOD,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_NONDEGENERACY_CRITERION_ID,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_CLAIM_LOCKS,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_KIND,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_PHASE,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS,
  canonicalNhm2SemiclassicalV2ScientificCandidateManifestJson,
  computeNhm2SemiclassicalV2ScientificCandidateManifestExternalSha256,
  type Nhm2SemiclassicalV2ScientificCandidateManifestV1,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-scientific-candidate-manifest.v1";
import {
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_NONZERO_SCREEN_ID,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_AUTHORITY,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_CONSUMER_SCOPE,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_CONTRACT_VERSION,
  computeNhm2SemiclassicalV2ScientificContentSha256,
  computeNhm2SemiclassicalV2ScientificSealKey,
  computeNhm2SemiclassicalV2SealedInventorySha256,
  type Nhm2SemiclassicalV2ScientificPresealV1,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-scientific-preseal.v1";
import { NHM2_SEMICLASSICAL_TENSOR_COMPONENTS } from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v1";
import {
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_ROOT_OBSERVER_CLAIM_LOCKS,
  Nhm2SemiclassicalV2ScientificRootObserverError,
  computeNhm2SemiclassicalV2ScientificRootObservationContentSha256,
  hasValidNhm2SemiclassicalV2ScientificRootObservationContentIntegrity,
  observeNhm2SemiclassicalV2ScientificRoot,
  type Nhm2SemiclassicalV2CurrentNamespaceMountObservationV1,
} from "../nhm2-semiclassical-v2-scientific-root-observer";

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

const objectIds: Record<string, string> = {
  geometry: "geometry-frozen-001",
  quantum_state: "quantum-state-frozen-001",
  chart: "chart-frozen-001",
  normalization: "normalization-frozen-001",
  smearing_definition: "smearing-frozen-001",
  sampling_basis: "sampling-basis-frozen-001",
};

type Fixture = Readonly<{
  root: string;
  preseal: Nhm2SemiclassicalV2ScientificPresealV1;
  bytesByPath: ReadonlyMap<string, Buffer>;
}>;

const deterministicBytes = (label: string, size: number): Buffer => {
  const seed = Buffer.from(label, "utf8");
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = seed[index % seed.length];
  }
  return bytes;
};

const writePortableFile = async (
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
};

const buildFixture = async (): Promise<Fixture> => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-v2-scientific-root-observer-"),
  );
  temporaryRoots.push(root);
  const bytesByPath = new Map<string, Buffer>();

  const scientificInputs =
    NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS.map(
      (inputId) => {
        if (inputId === "tolerance_policy") {
          const relativePath = "policy/approved-replay-policy.v1.json";
          const bytes = Buffer.from(
            NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_CANONICAL_JSON,
            "utf8",
          );
          bytesByPath.set(relativePath, bytes);
          return {
            inputId,
            relativePath,
            sha256: sha256(bytes),
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
          const bytes = deterministicBytes(inputId, 64 * 10 * 8);
          bytesByPath.set(relativePath, bytes);
          return {
            inputId,
            relativePath,
            sha256: sha256(bytes),
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
              shape: [64, NHM2_SEMICLASSICAL_TENSOR_COMPONENTS.length],
              storageOrder: "row-major",
              componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
              unit: "J/m^3",
            },
          };
        }
        if (inputId === "metric_demand_derivation_receipt") {
          const relativePath =
            "metric/metric-demand-derivation-receipt.v1.json";
          const bytes = deterministicBytes(inputId, 2048);
          bytesByPath.set(relativePath, bytes);
          return {
            inputId,
            relativePath,
            sha256: sha256(bytes),
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
        const bytes = deterministicBytes(inputId, 128 + inputId.length);
        bytesByPath.set(relativePath, bytes);
        return {
          inputId,
          relativePath,
          sha256: sha256(bytes),
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
  const candidateBytes = Buffer.from(
    canonicalNhm2SemiclassicalV2ScientificCandidateManifestJson(candidate),
    "utf8",
  );
  const candidateRelativePath =
    "candidate/scientific-candidate-manifest.v1.json";
  const candidateSha256 =
    computeNhm2SemiclassicalV2ScientificCandidateManifestExternalSha256(
      candidateBytes,
    );
  bytesByPath.set(candidateRelativePath, candidateBytes);
  const stagedInputs = [
    {
      inputId: "candidate_manifest" as const,
      relativePath: candidateRelativePath,
      sha256: candidateSha256,
      sizeBytes: candidateBytes.byteLength,
      mediaType: "application/json" as const,
      descriptor: {
        descriptorKind: "scientific_candidate_manifest" as const,
        scientificInputId: "candidate_manifest" as const,
        artifactId:
          NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_ARTIFACT_ID,
        contractVersion:
          NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_MANIFEST_CONTRACT_VERSION,
        candidateId: candidate.candidate.candidateId,
        candidateManifestId: candidate.candidate.candidateManifestId,
        candidateFrozenAt: candidate.candidateFrozenAt,
      },
    },
    ...structuredClone(candidate.scientificInputs),
  ];
  const entry = (inputId: string) => {
    const found = stagedInputs.find(
      (candidateEntry) => candidateEntry.inputId === inputId,
    );
    if (found == null) throw new Error(`Missing fixture entry ${inputId}.`);
    return found;
  };
  const sealedScientificRootDirectory = "sealed/nhm2-v2/candidate-001/science";
  const unsigned = {
    artifactId: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_ARTIFACT_ID,
    contractVersion: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_CONTRACT_VERSION,
    authority: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_AUTHORITY,
    consumerScope: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_CONSUMER_SCOPE,
    sealKey: computeNhm2SemiclassicalV2ScientificSealKey(
      candidate.candidate.candidateId,
    ),
    candidateFrozenAt: candidate.candidateFrozenAt,
    sealedAt: "2026-08-09T12:00:01.000Z",
    candidateBinding: {
      candidateId: candidate.candidate.candidateId,
      candidateManifestId: candidate.candidate.candidateManifestId,
      candidateManifestInputId: "candidate_manifest" as const,
      candidateManifestSha256: candidateSha256,
      candidateManifestSizeBytes: candidateBytes.byteLength,
    },
    sealedScientificRootDirectory,
    stagedInputs,
    scientificContentSha256:
      computeNhm2SemiclassicalV2ScientificContentSha256(stagedInputs),
    approvedReplayPolicy: {
      ...NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_RAW_BINDING,
    },
    metricDemandDerivationBinding: {
      inputId: "metric_demand_derivation_receipt" as const,
      sha256: entry("metric_demand_derivation_receipt").sha256,
      artifactId:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
      contractVersion:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
      metricDemandInputId: "metric_demand_tensor" as const,
      metricDemandSha256: entry("metric_demand_tensor").sha256,
      errorBoundInputId: "metric_demand_absolute_error_bound" as const,
      errorBoundSha256: entry("metric_demand_absolute_error_bound").sha256,
      enclosureMethod:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ENCLOSURE_METHOD,
      coverage: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_COVERAGE,
      relativeEnclosureTarget: 0.01 as const,
      verificationStatus:
        "metric_demand_derivation_executor_provenance_unverified" as const,
      blockers: [
        "metric_demand_derivation_executor_provenance_unverified",
        "interval_trace_not_server_replayed",
      ] as const,
    },
    metricDemandNondegeneracy: {
      screenId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_NONZERO_SCREEN_ID,
      authority:
        "server_recomputed_from_staged_metric_and_error_float64_bytes" as const,
      inputId: "metric_demand_tensor" as const,
      metricDemandSha256: entry("metric_demand_tensor").sha256,
      errorBoundInputId: "metric_demand_absolute_error_bound" as const,
      metricDemandAbsoluteErrorBoundSha256: entry(
        "metric_demand_absolute_error_bound",
      ).sha256,
      algorithm:
        "stable_scaled_symmetric_tensor_frobenius_lower_bound_per_sample_float64_v2" as const,
      sampleCount: 64 as const,
      componentCount: 10 as const,
      valueCount: 640 as const,
      finiteValueCount: 640 as const,
      errorBoundValueCount: 640 as const,
      finiteErrorBoundValueCount: 640 as const,
      minimumMetricDemandFrobeniusSI:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.minimumMetricDemandFrobeniusSI,
      requiredNondegenerateSampleFraction:
        NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY.requiredMetricDemandSampleFraction,
      observedNondegenerateSampleCount: 64,
      observedNondegenerateSampleFraction: 1,
      minimumObservedSampleFrobeniusSI: 2e-12,
      maximumObservedSampleFrobeniusSI: 4e-12,
      minimumObservedSampleFrobeniusLowerBoundSI: 1.5e-12,
      maximumObservedSampleErrorBoundFrobeniusSI: 5e-13,
      maximumAllowedRelativeErrorBound: 0.01 as const,
      maximumObservedRelativeErrorBound: 0.00025,
      allSamplesWithinRelativeErrorBound: true as const,
      globalMetricDemandFrobeniusSI: 2e-11,
      allValuesFinite: true as const,
      allErrorBoundsFiniteAndNonnegative: true as const,
      allErrorBoundsStrictlyPositive: true as const,
      passesFrozenScreen: true as const,
      regionalPhysicalNondegeneracyAuthority: false as const,
    },
    runPlans: [
      {
        role: "primary" as const,
        planId: "primary-plan-001",
        scientificRootDirectory: sealedScientificRootDirectory,
        scientificRootAccess: "read_only_exact_sealed_inventory" as const,
        implementationRootDirectory: "lanes/primary/toolchain-001",
        outputDirectory: "runs/primary/candidate-001",
        counterpartOutputs: "not_mounted" as const,
        ambientRepository: "not_mounted" as const,
      },
      {
        role: "independent" as const,
        planId: "independent-plan-001",
        scientificRootDirectory: sealedScientificRootDirectory,
        scientificRootAccess: "read_only_exact_sealed_inventory" as const,
        implementationRootDirectory: "lanes/independent/toolchain-001",
        outputDirectory: "runs/independent/candidate-001",
        counterpartOutputs: "not_mounted" as const,
        ambientRepository: "not_mounted" as const,
      },
    ] as const,
    claimLocks: { ...NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_CLAIM_LOCKS },
  };
  const preseal = {
    ...unsigned,
    runPlans: [...unsigned.runPlans],
    sealedInventorySha256: computeNhm2SemiclassicalV2SealedInventorySha256(
      unsigned as unknown as Omit<
        Nhm2SemiclassicalV2ScientificPresealV1,
        "sealedInventorySha256"
      >,
    ),
  } as Nhm2SemiclassicalV2ScientificPresealV1;

  for (const [relativePath, bytes] of bytesByPath) {
    await writePortableFile(root, relativePath, bytes);
  }
  return { root, preseal, bytesByPath };
};

const mountObservation = (
  readOnly: boolean,
): Nhm2SemiclassicalV2CurrentNamespaceMountObservationV1 => ({
  support: "observed",
  namespace: "server_current_process",
  platform: "test",
  mountId: "101",
  parentMountId: "100",
  majorMinor: "8:1",
  mountPoint: "/test-mount",
  mountRoot: "/",
  fileSystemType: "testfs",
  mountOptions: [readOnly ? "ro" : "rw", "relatime"],
  superOptions: [readOnly ? "ro" : "rw"],
  readOnly,
});

const rehashObservation = (value: Record<string, any>): Record<string, any> => {
  const { observationSha256: _observationSha256, ...unsigned } = value;
  value.observationSha256 =
    computeNhm2SemiclassicalV2ScientificRootObservationContentSha256(unsigned);
  return value;
};

const expectObserverError = async (
  promise: Promise<unknown>,
  code: Nhm2SemiclassicalV2ScientificRootObserverError["code"],
  detailCode?: string,
): Promise<void> => {
  try {
    await promise;
    throw new Error("Expected scientific-root observer failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(
      Nhm2SemiclassicalV2ScientificRootObserverError,
    );
    const observed = error as Nhm2SemiclassicalV2ScientificRootObserverError;
    expect(observed.code).toBe(code);
    if (detailCode != null) expect(observed.detailCode).toBe(detailCode);
  }
};

describe("NHM2 semiclassical-v2 scientific-root observer", () => {
  it("binds every preseal file and directory identity but never grants lane mount authority", async () => {
    const fixture = await buildFixture();
    const result = await observeNhm2SemiclassicalV2ScientificRoot({
      absoluteScientificRootDirectory: fixture.root,
      preseal: fixture.preseal,
      currentNamespaceMountObservationForTesting: () => mountObservation(true),
    });

    expect(result).toMatchObject({
      status: "blocked",
      authorityState: "exact_inventory_observed_lane_mount_unverified",
      presealBinding: {
        sealKey: fixture.preseal.sealKey,
        sealedInventorySha256: fixture.preseal.sealedInventorySha256,
        scientificContentSha256: fixture.preseal.scientificContentSha256,
        stagedInputCount: fixture.preseal.stagedInputs.length,
      },
      exactInventory: {
        exactSealedInventoryVerified: true,
        allSealedFilesSecurelyReread: true,
        secureReadPassCount: 2,
      },
      mountAuthority: {
        currentNamespaceBeforeIdentityRecheck: {
          mountId: "101",
          parentMountId: "100",
          majorMinor: "8:1",
          readOnly: true,
        },
        currentNamespaceAfterIdentityRecheck: {
          mountId: "101",
          parentMountId: "100",
          majorMinor: "8:1",
          readOnly: true,
        },
        currentNamespaceMountFactsStable: true,
        currentNamespaceReadOnlyObserved: true,
        laneMountNamespaceObserved: false,
        laneScientificRootRealpathIdentityBound: false,
        laneScientificRootReadOnlyMountVerified: false,
        producerMountDeclarationAcceptedAsEvidence: false,
      },
      blockers: ["scientific_root_lane_mount_identity_not_observed"],
    });
    expect(result.exactInventory.files).toHaveLength(
      fixture.preseal.stagedInputs.length,
    );
    expect(result.exactInventory.directories.length).toBeGreaterThan(0);
    expect(
      result.exactInventory.files.every(
        (file, index) =>
          file.relativePath ===
            fixture.preseal.stagedInputs[index].relativePath &&
          file.sha256 === fixture.preseal.stagedInputs[index].sha256 &&
          file.sizeBytes ===
            String(fixture.preseal.stagedInputs[index].sizeBytes) &&
          /^[0-9]+$/.test(file.filesystemIdentity.ino),
      ),
    ).toBe(true);
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
    expect(Object.keys(result.claimLocks)).toEqual(
      Object.keys(NHM2_SEMICLASSICAL_V2_SCIENTIFIC_ROOT_OBSERVER_CLAIM_LOCKS),
    );
    expect(
      hasValidNhm2SemiclassicalV2ScientificRootObservationContentIntegrity(
        result,
      ),
    ).toBe(true);
    const tampered = structuredClone(result);
    tampered.exactInventory.files[0].sha256 = "0".repeat(64);
    expect(
      hasValidNhm2SemiclassicalV2ScientificRootObservationContentIntegrity(
        tampered,
      ),
    ).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.exactInventory.files)).toBe(true);
  }, 15_000);

  it("rejects partial, extra, missing, null, enum, array, and boolean mutations even when callers recompute the public content hash", async () => {
    const fixture = await buildFixture();
    const result = await observeNhm2SemiclassicalV2ScientificRoot({
      absoluteScientificRootDirectory: fixture.root,
      preseal: fixture.preseal,
      currentNamespaceMountObservationForTesting: () => mountObservation(true),
    });
    const hostilePartial = {
      observationSha256:
        computeNhm2SemiclassicalV2ScientificRootObservationContentSha256(
          {} as any,
        ),
    };
    expect(
      hasValidNhm2SemiclassicalV2ScientificRootObservationContentIntegrity(
        hostilePartial,
      ),
    ).toBe(false);

    const mutations: Record<string, any>[] = [];
    const extra = structuredClone(result) as Record<string, any>;
    extra.unexpectedAuthority = true;
    mutations.push(rehashObservation(extra));

    const missing = structuredClone(result) as Record<string, any>;
    delete missing.status;
    mutations.push(rehashObservation(missing));

    const wrongType = structuredClone(result) as Record<string, any>;
    wrongType.presealBinding.stagedInputCount = "23";
    mutations.push(rehashObservation(wrongType));

    const nullNested = structuredClone(result) as Record<string, any>;
    nullNested.mountAuthority = null;
    mutations.push(rehashObservation(nullNested));

    const wrongEnum = structuredClone(result) as Record<string, any>;
    wrongEnum.status = "pass";
    mutations.push(rehashObservation(wrongEnum));

    const wrongArray = structuredClone(result) as Record<string, any>;
    wrongArray.blockers = {
      0: "scientific_root_lane_mount_identity_not_observed",
    };
    mutations.push(rehashObservation(wrongArray));

    const openBooleanLock = structuredClone(result) as Record<string, any>;
    openBooleanLock.claimLocks.contentHashAuthenticatesServerOrigin = true;
    mutations.push(rehashObservation(openBooleanLock));

    const missingDeepKey = structuredClone(result) as Record<string, any>;
    delete missingDeepKey.exactInventory.files[0].filesystemIdentity.ctimeNs;
    mutations.push(rehashObservation(missingDeepKey));

    const extraDeepKey = structuredClone(result) as Record<string, any>;
    extraDeepKey.mountAuthority.currentNamespaceBeforeIdentityRecheck.extra = false;
    mutations.push(rehashObservation(extraDeepKey));

    for (const mutation of mutations) {
      expect(
        hasValidNhm2SemiclassicalV2ScientificRootObservationContentIntegrity(
          mutation,
        ),
      ).toBe(false);
    }
    expect(
      hasValidNhm2SemiclassicalV2ScientificRootObservationContentIntegrity(
        null,
      ),
    ).toBe(false);
  }, 15_000);

  it("fails closed for unsupported and observed read-write current mount facts", async () => {
    const unsupportedFixture = await buildFixture();
    const unsupported = await observeNhm2SemiclassicalV2ScientificRoot({
      absoluteScientificRootDirectory: unsupportedFixture.root,
      preseal: unsupportedFixture.preseal,
      currentNamespaceMountObservationForTesting: () => ({
        support: "unsupported",
        namespace: "server_current_process",
        platform: "test",
        reason: "test_platform_unsupported",
      }),
    });
    expect(unsupported.blockers).toEqual([
      "scientific_root_current_namespace_mount_facts_unsupported",
      "scientific_root_lane_mount_identity_not_observed",
    ]);
    expect(
      unsupported.mountAuthority.laneScientificRootReadOnlyMountVerified,
    ).toBe(false);

    const writableFixture = await buildFixture();
    const writable = await observeNhm2SemiclassicalV2ScientificRoot({
      absoluteScientificRootDirectory: writableFixture.root,
      preseal: writableFixture.preseal,
      currentNamespaceMountObservationForTesting: () => mountObservation(false),
    });
    expect(writable.blockers).toEqual([
      "scientific_root_current_namespace_mount_not_read_only",
      "scientific_root_lane_mount_identity_not_observed",
    ]);
    expect(writable.mountAuthority.currentNamespaceReadOnlyObserved).toBe(
      false,
    );
    expect(Object.values(writable.claimLocks)).not.toContain(true);
  }, 15_000);

  it("fails if the matching current-namespace mount identity or read-only facts change across inventory rechecks", async () => {
    const fixture = await buildFixture();
    let sampleCount = 0;
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: fixture.root,
        preseal: fixture.preseal,
        currentNamespaceMountObservationForTesting: () => {
          sampleCount += 1;
          const observation = mountObservation(true);
          return sampleCount === 1
            ? observation
            : { ...observation, mountId: "102" };
        },
      }),
      "scientific_root_mount_facts_changed",
    );
    expect(sampleCount).toBe(2);

    const readOnlyFixture = await buildFixture();
    let readOnlySampleCount = 0;
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: readOnlyFixture.root,
        preseal: readOnlyFixture.preseal,
        currentNamespaceMountObservationForTesting: () => {
          readOnlySampleCount += 1;
          return mountObservation(readOnlySampleCount === 1);
        },
      }),
      "scientific_root_mount_facts_changed",
    );
    expect(readOnlySampleCount).toBe(2);
  }, 15_000);

  it("rejects root aliases, extra inventory, and hard-linked sealed entries", async () => {
    const aliasFixture = await buildFixture();
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: `${aliasFixture.root}${path.sep}.`,
        preseal: aliasFixture.preseal,
      }),
      "scientific_root_path_invalid",
    );

    const extraFixture = await buildFixture();
    await fs.writeFile(path.join(extraFixture.root, "undeclared.bin"), "extra");
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: extraFixture.root,
        preseal: extraFixture.preseal,
      }),
      "scientific_root_secure_inventory_read_failed",
      "output_inventory_mismatch",
    );

    const hardlinkFixture = await buildFixture();
    const targetEntry = hardlinkFixture.preseal.stagedInputs.find(
      (entry) => entry.inputId === "geometry",
    )!;
    const targetPath = path.resolve(
      hardlinkFixture.root,
      ...targetEntry.relativePath.split("/"),
    );
    const backingPath = path.join(
      hardlinkFixture.root,
      "..",
      `${path.basename(hardlinkFixture.root)}-backing.bin`,
    );
    temporaryRoots.push(backingPath);
    await fs.writeFile(
      backingPath,
      hardlinkFixture.bytesByPath.get(targetEntry.relativePath)!,
    );
    await fs.rm(targetPath);
    await fs.link(backingPath, targetPath);
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: hardlinkFixture.root,
        preseal: hardlinkFixture.preseal,
      }),
      "scientific_root_secure_inventory_read_failed",
      "output_entry_hardlinked",
    );
  }, 15_000);

  it("rejects hash changes, size changes, and changes between secure read passes", async () => {
    const hashFixture = await buildFixture();
    const hashEntry = hashFixture.preseal.stagedInputs.find(
      (entry) => entry.inputId === "geometry",
    )!;
    const hashPath = path.resolve(
      hashFixture.root,
      ...hashEntry.relativePath.split("/"),
    );
    const changed = Buffer.from(
      hashFixture.bytesByPath.get(hashEntry.relativePath)!,
    );
    changed[0] ^= 0xff;
    await fs.writeFile(hashPath, changed);
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: hashFixture.root,
        preseal: hashFixture.preseal,
      }),
      "scientific_root_secure_inventory_read_failed",
      "output_sha256_mismatch",
    );

    const sizeFixture = await buildFixture();
    const sizeEntry = sizeFixture.preseal.stagedInputs.find(
      (entry) => entry.inputId === "geometry",
    )!;
    const sizePath = path.resolve(
      sizeFixture.root,
      ...sizeEntry.relativePath.split("/"),
    );
    await fs.appendFile(sizePath, Buffer.from([0]));
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: sizeFixture.root,
        preseal: sizeFixture.preseal,
      }),
      "scientific_root_secure_inventory_read_failed",
      "output_size_mismatch",
    );

    const raceFixture = await buildFixture();
    const raceEntry = raceFixture.preseal.stagedInputs.find(
      (entry) => entry.inputId === "geometry",
    )!;
    const racePath = path.resolve(
      raceFixture.root,
      ...raceEntry.relativePath.split("/"),
    );
    const raced = Buffer.from(
      raceFixture.bytesByPath.get(raceEntry.relativePath)!,
    );
    raced[0] ^= 0xff;
    await expectObserverError(
      observeNhm2SemiclassicalV2ScientificRoot({
        absoluteScientificRootDirectory: raceFixture.root,
        preseal: raceFixture.preseal,
        afterInitialReadForTesting: () => fs.writeFile(racePath, raced),
      }),
      "scientific_root_secure_inventory_read_failed",
      "output_changed_after_initial_read",
    );
  }, 15_000);
});
