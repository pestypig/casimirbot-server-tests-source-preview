import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS } from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-raw-replay-schema.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_PAIR_CHECK_OUTCOME_ROLES,
  NHM2_SPHERICAL_BOSON_STAR_V2_PAIR_COMPARISON_RELATION_BY_TOLERANCE_ID,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-pair-agreement.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_PRIMARY_SCIENCE_REPLAY_ADAPTER_ARTIFACT_ID,
  NHM2_SPHERICAL_BOSON_STAR_V2_PRIMARY_SCIENCE_REPLAY_ADAPTER_CONTRACT_VERSION,
  replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem,
  type Nhm2SphericalBosonStarV2PrimaryScienceReplayReceiptV1,
} from "../nhm2-spherical-boson-star-v2-primary-science-replay-adapter";

const OUTPUT_PREFIX = "{outputDirectory}/";
const tempParents: string[] = [];

type Descriptor =
  (typeof NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS)[number];
type ConstraintDescriptor = Extract<Descriptor, { familyId: string }>;

const relativePath = (descriptor: Descriptor): string => {
  expect(descriptor.path.startsWith(OUTPUT_PREFIX)).toBe(true);
  return descriptor.path.slice(OUTPUT_PREFIX.length);
};

const fillFloat64Le = (buffer: Buffer, value: number): void => {
  for (let offset = 0; offset < buffer.byteLength; offset += 8)
    buffer.writeDoubleLE(value, offset);
};

const levelResidual = (levelId: ConstraintDescriptor["levelId"]): number =>
  levelId === "level_0" ? 0.04 : levelId === "level_1" ? 0.02 : 0.01;

const fixtureBytes = (
  descriptor: Descriptor,
  options: Readonly<{
    badWeights: boolean;
    nonuniformNormalizedWeights: boolean;
    mismatchAntisymmetryResidualEcho: boolean;
    negativeRoleValue: boolean;
    noiseFailure: boolean;
    overflowAntisymmetry: boolean;
    psdNegativeWitness: boolean;
  }>,
): Buffer => {
  const bytes = Buffer.alloc(descriptor.sizeBytes);
  if (descriptor.role === "noise_kernel" && options.psdNegativeWitness) {
    bytes.writeDoubleLE(1e-3, 8);
    bytes.writeDoubleLE(1e-3, 80);
    return bytes;
  }
  if (descriptor.role === "noise_kernel" && options.noiseFailure) {
    // [point_0,point_0,component_0:component_0] makes fluctuation large;
    // the unmatched [component_0:component_1] entry violates exchange.
    bytes.writeDoubleLE(128, 0);
    bytes.writeDoubleLE(1, 8);
    return bytes;
  }
  if (
    descriptor.role === "noise_kernel_absolute_uncertainty95" &&
    options.negativeRoleValue
  ) {
    bytes.writeDoubleLE(-1, 0);
    return bytes;
  }
  if (descriptor.role === "mean_rset" && options.psdNegativeWitness) {
    bytes.writeDoubleLE(1e12, 0);
    return bytes;
  }
  if (descriptor.role === "smearing_weights") {
    if (options.nonuniformNormalizedWeights) {
      fillFloat64Le(bytes, 1 / 64);
      bytes.writeDoubleLE(1 / 32, 0);
      bytes.writeDoubleLE(0, 8);
    } else fillFloat64Le(bytes, options.badWeights ? 1 / 128 : 1 / 64);
    return bytes;
  }
  if (!("familyId" in descriptor)) return bytes;
  const value = levelResidual(descriptor.levelId);
  if (
    options.overflowAntisymmetry &&
    descriptor.levelId === "level_0" &&
    descriptor.familyId === "antisymmetry" &&
    (descriptor.operandRole === "forward" ||
      descriptor.operandRole === "reverse")
  ) {
    bytes.writeDoubleLE(Number.MAX_VALUE, 0);
    return bytes;
  }
  if (
    (descriptor.familyId === "antisymmetry" &&
      descriptor.operandRole === "forward") ||
    (descriptor.familyId === "jacobi" && descriptor.operandRole === "term_1")
  ) {
    fillFloat64Le(bytes, value);
  }
  if (
    descriptor.operandRole === "residual" &&
    (descriptor.familyId === "antisymmetry" ||
      descriptor.familyId === "jacobi") &&
    !(
      options.mismatchAntisymmetryResidualEcho &&
      descriptor.familyId === "antisymmetry"
    )
  ) {
    fillFloat64Le(bytes, value);
  }
  // Deliberately extreme but finite submitted target echoes. With no genuine
  // server target capability, these bytes must never enter bracket formulas.
  if (
    descriptor.operandRole === "target" &&
    (descriptor.familyId === "H_H" ||
      descriptor.familyId === "H_Hi" ||
      descriptor.familyId === "Hi_Hj")
  ) {
    fillFloat64Le(bytes, 1_000_000);
  }
  return bytes;
};

