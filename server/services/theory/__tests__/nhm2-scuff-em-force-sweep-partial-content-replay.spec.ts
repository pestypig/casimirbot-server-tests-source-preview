import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeNhm2ExternalNumericalKernelLedgerSha256,
  computeNhm2ExternalNumericalKernelStagingIdentitySha256,
  NHM2_EXTERNAL_NUMERICAL_KERNEL_OBSERVATION_VERSION,
  type Nhm2ExternalNumericalKernelLedgerEntryV1,
  type Nhm2ExternalNumericalKernelLedgerObservationV1,
  type Nhm2ExternalNumericalKernelObservationV1,
  type Nhm2ExternalNumericalKernelOutputObservationV1,
  type Nhm2ExternalNumericalKernelSealedLedgerV1,
} from "../nhm2-external-numerical-kernel-executor";
import {
  computeNhm2ScuffEmExecutorReceiptObservationSha256,
  computeNhm2ScuffEmExecutorReceiptPlanSha256,
  computeNhm2ScuffEmFullSourceLedgerSha256,
  installNhm2ScuffEmServerReceiptResolver,
  NHM2_SCUFF_EM_EXECUTOR_RECEIPT_VERSION,
  NHM2_SCUFF_EM_SOURCE_TO_BINARY_PROVENANCE_VERSION,
  type Nhm2ScuffEmPersistedExecutorReceiptV1,
  type Nhm2ScuffEmServerReceiptResolutionV1,
} from "../nhm2-scuff-em-executor-receipt-admission";
import {
  buildNhm2ScuffEmForceSweepExternalPlan,
  NHM2_SCUFF_EM_COMMIT_SHA,
  NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS,
  NHM2_SCUFF_EM_FORCE_SWEEP_INPUT_VERSION,
  NHM2_SCUFF_EM_GIT_TRACKED_ENTRY_COUNT,
  NHM2_SCUFF_EM_GIT_TREE_OBJECT_ID,
  NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY,
  NHM2_SCUFF_EM_REPOSITORY,
  NHM2_SCUFF_EM_VERSION,
  serializeNhm2ScuffEmForceSweepInput,
  serializeNhm2ScuffEmForceSweepTransformations,
  type Nhm2ScuffEmForceSweepExternalPlanV1,
  type Nhm2ScuffEmForceSweepInputV1,
} from "../nhm2-scuff-em-force-sweep-external-plan";
import {
  NHM2_SCUFF_EM_FORCE_SWEEP_PARTIAL_REPLAY_BLOCKERS,
  NHM2_SCUFF_EM_PINNED_MATSUBARA_SEQUENCE,
  Nhm2ScuffEmForceSweepPartialReplayError,
  replayNhm2ScuffEmForceSweepPartialContent,
} from "../nhm2-scuff-em-force-sweep-partial-content-replay";

const temporaryRoots: string[] = [];
const receiptResolutions = new Map<
  string,
  Nhm2ScuffEmServerReceiptResolutionV1
>();
let disposeReceiptResolver: (() => void) | null = null;

afterEach(async () => {
  disposeReceiptResolver?.();
  disposeReceiptResolver = null;
  receiptResolutions.clear();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((entry) =>
        fs.rm(entry, { recursive: true, force: true }).catch(() => undefined),
      ),
  );
});

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const utf8Compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const makeLedger = (
  rootPath: string,
  kind: "input" | "toolchain",
  entries: Nhm2ExternalNumericalKernelLedgerEntryV1[],
): Nhm2ExternalNumericalKernelSealedLedgerV1 => {
  const sorted = entries
    .map((entry) => ({ ...entry }))
    .sort((left, right) => utf8Compare(left.relativePath, right.relativePath));
  return {
    kind,
    rootPath,
    entries: sorted,
    ledgerSha256: computeNhm2ExternalNumericalKernelLedgerSha256({
      kind,
      entries: sorted,
    }),
  };
};

