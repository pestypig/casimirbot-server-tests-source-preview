import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_FILESYSTEM_REPLAYER_BLOCKERS,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_FILESYSTEM_REPLAYER_CLAIM_BOUNDARY,
  NHM2_SEMICLASSICAL_V2_CONSTRAINT_FILESYSTEM_REPLAYER_INPUT_CONTRACT_VERSION,
  Nhm2SemiclassicalV2ConstraintFilesystemReplayError,
  replayNhm2SemiclassicalV2ConstraintFilesystem,
  type Nhm2SemiclassicalV2ConstraintFilesystemReplayInputV1,
} from "../nhm2-semiclassical-v2-constraint-filesystem-replayer";

const tempParents: string[] = [];
const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const PORTABLE_OUTPUT_ROOT = "artifacts/frozen-primary/constraint-operands";
const CANDIDATE_ID = "nhm2.test.filesystem-replay/candidate-v1";
const CANDIDATE_SHA256 = sha256("candidate");
const SEAL_KEY = computeNhm2SemiclassicalV2ScientificSealKey(CANDIDATE_ID);
const OBSERVED_AT = "2026-08-13T14:00:03.000Z";

type Fixture = {
  parent: string;
  manifestRoot: string;
  outputRoot: string;
  manifest: Nhm2SemiclassicalV2ConstraintOperandReplayV1;
  manifestPath: string;
  input: Nhm2SemiclassicalV2ConstraintFilesystemReplayInputV1;
};

const descriptor = (
  levelId: string,
  familyId: Nhm2SemiclassicalV2ConstraintOperandFamilyId,
  operandRole: Nhm2SemiclassicalV2ConstraintOperandRole,
): Nhm2SemiclassicalV2ConstraintOperandArrayV1 => ({
  operandRole,
  path: `${PORTABLE_OUTPUT_ROOT}/${levelId}/${familyId}/${operandRole}.f64le`,
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

const newManifest = (): Nhm2SemiclassicalV2ConstraintOperandReplayV1 => {
  const manifest: Nhm2SemiclassicalV2ConstraintOperandReplayV1 = {
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
      comparisonPairId: "nhm2.test.filesystem-pair/v1",
      role: "primary",
      implementationId: "nhm2.test.filesystem-primary/v1",
      sourceIdentityId: "nhm2.test.filesystem-source/v1",
      sourceSha256: sha256("source"),
      dependencyLockIdentityId: "nhm2.test.filesystem-lock/v1",
      dependencyLockSha256: sha256("lock"),
      executableIdentityId: "nhm2.test.filesystem-executable/v1",
      executableSha256: sha256("executable"),
    },
    execution: {
      commitSha: sha256("commit").slice(0, 40),
      command: "constraint-solver --emit-frozen-operands",
      argv: ["constraint-solver", "--emit-frozen-operands"],
      outputDirectory: PORTABLE_OUTPUT_ROOT,
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
  return manifest;
};

const filled = (value: number): number[] =>
  Array.from({ length: 64 * 4 }, () => value);

const familyVectors = (
  levelOrdinal: number,
  familyId: Nhm2SemiclassicalV2ConstraintOperandFamilyId,
): Record<string, number[]> => {
  const desired = [0.04, 0.01, 0.0025][levelOrdinal];
  if (familyId === "H_H" || familyId === "H_Hi" || familyId === "Hi_Hj") {
    const target = 0.2;
    const computed = target + desired;
    return {
      computed: filled(computed),
      target: filled(target),
      residual: filled(computed - target),
      absolute_uncertainty95: filled(1e-6),
    };
  }
  if (familyId === "antisymmetry") {
    const forward = 0.2;
    const reverse = -0.2 + desired;
    return {
      forward: filled(forward),
      reverse: filled(reverse),
      residual: filled(forward + reverse),
      absolute_uncertainty95: filled(1e-6),
    };
  }
  const term1 = 0.1;
  const term2 = 0.2;
  const term3 = -0.3 + desired;
  return {
    term_1: filled(term1),
    term_2: filled(term2),
    term_3: filled(term3),
    residual: filled(term1 + term2 + term3),
    absolute_uncertainty95: filled(1e-6),
  };
};

const encode = (values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(
    NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
};

const writeManifest = async (
  fixture: Fixture,
  bytes = Buffer.from(JSON.stringify(fixture.manifest), "utf8"),
): Promise<void> => {
  await fs.writeFile(fixture.manifestPath, bytes);
  fixture.input = {
    ...fixture.input,
    manifestFile: {
      relativePath: "constraint-operands.manifest.json",
      expectedSha256: sha256(bytes),
      expectedSizeBytes: bytes.byteLength,
    },
  };
};

const createFixture = async (): Promise<Fixture> => {
  const parent = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "nhm2-v2-constraint-fs-"),
  );
  tempParents.push(parent);
  const manifestRoot = path.join(parent, "manifest-root");
  const outputRoot = path.join(parent, "output-root");
  await fs.mkdir(manifestRoot);
  await fs.mkdir(outputRoot);
  const manifest = newManifest();
  for (const [levelOrdinal, level] of manifest.levels.entries()) {
    for (const family of level.families) {
      const vectors = familyVectors(levelOrdinal, family.familyId);
      for (const operand of family.operands) {
        const bytes = encode(vectors[operand.operandRole]);
        operand.sha256 = sha256(bytes);
        const suffix = operand.path.slice(`${PORTABLE_OUTPUT_ROOT}/`.length);
        const absolute = path.join(outputRoot, ...suffix.split("/"));
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, bytes);
      }
    }
  }
  manifest.operandInventorySha256 =
    computeNhm2SemiclassicalV2ConstraintOperandInventorySha256(manifest);
  const manifestPath = path.join(
    manifestRoot,
    "constraint-operands.manifest.json",
  );
  const placeholderInput: Nhm2SemiclassicalV2ConstraintFilesystemReplayInputV1 =
    {
      contractVersion:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_FILESYSTEM_REPLAYER_INPUT_CONTRACT_VERSION,
      manifestRootDirectory: manifestRoot,
      manifestFile: {
        relativePath: "constraint-operands.manifest.json",
        expectedSha256: "0".repeat(64),
        expectedSizeBytes: 1,
      },
      outputRootDirectory: outputRoot,
    };
  const fixture: Fixture = {
    parent,
    manifestRoot,
    outputRoot,
    manifest,
    manifestPath,
    input: placeholderInput,
  };
  await writeManifest(fixture);
  return fixture;
};

const expectCode = async (
  promise: Promise<unknown>,
  code: Nhm2SemiclassicalV2ConstraintFilesystemReplayError["code"],
  detailCode?: string,
): Promise<Nhm2SemiclassicalV2ConstraintFilesystemReplayError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(
      Nhm2SemiclassicalV2ConstraintFilesystemReplayError,
    );
    expect(error).toMatchObject({
      code,
      ...(detailCode == null ? {} : { detailCode }),
    });
    return error as Nhm2SemiclassicalV2ConstraintFilesystemReplayError;
  }
  throw new Error(`Expected ${code}.`);
};

