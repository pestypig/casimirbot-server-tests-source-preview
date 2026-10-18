import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_COUNT,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_CHANNEL_ORDER,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_FAMILY_ORDER,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_LEVELS,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_AUTHORITY_BOUNDARY,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_ID,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_SHA256,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_SIZE_BYTES,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_RESIDUAL_FORMULAS,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ROLE_ORDER,
  collectNhm2SemiclassicalV2ConstraintOperandArrays,
  computeNhm2SemiclassicalV2ConstraintOperandInventorySha256,
  type Nhm2SemiclassicalV2ConstraintOperandArrayV1,
  type Nhm2SemiclassicalV2ConstraintOperandFamilyId,
  type Nhm2SemiclassicalV2ConstraintOperandReplayV1,
  type Nhm2SemiclassicalV2ConstraintOperandRole,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-constraint-operand-replay.v1";
import {
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_CONTRACT_VERSION,
  computeNhm2SemiclassicalV2ScientificSealKey,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-scientific-preseal.v1";
import {
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OBSERVATION_CLOSURE_SHA256_DOMAIN,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAYER_INPUT_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAYER_SERVICE_BOUNDARY,
  computeNhm2SemiclassicalV2ConstraintObservationClosureSha256,
  replayNhm2SemiclassicalV2ConstraintOperands,
  type Nhm2SemiclassicalV2ConstraintOperandFileObservationV1,
  type Nhm2SemiclassicalV2ConstraintOperandReplayInputV1,
} from "../nhm2-semiclassical-v2-constraint-operand-replayer";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const CANDIDATE_ID = "nhm2.test.server-constraint-replay/candidate-v1";
const CANDIDATE_SHA256 = sha256("candidate-manifest");
const SEAL_KEY = computeNhm2SemiclassicalV2ScientificSealKey(CANDIDATE_ID);
const OUTPUT_DIRECTORY = "artifacts/nhm2-test-constraint-operands";
const OBSERVED_AT = "2026-08-13T14:00:03.000Z";

type FixtureVariant =
  | "pass"
  | "echo"
  | "signed_zero_echo"
  | "residual_mismatch"
  | "negative_uncertainty"
  | "nonfinite"
  | "prior_failure_then_overflow"
  | "zero_convergence"
  | "prior_failure_then_zero_convergence"
  | "central_failure"
  | "order_failure";

const descriptor = (
  levelId: string,
  familyId: Nhm2SemiclassicalV2ConstraintOperandFamilyId,
  operandRole: Nhm2SemiclassicalV2ConstraintOperandRole,
): Nhm2SemiclassicalV2ConstraintOperandArrayV1 => ({
  operandRole,
  path: `${OUTPUT_DIRECTORY}/${levelId}/${familyId}/${operandRole}.f64le`,
  sha256: "0".repeat(64),
  sizeBytes: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
  freshness: "new",
  observedAt: OBSERVED_AT,
  scientificPresealSealKey: SEAL_KEY,
  dtype: "float64",
  binaryEncoding: "raw_ieee754",
  endianness: "little",
  shape: [64, 4],
  storageOrder: "row-major",
  componentOrder: [...NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_CHANNEL_ORDER],
  sampleOrder: "candidate_sampling_ordinal_0_to_63",
  unit: "dimensionless_barred_constraint_generator",
});

const manifest = (): Nhm2SemiclassicalV2ConstraintOperandReplayV1 => {
  const value: Nhm2SemiclassicalV2ConstraintOperandReplayV1 = {
    artifactId: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_CONTRACT_VERSION,
    generatedAt: "2026-08-13T14:00:04.000Z",
    policyBinding: {
      artifactId:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_ARTIFACT_ID,
      contractVersion:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_CONTRACT_VERSION,
      policyId: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_ID,
      sha256: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_SHA256,
      sizeBytes:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_POLICY_SIZE_BYTES,
    },
    candidateBinding: {
      candidateId: CANDIDATE_ID,
      candidateManifestSha256: CANDIDATE_SHA256,
      scientificPresealBinding: {
        artifactId: NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_ARTIFACT_ID,
        contractVersion:
          NHM2_SEMICLASSICAL_V2_SCIENTIFIC_PRESEAL_CONTRACT_VERSION,
        sealKey: SEAL_KEY,
        candidateManifestSha256: CANDIDATE_SHA256,
        scientificContentSha256: sha256("scientific-content"),
        sealedInventorySha256: sha256("sealed-inventory"),
        sealedAt: "2026-08-13T13:59:59.000Z",
      },
    },
    implementation: {
      comparisonPairId: "nhm2.test.constraint-pair/v1",
      role: "primary",
      implementationId: "nhm2.test.constraint-primary/v1",
      sourceIdentityId: "nhm2.test.constraint-source/v1",
      sourceSha256: sha256("source"),
      dependencyLockIdentityId: "nhm2.test.constraint-dependencies/v1",
      dependencyLockSha256: sha256("dependencies"),
      executableIdentityId: "nhm2.test.constraint-executable/v1",
      executableSha256: sha256("executable"),
    },
    execution: {
      commitSha: sha256("commit").slice(0, 40),
      command: "constraint-solver --emit-frozen-operands",
      argv: ["constraint-solver", "--emit-frozen-operands"],
      outputDirectory: OUTPUT_DIRECTORY,
      startedAt: "2026-08-13T14:00:00.000Z",
      completedAt: "2026-08-13T14:00:02.000Z",
      durationMs: 2_000,
      exitCode: 0,
      terminationSignal: null,
    },
    levels: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_LEVELS.map((level) => ({
      ...level,
      families: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_FAMILY_ORDER.map(
        (familyId) => ({
          familyId,
          operandOrder: [
            ...NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ROLE_ORDER[familyId],
          ],
          residualFormula:
            NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_RESIDUAL_FORMULAS[
              familyId
            ],
          operands: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ROLE_ORDER[
            familyId
          ].map((role) => descriptor(level.levelId, familyId, role)),
        }),
      ),
    })),
    operandInventorySha256: "0".repeat(64),
    authorityBoundary: structuredClone(
      NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_AUTHORITY_BOUNDARY,
    ),
  };
  value.operandInventorySha256 =
    computeNhm2SemiclassicalV2ConstraintOperandInventorySha256(value);
  return value;
};

const residualSeed = (ordinal: number, variant: FixtureVariant): number => {
  if (
    variant === "zero_convergence" ||
    variant === "prior_failure_then_zero_convergence"
  )
    return 0.01;
  if (variant === "central_failure") return [0.4, 0.25, 0.2][ordinal];
  if (variant === "order_failure") return [0.04, 0.025, 0.012][ordinal];
  return [0.04, 0.01, 0.0025][ordinal];
};

const filled = (value: number): number[] =>
  Array.from({ length: 64 * 4 }, () => value);

const familyVectors = (
  levelOrdinal: number,
  familyId: Nhm2SemiclassicalV2ConstraintOperandFamilyId,
  variant: FixtureVariant,
): Record<string, number[]> => {
  const desired = residualSeed(levelOrdinal, variant);
  const uncertainty = filled(1e-6);
  if (variant === "negative_uncertainty" && levelOrdinal === 0) {
    uncertainty[0] = -1;
  }

  if (familyId === "H_H" || familyId === "H_Hi" || familyId === "Hi_Hj") {
    const signedZeroEcho =
      variant === "signed_zero_echo" &&
      familyId === "H_H" &&
      levelOrdinal === 0;
    const targetValue = signedZeroEcho ? 0 : 0.2;
    const computedValue =
      (variant === "echo" && familyId === "H_H" && levelOrdinal === 0) ||
      signedZeroEcho
        ? targetValue
        : targetValue + desired;
    const actual = computedValue - targetValue;
    const residual = filled(actual);
    if (
      (variant === "residual_mismatch" ||
        variant === "prior_failure_then_overflow" ||
        variant === "prior_failure_then_zero_convergence") &&
      familyId === "H_H" &&
      levelOrdinal ===
        (variant === "prior_failure_then_overflow" ||
        variant === "prior_failure_then_zero_convergence"
          ? 0
          : 2)
    ) {
      residual[0] += 1e-4;
    }
    const target = filled(targetValue);
    if (variant === "nonfinite" && familyId === "H_H" && levelOrdinal === 0) {
      target[0] = Number.NaN;
    }
    const computed = filled(computedValue);
    if (signedZeroEcho) computed[0] = -0;
    return {
      computed,
      target,
      residual,
      absolute_uncertainty95: uncertainty,
    };
  }

  if (familyId === "antisymmetry") {
    if (variant === "prior_failure_then_overflow" && levelOrdinal === 0) {
      return {
        forward: filled(Number.MAX_VALUE),
        reverse: filled(Number.MAX_VALUE),
        residual: filled(desired),
        absolute_uncertainty95: uncertainty,
      };
    }
    const forwardValue = 0.2;
    const reverseValue = -0.2 + desired;
    const actual = forwardValue + reverseValue;
    return {
      forward: filled(forwardValue),
      reverse: filled(reverseValue),
      residual: filled(actual),
      absolute_uncertainty95: uncertainty,
    };
  }

  const term1Value = 0.1;
  const term2Value = 0.2;
  const term3Value = -0.3 + desired;
  const actual = term1Value + term2Value + term3Value;
  return {
    term_1: filled(term1Value),
    term_2: filled(term2Value),
    term_3: filled(term3Value),
    residual: filled(actual),
    absolute_uncertainty95: uncertainty,
  };
};

const encodeFloat64Le = (values: readonly number[]): Uint8Array => {
  const bytes = new Uint8Array(
    NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
  );
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) =>
    view.setFloat64(index * Float64Array.BYTES_PER_ELEMENT, value, true),
  );
  return bytes;
};

