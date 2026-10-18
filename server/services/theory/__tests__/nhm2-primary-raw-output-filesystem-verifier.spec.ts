import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_PRIMARY_RAW_OUTPUT_FAMILY_DAG_ORDERING,
  NHM2_PRIMARY_RAW_OUTPUT_FAMILY_IDS,
  NHM2_PRIMARY_RAW_OUTPUT_FILE_ORDERING,
  NHM2_PRIMARY_RAW_OUTPUT_INPUT_CLOSURE_ALGORITHM,
  NHM2_PRIMARY_RAW_OUTPUT_INPUT_ORDERING,
  NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256,
  NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_ARTIFACT_ID,
  NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_CONTRACT_VERSION,
  NHM2_PRIMARY_RAW_OUTPUT_PARENT_FAMILIES,
  NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS,
  NHM2_PRIMARY_RAW_OUTPUT_SEMANTIC_ROLE_POLICIES,
  computeNhm2PrimaryRawOutputInputClosureSha256,
  type Nhm2PrimaryRawOutputFamilyId,
  type Nhm2PrimaryRawOutputFileV1,
  type Nhm2PrimaryRawOutputHashedInputV1,
  type Nhm2PrimaryRawOutputManifestV1,
} from "../../../../shared/contracts/nhm2-primary-raw-output-manifest.v1";
import {
  NHM2_PRIMARY_RAW_CONTENT_POLICY_ARTIFACT_ID,
  NHM2_PRIMARY_RAW_CONTENT_POLICY_CONTRACT_VERSION,
  NHM2_PRIMARY_RAW_CONTENT_ROLE_POLICIES,
  type Nhm2PrimaryRawRecordContentPolicyV1,
  type Nhm2PrimaryRawRoleContentPolicyV1,
} from "../../../../shared/contracts/nhm2-primary-raw-content-policy.v1";
import {
  NHM2_PRIMARY_RAW_OUTPUT_HARD_MAX_FILE_BYTES,
  NHM2_PRIMARY_RAW_OUTPUT_HARD_MAX_TOTAL_BYTES,
  verifyNhm2PrimaryRawOutputFilesystem,
  type Nhm2PrimaryRawOutputFilesystemViolationCode,
  type Nhm2PrimaryRawOutputTrustedBindings,
} from "../nhm2-primary-raw-output-filesystem-verifier";

type Fixture = {
  root: string;
  manifestPath: string;
  manifest: Nhm2PrimaryRawOutputManifestV1;
  trusted: Nhm2PrimaryRawOutputTrustedBindings;
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true }).catch(() => undefined),
      ),
  );
});

const sha256 = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const utf8Compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const clone = <T>(value: T): T => structuredClone(value);

const bind = (
  entries: ReadonlyMap<string, Nhm2PrimaryRawOutputHashedInputV1>,
  inputId: string,
) => {
  const entry = entries.get(inputId);
  if (entry == null) throw new Error(`missing fixture input ${inputId}`);
  return { inputId, sha256: entry.sha256 };
};

const numericalBytes = (
  ordinal: number,
  rows: number,
  components: number,
): Buffer => {
  const elementCount = rows * components;
  const bytes = Buffer.alloc(elementCount * Float64Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < elementCount; index += 1) {
    bytes.writeDoubleLE(
      ordinal + (index + 1) / (elementCount + 1),
      index * Float64Array.BYTES_PER_ELEMENT,
    );
  }
  return bytes;
};

const recordFieldValue = (
  type: Nhm2PrimaryRawRecordContentPolicyV1["fields"][number]["type"],
  fieldName: string,
  ordinal: number,
  recordIndex: number,
  fieldIndex: number,
): unknown => {
  switch (type) {
    case "boolean":
      return (ordinal + recordIndex + fieldIndex) % 2 === 0;
    case "int64":
      return String(ordinal * 10_000 + recordIndex * 100 + fieldIndex);
    case "float64":
      return ordinal + recordIndex / 100 + fieldIndex / 10_000;
    case "string":
      return `${fieldName}-${ordinal}-${recordIndex}-${fieldIndex}`;
    case "timestamp_iso8601":
      return new Date(
        Date.UTC(2030, 0, 1) + ordinal * 100_000 + recordIndex * 1_000,
      ).toISOString();
    case "sha256":
      return sha256(`${fieldName}:${ordinal}:${recordIndex}:${fieldIndex}`);
  }
};

