import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_V2,
  NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_V2_BINDING,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-candidate-freeze.v2";
import { NHM2_SPHERICAL_BOSON_STAR_V2_SI_OUTPUT_NORMALIZATION_V2_BINDING } from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-si-output-normalization.v2";
import * as admissionModule from "../nhm2-spherical-boson-star-v2-independent-si-linux-runtime-admission";

const {
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_DISJOINTNESS_PREDICATE_IDS:
    PREDICATE_IDS,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_PROGRAM_PROTOCOL:
    PROGRAM_PROTOCOL,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_BOUNDARY:
    BOUNDARY,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_BOUNDARY_CANONICAL_SIZE_BYTES:
    BOUNDARY_SIZE,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_BOUNDARY_EXPECTED_CANONICAL_SIZE_BYTES:
    EXPECTED_BOUNDARY_SIZE,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_BOUNDARY_EXPECTED_SEMANTIC_SHA256:
    EXPECTED_BOUNDARY_SHA256,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_BOUNDARY_LITERAL_SEAL_STATUS:
    LITERAL_SEAL_STATUS,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_BOUNDARY_SEMANTIC_SHA256:
    BOUNDARY_SHA256,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_DOMAINS:
    DOMAINS,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_PINS:
    PINS,
  NHM2_SPHERICAL_BOSON_STAR_V2_INDEPENDENT_SI_LINUX_RUNTIME_ADMISSION_VALIDATOR_BUDGETS:
    VALIDATOR_BUDGETS,
  __TEST_ONLY_evaluateNhm2SphericalBosonStarV2SiLaneDisjointness:
    evaluateDisjointness,
  assessNhm2SphericalBosonStarV2IndependentSiLinuxRuntimeAdmission: assess,
  computeNhm2SphericalBosonStarV2IndependentSiLinuxClosureLedgerSha256:
    closureHash,
  parseNhm2SphericalBosonStarV2IndependentSiLinuxRuntimeAdmissionReceiptCanonicalWire:
    parseReceipt,
  parseNhm2SphericalBosonStarV2IndependentSiLinuxRuntimeManifestCanonicalWire:
    parseManifest,
  parseNhm2SphericalBosonStarV2SiLaneLineageRecordCanonicalWire: parseLineage,
} = admissionModule;

const sha = (label: string): string =>
  createHash("sha256").update(label, "utf8").digest("hex");

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const u64le = (value: number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};

