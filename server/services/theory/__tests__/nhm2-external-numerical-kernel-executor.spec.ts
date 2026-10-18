import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeNhm2ExternalNumericalKernelLedgerSha256,
  computeNhm2ExternalNumericalKernelStagingIdentitySha256,
  executeNhm2ExternalNumericalKernel,
  Nhm2ExternalNumericalKernelExecutorError,
  type Nhm2ExternalNumericalKernelLedgerKind,
  type Nhm2ExternalNumericalKernelRunSpecV1,
  type Nhm2ExternalNumericalKernelSealedLedgerV1,
} from "../nhm2-external-numerical-kernel-executor";

const temporaryRoots: string[] = [];

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

async function makeLedger(
  rootPath: string,
  kind: Nhm2ExternalNumericalKernelLedgerKind,
): Promise<Nhm2ExternalNumericalKernelSealedLedgerV1> {
  const relativePaths = (await fs.readdir(rootPath)).sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  const entries = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const bytes = await fs.readFile(path.join(rootPath, relativePath));
      return {
        relativePath,
        sha256: sha256(bytes),
        sizeBytes: bytes.byteLength,
      };
    }),
  );
  return {
    kind,
    rootPath,
    entries,
    ledgerSha256: computeNhm2ExternalNumericalKernelLedgerSha256({
      kind,
      entries,
    }),
  };
}

async function buildFixture(input?: {
  script?: string;
}): Promise<Nhm2ExternalNumericalKernelRunSpecV1> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-external-kernel-"),
  );
  temporaryRoots.push(root);
  const toolchainRoot = path.join(root, "toolchain");
  const inputRoot = path.join(root, "input");
  const outputRoot = path.join(root, "output");
  await fs.mkdir(toolchainRoot);
  await fs.mkdir(inputRoot);
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const executablePath = path.join(toolchainRoot, executableName);
  await fs.copyFile(process.execPath, executablePath);
  if (process.platform !== "win32") {
    await fs.chmod(executablePath, 0o755);
  }
  const script =
    input?.script ??
    [
      'const fs = require("node:fs");',
      "const [resultPath, tracePath] = process.argv.slice(2);",
      'fs.writeFileSync(resultPath, JSON.stringify({ status: "producer_claimed_pass" }));',
      "fs.writeFileSync(tracePath, JSON.stringify({ iterations: [1, 2, 3] }));",
    ].join("\n");
  await fs.writeFile(path.join(inputRoot, "producer.cjs"), script, "utf8");
  const toolchain = await makeLedger(toolchainRoot, "toolchain");
  const sealedInput = await makeLedger(inputRoot, "input");
  const executableEntry = toolchain.entries.find(
    (entry) => entry.relativePath === executableName,
  );
  if (executableEntry == null) throw new Error("fixture executable missing");
  return {
    lane: "observer_continuous_optimizer",
    solver: {
      family: "warpax",
      implementationId: "test.warpax.external",
      version: "1.3.0",
      producerMode: "external_binary",
    },
    executable: {
      absolutePath: executablePath,
      sha256: executableEntry.sha256,
      sizeBytes: executableEntry.sizeBytes,
    },
    ledgers: {
      toolchain,
      input: sealedInput,
    },
    outputRoot,
    arguments: [
      { kind: "input_path", relativePath: "producer.cjs" },
      { kind: "output_path", relativePath: "observer-results.json" },
      { kind: "output_path", relativePath: "optimizer-trace.json" },
    ],
    environmentAllowlist: [],
    environment: {},
    expectedOutputs: [
      {
        role: "observer_optimizer_result",
        relativePath: "observer-results.json",
        maxBytes: 1024,
      },
      {
        role: "observer_optimizer_trace",
        relativePath: "optimizer-trace.json",
        maxBytes: 1024,
      },
    ],
    timeoutMs: 30_000,
    maxCapturedOutputBytes: 1024 * 1024,
    maxLedgerFileBytes: 256 * 1024 * 1024,
    maxLedgerAggregateBytes: 512 * 1024 * 1024,
    maxOutputAggregateBytes: 2048,
  };
}

async function expectFailure(
  promise: Promise<unknown>,
  code: string,
): Promise<Nhm2ExternalNumericalKernelExecutorError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2ExternalNumericalKernelExecutorError);
    expect((error as Nhm2ExternalNumericalKernelExecutorError).code).toBe(code);
    return error as Nhm2ExternalNumericalKernelExecutorError;
  }
  throw new Error(`Expected ${code}.`);
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root != null) await fs.rm(root, { recursive: true, force: true });
  }
});