const recordValue = (
  policy: Nhm2PrimaryRawRecordContentPolicyV1,
  ordinal: number,
  recordIndex: number,
): Record<string, unknown> =>
  Object.fromEntries(
    policy.fields.map((field, fieldIndex) => [
      field.name,
      recordFieldValue(
        field.type,
        field.name,
        ordinal,
        recordIndex,
        fieldIndex,
      ),
    ]),
  );

const writeRawFile = async (input: {
  root: string;
  familyId: Nhm2PrimaryRawOutputFamilyId;
  semanticRole: string;
  kind: "numerical_array" | "records";
  contentPolicy: Nhm2PrimaryRawRoleContentPolicyV1;
  ordinal: number;
}): Promise<Nhm2PrimaryRawOutputFileV1> => {
  const fileId = `${input.familyId}.${input.semanticRole}`;
  if (input.kind === "numerical_array") {
    if (input.contentPolicy.kind !== "numerical_array")
      throw new Error("fixture numerical content policy mismatch");
    const relativePath = `raw/${input.familyId}/${input.semanticRole}.f64le`;
    const bytes = numericalBytes(
      input.ordinal,
      input.contentPolicy.minimumFirstAxis,
      input.contentPolicy.componentOrder.length,
    );
    await fs.mkdir(path.dirname(path.join(input.root, relativePath)), {
      recursive: true,
    });
    await fs.writeFile(path.join(input.root, relativePath), bytes);
    return {
      fileId,
      familyId: input.familyId,
      semanticRole: input.semanticRole,
      path: relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      mediaType: "application/octet-stream",
      representation: {
        kind: "numerical_array",
        dtype: "float64",
        encoding: "raw_ieee754",
        endianness: "little",
        shape: [
          input.contentPolicy.minimumFirstAxis,
          input.contentPolicy.componentOrder.length,
        ],
        storageOrder: "row-major",
        componentOrder: [...input.contentPolicy.componentOrder],
        unit: input.contentPolicy.unit,
      },
    };
  }

  if (input.contentPolicy.kind !== "records")
    throw new Error("fixture record content policy mismatch");
  const recordPolicy = input.contentPolicy;
  const relativePath = `raw/${input.familyId}/${input.semanticRole}.ndjson`;
  const records = Array.from(
    { length: recordPolicy.minimumRecordCount },
    (_, recordIndex) => recordValue(recordPolicy, input.ordinal, recordIndex),
  );
  const bytes = Buffer.from(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await fs.mkdir(path.dirname(path.join(input.root, relativePath)), {
    recursive: true,
  });
  await fs.writeFile(path.join(input.root, relativePath), bytes);
  return {
    fileId,
    familyId: input.familyId,
    semanticRole: input.semanticRole,
    path: relativePath,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
    mediaType: "application/x-ndjson",
    representation: {
      kind: "records",
      format: "ndjson",
      encoding: "utf8",
      recordMode: "record-stream",
      recordCount: records.length,
      schema: {
        schemaId: recordPolicy.schemaId,
        schemaVersion: recordPolicy.schemaVersion,
        primaryKey: [...recordPolicy.primaryKey],
        fields: recordPolicy.fields.map((field) => ({ ...field })),
      },
    },
  };
};

const buildFixture = async (): Promise<Fixture> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-raw-fs-"));
  roots.push(root);
  const startedMs = Date.now() - 1_000;

  let ordinal = 1;
  const files: Nhm2PrimaryRawOutputFileV1[] = [];
  for (const familyId of NHM2_PRIMARY_RAW_OUTPUT_FAMILY_IDS) {
    for (const [semanticRole, kind] of Object.entries(
      NHM2_PRIMARY_RAW_OUTPUT_SEMANTIC_ROLE_POLICIES[familyId],
    )) {
      const contentPolicy = (
        NHM2_PRIMARY_RAW_CONTENT_ROLE_POLICIES[familyId] as Record<
          string,
          Nhm2PrimaryRawRoleContentPolicyV1
        >
      )[semanticRole];
      if (contentPolicy == null)
        throw new Error(
          `fixture content policy missing: ${familyId}:${semanticRole}`,
        );
      files.push(
        await writeRawFile({
          root,
          familyId,
          semanticRole,
          kind,
          contentPolicy,
          ordinal: ordinal++,
        }),
      );
    }
  }
  files.sort((left, right) => utf8Compare(left.path, right.path));

  const requiredInputPaths: Record<string, string> = {
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.candidateManifest]:
      "inputs/candidate-manifest.json",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.selectedProfile]:
      "inputs/selected-profile.json",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.chartDefinition]:
      "inputs/chart-definition.json",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.atlas]:
      "inputs/layered-ledger-atlas.json",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.units]:
      "inputs/units-definition.json",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.normalization]:
      "inputs/normalization-definition.json",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.solver]:
      "toolchain/primary-solver.bin",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.environment]:
      "toolchain/environment-lock.json",
    [NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.producerBundle]:
      "toolchain/primary-producer-bundle.mjs",
  };
  const inputs = Object.entries(requiredInputPaths)
    .map(([inputId, inputPath]): Nhm2PrimaryRawOutputHashedInputV1 => ({
      inputId,
      path: inputPath,
      sha256: sha256(`input:${inputId}:${inputPath}`),
      sizeBytes: 64 + inputId.length,
      mediaType: inputPath.endsWith(".json")
        ? "application/json"
        : "application/octet-stream",
    }))
    .sort((left, right) => utf8Compare(left.path, right.path));
  const inputsById = new Map(inputs.map((entry) => [entry.inputId, entry]));
  const identity: Nhm2PrimaryRawOutputManifestV1["identity"] = {
    candidateId: "candidate-alpha-0.7",
    laneId: "nhm2_shift_lapse",
    selectedProfileId: "profile-alpha-0.7",
    chartId: "nhm2-cartesian",
    candidateManifest: bind(
      inputsById,
      NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.candidateManifest,
    ),
    selectedProfile: bind(
      inputsById,
      NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.selectedProfile,
    ),
    chartDefinition: bind(
      inputsById,
      NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.chartDefinition,
    ),
    atlas: bind(inputsById, NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.atlas),
    units: bind(inputsById, NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.units),
    normalization: bind(
      inputsById,
      NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.normalization,
    ),
  };
  const completedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const completedAt = new Date(completedMs).toISOString();
  const execution: Nhm2PrimaryRawOutputManifestV1["execution"] = {
    planRole: "primary_numerical",
    requestId: "primary-request-001",
    runId: "primary-run-001",
    runtimeId: "nhm2-primary-runtime",
    receiptId: "primary-receipt-001",
    sourceCommitSha: "a".repeat(40),
    solver: {
      solverId: "nhm2-primary-solver",
      solverVersion: "1.0.0",
      implementationId: "nhm2-primary-implementation",
      input: bind(
        inputsById,
        NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.solver,
      ),
    },
    environment: {
      environmentId: "nhm2-primary-environment",
      input: bind(
        inputsById,
        NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.environment,
      ),
    },
    producerBundle: {
      bundleId: "nhm2-primary-producer-bundle",
      input: bind(
        inputsById,
        NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS.producerBundle,
      ),
    },
    invocation: {
      command: "node",
      argv: [
        "toolchain/primary-producer-bundle.mjs",
        "--run",
        "primary-run-001",
      ],
      workingDirectory: ".",
    },
    startedAt,
    completedAt,
    durationMs: completedMs - startedMs,
    deterministicSeed: "nhm2-primary-seed-001",
    exitCode: 0,
    terminationSignal: null,
  };
  const inputClosure: Nhm2PrimaryRawOutputManifestV1["inputClosure"] = {
    frozenBeforeExecution: true,
    digestAlgorithm: NHM2_PRIMARY_RAW_OUTPUT_INPUT_CLOSURE_ALGORITHM,
    ordering: NHM2_PRIMARY_RAW_OUTPUT_INPUT_ORDERING,
    entries: inputs,
    closureSha256: computeNhm2PrimaryRawOutputInputClosureSha256(inputs),
  };
  const manifest: Nhm2PrimaryRawOutputManifestV1 = {
    artifactId: NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_ARTIFACT_ID,
    contractVersion: NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_CONTRACT_VERSION,
    contentPolicy: {
      artifactId: NHM2_PRIMARY_RAW_CONTENT_POLICY_ARTIFACT_ID,
      contractVersion: NHM2_PRIMARY_RAW_CONTENT_POLICY_CONTRACT_VERSION,
      sha256: NHM2_PRIMARY_RAW_CONTENT_POLICY_SHA256,
    },
    generatedAt: completedAt,
    identity,
    execution,
    inputClosure,
    familyDag: {
      ordering: NHM2_PRIMARY_RAW_OUTPUT_FAMILY_DAG_ORDERING,
      nodes: NHM2_PRIMARY_RAW_OUTPUT_FAMILY_IDS.map((familyId) => ({
        familyId,
        parentFamilyIds: [...NHM2_PRIMARY_RAW_OUTPUT_PARENT_FAMILIES[familyId]],
        semanticRoles: Object.keys(
          NHM2_PRIMARY_RAW_OUTPUT_SEMANTIC_ROLE_POLICIES[familyId],
        ),
        fileIds: files
          .filter((file) => file.familyId === familyId)
          .map((file) => file.fileId)
          .sort(utf8Compare),
      })),
    },
    fileInventory: {
      ordering: NHM2_PRIMARY_RAW_OUTPUT_FILE_ORDERING,
      files,
    },
    claimBoundary: {
      rawOutputEvidenceOnly: true,
      scientificEvaluationExternal: true,
      scientificConclusionEncoded: false,
      theoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedClaimAllowed: false,
      empiricalReceiptsRequired: true,
    },
  };
  const manifestPath = path.join(root, "primary-raw-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  return {
    root,
    manifestPath,
    manifest,
    trusted: {
      identity: clone(identity),
      execution: clone(execution),
      inputClosure: clone(inputClosure),
    },
  };
};

