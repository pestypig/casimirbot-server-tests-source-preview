import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_NUMERIC_MATERIALIZATION_POLICY_V1_BINDING,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_NUMERIC_MATERIALIZATION_POLICY_V1_OPERATION_GRAPH_BINDING,
} from "../../../../shared/contracts/nhm2-prolate-boson-star-newtonian-seed-numeric-materialization-policy.v1";
import {
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_POSTPROJECTION_POLICY_V1_BINDING,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_POSTPROJECTION_POLICY_V1_OPERATION_GRAPH_BINDING,
} from "../../../../shared/contracts/nhm2-prolate-boson-star-newtonian-seed-postprojection-policy.v1";
import {
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_BINDING,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY_BINDING,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EXPECTED_SHA256,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_SCHEMA_BINDINGS,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_VERIFIER_PRELAUNCH_CONTEXT_REJECTION_SCHEMA,
} from "../../../../shared/contracts/nhm2-prolate-boson-star-newtonian-seed-run-plan.v3";
import {
  inspectDefaultNhm2ProlateBosonStarSeedV3ProviderStatus,
  inspectNhm2ProlateBosonStarSeedCapabilityCatalogV3,
  installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV3,
  resolveNhm2ProlateBosonStarSeedCapabilityCatalogEntryV3,
} from "../nhm2-prolate-boson-star-seed-v3-execution-registry-bootstrap";
import {
  NHM2_PROLATE_BOSON_STAR_SEED_V3_EXECUTION_TARGET,
  NHM2_PROLATE_BOSON_STAR_SEED_V3_PREREQUISITE_BINDING_VERSION,
  NHM2_PROLATE_BOSON_STAR_SEED_V3_PROVIDER_SEALED_BINDINGS,
  NHM2_PROLATE_BOSON_STAR_SEED_V3_PROVIDER_VERSION,
  launchNhm2ProlateBosonStarSeedVerifierWithTrustedServerHandleV3,
  preflightNhm2ProlateBosonStarSeedVerifierContextV3,
  type Nhm2ProlateBosonStarSeedIsolatedWorkerProviderV3,
  type Nhm2ProlateBosonStarSeedV3ExactEvidenceAdmissionToken,
  type Nhm2ProlateBosonStarSeedV3LaunchEnvelopeFormationInput,
  type Nhm2ProlateBosonStarSeedV3PrerequisiteArtifactKind,
  type Nhm2ProlateBosonStarSeedV3PrerequisiteBinding,
  type Nhm2ProlateBosonStarSeedV3PreflightSnapshot,
  type Nhm2ProlateBosonStarSeedV3VerifierPreflightInput,
} from "../nhm2-prolate-boson-star-seed-v3-provider-preflight";

const digest = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const binding = (
  artifactKind: Nhm2ProlateBosonStarSeedV3PrerequisiteArtifactKind,
  salt: string = artifactKind,
): Nhm2ProlateBosonStarSeedV3PrerequisiteBinding =>
  Object.freeze({
    bindingVersion:
      NHM2_PROLATE_BOSON_STAR_SEED_V3_PREREQUISITE_BINDING_VERSION,
    artifactKind,
    sha256Domain: `nhm2-test-${artifactKind}/v1\n`,
    sha256: digest(salt),
    canonicalSizeBytes: 100 + salt.length,
  });

