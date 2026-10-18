import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_ARITHMETIC_POLICY_BINDING,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_COMPLETE_INPUT_CLOSURE_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_COMPLETE_INPUT_CLOSURE_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_MANIFEST_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_MANIFEST_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_SCHEMA_BOUNDARY,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_INPUT_CLOSURE_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_INPUT_CLOSURE_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_PRESEAL_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_PRESEAL_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V3_REPLAY_EPOCH_POLICY_BINDING,
  computeNhm2SemiclassicalV3ConstraintCompleteInputClosureSha256,
  computeNhm2SemiclassicalV3ConstraintOperandInventorySha256,
  computeNhm2SemiclassicalV3ConstraintScientificInputClosureSha256,
  computeNhm2SemiclassicalV3ConstraintScientificPresealSealKey,
  type Nhm2SemiclassicalV3ConstraintFamilyId,
  type Nhm2SemiclassicalV3ConstraintOperandArrayV1,
  type Nhm2SemiclassicalV3ConstraintOperandManifestV1,
} from "../../../../shared/contracts/nhm2-semiclassical-v3-constraint-operand-manifest.v1";
import {
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_ARITHMETIC_POLICY,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_ARRAY_COUNT,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_CHANNEL_ORDER,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_FAMILY_ORDER,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_LEVELS,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_ROLE_ORDER,
  NHM2_SEMICLASSICAL_V3_REPLAY_EPOCH_CLAIM_LOCK_KEYS,
  NHM2_SEMICLASSICAL_V3_REPLAY_EPOCH_CLAIM_LOCKS,
  NHM2_SEMICLASSICAL_V3_REQUIRED_INPUT_IDS,
  NHM2_SEMICLASSICAL_V3_SCIENTIFIC_INPUT_IDS,
} from "../../../../shared/contracts/nhm2-semiclassical-v3-replay-epoch.v1";
import {
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_OBSERVATION_CLOSURE_SHA256_DOMAIN,
  NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_INPUT_CONTRACT_VERSION,
  canonicalizeNhm2SemiclassicalV3ConstraintObservationClosureV1,
  computeNhm2SemiclassicalV3ConstraintObservationClosureSha256,
  replayNhm2SemiclassicalV3ConstraintOperands,
  type Nhm2SemiclassicalV3ConstraintOperandFileObservationV1,
  type Nhm2SemiclassicalV3ConstraintOperandReplayInputV1,
} from "../nhm2-semiclassical-v3-constraint-operand-replayer";

const hash = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const CANDIDATE_ID = "nhm2.semiclassical_v3.constraint_replay.candidate/v1";
const PRESEAL_ID = "nhm2.semiclassical_v3.constraint_replay.preseal/v1";
const SCIENCE_OBSERVED_AT = "2026-08-11T11:59:58.000Z";
const SEALED_AT = "2026-08-11T11:59:59.000Z";
const IMPLEMENTATION_OBSERVED_AT = "2026-08-11T11:59:59.500Z";
const COMPLETE_INPUT_FROZEN_AT = "2026-08-11T11:59:59.750Z";
const STARTED_AT = "2026-08-11T12:00:00.000Z";
const COMPLETED_AT = "2026-08-11T12:00:02.000Z";
const OBSERVED_AT = "2026-08-11T12:00:03.000Z";
const GENERATED_AT = "2026-08-11T12:00:04.000Z";

const encodeConstant = (value: number): Uint8Array => {
  const buffer = new ArrayBuffer(
    NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
  );
  const view = new DataView(buffer);
  for (let index = 0; index < 64 * 4; index += 1) {
    view.setFloat64(index * Float64Array.BYTES_PER_ELEMENT, value, true);
  }
  return new Uint8Array(buffer);
};

const roleValue = (
  familyId: Nhm2SemiclassicalV3ConstraintFamilyId,
  role: string,
  residual: number,
): number => {
  if (role === "absolute_uncertainty95") return 0;
  if (role === "residual") return residual;
  if (
    (familyId === "H_H" || familyId === "H_Hi" || familyId === "Hi_Hj") &&
    role === "computed"
  ) {
    return residual;
  }
  if (familyId === "antisymmetry" && role === "forward") return residual;
  if (familyId === "jacobi" && role === "term_1") return residual;
  return 0;
};

type Fixture = {
  input: Nhm2SemiclassicalV3ConstraintOperandReplayInputV1;
  manifest: Nhm2SemiclassicalV3ConstraintOperandManifestV1;
  observations: Nhm2SemiclassicalV3ConstraintOperandFileObservationV1[];
};

