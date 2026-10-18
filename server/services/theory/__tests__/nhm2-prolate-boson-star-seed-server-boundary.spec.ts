import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_BINDING,
  NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_CONTROL_PLANE_EVIDENCE_GRAMMAR_REGISTRY,
} from "../../../../shared/contracts/nhm2-prolate-boson-star-newtonian-seed-run-plan.v1";
import {
  inspectNhm2ProlateBosonStarSeedCapabilityCatalogV1,
  installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV1,
  resolveNhm2ProlateBosonStarSeedCapabilityCatalogEntryV1,
} from "../nhm2-prolate-boson-star-seed-execution-registry-bootstrap";
import {
  NHM2_PROLATE_BOSON_STAR_SEED_ISOLATED_WORKER_CAPABILITY_PROFILE,
  NHM2_PROLATE_BOSON_STAR_SEED_ISOLATED_WORKER_EXECUTION_TARGET,
  NHM2_PROLATE_BOSON_STAR_SEED_ISOLATED_WORKER_PROVIDER_VERSION,
  inspectDefaultNhm2ProlateBosonStarSeedIsolatedWorkerProviderV1,
  snapshotNhm2ProlateBosonStarSeedIsolatedWorkerProviderV1,
  type Nhm2ProlateBosonStarSeedIsolatedWorkerProviderV1,
} from "../nhm2-prolate-boson-star-seed-isolated-worker-provider";
import {
  NHM2_PROLATE_BOSON_STAR_SEED_RUN_SERVER_AUTHORITY_LOCKS,
  interpretNhm2ProlateBosonStarSeedRunEvidenceV1,
  type Nhm2ProlateBosonStarSeedRunControlPlaneBindingV1,
} from "../nhm2-prolate-boson-star-seed-run-evidence-interpreter";

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("unsupported_json_value");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const capabilityValue = () => ({
  schemaVersion:
    "nhm2.prolate_boson_star.newtonian_seed.isolated_worker_capability/v1",
  runPlanBinding: NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_BINDING,
  architecture: "linux_x86_64",
  linuxKernelRelease: "6.8.0-attested",
  ociRuntimeName: "crun",
  ociRuntimeVersion: "1.14.4",
  cgroupVersion: 2,
  requiredControllerOrder: ["memory", "pids"],
  cgroupKillSupported: true,
  openat2ResolveFlagsSupported: true,
  seccompFilterSupported: true,
  projectQuotaSupported: true,
  rlimitFsizeSupported: true,
  attestedByBrokerFileObservation: {
    absolutePath: "/usr/bin/crun",
    byteLength: 1_048_576,
    sha256: "a".repeat(64),
    mountId: "11",
    deviceId: "22",
    inode: "33",
    linkCount: 1,
    modeFileType: "regular_file",
    mtimeNanoseconds: "44",
    ctimeNanoseconds: "55",
    secureResolutionPassed: true,
    statReadStatStable: true,
  },
  capabilityProbeMonotonicNanoseconds: "1000000",
  allRequiredCapabilitiesPresent: true,
});

const capabilityEvidence = (value: unknown = capabilityValue()) => {
  const canonical = canonicalJson(value);
  const bytes = Buffer.from(canonical, "utf8");
  const registry =
    NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_CONTROL_PLANE_EVIDENCE_GRAMMAR_REGISTRY;
  const profile = registry.artifactBindingProfiles.isolatedWorkerCapability;
  const domain = registry.domains.isolatedWorkerCapability;
  const binding: Nhm2ProlateBosonStarSeedRunControlPlaneBindingV1 =
    Object.freeze({
      bindingVersion: "nhm2.control_plane.domain_hash_binding/v1",
      artifactKind: profile.artifactKind,
      sha256Domain: domain,
      sha256: createHash("sha256")
        .update(domain, "utf8")
        .update(bytes)
        .digest("hex"),
      canonicalSizeBytes: bytes.byteLength,
    });
  return Object.freeze({ canonicalUtf8Bytes: bytes, binding });
};

const provider = (
  providerId = "sealed-linux-provider.v1",
  evidence = capabilityEvidence(),
) => {
  const inspectCapabilityEvidence = vi.fn(async () => evidence);
  const launchSealedRun = vi.fn(async () => ({
    status: "provider_failed" as const,
    rawEvidenceCanonicalUtf8Bytes: Object.freeze([]),
    issues: Object.freeze(["test_launch_must_not_be_called"]),
    authorityLocks: NHM2_PROLATE_BOSON_STAR_SEED_RUN_SERVER_AUTHORITY_LOCKS,
  }));
  const value: Nhm2ProlateBosonStarSeedIsolatedWorkerProviderV1 = Object.freeze(
    {
      providerVersion:
        NHM2_PROLATE_BOSON_STAR_SEED_ISOLATED_WORKER_PROVIDER_VERSION,
      providerId,
      executionTarget:
        NHM2_PROLATE_BOSON_STAR_SEED_ISOLATED_WORKER_EXECUTION_TARGET,
      platform: "linux",
      capabilityProfile:
        NHM2_PROLATE_BOSON_STAR_SEED_ISOLATED_WORKER_CAPABILITY_PROFILE,
      runPlan: NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1,
      runPlanBinding:
        NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_BINDING,
      inspectCapabilityEvidence,
      launchSealedRun,
    },
  );
  return { value, inspectCapabilityEvidence, launchSealedRun };
};

