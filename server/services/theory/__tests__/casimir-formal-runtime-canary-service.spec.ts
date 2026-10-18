import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CASIMIR_FORMAL_RUNTIME_CANARY_REPLAY_REPORT_SCHEMA,
  THEORY_RUNTIME_CANARY_START_CAPABILITY,
  createCasimirFormalRuntimeCanaryService,
} from "../casimir-formal-runtime-canary-service";
import {
  buildRuntimeToolConfirmationTestReceipt,
  createTrustedRuntimeTestReplayLedger,
  verifyTrustedRuntimeTestReceipt,
} from "./runtime-tool-confirmation-fixture";

const repositoryRoot = path.resolve(process.cwd());
const leanExecutablePath = path.join(
  os.homedir(),
  ".elan",
  "toolchains",
  "leanprover--lean4---v4.31.0",
  "bin",
  "lean.exe",
);
const exactRuntimeAvailable =
  process.platform === "win32" &&
  process.arch === "x64" &&
  fs.existsSync(leanExecutablePath) &&
  fs.existsSync(
    path.join(
      repositoryRoot,
      "formal",
      "lean",
      "CasimirFormalRuntimeSelfTest.lean",
    ),
  );

const waitForResult = async (
  service: ReturnType<typeof createCasimirFormalRuntimeCanaryService>,
  input: {
    profileId: string;
    jobId: string;
  },
) => {
  let result = await service.readResult({
    accountType: "developer",
    profileId: input.profileId,
    jobId: input.jobId,
  });
  for (
    let attempt = 0;
    attempt < 50 && result.status === "running";
    attempt += 1
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    result = await service.readResult({
      accountType: "developer",
      profileId: input.profileId,
      jobId: input.jobId,
    });
  }
  return result;
};

