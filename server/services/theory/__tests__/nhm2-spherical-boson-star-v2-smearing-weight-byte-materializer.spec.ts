import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_BINDING,
  NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_CANDIDATE_ID,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-candidate-freeze.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_BINDING,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-raw-replay-schema.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_FREEZE,
  NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_FREEZE_BINDING,
  NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_RAW_SHA256,
  NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_RAW_SIZE_BYTES,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-smearing-weight-freeze.v1";
import { NHM2_SPHERICAL_BOSON_STAR_V2_STATIC_GROUND_STATE_HADAMARD_MEAN_NOISE_REALIZATION_BINDING } from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-static-ground-state-hadamard-mean-noise-realization.v1";

type MaterializerModule =
  typeof import("../nhm2-spherical-boson-star-v2-smearing-weight-byte-materializer");
type Materialization = ReturnType<
  MaterializerModule["materializeNhm2SphericalBosonStarV2SmearingWeightBytes"]
>;

const loadMaterializer = (): Promise<MaterializerModule> =>
  import("../nhm2-spherical-boson-star-v2-smearing-weight-byte-materializer");
const materialize = async (): Promise<Materialization> =>
  (
    await loadMaterializer()
  ).materializeNhm2SphericalBosonStarV2SmearingWeightBytes();

const RAW_WORD_HEX = "000000000000903f" as const;
const RAW_HEX = RAW_WORD_HEX.repeat(64);
const SOURCE_PATH = fileURLToPath(
  new URL(
    "../nhm2-spherical-boson-star-v2-smearing-weight-byte-materializer.ts",
    import.meta.url,
  ),
);

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const expectDeepFrozen = (root: object): void => {
  const pending: object[] = [root];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current == null || visited.has(current)) continue;
    visited.add(current);
    expect(Object.isFrozen(current)).toBe(true);
    for (const value of Object.values(current))
      if (value != null && typeof value === "object") pending.push(value);
  }
};

