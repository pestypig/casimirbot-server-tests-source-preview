import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCasimirIndependentNumericalExecutionEnrollmentV1,
  buildCasimirIndependentNumericalExecutorCapabilityV1,
  CASIMIR_LANYON_PERIODIC_1D_BACKEND_ID,
  CASIMIR_LANYON_PERIODIC_1D_BUNDLE_ARTIFACT_ROLES,
  CASIMIR_LANYON_PERIODIC_1D_CASE_ID,
  CASIMIR_LANYON_PERIODIC_1D_PRIMARY_IMPLEMENTATION_ID,
  CASIMIR_LANYON_PERIODIC_1D_PRIMARY_LINEAGE_ID,
  CASIMIR_LANYON_PERIODIC_1D_REFERENCE_IMPLEMENTATION_ID,
  CASIMIR_LANYON_PERIODIC_1D_REFERENCE_LINEAGE_ID,
  validateCasimirIndependentNumericalExecutionEnrollmentIntegrityV1,
} from "../../../../shared/contracts/casimir-independent-numerical-execution-enrollment.v1";
import {
  CASIMIR_LANYON_PINNED_COMMIT,
  CASIMIR_LANYON_REPOSITORY_URI,
  CASIMIR_LANYON_SELECTED_SOURCE_TREE_SHA256,
} from "../../../../shared/contracts/casimir-lanyon-advection-diffusion-adapter.v1";
import { buildCasimirIndependentNumericalReplayPolicyV1 } from "../../../../shared/contracts/casimir-independent-numerical-replay-policy.v1";
import { buildCasimirIndependentNumericalVerificationRequestV1 } from "../../../../shared/contracts/casimir-independent-numerical-verification.v1";
import { computeCasimirSpecValueSha256V1 } from "../../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import { computeCasimirIndependentNumericalSealedInputSha256V1 } from "../casimir-independent-numerical-execution-catalog";
import {
  CasimirLanyonNumericalExecutionEnrollmentAdmissionError,
  createCasimirLanyonNumericalExecutionEnrollmentCatalogV1,
  type CasimirLanyonNumericalExecutionEnrollmentCatalogEntryV1,
} from "../casimir-lanyon-numerical-execution-enrollment-catalog";
import { buildNumericalLaneGenerationEvidence } from "./casimir-independent-numerical-generation-fixture";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const hash = (character: string): string => character.repeat(64);
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

