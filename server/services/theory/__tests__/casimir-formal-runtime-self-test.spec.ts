import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCasimirFormalVerificationRequestV1 } from "../../../../shared/contracts/casimir-formal-verification-request.v1";
import {
  CASIMIR_FORMAL_RUNTIME_SELF_TEST_ARTIFACT_ID,
  CASIMIR_FORMAL_RUNTIME_SELF_TEST_ENVIRONMENT_POLICY_ID,
  CASIMIR_FORMAL_RUNTIME_SELF_TEST_LEAN_COMMIT_SHA,
  CASIMIR_FORMAL_RUNTIME_SELF_TEST_LEAN_KERNEL_BINARY_SHA256,
  CASIMIR_FORMAL_RUNTIME_SELF_TEST_LEAN_RELEASE,
  CASIMIR_FORMAL_RUNTIME_SELF_TEST_SOURCE_SHA256,
  inspectCasimirFormalEnvironmentPolicyCatalogV1,
  installCasimirFormalRuntimeSelfTestCatalogForTestsV1,
  resetCasimirFormalEnvironmentPolicyCatalogForTestsV1,
  resolveCasimirFormalEnvironmentPolicyCatalogEntryV1,
} from "../casimir-formal-environment-policy-catalog";
import { replayCasimirFormalLeanRequestV1 } from "../casimir-formal-lean-replay";
import {
  createCasimirFormalVerifierJobService,
  type CasimirFormalVerifierSealedInputV1,
} from "../casimir-formal-verifier-job-service";
import { resetCasimirFormalVerificationPreparationStoreForTests } from "../casimir-formal-verification-preparer";
import {
  THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
  executeTheoryFormalVerifierGatewayCapability,
} from "../../helix-ask/workstation-tool-gateway/theory-formal-verifier";

const REPOSITORY_ROOT = path.resolve(process.cwd());
const PINNED_LEAN_PATH = path.join(
  os.homedir(),
  ".elan",
  "toolchains",
  "leanprover--lean4---v4.31.0",
  "bin",
  "lean.exe",
);
const RUNTIME_AVAILABLE =
  process.platform === "win32" &&
  process.arch === "x64" &&
  fsSync.existsSync(PINNED_LEAN_PATH);
const SELF_TEST_ONLY_STATEMENT_SHA256 = createHash("sha256")
  .update(
    "Casimir non-scientific Lean runtime self-test label; no semantic claim binding",
  )
  .digest("hex");
const tempRoots: string[] = [];

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "casimir-formal-runtime-self-test-"),
  );
  tempRoots.push(root);
  return root;
}

async function installRuntimeSelfTest() {
  return installCasimirFormalRuntimeSelfTestCatalogForTestsV1({
    repositoryRoot: REPOSITORY_ROOT,
    leanExecutablePath: PINNED_LEAN_PATH,
  });
}

async function makeSelfTestSealedInput(input?: {
  imports?: Array<{ module: string; sourcePath: string }>;
}): Promise<CasimirFormalVerifierSealedInputV1> {
  const selfTest = await installRuntimeSelfTest();
  const environment = selfTest.environment;
  const imports = await Promise.all(
    (input?.imports ?? []).map(async (entry) => ({
      module: entry.module,
      sourceSha256: sha256(await fs.readFile(entry.sourcePath)),
    })),
  );
  const request = await buildCasimirFormalVerificationRequestV1({
    generatedAt: "2026-07-26T00:00:00.000Z",
    requestId: "formal-runtime-self-test-only",
    casimirSpec: {
      specId: "runtime-self-test-only:no-scientific-spec",
      schemaVersion: "casimir_spec_scientific_claim_ir/v1",
      semanticSha256: sha256("runtime-self-test-only:semantic-placeholder"),
      artifactSha256: sha256("runtime-self-test-only:artifact-placeholder"),
    },
    claim: {
      claimId: "runtime-self-test-only:not-a-scientific-claim",
      propositionSha256: SELF_TEST_ONLY_STATEMENT_SHA256,
    },
    formalArtifact: {
      theoremName: selfTest.theorem.theoremName,
      theoremModule: selfTest.theorem.theoremModule,
      statementSha256: SELF_TEST_ONLY_STATEMENT_SHA256,
      sourceSha256: selfTest.theorem.sourceSha256,
      emitterId: "casimir.runtime-self-test-only",
      emitterRevisionSha256: selfTest.theorem.sourceSha256,
    },
    masterProblem: {
      schemaVersion: "theory_master_problem/v1",
      planId: "runtime-self-test-only:no-master-problem",
      artifactSha256: sha256("runtime-self-test-only:no-master-problem"),
    },
    derivationProgram: {
      schemaVersion: "theory_derivation_program/v1",
      programId: "runtime-self-test-only:no-derivation-program",
      sourceMasterProblemPlanId: "runtime-self-test-only:no-master-problem",
      artifactSha256: sha256("runtime-self-test-only:no-derivation-program"),
    },
    theoryGraph: {
      graphId: "runtime-self-test-only:no-theory-graph",
      snapshotSha256: sha256("runtime-self-test-only:no-theory-graph"),
    },
    catalogSnapshots: [
      {
        catalogId: "casimir.formal.runtime-self-test-environment/v1",
        snapshotSha256: selfTest.environmentLockSha256,
      },
    ],
    formalEnvironment: {
      prover: "lean4",
      toolchainPolicyId: environment.policyId,
      toolchainPolicySha256: environment.policyArtifactSha256,
      pinnedVersion: environment.policy.pinnedVersion,
      imports,
      declaredAxiomIds: [],
      allowedAxiomIds: [],
    },
    executionPolicy: {
      replayCount: 2,
      timeoutMs: environment.policy.resourceCeilings.timeoutMs,
      maxMemoryBytes: environment.policy.resourceCeilings.maxMemoryBytes,
      maxOutputBytes: environment.policy.resourceCeilings.maxOutputBytes,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
    },
  });
  return {
    request,
    policy: environment.policy,
    theoremSourcePath: selfTest.theorem.absoluteSourcePath,
    importSourcePaths: Object.fromEntries(
      (input?.imports ?? []).map((entry) => [entry.module, entry.sourcePath]),
    ),
  };
}

