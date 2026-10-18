import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
  NHM2_FORMAL_KERNEL_RESOURCE_LIMITS,
  NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
  NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
  Nhm2FormalKernelExecutorError,
  computeNhm2FormalKernelLedgerSha256,
  executeNhm2FormalKernelReplay,
  type Nhm2FormalKernelExecutableBindingV1,
  type Nhm2FormalKernelLedgerEntryV1,
  type Nhm2FormalKernelLedgerKind,
  type Nhm2FormalKernelPresealedRunSpecV1,
  type Nhm2FormalKernelSealedLedgerV1,
} from "../nhm2-formal-kernel-executor";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const caseRoots: string[] = [];
let suiteRoot: string;
let toolchainRoot: string;
let leanFixtureExecutable: string;
let lakeFixtureExecutable: string;
let toolchainLedger: Nhm2FormalKernelSealedLedgerV1;
let leanExecutableBinding: Nhm2FormalKernelExecutableBindingV1;
let lakeExecutableBinding: Nhm2FormalKernelExecutableBindingV1;

async function sealLedger(input: {
  kind: Nhm2FormalKernelLedgerKind;
  rootPath: string;
  relativePaths: string[];
}): Promise<Nhm2FormalKernelSealedLedgerV1> {
  const entries: Nhm2FormalKernelLedgerEntryV1[] = [];
  for (const relativePath of [...input.relativePaths].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  )) {
    const bytes = await fs.readFile(
      path.join(input.rootPath, ...relativePath.split("/")),
    );
    entries.push({
      relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
    });
  }
  return {
    kind: input.kind,
    rootPath: input.rootPath,
    entries,
    ledgerSha256: computeNhm2FormalKernelLedgerSha256({
      kind: input.kind,
      entries,
    }),
  };
}

beforeAll(async () => {
  suiteRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-formal-executor-suite-"),
  );
  toolchainRoot = path.join(suiteRoot, "toolchain");
  await fs.mkdir(toolchainRoot);
  leanFixtureExecutable = path.join(
    toolchainRoot,
    process.platform === "win32" ? "lean-fixture.exe" : "lean-fixture",
  );
  lakeFixtureExecutable = path.join(
    toolchainRoot,
    process.platform === "win32" ? "lake-fixture.exe" : "lake-fixture",
  );
  await fs.copyFile(process.execPath, leanFixtureExecutable);
  await fs.copyFile(process.execPath, lakeFixtureExecutable);
  if (process.platform !== "win32") {
    await fs.chmod(leanFixtureExecutable, 0o755);
    await fs.chmod(lakeFixtureExecutable, 0o755);
  }
  toolchainLedger = await sealLedger({
    kind: "toolchain",
    rootPath: toolchainRoot,
    relativePaths: [
      path.basename(leanFixtureExecutable),
      path.basename(lakeFixtureExecutable),
    ],
  });
  const bindingFor = (
    absolutePath: string,
  ): Nhm2FormalKernelExecutableBindingV1 => {
    const executableEntry = toolchainLedger.entries.find(
      (entry) => entry.relativePath === path.basename(absolutePath),
    );
    if (executableEntry == null) throw new Error("Missing fixture executable.");
    return {
      absolutePath,
      sha256: executableEntry.sha256,
      sizeBytes: executableEntry.sizeBytes,
    };
  };
  leanExecutableBinding = bindingFor(leanFixtureExecutable);
  lakeExecutableBinding = bindingFor(lakeFixtureExecutable);
}, 30_000);

afterEach(async () => {
  for (const root of caseRoots.splice(0)) {
    await fs.rm(root, { force: true, recursive: true });
  }
});

afterAll(async () => {
  if (suiteRoot != null) {
    await fs.rm(suiteRoot, { force: true, recursive: true });
  }
}, 30_000);

type FixtureMode =
  | "success"
  | "arbitrary-proof"
  | "nonzero"
  | "mutate-input"
  | "extra-output"
  | "hardlink-output"
  | "replay-mismatch";