async function fixture() {
  const bundleRoot = path.resolve(
    path.parse(process.cwd()).root,
    "casimir-server-owned-numerical-bundle",
  );
  const procedure = {
    schemaVersion: "theory_experiment_procedure/v1" as const,
    procedureId: "procedure:advection-diffusion:periodic-1d",
    procedureSha256: hash("e"),
  };
  const lanyonSource = "pinned-lanyon-generated-source";
  const primarySource = "casimir-lanyon-driver-source";
  const primaryExecutable = "pinned-primary-executable";
  const referenceSource = "casimir-analytic-reference-source";
  const referenceExecutable = "pinned-analytic-reference-executable";
  const harnessSource = "pinned-harness-source";
  const harnessExecutable = "pinned-sandboxed-harness-runtime";
  const primaryManifest = json({
    schema: "casimir_numerical_build_manifest/v1",
    manifest_id: "primary-build",
    lineage_id: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_LINEAGE_ID,
    implementation_id: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_IMPLEMENTATION_ID,
    upstream: {
      repository: CASIMIR_LANYON_REPOSITORY_URI,
      commit: CASIMIR_LANYON_PINNED_COMMIT,
      logical_path: "implementations/advection_diffusion_full_1d.c",
      sha256: sha256(lanyonSource),
    },
    driver: {
      logical_path:
        "tools/casimir-numerical/advection-diffusion-lanyon-adapter.c",
      sha256: sha256(primarySource),
    },
    output: {
      logical_name: "lanyon-adapter.exe",
      sha256: sha256(primaryExecutable),
    },
  });
  const referenceManifest = json({
    schema: "casimir_numerical_build_manifest/v1",
    manifest_id: "analytic-reference-build",
    lineage_id: CASIMIR_LANYON_PERIODIC_1D_REFERENCE_LINEAGE_ID,
    implementation_id: CASIMIR_LANYON_PERIODIC_1D_REFERENCE_IMPLEMENTATION_ID,
    source: {
      logical_path:
        "tools/casimir-numerical/advection-diffusion-analytic-reference.c",
      sha256: sha256(referenceSource),
    },
    output: {
      logical_name: "analytic-reference.exe",
      sha256: sha256(referenceExecutable),
    },
    claim_boundary: {
      is_independent_numerical_solver: false,
    },
  });
  const harnessManifest = json({
    schema: "casimir_numerical_harness_runtime/v1",
    runtime_id: "sandboxed-runtime",
    protocol: "casimir_numerical_harness_json_files/v1",
    launch_mode: "native_executable",
    source: {
      logical_path: "tools/casimir-numerical/advection-diffusion-harness.mjs",
      sha256: sha256(harnessSource),
    },
    runtime: {
      name: "sandboxed-harness",
      executable_sha256: sha256(harnessExecutable),
    },
    execution: {
      network_allowed: false,
      arbitrary_command_allowed: false,
    },
  });
  const artifactBytes = {
    analytic_reference_build_manifest: referenceManifest,
    analytic_reference_executable: referenceExecutable,
    analytic_reference_source: referenceSource,
    harness_executable: harnessExecutable,
    harness_runtime_manifest: harnessManifest,
    harness_source: harnessSource,
    lanyon_upstream_source: lanyonSource,
    primary_build_manifest: primaryManifest,
    primary_driver_source: primarySource,
    primary_executable: primaryExecutable,
  } satisfies Record<
    (typeof CASIMIR_LANYON_PERIODIC_1D_BUNDLE_ARTIFACT_ROLES)[number],
    string
  >;
  const relativePaths = Object.fromEntries(
    CASIMIR_LANYON_PERIODIC_1D_BUNDLE_ARTIFACT_ROLES.map((role) => [
      role,
      `bundle/${role}.bin`,
    ]),
  ) as Record<keyof typeof artifactBytes, string>;
  const absolute = (role: keyof typeof artifactBytes): string =>
    path.resolve(bundleRoot, ...relativePaths[role].split("/"));

  const casimirSpec = {
    specId: "spec:advection-diffusion:periodic-1d",
    schemaVersion: "casimir_spec_scientific_claim_ir/v1" as const,
    semanticSha256: hash("a"),
    artifactSha256: hash("b"),
  };
  const claim = {
    claimId: "claim:advection-diffusion-equation",
    propositionSha256: hash("c"),
  };
  const primaryEvidence = await buildNumericalLaneGenerationEvidence({
    lane: "primary",
    casimirSpec,
    claim,
    implementation: {
      implementationId: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_IMPLEMENTATION_ID,
      lineageId: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_LINEAGE_ID,
      sourceSha256: sha256(primarySource),
      buildManifestSha256: sha256(primaryManifest),
    },
  });
  const referenceEvidence = await buildNumericalLaneGenerationEvidence({
    lane: "independent",
    casimirSpec,
    claim,
    implementation: {
      implementationId: CASIMIR_LANYON_PERIODIC_1D_REFERENCE_IMPLEMENTATION_ID,
      lineageId: CASIMIR_LANYON_PERIODIC_1D_REFERENCE_LINEAGE_ID,
      sourceSha256: sha256(referenceSource),
      buildManifestSha256: sha256(referenceManifest),
    },
  });
  const primaryEnvironment = {
    environmentId: "primary-environment",
    toolchainSha256: hash("1"),
    runtimeSha256: hash("2"),
    platformSha256: hash("3"),
  };
  const referenceEnvironment = {
    environmentId: "analytic-reference-environment",
    toolchainSha256: hash("4"),
    runtimeSha256: hash("5"),
    platformSha256: hash("6"),
  };
  const request = await buildCasimirIndependentNumericalVerificationRequestV1({
    generatedAt: "2026-07-26T00:00:00.000Z",
    requestId: "request:advection-diffusion:periodic-1d",
    casimirSpec,
    claim,
    primaryImplementation: primaryEvidence.implementationBinding,
    independentImplementation: referenceEvidence.implementationBinding,
    frozenCase: {
      caseId: "casimir-advection-diffusion-periodic-1d/v1",
      inputsSha256: hash("7"),
      meshSha256: hash("8"),
      initialConditionsSha256: hash("9"),
      boundaryConditionsSha256: hash("0"),
      observables: [{ observableId: "solution_l2_error", unit: "1" }],
    },
    comparisonPolicy: {
      policyId: "comparison:periodic-1d",
      artifactSha256: hash("f"),
      norm: "l2_relative",
      tolerances: [
        {
          observableId: "solution_l2_error",
          absoluteTolerance: 0.001,
          relativeTolerance: 0.001,
        },
      ],
      minimumRefinementLevels: 3,
      minimumObservedOrder: 0.7,
      deterministicSeed: "periodic-1d",
    },
    environments: {
      primary: primaryEnvironment,
      independent: referenceEnvironment,
    },
    executionPolicy: {
      replayCount: 2,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
    },
  });
  const policy = await buildCasimirIndependentNumericalReplayPolicyV1({
    generatedAt: "2026-07-26T00:00:00.000Z",
    policyId: "replay:advection-diffusion:periodic-1d",
    harness: {
      protocol: "casimir_numerical_harness_json_files/v1",
      launchMode: "native_executable",
      sourceSha256: sha256(harnessSource),
      executableSha256: sha256(harnessExecutable),
    },
    lanes: {
      primary: {
        implementationId: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_IMPLEMENTATION_ID,
        lineageId: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_LINEAGE_ID,
        sourceSha256: sha256(primarySource),
        buildManifestSha256: sha256(primaryManifest),
        executableSha256: sha256(primaryExecutable),
        environment: primaryEnvironment,
      },
      independent: {
        implementationId:
          CASIMIR_LANYON_PERIODIC_1D_REFERENCE_IMPLEMENTATION_ID,
        lineageId: CASIMIR_LANYON_PERIODIC_1D_REFERENCE_LINEAGE_ID,
        sourceSha256: sha256(referenceSource),
        buildManifestSha256: sha256(referenceManifest),
        executableSha256: sha256(referenceExecutable),
        environment: referenceEnvironment,
      },
    },
    execution: {
      replayCount: 2,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
      timeoutMs: 30_000,
      maxOutputBytes: 1_048_576,
      maximumRefinementLevels: 8,
    },
  });
  const executorCapability =
    await buildCasimirIndependentNumericalExecutorCapabilityV1({
      generatedAt: "2026-07-26T00:00:00.000Z",
      capabilityId: "executor:sandboxed-numerical-worker:v1",
      platform: process.platform,
      architecture: process.arch,
      enforcement: {
        networkIsolationEnforced: true,
        filesystemWriteIsolationEnforced: true,
        processTreeContainmentEnforced: true,
        wallTimeoutEnforced: true,
        outputByteLimitEnforced: true,
      },
      attestation: {
        issuer: "trusted-test-runtime",
        evidenceSha256: hash("d"),
      },
    });
  const sealedInput = {
    procedure,
    executorCapability: {
      capabilityId: executorCapability.capabilityId,
      artifactSha256: executorCapability.artifactSha256,
    },
    request,
    policy,
    primaryGenerationRequest: primaryEvidence.generationRequest,
    primaryProducerReceipt: primaryEvidence.producerReceipt,
    independentGenerationRequest: referenceEvidence.generationRequest,
    independentProducerReceipt: referenceEvidence.producerReceipt,
    harnessSourcePath: absolute("harness_source"),
    harnessExecutablePath: absolute("harness_executable"),
    primarySourcePath: absolute("primary_driver_source"),
    primaryBuildManifestPath: absolute("primary_build_manifest"),
    primaryExecutablePath: absolute("primary_executable"),
    independentSourcePath: absolute("analytic_reference_source"),
    independentBuildManifestPath: absolute("analytic_reference_build_manifest"),
    independentExecutablePath: absolute("analytic_reference_executable"),
  };
  const sealedInputSha256 =
    await computeCasimirIndependentNumericalSealedInputSha256V1(sealedInput);
  const catalogEntryId =
    "catalog:advection-diffusion:periodic-1d:procedure-bound";
  const enrollment =
    await buildCasimirIndependentNumericalExecutionEnrollmentV1({
      generatedAt: "2026-07-26T00:00:00.000Z",
      enrollmentId:
        "enrollment:advection-diffusion:periodic-1d:procedure-bound",
      catalogEntryId,
      backendId: CASIMIR_LANYON_PERIODIC_1D_BACKEND_ID,
      procedure,
      request: {
        requestId: request.requestId,
        artifactSha256: request.artifactSha256,
      },
      replayPolicy: {
        policyId: policy.policyId,
        artifactSha256: policy.artifactSha256,
      },
      sealedInputSha256,
      platform: {
        platform: process.platform,
        architecture: process.arch,
      },
      lanyon: {
        repositoryUri: CASIMIR_LANYON_REPOSITORY_URI,
        commitSha: CASIMIR_LANYON_PINNED_COMMIT,
        selectedSourceTreeSha256: CASIMIR_LANYON_SELECTED_SOURCE_TREE_SHA256,
        caseId: CASIMIR_LANYON_PERIODIC_1D_CASE_ID,
        generatedSourceSha256: sha256(lanyonSource),
      },
      primaryLane: {
        role: "lanyon_generated_kernel_with_casimir_driver",
        implementationId: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_IMPLEMENTATION_ID,
        lineageId: CASIMIR_LANYON_PERIODIC_1D_PRIMARY_LINEAGE_ID,
        sourceSha256: sha256(primarySource),
        buildManifestSha256: sha256(primaryManifest),
        executableSha256: sha256(primaryExecutable),
      },
      comparisonLane: {
        role: "analytic_reference",
        implementationId:
          CASIMIR_LANYON_PERIODIC_1D_REFERENCE_IMPLEMENTATION_ID,
        lineageId: CASIMIR_LANYON_PERIODIC_1D_REFERENCE_LINEAGE_ID,
        isNumericalSolver: false,
        sourceSha256: sha256(referenceSource),
        buildManifestSha256: sha256(referenceManifest),
        executableSha256: sha256(referenceExecutable),
      },
      bundle: {
        bundleId: "bundle:advection-diffusion:periodic-1d:v1",
        artifacts: CASIMIR_LANYON_PERIODIC_1D_BUNDLE_ARTIFACT_ROLES.map(
          (role) => ({
            role,
            relativePath: relativePaths[role],
            sha256: sha256(artifactBytes[role]),
            sizeBytes: Buffer.byteLength(artifactBytes[role]),
          }),
        ),
      },
      executorCapability: {
        capabilityId: executorCapability.capabilityId,
        artifactSha256: executorCapability.artifactSha256,
        requiresNetworkIsolation: true,
        requiresFilesystemWriteIsolation: true,
        requiresProcessTreeContainment: true,
        requiresWallTimeout: true,
        requiresOutputByteLimit: true,
      },
    });
  const entry: CasimirLanyonNumericalExecutionEnrollmentCatalogEntryV1 = {
    enrollment,
    bundleRoot,
    sealedInput,
    executorCapability,
  };
  const inspectBundleArtifact = ({
    relativePath,
  }: {
    bundleRoot: string;
    relativePath: string;
  }) => {
    const role = CASIMIR_LANYON_PERIODIC_1D_BUNDLE_ARTIFACT_ROLES.find(
      (candidate) => relativePaths[candidate] === relativePath,
    );
    if (!role) throw new Error("unknown fixture artifact");
    const bytes = Buffer.from(artifactBytes[role]);
    return {
      absolutePath: absolute(role),
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      bytes,
    };
  };
  const resolveInput = {
    accountType: "developer" as const,
    profileId: "profile:developer",
    catalogEntryId,
    procedureId: procedure.procedureId,
    procedureSha256: procedure.procedureSha256,
  };
  return {
    entry,
    sealedInput,
    procedure,
    catalogEntryId,
    resolveInput,
    inspectBundleArtifact,
  };
}