const makeInput = (
  temperatureKelvin = 293.15,
): Nhm2ScuffEmForceSweepInputV1 => {
  const input: Nhm2ScuffEmForceSweepInputV1 = {
    artifactId: "nhm2.scuff_em_force_sweep_input",
    contractVersion: NHM2_SCUFF_EM_FORCE_SWEEP_INPUT_VERSION,
    package: {
      name: "scuff-em",
      repository: NHM2_SCUFF_EM_REPOSITORY,
      commitSha: NHM2_SCUFF_EM_COMMIT_SHA,
      version: NHM2_SCUFF_EM_VERSION,
      executableName: "scuff-cas3D",
      noPublishedReleaseAtPin: true,
      harnessOnly: false,
    },
    geometry: {
      authority: "finite_compact_cad_bem",
      compactGeometry: true,
      periodicGeometry: false,
      lengthUnitMeters: 1e-9,
      baseGapMeters: 8e-9,
      movingObjectLabel: "MOVING_TILE",
      forceAxis: "z",
      geometryFile: {
        relativePath: "geometry/nhm2-tile.scuffgeo",
        sha256: "1".repeat(64),
        sizeBytes: 4_096,
      },
      transformationFile: {
        relativePath: "geometry/gap-sweep.trans",
        sha256: "0".repeat(64),
        sizeBytes: 1,
      },
      dependencies: [
        {
          kind: "material_measurement_receipt",
          relativePath: "materials/gold-measurement-receipt.json",
          sha256: "2".repeat(64),
          sizeBytes: 2_048,
        },
        {
          kind: "material_model",
          relativePath: "materials/gold.scuffmaterial",
          sha256: "3".repeat(64),
          sizeBytes: 1_024,
        },
        {
          kind: "mesh",
          relativePath: "mesh/nhm2-tile.msh",
          sha256: "4".repeat(64),
          sizeBytes: 65_536,
        },
        {
          kind: "mesh_generation_receipt",
          relativePath: "receipts/mesh-generation.json",
          sha256: "5".repeat(64),
          sizeBytes: 2_048,
        },
      ],
      sweep: [6e-9, 7e-9, 8e-9, 9e-9, 10e-9].map((separationMeters, index) => ({
        label: `gap_${index.toString().padStart(3, "0")}`,
        separationMeters,
      })),
    },
    thermodynamics: {
      ensemble: "thermal_equilibrium",
      summation: "matsubara",
      temperatureKelvin,
    },
    numerics: {
      absoluteTolerance: 0,
      relativeTolerance: 1e-6,
    },
    requestedQuantities: ["energy", "z_force"],
  };
  const transformations = Buffer.from(
    serializeNhm2ScuffEmForceSweepTransformations(input),
    "utf8",
  );
  input.geometry.transformationFile.sha256 = sha256(transformations);
  input.geometry.transformationFile.sizeBytes = transformations.byteLength;
  return input;
};

const makePlan = (
  fixtureRoot: string,
  temperatureKelvin = 293.15,
): Nhm2ScuffEmForceSweepExternalPlanV1 => {
  const toolchainRoot = path.join(fixtureRoot, "toolchain");
  const inputRoot = path.join(fixtureRoot, "input");
  const outputRoot = path.join(fixtureRoot, "output");
  const executableRelativePath = "bin/scuff-cas3D.exe";
  const input = makeInput(temperatureKelvin);
  const manifestRelativePath = "nhm2-scuff-force-sweep-input.json";
  const manifestBytes = Buffer.from(
    serializeNhm2ScuffEmForceSweepInput(input),
    "utf8",
  );
  return buildNhm2ScuffEmForceSweepExternalPlan({
    input,
    inputManifestRelativePath: manifestRelativePath,
    executable: {
      absolutePath: path.join(
        toolchainRoot,
        ...executableRelativePath.split("/"),
      ),
      sha256: "a".repeat(64),
      sizeBytes: 1_048_576,
    },
    toolchainLedger: makeLedger(toolchainRoot, "toolchain", [
      {
        relativePath: executableRelativePath,
        sha256: "a".repeat(64),
        sizeBytes: 1_048_576,
      },
      {
        relativePath: "build-tools/build-driver.exe",
        sha256: "b".repeat(64),
        sizeBytes: 32_768,
      },
      {
        relativePath: "build-tools/compiler.exe",
        sha256: "c".repeat(64),
        sizeBytes: 65_536,
      },
      {
        relativePath: "build-tools/linker.exe",
        sha256: "d".repeat(64),
        sizeBytes: 65_536,
      },
      {
        relativePath: "provenance/scuff-cas3D-build-receipt.v1.json",
        sha256: "e".repeat(64),
        sizeBytes: 4_096,
      },
      {
        relativePath: "provenance/scuff-source-tree-verification.v1.json",
        sha256: "f".repeat(64),
        sizeBytes: 8_192,
      },
      ...NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS.map((binding) => ({
        relativePath: `source/${binding.suffix}`,
        sha256: binding.sha256,
        sizeBytes: binding.sizeBytes,
      })),
      ...Array.from(
        {
          length:
            NHM2_SCUFF_EM_GIT_TRACKED_ENTRY_COUNT -
            NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS.length,
        },
        (_, index) => {
          const relativePath = `source/upstream-ledger-fixture/file-${index
            .toString()
            .padStart(4, "0")}`;
          return {
            relativePath,
            sha256: sha256(relativePath),
            sizeBytes: 1,
          };
        },
      ),
    ]),
    inputLedger: makeLedger(inputRoot, "input", [
      { ...input.geometry.geometryFile },
      { ...input.geometry.transformationFile },
      ...input.geometry.dependencies.map(
        ({ relativePath, sha256: digest, sizeBytes }) => ({
          relativePath,
          sha256: digest,
          sizeBytes,
        }),
      ),
      {
        relativePath: manifestRelativePath,
        sha256: sha256(manifestBytes),
        sizeBytes: manifestBytes.byteLength,
      },
    ]),
    outputRoot,
  });
};

const officialOutFixture = (
  plan: Nhm2ScuffEmForceSweepExternalPlanV1,
): string => {
  const rows = plan.input.geometry.sweep.map(
    (entry, index) =>
      `${entry.label} ${(-0.01 * (index + 1)).toExponential(6)} ${(1e-7 * (index + 1)).toExponential(6)} ${(-10 + 1.5 * index).toExponential(6)} ${(0.01 * (index + 1)).toExponential(6)} `,
  );
  return [
    "# scuff-cas3D run on fixture at 07/19/26::12:00:00",
    "# data file columns: ",
    "#1: transform tag",
    "#2: energy ",
    "#3: energy error due to numerical Xi integration ",
    "#4: z-force ",
    "#5: z-force error due to numerical Xi integration ",
    ...rows,
    "",
  ].join("\n");
};

