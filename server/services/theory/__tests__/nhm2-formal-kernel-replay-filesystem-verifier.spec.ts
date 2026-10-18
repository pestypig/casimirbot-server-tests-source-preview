import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_FORMAL_KERNEL_REPLAY_ASSUMPTION_ORDERING,
  NHM2_FORMAL_KERNEL_REPLAY_AXIOM_ORDERING,
  NHM2_FORMAL_KERNEL_REPLAY_MANIFEST_ARTIFACT_ID,
  NHM2_FORMAL_KERNEL_REPLAY_MANIFEST_CONTRACT_VERSION,
  NHM2_FORMAL_KERNEL_REPLAY_MERKLE_ALGORITHM,
  NHM2_FORMAL_KERNEL_REPLAY_SOURCE_ORDERING,
  NHM2_FORMAL_KERNEL_REPLAY_THEOREM_ORDERING,
  NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_PROPOSITION,
  NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_THEOREM_ID,
  canonicalNhm2FormalKernelReplayJson,
  computeNhm2FormalKernelReplaySourceMerkleRoot,
  nhm2FormalKernelReplayAssumptionLedgerValue,
  nhm2FormalKernelReplayAxiomLedgerValue,
  nhm2FormalKernelReplaySourceLedgerValue,
  nhm2FormalKernelReplayTheoremLedgerValue,
  sha256Nhm2FormalKernelReplayCanonicalValue,
  sha256Nhm2FormalKernelReplayUtf8,
  type Nhm2FormalKernelReplayArtifactRefV1,
  type Nhm2FormalKernelReplayManifestV1,
} from "../../../../shared/contracts/nhm2-formal-kernel-replay-manifest.v1";
import {
  verifyNhm2FormalKernelReplayFilesystem,
  type Nhm2FormalKernelReplayEvaluatorContextV1,
} from "../nhm2-experiment-ready-theory-closure-evaluator";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