describe("NHM2 prolate boson-star seed server boundary", () => {
  beforeEach(async () => {
    await installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV1();
  });

  it("validates only the imported isolated-worker profile and its canonical domain hash", () => {
    const evidence = capabilityEvidence();
    const result = interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
      "isolatedWorkerCapability",
      evidence.canonicalUtf8Bytes,
      evidence.binding,
    );

    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.code);
    expect(result.schemaName).toBe("isolatedWorkerCapability");
    expect(result.checks).toEqual({
      profileRegistered: true,
      instanceHashGrammarRegistered: true,
      supportedSchemaShapeValidated: true,
      canonicalUtf8Exact: true,
      bindingVersionExact: true,
      artifactKindExact: true,
      sha256DomainExact: true,
      canonicalSizeExact: true,
      domainSeparatedSha256Exact: true,
      descriptiveRegistryCrossFieldInvariantsIndependentlyReplayed: false,
    });
    expect(Object.values(result.authorityLocks).every((value) => !value)).toBe(
      true,
    );
    expect(result.authorityLocks.transportClaimAllowed).toBe(false);
  });

  it("fails closed on unsupported profiles, noncanonical bytes, extra fields, and binding drift", () => {
    const evidence = capabilityEvidence();
    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "stageEnforcementReceipt",
        evidence.canonicalUtf8Bytes,
        evidence.binding,
      ),
    ).toMatchObject({ ok: false, code: "unsupported_profile" });

    const noncanonicalBytes = Buffer.from(
      JSON.stringify(capabilityValue(), null, 2),
      "utf8",
    );
    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        noncanonicalBytes,
        evidence.binding,
      ),
    ).toMatchObject({ ok: false, code: "evidence_json_noncanonical" });

    const extra = capabilityEvidence({ ...capabilityValue(), extra: true });
    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        extra.canonicalUtf8Bytes,
        extra.binding,
      ),
    ).toMatchObject({ ok: false, code: "evidence_schema_invalid" });

    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        evidence.canonicalUtf8Bytes,
        { ...evidence.binding, sha256Domain: "wrong-domain\n" },
      ),
    ).toMatchObject({ ok: false, code: "binding_profile_mismatch" });
    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        evidence.canonicalUtf8Bytes,
        { ...evidence.binding, canonicalSizeBytes: 1 },
      ),
    ).toMatchObject({ ok: false, code: "binding_size_mismatch" });
    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        evidence.canonicalUtf8Bytes,
        { ...evidence.binding, sha256: "0".repeat(64) },
      ),
    ).toMatchObject({ ok: false, code: "binding_hash_mismatch" });
  });

  it("accepts the exact serialized run-plan binding value but rejects drift and invalid UTF-8", () => {
    const copiedBindingValue = {
      ...capabilityValue(),
      runPlanBinding: {
        ...NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_BINDING,
      },
    };
    const copiedBindingEvidence = capabilityEvidence(copiedBindingValue);
    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        copiedBindingEvidence.canonicalUtf8Bytes,
        copiedBindingEvidence.binding,
      ),
    ).toMatchObject({ ok: true });

    const semanticallyWrong = {
      ...capabilityValue(),
      runPlanBinding: {
        ...NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_BINDING,
        sha256: "f".repeat(64),
      },
    };
    const semanticallyWrongEvidence = capabilityEvidence(semanticallyWrong);
    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        semanticallyWrongEvidence.canonicalUtf8Bytes,
        semanticallyWrongEvidence.binding,
      ),
    ).toMatchObject({ ok: false, code: "evidence_schema_invalid" });

    expect(
      interpretNhm2ProlateBosonStarSeedRunEvidenceV1(
        "isolatedWorkerCapability",
        Uint8Array.from([0xff]),
        copiedBindingEvidence.binding,
      ),
    ).toMatchObject({ ok: false, code: "evidence_utf8_invalid" });
  });

  it("reports the built-in provider path as unsupported with zero launch", () => {
    const status =
      inspectDefaultNhm2ProlateBosonStarSeedIsolatedWorkerProviderV1();
    const catalog = inspectNhm2ProlateBosonStarSeedCapabilityCatalogV1();
    expect(status).toMatchObject({
      supported: false,
      provider: null,
      launchApi: null,
      launchAttempted: false,
      launchAttemptCount: 0,
    });
    expect(status.code).toBe(
      process.platform === "win32"
        ? "current_windows_host_ineligible"
        : "external_linux_provider_unconfigured",
    );
    expect(Object.values(status.authorityLocks).every((value) => !value)).toBe(
      true,
    );
    expect(catalog).toMatchObject({
      configured: false,
      entries: [],
      launchApi: null,
    });
  });

  it("installs only metadata after exact capability evidence preflight and never calls launch", async () => {
    const fixture = provider();
    const status =
      await installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV1(
        { providers: Object.freeze([fixture.value]) },
      );

    expect(status).toMatchObject({
      catalogConfigured: true,
      catalogEntryCount: 1,
      providersSubmitted: 1,
      capabilityEvidencePreflighted: 1,
      launchAttempted: false,
      launchAttemptCount: 0,
      launchResolverInstalled: false,
      catalogIssues: [],
      blockerCodes: [],
    });
    expect(fixture.inspectCapabilityEvidence).toHaveBeenCalledTimes(1);
    expect(fixture.launchSealedRun).not.toHaveBeenCalled();

    const catalog = inspectNhm2ProlateBosonStarSeedCapabilityCatalogV1();
    expect(catalog.configured).toBe(true);
    expect(catalog.launchApi).toBeNull();
    expect(catalog.entries[0]).toMatchObject({
      providerId: "sealed-linux-provider.v1",
      descriptiveCrossFieldInvariantsIndependentlyReplayed: false,
      launchApiExposed: false,
      executionAuthorityGranted: false,
      artifactAuthorityGranted: false,
      physicalAuthorityGranted: false,
    });
    const sha256 = catalog.entries[0]?.capabilityBinding.sha256 ?? "";
    expect(
      resolveNhm2ProlateBosonStarSeedCapabilityCatalogEntryV1({
        providerId: "sealed-linux-provider.v1",
        capabilitySha256: sha256,
      }),
    ).toBe(catalog.entries[0]);
    expect(
      resolveNhm2ProlateBosonStarSeedCapabilityCatalogEntryV1({
        providerId: "sealed-linux-provider.v1",
        capabilitySha256: "0".repeat(64),
      }),
    ).toBeNull();
  });

  it("clears the catalog on any provider or evidence failure", async () => {
    const good = provider("good-provider.v1");
    const badEvidence = capabilityEvidence();
    const bad = provider(
      "bad-provider.v1",
      Object.freeze({
        canonicalUtf8Bytes: badEvidence.canonicalUtf8Bytes,
        binding: Object.freeze({
          ...badEvidence.binding,
          sha256: "0".repeat(64),
        }),
      }),
    );
    const status =
      await installNhm2ProlateBosonStarSeedExecutionRegistryAtServerBootstrapV1(
        { providers: Object.freeze([good.value, bad.value]) },
      );

    expect(status.catalogConfigured).toBe(false);
    expect(status.catalogEntryCount).toBe(0);
    expect(status.blockerCodes).toContain(
      "capability_attestation_preflight_incomplete",
    );
    expect(good.launchSealedRun).not.toHaveBeenCalled();
    expect(bad.launchSealedRun).not.toHaveBeenCalled();
    expect(
      inspectNhm2ProlateBosonStarSeedCapabilityCatalogV1().entries,
    ).toEqual([]);
  });

  it("rejects accessor and proxy provider surfaces without invoking them", () => {
    const base = provider().value;
    const copiedBindingProvider = Object.freeze({
      ...base,
      runPlanBinding: Object.freeze({
        ...NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V1_BINDING,
      }),
    });
    expect(
      snapshotNhm2ProlateBosonStarSeedIsolatedWorkerProviderV1(
        copiedBindingProvider,
      ),
    ).toMatchObject({
      ok: false,
      issues: ["authoritative_run_plan_binding_singleton_required"],
    });

    let getterCalls = 0;
    const accessorProvider = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== "providerId"),
    ) as Record<string, unknown>;
    Object.defineProperty(accessorProvider, "providerId", {
      enumerable: true,
      configurable: false,
      get: () => {
        getterCalls += 1;
        return "accessor-provider.v1";
      },
    });
    Object.freeze(accessorProvider);
    expect(
      snapshotNhm2ProlateBosonStarSeedIsolatedWorkerProviderV1(
        accessorProvider,
      ),
    ).toMatchObject({ ok: false });
    expect(getterCalls).toBe(0);

    const hostileProxy = new Proxy(Object.freeze({}), {
      ownKeys: () => {
        throw new Error("hostile proxy");
      },
    });
    expect(
      snapshotNhm2ProlateBosonStarSeedIsolatedWorkerProviderV1(hostileProxy),
    ).toMatchObject({ ok: false });
  });
});