const officialByXiFixture = (
  plan: Nhm2ScuffEmForceSweepExternalPlanV1,
): string => {
  const step =
    2 * Math.PI * 4.36763e-4 * plan.input.thermodynamics.temperatureKelvin;
  const frequencies = [0.001, step, 2 * step];
  const rows = frequencies.flatMap((frequency, block) =>
    plan.input.geometry.sweep.map(
      (entry, index) =>
        `${entry.label} ${frequency.toExponential(6)} ${(-0.001 * (block + 1) * (index + 1)).toExponential(8)} ${(-0.01 * (block + 1) * (index + 1)).toExponential(8)} `,
    ),
  );
  return [
    "# scuff-cas3D run on fixture at 07/19/26::12:00:00",
    "# data file columns: ",
    "#1: transform tag",
    "#2: imaginary angular frequency",
    "#3: energy Xi integrand",
    "#4: z-force Xi integrand",
    ...rows,
    "",
  ].join("\n");
};

const resolveArgs = (plan: Nhm2ScuffEmForceSweepExternalPlanV1): string[] =>
  plan.runSpec.arguments.map((argument) => {
    switch (argument.kind) {
      case "literal":
        return argument.value;
      case "input_path":
        return path.join(
          plan.runSpec.ledgers.input.rootPath,
          ...argument.relativePath.split("/"),
        );
      case "output_path":
        return path.join(
          plan.runSpec.outputRoot,
          ...argument.relativePath.split("/"),
        );
      case "output_root":
        return plan.runSpec.outputRoot;
    }
  });

const observeLedger = (
  ledger: Nhm2ExternalNumericalKernelSealedLedgerV1,
  observedAt: string,
): Nhm2ExternalNumericalKernelLedgerObservationV1 => ({
  kind: ledger.kind,
  observedAt,
  ledgerSha256: ledger.ledgerSha256,
  entryCount: ledger.entries.length,
  aggregateBytes: ledger.entries.reduce(
    (total, entry) => total + entry.sizeBytes,
    0,
  ),
  entries: ledger.entries.map((entry) => ({ ...entry })),
});

const outputInventorySha256 = (
  outputs: readonly Nhm2ExternalNumericalKernelOutputObservationV1[],
): string =>
  sha256(
    JSON.stringify({
      domain: "nhm2_external_numerical_kernel_output_inventory/v1",
      outputs: outputs.map(({ role, relativePath, sha256, sizeBytes }) => ({
        role,
        relativePath,
        sha256,
        sizeBytes,
      })),
    }),
  );

type Fixture = {
  root: string;
  plan: Nhm2ScuffEmForceSweepExternalPlanV1;
  observation: Nhm2ExternalNumericalKernelObservationV1;
  fileTime: Date;
};