const providerFixture = (
  options: Readonly<{
    providerId?: string;
    runPlanBinding?: unknown;
    registryBinding?: unknown;
    formEnvelope?: (
      input: Nhm2ProlateBosonStarSeedV3LaunchEnvelopeFormationInput,
    ) => unknown;
  }> = {},
) => {
  let clock = 1_000_000n;
  const readClockMonotonicRawNanoseconds = vi.fn(() => {
    clock += 10n;
    return clock.toString();
  });
  const formVerifierLaunchEnvelope = vi.fn(
    async (input: Nhm2ProlateBosonStarSeedV3LaunchEnvelopeFormationInput) => {
      if (options.formEnvelope != null) return options.formEnvelope(input);
      return Object.freeze({
        stageId: input.stageId,
        sameAttemptId: input.sameAttemptId,
        schedulerLeaseBinding: input.schedulerLeaseBinding,
        verifierWorkerAttemptBinding: input.verifierWorkerAttemptBinding,
        verifierInputLedgerBinding: input.verifierInputLedgerBinding,
        verifierRuntimeChannelBinding: input.verifierRuntimeChannelBinding,
        launchEnvelopeBinding: binding("verifier_launch_envelope"),
      });
    },
  );
  const launchExactEvidenceAdmittedVerifier = vi.fn(
    async (_snapshot: Nhm2ProlateBosonStarSeedV3PreflightSnapshot) =>
      Object.freeze({
        status: "raw_evidence_only" as const,
        rawEvidenceCanonicalUtf8Bytes: Object.freeze([
          Uint8Array.from([0x7b, 0x7d]),
        ]),
        issues: Object.freeze([]),
      }),
  );
  const value = Object.freeze({
    providerVersion: NHM2_PROLATE_BOSON_STAR_SEED_V3_PROVIDER_VERSION,
    providerId: options.providerId ?? "sealed-linux-provider.v3",
    executionTarget: NHM2_PROLATE_BOSON_STAR_SEED_V3_EXECUTION_TARGET,
    platform: "linux" as const,
    runPlanBinding:
      options.runPlanBinding ??
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_BINDING,
    evidenceSchemaRegistryBinding:
      options.registryBinding ??
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY_BINDING,
    readClockMonotonicRawNanoseconds,
    formVerifierLaunchEnvelope,
    launchExactEvidenceAdmittedVerifier,
  }) as unknown as Nhm2ProlateBosonStarSeedIsolatedWorkerProviderV3;
  return {
    value,
    readClockMonotonicRawNanoseconds,
    formVerifierLaunchEnvelope,
    launchExactEvidenceAdmittedVerifier,
  };
};

const preflightInput = (
  providerId = "sealed-linux-provider.v3",
): Nhm2ProlateBosonStarSeedV3VerifierPreflightInput => {
  const sameAttemptId = "0123456789abcdef0123456789abcdef";
  const commonRunRequestBinding = binding("common_run_request");
  const schedulerLeaseBinding = binding("scheduler_lease");
  const producerFullEnforcementBinding = binding(
    "producer_full_enforcement_receipt",
  );
  const numericStaging32CompositeBinding = binding(
    "numeric_staging32_composite",
  );
  const rawEvidence6CompositeBinding = binding("raw_evidence6_composite");
  return Object.freeze({
    providerId,
    successorRunPlanBinding:
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_BINDING,
    evidenceSchemaRegistryBinding:
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY_BINDING,
    numericMaterializationPolicyBinding:
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_NUMERIC_MATERIALIZATION_POLICY_V1_BINDING,
    postprojectionPolicyBinding:
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_POSTPROJECTION_POLICY_V1_BINDING,
    numericOperationGraphBinding:
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_NUMERIC_MATERIALIZATION_POLICY_V1_OPERATION_GRAPH_BINDING,
    postprojectionOperationGraphBinding:
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_POSTPROJECTION_POLICY_V1_OPERATION_GRAPH_BINDING,
    commonRunRequestBinding,
    sameAttemptId,
    schedulerLeaseBinding,
    verifierWorkerAttempt: Object.freeze({
      stageId: "trusted_independent_verifier",
      sameAttemptId,
      schedulerLeaseBinding,
      workerAttemptBinding: binding("worker_attempt", "verifier-worker"),
    }),
    absoluteDeadlineReceiptBinding: binding("absolute_deadline_receipt"),
    verifierQuotaSetupReceiptBinding: binding("verifier_quota_setup_receipt"),
    verifierSeccompLoadReceiptBinding: binding("verifier_seccomp_load_receipt"),
    producerFullEnforcement: Object.freeze({
      stageId: "untrusted_seed_producer",
      sameAttemptId,
      schedulerLeaseBinding,
      binding: producerFullEnforcementBinding,
    }),
    numericStaging32Composite: Object.freeze({
      sameAttemptId,
      binding: numericStaging32CompositeBinding,
    }),
    rawEvidence6Composite: Object.freeze({
      sameAttemptId,
      binding: rawEvidence6CompositeBinding,
    }),
    candidateInstanceIdentity: Object.freeze({
      sameAttemptId,
      commonRunRequestBinding,
      producerFullEnforcementReceiptBinding: producerFullEnforcementBinding,
      numericStaging32CompositeBinding,
      rawEvidence6CompositeBinding,
      binding: binding("candidate_instance_identity"),
    }),
    verifierSourceManifestBinding: binding("verifier_source_manifest"),
    verifierToolchainManifestBinding: binding(
      "verifier_toolchain_manifest",
      "verifier-toolchain",
    ),
    verifierExecutableBinding: binding("verifier_executable"),
    verifierOciImageDigest: `sha256:${digest("verifier-oci-image")}`,
    typedInterpreterBinding: binding("typed_interpreter"),
    independentProofKernelBinding: binding(
      "independent_proof_kernel",
      "proof-kernel",
    ),
    independentProofKernelToolchainBinding: binding(
      "independent_proof_kernel_toolchain",
      "proof-kernel-toolchain",
    ),
    mpfrGmpRuntimeManifestBinding: binding("mpfr_gmp_runtime_manifest"),
    producerProjectionImplementationBinding: binding(
      "producer_projection_implementation",
      "producer-projection",
    ),
    verifierProjectionImplementationBinding: binding(
      "verifier_projection_implementation",
      "verifier-projection",
    ),
    implementationSeparationReceiptBinding: binding(
      "implementation_separation_receipt",
    ),
    verifierInputLedgerBinding: binding("verifier_input_ledger"),
    verifierRuntimeChannelBinding: binding("verifier_runtime_channel"),
  });
};