const buildFixture = (lane: "primary" | "independent" = "primary"): Fixture => {
  const observations: Nhm2SemiclassicalV3ConstraintOperandFileObservationV1[] =
    [];
  const outputDirectory = `artifacts/v3-constraint-replay/${lane}`;
  const scientificInputs = NHM2_SEMICLASSICAL_V3_SCIENTIFIC_INPUT_IDS.map(
    (inputId) => ({
      inputId,
      identityId:
        inputId === "candidate_manifest"
          ? CANDIDATE_ID
          : `nhm2.semiclassical_v3.input.${inputId}/v1`,
      sha256: hash(`science:${inputId}`),
      sizeBytes: 1_024 + inputId.length,
      observedAt: SCIENCE_OBSERVED_AT,
    }),
  );
  const scientificInputClosure = {
    artifactId:
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_INPUT_CLOSURE_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_INPUT_CLOSURE_CONTRACT_VERSION,
    requiredInputIds: [...NHM2_SEMICLASSICAL_V3_SCIENTIFIC_INPUT_IDS],
    inputs: scientificInputs,
    sha256: "0".repeat(64),
  };
  scientificInputClosure.sha256 =
    computeNhm2SemiclassicalV3ConstraintScientificInputClosureSha256(
      scientificInputClosure,
    );
  const scientificById = new Map<string, (typeof scientificInputs)[number]>(
    scientificInputs.map((descriptor) => [descriptor.inputId, descriptor]),
  );
  const completeInputs = NHM2_SEMICLASSICAL_V3_REQUIRED_INPUT_IDS.map(
    (inputId) => {
      const scientific = scientificById.get(inputId);
      if (scientific != null) return structuredClone(scientific);
      return {
        inputId,
        identityId: `nhm2.semiclassical_v3.input.${inputId}.${lane}/v1`,
        sha256: hash(`implementation:${inputId}:${lane}`),
        sizeBytes: 2_048 + inputId.length,
        observedAt: IMPLEMENTATION_OBSERVED_AT,
      };
    },
  );
  const completeInputClosure = {
    artifactId:
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_COMPLETE_INPUT_CLOSURE_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_COMPLETE_INPUT_CLOSURE_CONTRACT_VERSION,
    requiredInputIds: [...NHM2_SEMICLASSICAL_V3_REQUIRED_INPUT_IDS],
    inputs: completeInputs,
    scientificInputClosureSha256: scientificInputClosure.sha256,
    frozenAt: COMPLETE_INPUT_FROZEN_AT,
    sha256: "0".repeat(64),
  };
  completeInputClosure.sha256 =
    computeNhm2SemiclassicalV3ConstraintCompleteInputClosureSha256(
      completeInputClosure,
    );
  const candidateManifest = scientificInputs.find(
    (descriptor) => descriptor.inputId === "candidate_manifest",
  )!;
  const sealKey = computeNhm2SemiclassicalV3ConstraintScientificPresealSealKey({
    presealId: PRESEAL_ID,
    candidateId: CANDIDATE_ID,
    candidateManifestSha256: candidateManifest.sha256,
    scientificInputClosureSha256: scientificInputClosure.sha256,
  });
  const residualByLevel = [0.04, 0.02, 0.01] as const;
  const levels = NHM2_SEMICLASSICAL_V3_CONSTRAINT_LEVELS.map(
    (level, levelIndex) => ({
      ...level,
      families: NHM2_SEMICLASSICAL_V3_CONSTRAINT_FAMILY_ORDER.map(
        (familyId) => {
          const roles = NHM2_SEMICLASSICAL_V3_CONSTRAINT_ROLE_ORDER[familyId];
          const operands = roles.map((operandRole) => {
            const bytes = encodeConstant(
              roleValue(familyId, operandRole, residualByLevel[levelIndex]),
            );
            const path = `${outputDirectory}/${level.levelId}/${familyId}/${operandRole}.f64le`;
            const arrayRole = `constraint_operand.${level.levelId}.${familyId}.${operandRole}`;
            const sha256 = hash(bytes);
            observations.push({
              observationMode: "caller_supplied_secure_file_reader",
              arrayRole,
              path,
              sha256,
              sizeBytes:
                NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
              freshness: "new",
              observedAt: OBSERVED_AT,
              bytes,
            });
            return {
              arrayRole,
              operandRole,
              path,
              sha256,
              sizeBytes:
                NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
              freshness: "new" as const,
              observedAt: OBSERVED_AT,
              scientificPresealSealKey: sealKey,
              dtype: "float64" as const,
              binaryEncoding: "raw_ieee754" as const,
              endianness: "little" as const,
              shape: [64, 4] as [64, 4],
              storageOrder: "row-major" as const,
              componentOrder: [
                ...NHM2_SEMICLASSICAL_V3_CONSTRAINT_CHANNEL_ORDER,
              ] as ["hamiltonian", "momentum_x", "momentum_y", "momentum_z"],
              sampleOrder: "candidate_sampling_ordinal_0_to_63" as const,
              unit: "dimensionless_barred_constraint_generator" as const,
            } satisfies Nhm2SemiclassicalV3ConstraintOperandArrayV1;
          });
          return {
            familyId,
            operandOrder: [...roles],
            residualFormula:
              NHM2_SEMICLASSICAL_V3_CONSTRAINT_ARITHMETIC_POLICY
                .residualFormulas[familyId],
            operands,
          };
        },
      ),
    }),
  );

  const implementationSource = completeInputs.find(
    (descriptor) => descriptor.inputId === "implementation_source",
  )!;
  const dependencyLock = completeInputs.find(
    (descriptor) => descriptor.inputId === "dependency_lock",
  )!;
  const executable = completeInputs.find(
    (descriptor) => descriptor.inputId === "executable",
  )!;
  const manifest: Nhm2SemiclassicalV3ConstraintOperandManifestV1 = {
    artifactId: NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_MANIFEST_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_MANIFEST_CONTRACT_VERSION,
    generatedAt: GENERATED_AT,
    replayEpochPolicyBinding: structuredClone(
      NHM2_SEMICLASSICAL_V3_REPLAY_EPOCH_POLICY_BINDING,
    ),
    constraintArithmeticPolicyBinding: structuredClone(
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_ARITHMETIC_POLICY_BINDING,
    ),
    candidateBinding: {
      candidateId: CANDIDATE_ID,
      candidateManifestSha256: candidateManifest.sha256,
      scientificInputClosureSha256: scientificInputClosure.sha256,
      scientificPresealBinding: {
        artifactId:
          NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_PRESEAL_ARTIFACT_ID,
        contractVersion:
          NHM2_SEMICLASSICAL_V3_CONSTRAINT_SCIENTIFIC_PRESEAL_CONTRACT_VERSION,
        presealId: PRESEAL_ID,
        sealKey,
        candidateId: CANDIDATE_ID,
        candidateManifestSha256: candidateManifest.sha256,
        scientificInputClosureSha256: scientificInputClosure.sha256,
        sealedAt: SEALED_AT,
      },
    },
    scientificInputClosure,
    completeInputClosure,
    implementation: {
      comparisonPairId: "nhm2.semiclassical_v3.constraint_pair.test/v1",
      role: lane,
      implementationId: `nhm2.semiclassical_v3.implementation.${lane}/v1`,
      sourceIdentityId: implementationSource.identityId,
      sourceSha256: implementationSource.sha256,
      dependencyLockIdentityId: dependencyLock.identityId,
      dependencyLockSha256: dependencyLock.sha256,
      executableIdentityId: executable.identityId,
      executableSha256: executable.sha256,
    },
    execution: {
      runId: `nhm2.semiclassical_v3.constraint_run.${lane}/v1`,
      commitSha: hash(`commit:${lane}`).slice(0, 40),
      command: "solver --emit-constraint-operands",
      argv: ["solver", "--emit-constraint-operands"],
      outputDirectory: outputDirectory,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      durationMs: 2_000,
      exitCode: 0,
      terminationSignal: null,
    },
    levels,
    operandInventorySha256: "0".repeat(64),
    claimLocks: structuredClone(NHM2_SEMICLASSICAL_V3_REPLAY_EPOCH_CLAIM_LOCKS),
    schemaBoundary: structuredClone(
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_SCHEMA_BOUNDARY,
    ),
  };
  manifest.operandInventorySha256 =
    computeNhm2SemiclassicalV3ConstraintOperandInventorySha256(manifest);
  return {
    input: {
      contractVersion:
        NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_INPUT_CONTRACT_VERSION,
      manifest,
      fileObservations: observations,
    },
    manifest,
    observations,
  };
};