const createFilesystemFixture = async (
  options: Readonly<{
    badWeights?: boolean;
    nonuniformNormalizedWeights?: boolean;
    mismatchAntisymmetryResidualEcho?: boolean;
    negativeRoleValue?: boolean;
    noiseFailure?: boolean;
    overflowAntisymmetry?: boolean;
    psdNegativeWitness?: boolean;
  }> = {},
): Promise<{ parent: string; root: string }> => {
  const tempRoot = await fs.realpath(os.tmpdir());
  const parent = await fs.mkdtemp(
    path.join(tempRoot, "nhm2-spherical-v2-primary-replay-"),
  );
  tempParents.push(parent);
  const root = path.join(parent, "output");
  await fs.mkdir(root);
  for (const descriptor of NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS) {
    const absolutePath = path.join(
      root,
      ...relativePath(descriptor).split("/"),
    );
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(
      absolutePath,
      fixtureBytes(descriptor, {
        badWeights: options.badWeights ?? false,
        nonuniformNormalizedWeights:
          options.nonuniformNormalizedWeights ?? false,
        mismatchAntisymmetryResidualEcho:
          options.mismatchAntisymmetryResidualEcho ?? false,
        negativeRoleValue: options.negativeRoleValue ?? false,
        noiseFailure: options.noiseFailure ?? false,
        overflowAntisymmetry: options.overflowAntisymmetry ?? false,
        psdNegativeWitness: options.psdNegativeWitness ?? false,
      }),
    );
  }
  return { parent, root };
};

const mockLinuxObserverHost = (): void => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
};

const containsFloat64Array = (
  value: unknown,
  seen = new Set<object>(),
): boolean => {
  if (value instanceof Float64Array) return true;
  if (value == null || typeof value !== "object" || seen.has(value as object))
    return false;
  seen.add(value as object);
  return Reflect.ownKeys(value as object).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    return (
      descriptor != null &&
      "value" in descriptor &&
      containsFloat64Array(descriptor.value, seen)
    );
  });
};

const expectAllAuthorityLocked = (
  receipt: Nhm2SphericalBosonStarV2PrimaryScienceReplayReceiptV1,
): void => {
  expect(Object.values(receipt.authorityBoundary)).toEqual(
    Array(Object.keys(receipt.authorityBoundary).length).fill(false),
  );
  expect(receipt.overallDisposition).toBe("blocked");
  expect(receipt.readiness).toBe(false);
  expect(receipt.primaryReplayComplete).toBe(false);
  expectExactNormalizedProjection(receipt);
};

