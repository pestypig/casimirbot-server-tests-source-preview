import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTheoryRuntimeReceiptV1 } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  buildTheoryRuntimeFreshnessProof,
  classifyTheoryRuntimeArtifacts,
  snapshotTheoryRuntimeOutput,
  writeTheoryRuntimeOutputManifest,
  writeTheoryRuntimePreSpawnSnapshotCommitment,
} from "../runtime-artifact-manifest";
import { verifyTheoryRuntimeReceiptFilesystem } from "../theory-runtime-receipt-filesystem-verifier";

const GIT_SHA = "a".repeat(40);
const STARTED_AT = "2099-07-19T12:00:00.000Z";
const COMPLETED_AT = "2099-07-19T12:00:01.000Z";

let projectRoot: string;
let outputDirectory: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "theory-receipt-fs-"));
  outputDirectory = path.join(projectRoot, "artifacts", "run-001");
  await fs.mkdir(outputDirectory, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

async function buildFixture(options: { includeFreshnessProof?: boolean } = {}) {
  const before = await snapshotTheoryRuntimeOutput({
    projectRoot,
    outputDirectory,
  });
  const beforeCommitment = await writeTheoryRuntimePreSpawnSnapshotCommitment({
    projectRoot,
    requestId: "request-001",
    runtimeId: "nhm2.shift_lapse.alpha_sweep",
    outputDirectory,
    beforeCapturedAt: STARTED_AT,
    gitSha: GIT_SHA,
    sourceTreeSha256: "f".repeat(64),
    worktreeClean: true,
    before,
  });
  const resultPath = path.join(outputDirectory, "result.json");
  await fs.writeFile(resultPath, JSON.stringify({ value: 42 }), "utf8");
  const after = await snapshotTheoryRuntimeOutput({
    projectRoot,
    outputDirectory,
  });
  const entries = classifyTheoryRuntimeArtifacts({ before, after });
  const manifest = await writeTheoryRuntimeOutputManifest({
    projectRoot,
    outputDirectory,
    requestId: "request-001",
    runtimeId: "nhm2.shift_lapse.alpha_sweep",
    gitSha: GIT_SHA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    generatedAt: COMPLETED_AT,
    entries,
    ...(options.includeFreshnessProof === false
      ? {}
      : {
          freshnessProof: buildTheoryRuntimeFreshnessProof({
            before,
            after,
            beforeCapturedAt: STARTED_AT,
            afterCapturedAt: COMPLETED_AT,
            beforeCommitmentPath: beforeCommitment.path,
            beforeCommitmentSha256: beforeCommitment.sha256,
          }),
        }),
  });
  const relativeOutputDirectory = "artifacts/run-001";
  const receipt = buildTheoryRuntimeReceiptV1({
    generatedAt: COMPLETED_AT,
    receiptId: "receipt-001",
    runtimeId: "nhm2.shift_lapse.alpha_sweep",
    graphId: "nhm2-theory-badge-graph",
    badgeIds: ["nhm2.meta.experiment_ready_theory_closure"],
    command: "npm run nhm2:test",
    args: { requestId: "request-001" },
    status: "completed",
    outputs: {
      artifacts: entries.map((entry) => entry.path),
      scalars: {},
      units: {},
      gates: { runtime_artifact_freshness: "pass" },
      missingSignals: [],
      warnings: [],
      artifactManifest: manifest,
    },
    provenance: {
      gitSha: GIT_SHA,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      durationMs: 1_000,
    },
    execution: {
      command: "npm run nhm2:test",
      args: [],
      cwd: projectRoot,
      environment: {},
      outputDirectory: relativeOutputDirectory,
      outputDirectoryBound: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: null,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "reduced_order",
      promotionAllowed: false,
      promotionBlockedBy: ["empirical_receipts_missing"],
    },
  });
  return { receipt, resultPath };
}

describe("theory runtime receipt filesystem verification", () => {
  it("replays the concrete manifest, inventory, hashes, and pre/post freshness proof", async () => {
    const { receipt } = await buildFixture();

    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });

    expect(result).toMatchObject({
      ok: true,
      blockers: [],
      freshnessProofVerified: true,
      outputDirectory,
    });
    expect(result.files).toHaveLength(1);
  });

  it("rejects artifact-byte tampering and unmanifested output", async () => {
    const { receipt, resultPath } = await buildFixture();
    await fs.writeFile(resultPath, JSON.stringify({ value: 43 }), "utf8");
    await fs.writeFile(
      path.join(outputDirectory, "unmanifested.json"),
      "{}",
      "utf8",
    );

    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^runtime_artifact_sha256_mismatch:/),
        "runtime_manifest_inventory_mismatch",
      ]),
    );
  });

  it("keeps a receipt without a persisted pre-run snapshot proof unverified", async () => {
    const { receipt } = await buildFixture({ includeFreshnessProof: false });

    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });

    expect(result.ok).toBe(false);
    expect(result.freshnessProofVerified).toBe(false);
    expect(result.blockers).toContain(
      "runtime_freshness_snapshot_proof_missing",
    );
  });

  it("rejects a manifest entry that resolves outside its declared output directory", async () => {
    const { receipt } = await buildFixture();
    const manifest = receipt.outputs.artifactManifest!;
    manifest.entries[0].path = "artifacts/outside.json";

    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "runtime_artifact:path_outside_output_directory:artifacts/outside.json",
    );
  });

  it("does not hide an unmanifested file behind the manifest filename prefix", async () => {
    const { receipt } = await buildFixture();
    await fs.writeFile(
      path.join(
        outputDirectory,
        "theory-runtime-output-manifest-hidden.v1.json",
      ),
      "{}",
      "utf8",
    );

    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("runtime_manifest_inventory_mismatch");
  });

  it("uses bytes and size for portable identity instead of current mtime", async () => {
    const { receipt, resultPath } = await buildFixture();
    await fs.utimes(resultPath, new Date(0), new Date(0));

    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });

    expect(result.ok).toBe(true);
  });

  it("fails closed rather than throwing for a malformed receipt", async () => {
    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt: { receiptId: "malformed" } as never,
    });

    expect(result).toMatchObject({
      ok: false,
      blockers: ["runtime_receipt_schema_invalid"],
      files: [],
    });
  });

  it("rejects tampering with the persisted pre-spawn commitment", async () => {
    const { receipt } = await buildFixture();
    const commitmentPath =
      receipt.outputs.artifactManifest!.freshnessProof!.beforeCommitmentPath;
    await fs.writeFile(path.join(projectRoot, commitmentPath), "{}\n", "utf8");

    const result = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot,
      receipt,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "runtime_before_commitment_sha256_mismatch",
        "runtime_before_commitment_schema_invalid",
      ]),
    );
  });
});
