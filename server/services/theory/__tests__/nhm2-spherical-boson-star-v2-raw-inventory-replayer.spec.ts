import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_BINDING,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_EXPECTED_CANONICAL_SIZE_BYTES,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_EXPECTED_SHA256,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-raw-replay-schema.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_RUN_ARTIFACT_WIRE_CANONICAL_SIZE_BYTES,
  NHM2_SPHERICAL_BOSON_STAR_V2_RUN_ARTIFACT_WIRE_SHA256,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-run-artifact-wire.v1";
import { NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_VALUE } from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-smearing-weight-freeze.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_HASH_CLOSURE_SHA256_DOMAIN,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_FILESYSTEM_OBSERVER_ARTIFACT_ID,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_FILESYSTEM_OBSERVER_CONTRACT_VERSION,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_INVENTORY_INPUT_CONTRACT_VERSION,
  NHM2_SPHERICAL_BOSON_STAR_V2_RAW_INVENTORY_LIMITS,
  Nhm2SphericalBosonStarV2RawFilesystemObserverError,
  admitNhm2SphericalBosonStarV2RawInventory,
  getNhm2SphericalBosonStarV2AdmittedFloat64Length,
  observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem,
  readNhm2SphericalBosonStarV2AdmittedFloat64,
} from "../nhm2-spherical-boson-star-v2-raw-inventory-replayer";

const CANDIDATE_ID =
  "nhm2.semiclassical_v2.spherical_boson_star_1s_weak_field_control/v1";

const hash = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const tempParents: string[] = [];
const RAW_OUTPUT_PREFIX = "{outputDirectory}/";

const mockLinuxObserverHost = (): void => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
};

const relativePath = (descriptor: { path: string }): string => {
  expect(descriptor.path.startsWith(RAW_OUTPUT_PREFIX)).toBe(true);
  return descriptor.path.slice(RAW_OUTPUT_PREFIX.length);
};

const exactSmearingWeightBytes = (): Buffer => {
  const bytes = Buffer.alloc(64 * 8);
  for (let index = 0; index < 64; index += 1)
    bytes.writeDoubleLE(
      NHM2_SPHERICAL_BOSON_STAR_V2_SMEARING_WEIGHT_VALUE,
      index * 8,
    );
  return bytes;
};

