import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildCasimirFormalLeanReplayPolicyV1 } from "../../../../shared/contracts/casimir-formal-lean-replay-policy.v1";
import { buildCasimirFormalVerificationRequestV1 } from "../../../../shared/contracts/casimir-formal-verification-request.v1";
import {
  createCasimirFormalVerifierJobService,
  installCasimirFormalVerifierDependenciesForServerV1,
  planCasimirFormalVerifierJobV1,
  readCasimirFormalVerifierJobResultV1,
  startCasimirFormalVerifierJobV1,
  type CasimirFormalVerifierSealedInputV1,
} from "../casimir-formal-verifier-job-service";
import {
  buildRuntimeToolConfirmationTestReceipt,
  createTrustedRuntimeTestReplayLedger,
  verifyTrustedRuntimeTestReceipt,
} from "./runtime-tool-confirmation-fixture";

const roots: string[] = [];
const hash = (digit: string): string => digit.repeat(64);
const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  installCasimirFormalVerifierDependenciesForServerV1({});
  while (roots.length > 0) {
    const root = roots.pop();
    if (root && path.resolve(root).startsWith(path.resolve(os.tmpdir()))) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeFixture(): Promise<{
  executablePath: string;
  sealedInput: CasimirFormalVerifierSealedInputV1;
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "casimir-formal-verifier-test-"),
  );
  roots.push(root);
  const executablePath = path.join(root, "lean.exe");
  const theoremSourcePath = path.join(root, "CasimirDemo.lean");
  const executableBytes = Buffer.from("sealed-test-lean");
  const theoremSource =
    "theorem casimir_formal_verifier_demo : True := by\n  trivial\n";
  await fs.writeFile(executablePath, executableBytes);
  await fs.writeFile(theoremSourcePath, theoremSource, "utf8");

  const policy = await buildCasimirFormalLeanReplayPolicyV1({
    policyId: "formal-verifier-job-policy",
    pinnedVersion: "4.31.0",
    kernelBinarySha256: sha256(executableBytes),
    allowedImportModules: [],
    resourceCeilings: {
      timeoutMs: 30_000,
      maxMemoryBytes: 256 * 1024 * 1024,
      maxOutputBytes: 32 * 1024,
      maxSourceBytes: 32 * 1024,
      maxImportCount: 4,
    },
  });
  const request = await buildCasimirFormalVerificationRequestV1({
    generatedAt: "2026-07-24T12:00:00.000Z",
    requestId: "formal-verifier-job-request",
    casimirSpec: {
      specId: "spec.formal-verifier-job",
      schemaVersion: "casimir_spec_scientific_claim_ir/v1",
      semanticSha256: hash("a"),
      artifactSha256: hash("b"),
    },
    claim: {
      claimId: "claim.formal-verifier-job",
      propositionSha256: hash("c"),
    },
    formalArtifact: {
      theoremName: "casimir_formal_verifier_demo",
      theoremModule: "CasimirDemo",
      statementSha256: hash("c"),
      sourceSha256: sha256(theoremSource),
      emitterId: "casimir-formal-verifier-test-emitter",
      emitterRevisionSha256: hash("d"),
    },
    masterProblem: {
      schemaVersion: "theory_master_problem/v1",
      planId: "master-formal-verifier-job",
      artifactSha256: hash("e"),
    },
    derivationProgram: {
      schemaVersion: "theory_derivation_program/v1",
      programId: "program-formal-verifier-job",
      sourceMasterProblemPlanId: "master-formal-verifier-job",
      artifactSha256: hash("f"),
    },
    theoryGraph: {
      graphId: "graph-formal-verifier-job",
      snapshotSha256: hash("1"),
    },
    catalogSnapshots: [],
    formalEnvironment: {
      prover: "lean4",
      toolchainPolicyId: policy.policyId,
      toolchainPolicySha256: policy.artifactSha256,
      pinnedVersion: policy.pinnedVersion,
      imports: [],
      declaredAxiomIds: [],
      allowedAxiomIds: [],
    },
    executionPolicy: {
      replayCount: 2,
      timeoutMs: 20_000,
      maxMemoryBytes: 128 * 1024 * 1024,
      maxOutputBytes: 16 * 1024,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
    },
  });
  return {
    executablePath,
    sealedInput: {
      request,
      policy,
      theoremSourcePath,
      importSourcePaths: {},
    },
  };
}