const fixture = (
  variant: FixtureVariant = "pass",
): {
  manifest: Nhm2SemiclassicalV2ConstraintOperandReplayV1;
  input: Nhm2SemiclassicalV2ConstraintOperandReplayInputV1;
} => {
  const replayManifest = manifest();
  const bytesByPath = new Map<string, Uint8Array>();
  replayManifest.levels.forEach((level, levelOrdinal) => {
    level.families.forEach((family) => {
      const vectors = familyVectors(levelOrdinal, family.familyId, variant);
      family.operands.forEach((operand) => {
        const bytes = encodeFloat64Le(vectors[operand.operandRole]);
        operand.sha256 = sha256(bytes);
        bytesByPath.set(operand.path, bytes);
      });
    });
  });
  replayManifest.operandInventorySha256 =
    computeNhm2SemiclassicalV2ConstraintOperandInventorySha256(replayManifest);
  const fileObservations = collectNhm2SemiclassicalV2ConstraintOperandArrays(
    replayManifest,
  ).map((operand) => ({
    observationMode: "caller_supplied_secure_file_reader" as const,
    operandRole: operand.operandRole,
    path: operand.path,
    sha256: operand.sha256,
    sizeBytes: operand.sizeBytes,
    freshness: operand.freshness,
    observedAt: operand.observedAt,
    scientificPresealSealKey: operand.scientificPresealSealKey,
    bytes: bytesByPath.get(operand.path)!,
  }));
  return {
    manifest: replayManifest,
    input: {
      contractVersion:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAYER_INPUT_CONTRACT_VERSION,
      manifest: replayManifest,
      fileObservations,
    },
  };
};