const cloneFixture = (fixture: Fixture): Fixture => {
  const input = structuredClone(
    fixture.input,
  ) as Nhm2SemiclassicalV3ConstraintOperandReplayInputV1;
  return {
    input,
    manifest: input.manifest as Nhm2SemiclassicalV3ConstraintOperandManifestV1,
    observations:
      input.fileObservations as Nhm2SemiclassicalV3ConstraintOperandFileObservationV1[],
  };
};

const updateRole = (
  fixture: Fixture,
  levelId: string,
  familyId: Nhm2SemiclassicalV3ConstraintFamilyId,
  role: string,
  value: number,
): void => {
  const level = fixture.manifest.levels.find(
    (candidate) => candidate.levelId === levelId,
  )!;
  const family = level.families.find(
    (candidate) => candidate.familyId === familyId,
  )!;
  const descriptor = family.operands.find(
    (candidate) => candidate.operandRole === role,
  )!;
  const expectedRole = `constraint_operand.${levelId}.${familyId}.${role}`;
  const observation = fixture.observations.find(
    (candidate) => candidate.arrayRole === expectedRole,
  )! as unknown as {
    sha256: string;
    sizeBytes: number;
    bytes: Uint8Array;
  };
  const bytes = encodeConstant(value);
  const sha256 = hash(bytes);
  descriptor.sha256 = sha256;
  observation.sha256 = sha256;
  observation.sizeBytes = bytes.byteLength;
  observation.bytes = bytes;
  fixture.manifest.operandInventorySha256 =
    computeNhm2SemiclassicalV3ConstraintOperandInventorySha256(
      fixture.manifest,
    );
};