describe("Casimir formal runtime canary service", () => {
  it("is developer-only and fail-closed when trusted dependencies are absent", async () => {
    const service = createCasimirFormalRuntimeCanaryService();
    const publicInspection = await service.inspect({
      accountType: "user",
      profileId: "profile:public",
    });
    expect(publicInspection).toMatchObject({
      ok: false,
      status: "blocked",
      authority: {
        nonScientificRuntimeSelfTest: true,
        theoryExperimentFormalClosureEligible: false,
        validatesScientificClaim: false,
        terminalEligible: false,
      },
    });
    expect(publicInspection.issues).toContain("developer_account_required");

    const developerInspection = await service.inspect({
      accountType: "developer",
      profileId: "profile:developer",
    });
    expect(developerInspection).toMatchObject({
      ok: false,
      status: "blocked",
      dependencies: {
        runtimeApprovalHostConfigured: false,
        repositoryRootConfigured: false,
        leanExecutableConfigured: false,
        trustedReceiptVerifierConfigured: false,
        durableReplayLedgerConfigured: false,
      },
    });
  });

  it.skipIf(!exactRuntimeAvailable)(
    "keeps the exact sealed input through confirmation and emits only a non-scientific report",
    async () => {
      let approvalHostConfigured = true;
      const service = createCasimirFormalRuntimeCanaryService({
        resolveRepositoryRoot: () => repositoryRoot,
        resolveLeanExecutablePath: () => leanExecutablePath,
        isRuntimeApprovalHostConfigured: () => approvalHostConfigured,
        verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
        confirmationReplayLedger: createTrustedRuntimeTestReplayLedger(),
        now: () => Date.parse("2026-07-25T00:02:00.000Z"),
        runner: async () => ({
          startedAt: "2026-07-25T00:00:02.000Z",
          completedAt: "2026-07-25T00:00:03.000Z",
          exitCode: 0,
          signal: null,
          stdout:
            "casimir_formal_runtime_self_test_true : True\n'casimir_formal_runtime_self_test_true' does not depend on any axioms\n",
          stderr: "",
          timedOut: false,
          outputLimitExceeded: false,
          spawnError: null,
        }),
      });
      const profileId = "profile:canary";
      const sessionId = "session:canary";
      const turnId = "ask:canary";
      const planned = await service.plan({
        accountType: "developer",
        profileId,
      });
      expect(planned).toMatchObject({
        ok: true,
        status: "ready",
        confirmationRequired: true,
      });

      const unconfirmed = await service.start({
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        planId: planned.planId,
      });
      expect(unconfirmed).toMatchObject({
        ok: false,
        status: "needs_confirmation",
        sealedInputSha256: planned.sealedInputSha256,
      });

      const approvalReceipt =
        await buildRuntimeToolConfirmationTestReceipt({
          binding: {
            capabilityId: THEORY_RUNTIME_CANARY_START_CAPABILITY,
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
        sessionId,
        turnId,
        planId: planned.planId,
        approvalReceipt,
      });
      expect(started).toMatchObject({
        ok: true,
        status: "running",
        sealedInputSha256: planned.sealedInputSha256,
      });

      approvalHostConfigured = false;
      const result = await waitForResult(service, {
        profileId,
        jobId: started.jobId as string,
      });
      expect(result).toMatchObject({
        ok: true,
        status: "completed",
        sealedInputSha256: planned.sealedInputSha256,
        runtimeReplayReport: {
          schema: CASIMIR_FORMAL_RUNTIME_CANARY_REPLAY_REPORT_SCHEMA,
          status: "passed",
          requiredReplayCount: 2,
          completedReplayCount: 2,
          byteIdentical: true,
          blockerCodes: [],
        },
        authority: {
          nonScientificRuntimeSelfTest: true,
          theoryExperimentFormalClosureEligible: false,
          certificatePromotionAllowed: false,
          terminalEligible: false,
        },
      });
      expect(result).not.toHaveProperty("runtimeReplayCertificate");
      expect(result.selfTest).toMatchObject({
        importCount: 0,
        formalArtifactId: "casimir.formal.runtime_self_test.true.source.v1",
      });
    },
  );

  it.skipIf(!exactRuntimeAvailable)(
    "maps a completed failed replay to a failed canary without certificate promotion",
    async () => {
      const service = createCasimirFormalRuntimeCanaryService({
        resolveRepositoryRoot: () => repositoryRoot,
        resolveLeanExecutablePath: () => leanExecutablePath,
        isRuntimeApprovalHostConfigured: () => true,
        verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
        confirmationReplayLedger: createTrustedRuntimeTestReplayLedger(),
        now: () => Date.parse("2026-07-25T00:02:00.000Z"),
        runner: async () => ({
          startedAt: "2026-07-25T00:00:02.000Z",
          completedAt: "2026-07-25T00:00:03.000Z",
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "synthetic Lean failure",
          timedOut: false,
          outputLimitExceeded: false,
          spawnError: null,
        }),
      });
      const profileId = "profile:canary-failed";
      const sessionId = "session:canary-failed";
      const turnId = "ask:canary-failed";
      const planned = await service.plan({
        accountType: "developer",
        profileId,
      });
      const approvalReceipt =
        await buildRuntimeToolConfirmationTestReceipt({
          binding: {
            capabilityId: THEORY_RUNTIME_CANARY_START_CAPABILITY,
            planId: planned.planId as string,
            accountType: "developer",
            profileId,
            sessionId,
            turnId,
            sealedInputSha256: planned.sealedInputSha256 as string,
          },
          requestId: "runtime-confirmation-request:canary-failed",
          receiptId: "runtime-confirmation-receipt:canary-failed",
        });
      const started = await service.start({
        accountType: "developer",
        profileId,
        sessionId,
        turnId,
        planId: planned.planId,
        approvalReceipt,
      });
      const result = await waitForResult(service, {
        profileId,
        jobId: started.jobId as string,
      });
      expect(result).toMatchObject({
        ok: false,
        status: "failed",
        runtimeReplayReport: {
          schema: CASIMIR_FORMAL_RUNTIME_CANARY_REPLAY_REPORT_SCHEMA,
          status: "failed",
        },
        authority: {
          validatesScientificClaim: false,
          certificatePromotionAllowed: false,
          terminalEligible: false,
        },
      });
      expect(result.issues).toContain("formal_runtime_canary_replay_failed");
      expect(result).not.toHaveProperty("runtimeReplayCertificate");
    },
  );
});