describe("NHM2 external numerical-kernel executor", () => {
  it("observes exact fresh output without promoting producer-claimed science", async () => {
    const spec = await buildFixture();

    const observation = await executeNhm2ExternalNumericalKernel(spec);

    expect(observation.status).toBe(
      "execution_observed_scientific_replay_required",
    );
    expect(observation.process.exitCode).toBe(0);
    expect(observation.process.command).toBe(
      observation.runOwnedToolchain.executablePath,
    );
    expect(observation.process.command).not.toBe(spec.executable.absolutePath);
    expect(observation.runOwnedToolchain).toMatchObject({
      authority: "executor_created_fresh_copy",
      executableRelativePath:
        process.platform === "win32" ? "node.exe" : "node",
      sourceLedgerSha256: spec.ledgers.toolchain.ledgerSha256,
      removedAfterExecution: true,
      permissions: {
        osLevelImmutabilityAsserted: false,
      },
    });
    expect(observation.runOwnedToolchain.stagingIdentitySha256).toBe(
      computeNhm2ExternalNumericalKernelStagingIdentitySha256({
        rootPath: observation.runOwnedToolchain.rootPath,
        executableRelativePath:
          observation.runOwnedToolchain.executableRelativePath,
        executablePath: observation.runOwnedToolchain.executablePath,
        sourceLedgerSha256: observation.runOwnedToolchain.sourceLedgerSha256,
        stagedLedger: observation.runOwnedToolchain.preSpawnLedger,
      }),
    );
    expect(observation.runOwnedToolchain.preSpawnLedger.entries).toEqual(
      observation.runOwnedToolchain.postRunLedger.entries,
    );
    await expect(
      fs.lstat(observation.runOwnedToolchain.rootPath),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(observation.outputs.map((entry) => entry.role)).toEqual([
      "observer_optimizer_result",
      "observer_optimizer_trace",
    ]);
    expect(
      observation.outputs.every((entry) => entry.freshness === "new"),
    ).toBe(true);
    expect(observation.blockers).toEqual([
      "independent_scientific_content_replay_required",
      "same_user_staged_toolchain_mutation_exclusion_not_os_enforced",
    ]);
    expect(observation.claimBoundary).toMatchObject({
      externalBinaryExecutionObserved: true,
      solverOutputScientificallyValidated: false,
      theoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
  });

  it("launches staged bytes when the source executable is transiently swapped and restored across spawn", async () => {
    const spec = await buildFixture();
    const sourceExecutable = await fs.readFile(spec.executable.absolutePath);
    const swappedExecutable = Buffer.from(sourceExecutable);
    swappedExecutable[0] ^= 0xff;
    let restore: Promise<void> | null = null;

    const observation = await executeNhm2ExternalNumericalKernel(spec, {
      afterRunOwnedToolchainStaged: async () => {
        await fs.writeFile(spec.executable.absolutePath, swappedExecutable);
        restore = new Promise<void>((resolve, reject) => {
          setImmediate(() => {
            fs.writeFile(spec.executable.absolutePath, sourceExecutable).then(
              () => resolve(),
              reject,
            );
          });
        });
      },
    });
    await restore;

    expect(observation.process.exitCode).toBe(0);
    expect(observation.process.command).toBe(
      observation.runOwnedToolchain.executablePath,
    );
    expect(sha256(await fs.readFile(spec.executable.absolutePath))).toBe(
      sha256(sourceExecutable),
    );
    expect(observation.preRunLedgers.toolchain.entries).toEqual(
      observation.postRunLedgers.toolchain.entries,
    );
  }, 30_000);

  it("rejects a solver family that does not match the governed lane", async () => {
    const spec = await buildFixture();
    spec.solver.family = "scuff_em";

    await expectFailure(
      executeNhm2ExternalNumericalKernel(spec),
      "solver_binding_invalid",
    );
  });

  it("rejects extra output even when the process exits successfully", async () => {
    const spec = await buildFixture({
      script: [
        'const fs = require("node:fs");',
        "const [resultPath, tracePath] = process.argv.slice(2);",
        'fs.writeFileSync(resultPath, "{}");',
        'fs.writeFileSync(tracePath, "{}");',
        'fs.writeFileSync("undeclared.json", "{}");',
      ].join("\n"),
    });

    await expectFailure(
      executeNhm2ExternalNumericalKernel(spec),
      "output_inventory_mismatch",
    );
  });

  it("rejects mutation of the sealed input tree and preserves process evidence", async () => {
    const spec = await buildFixture({
      script: [
        'const fs = require("node:fs");',
        "const [resultPath, tracePath] = process.argv.slice(2);",
        'fs.writeFileSync(resultPath, "{}");',
        'fs.writeFileSync(tracePath, "{}");',
        'fs.appendFileSync(process.argv[1], "\\n// mutated");',
      ].join("\n"),
    });

    const failure = await expectFailure(
      executeNhm2ExternalNumericalKernel(spec),
      "sealed_ledger_mutated",
    );
    expect(failure.processObservation?.exitCode).toBe(0);
  });

  it("rejects pre-existing output instead of misclassifying it as fresh", async () => {
    const spec = await buildFixture();
    await fs.mkdir(spec.outputRoot);
    await fs.writeFile(path.join(spec.outputRoot, "old.json"), "{}", "utf8");

    await expectFailure(
      executeNhm2ExternalNumericalKernel(spec),
      "output_root_preexisting",
    );
  });

  it("rejects declared output limits that cannot contain all required roles", async () => {
    const spec = await buildFixture();
    spec.maxOutputAggregateBytes = 1024;

    await expectFailure(
      executeNhm2ExternalNumericalKernel(spec),
      "filesystem_resource_limit_exceeded",
    );
  });
});