beforeEach(() => {
  resetCasimirFormalEnvironmentPolicyCatalogForTestsV1();
  resetCasimirFormalVerificationPreparationStoreForTests();
});

afterEach(async () => {
  resetCasimirFormalEnvironmentPolicyCatalogForTestsV1();
  resetCasimirFormalVerificationPreparationStoreForTests();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (
      root &&
      path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    ) {
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  }
});

describe("Casimir formal runtime self-test catalog", () => {
  it("keeps the pinned source in LF form with its exact catalog hash", async () => {
    const sourceBytes = await fs.readFile(
      path.join(
        REPOSITORY_ROOT,
        "formal",
        "lean",
        "CasimirFormalRuntimeSelfTest.lean",
      ),
    );
    expect(sourceBytes.includes(13)).toBe(false);
    expect(sha256(sourceBytes)).toBe(
      CASIMIR_FORMAL_RUNTIME_SELF_TEST_SOURCE_SHA256,
    );
  });

  it.skipIf(!RUNTIME_AVAILABLE)(
    "pins the exact no-import Lean runtime and replays only a non-scientific self-test",
    async () => {
      const sealedInput = await makeSelfTestSealedInput();
      const selfTest = await installRuntimeSelfTest();
      const environment = selfTest.environment;
      expect(inspectCasimirFormalEnvironmentPolicyCatalogV1().configured).toBe(
        false,
      );
      expect(
        resolveCasimirFormalEnvironmentPolicyCatalogEntryV1(
          selfTest.environmentPolicyId,
        ),
      ).toBeNull();
      expect(environment).toMatchObject({
        policyId: CASIMIR_FORMAL_RUNTIME_SELF_TEST_ENVIRONMENT_POLICY_ID,
        toolchainIdentity: {
          release: CASIMIR_FORMAL_RUNTIME_SELF_TEST_LEAN_RELEASE,
          commitSha: CASIMIR_FORMAL_RUNTIME_SELF_TEST_LEAN_COMMIT_SHA,
          kernelBinarySha256:
            CASIMIR_FORMAL_RUNTIME_SELF_TEST_LEAN_KERNEL_BINARY_SHA256,
          authority: "exact_binary_sha256_allowlist",
        },
        importSourcePaths: {},
        policy: {
          allowedImportModules: [],
        },
      });
      expect(selfTest).toMatchObject({
        formalArtifactId: CASIMIR_FORMAL_RUNTIME_SELF_TEST_ARTIFACT_ID,
        theorem: {
          sourceSha256: CASIMIR_FORMAL_RUNTIME_SELF_TEST_SOURCE_SHA256,
        },
        authority: {
          nonScientificRuntimeSelfTest: true,
          semanticBindingRegistered: false,
          theoremTypeIdentityRegistered: false,
          theoryGraphBindingRegistered: false,
          theoryExperimentFormalClosureEligible: false,
          validatesScientificClaim: false,
          certificatePromotionAllowed: false,
          terminalEligible: false,
        },
      });
      expect(selfTest).not.toHaveProperty("claim");
      expect(selfTest).not.toHaveProperty("semanticBinding");
      expect(selfTest).not.toHaveProperty("theoryGraph");

      const service = createCasimirFormalVerifierJobService({
        resolveLeanExecutablePath: () => PINNED_LEAN_PATH,
      });
      const plan = await service.plan({
        accountType: "developer",
        profileId: "profile:runtime-self-test",
        sealedInput,
      });
      expect(plan).toMatchObject({
        ok: true,
        status: "ready",
        issues: [],
        confirmationRequired: true,
      });

      const outputRoot = path.join(await makeTempRoot(), "replay-output");
      const certificate = await replayCasimirFormalLeanRequestV1({
        ...sealedInput,
        leanExecutablePath: PINNED_LEAN_PATH,
        outputRoot,
        generatedAt: () => "2026-07-26T00:00:01.000Z",
      });
      expect(certificate).toMatchObject({
        status: "passed",
        blockers: [],
        theorem: {
          theoremName: "casimir_formal_runtime_self_test_true",
        },
      });
      expect(selfTest.authority.theoryExperimentFormalClosureEligible).toBe(
        false,
      );
    },
    180_000,
  );

  it.skipIf(!RUNTIME_AVAILABLE)(
    "rejects a wrong executable hash and any import outside the empty closure",
    async () => {
      const tempRoot = await makeTempRoot();
      const wrongExecutable = path.join(tempRoot, "wrong-lean.exe");
      await fs.writeFile(wrongExecutable, "not the pinned Lean binary");
      await expect(
        installCasimirFormalRuntimeSelfTestCatalogForTestsV1({
          repositoryRoot: REPOSITORY_ROOT,
          leanExecutablePath: wrongExecutable,
        }),
      ).rejects.toThrow("formal_runtime_self_test_lean_binary_hash_mismatch");

      const sealedInput = await makeSelfTestSealedInput({
        imports: [
          {
            module: "Mathlib",
            sourcePath: path.resolve(
              REPOSITORY_ROOT,
              "formal",
              "lean",
              "CasimirFormalRuntimeSelfTest.lean",
            ),
          },
        ],
      });
      const service = createCasimirFormalVerifierJobService({
        resolveLeanExecutablePath: () => PINNED_LEAN_PATH,
      });
      const plan = await service.plan({
        accountType: "developer",
        profileId: "profile:runtime-self-test",
        sealedInput,
      });
      expect(plan).toMatchObject({
        ok: false,
        status: "blocked",
      });
      expect(plan.issues).toContain("import_module_not_allowed:Mathlib");
    },
  );

  it.skipIf(!RUNTIME_AVAILABLE)(
    "does not make the Lanyon/Mathlib scientific preparation path ready",
    async () => {
      const selfTest = await installRuntimeSelfTest();
      const selfTestPreparation =
        await executeTheoryFormalVerifierGatewayCapability({
          capabilityId: THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
          args: {
            procedure_artifact_ref: "procedure-artifact:runtime-self-test",
            procedure_id: "procedure:runtime-self-test",
            procedure_sha256: "b".repeat(64),
            semantic_admission_artifact_ref:
              "semantic-admission:runtime-self-test",
            formal_artifact_id: selfTest.formalArtifactId,
            theorem_name: selfTest.theorem.theoremName,
            environment_policy_id: selfTest.environmentPolicyId,
          },
          accountType: "developer",
          profileId: "profile:runtime-self-test",
          turnId: "ask:test:self-test-not-scientific-preparation",
          authoritativeEvidenceArtifacts: [],
        });
      expect(selfTestPreparation).toMatchObject({
        ok: false,
        status: "blocked",
      });
      const selfTestReceipt = (
        selfTestPreparation.observation as Record<string, any>
      ).preparation_receipt;
      expect(
        selfTestReceipt.missingRequirements.map(
          (entry: { code: string }) => entry.code,
        ),
      ).toEqual(
        expect.arrayContaining([
          "formal_theorem_selection_unregistered",
          "formal_theorem_type_digest_required",
          "semantic_to_lean_binding_required",
          "formal_import_closure_required",
          "formal_environment_policy_catalog_unconfigured",
        ]),
      );
      expect(selfTestReceipt.preparedSealedInputSha256).toBeNull();

      const result = await executeTheoryFormalVerifierGatewayCapability({
        capabilityId: THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
        args: {
          procedure_artifact_ref: "procedure-artifact:lanyon",
          procedure_id: "procedure:lanyon:advection-diffusion",
          procedure_sha256: "a".repeat(64),
          semantic_admission_artifact_ref: "semantic-admission:lanyon",
          artifact_generation_artifact_ref: "artifact-generation:lanyon",
          claim_id: "claim:advection-diffusion",
          formal_artifact_id: "lanyon:advection_diffusion_full_1d",
          theorem_name: "xFluxConsistency",
          environment_policy_id: "lean4-mathlib:lanyon",
        },
        accountType: "developer",
        profileId: "profile:runtime-self-test",
        turnId: "ask:test:lanyon-remains-blocked",
        authoritativeEvidenceArtifacts: [],
      });
      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        admissionReason: "formal_prepared_request_blocked",
      });
      const receipt = (result.observation as Record<string, any>)
        .preparation_receipt;
      const codes = receipt.missingRequirements.map(
        (entry: { code: string }) => entry.code,
      );
      expect(codes).toEqual(
        expect.arrayContaining([
          "formal_theorem_selection_unregistered",
          "formal_theorem_type_digest_required",
          "semantic_to_lean_binding_required",
          "formal_import_closure_required",
          "formal_environment_policy_catalog_unconfigured",
        ]),
      );
      expect(codes).not.toContain("formal_environment_policy_unregistered");
      expect(receipt).toMatchObject({
        disposition: "blocked",
        preparedSealedInputSha256: null,
        admittedBindings: {
          theoremTypeSha256: null,
          semanticToLeanBindingSha256: null,
          importClosureSha256: null,
        },
      });
    },
  );
});
