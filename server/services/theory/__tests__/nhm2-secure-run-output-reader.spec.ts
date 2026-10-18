import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NHM2_SECURE_RUN_OUTPUT_READER_AUTHORITY_BLOCKERS,
  NHM2_SECURE_RUN_OUTPUT_READER_CLAIM_BOUNDARY,
  NHM2_SECURE_RUN_OUTPUT_READER_LIMITS,
  Nhm2SecureRunOutputReaderError,
  readNhm2SecureRunOutputs,
  type Nhm2SecureRunOutputFileRequestV1,
} from "../nhm2-secure-run-output-reader";

const roots: string[] = [];

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const createRunDirectory = async (): Promise<string> => {
  const tempRealPath = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(
    path.join(tempRealPath, "nhm2-secure-reader-spec-"),
  );
  const realRoot = await fs.realpath(root);
  roots.push(realRoot);
  return realRoot;
};

const writeOutput = async (
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<Nhm2SecureRunOutputFileRequestV1> => {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return {
    relativePath,
    expectedSha256: sha256(bytes),
    expectedSizeBytes: BigInt(bytes.byteLength),
  };
};

const float64Le = (values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(values.length * 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
};

const expectReaderCode = async (
  operation: Promise<unknown>,
  code: Nhm2SecureRunOutputReaderError["code"],
): Promise<Nhm2SecureRunOutputReaderError> => {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2SecureRunOutputReaderError);
    expect(error).toMatchObject({ code, blockers: [code] });
    expect(
      Object.isFrozen((error as Nhm2SecureRunOutputReaderError).blockers),
    ).toBe(true);
    return error as Nhm2SecureRunOutputReaderError;
  }
  throw new Error(`Expected secure reader blocker ${code}.`);
};

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("NHM2 secure run-output reader", () => {
  it("reads exact bound bytes and finite little-endian float64 arrays without granting authority", async () => {
    const root = await createRunDirectory();
    const rawBytes = Buffer.from("opaque solver output\n", "utf8");
    const tensorBytes = float64Le([1.25, -2.5, 0, 4.75]);
    const raw = await writeOutput(root, "logs/solver.log", rawBytes);
    const tensor = await writeOutput(
      root,
      "fields/wall-t00.f64le",
      tensorBytes,
    );

    const result = await readNhm2SecureRunOutputs({
      runDirectory: root,
      files: [
        raw,
        {
          ...tensor,
          decode: { kind: "float64_le", shape: [2, 2] },
        },
      ],
      maxFileBytes: 1024n,
      maxAggregateBytes: 2048n,
    });

    expect(result.readState).toBe("bounded_bytes_read_authority_neutral");
    expect(result.aggregateSizeBytes).toBe(
      BigInt(rawBytes.byteLength + tensorBytes.byteLength),
    );
    expect(result.files.map((file) => file.relativePath)).toEqual([
      "fields/wall-t00.f64le",
      "logs/solver.log",
    ]);
    const decoded = result.files[0]?.decoded;
    expect(decoded?.kind).toBe("float64_le");
    if (decoded?.kind !== "float64_le") throw new Error("decode missing");
    expect(decoded.shape).toEqual([2, 2]);
    expect(decoded).toEqual({
      kind: "float64_le",
      shape: [2, 2],
      finiteValuesVerified: true,
    });
    expect("values" in decoded).toBe(false);
    expect(result.files[1]?.bytes).toEqual(rawBytes);
    expect(result.files[0]?.filesystemIdentity).toMatchObject({
      sizeBytes: String(tensorBytes.byteLength),
    });
    expect(result.blockers).toEqual(
      NHM2_SECURE_RUN_OUTPUT_READER_AUTHORITY_BLOCKERS,
    );
    expect(result.claimBoundary).toEqual({
      boundedFilesystemReadOnly: true,
      returnedRawBytesMutable: true,
      rawByteMutationInvalidatesSha256Binding: true,
      downstreamMustRehashRawBytesBeforeAuthorityUse: true,
      serverAuthorizedRunRootEstablished: false,
      runOutputFreshnessAssessed: false,
      scientificSemanticsAssessed: false,
      sameChartTensorClosureEstablished: false,
      independentNumericalReproductionEstablished: false,
      experimentReadyTheoryClosureClaimAllowed: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
    expect("pass" in result).toBe(false);
    expect("verified" in result).toBe(false);
  });

  it("returns fresh runtime-frozen metadata while explicitly leaving raw bytes mutable", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(root, "field.f64le", float64Le([1, 2]));
    const input = {
      runDirectory: root,
      files: [
        {
          ...request,
          decode: { kind: "float64_le" as const, shape: [2] },
        },
      ],
    };
    const first = await readNhm2SecureRunOutputs(input);
    const second = await readNhm2SecureRunOutputs(input);
    const firstFile = first.files[0]!;
    const secondFile = second.files[0]!;
    const firstDecoded = firstFile.decoded;
    if (firstDecoded.kind !== "float64_le") throw new Error("decode missing");

    expect(
      Object.isFrozen(NHM2_SECURE_RUN_OUTPUT_READER_AUTHORITY_BLOCKERS),
    ).toBe(true);
    expect(Object.isFrozen(NHM2_SECURE_RUN_OUTPUT_READER_CLAIM_BOUNDARY)).toBe(
      true,
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.files)).toBe(true);
    expect(Object.isFrozen(firstFile)).toBe(true);
    expect(Object.isFrozen(firstFile.filesystemIdentity)).toBe(true);
    expect(Object.isFrozen(firstDecoded)).toBe(true);
    expect(Object.isFrozen(firstDecoded.shape)).toBe(true);
    expect(Object.isFrozen(first.blockers)).toBe(true);
    expect(Object.isFrozen(first.claimBoundary)).toBe(true);
    expect(Object.isFrozen(firstFile.bytes)).toBe(false);

    expect(first.files).not.toBe(second.files);
    expect(firstFile).not.toBe(secondFile);
    expect(firstFile.filesystemIdentity).not.toBe(
      secondFile.filesystemIdentity,
    );
    expect(firstFile.decoded).not.toBe(secondFile.decoded);
    if (secondFile.decoded.kind !== "float64_le") {
      throw new Error("second decode missing");
    }
    expect(firstDecoded.shape).not.toBe(secondFile.decoded.shape);
    expect(first.blockers).not.toBe(second.blockers);
    expect(first.blockers).not.toBe(
      NHM2_SECURE_RUN_OUTPUT_READER_AUTHORITY_BLOCKERS,
    );
    expect(first.claimBoundary).not.toBe(second.claimBoundary);
    expect(first.claimBoundary).not.toBe(
      NHM2_SECURE_RUN_OUTPUT_READER_CLAIM_BOUNDARY,
    );
    expect(firstFile.bytes).not.toBe(secondFile.bytes);

    const boundSha256 = firstFile.sha256;
    firstFile.bytes[0] = firstFile.bytes[0]! ^ 0xff;
    expect(sha256(firstFile.bytes)).not.toBe(boundSha256);
    expect(first.claimBoundary).toMatchObject({
      returnedRawBytesMutable: true,
      rawByteMutationInvalidatesSha256Binding: true,
      downstreamMustRehashRawBytesBeforeAuthorityUse: true,
    });
  });

  it("uses comparison-array memory ceilings rather than general artifact limits", () => {
    expect(NHM2_SECURE_RUN_OUTPUT_READER_LIMITS).toMatchObject({
      defaultMaxFileBytes: 16n * 1024n * 1024n,
      defaultMaxAggregateBytes: 128n * 1024n * 1024n,
      hardMaxFileBytes: 64n * 1024n * 1024n,
      hardMaxAggregateBytes: 256n * 1024n * 1024n,
    });
  });

  it.each([
    "../escape.bin",
    "nested/../../escape.bin",
    "/absolute.bin",
    "C:/absolute.bin",
    "//server/share.bin",
    "\\\\server\\share.bin",
    "//?/C:/device.bin",
    "\\\\?\\C:\\device.bin",
    "field.bin:alternate-stream",
    "CON.bin",
    "NUL",
    "COM1.txt",
    "LPT9",
    "nested/aux",
    "nested/trailing.",
    "nested/trailing ",
    "nested/control\u0001.bin",
    "nested/*.bin",
    "nested/[field].bin",
    "nested//field.bin",
    "nested/./field.bin",
  ])("rejects non-portable output path %j", async (relativePath) => {
    const root = await createRunDirectory();
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [
          {
            relativePath,
            expectedSha256: sha256(Buffer.alloc(0)),
            expectedSizeBytes: 0n,
          },
        ],
      }),
      "output_path_invalid",
    );
  });

  it("rejects exact and case-folded duplicate paths before filesystem access", async () => {
    const root = await createRunDirectory();
    const emptySha = sha256(Buffer.alloc(0));
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [
          {
            relativePath: "Fields/T00.bin",
            expectedSha256: emptySha,
            expectedSizeBytes: 0n,
          },
          {
            relativePath: "fields/t00.bin",
            expectedSha256: emptySha,
            expectedSizeBytes: 0n,
          },
        ],
      }),
      "output_path_case_fold_collision",
    );
  });

  it.each([
    ["Fields/a.bin", "fields/b.bin"],
    ["node", "node/child.bin"],
    ["Branch", "branch/child.bin"],
  ])(
    "rejects directory-prefix or file-vs-directory collision %s / %s",
    async (firstPath, secondPath) => {
      const root = await createRunDirectory();
      const emptySha = sha256(Buffer.alloc(0));
      await expectReaderCode(
        readNhm2SecureRunOutputs({
          runDirectory: root,
          files: [firstPath, secondPath].map((relativePath) => ({
            relativePath,
            expectedSha256: emptySha,
            expectedSizeBytes: 0n,
          })),
        }),
        "output_path_case_fold_collision",
      );
    },
  );

  it("rejects shadow keys in request and decode objects", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(root, "output.bin", float64Le([1]));
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [{ ...request, shadowSha256: request.expectedSha256 } as never],
      }),
      "reader_input_invalid",
    );
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [
          {
            ...request,
            decode: {
              kind: "float64_le",
              shape: [1],
              endian: "little",
            } as never,
          },
        ],
      }),
      "output_float64_shape_invalid",
    );
  });

  it("validates exact top-level keys while accepting governed optional combinations", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("bound", "ascii"),
    );
    const base = { runDirectory: root, files: [request] };
    const optionalCombinations = [
      {},
      {
        maxFileBytes: NHM2_SECURE_RUN_OUTPUT_READER_LIMITS.defaultMaxFileBytes,
      },
      {
        maxAggregateBytes:
          NHM2_SECURE_RUN_OUTPUT_READER_LIMITS.defaultMaxAggregateBytes,
      },
      {
        maxFileBytes: NHM2_SECURE_RUN_OUTPUT_READER_LIMITS.defaultMaxFileBytes,
        maxAggregateBytes:
          NHM2_SECURE_RUN_OUTPUT_READER_LIMITS.defaultMaxAggregateBytes,
        afterFileDescriptorOpenBeforeStatForTesting: () => undefined,
        afterFileOpenForTesting: () => undefined,
        afterInitialReadForTesting: () => undefined,
      },
    ];
    for (const optional of optionalCombinations) {
      await expect(
        readNhm2SecureRunOutputs({ ...base, ...optional }),
      ).resolves.toMatchObject({
        readState: "bounded_bytes_read_authority_neutral",
      });
    }

    await expectReaderCode(
      readNhm2SecureRunOutputs({ ...base, shadowRoot: root } as never),
      "reader_input_invalid",
    );
    const symbolInput = { ...base } as Record<PropertyKey, unknown>;
    symbolInput[Symbol("shadow")] = true;
    await expectReaderCode(
      readNhm2SecureRunOutputs(symbolInput as never),
      "reader_input_invalid",
    );
    const inheritedInput = Object.assign(Object.create({ shadow: true }), base);
    await expectReaderCode(
      readNhm2SecureRunOutputs(inheritedInput as never),
      "reader_input_invalid",
    );
  });

  it("requires a server-resolved absolute non-root run directory", async () => {
    const request = {
      relativePath: "output.bin",
      expectedSha256: sha256(Buffer.alloc(0)),
      expectedSizeBytes: 0n,
    };
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: "relative/run",
        files: [request],
      }),
      "run_directory_not_absolute",
    );
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: path.parse(process.cwd()).root,
        files: [request],
      }),
      "run_directory_is_filesystem_root",
    );
  });

  it.each([
    "//server/share/run",
    "\\\\server\\share\\run",
    "//?/C:/device/run",
    "\\\\?\\C:\\device\\run",
    "\\??\\C:\\device\\run",
    "smb://server/share/run",
    "file://server/share/run",
  ])("rejects UNC, device, or network run root %j", async (runDirectory) => {
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory,
        files: [
          {
            relativePath: "output.bin",
            expectedSha256: sha256(Buffer.alloc(0)),
            expectedSizeBytes: 0n,
          },
        ],
      }),
      "run_directory_network_or_device_forbidden",
    );
  });

  it("rejects a run-directory symlink or reparse alias when links are supported", async () => {
    const container = await createRunDirectory();
    const actual = path.join(container, "actual");
    const alias = path.join(container, "alias");
    await fs.mkdir(actual);
    const request = await writeOutput(
      actual,
      "output.bin",
      Buffer.from("bound", "ascii"),
    );
    try {
      await fs.symlink(
        actual,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) return;
      throw error;
    }
    await expectReaderCode(
      readNhm2SecureRunOutputs({ runDirectory: alias, files: [request] }),
      "run_directory_symlink_or_reparse",
    );
  });

  it("rejects undeclared, missing, and non-regular inventory entries", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("declared", "ascii"),
    );
    await fs.writeFile(path.join(root, "extra.bin"), Buffer.from("extra"));
    await expectReaderCode(
      readNhm2SecureRunOutputs({ runDirectory: root, files: [request] }),
      "output_inventory_mismatch",
    );

    await fs.rm(path.join(root, "extra.bin"));
    await fs.rm(path.join(root, "output.bin"));
    await expectReaderCode(
      readNhm2SecureRunOutputs({ runDirectory: root, files: [request] }),
      "output_inventory_mismatch",
    );

    await fs.mkdir(path.join(root, "output.bin"));
    await expectReaderCode(
      readNhm2SecureRunOutputs({ runDirectory: root, files: [request] }),
      "output_inventory_mismatch",
    );
  });

  it("rejects observed sizes that differ in either direction from the bigint binding", async () => {
    const root = await createRunDirectory();
    const bytes = Buffer.from("12345678", "ascii");
    const request = await writeOutput(root, "output.bin", bytes);
    for (const expectedSizeBytes of [7n, 9n]) {
      await expectReaderCode(
        readNhm2SecureRunOutputs({
          runDirectory: root,
          files: [{ ...request, expectedSizeBytes }],
        }),
        "output_size_mismatch",
      );
    }
  });

  it("uses the one-byte trailing probe to reject an append after open", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("12345678", "ascii"),
    );
    let mutated = false;
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [request],
        afterFileOpenForTesting: async ({ phase, absolutePath }) => {
          if (phase !== "initial" || mutated) return;
          mutated = true;
          await fs.appendFile(absolutePath, Buffer.from("x", "ascii"));
        },
      }),
      "output_bounded_read_mismatch",
    );
  });

  it("rejects a truncation after open during the exact positional read", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("12345678", "ascii"),
    );
    let mutated = false;
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [request],
        afterFileOpenForTesting: async ({ phase, absolutePath }) => {
          if (phase !== "initial" || mutated) return;
          mutated = true;
          await fs.truncate(absolutePath, 4);
        },
      }),
      "output_bounded_read_mismatch",
    );
  });

  it("rejects a wrong external SHA-256 binding", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("hash-bound", "ascii"),
    );
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [{ ...request, expectedSha256: "0".repeat(64) }],
      }),
      "output_sha256_mismatch",
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite float64 value %s",
    async (value) => {
      const root = await createRunDirectory();
      const request = await writeOutput(
        root,
        "field.f64le",
        float64Le([value]),
      );
      await expectReaderCode(
        readNhm2SecureRunOutputs({
          runDirectory: root,
          files: [
            {
              ...request,
              decode: { kind: "float64_le", shape: [1] },
            },
          ],
        }),
        "output_float64_non_finite",
      );
    },
  );

  it("rejects float64 shapes that do not exactly account for bound bytes", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(root, "field.f64le", float64Le([1, 2]));
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [
          {
            ...request,
            decode: { kind: "float64_le", shape: [3] },
          },
        ],
      }),
      "output_float64_shape_mismatch",
    );
  });

  it("enforces exact bigint per-file and aggregate ceilings before reading", async () => {
    const root = await createRunDirectory();
    const first = await writeOutput(root, "first.bin", Buffer.alloc(8, 1));
    const second = await writeOutput(root, "second.bin", Buffer.alloc(8, 2));
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [first],
        maxFileBytes: 7n,
        maxAggregateBytes: 16n,
      }),
      "output_resource_limit_exceeded",
    );
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [first, second],
        maxFileBytes: 8n,
        maxAggregateBytes: 15n,
      }),
      "output_aggregate_limit_exceeded",
    );
  });

  it("rejects hardlinked output bytes when the platform supports hardlinks", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("hardlink", "ascii"),
    );
    try {
      await fs.link(
        path.join(root, "output.bin"),
        path.join(root, "alias.bin"),
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(code ?? "")) return;
      throw error;
    }
    const alias = { ...request, relativePath: "alias.bin" };
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [request, alias],
      }),
      "output_entry_hardlinked",
    );
  });

  it("opens POSIX outputs with NOFOLLOW and NONBLOCK defensive flags", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("flags", "ascii"),
    );
    const openSpy = vi.spyOn(fs, "open");
    await readNhm2SecureRunOutputs({ runDirectory: root, files: [request] });
    const flags = openSpy.mock.calls[0]?.[1];
    expect(typeof flags).toBe("number");
    if (process.platform !== "win32" && typeof flags === "number") {
      expect(flags & fsConstants.O_NOFOLLOW).toBe(fsConstants.O_NOFOLLOW);
      expect(flags & fsConstants.O_NONBLOCK).toBe(fsConstants.O_NONBLOCK);
    }
  });

  it("rejects an opened descriptor whose immediate fstat is not regular", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("descriptor", "ascii"),
    );
    const directoryStat = await fs.lstat(root, { bigint: true });
    const fakeHandle = {
      stat: async () => directoryStat,
      close: async () => undefined,
    };
    vi.spyOn(fs, "open").mockResolvedValueOnce(fakeHandle as never);
    await expectReaderCode(
      readNhm2SecureRunOutputs({ runDirectory: root, files: [request] }),
      "output_open_identity_mismatch",
    );
  });

  it("rechecks descriptor nlink with fstat immediately after open", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("descriptor", "ascii"),
    );
    const source = path.join(root, "output.bin");
    const probe = path.join(root, "probe.bin");
    try {
      await fs.link(source, probe);
      await fs.unlink(probe);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(code ?? "")) return;
      throw error;
    }
    let linked = false;
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [request],
        afterFileDescriptorOpenBeforeStatForTesting: async ({ phase }) => {
          if (phase !== "initial" || linked) return;
          linked = true;
          await fs.link(source, path.join(root, "alias.bin"));
        },
      }),
      "output_open_identity_mismatch",
    );
  });

  it("rejects symlinked output parents when the platform supports links", async () => {
    const root = await createRunDirectory();
    const realParent = path.join(root, "real-parent");
    const linkedParent = path.join(root, "linked-parent");
    await fs.mkdir(realParent);
    await fs.writeFile(path.join(realParent, "output.bin"), Buffer.from("x"));
    try {
      await fs.symlink(
        realParent,
        linkedParent,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) return;
      throw error;
    }
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [
          {
            relativePath: "linked-parent/output.bin",
            expectedSha256: sha256(Buffer.from("x")),
            expectedSizeBytes: 1n,
          },
        ],
      }),
      "output_inventory_mismatch",
    );
  });

  it("rejects an extra file inserted between exact inventory snapshots", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("stable", "ascii"),
    );
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [request],
        afterInitialReadForTesting: async () => {
          await fs.writeFile(
            path.join(root, "extra.bin"),
            Buffer.from("extra"),
          );
        },
      }),
      "output_inventory_mismatch",
    );
  });

  it("does not admit mutation hooks outside the explicit Vitest runtime", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("stable", "ascii"),
    );
    vi.stubEnv("NODE_ENV", "production");
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [request],
        afterInitialReadForTesting: () => undefined,
      }),
      "test_hook_not_allowed",
    );
  });

  it("reopens every file and rejects same-size post-read TOCTOU mutation", async () => {
    const root = await createRunDirectory();
    const request = await writeOutput(
      root,
      "output.bin",
      Buffer.from("before!!", "ascii"),
    );
    await expectReaderCode(
      readNhm2SecureRunOutputs({
        runDirectory: root,
        files: [request],
        afterInitialReadForTesting: async () => {
          await fs.writeFile(
            path.join(root, "output.bin"),
            Buffer.from("after!!!", "ascii"),
          );
        },
      }),
      "output_changed_after_initial_read",
    );
  });
});