const rewriteManifest = async (
  fixture: Fixture,
  mutate: (manifest: Nhm2PrimaryRawOutputManifestV1) => void = () => undefined,
): Promise<void> => {
  mutate(fixture.manifest);
  await fs.writeFile(fixture.manifestPath, JSON.stringify(fixture.manifest));
};

const rewriteRawFile = async (
  fixture: Fixture,
  descriptor: Nhm2PrimaryRawOutputFileV1,
  bytes: Buffer,
): Promise<void> => {
  await fs.writeFile(path.join(fixture.root, descriptor.path), bytes);
  descriptor.sizeBytes = bytes.byteLength;
  descriptor.sha256 = sha256(bytes);
  await rewriteManifest(fixture);
};

const contentPolicyFor = (
  descriptor: Nhm2PrimaryRawOutputFileV1,
): Nhm2PrimaryRawRoleContentPolicyV1 => {
  const policy = (
    NHM2_PRIMARY_RAW_CONTENT_ROLE_POLICIES[descriptor.familyId] as Record<
      string,
      Nhm2PrimaryRawRoleContentPolicyV1
    >
  )[descriptor.semanticRole];
  if (policy == null)
    throw new Error(
      `fixture content policy missing: ${descriptor.familyId}:${descriptor.semanticRole}`,
    );
  return policy;
};