const issuesOf = async (promise: Promise<unknown>): Promise<string[]> => {
  try {
    await promise;
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(
      CasimirLanyonNumericalExecutionEnrollmentAdmissionError,
    );
    return (error as CasimirLanyonNumericalExecutionEnrollmentAdmissionError)
      .issues;
  }
};

describe("procedure-bound Lanyon numerical enrollment catalog", () => {
  it("resolves only the exact enrolled procedure and returns a clone", async () => {
    const fixtureValue = await fixture();
    const catalog = createCasimirLanyonNumericalExecutionEnrollmentCatalogV1(
      [fixtureValue.entry],
      {
        inspectBundleArtifact: fixtureValue.inspectBundleArtifact,
        verifyExecutorCapability: () => true,
      },
    );
    const resolved = await catalog.resolve(fixtureValue.resolveInput);
    expect(resolved).toEqual(fixtureValue.sealedInput);
    expect(resolved).not.toBe(fixtureValue.sealedInput);
    expect(catalog.entryIds).toEqual([fixtureValue.catalogEntryId]);

    await expect(
      catalog.resolve({
        ...fixtureValue.resolveInput,
        catalogEntryId: "catalog:unknown",
      }),
    ).resolves.toBeNull();
    expect(
      await issuesOf(
        Promise.resolve(
          catalog.resolve({
            ...fixtureValue.resolveInput,
            procedureSha256: hash("0"),
          }),
        ),
      ),
    ).toContain("numerical_procedure_binding_mismatch");
  });

  it("rejects bundle-byte drift and sealed-input substitution", async () => {
    const fixtureValue = await fixture();
    const driftCatalog =
      createCasimirLanyonNumericalExecutionEnrollmentCatalogV1(
        [fixtureValue.entry],
        {
          inspectBundleArtifact: (input) => {
            const observed = fixtureValue.inspectBundleArtifact(input);
            if (input.relativePath.endsWith("primary_executable.bin")) {
              const bytes = Buffer.from("drifted-primary-executable");
              return {
                ...observed,
                bytes,
                sha256: sha256(bytes),
                sizeBytes: bytes.byteLength,
              };
            }
            return observed;
          },
          verifyExecutorCapability: () => true,
        },
      );
    expect(
      await issuesOf(
        Promise.resolve(driftCatalog.resolve(fixtureValue.resolveInput)),
      ),
    ).toContain("numerical_bundle_artifact_drift:primary_executable");

    const substituted = structuredClone(fixtureValue.entry);
    substituted.sealedInput.request.requestId = "substituted-request";
    const substitutedCatalog =
      createCasimirLanyonNumericalExecutionEnrollmentCatalogV1([substituted], {
        inspectBundleArtifact: fixtureValue.inspectBundleArtifact,
        verifyExecutorCapability: () => true,
      });
    expect(
      await issuesOf(
        Promise.resolve(substitutedCatalog.resolve(fixtureValue.resolveInput)),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("request:"),
        "numerical_enrolled_request_mismatch",
        "numerical_enrolled_sealed_input_hash_mismatch",
      ]),
    );
  });

  it("rejects platform-ambiguous and reserved bundle paths", async () => {
    const fixtureValue = await fixture();
    for (const unsafePath of [
      "bundle/file:stream",
      "bundle/\u0000control",
      "bundle/trailing./file",
      "bundle/trailing /file",
      "bundle/CON/file",
      "bundle/com1.txt",
    ]) {
      const unsafeEnrollment = structuredClone(fixtureValue.entry.enrollment);
      unsafeEnrollment.bundle.artifacts[0].relativePath = unsafePath;
      const issues =
        await validateCasimirIndependentNumericalExecutionEnrollmentIntegrityV1(
          unsafeEnrollment,
        );
      expect(
        issues.some((issue) =>
          issue.startsWith("bundle.artifacts.0.relativePath:"),
        ),
      ).toBe(true);
    }
  });

  it("does not infer sandbox enforcement from networkAllowed=false", async () => {
    const fixtureValue = await fixture();
    const unattested = createCasimirLanyonNumericalExecutionEnrollmentCatalogV1(
      [fixtureValue.entry],
      {
        inspectBundleArtifact: fixtureValue.inspectBundleArtifact,
      },
    );
    expect(
      await issuesOf(
        Promise.resolve(unattested.resolve(fixtureValue.resolveInput)),
      ),
    ).toContain("numerical_executor_capability_verifier_unconfigured");

    const insufficientEntry = structuredClone(fixtureValue.entry);
    insufficientEntry.executorCapability.enforcement.networkIsolationEnforced = false;
    const { artifactSha256: _ignored, ...capabilityWithoutHash } =
      insufficientEntry.executorCapability;
    insufficientEntry.executorCapability.artifactSha256 =
      await computeCasimirSpecValueSha256V1({
        domain: "casimir-independent-numerical-executor-capability/v1",
        value: capabilityWithoutHash,
      });
    const insufficient =
      createCasimirLanyonNumericalExecutionEnrollmentCatalogV1(
        [insufficientEntry],
        {
          inspectBundleArtifact: fixtureValue.inspectBundleArtifact,
          verifyExecutorCapability: () => true,
        },
      );
    expect(
      await issuesOf(
        Promise.resolve(insufficient.resolve(fixtureValue.resolveInput)),
      ),
    ).toEqual(
      expect.arrayContaining([
        "numerical_executor_capability_binding_mismatch",
        "numerical_executor_sandbox_capability_insufficient",
      ]),
    );
    expect(
      fixtureValue.entry.enrollment.authority.networkPolicyIsSandboxProof,
    ).toBe(false);
    expect(fixtureValue.entry.enrollment.comparisonLane.isNumericalSolver).toBe(
      false,
    );
  });

  it("keeps the default catalog empty and rejects OS-temporary bundles", async () => {
    const empty = createCasimirLanyonNumericalExecutionEnrollmentCatalogV1([]);
    const fixtureValue = await fixture();
    expect(empty.entryIds).toEqual([]);
    await expect(empty.resolve(fixtureValue.resolveInput)).resolves.toBeNull();

    const temporaryEntry = {
      ...fixtureValue.entry,
      bundleRoot: path.join(os.tmpdir(), "untrusted-numerical-bundle"),
    };
    const catalog = createCasimirLanyonNumericalExecutionEnrollmentCatalogV1(
      [temporaryEntry],
      {
        inspectBundleArtifact: fixtureValue.inspectBundleArtifact,
        verifyExecutorCapability: () => true,
      },
    );
    expect(
      await issuesOf(
        Promise.resolve(catalog.resolve(fixtureValue.resolveInput)),
      ),
    ).toContain("numerical_bundle_root_must_not_be_os_temporary");
  });
});