const installFixture = (options?: Parameters<typeof providerFixture>[0]) => {
  const fixture = providerFixture(options);
  const result =
    installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV3({
      providers: Object.freeze([fixture.value]),
    });
  const handle = result.trustedServerHandles[0]?.handle;
  if (handle == null) throw new Error(result.status.catalogIssues.join(","));
  return { fixture, result, handle };
};

describe("NHM2 seed v3 provider preflight and trusted bootstrap", () => {
  beforeEach(() => {
    installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV3();
  });

  it("starts empty, no-launch, and keeps handles and functions out of metadata", () => {
    const empty =
      installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV3();
    const catalog = inspectNhm2ProlateBosonStarSeedCapabilityCatalogV3();
    const defaultStatus =
      inspectDefaultNhm2ProlateBosonStarSeedV3ProviderStatus();

    expect(empty.status).toMatchObject({
      configured: false,
      catalogEntryCount: 0,
      providersInstalledBehindOpaqueHandles: 0,
      trustedServerHandlesIssued: 0,
      launchResolverInstalled: false,
      launchAttempted: false,
      launchAttemptCount: 0,
      blockerCodes: ["v3_isolated_worker_provider_unconfigured"],
    });
    expect(empty.trustedServerHandles).toEqual([]);
    expect(catalog).toMatchObject({
      configured: false,
      configurationScope: "metadata_only",
      executionConfigured: false,
      launchResolverInstalled: false,
      entries: [],
      launchApi: null,
      trustedServerHandle: null,
    });
    expect(defaultStatus).toMatchObject({
      supported: false,
      provider: null,
      launchApi: null,
      launchAttempted: false,
      launchAttemptCount: 0,
    });
    expect(Object.values(catalog.authorityLocks).every((value) => !value)).toBe(
      true,
    );
  });

  it("pins the exact sealed v3 root, registry, and prelaunch rejection schema", () => {
    expect(
      NHM2_PROLATE_BOSON_STAR_SEED_V3_PROVIDER_SEALED_BINDINGS,
    ).toMatchObject({
      runPlanSha256:
        NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EXPECTED_SHA256,
      evidenceRegistrySha256:
        NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY_BINDING.sha256,
      verifierPrelaunchContextRejectionSchemaBinding:
        NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_SCHEMA_BINDINGS.verifierPrelaunchContextRejection,
    });

    const staleRoot = providerFixture({
      runPlanBinding: Object.freeze({
        ...NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_BINDING,
        sha256: "0".repeat(64),
      }),
    });
    const staleRegistry = providerFixture({
      registryBinding: Object.freeze({
        ...NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY_BINDING,
        sha256: "0".repeat(64),
      }),
    });
    expect(
      installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV3({
        providers: Object.freeze([staleRoot.value]),
      }).status.catalogIssues,
    ).toContain("provider_0:sealed_v3_run_plan_binding_mismatch");
    expect(
      installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV3({
        providers: Object.freeze([staleRegistry.value]),
      }).status.catalogIssues,
    ).toContain("provider_0:sealed_v3_registry_binding_mismatch");
  });

  it("rejects stale asserted root and registry before any envelope or launch work", async () => {
    const { fixture, handle } = installFixture();
    for (const field of [
      "successorRunPlanBinding",
      "evidenceSchemaRegistryBinding",
    ] as const) {
      const input = preflightInput();
      const stale = Object.freeze({
        ...input,
        [field]: Object.freeze({
          ...input[field],
          sha256: "f".repeat(64),
        }),
      });
      const result = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
        handle,
        stale,
      );
      expect(result).toMatchObject({
        ok: false,
        status: "prelaunch_context_rejected",
        rejection: {
          failureCode: "common_run_request_or_policy_input_invalid",
          firstFailedContextField: "commonRunRequestOrPolicyInputs",
          verifierLaunchAuthorized: false,
          executionAuthorized: false,
          registrationAllowed: false,
          artifactAccepted: false,
        },
      });
    }
    expect(fixture.formVerifierLaunchEnvelope).not.toHaveBeenCalled();
    expect(fixture.launchExactEvidenceAdmittedVerifier).not.toHaveBeenCalled();
  });

  it("reports the first missing prerequisite and leaves later evidence null", async () => {
    const { handle } = installFixture();
    const input = preflightInput();
    const missingSource = Object.freeze({
      ...input,
      verifierSourceManifestBinding: null,
    });
    const result = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      missingSource,
    );
    expect(result).toMatchObject({
      ok: false,
      rejection: {
        failureCode:
          "verifier_source_toolchain_executable_or_oci_missing_or_invalid",
        firstFailedContextField:
          "verifierSourceToolchainExecutableOrOciBinding",
        verifierSourceManifestBindingOrNull: null,
        typedInterpreterBindingOrNull: null,
        independentProofKernelBindingOrNull: null,
        attemptedVerifierInputLedgerBindingOrNull: null,
        attemptedVerifierRuntimeChannelBindingOrNull: null,
        attemptedVerifierLaunchEnvelopeBindingOrNull: null,
        allPassed: false,
      },
    });
  });

  it("rejects a mixed candidate attempt after preserving the earlier exact prefix", async () => {
    const { handle } = installFixture();
    const input = preflightInput();
    const mixed = Object.freeze({
      ...input,
      candidateInstanceIdentity: Object.freeze({
        ...input.candidateInstanceIdentity,
        sameAttemptId: "fedcba9876543210fedcba9876543210",
      }),
    });
    const result = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      mixed,
    );
    expect(result).toMatchObject({
      ok: false,
      rejection: {
        failureCode: "candidate_instance_identity_missing_or_mixed",
        firstFailedContextField: "candidateInstanceIdentityBinding",
        sameAttemptIdOrNull: input.sameAttemptId,
        schedulerLeaseBindingOrNull: input.schedulerLeaseBinding,
        producerFullEnforcementReceiptBindingOrNull:
          input.producerFullEnforcement.binding,
        numericStaging32CompositeBindingOrNull:
          input.numericStaging32Composite.binding,
        rawEvidence6CompositeBindingOrNull: input.rawEvidence6Composite.binding,
        candidateInstanceIdentityBindingOrNull: null,
      },
    });
  });

  it("rejects the wrong verifier stage identity as a worker-attempt failure", async () => {
    const { handle } = installFixture();
    const input = preflightInput();
    const wrongStage = Object.freeze({
      ...input,
      verifierWorkerAttempt: Object.freeze({
        ...input.verifierWorkerAttempt,
        stageId: "trusted_descriptor_assembler",
      }),
    });
    const result = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      wrongStage,
    );
    expect(result).toMatchObject({
      ok: false,
      rejection: {
        failureCode: "scheduler_lease_or_worker_attempt_missing_or_invalid",
        firstFailedContextField: "schedulerLeaseOrWorkerAttemptBinding",
        verifierWorkerAttemptBindingOrNull: null,
        verifierLaunchEnvelopeBinding: null,
        compositeReplayBundleBinding: null,
      },
    });
  });

  it("rejects a safe-ID-looking attempt and accepts exact lowercase 128-bit hex", async () => {
    const { fixture, handle } = installFixture();
    const exact = preflightInput();
    const nonHexAttempt = "attempt.v3.safe-id";
    const broadSafeIdOnly = Object.freeze({
      ...exact,
      sameAttemptId: nonHexAttempt,
      verifierWorkerAttempt: Object.freeze({
        ...exact.verifierWorkerAttempt,
        sameAttemptId: nonHexAttempt,
      }),
      producerFullEnforcement: Object.freeze({
        ...exact.producerFullEnforcement,
        sameAttemptId: nonHexAttempt,
      }),
      numericStaging32Composite: Object.freeze({
        ...exact.numericStaging32Composite,
        sameAttemptId: nonHexAttempt,
      }),
      rawEvidence6Composite: Object.freeze({
        ...exact.rawEvidence6Composite,
        sameAttemptId: nonHexAttempt,
      }),
      candidateInstanceIdentity: Object.freeze({
        ...exact.candidateInstanceIdentity,
        sameAttemptId: nonHexAttempt,
      }),
    });
    const rejected = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      broadSafeIdOnly,
    );
    expect(rejected).toMatchObject({
      ok: false,
      rejection: {
        failureCode: "scheduler_lease_or_worker_attempt_missing_or_invalid",
        sameAttemptIdOrNull: null,
      },
    });
    expect(fixture.formVerifierLaunchEnvelope).not.toHaveBeenCalled();

    expect(exact.sameAttemptId).toMatch(/^[0-9a-f]{32}$/);
    const accepted = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      exact,
    );
    expect(accepted).toMatchObject({
      ok: true,
      status: "syntactic_preflight_snapshot_launch_ineligible",
      snapshot: {
        sameAttemptId: exact.sameAttemptId,
        attemptedLaunchEnvelopeBinding: null,
        launchEligible: false,
      },
    });
    expect(fixture.formVerifierLaunchEnvelope).not.toHaveBeenCalled();
    expect(fixture.launchExactEvidenceAdmittedVerifier).not.toHaveBeenCalled();
  });

  it("does not invoke provider envelope formation before exact evidence admission", async () => {
    const { fixture, handle } = installFixture({
      formEnvelope: () => {
        throw new Error("provider_envelope_callback_must_not_run");
      },
    });
    const input = preflightInput();
    const result = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      input,
    );
    expect(result).toMatchObject({
      ok: true,
      status: "syntactic_preflight_snapshot_launch_ineligible",
      snapshot: {
        attemptedLaunchEnvelopeBinding: null,
        exactRuntimeEvidenceInterpretationCompleted: false,
        launchEligible: false,
      },
    });
    expect(fixture.formVerifierLaunchEnvelope).not.toHaveBeenCalled();
    expect(fixture.launchExactEvidenceAdmittedVerifier).not.toHaveBeenCalled();
  });

  it("keeps the actual proof kernel distinct from both toolchains", async () => {
    const { handle } = installFixture();
    const input = preflightInput();
    const sameDigestAsProofToolchain = Object.freeze({
      ...input.independentProofKernelBinding,
      sha256: input.independentProofKernelToolchainBinding.sha256,
    });
    const result = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      Object.freeze({
        ...input,
        independentProofKernelBinding: sameDigestAsProofToolchain,
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      rejection: {
        failureCode: "proof_kernel_or_toolchain_missing_or_invalid",
        firstFailedContextField: "independentProofKernelOrToolchainBinding",
      },
    });

    const toolchainCollision = Object.freeze({
      ...input.independentProofKernelToolchainBinding,
      sha256: input.verifierToolchainManifestBinding.sha256,
    });
    const second = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      Object.freeze({
        ...input,
        independentProofKernelToolchainBinding: toolchainCollision,
      }),
    );
    expect(second).toMatchObject({
      ok: false,
      rejection: {
        failureCode: "proof_kernel_or_toolchain_missing_or_invalid",
      },
    });

    const kernelVerifierToolchainCollision = Object.freeze({
      ...input.independentProofKernelBinding,
      sha256: input.verifierToolchainManifestBinding.sha256,
    });
    const third = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      Object.freeze({
        ...input,
        independentProofKernelBinding: kernelVerifierToolchainCollision,
      }),
    );
    expect(third).toMatchObject({
      ok: false,
      rejection: {
        failureCode: "proof_kernel_or_toolchain_missing_or_invalid",
      },
    });
  });

  it("forms only a frozen syntactic snapshot and cannot launch without an unissued exact-evidence token", async () => {
    const { fixture, result: installed, handle } = installFixture();
    const input = preflightInput();
    const preflight = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      input,
    );
    expect(preflight).toMatchObject({
      ok: true,
      status: "syntactic_preflight_snapshot_launch_ineligible",
      blocker:
        "exact_v3_runtime_evidence_interpretation_and_admission_token_absent",
      snapshot: {
        stageId: "trusted_independent_verifier",
        sameAttemptId: input.sameAttemptId,
        exactRuntimeEvidenceInterpretationCompleted: false,
        launchEligible: false,
        launchAuthorityFromMetadata: false,
        executionAuthorized: false,
        artifactAuthorityGranted: false,
        scientificAuthorityGranted: false,
        physicalAuthorityGranted: false,
      },
      exactSchemaInterpretationCompleted: false,
      launchEligible: false,
    });
    if (preflight.ok === false) throw new Error(preflight.status);
    expect(Object.isFrozen(preflight.snapshot)).toBe(true);
    expect(Object.isFrozen(preflight.snapshot.input)).toBe(true);
    expect(preflight.snapshot.input).not.toBe(input);
    expect(Reflect.ownKeys(handle)).toEqual([]);
    expect(fixture.launchExactEvidenceAdmittedVerifier).not.toHaveBeenCalled();

    const launch =
      await launchNhm2ProlateBosonStarSeedVerifierWithTrustedServerHandleV3(
        handle,
        preflight.snapshot,
        Object.freeze(
          {},
        ) as Nhm2ProlateBosonStarSeedV3ExactEvidenceAdmissionToken,
      );
    expect(launch).toMatchObject({
      status: "provider_failed",
      rawEvidenceCanonicalUtf8Bytes: [],
      issues: ["exact_v3_runtime_evidence_admission_token_required"],
    });
    expect(fixture.launchExactEvidenceAdmittedVerifier).not.toHaveBeenCalled();
    expect(installed.status.launchAttempted).toBe(false);
    expect(installed.status).toMatchObject({
      configured: false,
      catalogConfigured: true,
      launchResolverInstalled: false,
      blockerCodes: [
        "exact_v3_runtime_evidence_interpretation_and_admission_token_absent",
      ],
    });

    const catalog = inspectNhm2ProlateBosonStarSeedCapabilityCatalogV3();
    expect(catalog.entries).toHaveLength(1);
    expect(catalog).toMatchObject({
      configured: true,
      configurationScope: "metadata_only",
      executionConfigured: false,
      launchResolverInstalled: false,
    });
    expect(catalog.launchApi).toBeNull();
    expect(catalog.trustedServerHandle).toBeNull();
    expect(catalog.entries[0]).toMatchObject({
      launchApiExposed: false,
      trustedServerHandleExposed: false,
      defaultLaunchAllowed: false,
      executionAuthorityGranted: false,
    });
    expect(
      Object.values(catalog.entries[0] ?? {}).some(
        (value) => typeof value === "function",
      ),
    ).toBe(false);
    expect(
      resolveNhm2ProlateBosonStarSeedCapabilityCatalogEntryV3({
        providerId: "sealed-linux-provider.v3",
        runPlanSha256:
          NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_BINDING.sha256,
        evidenceRegistrySha256:
          NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY_BINDING.sha256,
      }),
    ).toBe(catalog.entries[0]);
  });

  it("emits the exact rejection key inventory and keeps every v3 claim lock false", async () => {
    const { handle } = installFixture();
    const input = preflightInput();
    const result = await preflightNhm2ProlateBosonStarSeedVerifierContextV3(
      handle,
      Object.freeze({ ...input, typedInterpreterBinding: null }),
    );
    if (result.status !== "prelaunch_context_rejected") {
      throw new Error(result.status);
    }
    expect(Object.keys(result.rejection).sort()).toEqual(
      [
        ...NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_VERIFIER_PRELAUNCH_CONTEXT_REJECTION_SCHEMA
          .topLevel.exactKeys,
      ].sort(),
    );
    expect(
      Object.values(result.rejection).filter((value) => value === true),
    ).toEqual([true]);
    expect(
      Object.values(
        NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3.claimLocks,
      ).every((value) => value === false),
    ).toBe(true);
  });
});
