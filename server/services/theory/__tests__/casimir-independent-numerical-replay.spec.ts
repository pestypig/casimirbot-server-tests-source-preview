import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildCasimirIndependentNumericalReplayPolicyV1 } from "../../../../shared/contracts/casimir-independent-numerical-replay-policy.v1";
import { buildCasimirIndependentNumericalVerificationRequestV1 } from "../../../../shared/contracts/casimir-independent-numerical-verification.v1";
import {
  CasimirIndependentNumericalReplayAdmissionError,
  replayCasimirIndependentNumericalRequestV1,
} from "../casimir-independent-numerical-replay";
import { buildNumericalLaneGenerationEvidence } from "./casimir-independent-numerical-generation-fixture";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const hash = (character: string): string => character.repeat(64);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "casimir-numerical-test-"),
  );
  tempRoots.push(root);
  const harnessPath = path.join(root, "harness.bin");
  const harnessSourcePath = path.join(root, "harness.ts");
  const primaryPath = path.join(root, "primary.bin");
  const primarySourcePath = path.join(root, "primary.c");
  const primaryBuildManifestPath = path.join(root, "primary-build.json");
  const independentPath = path.join(root, "independent.bin");
  const independentSourcePath = path.join(root, "independent.c");
  const independentBuildManifestPath = path.join(
    root,
    "independent-build.json",
  );
  await Promise.all([
    fs.writeFile(harnessPath, "harness-v1"),
    fs.writeFile(harnessSourcePath, "harness-source-v1"),
    fs.writeFile(primaryPath, "primary-v1"),
    fs.writeFile(primarySourcePath, "primary-source-v1"),
    fs.writeFile(primaryBuildManifestPath, "primary-build-v1"),
    fs.writeFile(independentPath, "independent-v1"),
    fs.writeFile(independentSourcePath, "independent-source-v1"),
    fs.writeFile(independentBuildManifestPath, "independent-build-v1"),
  ]);
  const casimirSpec = {
    specId: "spec.advection-diffusion.1d",
    schemaVersion: "casimir_spec_scientific_claim_ir/v1" as const,
    semanticSha256: hash("a"),
    artifactSha256: hash("b"),
  };
  const claim = { claimId: "claim.1d", propositionSha256: hash("c") };
  const primaryEvidence = await buildNumericalLaneGenerationEvidence({
    lane: "primary",
    casimirSpec,
    claim,
    implementation: {
      implementationId: "primary",
      lineageId: "casimir",
      sourceSha256: sha256("primary-source-v1"),
      buildManifestSha256: sha256("primary-build-v1"),
    },
  });
  const independentEvidence = await buildNumericalLaneGenerationEvidence({
    lane: "independent",
    casimirSpec,
    claim,
    implementation: {
      implementationId: "independent",
      lineageId: "lanyon",
      sourceSha256: sha256("independent-source-v1"),
      buildManifestSha256: sha256("independent-build-v1"),
    },
  });
  const request = await buildCasimirIndependentNumericalVerificationRequestV1({
    generatedAt: "2026-07-25T00:00:00.000Z",
    requestId: "numerical-request",
    casimirSpec,
    claim,
    primaryImplementation: primaryEvidence.implementationBinding,
    independentImplementation: independentEvidence.implementationBinding,
    frozenCase: {
      caseId: "periodic-1d",
      inputsSha256: hash("4"),
      meshSha256: hash("5"),
      initialConditionsSha256: hash("6"),
      boundaryConditionsSha256: hash("7"),
      observables: [{ observableId: "l2_error", unit: "1" }],
    },
    comparisonPolicy: {
      policyId: "comparison-v1",
      artifactSha256: hash("8"),
      norm: "linf",
      tolerances: [
        {
          observableId: "l2_error",
          absoluteTolerance: 1e-8,
          relativeTolerance: 1e-6,
        },
      ],
      minimumRefinementLevels: 3,
      minimumObservedOrder: 1.5,
      deterministicSeed: "fixed-seed",
    },
    environments: {
      primary: {
        environmentId: "primary-env",
        toolchainSha256: hash("9"),
        runtimeSha256: hash("0"),
        platformSha256: hash("a"),
      },
      independent: {
        environmentId: "independent-env",
        toolchainSha256: hash("b"),
        runtimeSha256: hash("c"),
        platformSha256: hash("d"),
      },
    },
    executionPolicy: {
      replayCount: 2,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
    },
  });
  const policy = await buildCasimirIndependentNumericalReplayPolicyV1({
    generatedAt: "2026-07-25T00:00:00.000Z",
    policyId: "numerical-replay-v1",
    harness: {
      protocol: "casimir_numerical_harness_json_files/v1",
      launchMode: "native_executable",
      executableSha256: sha256("harness-v1"),
      sourceSha256: sha256("harness-source-v1"),
    },
    lanes: {
      primary: {
        implementationId: request.primaryImplementation.implementationId,
        lineageId: request.primaryImplementation.lineageId,
        sourceSha256: request.primaryImplementation.sourceSha256,
        buildManifestSha256: request.primaryImplementation.buildManifestSha256,
        executableSha256: sha256("primary-v1"),
        environment: request.environments.primary,
      },
      independent: {
        implementationId: request.independentImplementation.implementationId,
        lineageId: request.independentImplementation.lineageId,
        sourceSha256: request.independentImplementation.sourceSha256,
        buildManifestSha256:
          request.independentImplementation.buildManifestSha256,
        executableSha256: sha256("independent-v1"),
        environment: request.environments.independent,
      },
    },
    execution: {
      replayCount: 2,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
      timeoutMs: 30_000,
      maxOutputBytes: 1_048_576,
      maximumRefinementLevels: 8,
    },
  });
  return {
    root,
    harnessSourcePath,
    harnessExecutablePath: harnessPath,
    primarySourcePath,
    primaryBuildManifestPath,
    primaryExecutablePath: primaryPath,
    independentSourcePath,
    independentBuildManifestPath,
    independentExecutablePath: independentPath,
    request,
    policy,
    primaryGenerationRequest: primaryEvidence.generationRequest,
    primaryProducerReceipt: primaryEvidence.producerReceipt,
    independentGenerationRequest: independentEvidence.generationRequest,
    independentProducerReceipt: independentEvidence.producerReceipt,
  };
}