const expectExactNormalizedProjection = (
  receipt: Nhm2SphericalBosonStarV2PrimaryScienceReplayReceiptV1,
): void => {
  expect(receipt.normalizedOutcomeProjection).toHaveLength(30);
  expect(
    receipt.normalizedOutcomeProjection.map((entry) => entry.ordinal),
  ).toEqual(Array.from({ length: 30 }, (_, ordinal) => ordinal));
  expect(
    receipt.normalizedOutcomeProjection.map((entry) => ({
      checkId: entry.checkId,
      scopeId: entry.scopeId,
      appliedToleranceIds: entry.appliedToleranceIds,
    })),
  ).toEqual(
    NHM2_SPHERICAL_BOSON_STAR_V2_PAIR_CHECK_OUTCOME_ROLES.map((role) => ({
      checkId: role.checkId,
      scopeId: role.scopeId,
      appliedToleranceIds: role.appliedToleranceIds,
    })),
  );
  for (const entry of receipt.normalizedOutcomeProjection) {
    expect(Object.keys(entry)).toEqual([
      "ordinal",
      "checkId",
      "scopeId",
      "disposition",
      "appliedToleranceIds",
      "appliedToleranceResults",
      "orderedIssueCodes",
    ]);
    expect(
      entry.appliedToleranceResults.map((result) => result.toleranceId),
    ).toEqual(entry.appliedToleranceIds);
    for (const result of entry.appliedToleranceResults) {
      expect(Object.keys(result)).toEqual([
        "toleranceId",
        "comparisonRelation",
        "satisfied",
      ]);
      expect(result.comparisonRelation).toBe(
        NHM2_SPHERICAL_BOSON_STAR_V2_PAIR_COMPARISON_RELATION_BY_TOLERANCE_ID[
          result.toleranceId as keyof typeof NHM2_SPHERICAL_BOSON_STAR_V2_PAIR_COMPARISON_RELATION_BY_TOLERANCE_ID
        ],
      );
    }
  }
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const parent of tempParents.splice(0))
    await fs.rm(parent, { recursive: true, force: true });
});