async function waitForResult(
  service: ReturnType<typeof createCasimirFormalVerifierJobService>,
  jobId: string,
  profileId: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = service.readResult({
      accountType: "developer",
      profileId,
      jobId,
    });
    if (result.status !== "running") return result;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("formal verifier test job did not complete");
}

describe("Casimir formal verifier job service", () => {
  it("fails closed on malformed sealed request and policy packets", async () => {
    const service = createCasimirFormalVerifierJobService();
    const malformed = await service.plan({
      accountType: "developer",
      profileId: "profile:developer",
      sealedInput: {
        request: {},
        policy: {},
        theoremSourcePath: "",
        importSourcePaths: {},
      } as unknown as CasimirFormalVerifierSealedInputV1,
    });

    expect(malformed).toMatchObject({
      ok: false,
      status: "blocked",
      planId: null,
      requestId: null,
      requestArtifactSha256: null,
      policyArtifactSha256: null,
      confirmationRequired: true,
      nextCapability: "repair_formal_verification_inputs",
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        postToolModelStepRequired: true,
      },
    });
    expect(malformed.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^request:/),
        expect.stringMatching(/^policy:/),
      ]),
    );
  });

  it("keeps planning developer-only and evidence-only", async () => {
    const fixture = await makeFixture();
    const service = createCasimirFormalVerifierJobService({
      resolveLeanExecutablePath: () => fixture.executablePath,
    });
    const blocked = await service.plan({
      accountType: "user",
      profileId: "profile:user",
      sealedInput: fixture.sealedInput,
    });
    const ready = await service.plan({
      accountType: "developer",
      profileId: "profile:developer",
      sealedInput: fixture.sealedInput,
    });

    expect(blocked).toMatchObject({
      ok: false,
      status: "blocked",
      issues: expect.arrayContaining(["developer_account_required"]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        validatesTheory: false,
        validatesEmpiricalClaim: false,
      },
    });
    expect(ready).toMatchObject({
      ok: true,
      status: "ready",
      confirmationRequired: true,
      nextCapability: "theory-formal-verifier.start",
    });
    expect(ready.planId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("routes default wrappers only through trusted server-bootstrap dependencies", async () => {
    const fixture = await makeFixture();
    const profileId = "profile:server-bootstrap";
    const sessionId = "session:server-bootstrap";
    const turnId = "ask:server-bootstrap";
    installCasimirFormalVerifierDependenciesForServerV1({
      resolveLeanExecutablePath: () => fixture.executablePath,
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      confirmationReplayLedger: createTrustedRuntimeTestReplayLedger(),
      now: () => Date.parse("2026-07-25T00:02:00.000Z"),
      runner: async () => ({
        startedAt: "2026-07-24T12:00:01.000Z",
        completedAt: "2026-07-24T12:00:02.000Z",
        exitCode: 0,
        signal: null,
        stdout:
          "casimir_formal_verifier_demo : True\n'casimir_formal_verifier_demo' does not depend on any axioms\n",
        stderr: "",
        timedOut: false,
        outputLimitExceeded: false,
        spawnError: null,
      }),
    });

    const planned = await planCasimirFormalVerifierJobV1({
      accountType: "developer",
      profileId,
      sealedInput: fixture.sealedInput,
    });
    const approvalReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: "theory-formal-verifier.start",
        planId: planned.planId as string,
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInputSha256: planned.sealedInputSha256 as string,
      },
    });
    const started = await startCasimirFormalVerifierJobV1({
      accountType: "developer",
      profileId,
      sessionId,
      turnId,
      sealedInput: fixture.sealedInput,
      planId: planned.planId,
      approvalReceipt,
    });
    expect(started).toMatchObject({
      ok: true,
      status: "running",
    });

    let completed = readCasimirFormalVerifierJobResultV1({
      accountType: "developer",
      profileId,
      jobId: started.jobId,
    });
    for (
      let attempt = 0;
      attempt < 50 && completed.status === "running";
      attempt += 1
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      completed = readCasimirFormalVerifierJobResultV1({
        accountType: "developer",
        profileId,
        jobId: started.jobId,
      });
    }
    expect(completed).toMatchObject({
      ok: true,
      status: "completed",
      certificate: { status: "passed" },
    });

    installCasimirFormalVerifierDependenciesForServerV1({});
    expect(
      await planCasimirFormalVerifierJobV1({
        accountType: "developer",
        profileId,
        sealedInput: fixture.sealedInput,
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      issues: expect.arrayContaining(["lean_executable_not_configured"]),
    });
  });

  it("requires a matching plan and runtime approval before starting", async () => {
    const fixture = await makeFixture();
    const service = createCasimirFormalVerifierJobService({
      resolveLeanExecutablePath: () => fixture.executablePath,
    });
    const planned = await service.plan({
      accountType: "developer",
      profileId: "profile:developer",
      sealedInput: fixture.sealedInput,
    });
    const mismatched = await service.start({
      accountType: "developer",
      profileId: "profile:developer",
      sealedInput: fixture.sealedInput,
      planId: hash("0"),
      approvalToken: "runtime-approved",
    });
    const unconfirmed = await service.start({
      accountType: "developer",
      profileId: "profile:developer",
      sealedInput: fixture.sealedInput,
      planId: planned.planId,
    });
    const legacy = await service.start({
      accountType: "developer",
      profileId: "profile:developer",
      sealedInput: fixture.sealedInput,
      planId: planned.planId,
      approvalToken: "runtime-approved",
    });

    expect(mismatched).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["formal_verifier_plan_id_mismatch"],
    });
    expect(unconfirmed).toMatchObject({
      ok: false,
      status: "needs_confirmation",
      issues: ["runtime_approval_receipt_required"],
      nextCapability: "request_user_confirmation",
    });
    expect(legacy).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_legacy_token_rejected"],
    });
  });

  it("returns a profile-scoped non-terminal certificate after confirmed replay", async () => {
    const fixture = await makeFixture();
    const service = createCasimirFormalVerifierJobService({
      resolveLeanExecutablePath: () => fixture.executablePath,
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      confirmationReplayLedger: createTrustedRuntimeTestReplayLedger(),
      now: () => Date.parse("2026-07-25T00:02:00.000Z"),
      runner: async () => ({
        startedAt: "2026-07-24T12:00:01.000Z",
        completedAt: "2026-07-24T12:00:02.000Z",
        exitCode: 0,
        signal: null,
        stdout:
          "casimir_formal_verifier_demo : True\n'casimir_formal_verifier_demo' does not depend on any axioms\n",
        stderr: "",
        timedOut: false,
        outputLimitExceeded: false,
        spawnError: null,
      }),
    });
    const profileId = "profile:developer";
    const planned = await service.plan({
      accountType: "developer",
      profileId,
      sealedInput: fixture.sealedInput,
    });
    const sessionId = "session:formal-verifier";
    const turnId = "ask:formal-verifier";
    const approvalReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: "theory-formal-verifier.start",
        planId: planned.planId as string,
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInputSha256: planned.sealedInputSha256 as string,
      },
    });
    const started = await service.start({
      accountType: "developer",
      profileId,
      sealedInput: fixture.sealedInput,
      planId: planned.planId,
      sessionId,
      turnId,
      approvalReceipt,
    });

    expect(started).toMatchObject({
      ok: true,
      status: "running",
      nextCapability: "theory-formal-verifier.read_result",
    });
    const crossProfile = service.readResult({
      accountType: "developer",
      profileId: "profile:other",
      jobId: started.jobId,
    });
    expect(crossProfile).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["formal_verifier_job_not_found"],
    });

    const result = await waitForResult(
      service,
      started.jobId as string,
      profileId,
    );
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      certificate: {
        status: "passed",
        authority: {
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
        },
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        postToolModelStepRequired: true,
      },
    });

    const replayed = await service.start({
      accountType: "developer",
      profileId,
      sealedInput: fixture.sealedInput,
      planId: planned.planId,
      sessionId,
      turnId,
      approvalReceipt,
    });
    expect(replayed).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_already_consumed"],
    });
  });

  it("fails closed on unconfigured, mismatched, and expired runtime receipts", async () => {
    const fixture = await makeFixture();
    const profileId = "profile:developer";
    const sessionId = "session:formal-verifier";
    const turnId = "ask:formal-verifier";
    const unconfigured = createCasimirFormalVerifierJobService({
      resolveLeanExecutablePath: () => fixture.executablePath,
    });
    const unconfiguredPlan = await unconfigured.plan({
      accountType: "developer",
      profileId,
      sealedInput: fixture.sealedInput,
    });
    const unconfiguredReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: "theory-formal-verifier.start",
        planId: unconfiguredPlan.planId as string,
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInputSha256: unconfiguredPlan.sealedInputSha256 as string,
      },
    });
    expect(
      await unconfigured.start({
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInput: fixture.sealedInput,
        planId: unconfiguredPlan.planId,
        approvalReceipt: unconfiguredReceipt,
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_issuer_unconfigured"],
    });

    const noLedger = createCasimirFormalVerifierJobService({
      resolveLeanExecutablePath: () => fixture.executablePath,
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      now: () => Date.parse("2026-07-25T00:02:00.000Z"),
    });
    const noLedgerPlan = await noLedger.plan({
      accountType: "developer",
      profileId,
      sealedInput: fixture.sealedInput,
    });
    const noLedgerReceipt = await buildRuntimeToolConfirmationTestReceipt({
      requestId: "runtime-confirmation-request:no-ledger",
      receiptId: "runtime-confirmation-receipt:no-ledger",
      binding: {
        capabilityId: "theory-formal-verifier.start",
        planId: noLedgerPlan.planId as string,
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInputSha256: noLedgerPlan.sealedInputSha256 as string,
      },
    });
    expect(
      await noLedger.start({
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInput: fixture.sealedInput,
        planId: noLedgerPlan.planId,
        approvalReceipt: noLedgerReceipt,
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_replay_ledger_unconfigured"],
    });

    const service = createCasimirFormalVerifierJobService({
      resolveLeanExecutablePath: () => fixture.executablePath,
      verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
      confirmationReplayLedger: createTrustedRuntimeTestReplayLedger(),
      now: () => Date.parse("2026-07-25T00:10:00.000Z"),
    });
    const planned = await service.plan({
      accountType: "developer",
      profileId,
      sealedInput: fixture.sealedInput,
    });
    const wrongTurn = await buildRuntimeToolConfirmationTestReceipt({
      requestId: "runtime-confirmation-request:wrong-turn",
      receiptId: "runtime-confirmation-receipt:wrong-turn",
      binding: {
        capabilityId: "theory-formal-verifier.start",
        planId: planned.planId as string,
        accountType: "developer",
        profileId,
        sessionId,
        turnId: "ask:other-turn",
        sealedInputSha256: planned.sealedInputSha256 as string,
      },
      expiresAt: "2026-07-25T00:15:00.000Z",
    });
    expect(
      await service.start({
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInput: fixture.sealedInput,
        planId: planned.planId,
        approvalReceipt: wrongTurn,
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_binding_mismatch:turnId"],
    });

    const expired = await buildRuntimeToolConfirmationTestReceipt({
      requestId: "runtime-confirmation-request:expired",
      receiptId: "runtime-confirmation-receipt:expired",
      binding: {
        capabilityId: "theory-formal-verifier.start",
        planId: planned.planId as string,
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInputSha256: planned.sealedInputSha256 as string,
      },
      issuedAt: "2026-07-25T00:00:00.000Z",
      approvedAt: "2026-07-25T00:01:00.000Z",
      expiresAt: "2026-07-25T00:05:00.000Z",
    });
    expect(
      await service.start({
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        sealedInput: fixture.sealedInput,
        planId: planned.planId,
        approvalReceipt: expired,
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_expired"],
    });
  });
});