const issueCodes = (
  result: ReturnType<typeof replayNhm2SemiclassicalV2ConstraintOperands>,
) => result.issues.map(({ code }) => code);

describe("NHM2 semiclassical-v2 server constraint operand replayer", () => {
  it("rehashes and replays all 63 arrays while retaining every authority blocker", () => {
    const { input } = fixture();
    const result = replayNhm2SemiclassicalV2ConstraintOperands(input);

    expect(result.arithmeticDisposition).toBe("pass");
    expect(result.overallDisposition).toBe("blocked");
    expect(result.calculationComplete).toBe(true);
    expect(result.families.map(({ familyId }) => familyId)).toEqual(
      NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_FAMILY_ORDER,
    );
    expect(
      result.families.every(({ convergence }) => convergence.pLower > 1),
    ).toBe(true);
    expect(issueCodes(result)).toEqual([
      "scientific_preseal_not_server_resolved",
      "constraint_joint_uncertainty_coverage_not_server_verified",
      "constraint_target_derivation_not_server_replayed",
      "filesystem_observation_authority_not_established",
    ]);
    expect(result.inputBinding).toMatchObject({
      candidateId: CANDIDATE_ID,
      observationCount: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_COUNT,
      aggregateBytes:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_COUNT *
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
      observationClosureSha256Domain:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OBSERVATION_CLOSURE_SHA256_DOMAIN,
    });
    expect(result.inputBinding?.observationClosureSha256).toBe(
      computeNhm2SemiclassicalV2ConstraintObservationClosureSha256(
        input.fileObservations,
      ),
    );
    expect(result.serviceBoundary).toEqual(
      NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAYER_SERVICE_BOUNDARY,
    );
    expect(result.authorityBoundary.schemaImplemented).toBe(true);
    expect(
      Object.entries(result.authorityBoundary)
        .filter(([key]) => key !== "schemaImplemented")
        .every(([, value]) => value === false),
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.families[0].convergence)).toBe(true);
  });

  it.each([
    ["echo", "computed_target_exact_echo_forbidden"],
    ["signed_zero_echo", "computed_target_exact_echo_forbidden"],
    ["residual_mismatch", "submitted_residual_mismatch_tolerance_exceeded"],
    ["negative_uncertainty", "decoded_uncertainty_negative"],
    ["central_failure", "central_residual_upper95_tolerance_exceeded"],
    ["order_failure", "regulator_order_failed"],
  ] as const)("fails the frozen arithmetic policy for %s", (variant, code) => {
    const result = replayNhm2SemiclassicalV2ConstraintOperands(
      fixture(variant).input,
    );
    expect(issueCodes(result)).toContain(code);
    expect(result.arithmeticDisposition).toBe("fail");
    expect(result.overallDisposition).toBe("blocked");
    expect(result.authorityBoundary).toEqual(
      NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_REPLAY_AUTHORITY_BOUNDARY,
    );
  });

  it("blocks zero interlevel evidence without inventing a numerical floor", () => {
    const result = replayNhm2SemiclassicalV2ConstraintOperands(
      fixture("zero_convergence").input,
    );
    expect(result.calculationComplete).toBe(false);
    expect(result.arithmeticDisposition).toBe("blocked");
    expect(result.firstIssue).toBe(
      "regulator_zero_or_nonpositive_interlevel_bound",
    );
    expect(result.families).toEqual([]);
  });

  it("does not duplicate a prior failure when zero convergence later blocks", () => {
    const result = replayNhm2SemiclassicalV2ConstraintOperands(
      fixture("prior_failure_then_zero_convergence").input,
    );
    expect(result.arithmeticDisposition).toBe("fail");
    expect(
      issueCodes(result).filter(
        (code) => code === "submitted_residual_mismatch_tolerance_exceeded",
      ),
    ).toHaveLength(1);
    expect(issueCodes(result)).toContain(
      "regulator_zero_or_nonpositive_interlevel_bound",
    );
  });

  it("blocks nonfinite raw operands before arithmetic", () => {
    const result = replayNhm2SemiclassicalV2ConstraintOperands(
      fixture("nonfinite").input,
    );
    expect(result.calculationComplete).toBe(false);
    expect(result.firstIssue).toBe("decoded_operand_nonfinite");
    expect(
      result.provenanceBoundary.everyFileByteStringRehashedAndDecoded,
    ).toBe(false);
  });

  it("preserves an earlier frozen failure when later arithmetic overflows", () => {
    const result = replayNhm2SemiclassicalV2ConstraintOperands(
      fixture("prior_failure_then_overflow").input,
    );
    expect(result.calculationComplete).toBe(false);
    expect(result.arithmeticDisposition).toBe("fail");
    expect(issueCodes(result)).toContain(
      "submitted_residual_mismatch_tolerance_exceeded",
    );
    expect(issueCodes(result)).toContain("arithmetic_nonfinite_or_overflow");
    expect(result.firstIssue).toBe(
      "submitted_residual_mismatch_tolerance_exceeded",
    );
  });

  it("rejects byte/hash and manifest inventory drift", () => {
    const byteDrift = fixture();
    byteDrift.input.fileObservations[0].bytes[0] ^= 1;
    const bytesResult = replayNhm2SemiclassicalV2ConstraintOperands(
      byteDrift.input,
    );
    expect(bytesResult.firstIssue).toBe("file_sha256_mismatch");

    const manifestDrift = fixture();
    manifestDrift.manifest.operandInventorySha256 = "f".repeat(64);
    const manifestResult = replayNhm2SemiclassicalV2ConstraintOperands(
      manifestDrift.input,
    );
    expect(manifestResult.firstIssue).toBe("manifest_invalid");
  });

  it("rejects aliased backing storage and partial views", () => {
    const alias = fixture();
    const shared = alias.input.fileObservations[0].bytes.buffer;
    const aliasObservations = alias.input.fileObservations as unknown as Array<{
      bytes: Uint8Array;
    }>;
    aliasObservations[0].bytes = new Uint8Array(shared);
    aliasObservations[1].bytes = new Uint8Array(shared);
    const aliasResult = replayNhm2SemiclassicalV2ConstraintOperands(
      alias.input,
    );
    expect(issueCodes(aliasResult)).toContain(
      "file_bytes_backing_buffer_not_unique",
    );

    const partial = fixture();
    const original = partial.input.fileObservations[0].bytes;
    const oversized = new Uint8Array(original.byteLength + 1);
    oversized.set(original);
    const partialObservations = partial.input
      .fileObservations as unknown as Array<{ bytes: Uint8Array }>;
    partialObservations[0].bytes = oversized.subarray(0, original.byteLength);
    const partialResult = replayNhm2SemiclassicalV2ConstraintOperands(
      partial.input,
    );
    expect(partialResult.firstIssue).toBe("input_snapshot_invalid");
  });

  it("rejects deep and wide hostile data within fixed snapshot bounds", () => {
    const deep = fixture();
    const hostileRoot: Record<string, unknown> = {};
    let cursor = hostileRoot;
    for (let index = 0; index < 20_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    (deep.manifest as unknown as Record<string, unknown>).hostile = hostileRoot;
    expect(
      replayNhm2SemiclassicalV2ConstraintOperands(deep.input).firstIssue,
    ).toBe("input_snapshot_invalid");

    const wide = fixture();
    (wide.manifest as unknown as Record<string, unknown>).hostile =
      Object.fromEntries(
        Array.from({ length: 20_000 }, (_, index) => [`k${index}`, index]),
      );
    expect(
      replayNhm2SemiclassicalV2ConstraintOperands(wide.input).firstIssue,
    ).toBe("input_snapshot_invalid");
  });

  it("does not invoke accessors or nested proxy traps", () => {
    const accessor = fixture();
    let getterReads = 0;
    Object.defineProperty(accessor.input, "manifest", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterReads += 1;
        return accessor.manifest;
      },
    });
    expect(
      replayNhm2SemiclassicalV2ConstraintOperands(accessor.input).firstIssue,
    ).toBe("input_snapshot_invalid");
    expect(getterReads).toBe(0);

    const nestedProxy = fixture();
    let trapReads = 0;
    (nestedProxy.manifest as unknown as Record<string, unknown>).hostile =
      new Proxy(
        {},
        {
          ownKeys: () => {
            trapReads += 1;
            return [];
          },
          getOwnPropertyDescriptor: () => {
            trapReads += 1;
            return undefined;
          },
        },
      );
    expect(
      replayNhm2SemiclassicalV2ConstraintOperands(nestedProxy.input).firstIssue,
    ).toBe("input_snapshot_invalid");
    expect(trapReads).toBe(0);
  });
});
