import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  replayCasimirFormalLeanRequestV1,
  runCasimirFormalLeanProcessV1,
  type CasimirFormalLeanProcessObservationV1,
  type CasimirFormalLeanProcessRunInputV1,
  type CasimirFormalLeanProcessRunnerV1,
} from "../casimir-formal-lean-replay";
import {
  buildCasimirFormalLeanReplayPolicyV1,
  type CasimirFormalLeanReplayPolicyV1,
} from "../../../../shared/contracts/casimir-formal-lean-replay-policy.v1";
import {
  buildCasimirFormalVerificationRequestV1,
  type CasimirFormalVerificationRequestV1,
} from "../../../../shared/contracts/casimir-formal-verification-request.v1";

const hash = (digit: string): string => digit.repeat(64);
const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const theoremName = "casimir_demo_theorem";
const theoremModule = "CasimirDemo";
const theoremSource = "theorem casimir_demo_theorem : True := by\n  trivial\n";
const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "casimir-lean-replay-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root && path.resolve(root).startsWith(path.resolve(os.tmpdir()))) {
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  }
});

async function makeFixture(
  options: {
    executablePath?: string;
    executableBytes?: Buffer;
    source?: string;
    allowedAxiomIds?: string[];
    declaredAxiomIds?: string[];
    imports?: Array<{ module: string; source: string }>;
  } = {},
): Promise<{
  root: string;
  executablePath: string;
  sourcePath: string;
  importSourcePaths: Record<string, string>;
  outputRoot: string;
  policy: CasimirFormalLeanReplayPolicyV1;
  request: CasimirFormalVerificationRequestV1;
}> {
  const root = await tempRoot();
  const executablePath =
    options.executablePath ?? path.join(root, "sealed-lean.bin");
  const executableBytes = options.executableBytes ?? Buffer.from("sealed lean");
  if (!options.executablePath)
    await fs.writeFile(executablePath, executableBytes);
  const observedExecutableBytes = options.executablePath
    ? await fs.readFile(options.executablePath)
    : executableBytes;
  const source = options.source ?? theoremSource;
  const sourcePath = path.join(root, "candidate.lean");
  await fs.writeFile(sourcePath, source, "utf8");
  const importSourcePaths: Record<string, string> = {};
  for (const entry of options.imports ?? []) {
    const importPath = path.join(
      root,
      "import-evidence",
      `${entry.module.replaceAll(".", "-")}.lean`,
    );
    await fs.mkdir(path.dirname(importPath), { recursive: true });
    await fs.writeFile(importPath, entry.source, "utf8");
    importSourcePaths[entry.module] = importPath;
  }
  const policy = await buildCasimirFormalLeanReplayPolicyV1({
    policyId: "casimir-lean-replay-policy-test",
    pinnedVersion: "4.31.0",
    kernelBinarySha256: sha256(observedExecutableBytes),
    allowedImportModules: (options.imports ?? []).map((entry) => entry.module),
    resourceCeilings: {
      timeoutMs: 120_000,
      maxMemoryBytes: 512 * 1024 * 1024,
      maxOutputBytes: 64 * 1024,
      maxSourceBytes: 64 * 1024,
      maxImportCount: 8,
    },
  });
  const request = await buildCasimirFormalVerificationRequestV1({
    generatedAt: "2026-07-24T05:00:00.000Z",
    requestId: "formal-replay-request-001",
    casimirSpec: {
      specId: "spec.demo",
      schemaVersion: "casimir_spec_scientific_claim_ir/v1",
      semanticSha256: hash("a"),
      artifactSha256: hash("b"),
    },
    claim: {
      claimId: "claim.demo",
      propositionSha256: hash("c"),
    },
    formalArtifact: {
      theoremName,
      theoremModule,
      statementSha256: hash("c"),
      sourceSha256: sha256(source),
      emitterId: "casimir-test-emitter",
      emitterRevisionSha256: hash("d"),
    },
    masterProblem: {
      schemaVersion: "theory_master_problem/v1",
      planId: "master-demo",
      artifactSha256: hash("e"),
    },
    derivationProgram: {
      schemaVersion: "theory_derivation_program/v1",
      programId: "program-demo",
      sourceMasterProblemPlanId: "master-demo",
      artifactSha256: hash("f"),
    },
    theoryGraph: {
      graphId: "graph-demo",
      snapshotSha256: hash("1"),
    },
    catalogSnapshots: [],
    formalEnvironment: {
      prover: "lean4",
      toolchainPolicyId: policy.policyId,
      toolchainPolicySha256: policy.artifactSha256,
      pinnedVersion: policy.pinnedVersion,
      imports: (options.imports ?? []).map((entry) => ({
        module: entry.module,
        sourceSha256: sha256(entry.source),
      })),
      declaredAxiomIds: options.declaredAxiomIds ?? [],
      allowedAxiomIds: options.allowedAxiomIds ?? [],
    },
    executionPolicy: {
      replayCount: 2,
      timeoutMs: 120_000,
      maxMemoryBytes: 256 * 1024 * 1024,
      maxOutputBytes: 32 * 1024,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
    },
  });
  return {
    root,
    executablePath,
    sourcePath,
    importSourcePaths,
    outputRoot: path.join(root, "replay-output"),
    policy,
    request,
  };
}

