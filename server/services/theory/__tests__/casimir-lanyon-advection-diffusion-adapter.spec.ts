import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildCasimirArtifactGenerationRequestV1 } from "../../../../shared/contracts/casimir-artifact-generation.v1";
import {
  buildCasimirLanyonAdapterPolicyV1,
  CASIMIR_LANYON_ADAPTER_CONTRACT_ID,
  CASIMIR_LANYON_ADVECTION_DIFFUSION_CASES_V1,
  CASIMIR_LANYON_PRODUCER_ID,
  CASIMIR_LANYON_SELECTED_SOURCE_TREE_SHA256,
  computeCasimirLanyonSelectedSourceTreeSha256V1,
  validateCasimirLanyonAdapterPolicyIntegrityV1,
} from "../../../../shared/contracts/casimir-lanyon-advection-diffusion-adapter.v1";
import {
  createCasimirLanyonAdvectionDiffusionAdapter,
  inspectCasimirLanyonPinnedSnapshotV1,
} from "../casimir-lanyon-advection-diffusion-adapter";

const hash = (digit: string): string => digit.repeat(64);

const selectedArtifacts = () =>
  CASIMIR_LANYON_ADVECTION_DIFFUSION_CASES_V1.flatMap((entry) => [
    entry.specification,
    entry.formalSource,
    entry.implementationSource,
  ]).sort((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath, "en"),
  );

async function fixture() {
  const policy = await buildCasimirLanyonAdapterPolicyV1();
  const selectedCase = policy.cases.find(
    (entry) => entry.caseId === "linear_advection_1d",
  );
  if (!selectedCase) throw new Error("missing pinned test case");
  const request = await buildCasimirArtifactGenerationRequestV1({
    generatedAt: "2026-07-24T14:00:00.000Z",
    requestId: "lanyon-linear-advection-1d",
    casimirSpec: {
      specId: "spec.linear-advection.1d",
      schemaVersion: "casimir_spec_scientific_claim_ir/v1",
      semanticSha256: hash("a"),
      artifactSha256: hash("b"),
    },
    claim: {
      claimId: "claim.linear-advection.1d",
      propositionSha256: hash("c"),
    },
    sourcePacket: {
      packetId: "lanyon.specification.linear-advection.1d",
      mediaType: "text/x-racket",
      artifactSha256: selectedCase.specification.sha256,
    },
    masterProblem: {
      schemaVersion: "theory_master_problem/v1",
      planId: "master.linear-advection.1d",
      artifactSha256: hash("d"),
    },
    derivationProgram: {
      schemaVersion: "theory_derivation_program/v1",
      programId: "derivation.linear-advection.1d",
      sourceMasterProblemPlanId: "master.linear-advection.1d",
      artifactSha256: hash("e"),
    },
    producerPolicy: {
      adapterContractId: CASIMIR_LANYON_ADAPTER_CONTRACT_ID,
      adapterContractSha256: policy.artifactSha256,
      allowedProducerIds: [CASIMIR_LANYON_PRODUCER_ID],
      immutableRepositoryPinRequired: true,
      outputHashRequired: true,
      providerOutputTrusted: false,
    },
    requestedArtifacts: [
      {
        artifactId: "artifact.linear-advection.1d.build",
        role: "build_manifest",
        mediaType: "application/json",
      },
      {
        artifactId: "artifact.linear-advection.1d.c",
        role: "implementation_source",
        mediaType: "text/x-c",
      },
      {
        artifactId: "artifact.linear-advection.1d.lean",
        role: "formal_source",
        mediaType: "text/x-lean",
      },
      {
        artifactId: "artifact.linear-advection.1d.rkt",
        role: "numerical_case",
        mediaType: "text/x-racket",
      },
    ],
  });
  return { policy, selectedCase, request };
}

describe("Casimir pinned Lanyon adapter policy", () => {
  it("recomputes the exact 27-artifact source-tree commitment", async () => {
    const policy = await buildCasimirLanyonAdapterPolicyV1();

    expect(computeCasimirLanyonSelectedSourceTreeSha256V1(policy.cases)).toBe(
      CASIMIR_LANYON_SELECTED_SOURCE_TREE_SHA256,
    );
    expect(await validateCasimirLanyonAdapterPolicyIntegrityV1(policy)).toEqual(
      [],
    );
    expect(selectedArtifacts()).toHaveLength(27);
  });

  it("rejects mutation of the immutable upstream snapshot", async () => {
    const policy = await buildCasimirLanyonAdapterPolicyV1();
    const tampered = {
      ...policy,
      repository: {
        ...policy.repository,
        commitSha: "0".repeat(40),
      },
    };

    expect(
      await validateCasimirLanyonAdapterPolicyIntegrityV1(tampered),
    ).toContain("policy must exactly equal the pinned adapter policy");
  });
});