const buildFixture = async (temperatureKelvin = 293.15): Promise<Fixture> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-scuff-replay-"));
  temporaryRoots.push(root);
  const plan = makePlan(root, temperatureKelvin);
  await fs.mkdir(plan.runSpec.outputRoot, { recursive: true });
  const contents = new Map<string, string>([
    ["scuff-run.out", officialOutFixture(plan)],
    ["scuff-run.byXi", officialByXiFixture(plan)],
    [
      "scuff-cas3D.log",
      "Beginning Matsubara sum at T=293.15 kelvin...\nMatsubara sum converged.\n",
    ],
  ]);
  const now = Date.now();
  const startedAtMs = now - 30_000;
  const fileTime = new Date(now - 20_000);
  const completedAtMs = now - 10_000;
  for (const [relativePath, content] of contents) {
    const absolutePath = path.join(plan.runSpec.outputRoot, relativePath);
    await fs.writeFile(absolutePath, content, "utf8");
    await fs.utimes(absolutePath, fileTime, fileTime);
  }
  const outputs: Nhm2ExternalNumericalKernelOutputObservationV1[] = [];
  for (const expected of [...plan.runSpec.expectedOutputs].sort((left, right) =>
    utf8Compare(left.role, right.role),
  )) {
    const absolutePath = path.join(
      plan.runSpec.outputRoot,
      expected.relativePath,
    );
    const bytes = await fs.readFile(absolutePath);
    const stat = await fs.lstat(absolutePath);
    outputs.push({
      role: expected.role,
      relativePath: expected.relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      modifiedAt: stat.mtime.toISOString(),
      freshness: "new",
    });
  }
  const preAt = new Date(startedAtMs - 1_000).toISOString();
  const postAt = new Date(completedAtMs + 1_000).toISOString();
  const stdout = "Thank you for your support.\n";
  const stderr = "";
  const stagedRoot = path.join(
    os.tmpdir(),
    `nhm2-external-toolchain-${path.basename(root)}`,
  );
  const executableRelativePath = path
    .relative(
      plan.runSpec.ledgers.toolchain.rootPath,
      plan.runSpec.executable.absolutePath,
    )
    .split(path.sep)
    .join("/");
  const stagedExecutablePath = path.join(
    stagedRoot,
    ...executableRelativePath.split("/"),
  );
  const stagedPreLedger = observeLedger(plan.runSpec.ledgers.toolchain, preAt);
  const stagedPostLedger = observeLedger(
    plan.runSpec.ledgers.toolchain,
    postAt,
  );
  const stagingIdentitySha256 =
    computeNhm2ExternalNumericalKernelStagingIdentitySha256({
      rootPath: stagedRoot,
      executableRelativePath,
      executablePath: stagedExecutablePath,
      sourceLedgerSha256: plan.runSpec.ledgers.toolchain.ledgerSha256,
      stagedLedger: stagedPreLedger,
    });
  const observation: Nhm2ExternalNumericalKernelObservationV1 = {
    artifactId: "nhm2.external_numerical_kernel_observation",
    contractVersion: NHM2_EXTERNAL_NUMERICAL_KERNEL_OBSERVATION_VERSION,
    generatedAt: new Date(completedAtMs + 2_000).toISOString(),
    status: "execution_observed_scientific_replay_required",
    lane: plan.runSpec.lane,
    solver: { ...plan.runSpec.solver },
    executable: { ...plan.runSpec.executable },
    runOwnedToolchain: {
      authority: "executor_created_fresh_copy",
      stagingIdentitySha256,
      rootPath: stagedRoot,
      executableRelativePath,
      executablePath: stagedExecutablePath,
      sourceLedgerSha256: plan.runSpec.ledgers.toolchain.ledgerSha256,
      preSpawnLedger: stagedPreLedger,
      postRunLedger: stagedPostLedger,
      permissions: {
        policy: "owner_read_execute_only_best_effort/v1",
        executableMode: "0500",
        executableAuxiliaryMode: "0500",
        dataFileMode: "0400",
        directoryMode: "0500",
        osLevelImmutabilityAsserted: false,
      },
      removedAfterExecution: true,
    },
    preRunLedgers: {
      input: observeLedger(plan.runSpec.ledgers.input, preAt),
      toolchain: observeLedger(plan.runSpec.ledgers.toolchain, preAt),
    },
    process: {
      command: stagedExecutablePath,
      args: resolveArgs(plan),
      cwd: plan.runSpec.outputRoot,
      environment: { ...plan.runSpec.environment },
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - startedAtMs,
      exitCode: 0,
      signal: null,
      stdout,
      stderr,
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(stderr),
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: Buffer.byteLength(stderr),
      timedOut: false,
      outputLimitExceeded: false,
      spawnError: null,
    },
    outputs,
    outputInventorySha256: outputInventorySha256(outputs),
    postRunLedgers: {
      input: observeLedger(plan.runSpec.ledgers.input, postAt),
      toolchain: observeLedger(plan.runSpec.ledgers.toolchain, postAt),
    },
    blockers: [
      "independent_scientific_content_replay_required",
      "same_user_staged_toolchain_mutation_exclusion_not_os_enforced",
    ],
    claimBoundary: {
      externalBinaryExecutionObserved: true,
      solverOutputScientificallyValidated: false,
      theoryClosureClaimAllowed: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
      operatingSystemHermeticityAsserted: false,
      networkIsolationAsserted: false,
      filesystemSandboxAsserted: false,
    },
  };
  return { root, plan, observation, fileTime };
};

const ledgerEntry = (
  plan: Nhm2ScuffEmForceSweepExternalPlanV1,
  relativePath: string,
): Nhm2ExternalNumericalKernelLedgerEntryV1 => {
  const entry = plan.runSpec.ledgers.toolchain.entries.find(
    (candidate) => candidate.relativePath === relativePath,
  );
  if (entry == null) throw new Error(`Missing toolchain entry ${relativePath}`);
  return { ...entry };
};