async function fixture(): Promise<{
  projectRoot: string;
  context: Nhm2FormalKernelReplayEvaluatorContextV1;
  proofPath: string;
}> {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-formal-replay-evaluator-"),
  );
  temporaryRoots.push(projectRoot);
  const write = async (
    repoPath: string,
    bytes: Buffer,
  ): Promise<Nhm2FormalKernelReplayArtifactRefV1> => {
    const absolutePath = path.join(projectRoot, ...repoPath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, bytes);
    return { path: repoPath, sha256: sha256(bytes) };
  };
  const writeText = (repoPath: string, text: string) =>
    write(repoPath, Buffer.from(text, "utf8"));

  const environmentLock = await writeText(
    "inputs/formal/environment.lock",
    "lean=4.19.0\n",
  );
  const kernelBinary = await writeText(
    "inputs/formal/lean-kernel.bin",
    "pinned-test-kernel",
  );
  const preRunSources = [environmentLock, kernelBinary].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.path, "utf8"),
      Buffer.from(right.path, "utf8"),
    ),
  );
  const proofArtifact = await writeText(
    "runs/formal/claim-lock-proof.olean",
    "test proof term",
  );
  const transcriptArtifact = await writeText(
    "runs/formal/claim-lock-transcript.txt",
    "proved",
  );
  const aggregateTranscript = await writeText(
    "runs/formal/aggregate-transcript.txt",
    "all theorems proved",
  );
  const theorem = {
    theoremId: NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_THEOREM_ID,
    proposition: NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_PROPOSITION,
    propositionSha256: sha256Nhm2FormalKernelReplayUtf8(
      NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_PROPOSITION,
    ),
    proofArtifact,
    transcriptArtifact,
    usedAxiomIds: [],
    usedAssumptionIds: [],
    replayResult: "proved" as const,
  };
  const placeholder = (repoPath: string) => ({
    path: repoPath,
    sha256: "f".repeat(64),
  });
  const manifest: Nhm2FormalKernelReplayManifestV1 = {
    artifactId: NHM2_FORMAL_KERNEL_REPLAY_MANIFEST_ARTIFACT_ID,
    contractVersion: NHM2_FORMAL_KERNEL_REPLAY_MANIFEST_CONTRACT_VERSION,
    generatedAt: "2099-07-19T12:00:00.000Z",
    identity: {
      candidateId: "test-candidate",
      candidateManifestSha256: "a".repeat(64),
      requestId: "formal-request",
      runId: "formal-run",
      runtimeId: "formal-runtime",
      sourceCommitSha: "b".repeat(40),
    },
    preRunSourceCommitment: {
      frozenBeforeReplay: true,
      ordering: NHM2_FORMAL_KERNEL_REPLAY_SOURCE_ORDERING,
      merkleAlgorithm: NHM2_FORMAL_KERNEL_REPLAY_MERKLE_ALGORITHM,
      entries: preRunSources,
      merkleRootSha256:
        computeNhm2FormalKernelReplaySourceMerkleRoot(preRunSources),
      ledgerArtifact: placeholder("runs/formal/source-ledger.json"),
    },
    kernel: {
      proofAssistant: "Lean",
      kernelId: "test-lean-kernel",
      kernelVersion: "4.19.0",
      binary: kernelBinary,
      environmentLock,
    },
    theoremReplay: {
      ordering: NHM2_FORMAL_KERNEL_REPLAY_THEOREM_ORDERING,
      expectedTheoremCount: 1,
      replayedTheoremCount: 1,
      entries: [theorem],
      ledgerArtifact: placeholder("runs/formal/theorem-ledger.json"),
    },
    dependencyLedgers: {
      axiomOrdering: NHM2_FORMAL_KERNEL_REPLAY_AXIOM_ORDERING,
      assumptionOrdering: NHM2_FORMAL_KERNEL_REPLAY_ASSUMPTION_ORDERING,
      usedAxioms: [],
      usedAssumptions: [],
      usedAxiomLedgerArtifact: placeholder("runs/formal/axiom-ledger.json"),
      usedAssumptionLedgerArtifact: placeholder(
        "runs/formal/assumption-ledger.json",
      ),
    },
    replay: {
      mode: "external_pinned_lean_kernel",
      exitCode: 0,
      aggregateTranscript,
    },
    claimLock: {
      theoremId: NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_THEOREM_ID,
      proposition: NHM2_FORMAL_MANIFEST_CERTIFICATE_CLAIM_LOCK_PROPOSITION,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
      empiricalReceiptsRequired: true,
    },
    claimBoundary: {
      formalReplayEvidenceOnly: true,
      contractVerifierInvokesLean: false,
      processReceiptRequiredForRuntimeClaim: true,
      physicsProved: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    },
  };
  manifest.preRunSourceCommitment.ledgerArtifact.sha256 =
    sha256Nhm2FormalKernelReplayCanonicalValue(
      nhm2FormalKernelReplaySourceLedgerValue(manifest),
    );
  manifest.theoremReplay.ledgerArtifact.sha256 =
    sha256Nhm2FormalKernelReplayCanonicalValue(
      nhm2FormalKernelReplayTheoremLedgerValue(manifest),
    );
  manifest.dependencyLedgers.usedAxiomLedgerArtifact.sha256 =
    sha256Nhm2FormalKernelReplayCanonicalValue(
      nhm2FormalKernelReplayAxiomLedgerValue(manifest),
    );
  manifest.dependencyLedgers.usedAssumptionLedgerArtifact.sha256 =
    sha256Nhm2FormalKernelReplayCanonicalValue(
      nhm2FormalKernelReplayAssumptionLedgerValue(manifest),
    );
  await Promise.all([
    writeText(
      manifest.preRunSourceCommitment.ledgerArtifact.path,
      canonicalNhm2FormalKernelReplayJson(
        nhm2FormalKernelReplaySourceLedgerValue(manifest),
      ),
    ),
    writeText(
      manifest.theoremReplay.ledgerArtifact.path,
      canonicalNhm2FormalKernelReplayJson(
        nhm2FormalKernelReplayTheoremLedgerValue(manifest),
      ),
    ),
    writeText(
      manifest.dependencyLedgers.usedAxiomLedgerArtifact.path,
      canonicalNhm2FormalKernelReplayJson(
        nhm2FormalKernelReplayAxiomLedgerValue(manifest),
      ),
    ),
    writeText(
      manifest.dependencyLedgers.usedAssumptionLedgerArtifact.path,
      canonicalNhm2FormalKernelReplayJson(
        nhm2FormalKernelReplayAssumptionLedgerValue(manifest),
      ),
    ),
  ]);
  const manifestArtifact = await writeText(
    "runs/formal/formal-replay-manifest.json",
    canonicalNhm2FormalKernelReplayJson(manifest),
  );
  return {
    projectRoot,
    proofPath: proofArtifact.path,
    context: {
      manifestArtifact,
      identity: manifest.identity,
      preRunSources,
      requiredPreRunSources: [...preRunSources],
      kernel: manifest.kernel,
      preRunSourceLedger: manifest.preRunSourceCommitment.ledgerArtifact,
      theoremReplayLedger: manifest.theoremReplay.ledgerArtifact,
      usedAxiomLedger: manifest.dependencyLedgers.usedAxiomLedgerArtifact,
      usedAssumptionLedger:
        manifest.dependencyLedgers.usedAssumptionLedgerArtifact,
      aggregateReplayTranscript: aggregateTranscript,
      claimLockProof: proofArtifact,
      claimLockTranscript: transcriptArtifact,
      receiptInterval: {
        startedAt: "2099-07-19T11:59:00.000Z",
        completedAt: "2099-07-19T12:01:00.000Z",
      },
    },
  };
}