async function fixture(
  mode: FixtureMode,
  executableRole: "lean" | "lake" = "lean",
): Promise<Nhm2FormalKernelPresealedRunSpecV1> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-formal-executor-case-"),
  );
  caseRoots.push(root);
  const sourceRoot = path.join(root, "source");
  const inputRoot = path.join(root, "input");
  await fs.mkdir(sourceRoot);
  await fs.mkdir(inputRoot);
  const scriptPath = path.join(sourceRoot, "fixture-kernel.cjs");
  const configPath = path.join(inputRoot, "config.json");
  const guardedInputPath = path.join(inputRoot, "guarded-input.txt");
  const fixtureScript = `
const fs = require("node:fs");
const path = require("node:path");
const [configPath, guardedInputPath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
let proofBytes = "deterministic-checked-module";
if (config.mode === "replay-mismatch") {
  proofBytes += ":" + path.basename(process.cwd());
}
fs.writeFileSync(path.join(process.cwd(), "proof.olean"), proofBytes, "utf8");
if (config.mode === "extra-output") {
  fs.writeFileSync(path.join(process.cwd(), "extra.bin"), "extra", "utf8");
}
if (config.mode === "hardlink-output") {
  fs.linkSync(
    path.join(process.cwd(), "proof.olean"),
    path.join(process.cwd(), "proof-link.olean"),
  );
}
if (config.mode === "mutate-input") {
  fs.appendFileSync(guardedInputPath, "mutated", "utf8");
}
if (config.mode === "arbitrary-proof") {
  console.log("test proof term");
  console.log("proved");
} else {
  console.log(${JSON.stringify(NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER)});
  console.log(${JSON.stringify(NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER)});
}
if (config.mode === "nonzero") process.exitCode = 7;
`;
  await fs.writeFile(scriptPath, fixtureScript, "utf8");
  await fs.writeFile(configPath, `${JSON.stringify({ mode })}\n`, "utf8");
  await fs.writeFile(guardedInputPath, "sealed-input\n", "utf8");
  const sourceLedger = await sealLedger({
    kind: "source",
    rootPath: sourceRoot,
    relativePaths: ["fixture-kernel.cjs"],
  });
  const inputLedger = await sealLedger({
    kind: "input",
    rootPath: inputRoot,
    relativePaths: ["config.json", "guarded-input.txt"],
  });
  const outputRoot = path.join(root, "output");
  return {
    theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
    executableRole,
    executables: {
      lean: { ...leanExecutableBinding },
      lake: { ...lakeExecutableBinding },
    },
    ledgers: {
      source: sourceLedger,
      toolchain: toolchainLedger,
      input: inputLedger,
    },
    outputRoot,
    replayWorkdirs: [
      path.join(outputRoot, "replay-one"),
      path.join(outputRoot, "replay-two"),
    ],
    environmentAllowlist: [],
    environment: {},
    executableArguments: [scriptPath, configPath, guardedInputPath],
    expectedOutputPaths: ["proof.olean"],
    timeoutMs: 10_000,
    maxCapturedOutputBytes: 64 * 1024,
  };
}

async function expectExecutorFailure(
  promise: Promise<unknown>,
  code: string,
): Promise<Nhm2FormalKernelExecutorError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2FormalKernelExecutorError);
    const typed = error as Nhm2FormalKernelExecutorError;
    expect(typed.code).toBe(code);
    return typed;
  }
  throw new Error(`Expected formal executor failure ${code}.`);
}