function successfulRunner(
  observations: CasimirFormalLeanProcessRunInputV1[],
  outputForRun?: (runIndex: number) => string,
): CasimirFormalLeanProcessRunnerV1 {
  return async (input) => {
    observations.push(input);
    const runIndex = observations.length;
    return {
      startedAt: `2026-07-24T05:00:0${runIndex}.000Z`,
      completedAt: `2026-07-24T05:00:1${runIndex}.000Z`,
      exitCode: 0,
      signal: null,
      stdout:
        outputForRun?.(runIndex) ??
        `${theoremName} : True\n'${theoremName}' does not depend on any axioms\n`,
      stderr: "",
      timedOut: false,
      outputLimitExceeded: false,
      spawnError: null,
    };
  };
}

describe("generic Casimir formal Lean replay", () => {
  it("builds a passing evidence-only certificate from two exact outer observations", async () => {
    const fixture = await makeFixture();
    const observations: CasimirFormalLeanProcessRunInputV1[] = [];
    const certificate = await replayCasimirFormalLeanRequestV1({
      request: fixture.request,
      policy: fixture.policy,
      leanExecutablePath: fixture.executablePath,
      theoremSourcePath: fixture.sourcePath,
      importSourcePaths: {},
      outputRoot: fixture.outputRoot,
      runner: successfulRunner(observations),
      generatedAt: () => "2026-07-24T05:01:00.000Z",
    });

    expect(certificate.status).toBe("passed");
    expect(certificate.replay.completedReplayCount).toBe(2);
    expect(certificate.replay.byteIdentical).toBe(true);
    expect(certificate.axiomAudit.usedAxiomIds).toEqual([]);
    expect(certificate.request).toMatchObject({
      casimirSpec: {
        semanticSha256: fixture.request.casimirSpec.semanticSha256,
        artifactSha256: fixture.request.casimirSpec.artifactSha256,
      },
      masterProblem: {
        planId: fixture.request.masterProblem.planId,
        artifactSha256: fixture.request.masterProblem.artifactSha256,
      },
      derivationProgram: {
        programId: fixture.request.derivationProgram.programId,
        artifactSha256: fixture.request.derivationProgram.artifactSha256,
      },
      theoryGraph: {
        graphId: fixture.request.theoryGraph.graphId,
        snapshotSha256: fixture.request.theoryGraph.snapshotSha256,
      },
    });
    expect(certificate.authority).toMatchObject({
      formalPropositionChecked: true,
      validatesSemanticIntent: false,
      validatesTheory: false,
      validatesGeneratedCode: false,
      validatesNumericalImplementation: false,
      validatesEmpiricalClaim: false,
      validatesPhysicalMechanism: false,
      assistantAnswer: false,
      terminalEligible: false,
      promotionAllowed: false,
      postToolModelStepRequired: true,
    });
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(observation.command).toBe(fixture.executablePath);
      expect(observation.args).toEqual([
        "--trust=0",
        "--threads=1",
        "--memory=256",
        "--root=.",
        "CasimirReplay.lean",
      ]);
      expect(observation.environment).toEqual({
        LEAN_PATH: observation.cwd,
      });
    }
    expect(observations[0].cwd).not.toBe(observations[1].cwd);
  });

  it("fails closed on transcript nondeterminism", async () => {
    const fixture = await makeFixture();
    const observations: CasimirFormalLeanProcessRunInputV1[] = [];
    const certificate = await replayCasimirFormalLeanRequestV1({
      request: fixture.request,
      policy: fixture.policy,
      leanExecutablePath: fixture.executablePath,
      theoremSourcePath: fixture.sourcePath,
      importSourcePaths: {},
      outputRoot: fixture.outputRoot,
      runner: successfulRunner(
        observations,
        (runIndex) =>
          `${theoremName} : True\n'${theoremName}' does not depend on any axioms\nrun=${runIndex}\n`,
      ),
    });

    expect(certificate.status).toBe("failed");
    expect(certificate.replay.byteIdentical).toBe(false);
    expect(certificate.blockers.map((entry) => entry.code)).toContain(
      "lean_replay_nondeterministic",
    );
  });

  it("fails closed when Lean reports an undeclared axiom", async () => {
    const fixture = await makeFixture();
    const observations: CasimirFormalLeanProcessRunInputV1[] = [];
    const certificate = await replayCasimirFormalLeanRequestV1({
      request: fixture.request,
      policy: fixture.policy,
      leanExecutablePath: fixture.executablePath,
      theoremSourcePath: fixture.sourcePath,
      importSourcePaths: {},
      outputRoot: fixture.outputRoot,
      runner: successfulRunner(
        observations,
        () =>
          `${theoremName} : True\n'${theoremName}' depends on axioms: [Classical.choice]\n`,
      ),
    });

    expect(certificate.status).toBe("failed");
    expect(certificate.axiomAudit.usedAxiomIds).toEqual(["Classical.choice"]);
    expect(certificate.axiomAudit.hiddenAxiomsDetected).toBe(true);
    expect(certificate.blockers.map((entry) => entry.code)).toContain(
      "lean_hidden_axiom_detected",
    );
  });

  it("returns a blocked zero-run certificate for source substitution and unsafe source", async () => {
    const fixture = await makeFixture();
    await fs.writeFile(
      fixture.sourcePath,
      `${theoremSource}\n#eval IO.println "not admitted"\n`,
      "utf8",
    );
    const observations: CasimirFormalLeanProcessRunInputV1[] = [];
    const certificate = await replayCasimirFormalLeanRequestV1({
      request: fixture.request,
      policy: fixture.policy,
      leanExecutablePath: fixture.executablePath,
      theoremSourcePath: fixture.sourcePath,
      importSourcePaths: {},
      outputRoot: fixture.outputRoot,
      runner: successfulRunner(observations),
    });

    expect(certificate.status).toBe("blocked");
    expect(certificate.replay.completedReplayCount).toBe(0);
    expect(observations).toHaveLength(0);
    expect(certificate.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "source_hash_mismatch",
        "source_token_forbidden",
      ]),
    );
  });

  it("returns a blocked zero-run certificate for import-source substitution", async () => {
    const fixture = await makeFixture({
      source: `import Init\n${theoremSource}`,
      imports: [{ module: "Init", source: "sealed Init source evidence" }],
    });
    await fs.writeFile(
      fixture.importSourcePaths.Init,
      "substituted Init source evidence",
      "utf8",
    );
    const observations: CasimirFormalLeanProcessRunInputV1[] = [];
    const certificate = await replayCasimirFormalLeanRequestV1({
      request: fixture.request,
      policy: fixture.policy,
      leanExecutablePath: fixture.executablePath,
      theoremSourcePath: fixture.sourcePath,
      importSourcePaths: fixture.importSourcePaths,
      outputRoot: fixture.outputRoot,
      runner: successfulRunner(observations),
    });

    expect(certificate.status).toBe("blocked");
    expect(certificate.replay.completedReplayCount).toBe(0);
    expect(observations).toHaveLength(0);
    expect(certificate.blockers.map((entry) => entry.code)).toContain(
      "import_source_hash_mismatch",
    );
  });

  it("stops after an outer-observed timeout", async () => {
    const fixture = await makeFixture();
    let callCount = 0;
    const certificate = await replayCasimirFormalLeanRequestV1({
      request: fixture.request,
      policy: fixture.policy,
      leanExecutablePath: fixture.executablePath,
      theoremSourcePath: fixture.sourcePath,
      importSourcePaths: {},
      outputRoot: fixture.outputRoot,
      runner: async () => {
        callCount += 1;
        return {
          startedAt: "2026-07-24T05:00:01.000Z",
          completedAt: "2026-07-24T05:00:11.000Z",
          exitCode: null,
          signal: "SIGKILL",
          stdout: "",
          stderr: "",
          timedOut: true,
          outputLimitExceeded: false,
          spawnError: null,
        };
      },
    });

    expect(callCount).toBe(1);
    expect(certificate.status).toBe("failed");
    expect(certificate.replay.completedReplayCount).toBe(1);
    expect(certificate.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "lean_replay_timed_out",
        "lean_replay_failed",
        "lean_theorem_check_missing",
        "lean_axiom_report_missing",
      ]),
    );
  });

  it("rejects request-to-policy substitution before execution", async () => {
    const fixture = await makeFixture();
    fixture.request.formalEnvironment.toolchainPolicySha256 = hash("0");

    await expect(
      replayCasimirFormalLeanRequestV1({
        request: fixture.request,
        policy: fixture.policy,
        leanExecutablePath: fixture.executablePath,
        theoremSourcePath: fixture.sourcePath,
        importSourcePaths: {},
        outputRoot: fixture.outputRoot,
        runner: successfulRunner([]),
      }),
    ).rejects.toThrow(/formal Lean replay admission failed/);
  });
});