const semanticHash = (domain: string, unsigned: unknown): string => {
  const bytes = Buffer.from(canonicalJson(unsigned), "utf8");
  return createHash("sha256")
    .update(domain, "utf8")
    .update(u64le(bytes.length))
    .update(bytes)
    .digest("hex");
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const reseal = <T extends Record<string, unknown>>(
  value: T,
  field: string,
  domain: string,
): T => {
  const copy = clone(value) as Record<string, unknown>;
  delete copy[field];
  copy[field] = semanticHash(domain, copy);
  return copy as T;
};

const authorityLocks = (): Record<string, unknown> =>
  clone(BOUNDARY.authorityLocks);

const closureReference = (kind: string) => ({
  artifactId: `nhm2.closure.${kind}`,
  contractVersion:
    "nhm2_spherical_boson_star_v2_independent_si_linux_closure_ledger/v1",
  closureKind: kind,
  relativePath: `evidence/closures/${kind}.json`,
  ledgerRawSha256: sha(`${kind}:raw`),
  ledgerSemanticSha256: sha(`${kind}:semantic`),
  sizeBytes: 1_024,
  entryCount: 2,
  aggregateBytes: 2_048,
});

const receiptReference = (kind: string) => ({
  artifactId: `nhm2.receipt.${kind}`,
  contractVersion: `nhm2_${kind}_receipt/v1`,
  receiptId: `${kind}.receipt.v1`,
  relativePath: `evidence/receipts/${kind}.json`,
  rawSha256: sha(`${kind}:receipt:raw`),
  semanticSha256: sha(`${kind}:receipt:semantic`),
  sizeBytes: 512,
});

const makeManifest = (): Record<string, any> => {
  const unsigned = {
    artifactId:
      "nhm2.spherical_boson_star_v2.independent_si_linux_runtime_manifest",
    contractVersion:
      "nhm2_spherical_boson_star_v2_independent_si_linux_runtime_manifest/v1",
    manifestId: "independent.si.linux.manifest.v1",
    enrollmentId: "enrollment.v1",
    candidateBinding: {
      artifactId:
        NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_V2_BINDING.artifactId,
      contractVersion:
        NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_V2_BINDING.contractVersion,
      candidateId:
        NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_V2
          .selectedCandidateIdentity.candidateId,
      semanticSha256: PINS.candidateFreezeV2.semanticSha256,
      canonicalSizeBytes: PINS.candidateFreezeV2.canonicalSizeBytes,
      relativePath: PINS.candidateFreezeV2.relativePath,
      rawSha256: PINS.candidateFreezeV2.rawSha256,
      rawSizeBytes: PINS.candidateFreezeV2.rawSizeBytes,
    },
    frozenAt: {
      wallUtc: "2026-08-14T12:00:00.000Z",
      bootIdentitySha256: sha("boot"),
      monotonicNanoseconds: "100",
    },
    semanticBindings: {
      siOutputNormalizationV2: {
        artifactId:
          NHM2_SPHERICAL_BOSON_STAR_V2_SI_OUTPUT_NORMALIZATION_V2_BINDING.artifactId,
        contractVersion:
          NHM2_SPHERICAL_BOSON_STAR_V2_SI_OUTPUT_NORMALIZATION_V2_BINDING.contractVersion,
        semanticSha256: PINS.siOutputNormalizationV2.semanticSha256,
        canonicalSizeBytes: PINS.siOutputNormalizationV2.canonicalSizeBytes,
        relativePath: PINS.siOutputNormalizationV2.relativePath,
        rawSha256: PINS.siOutputNormalizationV2.rawSha256,
        rawSizeBytes: PINS.siOutputNormalizationV2.rawSizeBytes,
      },
      codata2022: PINS.codata2022,
      independentProgram: PINS.independentProgram,
      independentOracle: PINS.independentOracle,
    },
    programProtocol: PROGRAM_PROTOCOL,
    closureBindings: {
      source: closureReference("source"),
      dependency: closureReference("dependency"),
      toolchain: closureReference("toolchain"),
      build: closureReference("build"),
      executable: closureReference("executable"),
      runtime: closureReference("runtime"),
    },
    provenanceBindings: {
      authorshipNoPrimaryReadReceipt: receiptReference("authorship"),
      dependencyAcquisitionReceipt: receiptReference("acquisition"),
      buildReadTraceReceipt: receiptReference("buildtrace"),
      nativeConformanceReceipt: receiptReference("conformance"),
    },
    executionEnvelope: {
      serverOwnedEnrollmentResolutionRequired: true,
      serverObservedLinuxRuntimeRequired: true,
      stoppedBeforeFirstStdinReadRequired: true,
      exactCodataBytesSuppliedOnlyAfterAdmissionPersistence: true,
      callerPathsManifestsReceiptsProvidersExecutorsTimestampsEnvironmentsCapabilitiesAccepted: false,
      executionPerformedByThisContract: false,
    },
    primaryComparisonPolicy: {
      primaryAndIndependentLineagesMustBeServerAuthenticated: true,
      exactSiV2SemanticContractRequired: true,
      exactCodataBytesRequired: true,
      exactOperationGraphAndRoundingRequired: true,
      zeroUlpComparisonRequired: true,
      numericalEqualityIsNotLineageEvidence: true,
      failureRequiresNewEnrollmentAndCandidateVersion: true,
      inPlaceRetuneAllowed: false,
    },
    authorityLocks: authorityLocks(),
  };
  return {
    ...unsigned,
    manifestSha256: semanticHash(DOMAINS.manifest, unsigned),
  };
};

const makeLineage = (lane: "primary" | "independent"): Record<string, any> => {
  const prefix = lane === "primary" ? "p" : "i";
  const unsigned = {
    artifactId: "nhm2.spherical_boson_star_v2.si_lane_lineage_record",
    contractVersion: "nhm2_spherical_boson_star_v2_si_lane_lineage_record/v1",
    lineageId: `${lane}.lineage.v1`,
    enrollmentId: "enrollment.v1",
    manifestSha256: makeManifest().manifestSha256,
    lane,
    registrySubject: {
      subjectId: `${lane}.registry.subject`,
      authenticated: true,
    },
    authorship: {
      sessionId: `${lane}.authorship.session`,
      receiptSha256: sha(`${prefix}:authorship`),
      primaryReadExclusionObserved: true,
    },
    sourceOrigin: {
      originId: `${lane}.source.origin`,
      authorshipEventId: `${lane}.authorship.event`,
      independentlyEvidenced: true,
    },
    trustedRoot: {
      rootIdentitySha256: sha(`${prefix}:root`),
      mountIdentitySha256: sha(`${prefix}:mount`),
      nonNestedWithPeerObserved: true,
      fileIdentitySetDisjointObserved: true,
      allRegularFilesNonSymlinkObserved: true,
      allRegularFilesSingleLinkObserved: true,
      allFilesStableAcrossOpenReadObserved: true,
    },
    closureSeals: {
      source: sha(`${prefix}:source`),
      dependency: sha(`${prefix}:dependency`),
      toolchain: sha(`${prefix}:toolchain`),
      build: sha(`${prefix}:build`),
      executable: sha(`${prefix}:executable`),
      runtime: sha(`${prefix}:runtime`),
    },
    dependencyAcquisition: {
      eventId: `${lane}.dependency.event`,
      signedReceiptSha256: sha(`${prefix}:dependency:receipt`),
      gmpArchiveSha256: sha("shared:gmp:archive"),
      mpfrArchiveSha256: sha("shared:mpfr:archive"),
      gmpVersion: "6.3.0",
      mpfrVersion: "4.2.2",
    },
    toolchain: {
      originId: `${lane}.toolchain.origin`,
      buildId: `${lane}.toolchain.build`,
      rootIdentitySha256: sha(`${prefix}:toolchain:root`),
    },
    buildObservation: {
      processIdentitySha256: sha(`${prefix}:build:process`),
      inputReadSetSha256: sha(`${prefix}:build:readset`),
      primaryRootsExcluded: true,
    },
    executableIdentity: {
      derivationSha256: sha(`${prefix}:derivation`),
      buildTraceSha256: sha(`${prefix}:buildtrace`),
      device: lane === "primary" ? "11" : "21",
      inode: lane === "primary" ? "12" : "22",
      mountId: lane === "primary" ? "13" : "23",
    },
    runtimeIdentity: {
      bootIdentitySha256: sha(`${prefix}:boot`),
      pidNamespaceSha256: sha(`${prefix}:pidns`),
      userNamespaceSha256: sha(`${prefix}:userns`),
      mountNamespaceSha256: sha(`${prefix}:mountns`),
      processStartMonotonicNanoseconds: lane === "primary" ? "1000" : "2000",
      executableDevice: lane === "primary" ? "11" : "21",
      executableInode: lane === "primary" ? "12" : "22",
      stoppedBeforeFirstStdinRead: true,
    },
    storageIdentity: {
      mpfrDestinationNamespaceSha256: sha(`${prefix}:mpfr:storage`),
      receiptStorageNamespaceSha256: sha(`${prefix}:receipt:storage`),
    },
    accessExclusion: {
      policySha256: sha(`${prefix}:access:policy`),
      syscallTraceSha256: sha(`${prefix}:access:trace`),
      peerSourceRuntimeReceiptRootsInaccessible: true,
    },
    chronology: {
      manifestPersistedMonotonicNanoseconds: "100",
      closureCompletedMonotonicNanoseconds: "200",
      lineagePersistedMonotonicNanoseconds: "300",
      wallUtc: "2026-08-14T12:00:01.000Z",
      bootIdentitySha256: sha(`${prefix}:boot`),
    },
    authorityLocks: authorityLocks(),
  };
  return {
    ...unsigned,
    lineageSha256: semanticHash(DOMAINS.lineage, unsigned),
  };
};

const makeReceipt = (
  primary = makeLineage("primary"),
  independent = makeLineage("independent"),
): Record<string, any> => {
  const results = evaluateDisjointness(primary, independent);
  const evidence = results.map((result, index) => ({
    predicateId: result.predicateId,
    observed: true,
    passed: result.passed,
    evidenceSha256: sha(`predicate:${index}`),
  }));
  const unsigned = {
    artifactId:
      "nhm2.spherical_boson_star_v2.independent_si_linux_runtime_admission_receipt",
    contractVersion:
      "nhm2_spherical_boson_star_v2_independent_si_linux_runtime_admission_receipt/v1",
    receiptId: "admission.receipt.v1",
    enrollmentId: "enrollment.v1",
    manifestSha256: makeManifest().manifestSha256,
    primaryLineageSha256: primary.lineageSha256,
    independentLineageSha256: independent.lineageSha256,
    disjointnessEvidence: evidence,
    disjointnessEvidenceSha256: semanticHash(DOMAINS.disjointness, evidence),
    chronology: {
      manifestPersistedMonotonicNanoseconds: "100",
      primaryLineagePersistedMonotonicNanoseconds: "200",
      primarySiReceiptPersistedMonotonicNanoseconds: "300",
      independentFilesRehashedMonotonicNanoseconds: "400",
      independentChildStoppedMonotonicNanoseconds: "500",
      runtimeObservedMonotonicNanoseconds: "600",
      admissionEvidencePersistedMonotonicNanoseconds: "700",
      wallUtc: "2026-08-14T12:00:02.000Z",
      bootIdentitySha256: sha("receipt:boot"),
    },
    admission: {
      status: "admitted",
      blockers: [],
      siNormalizationReleaseEligible: true,
      releaseConsumed: false,
      failureRequiresNewEnrollmentAndCandidateVersion: true,
      inPlaceRetuneAllowed: false,
    },
    authorityLocks: authorityLocks(),
  };
  return {
    ...unsigned,
    receiptSha256: semanticHash(DOMAINS.receipt, unsigned),
  };
};

const deepFrozen = (value: unknown, seen = new Set<object>()): boolean => {
  if (value === null || typeof value !== "object" || seen.has(value))
    return true;
  seen.add(value);
  return (
    Object.isFrozen(value) &&
    Object.values(value as Record<string, unknown>).every((entry) =>
      deepFrozen(entry, seen),
    )
  );
};

describe("NHM2 spherical boson-star v2 independent SI Linux runtime admission", () => {
  it("binds final candidate, SI-v2, CODATA, repaired C, and repaired oracle pins", () => {
    expect(PINS.candidateFreezeV2).toMatchObject({
      semanticSha256:
        "a8e4d9cb4b07efc053fddc72339b8c3db464129a992731453059d3e160ca2ce2",
      canonicalSizeBytes: 20_843,
      rawSha256:
        "c0a1a39efa0beb0cc13ac2517fb97f6c2b1ff18242e4d8329008fd85b6a3b057",
      rawSizeBytes: 35_998,
    });
    expect(PINS.siOutputNormalizationV2).toMatchObject({
      semanticSha256:
        "6af028d078ecc4cc9076eb45476fd87ac448503170e88fccf0ada3a98d06cafb",
      canonicalSizeBytes: 15_246,
      rawSha256:
        "6d5d539b5c93409b6a0afefe0afdf9c32aa27f98fb1d133efb8c6d19e66a86cc",
      rawSizeBytes: 26_854,
    });
    expect(PINS.codata2022).toMatchObject({
      rawSha256:
        "5a7e10ed709577c224cf45f78199dd143a7f9cf10d6f8fe8c018e168454b7a61",
      rawSizeBytes: 6_180,
    });
    expect(PINS.independentProgram).toMatchObject({
      rawSha256:
        "1f581520c8ec6e5af3e2ce875afa6dd35f5b673f5feb7188cdddab3e513bd489",
      rawSizeBytes: 57_282,
    });
    expect(PINS.independentOracle).toMatchObject({
      rawSha256:
        "dde0586c79e2e1edb9adf22a9d755ae15e398bb50f2cbf0d5b4240ee9371e0d1",
      rawSizeBytes: 45_733,
    });
    expect(PROGRAM_PROTOCOL).toMatchObject({
      platform: "linux",
      mpfrVersion: "4.2.2",
      gmpVersion: "6.3.0",
      precisionBits: 256,
      exponentMinimum: -1_000_000,
      exponentMaximum: 1_000_000,
      exactArgc: 2,
      exactTraceEntryCount: 139,
    });
  });

  it("freezes only the independently recomputed budget-repaired boundary", () => {
    expect(EXPECTED_BOUNDARY_SHA256).toBe(
      "53838849abe95d00d819ec89dd5278b7604771edd0306bb75adbb6022473f4d0",
    );
    expect(EXPECTED_BOUNDARY_SIZE).toBe(7_963);
    expect(LITERAL_SEAL_STATUS).toBe(
      "SEALED_AFTER_INDEPENDENT_ROOT_ACKNOWLEDGEMENT_AFTER_TOTALITY_BUDGET_REPAIR_BEFORE_RUNTIME_ENROLLMENT",
    );
    expect(BOUNDARY_SHA256).toBe(EXPECTED_BOUNDARY_SHA256);
    expect(BOUNDARY_SIZE).toBe(EXPECTED_BOUNDARY_SIZE);
    expect(BOUNDARY_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(BOUNDARY_SIZE).toBeGreaterThan(0);
    expect(deepFrozen(BOUNDARY)).toBe(true);
  });

  it("advertises exact pre-parse and post-parse totality budgets", () => {
    expect(BOUNDARY.validatorBudgets).toEqual(VALIDATOR_BUDGETS);
    expect(VALIDATOR_BUDGETS).toEqual({
      wire: {
        maximumUtf16CodeUnits: 262_144,
        maximumUtf8Bytes: 262_144,
      },
      preParse: {
        maximumNestingDepth: 128,
        maximumNodes: 65_536,
        maximumArrayEntries: 32_768,
        maximumObjectProperties: 32_768,
        maximumStringUtf16CodeUnits: 65_536,
        maximumStringUtf8Bytes: 131_072,
        maximumKeyUtf16CodeUnits: 512,
        maximumKeyUtf8Bytes: 1_024,
        maximumTotalStringUtf16CodeUnits: 131_072,
        maximumTotalStringUtf8Bytes: 262_144,
      },
      postParse: {
        maximumNestingDepth: 128,
        maximumNodes: 65_536,
        maximumArrayEntries: 32_768,
        maximumObjectProperties: 32_768,
        maximumStringUtf16CodeUnits: 65_536,
        maximumStringUtf8Bytes: 131_072,
        maximumKeyUtf16CodeUnits: 512,
        maximumKeyUtf8Bytes: 1_024,
        maximumTotalStringUtf16CodeUnits: 131_072,
        maximumTotalStringUtf8Bytes: 262_144,
      },
    });
    expect(deepFrozen(VALIDATOR_BUDGETS)).toBe(true);
  });

  it("is total and fail-closed for canonical objects and arrays nested thousands deep", () => {
    const deepObject = `${'{"a":'.repeat(4_000)}0${"}".repeat(4_000)}`;
    const deepArray = `${"[".repeat(8_000)}0${"]".repeat(8_000)}`;
    expect(deepObject.length).toBeLessThan(262_144);
    expect(deepArray.length).toBeLessThan(262_144);

    for (const wire of [deepObject, deepArray]) {
      for (const parser of [parseManifest, parseLineage, parseReceipt]) {
        let result: ReturnType<typeof parseManifest> | null = null;
        expect(() => {
          result = parser(wire);
        }).not.toThrow();
        expect(result).toMatchObject({
          ok: false,
          issues: ["wire:preparse_nesting_depth_limit_exceeded"],
          value: null,
        });
        expect(deepFrozen(result)).toBe(true);
      }
      expect(() => closureHash("source", wire)).not.toThrow();
      expect(closureHash("source", wire)).toBeNull();
    }
  });

  it("fails closed on advertised array, string, and key budgets", () => {
    const tooManyArrayEntries = `[${"0,".repeat(32_768)}0]`;
    const oversizedString = `{"x":"${"a".repeat(65_537)}"}`;
    const oversizedKey = `{"${"k".repeat(513)}":0}`;
    expect(parseManifest(tooManyArrayEntries).issues).toContain(
      "wire:preparse_array_entry_limit_exceeded",
    );
    expect(parseManifest(oversizedString).issues).toContain(
      "wire:preparse_string_UTF16_limit_exceeded",
    );
    expect(parseManifest(oversizedKey).issues).toContain(
      "wire:preparse_key_UTF16_limit_exceeded",
    );
  });

  it("accepts strict canonical manifest, lineage, and receipt fixtures without granting runtime authority", () => {
    const manifest = makeManifest();
    const primary = makeLineage("primary");
    const independent = makeLineage("independent");
    const receipt = makeReceipt(primary, independent);
    const parsedManifest = parseManifest(canonicalJson(manifest));
    expect(parsedManifest).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(deepFrozen(parsedManifest)).toBe(true);
    expect(parseLineage(canonicalJson(primary))).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(parseLineage(canonicalJson(independent))).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(parseReceipt(canonicalJson(receipt))).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(
      Object.values(receipt.authorityLocks).every(
        (value) => value === false || value === null,
      ),
    ).toBe(true);
  });

  it("separates all closure domains and enforces strict raw-UTF8 path order", () => {
    const wire = canonicalJson({
      entries: [
        {
          ordinal: 0,
          role: "program",
          relativePath: "a/program.c",
          mediaType: "text/x-c",
          rawSha256: sha("program"),
          sizeBytes: 10,
        },
        {
          ordinal: 1,
          role: "oracle",
          relativePath: "b/oracle.py",
          mediaType: "text/x-python",
          rawSha256: sha("oracle"),
          sizeBytes: 20,
        },
      ],
    });
    const hashes = [
      "source",
      "dependency",
      "toolchain",
      "build",
      "executable",
      "runtime",
    ].map((kind) => closureHash(kind as never, wire));
    expect(hashes.every((hash) => typeof hash === "string")).toBe(true);
    expect(new Set(hashes).size).toBe(6);

    const reversed = JSON.parse(wire) as Record<string, any>;
    reversed.entries.reverse();
    reversed.entries.forEach(
      (entry: Record<string, unknown>, index: number) => {
        entry.ordinal = index;
      },
    );
    expect(closureHash("source", canonicalJson(reversed))).toBeNull();
  });

  it("rejects noncanonical, duplicate-key, unknown-key, unsafe-number, and true-lock wires", () => {
    const manifest = makeManifest();
    const canonical = canonicalJson(manifest);
    expect(parseManifest(` ${canonical}`).issues).toContain(
      "wire:canonical_encoding_required_duplicate_keys_forbidden",
    );
    const duplicate = canonical.replace(
      '{"artifactId":',
      `{"artifactId":${JSON.stringify(manifest.artifactId)},"artifactId":`,
    );
    expect(parseManifest(duplicate).ok).toBe(false);

    const unknown = clone(manifest);
    unknown.declaredLeverTensor = null;
    const unknownSealed = reseal(unknown, "manifestSha256", DOMAINS.manifest);
    expect(parseManifest(canonicalJson(unknownSealed)).issues).toContain(
      "$:exact_keys_required",
    );

    const unsafe = clone(manifest);
    unsafe.closureBindings.source.sizeBytes = Number.MAX_SAFE_INTEGER + 1;
    const unsafeSealed = reseal(unsafe, "manifestSha256", DOMAINS.manifest);
    expect(
      parseManifest(canonicalJson(unsafeSealed)).issues.some((issue) =>
        issue.includes("safe_integer_required"),
      ),
    ).toBe(true);

    const unlocked = clone(manifest);
    unlocked.authorityLocks.physicalViability = true;
    const unlockedSealed = reseal(unlocked, "manifestSha256", DOMAINS.manifest);
    expect(parseManifest(canonicalJson(unlockedSealed)).issues).toContain(
      "$.authorityLocks:literal_binding_mismatch",
    );
  });

  it("is trap-free for hostile ingress and rejects every caller authority seam", () => {
    let reads = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          reads += 1;
          throw new Error("must_not_read");
        },
        ownKeys() {
          reads += 1;
          throw new Error("must_not_enumerate");
        },
      },
    );
    expect(() => assess(hostile)).not.toThrow();
    expect(() => parseManifest(hostile)).not.toThrow();
    expect(reads).toBe(0);
    expect(assess()).toMatchObject({
      blockers: ["exactly_one_enrollment_id_argument_required"],
      sideEffectCount: 0,
    });
    expect(assess(undefined)).toMatchObject({
      blockers: ["enrollment_id_primitive_string_required"],
      sideEffectCount: 0,
    });
    expect(assess(new String("enrollment.v1"))).toMatchObject({
      blockers: ["enrollment_id_primitive_string_required"],
      sideEffectCount: 0,
    });
    expect(assess("enrollment.v1", hostile)).toMatchObject({
      blockers: ["exactly_one_enrollment_id_argument_required"],
      sideEffectCount: 0,
    });
    const accessor = Object.defineProperty({}, "enrollmentId", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must_not_read_accessor");
      },
    });
    expect(() => assess(accessor)).not.toThrow();
    expect(reads).toBe(0);
    expect(assess("x".repeat(129)).blockers).toEqual([
      "enrollment_id_UTF16_limit_exceeded",
    ]);
    expect(assess("e\u0301").blockers).toEqual(["enrollment_id_not_NFC"]);
    expect(parseManifest("x".repeat(262_145))).toMatchObject({
      ok: false,
      issues: ["wire:UTF16_limit_exceeded"],
    });
  });

  it("keeps production deterministic, blocked, immutable, and side-effect free", () => {
    const first = assess("enrollment.v1");
    const second = assess("enrollment.v1");
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      enrollmentId: "enrollment.v1",
      status: "blocked",
      manifest: null,
      primaryLineage: null,
      independentLineage: null,
      admissionReceipt: null,
      siNormalizationReleaseEligible: false,
      sideEffectCount: 0,
    });
    expect(first.blockers[0]).toBe(
      "server_private_enrollment_registry_not_installed",
    );
    expect(deepFrozen(first)).toBe(true);
    expect(BOUNDARY.currentProductionAssessment).toMatchObject({
      serverEnrollmentInstances: 0,
      nativeObservationInstances: 0,
      runtimeExecutionCount: 0,
      outputInstanceCount: 0,
      sideEffectCount: 0,
    });
  });

  it("requires every closure lineage to be distinct", () => {
    const expectedPredicate = {
      source: 2,
      dependency: 7,
      toolchain: 8,
      build: 9,
      executable: 10,
      runtime: 11,
    } as const;
    for (const [kind, predicateIndex] of Object.entries(expectedPredicate)) {
      const primary = makeLineage("primary");
      const independent = makeLineage("independent");
      independent.closureSeals[kind] = primary.closureSeals[kind];
      const result = evaluateDisjointness(primary, independent);
      expect(result[predicateIndex].passed, kind).toBe(false);
    }
  });

  it("rejects aliases, hardlinks, copied origins, nested roots, and primary-root reads", () => {
    const primary = makeLineage("primary");
    const independent = makeLineage("independent");

    independent.executableIdentity = clone(primary.executableIdentity);
    expect(evaluateDisjointness(primary, independent)[10].passed).toBe(false);

    const hardlink = makeLineage("independent");
    hardlink.trustedRoot.allRegularFilesSingleLinkObserved = false;
    expect(evaluateDisjointness(primary, hardlink)[4].passed).toBe(false);

    const copied = makeLineage("independent");
    copied.sourceOrigin = clone(primary.sourceOrigin);
    expect(evaluateDisjointness(primary, copied)[5].passed).toBe(false);

    const nested = makeLineage("independent");
    nested.trustedRoot.nonNestedWithPeerObserved = false;
    expect(evaluateDisjointness(primary, nested)[3].passed).toBe(false);

    const reader = makeLineage("independent");
    reader.accessExclusion.peerSourceRuntimeReceiptRootsInaccessible = false;
    expect(evaluateDisjointness(primary, reader)[15].passed).toBe(false);
  });

  it("allows equal signed upstream archive bytes only with distinct acquisitions", () => {
    const primary = makeLineage("primary");
    const independent = makeLineage("independent");
    expect(primary.dependencyAcquisition.gmpArchiveSha256).toBe(
      independent.dependencyAcquisition.gmpArchiveSha256,
    );
    expect(evaluateDisjointness(primary, independent)[6].passed).toBe(true);
    independent.dependencyAcquisition.eventId =
      primary.dependencyAcquisition.eventId;
    expect(evaluateDisjointness(primary, independent)[6].passed).toBe(false);
  });

  it("rejects chronology inversion and admission before persistence", () => {
    const lineage = makeLineage("independent");
    lineage.chronology.lineagePersistedMonotonicNanoseconds = "199";
    const resealedLineage = reseal(lineage, "lineageSha256", DOMAINS.lineage);
    expect(parseLineage(canonicalJson(resealedLineage)).issues).toContain(
      "$.chronology:strict_monotonic_order_required",
    );

    const receipt = makeReceipt();
    receipt.chronology.runtimeObservedMonotonicNanoseconds = "700";
    receipt.chronology.admissionEvidencePersistedMonotonicNanoseconds = "650";
    const resealedReceipt = reseal(receipt, "receiptSha256", DOMAINS.receipt);
    expect(parseReceipt(canonicalJson(resealedReceipt)).issues).toContain(
      "$.chronology:strict_monotonic_order_required",
    );
  });

  it("rejects forged predicate results and preserves the no-retune rule", () => {
    const receipt = makeReceipt();
    receipt.disjointnessEvidence[0].passed = false;
    receipt.disjointnessEvidenceSha256 = semanticHash(
      DOMAINS.disjointness,
      receipt.disjointnessEvidence,
    );
    const forged = reseal(receipt, "receiptSha256", DOMAINS.receipt);
    expect(parseReceipt(canonicalJson(forged)).issues).toContain(
      "$.admission:admitted_state_not_supported",
    );

    const retuned = makeReceipt();
    retuned.admission.inPlaceRetuneAllowed = true;
    const retunedSealed = reseal(retuned, "receiptSha256", DOMAINS.receipt);
    expect(parseReceipt(canonicalJson(retunedSealed)).issues).toContain(
      "$.admission:no_retune_or_release_state_invalid",
    );
    expect(BOUNDARY.noRetunePolicy).toContain(
      "new_enrollment_and_candidate_version",
    );
  });

  it("has no issuer, mint, serialized capability, provider installation, runtime, or IO seam", () => {
    expect(
      Object.keys(admissionModule).filter((key) =>
        /(issuer|mint|capability|installProvider|execute|launch|persist)/i.test(
          key,
        ),
      ),
    ).toEqual([]);
    const source = readFileSync(
      path.resolve(
        "server/services/theory/nhm2-spherical-boson-star-v2-independent-si-linux-runtime-admission.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /from\s+["']node:(fs|child_process|net|http|https|os)["']/,
    );
    expect(source).not.toMatch(
      /\bWeakMap\b|\bprocess\.(env|platform)|\bexec(File|Sync)?\b|\bspawn\b/,
    );
    expect(source).not.toContain(
      "5c9de6aa6dd5688c0919e96dba5225e75fc883e7a24620da8adf845f3546e9a4",
    );
    expect(source).not.toContain(
      "cbae2737bd2209753a58e64231f430c69620d21b77673e56f5a3ad931c1fc9e8",
    );
  });

  it("keeps every science lamp and physical/propulsion/transport claim false or null", () => {
    const locks = Object.values(BOUNDARY.authorityLocks);
    expect(locks.every((value) => value === false || value === null)).toBe(
      true,
    );
    expect(BOUNDARY.authorityLocks).toMatchObject({
      candidateAccepted: false,
      candidateExecutionAuthorized: false,
      scienceReplayAuthorized: false,
      pairAgreementObserved: false,
      stressNoiseLamp: false,
      constraintAlgebraLamp: false,
      diagnosticPass: false,
      theoryGraphPromoted: false,
      physicalViability: false,
      propulsion: false,
      transport: false,
      casimirVerdict: null,
      certificateSha256: null,
    });
    expect(PREDICATE_IDS).toHaveLength(17);
  });
});
