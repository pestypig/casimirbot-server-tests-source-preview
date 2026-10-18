import { createHash } from "node:crypto";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1 } from "../../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import {
  NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
  NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
  NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
  computeNhm2FormalKernelLedgerSha256,
  type Nhm2FormalKernelExecutionObservationV1,
  type Nhm2FormalKernelLedgerEntryV1,
  type Nhm2FormalKernelLedgerKind,
  type Nhm2FormalKernelPresealedRunSpecV1,
  type Nhm2FormalKernelSealedLedgerV1,
} from "../nhm2-formal-kernel-executor";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
  type Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1,
  type Nhm2ExperimentReadyTheoryFormalRunSpecV1,
} from "../../../../tools/nhm2/run-experiment-ready-theory-formal";
import {
  NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION,
  buildNhm2FormalOuterObservationEvidence,
  type BuildNhm2FormalOuterObservationEvidenceInput,
} from "../nhm2-formal-outer-observation-evidence-adapter";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const hash = (character: string): string => character.repeat(64);

const outputInventorySha256 = (
  entries: Array<{ relativePath: string; sha256: string; sizeBytes: number }>,
): string =>
  sha256(
    JSON.stringify({
      domain: "nhm2_formal_kernel_output_inventory/v1",
      entries: entries.map(({ relativePath, sha256: digest, sizeBytes }) => ({
        relativePath,
        sha256: digest,
        sizeBytes,
      })),
    }),
  );

const outerInventorySha256 = (
  entries: Array<{ path: string; sha256: string; sizeBytes: number }>,
): string =>
  sha256(
    `nhm2_formal_outer_inventory/v1\0${JSON.stringify(
      entries.map((entry) => [entry.path, entry.sha256, entry.sizeBytes]),
    )}`,
  );