const persistServerOwnedReceipt = async (
  fixture: Fixture,
  mutateReceipt?: (receipt: Nhm2ScuffEmPersistedExecutorReceiptV1) => void,
): Promise<string> => {
  if (disposeReceiptResolver == null) {
    disposeReceiptResolver = installNhm2ScuffEmServerReceiptResolver(
      ({ receiptId }) => receiptResolutions.get(receiptId) ?? null,
    );
  }
  const receiptId = `scuff-${path.basename(fixture.root)}`;
  const sourceEntries = fixture.plan.runSpec.ledgers.toolchain.entries.filter(
    (entry) => entry.relativePath.startsWith("source/"),
  );
  const receipt: Nhm2ScuffEmPersistedExecutorReceiptV1 = {
    artifactId: "nhm2.scuff_em_executor_receipt",
    contractVersion: NHM2_SCUFF_EM_EXECUTOR_RECEIPT_VERSION,
    receiptId,
    persistedAt: new Date(
      Date.parse(fixture.observation.generatedAt) + 1_000,
    ).toISOString(),
    planSha256: computeNhm2ScuffEmExecutorReceiptPlanSha256(fixture.plan),
    observationSha256: computeNhm2ScuffEmExecutorReceiptObservationSha256(
      fixture.observation,
    ),
    plan: fixture.plan,
    observation: fixture.observation,
    sourceToBinaryProvenance: {
      artifactId: "nhm2.scuff_em_source_to_binary_provenance",
      contractVersion: NHM2_SCUFF_EM_SOURCE_TO_BINARY_PROVENANCE_VERSION,
      officialBinaryArtifactPublishedAtPin: false,
      fullSourceLedger: {
        authority: "complete_declared_scuff_build_source_tree",
        rootPrefix: "source/",
        gitTreeObjectId: NHM2_SCUFF_EM_GIT_TREE_OBJECT_ID,
        gitTrackedEntryCount: NHM2_SCUFF_EM_GIT_TRACKED_ENTRY_COUNT,
        gitTreeVerificationReceiptBinding: ledgerEntry(
          fixture.plan,
          "provenance/scuff-source-tree-verification.v1.json",
        ),
        ledgerSha256: computeNhm2ScuffEmFullSourceLedgerSha256(sourceEntries),
        entryCount: sourceEntries.length,
        aggregateBytes: sourceEntries.reduce(
          (total, entry) => total + entry.sizeBytes,
          0,
        ),
        entries: sourceEntries.map((entry) => ({ ...entry })),
      },
      reproducibleBuildReceipt: {
        authority: "server_persisted_rebuild_twice_byte_identical",
        receiptBinding: ledgerEntry(
          fixture.plan,
          "provenance/scuff-cas3D-build-receipt.v1.json",
        ),
        compilerExecutableBinding: ledgerEntry(
          fixture.plan,
          "build-tools/compiler.exe",
        ),
        linkerExecutableBinding: ledgerEntry(
          fixture.plan,
          "build-tools/linker.exe",
        ),
        buildDriverExecutableBinding: ledgerEntry(
          fixture.plan,
          "build-tools/build-driver.exe",
        ),
        compilerInvocationSha256: "6".repeat(64),
        linkerInvocationSha256: "7".repeat(64),
        environmentSha256: "8".repeat(64),
        firstBuildExecutableSha256: fixture.plan.runSpec.executable.sha256,
        secondBuildExecutableSha256: fixture.plan.runSpec.executable.sha256,
        runExecutable: { ...fixture.plan.runSpec.executable },
        byteIdenticalRebuilds: true,
      },
      sourceToBinaryProvenanceEstablished: true,
    },
    claimBoundary: {
      serverOwnedImmutableReceiptRequired: true,
      callerSuppliedPlanAccepted: false,
      callerSuppliedObservationAccepted: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    },
  };
  mutateReceipt?.(receipt);
  const receiptRoot = path.join(fixture.root, "server-owned-receipts");
  const receiptRelativePath = `${receiptId}.v1.json`;
  const receiptPath = path.join(receiptRoot, receiptRelativePath);
  const bytes = Buffer.from(JSON.stringify(receipt), "utf8");
  await fs.mkdir(receiptRoot, { recursive: true });
  await fs.writeFile(receiptPath, bytes, { flag: "wx", mode: 0o600 });
  receiptResolutions.set(receiptId, {
    receiptStoreRoot: receiptRoot,
    receiptRelativePath,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  });
  return receiptId;
};

const replayFixture = async (
  fixture: Fixture,
  afterContentReplayForTesting?: () => void | Promise<void>,
) =>
  replayNhm2ScuffEmForceSweepPartialContent({
    receiptId: await persistServerOwnedReceipt(fixture),
    ...(afterContentReplayForTesting == null
      ? {}
      : { afterContentReplayForTesting }),
  });

const rewriteObservedOutput = async (
  fixture: Fixture,
  role: string,
  content: string,
): Promise<void> => {
  const output = fixture.observation.outputs.find(
    (entry) => entry.role === role,
  );
  if (output == null) throw new Error(`Missing output role ${role}`);
  const absolutePath = path.join(
    fixture.plan.runSpec.outputRoot,
    output.relativePath,
  );
  await fs.writeFile(absolutePath, content, "utf8");
  await fs.utimes(absolutePath, fixture.fileTime, fixture.fileTime);
  const bytes = await fs.readFile(absolutePath);
  const stat = await fs.lstat(absolutePath);
  output.sha256 = sha256(bytes);
  output.sizeBytes = bytes.byteLength;
  output.modifiedAt = stat.mtime.toISOString();
  fixture.observation.outputInventorySha256 = outputInventorySha256(
    fixture.observation.outputs,
  );
};

const expectFailure = async (
  callback: () => Promise<unknown>,
  code: string,
): Promise<void> => {
  try {
    await callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2ScuffEmForceSweepPartialReplayError);
    expect((error as Nhm2ScuffEmForceSweepPartialReplayError).code).toBe(code);
    return;
  }
  throw new Error(`Expected replay failure ${code}.`);
};

