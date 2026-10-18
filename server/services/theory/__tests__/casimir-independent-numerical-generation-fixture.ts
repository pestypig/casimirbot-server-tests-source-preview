import { createHash } from "node:crypto";

import {
  buildCasimirArtifactGenerationReceiptV1,
  buildCasimirArtifactGenerationRequestV1,
} from "../../../../shared/contracts/casimir-artifact-generation.v1";
import type { CasimirNumericalImplementationBindingV1 } from "../../../../shared/contracts/casimir-independent-numerical-verification.v1";
import type { CasimirSpecScientificClaimIrV1 } from "../../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export async function buildNumericalLaneGenerationEvidence(input: {
  lane: "primary" | "independent";
  casimirSpec: Pick<
    CasimirSpecScientificClaimIrV1,
    "specId" | "schemaVersion" | "semanticSha256" | "artifactSha256"
  >;
  claim: { claimId: string; propositionSha256: string };
  implementation: Omit<
    CasimirNumericalImplementationBindingV1,
    "producerReceipt"
  >;
}) {
  const implementation = input.implementation;
  const sourcePacketSha256 = sha256(`${input.lane}:source-packet`);
  const generationRequest = await buildCasimirArtifactGenerationRequestV1({
    generatedAt: "2026-07-25T00:00:00.000Z",
    requestId: `generation-request:${input.lane}`,
    casimirSpec: input.casimirSpec,
    claim: input.claim,
    sourcePacket: {
      packetId: `source-packet:${input.lane}`,
      mediaType: "application/vnd.casimir.scientific-source+json",
      artifactSha256: sourcePacketSha256,
    },
    masterProblem: {
      schemaVersion: "theory_master_problem/v1",
      planId: `master-problem:${input.lane}`,
      artifactSha256: sha256(`${input.lane}:master-problem`),
    },
    derivationProgram: {
      schemaVersion: "theory_derivation_program/v1",
      programId: `derivation-program:${input.lane}`,
      sourceMasterProblemPlanId: `master-problem:${input.lane}`,
      artifactSha256: sha256(`${input.lane}:derivation-program`),
    },
    producerPolicy: {
      adapterContractId: `test-numerical-producer:${input.lane}/v1`,
      adapterContractSha256: sha256(`${input.lane}:adapter`),
      allowedProducerIds: [`test-producer:${input.lane}`],
      immutableRepositoryPinRequired: true,
      outputHashRequired: true,
      providerOutputTrusted: false,
    },
    requestedArtifacts: [
      {
        artifactId: `artifact:${input.lane}:build-manifest`,
        role: "build_manifest",
        mediaType: "application/json",
      },
      {
        artifactId: `artifact:${input.lane}:source`,
        role: "implementation_source",
        mediaType: "text/x-c",
      },
    ],
  });
  const producerReceipt = await buildCasimirArtifactGenerationReceiptV1({
    generatedAt: "2026-07-25T00:01:00.000Z",
    receiptId: `generation-receipt:${input.lane}`,
    request: {
      schemaVersion: generationRequest.schemaVersion,
      requestId: generationRequest.requestId,
      artifactSha256: generationRequest.artifactSha256,
      casimirSpec: {
        semanticSha256: generationRequest.casimirSpec.semanticSha256,
        artifactSha256: generationRequest.casimirSpec.artifactSha256,
      },
      claimId: generationRequest.claim.claimId,
      propositionSha256: generationRequest.claim.propositionSha256,
      masterProblem: {
        planId: generationRequest.masterProblem.planId,
        artifactSha256: generationRequest.masterProblem.artifactSha256,
      },
      derivationProgram: {
        programId: generationRequest.derivationProgram.programId,
        artifactSha256: generationRequest.derivationProgram.artifactSha256,
      },
    },
    producer: {
      producerId: `test-producer:${input.lane}`,
      adapterId: generationRequest.producerPolicy.adapterContractId,
      adapterRevisionSha256:
        generationRequest.producerPolicy.adapterContractSha256,
      upstreamRepository: {
        uri: `https://example.invalid/${input.lane}`,
        commitSha: sha256(`${input.lane}:commit`).slice(0, 40),
        sourceTreeSha256: sha256(`${input.lane}:source-tree`),
      },
    },
    run: {
      status: "succeeded",
      startedAt: "2026-07-25T00:00:30.000Z",
      completedAt: "2026-07-25T00:01:00.000Z",
      transcriptSha256: sha256(`${input.lane}:transcript`),
      environmentSha256: sha256(`${input.lane}:environment`),
    },
    artifacts: [
      {
        artifactId: `artifact:${input.lane}:build-manifest`,
        role: "build_manifest",
        mediaType: "application/json",
        logicalPath: `${input.lane}/build-manifest.json`,
        artifactSha256: implementation.buildManifestSha256,
        sizeBytes: 100,
        derivedFromSha256s: [sourcePacketSha256],
      },
      {
        artifactId: `artifact:${input.lane}:source`,
        role: "implementation_source",
        mediaType: "text/x-c",
        logicalPath: `${input.lane}/source.c`,
        artifactSha256: implementation.sourceSha256,
        sizeBytes: 200,
        derivedFromSha256s: [sourcePacketSha256],
      },
    ],
    blockers: [],
  });
  const implementationBinding: CasimirNumericalImplementationBindingV1 = {
    ...implementation,
    producerReceipt: {
      schemaVersion: producerReceipt.schemaVersion,
      receiptId: producerReceipt.receiptId,
      artifactSha256: producerReceipt.artifactSha256,
    },
  };
  return { generationRequest, producerReceipt, implementationBinding };
}