const codes = (
  result: Awaited<ReturnType<typeof verifyNhm2PrimaryRawOutputFilesystem>>,
): Nhm2PrimaryRawOutputFilesystemViolationCode[] =>
  result.violations.map((violation) => violation.code);

describe("NHM2 primary raw output filesystem verifier", () => {
  it("verifies an exact, fresh, run-bound raw inventory without producing physics conclusions", async () => {
    const fixture = await buildFixture();
    const result = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
    });

    expect(result.verified).toBe(true);
    if (!result.verified) throw new Error(JSON.stringify(result.violations));
    expect(result.files).toHaveLength(
      fixture.manifest.fileInventory.files.length,
    );
    expect(result.files.some((file) => file.kind === "numerical_array")).toBe(
      true,
    );
    expect(result.files.some((file) => file.kind === "records")).toBe(true);
    expect(Object.keys(result)).not.toContain("status");
    expect(Object.keys(result)).not.toContain("pass");
    expect(Object.keys(result)).not.toContain("ready");
  });

  it("requires exact trusted execution, source, invocation, and toolchain bindings", async () => {
    const fixture = await buildFixture();
    fixture.trusted.execution.sourceCommitSha = "b".repeat(40);
    fixture.trusted.execution.invocation.argv = ["different-bundle.mjs"];
    fixture.trusted.execution.solver.implementationId =
      "different-implementation";
    fixture.trusted.identity.candidateId = "different-candidate";
    fixture.trusted.inputClosure.entries[0].sha256 = "c".repeat(64);

    const result = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
    });
    expect(result.verified).toBe(false);
    expect(codes(result)).toContain("trusted_binding_mismatch");
    expect(
      result.violations.filter(
        (violation) => violation.code === "trusted_binding_mismatch",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "sourceCommitSha" }),
        expect.objectContaining({ field: "invocation" }),
        expect.objectContaining({ field: "solver" }),
        expect.objectContaining({ detail: "identity" }),
        expect.objectContaining({ detail: "inputClosure" }),
      ]),
    );

    const failedProcess = await buildFixture();
    failedProcess.trusted.execution.exitCode = 7;
    const rejectedFailure = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: failedProcess.root,
      manifestPath: failedProcess.manifestPath,
      trusted: failedProcess.trusted,
    });
    expect(codes(rejectedFailure)).toContain("trusted_execution_invalid");

    const malformedTrusted = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: failedProcess.root,
      manifestPath: failedProcess.manifestPath,
      trusted: {} as never,
    });
    expect(codes(malformedTrusted)).toContain("trusted_execution_invalid");
  });

  it("rejects extras, missing files, and bytes that do not match declared hashes", async () => {
    const fixture = await buildFixture();
    await fs.writeFile(path.join(fixture.root, "unexpected.bin"), "extra");
    const numerical = fixture.manifest.fileInventory.files.find(
      (file) => file.representation.kind === "numerical_array",
    );
    if (numerical == null) throw new Error("fixture numerical file missing");
    const numericalPath = path.join(fixture.root, numerical.path);
    const bytes = await fs.readFile(numericalPath);
    await fs.writeFile(
      numericalPath,
      Buffer.concat([bytes, Buffer.from([0xff])]),
    );
    const missing = fixture.manifest.fileInventory.files.at(-1);
    if (missing == null) throw new Error("fixture file missing");
    await fs.rm(path.join(fixture.root, missing.path));

    const result = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
    });
    expect(result.verified).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "filesystem_extra_file",
        "filesystem_missing_file",
        "file_size_mismatch",
        "file_sha256_mismatch",
        "numerical_byte_alignment_invalid",
      ]),
    );
  });

  it("rejects manifest path escapes, symbolic links, and hard-linked raw files", async () => {
    const escapeFixture = await buildFixture();
    const escaped = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: escapeFixture.root,
      manifestPath: path.join(escapeFixture.root, "..", "outside.json"),
      trusted: escapeFixture.trusted,
    });
    expect(codes(escaped)).toContain("manifest_path_escape");

    const hardlinkFixture = await buildFixture();
    const hardlinkDescriptor = hardlinkFixture.manifest.fileInventory.files[0];
    const hardlinkPath = path.join(
      hardlinkFixture.root,
      hardlinkDescriptor.path,
    );
    const hardlinkSource = path.join(
      path.dirname(hardlinkFixture.root),
      `nhm2-hardlink-source-${Date.now()}.bin`,
    );
    roots.push(hardlinkSource);
    await fs.copyFile(hardlinkPath, hardlinkSource);
    await fs.rm(hardlinkPath);
    await fs.link(hardlinkSource, hardlinkPath);
    const hardlinked = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: hardlinkFixture.root,
      manifestPath: hardlinkFixture.manifestPath,
      trusted: hardlinkFixture.trusted,
    });
    expect(codes(hardlinked)).toContain("filesystem_entry_hardlinked");

    const symlinkFixture = await buildFixture();
    const symlinkDescriptor = symlinkFixture.manifest.fileInventory.files[0];
    const symlinkPath = path.join(symlinkFixture.root, symlinkDescriptor.path);
    const symlinkSource = path.join(
      path.dirname(symlinkFixture.root),
      `nhm2-symlink-source-${Date.now()}.bin`,
    );
    roots.push(symlinkSource);
    await fs.copyFile(symlinkPath, symlinkSource);
    await fs.rm(symlinkPath);
    try {
      await fs.symlink(symlinkSource, symlinkPath, "file");
      const linked = await verifyNhm2PrimaryRawOutputFilesystem({
        runRoot: symlinkFixture.root,
        manifestPath: symlinkFixture.manifestPath,
        trusted: symlinkFixture.trusted,
      });
      expect(codes(linked)).toContain("filesystem_entry_symlink_or_reparse");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  });

  it("rejects non-finite raw float64 values even when their bytes are declared", async () => {
    const fixture = await buildFixture();
    const descriptor = fixture.manifest.fileInventory.files.find(
      (file) => file.representation.kind === "numerical_array",
    );
    if (descriptor == null) throw new Error("fixture numerical file missing");
    const bytes = await fs.readFile(path.join(fixture.root, descriptor.path));
    bytes.writeDoubleLE(Number.NaN, 0);
    await rewriteRawFile(fixture, descriptor, bytes);

    const result = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
    });
    expect(result.verified).toBe(false);
    expect(codes(result)).toContain("numerical_nonfinite");
  });

  it("enforces canonical NDJSON, exact record fields, canonical int64, and primary-key uniqueness", async () => {
    const fixture = await buildFixture();
    const descriptor = fixture.manifest.fileInventory.files.find((file) => {
      if (file.representation.kind !== "records") return false;
      const policy = contentPolicyFor(file);
      return policy.kind === "records" && policy.minimumRecordCount === 1;
    });
    if (descriptor == null || descriptor.representation.kind !== "records")
      throw new Error("fixture NDJSON file missing");
    const policy = contentPolicyFor(descriptor);
    if (policy.kind !== "records") throw new Error("fixture policy mismatch");
    const first = recordValue(policy, 777, 0);
    const second = recordValue(policy, 778, 1);
    for (const primaryKey of policy.primaryKey) {
      second[primaryKey] = first[primaryKey];
    }
    const bytes = Buffer.from(
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    );
    descriptor.representation.recordCount = 2;
    await rewriteRawFile(fixture, descriptor, bytes);

    const duplicate = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
    });
    expect(codes(duplicate)).toContain("record_primary_key_duplicate");

    const intFixture = await buildFixture();
    const intDescriptor = intFixture.manifest.fileInventory.files.find(
      (file) =>
        file.representation.kind === "records" &&
        file.representation.schema.fields.some(
          (field) => field.type === "int64",
        ),
    );
    if (
      intDescriptor == null ||
      intDescriptor.representation.kind !== "records"
    )
      throw new Error("fixture int64 record file missing");
    const intPolicy = contentPolicyFor(intDescriptor);
    if (intPolicy.kind !== "records")
      throw new Error("fixture policy mismatch");
    const intRecords = Array.from(
      { length: intDescriptor.representation.recordCount },
      (_, recordIndex) => recordValue(intPolicy, 888, recordIndex),
    );
    const intField = intPolicy.fields.find((field) => field.type === "int64");
    if (intField == null) throw new Error("fixture int64 field missing");
    intRecords[0][intField.name] = 777;
    await rewriteRawFile(
      intFixture,
      intDescriptor,
      Buffer.from(
        `${intRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
      ),
    );
    const ambiguousInteger = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: intFixture.root,
      manifestPath: intFixture.manifestPath,
      trusted: intFixture.trusted,
    });
    expect(codes(ambiguousInteger)).toContain("record_type_mismatch");

    const newlineFixture = await buildFixture();
    const newlineDescriptor = newlineFixture.manifest.fileInventory.files.find(
      (file) =>
        file.representation.kind === "records" &&
        file.representation.recordCount > 1,
    );
    if (
      newlineDescriptor == null ||
      newlineDescriptor.representation.kind !== "records"
    ) {
      throw new Error("fixture record file missing");
    }
    const newlinePolicy = contentPolicyFor(newlineDescriptor);
    if (newlinePolicy.kind !== "records")
      throw new Error("fixture policy mismatch");
    const newlineRecords = Array.from(
      { length: newlineDescriptor.representation.recordCount },
      (_, recordIndex) => recordValue(newlinePolicy, 999, recordIndex),
    );
    newlineRecords[0].undeclared = 1;
    await rewriteRawFile(
      newlineFixture,
      newlineDescriptor,
      Buffer.from(
        `${newlineRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
      ),
    );
    const undeclaredField = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: newlineFixture.root,
      manifestPath: newlineFixture.manifestPath,
      trusted: newlineFixture.trusted,
    });
    expect(codes(undeclaredField)).toContain("record_schema_fields_mismatch");

    await rewriteRawFile(
      newlineFixture,
      newlineDescriptor,
      Buffer.from(`${JSON.stringify(recordValue(newlinePolicy, 1_000, 0))}\n`),
    );
    const wrongCount = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: newlineFixture.root,
      manifestPath: newlineFixture.manifestPath,
      trusted: newlineFixture.trusted,
    });
    expect(codes(wrongCount)).toContain("record_count_mismatch");

    await rewriteRawFile(
      newlineFixture,
      newlineDescriptor,
      Buffer.from(` ${JSON.stringify(newlineRecords[0])}\r\n`),
    );
    const malformed = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: newlineFixture.root,
      manifestPath: newlineFixture.manifestPath,
      trusted: newlineFixture.trusted,
    });
    expect(codes(malformed)).toContain("record_newline_invalid");
  });

  it("rejects UTF-8 BOMs and stale output timestamps", async () => {
    const fixture = await buildFixture();
    const descriptor = fixture.manifest.fileInventory.files.find(
      (file) => file.representation.kind === "records",
    );
    if (descriptor == null) throw new Error("fixture record file missing");
    const absolutePath = path.join(fixture.root, descriptor.path);
    const original = await fs.readFile(absolutePath);
    await rewriteRawFile(
      fixture,
      descriptor,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]),
    );
    const stale = new Date(
      Date.parse(fixture.trusted.execution.startedAt) - 60_000,
    );
    await fs.utimes(absolutePath, stale, stale);

    const result = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
    });
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "record_bom_forbidden",
        "filesystem_freshness_outside_interval",
      ]),
    );
  });

  it("bounds filesystem timestamp tolerance instead of allowing provenance to be disabled", async () => {
    const fixture = await buildFixture();
    const result = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
      freshnessToleranceMs: 60_000,
    });
    expect(result.verified).toBe(false);
    expect(codes(result)).toContain("verifier_input_invalid");
  });

  it("bounds manifest-declared and configured in-memory resource use", async () => {
    const fixture = await buildFixture();
    const largestFileBytes = Math.max(
      ...fixture.manifest.fileInventory.files.map((file) => file.sizeBytes),
    );
    const totalBytes = fixture.manifest.fileInventory.files.reduce(
      (sum, file) => sum + file.sizeBytes,
      0,
    );

    const fileLimited = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
      maxFileBytes: largestFileBytes - 1,
    });
    expect(codes(fileLimited)).toContain("filesystem_resource_limit_exceeded");

    const totalLimited = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
      maxTotalBytes: totalBytes - 1,
    });
    expect(codes(totalLimited)).toContain("filesystem_resource_limit_exceeded");

    const invalidFileLimit = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
      maxFileBytes: NHM2_PRIMARY_RAW_OUTPUT_HARD_MAX_FILE_BYTES + 1,
    });
    expect(codes(invalidFileLimit)).toContain("verifier_input_invalid");

    const invalidTotalLimit = await verifyNhm2PrimaryRawOutputFilesystem({
      runRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      trusted: fixture.trusted,
      maxTotalBytes: NHM2_PRIMARY_RAW_OUTPUT_HARD_MAX_TOTAL_BYTES + 1,
    });
    expect(codes(invalidTotalLimit)).toContain("verifier_input_invalid");
  });
});