describe("Casimir Lanyon snapshot admission", () => {
  it("issues a non-terminal receipt for exact pinned source bytes", async () => {
    const { policy, request } = await fixture();
    const root = path.resolve("C:/sealed/lanyon-advection-diffusion");
    const inspectSnapshot = vi.fn(async () => ({
      sourceRoot: root,
      selectedSourceTreeSha256: policy.repository.selectedSourceTreeSha256,
      artifacts: selectedArtifacts().map((entry) => ({
        ...entry,
        absolutePath: path.resolve(root, ...entry.logicalPath.split("/")),
      })),
    }));
    const timestamps = [
      new Date("2026-07-24T14:01:00.000Z"),
      new Date("2026-07-24T14:01:01.000Z"),
    ];
    const adapter = createCasimirLanyonAdvectionDiffusionAdapter({
      inspectSnapshot,
      now: () => timestamps.shift() ?? new Date(0),
      environmentIdentity: () => ({
        platform: "test",
        architecture: "test",
        nodeVersion: "test",
      }),
    });

    const result = await adapter.admit({
      accountType: "developer",
      profileId: "profile:developer",
      sourceRoot: root,
      caseId: "linear_advection_1d",
      request,
    });

    expect(inspectSnapshot).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      status: "admitted",
      caseId: "linear_advection_1d",
      receipt: {
        run: { status: "succeeded" },
        producer: {
          producerId: "lanyon",
          upstreamRepository: {
            commitSha: "3d19be11e101121d8187230977f5a5aeba0daefe",
            sourceTreeSha256: CASIMIR_LANYON_SELECTED_SOURCE_TREE_SHA256,
          },
        },
        authority: {
          artifactBytesProduced: true,
          providerOutputTrusted: false,
          formalPropositionChecked: false,
          validatesGeneratedCode: false,
          validatesNumericalImplementation: false,
          assistantAnswer: false,
          terminalEligible: false,
        },
      },
      authority: {
        sourceBytesAdmitted: true,
        providerOutputTrusted: false,
        formalPropositionChecked: false,
        validatesTheory: false,
        validatesGeneratedCode: false,
        validatesNumericalImplementation: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    });
    expect(result.receipt?.artifacts).toHaveLength(4);
    expect(result.artifactBindings?.formalSourcePath).toMatch(
      /linear_advection_1d\.lean$/,
    );
  });

  it("blocks public accounts and source packets not equal to the pinned specification", async () => {
    const { request } = await fixture();
    const inspectSnapshot = vi.fn();
    const adapter = createCasimirLanyonAdvectionDiffusionAdapter({
      inspectSnapshot,
    });
    const publicResult = await adapter.admit({
      accountType: "user",
      sourceRoot: "C:/sealed/lanyon-advection-diffusion",
      caseId: "linear_advection_1d",
      request,
    });
    const mismatchedSource = await adapter.admit({
      accountType: "developer",
      sourceRoot: "C:/sealed/lanyon-advection-diffusion",
      caseId: "linear_advection_1d",
      request: {
        ...request,
        sourcePacket: {
          ...request.sourcePacket,
          artifactSha256: hash("0"),
        },
      },
    });

    expect(publicResult).toMatchObject({
      ok: false,
      status: "blocked",
      issues: expect.arrayContaining(["developer_account_required"]),
    });
    expect(mismatchedSource).toMatchObject({
      ok: false,
      status: "blocked",
      issues: expect.arrayContaining([expect.stringMatching(/^request:/)]),
    });
    expect(inspectSnapshot).not.toHaveBeenCalled();
  });

  it("rejects non-absolute snapshot roots before reading source", async () => {
    const policy = await buildCasimirLanyonAdapterPolicyV1();
    await expect(
      inspectCasimirLanyonPinnedSnapshotV1("relative/source", policy),
    ).rejects.toThrow("source_root_path_not_absolute");
  });
});