describe("spherical boson-star v2 primary server science replay adapter", () => {
  it("rejects caller graphs without traversing arrays, proxies, or accessors", async () => {
    mockLinuxObserverHost();
    let ownKeysCalls = 0;
    let getCalls = 0;
    const hostile = new Proxy(
      {
        files: [new Float64Array(1_000_000)],
      },
      {
        ownKeys() {
          ownKeysCalls += 1;
          return Array.from({ length: 1_000_000 }, (_, index) => `k${index}`);
        },
        get() {
          getCalls += 1;
          throw new Error("caller graph must remain opaque");
        },
      },
    );
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        hostile as never,
      );
    expect(receipt.blockers).toEqual(["filesystem_ingress_invalid"]);
    expect(receipt.filesystemBinding.observationAccepted).toBe(false);
    expect(ownKeysCalls).toBe(0);
    expect(getCalls).toBe(0);
    expectAllAuthorityLocked(receipt);
  });

  it("fails closed off Linux before any filesystem call", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const lstatSpy = vi.spyOn(fs, "lstat");
    const realpathSpy = vi.spyOn(fs, "realpath");
    const opendirSpy = vi.spyOn(fs, "opendir");
    const openSpy = vi.spyOn(fs, "open");

    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        path.resolve(os.tmpdir(), "nhm2-primary-off-linux"),
      );
    expect(receipt.blockers).toEqual(["filesystem_platform_inadmissible"]);
    expect(lstatSpy).not.toHaveBeenCalled();
    expect(realpathSpy).not.toHaveBeenCalled();
    expect(opendirSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expectAllAuthorityLocked(receipt);
  });

  it("rebinds exactly 68 observed roles, rejects a forged target capability without traps, and recomputes feasible science", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture();
    let targetOwnKeysCalls = 0;
    let targetGetCalls = 0;
    const forgedTargetCapability = new Proxy(
      {
        targets: Array.from({ length: 9 }, () => new Float64Array(256)),
      },
      {
        ownKeys() {
          targetOwnKeysCalls += 1;
          throw new Error("forged target must not be traversed");
        },
        get() {
          targetGetCalls += 1;
          throw new Error("forged target must not be traversed");
        },
      },
    );

    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
        forgedTargetCapability,
      );

    expect(receipt).toMatchObject({
      artifactId:
        NHM2_SPHERICAL_BOSON_STAR_V2_PRIMARY_SCIENCE_REPLAY_ADAPTER_ARTIFACT_ID,
      contractVersion:
        NHM2_SPHERICAL_BOSON_STAR_V2_PRIMARY_SCIENCE_REPLAY_ADAPTER_CONTRACT_VERSION,
      candidateId:
        "nhm2.semiclassical_v2.spherical_boson_star_1s_weak_field_control/v1",
      stage: "stage_2_candidate_specific_primary_server_science_replay",
      calculationOnly: true,
      serverOwned: true,
      candidateDisposition: "blocked_pending_authority",
    });
    expect(receipt.filesystemBinding).toMatchObject({
      observationAccepted: true,
      exact68RolesBound: true,
      rootRealPath: fixture.root,
      boundedSequentialCurrentReadOnly: true,
      atomicSnapshotOrStabilityThroughReturnClaimed: false,
    });
    expect(receipt.filesystemBinding.rawHashClosureSha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(receipt.targetBoundary).toEqual({
      callerTargetArraysAccepted: false,
      submittedRawTargetsAuthoritative: false,
      authenticatedServerTargetCapabilityAccepted: false,
      authenticatedTargetBinding: null,
      targetCapabilityIssuerPresent: false,
    });
    expect(receipt.blockers).toEqual(
      expect.arrayContaining([
        "metric_demand_static_input_capability_missing",
        "server_recomputed_classical_target_capability_unauthenticated",
        "si_normalization_content_binding_missing",
        "execution_provenance_and_preseal_unverified",
        "independent_implementation_agreement_missing",
      ]),
    );
    expect(receipt.failures).toEqual([]);
    expect(targetOwnKeysCalls).toBe(0);
    expect(targetGetCalls).toBe(0);

    expect(receipt.metrics.input).toEqual({
      fileCount: 68,
      float64ValueCount: 836_672,
      allValuesFinite: true,
      allNegativeZeroExcluded: true,
      allRoleSensitiveValuesNonnegative: true,
    });
    expect(receipt.metrics.noise).toMatchObject({
      exchangeResidualUpper95SI: 0,
      psdDisposition: "tolerance_certified",
      minimumGershgorinLowerSI: 0,
      maximumEigenvalueUpper95SI: 0,
    });
    expect(receipt.metrics.fluctuation).toMatchObject({
      smearingWeightSum: 1,
      symmetricTensorFrobeniusSI: 0,
      fluctuationAmplitudeUpper95SI: 0,
      fluctuationToMeanRatioUpper95: 0,
    });
    expect(receipt.metrics.residuals).toHaveLength(6);
    expect(
      receipt.metrics.residuals.map(
        (entry) => `${entry.levelId}.${entry.familyId}`,
      ),
    ).toEqual([
      "level_0.antisymmetry",
      "level_1.antisymmetry",
      "level_2.antisymmetry",
      "level_0.jacobi",
      "level_1.jacobi",
      "level_2.jacobi",
    ]);
    expect(
      new Set(receipt.metrics.residuals.map((entry) => entry.familyId)),
    ).toEqual(new Set(["antisymmetry", "jacobi"]));
    expect(
      receipt.metrics.residuals.every(
        (entry) => entry.authoritativeTargetAuthenticated === false,
      ),
    ).toBe(true);
    expect(receipt.metrics.regulator).toHaveLength(2);
    for (const regulator of receipt.metrics.regulator) {
      expect(regulator.pLower).toBeCloseTo(1, 14);
      expect(regulator.qByLevel).toEqual([0.04, 0.02, 0.01]);
      expect(regulator.centralResidualUpper95).toBe(0.01);
      expect(regulator.monotone).toBe(true);
      expect(regulator.pass).toBe(true);
    }
    expect(receipt.replayTrace).toMatchObject({
      genuineObserverInvokedInternally: true,
      exact68DescriptorInventoryRebound: true,
      allSizesPreflightedBeforeReplayAllocation: true,
      everyFileSecurelyReopenedAndHashMatchedObserver: true,
      everyFileFinalSweepIdentityAndHashMatchedObserver: true,
      finalExactDirectoryInventoryReenumerated: true,
      privateOneShotFilesystemCapabilityMintedAndConsumed: true,
      finitenessRecomputed: true,
      smearingWeightFreezeRecomputed: true,
      metricDemandNondegeneracyRecomputed: false,
      meanMetricDemandClosureRecomputed: false,
      metricDemandErrorEnclosureRecomputed: false,
      exchangeSymmetryRecomputed: true,
      smearingNormalizationRecomputed: true,
      psdRecomputed: true,
      fluctuationRecomputed: true,
      bracketResidualsRequireAuthenticatedServerTargets: true,
      antisymmetryRecomputedAtAllThreeLevels: true,
      jacobiRecomputedAtAllThreeLevels: true,
      candidateSpecificConservativeRegulatorRecomputedForAvailableNonTargetFamilies: true,
      allFiveFamilyRegulatorsRecomputed: false,
      legacySpacingRegulatorUsed: false,
      failureRetuningPerformed: false,
    });
    expectExactNormalizedProjection(receipt);
    expect(
      receipt.normalizedOutcomeProjection.map((entry) => entry.disposition),
    ).toEqual([
      "pass",
      "blocked",
      "blocked",
      "blocked",
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
      "blocked",
      "blocked",
      "blocked",
      "pass",
      "pass",
      "blocked",
      "blocked",
      "blocked",
      "pass",
      "pass",
      "blocked",
      "blocked",
      "blocked",
      "pass",
      "pass",
      "blocked",
      "blocked",
      "blocked",
      "pass",
      "pass",
    ]);
    expect(
      receipt.normalizedOutcomeProjection
        .filter((entry) => entry.disposition === "blocked")
        .every(
          (entry) =>
            entry.orderedIssueCodes.length === 1 &&
            entry.orderedIssueCodes[0] === "outcome_not_recomputed",
        ),
    ).toBe(true);
    expect(containsFloat64Array(receipt)).toBe(false);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.metrics.regulator)).toBe(true);
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("keeps the frozen metric-demand, smearing, noise/mean, and target-gate order while exposing unrecomputed demand gates", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture({ badWeights: true });
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );
    expect(receipt.issues.map((entry) => entry.code)).toEqual([
      "smearing_weights_not_frozen_exact",
    ]);
    expect(receipt.replayTrace).toMatchObject({
      genuineObserverInvokedInternally: true,
      finitenessRecomputed: false,
      metricDemandNondegeneracyRecomputed: false,
      meanMetricDemandClosureRecomputed: false,
      metricDemandErrorEnclosureRecomputed: false,
      smearingWeightFreezeRecomputed: false,
      smearingNormalizationRecomputed: false,
      exchangeSymmetryRecomputed: false,
      psdRecomputed: false,
      fluctuationRecomputed: false,
    });
    expect(receipt.candidateDisposition).toBe("failed_without_retuning");
    expectExactNormalizedProjection(receipt);
    expect(receipt.normalizedOutcomeProjection[4]).toMatchObject({
      checkId: "smearingWeightFreeze",
      disposition: "fail",
      appliedToleranceIds: [],
      orderedIssueCodes: ["smearing_weight_freeze_not_satisfied"],
    });
    expect(
      receipt.normalizedOutcomeProjection.every(
        (entry, ordinal) => ordinal === 4 || entry.disposition === "blocked",
      ),
    ).toBe(true);
    expect(receipt.replayTrace.failureRetuningPerformed).toBe(false);
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("rejects a normalized but nonuniform producer-selected weight lever", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture({
      nonuniformNormalizedWeights: true,
    });
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );

    expect(receipt.metrics.fluctuation).toBeNull();
    expect(receipt.failures).toEqual(["smearing_weights_not_frozen_exact"]);
    expect(receipt.replayTrace.smearingWeightFreezeRecomputed).toBe(false);
    expect(receipt.replayTrace.finitenessRecomputed).toBe(false);
    expect(receipt.candidateDisposition).toBe("failed_without_retuning");
    expectExactNormalizedProjection(receipt);
    expect(receipt.normalizedOutcomeProjection[4]).toMatchObject({
      disposition: "fail",
      orderedIssueCodes: ["smearing_weight_freeze_not_satisfied"],
    });
    expect(receipt.normalizedOutcomeProjection[5]).toMatchObject({
      disposition: "blocked",
      orderedIssueCodes: ["outcome_not_recomputed"],
    });
    expect(receipt.replayTrace.failureRetuningPerformed).toBe(false);
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("fails a definite off-diagonal PSD-negative two-coordinate witness without retuning", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture({ psdNegativeWitness: true });
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );

    expect(receipt.candidateDisposition).toBe("failed_without_retuning");
    expect(receipt.failures).toContain("noise_psd_negative_witness");
    expect(receipt.blockers).not.toContain(
      "noise_psd_numerically_inconclusive",
    );
    expect(receipt.metrics.noise).toMatchObject({
      exchangeResidualUpper95SI: 0,
      psdDisposition: "negative_witness",
    });
    expect(receipt.metrics.noise?.minimumRayleighWitnessUpperSI).toBeLessThan(
      -(receipt.metrics.noise?.psdToleranceSI ?? 0),
    );
    expect(
      receipt.metrics.fluctuation?.fluctuationToMeanRatioUpper95,
    ).toBeLessThanOrEqual(1);
    expect(receipt.replayTrace.failureRetuningPerformed).toBe(false);
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("retains earlier blockers and emits a typed blocker when finite residual operands overflow", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture({
      overflowAntisymmetry: true,
    });
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );

    expect(receipt.blockers).toEqual(
      expect.arrayContaining([
        "metric_demand_static_input_capability_missing",
        "server_recomputed_classical_target_capability_missing",
        "constraint_residual_recompute_nonfinite",
      ]),
    );
    expect(receipt.blockers).not.toContain("regulator_nonfinite");
    expect(
      receipt.metrics.residuals.filter(
        (entry) => entry.familyId === "antisymmetry",
      ),
    ).toHaveLength(2);
    expect(receipt.replayTrace).toMatchObject({
      antisymmetryRecomputedAtAllThreeLevels: false,
      jacobiRecomputedAtAllThreeLevels: true,
      candidateSpecificConservativeRegulatorRecomputedForAvailableNonTargetFamilies: false,
      failureRetuningPerformed: false,
    });
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("preserves role-sensitive raw rejection as a typed frozen-candidate failure without retuning", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture({ negativeRoleValue: true });
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );

    expect(receipt.candidateDisposition).toBe("failed_without_retuning");
    expect(receipt.failures).toEqual(["decoded_role_sensitive_negative"]);
    expect(receipt.blockers).toEqual([]);
    expect(receipt.filesystemBinding.observationAccepted).toBe(false);
    expect(receipt.metrics.input).toBeNull();
    expect(receipt.replayTrace).toMatchObject({
      genuineObserverInvokedInternally: true,
      failureRetuningPerformed: false,
    });
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("fails the frozen candidate without retuning when a residual echo disagrees, while retaining recomputed regulator values", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture({
      mismatchAntisymmetryResidualEcho: true,
    });
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );

    expect(receipt.candidateDisposition).toBe("failed_without_retuning");
    expect(receipt.failures).toContain("submitted_residual_echo_mismatch");
    expect(receipt.blockers).toContain(
      "server_recomputed_classical_target_capability_missing",
    );
    const antisymmetry = receipt.metrics.residuals.filter(
      (entry) => entry.familyId === "antisymmetry",
    );
    expect(antisymmetry).toHaveLength(3);
    expect(
      antisymmetry.map((entry) => entry.submittedResidualMismatchLInf),
    ).toEqual([0.04, 0.02, 0.01]);
    expect(
      receipt.metrics.regulator.find(
        (entry) => entry.familyId === "antisymmetry",
      ),
    ).toMatchObject({
      pLower: 1,
      qByLevel: [0.04, 0.02, 0.01],
      pass: true,
    });
    expect(receipt.replayTrace.failureRetuningPerformed).toBe(false);
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("independently detects exchange and fluctuation failures from admitted noise bytes", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture({ noiseFailure: true });
    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );

    expect(receipt.candidateDisposition).toBe("failed_without_retuning");
    expect(receipt.failures).toEqual(
      expect.arrayContaining([
        "noise_exchange_symmetry_exceeds_tolerance",
        "fluctuation_ratio_exceeds_tolerance",
      ]),
    );
    expect(receipt.metrics.noise?.exchangeResidualUpper95SI).toBe(1);
    expect(
      receipt.metrics.fluctuation?.fluctuationToMeanRatioUpper95,
    ).toBeGreaterThan(1);
    expect(receipt.replayTrace.exchangeSymmetryRecomputed).toBe(true);
    expect(receipt.replayTrace.psdRecomputed).toBe(true);
    expect(receipt.replayTrace.fluctuationRecomputed).toBe(true);
    expect(receipt.replayTrace.failureRetuningPerformed).toBe(false);
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("rejects a file retired after its adapter reread when the mandatory final sweep reaches it", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture();
    const firstDescriptor =
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS[0];
    const firstPath = path.join(
      fixture.root,
      ...relativePath(firstDescriptor).split("/"),
    );
    const originalOpen = fs.open.bind(fs);
    let firstPathOpenCount = 0;
    let mutated = false;
    vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
      const openedPath = path.resolve(String(file));
      if (openedPath === firstPath) firstPathOpenCount += 1;
      if (!mutated && firstPathOpenCount === 4 && openedPath !== firstPath) {
        const replacement = Buffer.alloc(firstDescriptor.sizeBytes);
        replacement.writeDoubleLE(1, 0);
        await fs.writeFile(firstPath, replacement);
        mutated = true;
      }
      return mode === undefined
        ? originalOpen(file, flags)
        : originalOpen(file, flags, mode);
    });

    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );
    expect(mutated).toBe(true);
    expect(receipt.blockers).toEqual([
      "filesystem_entry_changed_after_observation",
    ]);
    expect(
      receipt.replayTrace.everyFileFinalSweepIdentityAndHashMatchedObserver,
    ).toBe(false);
    expect(receipt.metrics.input).toBeNull();
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("rejects an extra entry created after the observer inventory but before the adapter's final exact re-enumeration", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture();
    const extraPath = path.join(fixture.root, "late-extra.bin");
    const originalOpendir = fs.opendir.bind(fs);
    let rootEnumerationCount = 0;
    let inserted = false;
    vi.spyOn(fs, "opendir").mockImplementation(
      async (directoryPath, options) => {
        if (path.resolve(String(directoryPath)) === fixture.root) {
          rootEnumerationCount += 1;
          if (rootEnumerationCount === 3) {
            await fs.writeFile(extraPath, Buffer.alloc(8));
            inserted = true;
          }
        }
        return options === undefined
          ? originalOpendir(directoryPath)
          : originalOpendir(directoryPath, options);
      },
    );

    const receipt =
      await replayNhm2SphericalBosonStarV2PrimaryScienceFromFilesystem(
        fixture.root,
      );

    expect(inserted).toBe(true);
    expect(rootEnumerationCount).toBe(3);
    expect(receipt.blockers).toEqual([
      "filesystem_entry_changed_after_observation",
    ]);
    expect(receipt.filesystemBinding.observationAccepted).toBe(true);
    expect(receipt.replayTrace.finalExactDirectoryInventoryReenumerated).toBe(
      false,
    );
    expect(receipt.metrics.input).toBeNull();
    expectAllAuthorityLocked(receipt);
  }, 60_000);

  it("contains no public capability issuer, caller-array replay, raw-target authority, or legacy spacing regulator", () => {
    const sourcePath = fileURLToPath(
      new URL(
        "../nhm2-spherical-boson-star-v2-primary-science-replay-adapter.ts",
        import.meta.url,
      ),
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toContain("nhm2-semiclassical-v2-content-replay");
    expect(source).not.toContain("replayNhm2SemiclassicalV2Content");
    expect(source.match(/RAW_CAPABILITIES\.set/g)).toHaveLength(1);
    expect(source).toContain("RAW_CAPABILITIES.delete(capability as object)");
    expect(source).not.toContain("AUTHENTICATED_TARGET_CAPABILITIES.set");
    expect(source).not.toContain("arraysExactlyEqual");
    expect(source).toContain("sharesFloat64Storage");
    expect(source).toContain(
      'derivationOrigin: "server_recomputed_from_frozen_dirac_structure_functions"',
    );
    expect(source).toContain(
      "Object.getPrototypeOf(state.targets) !== Map.prototype",
    );
    expect(source).not.toMatch(/export\s+const\s+mint/i);
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+mint/i);
    expect(source).not.toMatch(/export\s+const\s+replayCapability/);
    expect(source).toContain("submittedRawTargetsAuthoritative: false");
    expect(source).toContain(
      "server_recomputed_classical_target_capability_missing",
    );
    expect(source).toContain("const d01 = Math.abs(");
    expect(source).toContain("const d12 = Math.abs(");
    expect(source).toContain("Math.log(d01Lower / d12Upper) / Math.log(2)");
    expect(source).toContain("const e2 = d12");
    expect(source).toContain("const ue2 = u12");
    expect(source).not.toContain("regulator_spacing_invalid");
  });
});