const installedLeanPath =
  process.platform === "win32"
    ? path.join(
        os.homedir(),
        ".elan",
        "toolchains",
        "leanprover--lean4---v4.31.0",
        "bin",
        "lean.exe",
      )
    : "";

describe.skipIf(!installedLeanPath || !fsSync.existsSync(installedLeanPath))(
  "generic Casimir formal Lean replay integration",
  () => {
    it("replays a sealed theorem twice through the actual pinned Lean binary", async () => {
      const fixture = await makeFixture({
        executablePath: installedLeanPath,
      });
      const observations: CasimirFormalLeanProcessObservationV1[] = [];
      const certificate = await replayCasimirFormalLeanRequestV1({
        request: fixture.request,
        policy: fixture.policy,
        leanExecutablePath: installedLeanPath,
        theoremSourcePath: fixture.sourcePath,
        importSourcePaths: {},
        outputRoot: fixture.outputRoot,
        runner: async (input) => {
          const observation = await runCasimirFormalLeanProcessV1(input);
          observations.push(observation);
          return observation;
        },
      });

      expect(
        certificate.status,
        JSON.stringify({ blockers: certificate.blockers, observations }),
      ).toBe("passed");
      expect(certificate.replay.completedReplayCount).toBe(2);
      expect(certificate.replay.byteIdentical).toBe(true);
      expect(certificate.axiomAudit).toMatchObject({
        usedAxiomIds: [],
        hiddenAxiomsDetected: false,
      });
    }, 260_000);
  },
);