const ledger = (
  kind: Nhm2FormalKernelLedgerKind,
  rootPath: string,
  entries: Nhm2FormalKernelLedgerEntryV1[],
): Nhm2FormalKernelSealedLedgerV1 => ({
  kind,
  rootPath,
  entries,
  ledgerSha256: computeNhm2FormalKernelLedgerSha256({ kind, entries }),
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const makeFixture = (): BuildNhm2FormalOuterObservationEvidenceInput => {
  const fixtureRoot = path.resolve(".tmp/nhm2-formal-evidence-fixture");
  const sourceRoot = path.join(fixtureRoot, "source");
  const toolchainRoot = path.join(fixtureRoot, "toolchain");
  const inputRoot = path.join(fixtureRoot, "input");
  const outputRoot = path.join(fixtureRoot, "output");
  const replayOne = path.join(outputRoot, "replay-one");
  const replayTwo = path.join(outputRoot, "replay-two");
  const leanPath = path.join(toolchainRoot, "bin", "lean.exe");
  const lakePath = path.join(toolchainRoot, "bin", "lake.exe");
  const driverPath = path.join(sourceRoot, "ExperimentReadyReplayDriver.lean");
  const outputPath = "proof.olean";

  const sourceLedger = ledger("source", sourceRoot, [
    {
      relativePath: "ExperimentReadyReplayDriver.lean",
      sha256: hash("1"),
      sizeBytes: 420,
    },
  ]);
  const toolchainLedger = ledger("toolchain", toolchainRoot, [
    { relativePath: "bin/lake.exe", sha256: hash("2"), sizeBytes: 2_000 },
    { relativePath: "bin/lean.exe", sha256: hash("3"), sizeBytes: 3_000 },
  ]);
  const inputLedger = ledger("input", inputRoot, [
    {
      relativePath: "candidate.json",
      sha256: hash("4"),
      sizeBytes: 4_000,
    },
  ]);

  const plan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1 = {
    planRole: "formal_kernel",
    requestId: "formal-request-001",
    runId: "formal-run-001",
    receiptId: "formal-receipt-001",
    runtimeId: "formal-runtime-001",
    sourceCommitSha: "a".repeat(40),
    deterministicSeedPolicy: "formal_kernel_deterministic_no_rng/v1",
    solver: {
      artifactId: "nhm2.formal_outer_wrapper",
      contractVersion: "nhm2_formal_outer_wrapper/v1",
      path: "tools/nhm2/run-experiment-ready-theory-formal.ts",
      sha256: hash("5"),
      solverId: "nhm2_formal_outer_wrapper",
      solverVersion: "1.0.0",
      implementationId: "direct_lean_outer_observer",
    },
    environmentLock: {
      artifactId: "nhm2.formal_environment_lock",
      contractVersion: "nhm2_formal_environment_lock/v1",
      path: "formal/environment-lock.json",
      sha256: hash("6"),
      environmentId: "formal-environment-001",
    },
    expectedInvocation: {
      entrypoint: "tools/nhm2/run-experiment-ready-theory-formal.ts",
      command: "tsx",
      args: ["--candidate-manifest", "candidate.json"],
      cwd: ".",
      environment: [],
      outputDirectory: "artifacts/formal-run-001",
    },
  };

  const identity = {
    candidateId: "nhm2-candidate-001",
    candidateManifestId: "nhm2-candidate-manifest-001",
    candidateManifestSha256: hash("4"),
    candidateFrozenAt: "2026-07-19T10:00:00.000Z",
    requestId: plan.requestId,
    runId: plan.runId,
    receiptId: plan.receiptId,
    runtimeId: plan.runtimeId,
    sourceCommitSha: plan.sourceCommitSha,
  };
  const formalClaimBoundary = {
    formalLogicReplayOnly: true,
    outerObservedExecutionOnly: true,
    numericalPhysicsValidated: false,
    empiricalValidationEstablished: false,
    experimentReadyTheoryClosureClaimAllowed: false,
    physicalViabilityClaimAllowed: false,
    transportClaimAllowed: false,
    propulsionClaimAllowed: false,
    routeEtaClaimAllowed: false,
    speedAuthorityClaimAllowed: false,
  } as const;
  const executor: Nhm2FormalKernelPresealedRunSpecV1 = {
    theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
    executableRole: "lean",
    executables: {
      lean: { absolutePath: leanPath, sha256: hash("3"), sizeBytes: 3_000 },
      lake: { absolutePath: lakePath, sha256: hash("2"), sizeBytes: 2_000 },
    },
    ledgers: {
      source: sourceLedger,
      toolchain: toolchainLedger,
      input: inputLedger,
    },
    outputRoot,
    replayWorkdirs: [replayOne, replayTwo],
    environmentAllowlist: ["LEAN_PATH"],
    environment: { LEAN_PATH: sourceRoot },
    executableArguments: [driverPath, "-o", outputPath],
    expectedOutputPaths: [outputPath],
    timeoutMs: 60_000,
    maxCapturedOutputBytes: 1_048_576,
  };
  const spec: Nhm2ExperimentReadyTheoryFormalRunSpecV1 = {
    artifactId: NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
    contractVersion:
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
    generatedAt: "2026-07-19T10:00:01.000Z",
    sealedAt: "2026-07-19T10:00:02.000Z",
    identity,
    planBinding: clone(plan),
    theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
    formalSourceBindings: {
      authority: "server_owned_formal_project",
      projectRoot: sourceRoot,
      entries: [
        {
          sourceRole: "replay_driver",
          path: driverPath,
          sha256: hash("1"),
          sizeBytes: 420,
        },
      ],
    },
    toolchainBindings: {
      authority: "sealed_lean_toolchain",
      toolchainRoot,
      entries: [
        {
          toolchainRole: "lake_executable",
          path: lakePath,
          sha256: hash("2"),
          sizeBytes: 2_000,
        },
        {
          toolchainRole: "lean_executable",
          path: leanPath,
          sha256: hash("3"),
          sizeBytes: 3_000,
        },
      ],
    },
    executor: clone(executor),
    outerArtifactPath: path.join(
      outputRoot,
      "formal-kernel-execution-observation.json",
    ),
    claimBoundary: formalClaimBoundary,
  };

  const stdout = `${NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER}\n${NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER}\n`;
  const stderr = "";
  const output = {
    relativePath: outputPath,
    sha256: hash("7"),
    sizeBytes: 7_000,
    modifiedAt: "2026-07-19T10:00:05.500Z",
    freshness: "new",
  } as const;
  const makeLedgerObservation = (kind: Nhm2FormalKernelLedgerKind) => ({
    kind,
    observedAt: "2026-07-19T10:00:03.000Z",
    ledgerSha256: executor.ledgers[kind].ledgerSha256,
    entryCount: executor.ledgers[kind].entries.length,
    entries: clone(executor.ledgers[kind].entries),
  });
  const makeReplay = (replayIndex: 1 | 2, cwd: string) => ({
    replayIndex,
    executableRole: "lean" as const,
    process: {
      executableRole: "lean" as const,
      command: leanPath,
      args: [...executor.executableArguments],
      cwd,
      environment: { ...executor.environment },
      startedAt:
        replayIndex === 1
          ? "2026-07-19T10:00:05.000Z"
          : "2026-07-19T10:00:06.000Z",
      completedAt:
        replayIndex === 1
          ? "2026-07-19T10:00:06.000Z"
          : "2026-07-19T10:00:07.000Z",
      durationMs: 1_000,
      exitCode: 0,
      signal: null,
      stdout,
      stderr,
      stdoutSha256: sha256(Buffer.from(stdout, "utf8")),
      stderrSha256: sha256(Buffer.from(stderr, "utf8")),
      stdoutBytes: Buffer.byteLength(stdout, "utf8"),
      stderrBytes: Buffer.byteLength(stderr, "utf8"),
      timedOut: false,
      outputLimitExceeded: false,
      spawnError: null,
    },
    transcript: {
      theoremMarker: NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
      axiomMarker: NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
    },
    outputInventorySha256: outputInventorySha256([output]),
    outputs: [clone(output)],
    postRunLedgers: {
      source: makeLedgerObservation("source"),
      toolchain: makeLedgerObservation("toolchain"),
      input: makeLedgerObservation("input"),
    },
  });
  const observation: Nhm2FormalKernelExecutionObservationV1 = {
    artifactId: "nhm2.formal_kernel_execution_observation",
    contractVersion: "nhm2_formal_kernel_execution_observation/v1",
    generatedAt: "2026-07-19T10:00:08.000Z",
    status: "pass",
    theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
    executableRole: "lean",
    executables: clone(executor.executables),
    preRunLedgers: {
      source: makeLedgerObservation("source"),
      toolchain: makeLedgerObservation("toolchain"),
      input: makeLedgerObservation("input"),
    },
    replays: [makeReplay(1, replayOne), makeReplay(2, replayTwo)],
    replayAgreement: {
      executableRolesExact: true,
      commandsExact: true,
      environmentsExact: true,
      transcriptsExact: true,
      outputInventoriesExact: true,
      sealedLedgersStable: true,
    },
    claimBoundary: {
      formalLogicReplayOnly: true,
      numericalPhysicsValidated: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
      operatingSystemHermeticityAsserted: false,
      filesystemSandboxAsserted: false,
    },
  };
  const outerEntries = [
    {
      path: `replay-one/${outputPath}`,
      sha256: output.sha256,
      sizeBytes: output.sizeBytes,
    },
    {
      path: `replay-two/${outputPath}`,
      sha256: output.sha256,
      sizeBytes: output.sizeBytes,
    },
  ];
  const specBytes = Buffer.from(JSON.stringify(spec), "utf8");
  const artifact: Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1 = {
    artifactId: NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
    contractVersion:
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
    generatedAt: observation.generatedAt,
    identity,
    inputs: {
      candidateManifest: {
        path: "candidate.json",
        sha256: hash("4"),
        sizeBytes: 4_000,
      },
      formalRunSpec: {
        path: "formal-run-spec.json",
        sha256: sha256(specBytes),
        sizeBytes: specBytes.byteLength,
      },
    },
    planRole: "formal_kernel",
    theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
    replayOutputInventory: {
      algorithm: "sha256_canonical_tuple_list/v1",
      entries: outerEntries,
      inventorySha256: outerInventorySha256(outerEntries),
    },
    executionObservation: observation,
    claimBoundary: formalClaimBoundary,
  };
  return {
    executionArtifact: artifact,
    executionObservation: observation,
    trustedContext: {
      candidate: {
        candidateId: identity.candidateId,
        candidateManifestId: identity.candidateManifestId,
        candidateManifestPath: "candidate.json",
        candidateManifestSha256: identity.candidateManifestSha256,
        candidateManifestSizeBytes: 4_000,
        candidateFrozenAt: identity.candidateFrozenAt,
        claimBoundary: {
          preRunManifestOnly: true,
          evaluatorMustVerifyFrozenAtBeforeExecutionStart: true,
          evaluatorMustResolveCandidateManifestRawShaBeforeSpawn: true,
          postRunTimingAndArtifactHashesForbiddenHere: true,
          detachedPolicyArtifactMustValidate: true,
          manifestReadinessCannotEstablishTheoryClosure: true,
          experimentReadyTheoryClosureClaimAllowed: false,
          physicalViabilityStatus: "blocked_pending_empirical_receipts",
          physicalViabilityClaimAllowed: false,
          transportClaimAllowed: false,
          propulsionClaimAllowed: false,
          routeEtaClaimAllowed: false,
          speedAuthorityClaimAllowed: false,
          empiricalReceiptsRequiredForPhysicalPromotion: true,
        },
      },
      formalPlan: clone(plan),
      formalRunSpec: {
        path: "formal-run-spec.json",
        sha256: sha256(specBytes),
        sizeBytes: specBytes.byteLength,
        value: spec,
      },
    },
  };
};

const resealSpec = (
  fixture: BuildNhm2FormalOuterObservationEvidenceInput,
): void => {
  const bytes = Buffer.from(
    JSON.stringify(fixture.trustedContext.formalRunSpec.value),
    "utf8",
  );
  fixture.trustedContext.formalRunSpec.sha256 = sha256(bytes);
  fixture.trustedContext.formalRunSpec.sizeBytes = bytes.byteLength;
  fixture.executionArtifact.inputs.formalRunSpec.sha256 = sha256(bytes);
  fixture.executionArtifact.inputs.formalRunSpec.sizeBytes = bytes.byteLength;
};

const keepEmbeddedObservationExact = (
  fixture: BuildNhm2FormalOuterObservationEvidenceInput,
): void => {
  fixture.executionArtifact.executionObservation = fixture.executionObservation;
};

describe("NHM2 outer-observed formal evidence adapter", () => {
  it("passes only the native direct-Lean claim-lock theorem and closes every physics claim", () => {
    const certificate = buildNhm2FormalOuterObservationEvidence(makeFixture());

    expect(certificate.contractVersion).toBe(
      NHM2_FORMAL_OUTER_OBSERVATION_EVIDENCE_CONTRACT_VERSION,
    );
    expect(certificate.contractVersion).toBe(
      "nhm2_formal_manifest_certificate/v2",
    );
    expect(certificate.supersedesContractVersions).toEqual([
      "nhm2_formal_manifest_certificate/v1",
      "nhm2_formal_kernel_replay_manifest/v1",
    ]);
    expect(certificate.blockers).toEqual([]);
    expect(certificate.status).toBe("pass");
    expect(certificate.formalClaim).toMatchObject({
      theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
      theoremResult: "proved",
      nativeAxiomAudit: "no_axioms",
      replayCount: 2,
    });
    expect(certificate.checks.every((entry) => entry.status === "pass")).toBe(
      true,
    );
    expect(certificate.claimBoundary).toEqual({
      formalLogicReplayOnly: true,
      outerObservedExecutionOnly: true,
      numericalPhysicsValidated: false,
      theoryClosureEstablished: false,
      empiricalValidationEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      speedAuthorityEstablished: false,
    });
  });

  it("fails a forged theorem transcript even if its hashes are recomputed", () => {
    const fixture = makeFixture();
    for (const replay of fixture.executionObservation.replays) {
      replay.process.stdout = replay.process.stdout.replace(
        NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
        "NHM2_FORMAL_THEOREM forged PROVED",
      );
      replay.process.stdoutBytes = Buffer.byteLength(replay.process.stdout);
      replay.process.stdoutSha256 = sha256(replay.process.stdout);
    }
    keepEmbeddedObservationExact(fixture);

    const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
    expect(certificate.status).toBe("fail");
    expect(certificate.blockers).toContain(
      "formal_native_theorem_or_no_axiom_transcript_mismatch",
    );
    expect(certificate.formalClaim.theoremResult).toBe("not_certified");
  });

  it("fails a child-authored pass status when the observed process failed", () => {
    const fixture = makeFixture();
    fixture.executionObservation.replays[0].process.exitCode = 1;
    keepEmbeddedObservationExact(fixture);

    const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
    expect(certificate.status).toBe("fail");
    expect(certificate.blockers).toContain(
      "formal_two_distinct_cold_replays_missing_or_failed",
    );
  });

  it("fails when only one replay is presented", () => {
    const fixture = makeFixture();
    (
      fixture.executionObservation as unknown as {
        replays: Nhm2FormalKernelExecutionObservationV1["replays"][number][];
      }
    ).replays = [fixture.executionObservation.replays[0]];
    keepEmbeddedObservationExact(fixture);

    const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
    expect(certificate.status).toBe("fail");
    expect(certificate.blockers).toContain(
      "formal_two_distinct_cold_replays_missing_or_failed",
    );
  });

  it("fails a mutated post-run sealed ledger", () => {
    const fixture = makeFixture();
    fixture.executionObservation.replays[1].postRunLedgers.source.entries[0].sha256 =
      hash("f");
    keepEmbeddedObservationExact(fixture);

    const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
    expect(certificate.status).toBe("fail");
    expect(certificate.blockers).toContain(
      "formal_sealed_source_toolchain_or_input_ledger_mismatch",
    );
  });

  it("rejects Lake even when every presented command role is internally consistent", () => {
    const fixture = makeFixture();
    fixture.trustedContext.formalRunSpec.value.executor.executableRole = "lake";
    fixture.executionObservation.executableRole = "lake";
    for (const replay of fixture.executionObservation.replays) {
      replay.executableRole = "lake";
      replay.process.executableRole = "lake";
      replay.process.command =
        fixture.executionObservation.executables.lake.absolutePath;
    }
    resealSpec(fixture);
    keepEmbeddedObservationExact(fixture);

    const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
    expect(certificate.status).toBe("fail");
    expect(certificate.blockers).toContain(
      "formal_direct_lean_role_or_command_mismatch",
    );
  });

  it("fails any candidate identity mismatch", () => {
    const fixture = makeFixture();
    fixture.executionArtifact.identity.candidateId = "different-candidate";

    const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
    expect(certificate.status).toBe("fail");
    expect(certificate.blockers).toContain(
      "formal_candidate_run_request_receipt_runtime_or_plan_binding_mismatch",
    );
  });

  it.each(["candidate", "run_spec", "outer_artifact", "observation"] as const)(
    "fails an opened physical-viability claim in the %s layer",
    (layer) => {
      const fixture = makeFixture();
      if (layer === "candidate") {
        (
          fixture.trustedContext.candidate.claimBoundary as unknown as {
            physicalViabilityClaimAllowed: boolean;
          }
        ).physicalViabilityClaimAllowed = true;
      } else if (layer === "run_spec") {
        (
          fixture.trustedContext.formalRunSpec.value
            .claimBoundary as unknown as {
            physicalViabilityClaimAllowed: boolean;
          }
        ).physicalViabilityClaimAllowed = true;
        resealSpec(fixture);
      } else if (layer === "outer_artifact") {
        (
          fixture.executionArtifact.claimBoundary as unknown as {
            physicalViabilityClaimAllowed: boolean;
          }
        ).physicalViabilityClaimAllowed = true;
      } else {
        (
          fixture.executionObservation.claimBoundary as unknown as {
            physicalViabilityClaimAllowed: boolean;
          }
        ).physicalViabilityClaimAllowed = true;
        keepEmbeddedObservationExact(fixture);
      }

      const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
      expect(certificate.status).toBe("fail");
      expect(certificate.blockers).toContain(
        "formal_or_physical_claim_lock_opened",
      );
      expect(certificate.claimBoundary.physicalViabilityEstablished).toBe(
        false,
      );
    },
  );

  it.each([
    "numericalPhysicsValidated",
    "empiricalValidationEstablished",
    "experimentReadyTheoryClosureClaimAllowed",
    "physicalViabilityClaimAllowed",
    "transportClaimAllowed",
    "propulsionClaimAllowed",
    "routeEtaClaimAllowed",
    "speedAuthorityClaimAllowed",
  ] as const)("fails when the outer artifact opens %s", (claim) => {
    const fixture = makeFixture();
    (
      fixture.executionArtifact.claimBoundary as unknown as Record<
        string,
        boolean
      >
    )[claim] = true;

    const certificate = buildNhm2FormalOuterObservationEvidence(fixture);
    expect(certificate.status).toBe("fail");
    expect(certificate.blockers).toContain(
      "formal_or_physical_claim_lock_opened",
    );
    expect(certificate.claimBoundary.formalLogicReplayOnly).toBe(true);
    expect(certificate.claimBoundary.outerObservedExecutionOnly).toBe(true);
    expect(certificate.claimBoundary.numericalPhysicsValidated).toBe(false);
    expect(certificate.claimBoundary.theoryClosureEstablished).toBe(false);
    expect(certificate.claimBoundary.physicalViabilityEstablished).toBe(false);
  });
});