const blockerCodes = (fixture: Fixture): string[] =>
  replayNhm2SemiclassicalV3ConstraintOperands(fixture.input).blockers.map(
    (entry) => entry.code,
  );

describe("NHM2 semiclassical-v3 constraint operand secure replay", () => {
  it("rehashes and decodes all 63 arrays and recomputes every family", () => {
    const fixture = buildFixture();
    const result = replayNhm2SemiclassicalV3ConstraintOperands(fixture.input);
    expect(fixture.observations).toHaveLength(
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_ARRAY_COUNT,
    );
    expect(result.arithmeticDisposition).toBe("pass");
    expect(result.overallDisposition).toBe("blocked");
    expect(result.calculationComplete).toBe(true);
    expect(result.blockers.map((entry) => entry.code)).toEqual([
      "constraint_joint_uncertainty_coverage_not_server_verified",
      "constraint_target_derivation_not_server_replayed",
    ]);
    expect(result.inputBinding).toMatchObject({
      scientificInputClosureSha256:
        fixture.manifest.scientificInputClosure.sha256,
      completeInputClosureSha256: fixture.manifest.completeInputClosure.sha256,
      observationCount: 63,
      aggregateBytes: 63 * 2_048,
      observationClosureSha256Domain:
        NHM2_SEMICLASSICAL_V3_CONSTRAINT_OBSERVATION_CLOSURE_SHA256_DOMAIN,
    });
    expect(
      fixture.observations.every((observation) =>
        observation.arrayRole.startsWith("constraint_operand.level_"),
      ),
    ).toBe(true);
    expect(
      new Set(fixture.observations.map((observation) => observation.arrayRole))
        .size,
    ).toBe(63);
    expect(result.families.map((family) => family.familyId)).toEqual(
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_FAMILY_ORDER,
    );
    for (const family of result.families) {
      expect(family.levels).toHaveLength(3);
      expect(family.levels[0].serverResidual).toHaveLength(64 * 4);
      expect(family.levels[0].serverResidual[0]).toBeCloseTo(0.04, 14);
      expect(family.levels[1].serverResidual[0]).toBeCloseTo(0.02, 14);
      expect(family.levels[2].serverResidual[0]).toBeCloseTo(0.01, 14);
      expect(family.convergence.q0).toBeCloseTo(0.04, 14);
      expect(family.convergence.q1).toBeCloseTo(0.02, 14);
      expect(family.convergence.q2).toBeCloseTo(0.01, 14);
      expect(family.convergence.D01Lower).toBeCloseTo(0.02, 14);
      expect(family.convergence.D01Upper).toBeCloseTo(0.02, 14);
      expect(family.convergence.D12Lower).toBeCloseTo(0.01, 14);
      expect(family.convergence.D12Upper).toBeCloseTo(0.01, 14);
      expect(family.convergence.pLower).toBeCloseTo(1, 14);
      expect(family.producerResidualMismatchLInf).toBe(0);
    }
    expect(result.provenanceBoundary).toMatchObject({
      inputSnapshotAttemptedExactlyOnce: true,
      inputSnapshotCompleted: true,
      inputSnapshottedExactlyOnce: true,
      manifestStructurallyValidatedAfterSnapshot: true,
      fileBytesRehashedAndDecoded: true,
      filesystemReadPerformedByService: false,
      filesystemSecurityEstablished: false,
      jointUncertaintyCoverageServerVerified: false,
      targetDerivationServerReplayed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.families[0])).toBe(true);
    expect(Object.isFrozen(result.families[0].levels[0].serverResidual)).toBe(
      true,
    );
  });

  it("domain-separates the canonical observation closure from bare and drifted hashes", () => {
    const fixture = buildFixture();
    const canonicalPayload = JSON.stringify(
      fixture.observations.map((observation) => ({
        observationMode: observation.observationMode,
        arrayRole: observation.arrayRole,
        path: observation.path,
        sha256: observation.sha256,
        sizeBytes: observation.sizeBytes,
        freshness: observation.freshness,
        observedAt: observation.observedAt,
      })),
    );
    const expected = hash(
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_OBSERVATION_CLOSURE_SHA256_DOMAIN +
        canonicalPayload,
    );
    const result = replayNhm2SemiclassicalV3ConstraintOperands(fixture.input);

    expect(
      canonicalizeNhm2SemiclassicalV3ConstraintObservationClosureV1(
        fixture.observations,
      ),
    ).toBe(canonicalPayload);
    expect(
      computeNhm2SemiclassicalV3ConstraintObservationClosureSha256(
        fixture.observations,
      ),
    ).toBe(expected);
    expect(result.inputBinding).toMatchObject({
      observationClosureSha256Domain:
        NHM2_SEMICLASSICAL_V3_CONSTRAINT_OBSERVATION_CLOSURE_SHA256_DOMAIN,
      observationClosureSha256: expected,
    });
    expect(expected).not.toBe(hash(canonicalPayload));
    expect(expected).not.toBe(
      hash(
        "nhm2-semiclassical-v3-constraint-observation-closure/v2\n" +
          canonicalPayload,
      ),
    );
  });

  it("keeps every integration, lamp, theory, empirical, and physical lock false", () => {
    const result = replayNhm2SemiclassicalV3ConstraintOperands(
      buildFixture().input,
    );
    for (const [key, value] of Object.entries(result.claimLocks)) {
      expect(value, key).toBe(false);
    }
    expect(Object.keys(result.claimLocks)).toEqual([
      ...NHM2_SEMICLASSICAL_V3_REPLAY_EPOCH_CLAIM_LOCK_KEYS,
    ]);
    expect(result.diagnosticOnly).toBe(true);
    expect(
      Object.values(result.serviceBoundary).every((value) => value === false),
    ).toBe(true);
    expect(result.serviceBoundary.jointUncertaintyCoverageVerified).toBe(false);
    expect(result.serviceBoundary.targetDerivationServerReplayed).toBe(false);
  });

  it("fails closed on missing, reordered, mismatched, corrupt, or partial file observations", () => {
    const missing = buildFixture();
    missing.observations.pop();
    const missingResult = replayNhm2SemiclassicalV3ConstraintOperands(
      missing.input,
    );
    expect(missingResult.arithmeticDisposition).toBe("blocked");
    expect(missingResult.blockers).toContainEqual(
      expect.objectContaining({
        code: "file_observation_count_invalid",
        disposition: "blocked",
      }),
    );

    const reordered = buildFixture();
    reordered.observations.reverse();
    expect(blockerCodes(reordered)).toContain("file_observation_role_invalid");

    const pathMismatch = buildFixture();
    (pathMismatch.observations[0] as unknown as { path: string }).path =
      "artifacts/unbound.f64le";
    expect(blockerCodes(pathMismatch)).toContain(
      "file_observation_metadata_invalid",
    );

    const corrupt = buildFixture();
    corrupt.observations[0].bytes[0] ^= 0xff;
    expect(blockerCodes(corrupt)).toContain("file_sha256_mismatch");

    const partial = buildFixture();
    const padded = new Uint8Array(
      NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES + 16,
    );
    padded.set(partial.observations[0].bytes, 8);
    (partial.observations[0] as unknown as { bytes: Uint8Array }).bytes =
      new Uint8Array(
        padded.buffer,
        8,
        NHM2_SEMICLASSICAL_V3_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
      );
    expect(blockerCodes(partial)).toContain("file_bytes_full_view_invalid");
  });

  it("rejects distinct full views that alias one backing buffer", () => {
    const fixture = buildFixture();
    const first = fixture.observations.find(
      (observation) =>
        observation.arrayRole === "constraint_operand.level_0.H_H.target",
    )!;
    const second = fixture.observations.find(
      (observation) =>
        observation.arrayRole === "constraint_operand.level_0.H_Hi.target",
    )! as unknown as { bytes: Uint8Array };
    second.bytes = new Uint8Array(first.bytes.buffer);
    const result = replayNhm2SemiclassicalV3ConstraintOperands(fixture.input);
    expect(result.arithmeticDisposition).toBe("blocked");
    expect(result.calculationComplete).toBe(false);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        code: "file_bytes_backing_buffer_not_unique",
        disposition: "blocked",
      }),
    );
  });

  it("binds one shared science seal while keeping lane run closures distinct", () => {
    const primary = buildFixture("primary");
    const independent = buildFixture("independent");
    const primaryResult = replayNhm2SemiclassicalV3ConstraintOperands(
      primary.input,
    );
    const independentResult = replayNhm2SemiclassicalV3ConstraintOperands(
      independent.input,
    );
    expect(primary.manifest.scientificInputClosure).toEqual(
      independent.manifest.scientificInputClosure,
    );
    expect(primary.manifest.candidateBinding.scientificPresealBinding).toEqual(
      independent.manifest.candidateBinding.scientificPresealBinding,
    );
    expect(primaryResult.inputBinding?.scientificInputClosureSha256).toBe(
      independentResult.inputBinding?.scientificInputClosureSha256,
    );
    expect(primaryResult.inputBinding?.completeInputClosureSha256).not.toBe(
      independentResult.inputBinding?.completeInputClosureSha256,
    );
    expect(primaryResult.arithmeticDisposition).toBe("pass");
    expect(independentResult.arithmeticDisposition).toBe("pass");
  });

  it("accepts only the clean v3 manifest and has no legacy contract import", () => {
    for (const generation of ["v1", "v2"] as const) {
      const fixture = buildFixture();
      fixture.manifest.contractVersion =
        `nhm2_semiclassical_${generation}_constraint_operand_manifest/v1` as never;
      fixture.manifest.operandInventorySha256 =
        computeNhm2SemiclassicalV3ConstraintOperandInventorySha256(
          fixture.manifest,
        );
      const result = replayNhm2SemiclassicalV3ConstraintOperands(fixture.input);
      expect(result.firstBlocker).toBe("manifest_invalid");
      expect(result.calculationComplete).toBe(false);
    }

    const serviceSource = readFileSync(
      new URL(
        "../nhm2-semiclassical-v3-constraint-operand-replayer.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(serviceSource).not.toMatch(
      /semiclassical-v[12]|SEMICLASSICAL_V[12]|SemiclassicalV[12]/,
    );
  });

  it("rejects nonfinite operands and negative uncertainty after valid rehashing", () => {
    const nonfinite = buildFixture();
    updateRole(nonfinite, "level_0", "H_H", "computed", Number.NaN);
    const nonfiniteResult = replayNhm2SemiclassicalV3ConstraintOperands(
      nonfinite.input,
    );
    expect(nonfiniteResult.arithmeticDisposition).toBe("fail");
    expect(nonfiniteResult.blockers).toContainEqual(
      expect.objectContaining({
        code: "decoded_operand_nonfinite",
        disposition: "fail",
      }),
    );

    const negativeUncertainty = buildFixture();
    updateRole(
      negativeUncertainty,
      "level_1",
      "jacobi",
      "absolute_uncertainty95",
      -1e-9,
    );
    const negativeResult = replayNhm2SemiclassicalV3ConstraintOperands(
      negativeUncertainty.input,
    );
    expect(negativeResult.arithmeticDisposition).toBe("fail");
    expect(negativeResult.blockers).toContainEqual(
      expect.objectContaining({
        code: "decoded_uncertainty_negative",
        disposition: "fail",
      }),
    );
  });

  it("recomputes producer mismatch and central level-2 upper95 from raw operands", () => {
    const mismatch = buildFixture();
    updateRole(mismatch, "level_0", "H_H", "residual", 0.045);
    updateRole(mismatch, "level_2", "H_H", "residual", 0.010_001);
    const mismatchResult = replayNhm2SemiclassicalV3ConstraintOperands(
      mismatch.input,
    );
    expect(mismatchResult.calculationComplete).toBe(true);
    expect(mismatchResult.arithmeticDisposition).toBe("fail");
    expect(mismatchResult.overallDisposition).toBe("blocked");
    expect(mismatchResult.blockers.map((entry) => entry.code)).toContain(
      "submitted_residual_mismatch_tolerance_exceeded",
    );
    expect(
      mismatchResult.families[0].levels[2].submittedResidualMismatchLInf,
    ).toBeGreaterThan(1e-12);
    expect(mismatchResult.families[0].producerResidualMismatchLInf).toBeCloseTo(
      0.005,
      14,
    );
    const retuneAttempt = replayNhm2SemiclassicalV3ConstraintOperands({
      ...mismatch.input,
      policyOverride: { producerResidualConsistencyTolerance: 1 },
    });
    expect(retuneAttempt.arithmeticDisposition).not.toBe("pass");
    expect(retuneAttempt.firstBlocker).toBe("input_shape_invalid");

    const central = buildFixture();
    updateRole(central, "level_2", "H_H", "computed", 0.2);
    updateRole(central, "level_2", "H_H", "residual", 0.2);
    const centralResult = replayNhm2SemiclassicalV3ConstraintOperands(
      central.input,
    );
    expect(centralResult.arithmeticDisposition).toBe("fail");
    expect(centralResult.blockers.map((entry) => entry.code)).toContain(
      "central_residual_upper95_tolerance_exceeded",
    );
    expect(centralResult.blockers.map((entry) => entry.code)).toContain(
      "regulator_error_tolerance_exceeded",
    );
    expect(centralResult.families[0].levels[2].residualUpper95).toBeCloseTo(
      0.2,
      14,
    );
  });

  it("uses conservative bounds and leaves exact equality to target-derivation replay", () => {
    const uncertainty = buildFixture();
    for (const levelId of ["level_0", "level_1", "level_2"]) {
      updateRole(uncertainty, levelId, "H_H", "absolute_uncertainty95", 0.006);
    }
    const result = replayNhm2SemiclassicalV3ConstraintOperands(
      uncertainty.input,
    );
    const convergence = result.families[0].convergence;
    expect(convergence.D01Lower).toBeCloseTo(0.008, 14);
    expect(convergence.D01Upper).toBeCloseTo(0.032, 14);
    expect(convergence.D12Lower).toBe(0);
    expect(convergence.D12Upper).toBeCloseTo(0.022, 14);
    expect(convergence.pLower).toBeLessThan(1);
    expect(result.arithmeticDisposition).toBe("fail");
    expect(result.blockers.map((entry) => entry.code)).toContain(
      "regulator_order_failed",
    );
    expect(result.blockers.map((entry) => entry.code)).toContain(
      "regulator_monotonicity_failed",
    );

    const echo = buildFixture();
    updateRole(echo, "level_0", "H_H", "target", 0.04);
    updateRole(echo, "level_0", "H_H", "residual", 0);
    const echoResult = replayNhm2SemiclassicalV3ConstraintOperands(echo.input);
    expect(echoResult.arithmeticDisposition).toBe("pass");
    expect(echoResult.blockers.map((entry) => entry.code)).not.toContain(
      "submitted_residual_mismatch_tolerance_exceeded",
    );
    expect(echoResult.blockers.map((entry) => entry.code)).toContain(
      "constraint_target_derivation_not_server_replayed",
    );
  });

  it("blocks zero interlevel bounds, insufficient order, and finite arithmetic overflow", () => {
    const zeroQ = buildFixture();
    for (const levelId of ["level_0", "level_1", "level_2"]) {
      updateRole(zeroQ, levelId, "H_H", "computed", 0.01);
      updateRole(zeroQ, levelId, "H_H", "residual", 0.01);
    }
    const zeroResult = replayNhm2SemiclassicalV3ConstraintOperands(zeroQ.input);
    expect(zeroResult.arithmeticDisposition).toBe("blocked");
    expect(zeroResult.blockers).toContainEqual(
      expect.objectContaining({
        code: "regulator_zero_or_nonpositive_interlevel_bound",
        disposition: "blocked",
      }),
    );

    const failedThenZero = buildFixture();
    for (const levelId of ["level_0", "level_1", "level_2"]) {
      updateRole(failedThenZero, levelId, "H_H", "computed", 0.01);
      updateRole(failedThenZero, levelId, "H_H", "residual", 0.02);
    }
    const failedThenZeroResult = replayNhm2SemiclassicalV3ConstraintOperands(
      failedThenZero.input,
    );
    expect(failedThenZeroResult.arithmeticDisposition).toBe("fail");
    expect(failedThenZeroResult.blockers.map((entry) => entry.code)).toContain(
      "submitted_residual_mismatch_tolerance_exceeded",
    );
    expect(failedThenZeroResult.blockers.map((entry) => entry.code)).toContain(
      "regulator_zero_or_nonpositive_interlevel_bound",
    );

    const lowOrder = buildFixture();
    for (const [levelId, value] of [
      ["level_0", 0.04],
      ["level_1", 0.03],
      ["level_2", 0.02],
    ] as const) {
      updateRole(lowOrder, levelId, "H_H", "computed", value);
      updateRole(lowOrder, levelId, "H_H", "residual", value);
    }
    const lowOrderResult = replayNhm2SemiclassicalV3ConstraintOperands(
      lowOrder.input,
    );
    expect(lowOrderResult.arithmeticDisposition).toBe("fail");
    expect(lowOrderResult.blockers.map((entry) => entry.code)).toContain(
      "regulator_order_failed",
    );

    const overflow = buildFixture();
    updateRole(
      overflow,
      "level_0",
      "antisymmetry",
      "forward",
      Number.MAX_VALUE,
    );
    updateRole(
      overflow,
      "level_0",
      "antisymmetry",
      "reverse",
      Number.MAX_VALUE,
    );
    const overflowResult = replayNhm2SemiclassicalV3ConstraintOperands(
      overflow.input,
    );
    expect(overflowResult.arithmeticDisposition).toBe("fail");
    expect(overflowResult.blockers).toContainEqual(
      expect.objectContaining({
        code: "arithmetic_nonfinite_or_overflow",
        disposition: "fail",
      }),
    );
  });

  it("observes caller input once and rejects hostile snapshots without throwing", () => {
    const fixture = buildFixture();
    const proxy = new Proxy(fixture.input, {});
    const proxyResult = replayNhm2SemiclassicalV3ConstraintOperands(proxy);
    expect(proxyResult.firstBlocker).toBe("input_snapshot_invalid");
    expect(proxyResult.provenanceBoundary).toMatchObject({
      inputSnapshotAttemptedExactlyOnce: true,
      inputSnapshotCompleted: false,
      inputSnapshottedExactlyOnce: false,
    });

    const originalStructuredClone = globalThis.structuredClone;
    const precloneInvalid = Object.defineProperty({}, "accessor", {
      enumerable: true,
      get: () => fixture.input,
    });
    let precloneCloneCalls = 0;
    const precloneSpy = vi
      .spyOn(globalThis, "structuredClone")
      .mockImplementation(((value: unknown) => {
        if (value === precloneInvalid) precloneCloneCalls += 1;
        return originalStructuredClone(value);
      }) as typeof structuredClone);
    try {
      const precloneResult =
        replayNhm2SemiclassicalV3ConstraintOperands(precloneInvalid);
      expect(precloneResult.firstBlocker).toBe("input_snapshot_invalid");
      expect(precloneCloneCalls).toBe(0);
      expect(precloneResult.provenanceBoundary).toMatchObject({
        inputSnapshotAttemptedExactlyOnce: true,
        inputSnapshotCompleted: false,
        inputSnapshottedExactlyOnce: false,
      });
    } finally {
      precloneSpy.mockRestore();
    }

    const throwing = buildFixture();
    const throwingSpy = vi
      .spyOn(globalThis, "structuredClone")
      .mockImplementation(((value: unknown) => {
        if (value === throwing.input) throw new Error("hostile clone failure");
        return originalStructuredClone(value);
      }) as typeof structuredClone);
    try {
      const throwingResult = replayNhm2SemiclassicalV3ConstraintOperands(
        throwing.input,
      );
      expect(throwingResult.firstBlocker).toBe("input_snapshot_invalid");
      expect(throwingResult.provenanceBoundary).toMatchObject({
        inputSnapshotAttemptedExactlyOnce: true,
        inputSnapshotCompleted: false,
        inputSnapshottedExactlyOnce: false,
      });
    } finally {
      throwingSpy.mockRestore();
    }

    let originalObservations = 0;
    const cloneSpy = vi
      .spyOn(globalThis, "structuredClone")
      .mockImplementation(((value: unknown) => {
        if (value === fixture.input) {
          originalObservations += 1;
          if (originalObservations > 1) return {};
        }
        return originalStructuredClone(value);
      }) as typeof structuredClone);
    try {
      const result = replayNhm2SemiclassicalV3ConstraintOperands(fixture.input);
      expect(result.arithmeticDisposition).toBe("pass");
      expect(result.overallDisposition).toBe("blocked");
      expect(result.calculationComplete).toBe(true);
      expect(originalObservations).toBe(1);
      expect(result.provenanceBoundary).toMatchObject({
        inputSnapshotAttemptedExactlyOnce: true,
        inputSnapshotCompleted: true,
        inputSnapshottedExactlyOnce: true,
      });
    } finally {
      cloneSpy.mockRestore();
    }

    const hostile = buildFixture();
    const hostileSpy = vi
      .spyOn(globalThis, "structuredClone")
      .mockImplementation(((value: unknown) =>
        value === hostile.input
          ? {}
          : originalStructuredClone(value)) as typeof structuredClone);
    try {
      const hostileResult = replayNhm2SemiclassicalV3ConstraintOperands(
        hostile.input,
      );
      expect(hostileResult.firstBlocker).toBe("input_shape_invalid");
      expect(hostileResult.provenanceBoundary).toMatchObject({
        inputSnapshotAttemptedExactlyOnce: true,
        inputSnapshotCompleted: true,
        inputSnapshottedExactlyOnce: true,
      });
    } finally {
      hostileSpy.mockRestore();
    }
  });

  it("does not claim filesystem security for caller-supplied observations", () => {
    const result = replayNhm2SemiclassicalV3ConstraintOperands(
      cloneFixture(buildFixture()).input,
    );
    expect(result.provenanceBoundary).toEqual(
      expect.objectContaining({
        callerSuppliedObservationOnly: true,
        filesystemReadPerformedByService: false,
        filesystemSecurityEstablished: false,
      }),
    );
    expect(result.serviceBoundary.filesystemSecurityVerified).toBe(false);
    expect(result.serviceBoundary.realpathVerified).toBe(false);
    expect(result.serviceBoundary.stableFileIdentityVerified).toBe(false);
  });
});