afterEach(async () => {
  for (const parent of tempParents.splice(0)) {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

describe("NHM2 semiclassical-v2 constraint filesystem replayer", () => {
  it("securely rereads the exact manifest and 63 operands before blocked arithmetic replay", async () => {
    const fixture = await createFixture();
    const result = await replayNhm2SemiclassicalV2ConstraintFilesystem(
      fixture.input,
    );

    expect(result.observationState).toBe(
      "bounded_current_read_stable_identity_only",
    );
    expect(result.diagnosticOnly).toBe(true);
    expect(result.authorityDisposition).toBe("blocked");
    expect(result.manifestObservation.file).toMatchObject({
      relativePath: "constraint-operands.manifest.json",
      sha256: fixture.input.manifestFile.expectedSha256,
      sizeBytes: fixture.input.manifestFile.expectedSizeBytes,
    });
    expect(result.outputObservation).toMatchObject({
      descriptorPortableRoot: PORTABLE_OUTPUT_ROOT,
      fileCount: NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_COUNT,
      aggregateSizeBytes:
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_COUNT *
        NHM2_SEMICLASSICAL_V2_CONSTRAINT_OPERAND_ARRAY_SIZE_BYTES,
    });
    expect(result.outputObservation.files).toHaveLength(63);
    expect(
      result.outputObservation.files.every(
        (file) => !path.isAbsolute(file.relativePath),
      ),
    ).toBe(true);
    expect(result.arithmeticReplay).toMatchObject({
      arithmeticDisposition: "pass",
      overallDisposition: "blocked",
      calculationComplete: true,
    });
    expect(result.blockers).toEqual(
      NHM2_SEMICLASSICAL_V2_CONSTRAINT_FILESYSTEM_REPLAYER_BLOCKERS,
    );
    expect(result.claimBoundary).toEqual(
      NHM2_SEMICLASSICAL_V2_CONSTRAINT_FILESYSTEM_REPLAYER_CLAIM_BOUNDARY,
    );
    expect(result.claimBoundary.declaredLeverTensorRead).toBe(false);
    expect(result.claimBoundary.replayAuthority).toBe(false);
    expect(result.claimBoundary.physicalViabilityClaimAllowed).toBe(false);
  });

  it("rejects equal or nested caller roots before reading", async () => {
    const fixture = await createFixture();
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem({
        ...fixture.input,
        outputRootDirectory: fixture.manifestRoot,
      }),
      "root_topology_invalid",
    );
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem({
        ...fixture.input,
        outputRootDirectory: path.join(fixture.manifestRoot, "nested"),
      }),
      "root_topology_invalid",
    );
  });

  it("rejects hostile accessors without invoking them", async () => {
    const fixture = await createFixture();
    let reads = 0;
    const hostile = { ...fixture.input } as Record<string, unknown>;
    Object.defineProperty(hostile, "outputRootDirectory", {
      enumerable: true,
      get() {
        reads += 1;
        return fixture.outputRoot;
      },
    });
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem(hostile),
      "filesystem_replay_input_invalid",
    );
    expect(reads).toBe(0);
  });

  it("rejects manifest hash mismatch and strict JSON decode failures", async () => {
    const hashFixture = await createFixture();
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem({
        ...hashFixture.input,
        manifestFile: {
          ...hashFixture.input.manifestFile,
          expectedSha256: sha256("wrong"),
        },
      }),
      "manifest_secure_read_failed",
      "output_sha256_mismatch",
    );

    const decodeFixture = await createFixture();
    await writeManifest(decodeFixture, Buffer.from([0xff, 0xfe, 0xfd]));
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem(decodeFixture.input),
      "manifest_decode_failed",
    );
  });

  it("rejects noncanonical descriptor paths after strict manifest validation", async () => {
    const fixture = await createFixture();
    fixture.manifest.levels[0].families[0].operands[0].path = `${PORTABLE_OUTPUT_ROOT}/../escape.f64le`;
    fixture.manifest.operandInventorySha256 =
      computeNhm2SemiclassicalV2ConstraintOperandInventorySha256(
        fixture.manifest,
      );
    await writeManifest(fixture);
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem(fixture.input),
      "manifest_invalid",
      "operand_descriptor_invalid:/levels/0/families/0/operands/0",
    );
  });

  it("rejects missing and extra output inventory entries", async () => {
    const missing = await createFixture();
    const first = collectNhm2SemiclassicalV2ConstraintOperandArrays(
      missing.manifest,
    )[0];
    const firstSuffix = first.path.slice(`${PORTABLE_OUTPUT_ROOT}/`.length);
    await fs.rm(path.join(missing.outputRoot, ...firstSuffix.split("/")));
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem(missing.input),
      "output_secure_read_failed",
      "output_inventory_mismatch",
    );

    const extra = await createFixture();
    await fs.writeFile(path.join(extra.outputRoot, "unlisted.bin"), "extra");
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem(extra.input),
      "output_secure_read_failed",
      "output_inventory_mismatch",
    );
  });

  it("rejects symlinked operand entries when links are available", async () => {
    const fixture = await createFixture();
    const operands = collectNhm2SemiclassicalV2ConstraintOperandArrays(
      fixture.manifest,
    );
    const firstSuffix = operands[0].path.slice(
      `${PORTABLE_OUTPUT_ROOT}/`.length,
    );
    const secondSuffix = operands[1].path.slice(
      `${PORTABLE_OUTPUT_ROOT}/`.length,
    );
    const firstPath = path.join(fixture.outputRoot, ...firstSuffix.split("/"));
    const secondPath = path.join(
      fixture.outputRoot,
      ...secondSuffix.split("/"),
    );
    await fs.rm(firstPath);
    try {
      await fs.symlink(secondPath, firstPath, "file");
    } catch (error) {
      if (
        ["EPERM", "EACCES", "ENOSYS"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return;
      throw error;
    }
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem(fixture.input),
      "output_secure_read_failed",
    );
  });

  it("rejects output mutation between the secure initial and identity replay reads", async () => {
    const fixture = await createFixture();
    const first = collectNhm2SemiclassicalV2ConstraintOperandArrays(
      fixture.manifest,
    )[0];
    const suffix = first.path.slice(`${PORTABLE_OUTPUT_ROOT}/`.length);
    const absolute = path.join(fixture.outputRoot, ...suffix.split("/"));
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem({
        ...fixture.input,
        afterOutputInitialReadForTesting: async () => {
          const bytes = await fs.readFile(absolute);
          bytes[0] ^= 0xff;
          await fs.writeFile(absolute, bytes);
        },
      }),
      "output_secure_read_failed",
    );
  });

  it("rejects non-finite float64 operands before arithmetic replay", async () => {
    const fixture = await createFixture();
    const first = collectNhm2SemiclassicalV2ConstraintOperandArrays(
      fixture.manifest,
    )[0];
    const suffix = first.path.slice(`${PORTABLE_OUTPUT_ROOT}/`.length);
    const absolute = path.join(fixture.outputRoot, ...suffix.split("/"));
    const bytes = await fs.readFile(absolute);
    bytes.writeDoubleLE(Number.NaN, 0);
    await fs.writeFile(absolute, bytes);
    first.sha256 = sha256(bytes);
    fixture.manifest.operandInventorySha256 =
      computeNhm2SemiclassicalV2ConstraintOperandInventorySha256(
        fixture.manifest,
      );
    await writeManifest(fixture);
    await expectCode(
      replayNhm2SemiclassicalV2ConstraintFilesystem(fixture.input),
      "output_secure_read_failed",
      "output_float64_non_finite",
    );
  });
});