describe("NHM2 pinned SCUFF-EM partial scientific-content replay", () => {
  it("returns typed not-ready without server receipt authority and rejects caller-fabricated observations", async () => {
    await expect(
      replayNhm2ScuffEmForceSweepPartialContent({ receiptId: "missing-run" }),
    ).resolves.toMatchObject({
      status: "not_ready",
      blocker: "server_owned_executor_receipt_not_configured",
      claimBoundary: {
        externalBinaryExecutionObserved: false,
        sourceToBinaryProvenanceEstablished: false,
        physicalViabilityClaimAllowed: false,
      },
    });

    const fixture = await buildFixture();
    await expectFailure(
      () =>
        replayNhm2ScuffEmForceSweepPartialContent({
          receiptId: "fabricated-run",
          plan: fixture.plan,
          observation: fixture.observation,
        } as never),
      "caller_supplied_execution_binding_forbidden",
    );
  });

  it("fails closed on forged build provenance and staged-toolchain identity", async () => {
    const provenanceFixture = await buildFixture();
    const forgedReceiptId = await persistServerOwnedReceipt(
      provenanceFixture,
      (receipt) => {
        receipt.sourceToBinaryProvenance.reproducibleBuildReceipt.secondBuildExecutableSha256 =
          "9".repeat(64);
      },
    );
    await expect(
      replayNhm2ScuffEmForceSweepPartialContent({
        receiptId: forgedReceiptId,
      }),
    ).resolves.toMatchObject({
      status: "not_ready",
      blocker: "server_owned_executor_receipt_invalid",
      claimBoundary: {
        externalBinaryExecutionObserved: false,
        sourceToBinaryProvenanceEstablished: false,
      },
    });

    const stagingFixture = await buildFixture();
    stagingFixture.observation.runOwnedToolchain.stagingIdentitySha256 =
      "f".repeat(64);
    await expectFailure(
      () => replayFixture(stagingFixture),
      "run_owned_toolchain_binding_invalid",
    );
  });

  it("replays official-format Energy/ZForce and Matsubara tables without promoting SI or viability authority", async () => {
    const fixture = await buildFixture();
    const artifact = await replayFixture(fixture);

    expect(artifact.status).not.toBe("not_ready");
    if (artifact.status === "not_ready") throw new Error(artifact.blocker);

    expect(artifact.status).toBe("partial_raw_scuff_content_replayed_blocked");
    expect(artifact.sourceBinding).toMatchObject({
      commitSha: NHM2_SCUFF_EM_COMMIT_SHA,
      version: NHM2_SCUFF_EM_VERSION,
      toolchainLedgerSha256:
        fixture.plan.runSpec.ledgers.toolchain.ledgerSha256,
      inputLedgerSha256: fixture.plan.runSpec.ledgers.input.ledgerSha256,
      serverExecutorReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(artifact.executionBinding).toMatchObject({
      runOwnedToolchainStagingIdentitySha256:
        fixture.observation.runOwnedToolchain.stagingIdentitySha256,
      runOwnedToolchainSourceLedgerSha256:
        fixture.plan.runSpec.ledgers.toolchain.ledgerSha256,
      stagedExecutableSha256: fixture.plan.runSpec.executable.sha256,
      externalBinaryExecutionObserved: true,
    });
    expect(artifact.sourceToBinaryProvenance).toMatchObject({
      officialBinaryArtifactPublishedAtPin: false,
      gitTreeObjectId: NHM2_SCUFF_EM_GIT_TREE_OBJECT_ID,
      gitTrackedEntryCount: NHM2_SCUFF_EM_GIT_TRACKED_ENTRY_COUNT,
      gitTreeVerificationReceiptSha256: "f".repeat(64),
      fullSourceEntryCount: NHM2_SCUFF_EM_GIT_TRACKED_ENTRY_COUNT,
      firstBuildExecutableSha256: fixture.plan.runSpec.executable.sha256,
      secondBuildExecutableSha256: fixture.plan.runSpec.executable.sha256,
      runExecutableSha256: fixture.plan.runSpec.executable.sha256,
      byteIdenticalRebuilds: true,
      sourceToBinaryProvenanceEstablished: true,
    });
    expect(artifact.files).toHaveLength(3);
    expect(artifact.files.every((entry) => entry.freshness === "new")).toBe(
      true,
    );
    expect(artifact.integratedSweep.rows.map((entry) => entry.label)).toEqual(
      fixture.plan.input.geometry.sweep.map((entry) => entry.label),
    );
    expect(artifact.matsubaraSpectrum).toMatchObject({
      rowCount: 15,
      frequencyBlockCount: 3,
      transformationCountPerBlock: 5,
      firstFrequencyUsesPinnedXiminProxy: true,
      pinnedXiminRawScuff: 0.001,
      subsequentPinnedMatsubaraSequenceVerified: true,
      allDeclaredIntegrandValuesFinite: true,
      solverLogUsedForScientificAuthority: false,
      sequenceReplay: {
        ...NHM2_SCUFF_EM_PINNED_MATSUBARA_SEQUENCE,
        sourceFileSha256: NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS.find((entry) =>
          entry.suffix.endsWith("/SumsIntegrals.cc"),
        )?.sha256,
        temperatureKelvinFromFrozenInput: 293.15,
      },
    });
    expect(artifact.rawCentralDifferences).toHaveLength(3);
    expect(artifact.rawCentralDifferences[0]).toMatchObject({
      centerLabel: "gap_001",
      leftLabel: "gap_000",
      rightLabel: "gap_002",
      propagationMethod:
        "sum_of_reported_absolute_integration_errors_over_central_span",
      reportedErrorConfidenceLevelEstablished: false,
    });
    expect(artifact.blockers).toEqual(
      NHM2_SCUFF_EM_FORCE_SWEEP_PARTIAL_REPLAY_BLOCKERS,
    );
    expect(artifact.blockers).toContain(
      "same_user_staged_toolchain_mutation_exclusion_not_os_enforced",
    );
    expect(artifact.claimBoundary).toMatchObject({
      diagnosticPartialReplayOnly: true,
      siUnitConversionEstablished: false,
      localMaxwellStressTractionFieldEstablished: false,
      meshConvergenceEstablished: false,
      materialMeasurementCorrespondenceEstablished: false,
      independentScientificReplayEstablished: false,
      theoryClosureClaimAllowed: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
  });

  it.each([
    {
      name: "reordered output header",
      mutate: (text: string) =>
        text.replace(
          "#2: energy \n#3: energy error due to numerical Xi integration ",
          "#3: energy error due to numerical Xi integration \n#2: energy ",
        ),
      code: "output_header_invalid",
    },
    {
      name: "duplicate transformation row",
      mutate: (text: string) => text.replace("gap_001 ", "gap_000 "),
      code: "integrated_sweep_label_mismatch",
    },
    {
      name: "missing transformation row",
      mutate: (text: string) =>
        text
          .split("\n")
          .filter((line) => !line.startsWith("gap_004 "))
          .join("\n"),
      code: "integrated_sweep_label_mismatch",
    },
    {
      name: "reordered transformation rows",
      mutate: (text: string) => {
        const lines = text.split("\n");
        const first = lines.findIndex((line) => line.startsWith("gap_001 "));
        const second = lines.findIndex((line) => line.startsWith("gap_002 "));
        [lines[first], lines[second]] = [lines[second], lines[first]];
        return lines.join("\n");
      },
      code: "integrated_sweep_label_mismatch",
    },
    {
      name: "non-finite numeric row",
      mutate: (text: string) => text.replace(/(gap_000\s+)\S+/, "$1NaN"),
      code: "output_format_invalid",
    },
    {
      name: "negative reported integration error",
      mutate: (text: string) => text.replace("1.000000e-7", "-1.000000e-7"),
      code: "integrated_sweep_row_invalid",
    },
  ])("rejects an adversarial $name", async ({ mutate, code }) => {
    const fixture = await buildFixture();
    await rewriteObservedOutput(
      fixture,
      "casimir_integrated_force_sweep",
      mutate(officialOutFixture(fixture.plan)),
    );
    await expectFailure(() => replayFixture(fixture), code);
  });

  it("rejects adversarial byXi headers, block labels, and Matsubara frequencies", async () => {
    const headerFixture = await buildFixture();
    await rewriteObservedOutput(
      headerFixture,
      "casimir_matsubara_spectrum",
      officialByXiFixture(headerFixture.plan).replace(
        "#3: energy Xi integrand",
        "#3: z-force Xi integrand",
      ),
    );
    await expectFailure(
      () => replayFixture(headerFixture),
      "output_header_invalid",
    );

    const labelFixture = await buildFixture();
    const byXi = officialByXiFixture(labelFixture.plan);
    const secondBlockOffset = byXi.indexOf(
      "gap_000 ",
      byXi.indexOf("gap_000 ") + 1,
    );
    const forgedLabel =
      byXi.slice(0, secondBlockOffset) +
      byXi.slice(secondBlockOffset).replace("gap_000 ", "gap_004 ");
    await rewriteObservedOutput(
      labelFixture,
      "casimir_matsubara_spectrum",
      forgedLabel,
    );
    await expectFailure(
      () => replayFixture(labelFixture),
      "matsubara_row_invalid",
    );

    const frequencyFixture = await buildFixture();
    const frequencyText = officialByXiFixture(frequencyFixture.plan);
    const step =
      2 *
      Math.PI *
      4.36763e-4 *
      frequencyFixture.plan.input.thermodynamics.temperatureKelvin;
    await rewriteObservedOutput(
      frequencyFixture,
      "casimir_matsubara_spectrum",
      frequencyText.replace(
        step.toExponential(6),
        (step * 1.25).toExponential(6),
      ),
    );
    await expectFailure(
      () => replayFixture(frequencyFixture),
      "matsubara_sequence_invalid",
    );
  });

  it("uses the actual %.6e half-ULP at low Matsubara frequencies", async () => {
    const ambiguityTemperature =
      NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY.ximinRawScuff /
      (2 *
        Math.PI *
        NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY.boltzmannKInternalPerKelvin);
    const temperatureKelvin = ambiguityTemperature * 1.01;
    const expectedXi1 =
      2 *
      Math.PI *
      NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY.boltzmannKInternalPerKelvin *
      temperatureKelvin;
    const halfPrintedUlp =
      0.5 *
      10 **
        (Math.floor(Math.log10(Math.abs(expectedXi1))) -
          NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY.digitsAfterDecimal);

    const nearFixture = await buildFixture(temperatureKelvin);
    await rewriteObservedOutput(
      nearFixture,
      "casimir_matsubara_spectrum",
      officialByXiFixture(nearFixture.plan).replaceAll(
        expectedXi1.toExponential(6),
        (expectedXi1 + 0.9 * halfPrintedUlp).toExponential(12),
      ),
    );
    await expect(replayFixture(nearFixture)).resolves.toMatchObject({
      status: "partial_raw_scuff_content_replayed_blocked",
    });

    const mismatchFixture = await buildFixture(temperatureKelvin);
    await rewriteObservedOutput(
      mismatchFixture,
      "casimir_matsubara_spectrum",
      officialByXiFixture(mismatchFixture.plan).replaceAll(
        expectedXi1.toExponential(6),
        (expectedXi1 + 1.1 * halfPrintedUlp).toExponential(12),
      ),
    );
    await expectFailure(
      () => replayFixture(mismatchFixture),
      "matsubara_sequence_invalid",
    );
  });

  it("rejects forged file bytes even when the execution observation is otherwise valid", async () => {
    const fixture = await buildFixture();
    await fs.appendFile(
      path.join(fixture.plan.runSpec.outputRoot, "scuff-cas3D.log"),
      "forged after observation\n",
      "utf8",
    );
    await expectFailure(
      () => replayFixture(fixture),
      "output_bytes_binding_mismatch",
    );
  });

  it("rejects freshness drift outside the observed execution interval", async () => {
    const fixture = await buildFixture();
    const output = fixture.observation.outputs[0];
    output.modifiedAt = new Date(
      Date.parse(fixture.observation.process.startedAt) - 1,
    ).toISOString();
    await expectFailure(
      () => replayFixture(fixture),
      "output_freshness_interval_mismatch",
    );
  });

  it("rejects source/run identity substitution and the legacy simulated service", async () => {
    const sourceFixture = await buildFixture();
    sourceFixture.observation.solver.version = "unreviewed";
    await expectFailure(
      () => replayFixture(sourceFixture),
      "execution_observation_binding_invalid",
    );

    const runFixture = await buildFixture();
    runFixture.observation.process.args = [
      ...runFixture.observation.process.args,
      "--unsealed",
    ];
    await expectFailure(
      () => replayFixture(runFixture),
      "execution_process_binding_invalid",
    );

    const legacyFixture = await buildFixture();
    legacyFixture.observation.process.command = path.join(
      legacyFixture.root,
      "server",
      "services",
      "scuffem.ts",
    );
    await expectFailure(
      () => replayFixture(legacyFixture),
      "legacy_simulated_scuff_forbidden",
    );
  });

  it("rejects authority promotion in a forged executor observation", async () => {
    const fixture = await buildFixture();
    (
      fixture.observation.claimBoundary as unknown as Record<string, boolean>
    ).physicalViabilityClaimAllowed = true;
    await expectFailure(
      () => replayFixture(fixture),
      "execution_claim_boundary_invalid",
    );
  });

  it("rejects extra/nested inventory and overlong bounded text rows", async () => {
    const inventoryFixture = await buildFixture();
    await fs.mkdir(
      path.join(inventoryFixture.plan.runSpec.outputRoot, "nested"),
    );
    await expectFailure(
      () => replayFixture(inventoryFixture),
      "output_inventory_mismatch",
    );

    const lineFixture = await buildFixture();
    const longLog = `${"x".repeat(17 * 1024)}\n`;
    await rewriteObservedOutput(lineFixture, "casimir_solver_log", longLog);
    await expectFailure(
      () => replayFixture(lineFixture),
      "output_resource_limit_exceeded",
    );
  });

  it("rejects hardlinks, symlinks, and post-parse TOCTOU mutation", async () => {
    const hardlinkFixture = await buildFixture();
    const hardlinkPath = path.join(
      hardlinkFixture.plan.runSpec.outputRoot,
      "scuff-cas3D.log",
    );
    const hardlinkSource = path.join(
      hardlinkFixture.root,
      "log-hardlink-source",
    );
    await fs.copyFile(hardlinkPath, hardlinkSource);
    await fs.rm(hardlinkPath);
    await fs.link(hardlinkSource, hardlinkPath);
    await expectFailure(
      () => replayFixture(hardlinkFixture),
      "output_entry_hardlinked",
    );

    const symlinkFixture = await buildFixture();
    const symlinkPath = path.join(
      symlinkFixture.plan.runSpec.outputRoot,
      "scuff-cas3D.log",
    );
    const symlinkSource = path.join(symlinkFixture.root, "log-symlink-source");
    await fs.copyFile(symlinkPath, symlinkSource);
    await fs.rm(symlinkPath);
    try {
      await fs.symlink(symlinkSource, symlinkPath, "file");
      await expectFailure(
        () => replayFixture(symlinkFixture),
        "output_entry_symlink_or_reparse",
      );
    } catch (error) {
      if (
        !["EPERM", "ENOTSUP", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw error;
      }
    }

    const raceFixture = await buildFixture();
    await expectFailure(
      () =>
        replayFixture(raceFixture, async () => {
          await fs.appendFile(
            path.join(raceFixture.plan.runSpec.outputRoot, "scuff-cas3D.log"),
            "mutated\n",
            "utf8",
          );
        }),
      "output_bytes_binding_mismatch",
    );
  });
});
