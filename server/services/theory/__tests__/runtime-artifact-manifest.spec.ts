import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildTheoryRuntimeFreshnessProof,
  classifyTheoryRuntimeArtifacts,
  sha256TheoryRuntimeFile,
  snapshotTheoryRuntimeOutput,
  writeTheoryRuntimeOutputManifest,
  writeTheoryRuntimePreSpawnSnapshotCommitment,
} from "../runtime-artifact-manifest";

let tempRoot: string;
let outputDirectory: string;

async function writeOutput(name: string, value: string): Promise<string> {
  const absolutePath = path.join(outputDirectory, name);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, value, "utf8");
  return absolutePath;
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "runtime-artifact-manifest-"),
  );
  outputDirectory = path.join(tempRoot, "artifacts", "run-output");
  await fs.mkdir(outputDirectory, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("runtime artifact manifests", () => {
  it("classifies new, content-changed, and unchanged files using SHA-256", async () => {
    const stablePath = await writeOutput("stable.json", "stable");
    await writeOutput("changed.json", "before");
    const before = await snapshotTheoryRuntimeOutput({
      projectRoot: tempRoot,
      outputDirectory,
    });

    const future = new Date(Date.now() + 60_000);
    await fs.utimes(stablePath, future, future);
    await writeOutput("changed.json", "after");
    await writeOutput("new.json", "new");
    const after = await snapshotTheoryRuntimeOutput({
      projectRoot: tempRoot,
      outputDirectory,
    });

    expect(classifyTheoryRuntimeArtifacts({ before, after })).toEqual([
      expect.objectContaining({
        path: "artifacts/run-output/changed.json",
        freshness: "changed",
      }),
      expect.objectContaining({
        path: "artifacts/run-output/new.json",
        freshness: "new",
      }),
      expect.objectContaining({
        path: "artifacts/run-output/stable.json",
        freshness: "preexisting",
      }),
    ]);
  });

  it("writes a concrete manifest with a separately verifiable manifest hash", async () => {
    await writeOutput("result.json", JSON.stringify({ status: "pass" }));
    const before = new Map();
    const after = await snapshotTheoryRuntimeOutput({
      projectRoot: tempRoot,
      outputDirectory,
    });
    const beforeCommitment = await writeTheoryRuntimePreSpawnSnapshotCommitment(
      {
        projectRoot: tempRoot,
        requestId: "request:test",
        runtimeId: "nhm2.shift_lapse.alpha_sweep",
        outputDirectory,
        beforeCapturedAt: "2026-07-19T00:00:00.000Z",
        gitSha: "1234567890abcdef1234567890abcdef12345678",
        sourceTreeSha256: "f".repeat(64),
        worktreeClean: true,
        before,
      },
    );
    const freshnessProof = buildTheoryRuntimeFreshnessProof({
      before,
      after,
      beforeCapturedAt: "2026-07-19T00:00:00.000Z",
      afterCapturedAt: "2026-07-19T00:00:01.000Z",
      beforeCommitmentPath: beforeCommitment.path,
      beforeCommitmentSha256: beforeCommitment.sha256,
    });
    const manifest = await writeTheoryRuntimeOutputManifest({
      projectRoot: tempRoot,
      outputDirectory,
      requestId: "request:test",
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      gitSha: "1234567890abcdef1234567890abcdef12345678",
      startedAt: "2026-07-19T00:00:00.000Z",
      completedAt: "2026-07-19T00:00:01.000Z",
      generatedAt: "2026-07-19T00:00:01.000Z",
      entries: classifyTheoryRuntimeArtifacts({ before, after }),
      freshnessProof,
    });

    expect(manifest.boundToExecution).toBe(true);
    expect(manifest.entries[0]).toMatchObject({
      freshness: "new",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(manifest.freshnessProof).toEqual(freshnessProof);
    expect(manifest.freshnessProof?.beforeEntries).toEqual([]);
    expect(manifest.freshnessProof?.beforeCommitmentPath).toBe(
      beforeCommitment.path,
    );
    expect(manifest.manifestSha256).toBe(
      await sha256TheoryRuntimeFile(
        path.join(tempRoot, manifest.manifestPath!),
      ),
    );
    const nextSnapshot = await snapshotTheoryRuntimeOutput({
      projectRoot: tempRoot,
      outputDirectory,
    });
    expect([...nextSnapshot.keys()]).toEqual([
      "artifacts/run-output/result.json",
    ]);
  });

  it("rejects output roots that escape through a symbolic link", async () => {
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "runtime-artifact-outside-"),
    );
    const linkedOutput = path.join(tempRoot, "artifacts", "linked-output");
    await fs.mkdir(path.dirname(linkedOutput), { recursive: true });
    try {
      await fs.symlink(
        outside,
        linkedOutput,
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(
        snapshotTheoryRuntimeOutput({
          projectRoot: tempRoot,
          outputDirectory: linkedOutput,
        }),
      ).rejects.toThrow(/symbolic link|real project root/i);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