describe("Casimir independent numerical replay", () => {
  it("derives a bounded passing certificate from two exact replays", async () => {
    const input = await fixture();
    const outputRoot = path.join(input.root, "output");
    const certificate = await replayCasimirIndependentNumericalRequestV1({
      ...input,
      outputRoot,
      generatedAt: () => "2026-07-25T00:01:00.000Z",
      runner: async (run) => {
        await fs.writeFile(
          run.args[3],
          JSON.stringify({
            schema: "casimir.independent_numerical_harness.output.v1",
            requestArtifactSha256: input.request.artifactSha256,
            policyArtifactSha256: input.policy.artifactSha256,
            runs: {
              primary: {
                implementationId: "primary",
                replays: [
                  {
                    outputManifestSha256: hash("1"),
                    transcriptSha256: hash("2"),
                    refinementLevels: 3,
                  },
                  {
                    outputManifestSha256: hash("1"),
                    transcriptSha256: hash("3"),
                    refinementLevels: 3,
                  },
                ],
              },
              independent: {
                implementationId: "independent",
                replays: [
                  {
                    outputManifestSha256: hash("4"),
                    transcriptSha256: hash("5"),
                    refinementLevels: 3,
                  },
                  {
                    outputManifestSha256: hash("4"),
                    transcriptSha256: hash("6"),
                    refinementLevels: 3,
                  },
                ],
              },
            },
            comparisons: [
              {
                observableId: "l2_error",
                unit: "1",
                maximumAbsoluteError: 5e-9,
                maximumRelativeError: 5e-7,
                observedConvergenceOrder: 2,
              },
            ],
            blockers: [],
          }),
        );
        return {
          startedAt: "2026-07-25T00:00:10.000Z",
          completedAt: "2026-07-25T00:00:11.000Z",
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          outputLimitExceeded: false,
          spawnError: null,
        };
      },
    });
    expect(certificate.status).toBe("passed");
    expect(certificate.request.frozenCase).toEqual({
      caseId: input.request.frozenCase.caseId,
      inputsSha256: input.request.frozenCase.inputsSha256,
      meshSha256: input.request.frozenCase.meshSha256,
      initialConditionsSha256:
        input.request.frozenCase.initialConditionsSha256,
      boundaryConditionsSha256:
        input.request.frozenCase.boundaryConditionsSha256,
      observableIds: input.request.frozenCase.observables.map(
        (observable) => observable.observableId,
      ),
    });
    expect(certificate.authority).toMatchObject({
      frozenNumericalComparisonChecked: true,
      independentImplementationCompared: true,
      validatesNumericalImplementation: false,
      validatesTheory: false,
      terminalEligible: false,
    });
  });

  it("fails rather than trusting divergent replay output", async () => {
    const input = await fixture();
    const certificate = await replayCasimirIndependentNumericalRequestV1({
      ...input,
      outputRoot: path.join(input.root, "output"),
      runner: async (run) => {
        await fs.writeFile(
          run.args[3],
          JSON.stringify({
            schema: "casimir.independent_numerical_harness.output.v1",
            requestArtifactSha256: input.request.artifactSha256,
            policyArtifactSha256: input.policy.artifactSha256,
            runs: {
              primary: {
                implementationId: "primary",
                replays: [
                  {
                    outputManifestSha256: hash("1"),
                    transcriptSha256: hash("2"),
                    refinementLevels: 3,
                  },
                  {
                    outputManifestSha256: hash("9"),
                    transcriptSha256: hash("3"),
                    refinementLevels: 3,
                  },
                ],
              },
              independent: {
                implementationId: "independent",
                replays: [
                  {
                    outputManifestSha256: hash("4"),
                    transcriptSha256: hash("5"),
                    refinementLevels: 3,
                  },
                  {
                    outputManifestSha256: hash("4"),
                    transcriptSha256: hash("6"),
                    refinementLevels: 3,
                  },
                ],
              },
            },
            comparisons: [
              {
                observableId: "l2_error",
                unit: "1",
                maximumAbsoluteError: 5e-9,
                maximumRelativeError: 5e-7,
                observedConvergenceOrder: 2,
              },
            ],
            blockers: [],
          }),
        );
        return {
          startedAt: "2026-07-25T00:00:10.000Z",
          completedAt: "2026-07-25T00:00:11.000Z",
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          outputLimitExceeded: false,
          spawnError: null,
        };
      },
    });
    expect(certificate.status).toBe("failed");
    expect(certificate.blockers.map((item) => item.code)).toContain(
      "primary_replay_not_byte_identical",
    );
    expect(certificate.authority.frozenNumericalComparisonChecked).toBe(false);
  });

  it("rejects an executable whose bytes do not match policy", async () => {
    const input = await fixture();
    await fs.writeFile(input.independentExecutablePath, "tampered");
    await expect(
      replayCasimirIndependentNumericalRequestV1({
        ...input,
        outputRoot: path.join(input.root, "output"),
      }),
    ).rejects.toMatchObject({
      issues: ["independent_executable_hash_mismatch"],
    } satisfies Partial<CasimirIndependentNumericalReplayAdmissionError>);
  });

  it("rejects substituted producer evidence before executable admission", async () => {
    const input = await fixture();
    await expect(
      replayCasimirIndependentNumericalRequestV1({
        ...input,
        primaryProducerReceipt: input.independentProducerReceipt,
        outputRoot: path.join(input.root, "output"),
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.stringContaining("primary_producer_chain:"),
        expect.stringContaining("primary_implementation_binding:"),
      ]),
    });
  });
});
