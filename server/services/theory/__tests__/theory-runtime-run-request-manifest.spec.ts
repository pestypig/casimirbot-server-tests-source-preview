import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTheoryRuntimeRunRequestV1 } from "../../../../shared/contracts/theory-runtime-run-request.v1";
import {
  createTheoryRuntimeRunRequestManifest,
  readTheoryRuntimeRunRequestStatus,
  updateTheoryRuntimeRunRequestStatus,
} from "../theory-runtime-run-request-manifest";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "theory-runtime-request-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("theory runtime run request manifests", () => {
  it("creates a manifest JSON file for a registered runtime", async () => {
    const result = await createTheoryRuntimeRunRequestManifest({
      runtimeId: "solar.pipeline",
      graphId: "test.graph",
      badgeIds: ["solar.runtime.spectrum_analysis"],
      requestedScope: "quick",
      requestId: "request:solar",
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    const raw = await fs.readFile(result.manifestPath, "utf8");
    expect(result.manifestPath).toContain("artifacts");
    expect(JSON.parse(raw).runtimeId).toBe("solar.pipeline");
    expect(result.request.status).toBe("created");
    expect(result.request.heartbeat.message).toMatch(/no backend runtime executed/i);
    expect(isTheoryRuntimeRunRequestV1(result.request)).toBe(true);
  });

  it("updates and reads manifest status", async () => {
    await createTheoryRuntimeRunRequestManifest({
      runtimeId: "solar.manifest",
      graphId: "test.graph",
      badgeIds: ["solar.runtime.spectrum_analysis"],
      requestedScope: "evidence_refresh",
      requestId: "request:status",
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    const updated = await updateTheoryRuntimeRunRequestStatus({
      requestId: "request:status",
      status: "queued",
      projectRoot: tempRoot,
      updatedAt: "2026-05-29T00:01:00.000Z",
      heartbeat: {
        stage: "queued",
        message: "Queued for a future worker.",
        progress: 0.1,
      },
    });
    const readBack = await readTheoryRuntimeRunRequestStatus({
      requestId: "request:status",
      projectRoot: tempRoot,
    });

    expect(updated.request.status).toBe("queued");
    expect(readBack?.status).toBe("queued");
    expect(readBack?.heartbeat.stage).toBe("queued");
    expect(readBack?.heartbeat.progress).toBe(0.1);

    const indeterminate = await updateTheoryRuntimeRunRequestStatus({
      requestId: "request:status",
      status: "running",
      projectRoot: tempRoot,
      updatedAt: "2026-05-29T00:02:00.000Z",
      heartbeat: {
        stage: "runtime_execution",
        message: "Runtime is active; the command does not expose measurable progress.",
        progress: null,
      },
    });

    expect(indeterminate.request.heartbeat.progress).toBeNull();
  });

  it("rejects invalid runtimes", async () => {
    await expect(
      createTheoryRuntimeRunRequestManifest({
        runtimeId: "not.registered",
        graphId: "test.graph",
        badgeIds: ["test.badge"],
        requestedScope: "quick",
        projectRoot: tempRoot,
      }),
    ).rejects.toThrow(/not registered/i);
  });

  it("generates collision-resistant request identities even at the same timestamp", async () => {
    const [first, second] = await Promise.all([
      createTheoryRuntimeRunRequestManifest({
        runtimeId: "solar.manifest",
        graphId: "test.graph",
        badgeIds: [],
        requestedScope: "quick",
        projectRoot: tempRoot,
        generatedAt: "2026-05-29T00:00:00.000Z",
      }),
      createTheoryRuntimeRunRequestManifest({
        runtimeId: "solar.manifest",
        graphId: "test.graph",
        badgeIds: [],
        requestedScope: "quick",
        projectRoot: tempRoot,
        generatedAt: "2026-05-29T00:00:00.000Z",
      }),
    ]);

    expect(first.request.requestId).not.toBe(second.request.requestId);
    expect(first.manifestPath).not.toBe(second.manifestPath);
  });

  it("never replaces an existing deterministic request identity", async () => {
    const input = {
      runtimeId: "solar.manifest",
      graphId: "test.graph",
      badgeIds: [] as string[],
      requestedScope: "quick" as const,
      requestId: "request:single-use",
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    };
    const first = await createTheoryRuntimeRunRequestManifest(input);
    await updateTheoryRuntimeRunRequestStatus({
      requestId: input.requestId,
      projectRoot: tempRoot,
      status: "failed",
      updatedAt: "2026-05-29T00:01:00.000Z",
      heartbeat: {
        stage: "failed",
        message: "Original attempt failed.",
        progress: 1,
      },
    });
    const original = await fs.readFile(first.manifestPath);

    await expect(
      createTheoryRuntimeRunRequestManifest({
        ...input,
        generatedAt: "2026-05-29T00:02:00.000Z",
      }),
    ).rejects.toThrow(/already exists.*immutable/i);

    expect(await fs.readFile(first.manifestPath)).toEqual(original);
    expect(
      (await readTheoryRuntimeRunRequestStatus({
        requestId: input.requestId,
        projectRoot: tempRoot,
      }))?.status,
    ).toBe("failed");
  });

  it("keeps long warp/NHM2 requests manifest-only by default", async () => {
    const result = await createTheoryRuntimeRunRequestManifest({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      requestedScope: "full",
      requestId: "request:warp-full-solve",
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(result.request.runtimeId).toBe("warp.full_solve.campaign");
    expect(result.request.status).toBe("created");
    expect(result.request.outputArtifactGlobs.some((glob) => glob.includes("full-solve"))).toBe(true);
    expect(result.request.claimBoundary.promotionAllowed).toBe(false);
    expect(result.request.claimBoundary.maximumTier).toBe("reduced_order");
    expect(result.request.heartbeat.stage).toBe("manifest_created");
    expect(result.request.heartbeat.message).toMatch(/no backend runtime executed/i);
  });
});