describe.sequential("NHM2 formal kernel executor", () => {
  it("observes two exact fresh replays while preserving closed physical claims", async () => {
    const spec = await fixture("success");
    const result = await executeNhm2FormalKernelReplay(spec);

    expect(result.status).toBe("pass");
    expect(result.theoremName).toBe("nhm2_pre_experimental_claim_locks");
    expect(result.executableRole).toBe("lean");
    expect(result.executables.lean).toEqual(leanExecutableBinding);
    expect(result.executables.lake).toEqual(lakeExecutableBinding);
    expect(result.replays).toHaveLength(2);
    expect(result.replays.map((replay) => replay.executableRole)).toEqual([
      "lean",
      "lean",
    ]);
    expect(result.replays.map((replay) => replay.process.exitCode)).toEqual([
      0, 0,
    ]);
    expect(result.replays[0].process.executableRole).toBe("lean");
    expect(result.replays[0].process.command).toBe(leanFixtureExecutable);
    expect(result.replays[0].process.environment).toEqual({});
    expect(result.replays[0].outputs).toEqual([
      expect.objectContaining({
        relativePath: "proof.olean",
        freshness: "new",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(result.replays[0].outputInventorySha256).toBe(
      result.replays[1].outputInventorySha256,
    );
    expect(result.replayAgreement).toEqual({
      executableRolesExact: true,
      commandsExact: true,
      environmentsExact: true,
      transcriptsExact: true,
      outputInventoriesExact: true,
      sealedLedgersStable: true,
    });
    expect(result.claimBoundary).toMatchObject({
      formalLogicReplayOnly: true,
      numericalPhysicsValidated: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
  });

  it("runs the sealed Lake binding when the explicit role is lake", async () => {
    const spec = await fixture("success", "lake");
    const result = await executeNhm2FormalKernelReplay(spec);

    expect(result.executableRole).toBe("lake");
    expect(result.replays.map((replay) => replay.executableRole)).toEqual([
      "lake",
      "lake",
    ]);
    expect(
      result.replays.every(
        (replay) =>
          replay.process.executableRole === "lake" &&
          replay.process.command === lakeFixtureExecutable,
      ),
    ).toBe(true);
    expect(
      result.replays.some(
        (replay) => replay.process.command === leanFixtureExecutable,
      ),
    ).toBe(false);
  });

  it("rejects a tampered executable role before spawning", async () => {
    const spec = await fixture("success");
    (spec as unknown as { executableRole: string }).executableRole = "node";

    const error = await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "executable_role_invalid",
    );

    expect(error.observedProcesses).toEqual([]);
  });

  it("rejects an oversized declared ledger before reading or spawning", async () => {
    const spec = await fixture("success");
    spec.ledgers.source.entries[0].sizeBytes =
      NHM2_FORMAL_KERNEL_RESOURCE_LIMITS.maxFileBytes + 1;
    spec.ledgers.source.ledgerSha256 = computeNhm2FormalKernelLedgerSha256({
      kind: "source",
      entries: spec.ledgers.source.entries,
    });
    const error = await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "resource_limit_exceeded",
    );
    expect(error.observedProcesses).toEqual([]);
  });

  it("rejects arbitrary proof text without the exact theorem and axiom markers", async () => {
    const spec = await fixture("arbitrary-proof");
    const error = await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "transcript_markers_invalid",
    );

    expect(error.observedProcesses).toHaveLength(1);
    expect(error.observedProcesses[0].exitCode).toBe(0);
    expect(error.observedProcesses[0].stdout).toContain("test proof term");
  });

  it("rejects a nonzero outer-observed process exit", async () => {
    const spec = await fixture("nonzero");
    const error = await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "replay_exit_nonzero",
    );

    expect(error.observedProcesses).toHaveLength(1);
    expect(error.observedProcesses[0].exitCode).toBe(7);
  });

  it("rejects mutation of a sealed input after the first replay", async () => {
    const spec = await fixture("mutate-input");
    const error = await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "ledger_entry_hash_mismatch",
    );

    expect(error.observedProcesses).toHaveLength(1);
    expect(error.observedProcesses[0].exitCode).toBe(0);
  });

  it("rejects an extra run-owned output", async () => {
    const spec = await fixture("extra-output");
    await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "output_inventory_mismatch",
    );
  });

  it("rejects hard-linked output files", async () => {
    const spec = await fixture("hardlink-output");
    await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "hardlink_forbidden",
    );
  });

  it("rejects byte-different cold replay output", async () => {
    const spec = await fixture("replay-mismatch");
    const error = await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "replay_output_mismatch",
    );

    expect(error.observedProcesses).toHaveLength(2);
    expect(error.observedProcesses.every((entry) => entry.exitCode === 0)).toBe(
      true,
    );
  });

  it("rejects a replay workdir that escapes the fresh output root", async () => {
    const spec = await fixture("success");
    spec.replayWorkdirs[1] = path.join(
      path.dirname(spec.outputRoot),
      "escaped",
    );

    await expectExecutorFailure(
      executeNhm2FormalKernelReplay(spec),
      "path_escape",
    );
  });
});