describe("NHM2 formal-kernel replay filesystem verification", () => {
  it("verifies exact manifest, ledger, proof, transcript, kernel, and source bytes without invoking Lean", async () => {
    const value = await fixture();
    const result = await verifyNhm2FormalKernelReplayFilesystem({
      projectRoot: value.projectRoot,
      context: value.context,
    });

    expect(result).toEqual({
      valid: true,
      manifestParsed: true,
      expectedBindingsValid: true,
      referencedArtifactBytesVerified: true,
      invokedLean: false,
      blockers: [],
    });
  });

  it("rejects a candidate identity swap and a missing required frozen source", async () => {
    const value = await fixture();
    const context = structuredClone(value.context);
    context.identity.candidateId = "substituted-candidate";
    context.requiredPreRunSources.push({
      path: "inputs/formal/unledgered-source.json",
      sha256: "c".repeat(64),
    });
    const result = await verifyNhm2FormalKernelReplayFilesystem({
      projectRoot: value.projectRoot,
      context,
    });

    expect(result.valid).toBe(false);
    expect(result.expectedBindingsValid).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "formal_replay_required_pre_run_source_missing:inputs/formal/unledgered-source.json",
        "formal_replay_contract:expected_identity_mismatch",
      ]),
    );
  });

  it("rejects post-replay proof-byte tampering while claim authority stays false", async () => {
    const value = await fixture();
    await fs.appendFile(
      path.join(value.projectRoot, ...value.proofPath.split("/")),
      "tampered",
      "utf8",
    );
    const result = await verifyNhm2FormalKernelReplayFilesystem({
      projectRoot: value.projectRoot,
      context: value.context,
    });

    expect(result.valid).toBe(false);
    expect(result.referencedArtifactBytesVerified).toBe(false);
    expect(result.invokedLean).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "formal_replay_reference:sha256_mismatch:runs/formal/claim-lock-proof.olean",
        ),
      ]),
    );
  });

  it("rejects a certificate that substitutes a different artifact for the claim-lock proof", async () => {
    const value = await fixture();
    const context = structuredClone(value.context);
    context.claimLockProof = context.aggregateReplayTranscript;
    const result = await verifyNhm2FormalKernelReplayFilesystem({
      projectRoot: value.projectRoot,
      context,
    });

    expect(result.valid).toBe(false);
    expect(result.expectedBindingsValid).toBe(false);
    expect(result.invokedLean).toBe(false);
    expect(result.blockers).toContain(
      "formal_replay_certificate_claim_lock_proof_mismatch",
    );
  });

  it("rejects a replay timestamp outside the receipt execution interval", async () => {
    const value = await fixture();
    const context = structuredClone(value.context);
    context.receiptInterval.startedAt = "2099-07-19T12:00:01.000Z";
    const result = await verifyNhm2FormalKernelReplayFilesystem({
      projectRoot: value.projectRoot,
      context,
    });

    expect(result.valid).toBe(false);
    expect(result.expectedBindingsValid).toBe(false);
    expect(result.blockers).toContain(
      "formal_replay_generated_at_outside_receipt_interval",
    );
  });
});
