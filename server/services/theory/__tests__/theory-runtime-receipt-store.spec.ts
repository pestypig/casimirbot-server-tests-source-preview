import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildTheoryRuntimeReceiptV1,
  type TheoryRuntimeReceiptV1,
} from "../../../../shared/contracts/theory-runtime-receipt.v1";
import { sha256TheoryRuntimeFile } from "../runtime-artifact-manifest";
import {
  THEORY_RUNTIME_RECEIPT_STORE_ROOT,
  writeTheoryRuntimeReceiptArtifact,
} from "../theory-runtime-receipt-store";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "runtime-receipt-store-"),
  );
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

function receiptFor(
  overrides: Partial<
    Pick<TheoryRuntimeReceiptV1, "receiptId" | "runtimeId">
  > = {},
): TheoryRuntimeReceiptV1 {
  return buildTheoryRuntimeReceiptV1({
    generatedAt: "2026-07-19T12:00:01.000Z",
    receiptId: overrides.receiptId ?? "receipt:alpha/001",
    runtimeId: overrides.runtimeId ?? "nhm2.shift_lapse.alpha_sweep",
    graphId: "nhm2-theory-badge-graph",
    badgeIds: ["nhm2.meta.experiment_ready_theory_closure"],
    command: "npm run warp:full-solve:nhm2-shift-lapse:alpha-sweep",
    args: {},
    status: "completed",
    outputs: {
      artifacts: [],
      scalars: {},
      units: {},
      gates: {},
      missingSignals: [],
      warnings: [],
    },
    provenance: {
      gitSha: "a".repeat(40),
      startedAt: "2026-07-19T12:00:00.000Z",
      completedAt: "2026-07-19T12:00:01.000Z",
      durationMs: 1_000,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "reduced_order",
      promotionAllowed: false,
      promotionBlockedBy: ["empirical_receipts_missing"],
    },
  });
}

describe("theory runtime receipt store", () => {
  it("writes a digest-addressed receipt with a store-owned persistence time", async () => {
    const beforeWrite = Date.now();
    const receipt = receiptFor();
    const result = await writeTheoryRuntimeReceiptArtifact({
      projectRoot,
      requestId: "request:alpha/../unsafe-looking",
      receipt,
      writtenAt: "1999-01-01T00:00:00.000Z",
    });
    const afterWrite = Date.now();
    const absolutePath = path.join(projectRoot, result.path);

    expect(result).toMatchObject({
      artifactId: "theory_runtime_persisted_receipt",
      schemaVersion: "theory_runtime_persisted_receipt/v1",
      requestId: "request:alpha/../unsafe-looking",
      receiptId: receipt.receiptId,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.path).toMatch(
      /^artifacts\/research\/theory-runtime-receipts\/receipt-[A-Za-z0-9_-]{43}\.v1\.json$/,
    );
    expect(result.path).not.toContain(receipt.receiptId);
    expect(result.path).not.toContain("unsafe-looking");
    expect(Date.parse(result.writtenAt)).toBeGreaterThanOrEqual(beforeWrite);
    expect(Date.parse(result.writtenAt)).toBeLessThanOrEqual(afterWrite);
    expect(result.writtenAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(result.sha256).toBe(await sha256TheoryRuntimeFile(absolutePath));
    expect(result.sizeBytes).toBe((await fs.stat(absolutePath)).size);
    expect(JSON.parse(await fs.readFile(absolutePath, "utf8"))).toEqual(
      receipt,
    );
    expect(
      (
        await fs.readdir(
          path.join(projectRoot, THEORY_RUNTIME_RECEIPT_STORE_ROOT),
        )
      ).filter((entry) => entry.endsWith(".create.tmp")),
    ).toEqual([]);
  });

  it("does not alias identity strings that collided under lossy sanitization", async () => {
    const receipt = receiptFor({ receiptId: "receipt:collision-check" });
    const first = await writeTheoryRuntimeReceiptArtifact({
      projectRoot,
      requestId: "request:a/b",
      receipt,
    });
    const second = await writeTheoryRuntimeReceiptArtifact({
      projectRoot,
      requestId: "request:a?b",
      receipt,
    });

    expect(first.path).not.toBe(second.path);
    expect(await fs.readFile(path.join(projectRoot, first.path), "utf8")).toBe(
      await fs.readFile(path.join(projectRoot, second.path), "utf8"),
    );
  });

  it("rejects empty and dot identity components", async () => {
    await expect(
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: " ",
        receipt: receiptFor(),
      }),
    ).rejects.toThrow(/requestId must be a non-empty string/);
    await expect(
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: ".",
        receipt: receiptFor(),
      }),
    ).rejects.toThrow(/requestId must not be a dot path component/);
    await expect(
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: "request:alpha",
        receipt: receiptFor({ runtimeId: ".." }),
      }),
    ).rejects.toThrow(/runtimeId must not be a dot path component/);
    await expect(
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: "request:alpha",
        receipt: receiptFor({ receiptId: " . " }),
      }),
    ).rejects.toThrow(/receiptId must not be a dot path component/);
  });

  it("uses create-only writes and never replaces an existing receipt", async () => {
    const receipt = receiptFor({ receiptId: "receipt:immutable" });
    const attempts = await Promise.allSettled([
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: "request:immutable",
        receipt,
      }),
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: "request:immutable",
        receipt,
      }),
    ]);
    const fulfilled = attempts.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof writeTheoryRuntimeReceiptArtifact>>
      > => result.status === "fulfilled",
    );
    const rejected = attempts.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(
      /already exists and is immutable/,
    );
    const absolutePath = path.join(projectRoot, fulfilled[0].value.path);
    const originalBytes = await fs.readFile(absolutePath);
    const replacement = structuredClone(receipt);
    replacement.status = "failed";

    await expect(
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: "request:immutable",
        receipt: replacement,
      }),
    ).rejects.toThrow(/already exists and is immutable/);
    expect(await fs.readFile(absolutePath)).toEqual(originalBytes);
    expect(
      (
        await fs.readdir(
          path.join(projectRoot, THEORY_RUNTIME_RECEIPT_STORE_ROOT),
        )
      ).filter((entry) => entry.endsWith(".create.tmp")),
    ).toEqual([]);
  });

  it("rejects a symbolic-link ancestor even when it stays inside the project", async () => {
    const artifactsDirectory = path.join(projectRoot, "artifacts");
    const redirectedResearch = path.join(projectRoot, "redirected-research");
    await fs.mkdir(artifactsDirectory);
    await fs.mkdir(redirectedResearch);
    try {
      await fs.symlink(
        redirectedResearch,
        path.join(artifactsDirectory, "research"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: "request:symlink",
        receipt: receiptFor({ receiptId: "receipt:symlink" }),
      }),
    ).rejects.toThrow(/must not be a symbolic link/);
    await expect(fs.readdir(redirectedResearch)).resolves.toEqual([]);
  });

  it("rejects a symbolic-link final store parent", async () => {
    const storeRoot = path.join(projectRoot, THEORY_RUNTIME_RECEIPT_STORE_ROOT);
    const redirectedStore = path.join(projectRoot, "redirected-store");
    await fs.mkdir(path.dirname(storeRoot), { recursive: true });
    await fs.mkdir(redirectedStore);
    try {
      await fs.symlink(
        redirectedStore,
        storeRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(
      writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: "request:store-symlink",
        receipt: receiptFor({ receiptId: "receipt:store-symlink" }),
      }),
    ).rejects.toThrow(/must not be a symbolic link/);
    await expect(fs.readdir(redirectedStore)).resolves.toEqual([]);
  });
});