const createFilesystemFixture = async (): Promise<{
  parent: string;
  root: string;
}> => {
  const tempRoot = await fs.realpath(os.tmpdir());
  const parent = await fs.mkdtemp(
    path.join(tempRoot, "nhm2-spherical-v2-raw-observer-"),
  );
  tempParents.push(parent);
  const root = path.join(parent, "output");
  await fs.mkdir(root);
  const largestZeroFile = Buffer.alloc(
    NHM2_SPHERICAL_BOSON_STAR_V2_RAW_INVENTORY_LIMITS.maximumPerFileBytes,
  );
  for (const descriptor of NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS) {
    const suffix = relativePath(descriptor);
    const absolutePath = path.join(root, ...suffix.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(
      absolutePath,
      descriptor.role === "smearing_weights"
        ? exactSmearingWeightBytes()
        : largestZeroFile.subarray(0, descriptor.sizeBytes),
    );
  }
  return { parent, root };
};

const expectFilesystemError = async (
  promise: Promise<unknown>,
  code: Nhm2SphericalBosonStarV2RawFilesystemObserverError["code"],
): Promise<Nhm2SphericalBosonStarV2RawFilesystemObserverError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(
      Nhm2SphericalBosonStarV2RawFilesystemObserverError,
    );
    expect(error).toMatchObject({ code });
    return error as Nhm2SphericalBosonStarV2RawFilesystemObserverError;
  }
  throw new Error(`Expected ${code}.`);
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const parent of tempParents.splice(0)) {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

const ordinaryInput = () => ({
  contractVersion:
    NHM2_SPHERICAL_BOSON_STAR_V2_RAW_INVENTORY_INPUT_CONTRACT_VERSION,
  candidateId: CANDIDATE_ID,
  schemaBinding: { ...NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_BINDING },
  files: NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS.map(
    (descriptor) => {
      const bytes = new Uint8Array(descriptor.sizeBytes);
      return {
        fileOrdinal: descriptor.fileOrdinal,
        path: descriptor.path,
        role: descriptor.role,
        shape: [...descriptor.shape],
        sizeBytes: descriptor.sizeBytes,
        sha256: hash(bytes),
        bytes,
      };
    },
  ),
});

const expectClosedBoundary = (value: unknown) => {
  const receipt = admitNhm2SphericalBosonStarV2RawInventory(value);
  expect(receipt.byteAdmissionDisposition).toBe("blocked");
  expect(receipt.overallDisposition).toBe("blocked");
  expect(receipt.scientificDisposition).toBe("not_evaluated");
  expect(receipt.claimDisposition).toBe("locked");
  expect(receipt.calculationReady).toBe(false);
  expect(receipt.firstBlocker).toBe("server_minted_input_capability_required");
  expect(receipt.inputBinding).toBeNull();
  expect(receipt.admissionTrace).toMatchObject({
    exactPlainGraphCapturedWithoutByteClone: false,
    exact68DescriptorInventoryVerified: false,
    perFileAndAggregateCapsPreflightedBeforeByteCopies: false,
    builtInFullViewCopiesCreated: false,
    sha256CompletedForEveryCopyBeforeNumericScan: false,
    candidateFrozenContentHashesVerifiedBeforeNumericScan: false,
    allNonfiniteWordsScanned: false,
    allNegativeZeroWordsScanned: false,
    all18RoleSensitiveNonnegativeFilesScanned: false,
    float64LeDecodedOnlyAfterEveryAdmissionPhase: false,
  });
  expect(Object.values(receipt.authorityBoundary)).toEqual(
    Array(Object.keys(receipt.authorityBoundary).length).fill(false),
  );
  expect(Object.isFrozen(receipt)).toBe(true);
  return receipt;
};

describe("spherical boson-star v2 closed raw-inventory capability boundary", () => {
  it("binds the sealed 68-file schema without admitting a plain caller graph", () => {
    expect(NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_EXPECTED_SHA256).toBe(
      "96f5816f9d04b9d3b14a228ab821c3224974f47839ace6d7c7819f77c6a223ff",
    );
    expect(
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_EXPECTED_CANONICAL_SIZE_BYTES,
    ).toBe(163_818);
    expect(NHM2_SPHERICAL_BOSON_STAR_V2_RAW_INVENTORY_LIMITS).toEqual({
      exactFileCount: 68,
      exactNonnegativeRoleCount: 18,
      maximumPerFileBytes: 3_276_800,
      exactAggregateBytes: 6_693_376,
      maximumAggregateBytes: 6_693_376,
      float64Bytes: 8,
    });
    expectClosedBoundary(ordinaryInput());
  });

  it("keeps the compiled descriptor inventory exact and internally coherent", () => {
    const descriptors =
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS;
    expect(descriptors).toHaveLength(68);
    expect(descriptors.map((entry) => entry.fileOrdinal)).toEqual(
      Array.from({ length: 68 }, (_, index) => index),
    );
    expect(new Set(descriptors.map((entry) => entry.path)).size).toBe(68);
    expect(new Set(descriptors.map((entry) => entry.role)).size).toBe(68);
    expect(descriptors.reduce((sum, entry) => sum + entry.sizeBytes, 0)).toBe(
      6_693_376,
    );
    for (const descriptor of descriptors) {
      expect(
        descriptor.shape.reduce(
          (product, dimension) => product * dimension,
          1,
        ) * 8,
      ).toBe(descriptor.sizeBytes);
      expect(descriptor.dtype).toBe("float64");
      expect(descriptor.endianness).toBe("little");
      expect(descriptor.storageOrder).toBe("row-major");
      expect(descriptor.negativeZeroAllowed).toBe(false);
    }
  });

  it("matches the independently implemented Python zero-fixture closure framing", () => {
    const bindings =
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS.map(
        (descriptor) => ({
          fileOrdinal: descriptor.fileOrdinal,
          path: descriptor.path,
          role: descriptor.role,
          shape: [...descriptor.shape],
          sizeBytes: descriptor.sizeBytes,
          sha256: hash(new Uint8Array(descriptor.sizeBytes)),
        }),
      );
    expect(
      hash(
        NHM2_SPHERICAL_BOSON_STAR_V2_RAW_HASH_CLOSURE_SHA256_DOMAIN +
          JSON.stringify(bindings),
      ),
    ).toBe("35d84d383d00f95589910321186b378e6b3260a0eef6709ee57ffac3e276cce4");
  });

  it("does not invoke a proxy that could synthesize one million own keys", () => {
    let ownKeysTrapCount = 0;
    let getTrapCount = 0;
    const hostile = new Proxy(ordinaryInput(), {
      ownKeys() {
        ownKeysTrapCount += 1;
        return Array.from({ length: 1_000_000 }, (_, index) => `k${index}`);
      },
      get() {
        getTrapCount += 1;
        throw new Error("closed admission must not inspect caller input");
      },
    });
    expectClosedBoundary(hostile);
    expect(ownKeysTrapCount).toBe(0);
    expect(getTrapCount).toBe(0);
  });

  it("rejects a one-million-character key before graph traversal", () => {
    const input = ordinaryInput();
    let accessorCount = 0;
    Object.defineProperty(input, "k".repeat(1_000_000), {
      enumerable: false,
      get() {
        accessorCount += 1;
        throw new Error("unknown metadata must not be invoked");
      },
    });
    expectClosedBoundary(input);
    expect(accessorCount).toBe(0);
  });

  it("rejects symbol and byte-view expandos without invoking them", () => {
    const input = ordinaryInput();
    let accessorCount = 0;
    Object.defineProperty(input, Symbol("root-extra"), {
      get() {
        accessorCount += 1;
        throw new Error("root symbol must not be invoked");
      },
    });
    Object.defineProperty(input.files[0].bytes, "byteExtra", {
      get() {
        accessorCount += 1;
        throw new Error("byte expando must not be invoked");
      },
    });
    Object.defineProperty(input.files[0].bytes.buffer, Symbol("buffer-extra"), {
      get() {
        accessorCount += 1;
        throw new Error("buffer symbol must not be invoked");
      },
    });
    expectClosedBoundary(input);
    expect(accessorCount).toBe(0);
  });

  it("blocks primitive, null, empty, and forged capability-shaped inputs uniformly", () => {
    for (const value of [
      null,
      undefined,
      0,
      "",
      Object.freeze(Object.create(null)),
      Object.freeze({}),
      { inputBinding: NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_BINDING },
    ]) {
      expectClosedBoundary(value);
    }
  });

  it("never grants decoded-array access to blocked or forged receipt identities", () => {
    const receipt = expectClosedBoundary(ordinaryInput());
    expect(
      getNhm2SphericalBosonStarV2AdmittedFloat64Length(receipt, 0),
    ).toBeNull();
    expect(
      readNhm2SphericalBosonStarV2AdmittedFloat64(receipt, 0, 0),
    ).toBeNull();
    expect(
      getNhm2SphericalBosonStarV2AdmittedFloat64Length({ ...receipt }, 0),
    ).toBeNull();
    expect(
      readNhm2SphericalBosonStarV2AdmittedFloat64(
        structuredClone(receipt),
        0,
        0,
      ),
    ).toBeNull();
  });

  it("contains no public capability issuer and no util.inspect or caller own-key enumeration", () => {
    const sourcePath = fileURLToPath(
      new URL(
        "../nhm2-spherical-boson-star-v2-raw-inventory-replayer.ts",
        import.meta.url,
      ),
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toContain('from "node:util"');
    expect(source).not.toContain("inspect(");
    expect(source.match(/MINTED_INPUTS\.set/g)).toHaveLength(1);
    expect(source).toContain("const privatelyAdmitFilesystemObservation");
    expect(source).not.toMatch(/export\s+const\s+mint/i);
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+mint/i);
    expect(source).not.toContain("Object.getOwnPropertyDescriptors(");
    expect(source).not.toContain("Object.getOwnPropertySymbols(");
    expect(source).toContain("MINTED_INPUTS.get(callerInput)");
  });
});

describe("spherical boson-star v2 authenticated filesystem observation", () => {
  it("reads and byte-replays exactly 68 files but retains the missing-instance-and-preexecution-evidence blocker", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture();
    const receipt =
      await observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(
        fixture.root,
      );

    expect(receipt).toMatchObject({
      artifactId:
        NHM2_SPHERICAL_BOSON_STAR_V2_RAW_FILESYSTEM_OBSERVER_ARTIFACT_ID,
      contractVersion:
        NHM2_SPHERICAL_BOSON_STAR_V2_RAW_FILESYSTEM_OBSERVER_CONTRACT_VERSION,
      stage: "stage_2_bounded_current_filesystem_observation",
      diagnosticOnly: true,
      overallDisposition: "blocked",
      observationDisposition: "accepted",
      readiness: false,
      rootRealPath: fixture.root,
      fileCount: 68,
      aggregateBytes: 6_693_376,
    });
    expect(receipt.files).toHaveLength(68);
    expect(receipt.files.map((file) => file.fileOrdinal)).toEqual(
      Array.from({ length: 68 }, (_, index) => index),
    );
    expect(receipt.files.map((file) => file.relativePath)).toEqual(
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS.map(
        relativePath,
      ),
    );
    expect(receipt.files[0].sha256).toBe(
      hash(
        Buffer.alloc(
          NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS[0]
            .sizeBytes,
        ),
      ),
    );
    expect(receipt.contentAdmission).toMatchObject({
      byteAdmissionDisposition: "accepted",
      calculationReady: false,
      privateAdmissionReceiptExposed: false,
    });
    expect(receipt.contentAdmission.observedInputBinding).toMatchObject({
      candidateId: CANDIDATE_ID,
      fileCount: 68,
      aggregateBytes: 6_693_376,
      rawReplaySchema: NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_SCHEMA_BINDING,
    });
    expect(
      receipt.contentAdmission.observedInputBinding.rawHashBindings,
    ).toHaveLength(68);
    expect(
      getNhm2SphericalBosonStarV2AdmittedFloat64Length(
        receipt.contentAdmission,
        0,
      ),
    ).toBeNull();
    expect(
      readNhm2SphericalBosonStarV2AdmittedFloat64(
        receipt.contentAdmission.observedInputBinding,
        0,
        0,
      ),
    ).toBeNull();
    expect(receipt.blockers).toEqual([
      expect.objectContaining({
        code: "postrun_manifest_instance_and_preexecution_evidence_missing",
      }),
    ]);
    expect(receipt.manifestBoundary).toEqual({
      namedArtifactId: "nhm2.spherical_boson_star_v2_raw_replay_manifest",
      namedContractVersion:
        "nhm2_spherical_boson_star_v2_raw_replay_manifest/v1",
      concreteCanonicalWireValidatorPresent: true,
      concreteCanonicalWireByteLimitPresent: true,
      runArtifactWirePolicySha256:
        NHM2_SPHERICAL_BOSON_STAR_V2_RUN_ARTIFACT_WIRE_SHA256,
      runArtifactWirePolicyCanonicalSizeBytes:
        NHM2_SPHERICAL_BOSON_STAR_V2_RUN_ARTIFACT_WIRE_CANONICAL_SIZE_BYTES,
      manifestEntryBytesPresentInSchemaArtifact: false,
      producerHashFreshnessOrProvenanceAccepted: false,
    });
    expect(Object.values(receipt.observationTrace)).toEqual(
      Array(Object.keys(receipt.observationTrace).length).fill(true),
    );
    expect(receipt.observationTrace).toMatchObject({
      everyEntryFinalSweepIdentityAndHashMatchedOriginallyObservedBytes: true,
      boundedSweepsDoNotClaimAtomicFilesystemSnapshotOrStabilityThroughReturn: true,
    });
    expect(Object.values(receipt.authorityBoundary)).toEqual(
      Array(Object.keys(receipt.authorityBoundary).length).fill(false),
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.files)).toBe(true);
    expect(Object.isFrozen(receipt.files[0].filesystemIdentity)).toBe(true);
  });

  it("rejects non-string and unresolved roots without traversing hostile objects", async () => {
    mockLinuxObserverHost();
    let ownKeysCalls = 0;
    let getCalls = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          ownKeysCalls += 1;
          return Array.from({ length: 1_000_000 }, (_, index) => `k${index}`);
        },
        get() {
          getCalls += 1;
          throw new Error("root object must never be traversed");
        },
      },
    );
    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(
        hostile as never,
      ),
      "filesystem_root_forbidden",
    );
    expect(ownKeysCalls).toBe(0);
    expect(getCalls).toBe(0);
    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(
        "relative/output",
      ),
      "filesystem_root_not_absolute",
    );
  });

  it("fails closed off Linux before traversing the filesystem", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const lstatSpy = vi.spyOn(fs, "lstat");
    const realpathSpy = vi.spyOn(fs, "realpath");
    const opendirSpy = vi.spyOn(fs, "opendir");
    const openSpy = vi.spyOn(fs, "open");

    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(
        path.resolve(os.tmpdir(), "nhm2-platform-inadmissible"),
      ),
      "filesystem_platform_inadmissible",
    );
    expect(lstatSpy).not.toHaveBeenCalled();
    expect(realpathSpy).not.toHaveBeenCalled();
    expect(opendirSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("rejects extra inventory and size mismatch before opening any file", async () => {
    mockLinuxObserverHost();
    const extra = await createFilesystemFixture();
    await fs.writeFile(path.join(extra.root, "extra.bin"), Buffer.from("x"));
    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(extra.root),
      "filesystem_inventory_mismatch",
    );

    const wrongSize = await createFilesystemFixture();
    const first =
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS[0];
    await fs.truncate(
      path.join(wrongSize.root, ...relativePath(first).split("/")),
      first.sizeBytes - 8,
    );
    const openSpy = vi.spyOn(fs, "open");
    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(wrongSize.root),
      "filesystem_entry_size_mismatch",
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("rejects symlinked physical files when links are available", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture();
    const [first, second] =
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS;
    const firstPath = path.join(
      fixture.root,
      ...relativePath(first).split("/"),
    );
    const secondPath = path.join(
      fixture.root,
      ...relativePath(second).split("/"),
    );
    await fs.rm(firstPath);
    try {
      await fs.symlink(secondPath, firstPath, "file");
    } catch (error) {
      if (
        ["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return;
      throw error;
    }
    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(fixture.root),
      "filesystem_entry_symlink_or_reparse",
    );
  });

  it("rejects mtime/ctime identity mutation between descriptor fstats", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture();
    const first =
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS[0];
    const firstPath = path.join(
      fixture.root,
      ...relativePath(first).split("/"),
    );
    const originalOpen = fs.open.bind(fs) as (...args: any[]) => Promise<any>;
    let mutated = false;
    vi.spyOn(fs, "open").mockImplementationOnce((async (...args: any[]) => {
      const handle = await originalOpen(...args);
      const originalStat = handle.stat.bind(handle) as (
        options: unknown,
      ) => Promise<unknown>;
      let statCalls = 0;
      vi.spyOn(handle, "stat").mockImplementation(async (options: unknown) => {
        const result = await originalStat(options);
        statCalls += 1;
        if (statCalls === 1 && !mutated) {
          mutated = true;
          const timestamp = new Date("2000-01-01T00:00:00.000Z");
          await fs.utimes(firstPath, timestamp, timestamp);
        }
        return result;
      });
      return handle;
    }) as never);

    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(fixture.root),
      "filesystem_entry_changed_while_reading",
    );
    expect(mutated).toBe(true);
  });

  it("rejects a same-size mutation after file zero replay during the final complete sweep", async () => {
    mockLinuxObserverHost();
    const fixture = await createFilesystemFixture();
    const first =
      NHM2_SPHERICAL_BOSON_STAR_V2_RAW_REPLAY_PHYSICAL_FILE_DESCRIPTORS[0];
    const firstPath = path.join(
      fixture.root,
      ...relativePath(first).split("/"),
    );
    const originalOpen = fs.open.bind(fs) as (...args: any[]) => Promise<any>;
    let observerOpenCalls = 0;
    let mutatedAfterFileZeroReplay = false;
    vi.spyOn(fs, "open").mockImplementation((async (...args: any[]) => {
      observerOpenCalls += 1;
      if (observerOpenCalls === 70 && !mutatedAfterFileZeroReplay) {
        const mutation = await originalOpen(firstPath, "r+");
        try {
          await mutation.write(Buffer.from([1]), 0, 1, 0);
        } finally {
          await mutation.close();
        }
        const timestamp = new Date("2000-01-01T00:00:00.000Z");
        await fs.utimes(firstPath, timestamp, timestamp);
        mutatedAfterFileZeroReplay = true;
      }
      return originalOpen(...args);
    }) as never);

    await expectFilesystemError(
      observeNhm2SphericalBosonStarV2RawInventoryFromFilesystem(fixture.root),
      "filesystem_entry_open_identity_mismatch",
    );
    expect(mutatedAfterFileZeroReplay).toBe(true);
    expect(observerOpenCalls).toBe(137);
  });
});