describe("spherical-v2 smearing-weight byte materializer", () => {
  it("performs zero byte construction on cold import and exactly 64 literal copies per call", async () => {
    vi.resetModules();
    const setSpy = vi.spyOn(Uint8Array.prototype, "set");
    const writeDoubleLeSpy = vi.spyOn(Buffer.prototype, "writeDoubleLE");
    try {
      const module = await loadMaterializer();
      expect(setSpy).toHaveBeenCalledTimes(0);
      expect(writeDoubleLeSpy).toHaveBeenCalledTimes(0);

      const first =
        module.materializeNhm2SphericalBosonStarV2SmearingWeightBytes();
      expect(setSpy).toHaveBeenCalledTimes(64);
      expect(writeDoubleLeSpy).toHaveBeenCalledTimes(0);
      expect(Buffer.from(first.bytes).toString("hex")).toBe(RAW_HEX);

      setSpy.mockClear();
      writeDoubleLeSpy.mockClear();
      const second =
        module.materializeNhm2SphericalBosonStarV2SmearingWeightBytes();
      expect(setSpy).toHaveBeenCalledTimes(64);
      expect(writeDoubleLeSpy).toHaveBeenCalledTimes(0);
      expect(Buffer.from(second.bytes).toString("hex")).toBe(RAW_HEX);
    } finally {
      setSpy.mockRestore();
      writeDoubleLeSpy.mockRestore();
    }
  });

  it("pins the exact four dependencies and ordinal-4 physical descriptor", async () => {
    const module = await loadMaterializer();
    const { receipt } =
      module.materializeNhm2SphericalBosonStarV2SmearingWeightBytes();

    expect(receipt.artifactId).toBe(
      module.NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_BYTE_MATERIALIZER_ARTIFACT_ID,
    );
    expect(receipt.contractVersion).toBe(
      module.NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_BYTE_MATERIALIZER_CONTRACT_VERSION,
    );
    expect(receipt.candidateId).toBe(
      NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_CANDIDATE_ID,
    );
    expect(receipt.exactBindings).toEqual({
      meanNoiseRealization: {
        sha256:
          "bf9875496a7aa8f5bde0509e597b373454ddea072f1d1af2ae18b746f7646467",
        canonicalSizeBytes: 25_213,
      },
      rawReplaySchema: {
        sha256:
          "96f5816f9d04b9d3b14a228ab821c3224974f47839ace6d7c7819f77c6a223ff",
        canonicalSizeBytes: 163_818,
      },
      smearingWeightFreeze: {
        sha256:
          "4cff97a0c1220dbef8c0df29e500d4c80d88320c97f8d16529c9e98ac290a446",
        canonicalSizeBytes: 6_764,
      },
      candidateFreeze: {
        sha256:
          "628092507b7dc1be76722f06a7b591efc59d1799bed0d4b7d1999d852d92f28f",
        canonicalSizeBytes: 55_997,
      },
    });
    expect(receipt.exactBindings.meanNoiseRealization).toEqual({
      sha256:
        NHM2_SPHERICAL_BOSON_STAR_V2_STATIC_GROUND_STATE_HADAMARD_MEAN_NOISE_REALIZATION_BINDING.sha256,
      canonicalSizeBytes:
        NHM2_SPHERICAL_BOSON_STAR_V2_STATIC_GROUND_STATE_HADAMARD_MEAN_NOISE_REALIZATION_BINDING.canonicalSizeBytes,
    });
    expect(receipt.exactBindings.rawReplaySchema).toEqual({
      sha256: NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_BINDING.sha256,
      canonicalSizeBytes:
        NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_BINDING.canonicalSizeBytes,
    });
    expect(receipt.exactBindings.smearingWeightFreeze).toEqual({
      sha256:
        NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_FREEZE_BINDING.sha256,
      canonicalSizeBytes:
        NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_FREEZE_BINDING.canonicalSizeBytes,
    });
    expect(receipt.exactBindings.candidateFreeze).toEqual({
      sha256: NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_BINDING.sha256,
      canonicalSizeBytes:
        NHM2_SPHERICAL_BOSON_STAR_V2_CANDIDATE_FREEZE_BINDING.canonicalSizeBytes,
    });
    expect(
      NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_FREEZE.exactDiscreteMeasure
        .weightF64LeWordHex,
    ).toBe(receipt.construction.wordF64LeHex);
    expect(receipt.dependencyObservationBoundary).toEqual({
      bindingLiteralsFrozen: true,
      descriptorLiteralFrozen: true,
      liveDependencyModuleObservationPerformed: false,
      liveDependencyBindingMatchClaimed: false,
      dependencyIdentityAuthority: false,
    });

    expect(receipt.physicalFile).toEqual({
      fileOrdinal: 4,
      role: "smearing_weights",
      path: "{outputDirectory}/fixed/04-smearing_weights.f64le",
      shape: [64],
      componentOrder: ["weight"],
      sampleOrder: "candidate_sampling_ordinal_0_to_63",
      unit: "dimensionless",
      sizeBytes: 512,
      dtype: "float64",
      binaryEncoding: "raw_ieee754",
      endianness: "little",
      storageOrder: "row-major",
      mediaType: "application/octet-stream",
      finiteValuesRequired: true,
      negativeZeroAllowed: false,
    });
    expect(
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS.find(
        (entry) => entry.fileOrdinal === 4,
      ),
    ).toMatchObject(receipt.physicalFile);
  });

  it("copies the literal little-endian word exactly 64 times and verifies the hash", async () => {
    const { bytes, receipt } = await materialize();

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(
      NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_RAW_SIZE_BYTES,
    );
    expect(Buffer.from(bytes).toString("hex")).toBe(RAW_HEX);
    for (let ordinal = 0; ordinal < 64; ordinal += 1)
      expect(
        Buffer.from(bytes.subarray(ordinal * 8, ordinal * 8 + 8)).toString(
          "hex",
        ),
      ).toBe(RAW_WORD_HEX);
    expect(sha256(bytes)).toBe(
      NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_RAW_SHA256,
    );
    expect(receipt.construction).toEqual({
      wordF64LeHex: RAW_WORD_HEX,
      wordSizeBytes: 8,
      copyCount: 64,
      ordinalOrder: "sample_ordinal_0_to_63",
      floatingPointArithmeticUsed: false,
      observedScientificOutputRead: false,
    });
    expect(receipt.content).toEqual({
      sha256:
        "25493ecc62734a68fad443881a595d122cb7a93ddf9d07e5ec2060baf84f03fd",
      sizeBytes: 512,
      exactContentVerified: true,
      freshBytesPerCall: true,
      bytesAreFreshCallerOwnedCopy: true,
    });
  });

  it("returns isolated fresh mutable bytes with one deeply frozen receipt", async () => {
    const first = await materialize();
    const second = await materialize();

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(first.bytes).not.toBe(second.bytes);
    expect(first.receipt).toBe(second.receipt);
    expectDeepFrozen(first.receipt);

    first.bytes.fill(0);
    expect(Buffer.from(second.bytes).toString("hex")).toBe(RAW_HEX);
    const third = await materialize();
    expect(third.bytes).not.toBe(first.bytes);
    expect(third.bytes).not.toBe(second.bytes);
    expect(Buffer.from(third.bytes).toString("hex")).toBe(RAW_HEX);
  });

  it("has a zero-argument public boundary and ignores untyped hostile extras without traps", async () => {
    const {
      materializeNhm2SphericalBosonStarV2SmearingWeightBytes: materializeBytes,
    } = await loadMaterializer();
    let traps = 0;
    const hostile = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: () => {
        traps += 1;
        throw new Error("unexpected_get");
      },
      ownKeys: () => {
        traps += 1;
        throw new Error("unexpected_own_keys");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("unexpected_descriptor");
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("unexpected_prototype");
      },
    });
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "payload", {
      enumerable: true,
      get: () => {
        traps += 1;
        throw new Error("unexpected_accessor");
      },
    });

    expect(materializeBytes.length).toBe(0);
    const result = Reflect.apply(materializeBytes, undefined, [
      hostile,
      accessor,
    ]) as Materialization;
    expect(traps).toBe(0);
    expect(Buffer.from(result.bytes).toString("hex")).toBe(RAW_HEX);
  });

  it("keeps the four other nonconstraint arrays, the full 68, and every authority claim absent", async () => {
    const { receipt } = await materialize();

    expect(receipt.completeness.materializedNonconstraintRoles).toEqual([
      "smearing_weights",
    ]);
    expect(receipt.completeness.absentNonconstraintRoles).toEqual([
      "noise_kernel",
      "noise_kernel_absolute_uncertainty95",
      "mean_rset",
      "mean_rset_absolute_uncertainty95",
    ]);
    expect(receipt.completeness.materializedNonconstraintFileCount).toBe(1);
    expect(receipt.completeness.allFiveNonconstraintFilesPresent).toBe(false);
    expect(receipt.completeness.exact68PhysicalFileInventoryPresent).toBe(
      false,
    );
    expect(Object.values(receipt.persistenceBoundary)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(Object.values(receipt.authorityLocks).every((value) => !value)).toBe(
      true,
    );
    expect(receipt.blockers).toEqual([
      "live_dependency_module_observation_not_performed",
      "filesystem_persistence_and_secure_readback_not_performed",
      "successor_manifest_entry_not_materialized",
      "preexecution_and_execution_observation_not_bound",
      "remaining_four_nonconstraint_scientific_arrays_absent",
      "complete_68_file_output_inventory_absent",
    ]);
  });

  it("keeps the implementation free of filesystem, codec, registry, and authority machinery", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const imports = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
      (match) => match[1],
    );
    expect(imports).toEqual(["node:crypto"]);
    for (const forbidden of [
      /node:fs/,
      /\b(?:read|write)Double(?:LE|BE)\b/,
      /\b(?:readFile|writeFile|mkdir|open|close)(?:Sync)?\b/,
      /\b(?:WeakMap|WeakSet)\b/,
      /\b(?:Math\.random|Date\.now)\b/,
      /\bprocess\.env\b/,
      /\b0\.015625\b/,
      /\b1\s*\/\s*64\b/,
      /from\s+"[^"]*(?:manifest|registry|preexecution|capability)[^"]*"/,
      /\b(?:register|issue|mint)[A-Z][A-Za-z0-9_]*/,
    ])
      expect(source).not.toMatch(forbidden);
    expect(source).not.toContain(
      "NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_VALUE",
    );
    expect(source).not.toContain(
      "verifyExactContent(materializeLiteralWeightBytes())",
    );
    expect(source.match(/createHash\("sha256"\)/g)).toHaveLength(1);
    expect(source.match(/bytes\.set\(/g)).toHaveLength(1);
  });
});
