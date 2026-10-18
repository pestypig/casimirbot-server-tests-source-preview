import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Nhm2TheoryCandidatePlanAdmission } from "../nhm2-theory-candidate-plan-admission";
import {
  NHM2_PRIMARY_COMPARISON_PROJECTION_ASSESSMENT_FILENAME,
  publishNhm2PrimaryComparisonProjectionAssessment,
} from "../nhm2-primary-comparison-projection-finalizer";
import type { Nhm2PrimaryRawOutputFilesystemVerification } from "../nhm2-primary-raw-output-filesystem-verifier";
import type { Nhm2PrimaryRawRunPublication } from "../nhm2-primary-raw-run-publisher";
import { verifyNhm2PrimaryRunOwnedReferenceClosure } from "../nhm2-theory-candidate-primary-executor";

const roots: string[] = [];
const digest = (character: string): string => character.repeat(64);

const fixture = async () => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-primary-projection-finalizer-"),
  );
  roots.push(projectRoot);
  const outputDirectory = "run-owned-primary-output";
  const outputRoot = path.join(projectRoot, outputDirectory);
  await fs.mkdir(outputRoot);
  const candidateId = "candidate-p0";
  const runId = "primary-run-p0";
  const rawVerification = {
    verified: true,
    violations: [],
    runRootRealPath: await fs.realpath(outputRoot),
    manifestPath: path.join(outputRoot, "primary-raw-output-manifest.v1.json"),
    manifestSha256: digest("6"),
    manifest: {
      identity: { candidateId },
      execution: { runId },
      inputClosure: { closureSha256: digest("8") },
    },
    files: [],
  } as unknown as Extract<
    Nhm2PrimaryRawOutputFilesystemVerification,
    { verified: true }
  >;
  const admission = {
    outputDirectory,
    manifest: { bindings: { candidate: { candidateId } } },
    plan: { runId },
  } as unknown as Nhm2TheoryCandidatePlanAdmission;
  const rawPublication = {
    rawManifestSha256: rawVerification.manifestSha256,
    rawVerification,
  } as unknown as Nhm2PrimaryRawRunPublication;
  return {
    projectRoot,
    outputDirectory,
    outputRoot,
    admission,
    rawPublication,
  };
};

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(os.tmpdir(), root);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !path.basename(root).startsWith("nhm2-primary-projection-finalizer-")
    ) {
      throw new Error(`Refusing to remove unexpected test root: ${root}`);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("server-owned NHM2 primary comparison projection P0 finalizer", () => {
  it("publishes one immutable not-ready assessment without a manifest or projected arrays", async () => {
    const value = await fixture();
    let hostileManifestRead = false;
    const hostileManifest = new Proxy(
      {},
      {
        get: () => {
          hostileManifestRead = true;
          throw new Error("caller projection manifest must not be read");
        },
      },
    );

    const publication = await publishNhm2PrimaryComparisonProjectionAssessment({
      projectRoot: value.projectRoot,
      admission: value.admission,
      rawPublication: value.rawPublication,
      manifest: hostileManifest,
    } as Parameters<
      typeof publishNhm2PrimaryComparisonProjectionAssessment
    >[0]);

    expect(hostileManifestRead).toBe(false);
    expect(publication.status).toBe("not_ready");
    expect(publication.supplementaryRootPaths).toEqual([
      `${value.outputDirectory}/${NHM2_PRIMARY_COMPARISON_PROJECTION_ASSESSMENT_FILENAME}`,
    ]);
    expect(publication.assessment.source).toMatchObject({
      manifestArtifactId: null,
      manifestContractVersion: null,
      manifestSha256: null,
      rawFilesystemVerificationObserved: true,
      rawFilesystemVerificationBoundToProjectionManifest: false,
      rawManifestSha256: digest("6"),
      rawInputClosureSha256: digest("8"),
    });
    expect(publication.assessment.primaryComparisonProjectionReady).toBe(false);
    expect(publication.assessment.claimBoundary).toMatchObject({
      theoryClosureEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      certifiedSpeedEstablished: false,
    });
    expect(await fs.readdir(value.outputRoot)).toEqual([
      NHM2_PRIMARY_COMPARISON_PROJECTION_ASSESSMENT_FILENAME,
    ]);
    const bytes = await fs.readFile(
      path.join(
        value.outputRoot,
        NHM2_PRIMARY_COMPARISON_PROJECTION_ASSESSMENT_FILENAME,
      ),
    );
    expect(publication.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(publication.sizeBytes).toBe(bytes.byteLength);
  });

  it("refuses to overwrite a child-authored assessment target", async () => {
    const value = await fixture();
    const target = path.join(
      value.outputRoot,
      NHM2_PRIMARY_COMPARISON_PROJECTION_ASSESSMENT_FILENAME,
    );
    await fs.writeFile(target, '{"authority":"child"}\n', "utf8");

    await expect(
      publishNhm2PrimaryComparisonProjectionAssessment({
        projectRoot: value.projectRoot,
        admission: value.admission,
        rawPublication: value.rawPublication,
      }),
    ).rejects.toThrow(/already exists and is immutable/i);
    await expect(fs.readFile(target, "utf8")).resolves.toBe(
      '{"authority":"child"}\n',
    );
  });

  it("closes the assessment as a supplementary run-owned trust root", async () => {
    const value = await fixture();
    const publication = await publishNhm2PrimaryComparisonProjectionAssessment({
      projectRoot: value.projectRoot,
      admission: value.admission,
      rawPublication: value.rawPublication,
    });
    const rootPaths: string[] = [];
    const entries = [];
    for (let index = 0; index < 9; index += 1) {
      const rootPath = `${value.outputDirectory}/evidence/root-${index}.json`;
      const absolute = path.join(value.projectRoot, rootPath);
      const bytes = Buffer.from(`${JSON.stringify({ root: index })}\n`, "utf8");
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, bytes);
      rootPaths.push(rootPath);
      entries.push({
        path: rootPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
        modifiedAt: "2026-07-20T12:00:00.000Z",
        freshness: "new" as const,
      });
    }
    entries.push({
      path: publication.outputPath,
      sha256: publication.sha256,
      sizeBytes: publication.sizeBytes,
      modifiedAt: publication.assessment.generatedAt,
      freshness: "new" as const,
    });

    await expect(
      verifyNhm2PrimaryRunOwnedReferenceClosure({
        projectRoot: value.projectRoot,
        outputDirectory: value.outputDirectory,
        rootPaths,
        additionalRootPaths: publication.supplementaryRootPaths,
        entries,
      }),
    ).resolves.toMatchObject({
      rootCount: 9,
      supplementaryCount: 1,
      referencedPaths: expect.arrayContaining([publication.outputPath]),
    });
  });

  it("rejects a raw publication whose run identity is not the admitted run", async () => {
    const value = await fixture();
    value.rawPublication.rawVerification.manifest.execution.runId =
      "substituted-run";

    await expect(
      publishNhm2PrimaryComparisonProjectionAssessment({
        projectRoot: value.projectRoot,
        admission: value.admission,
        rawPublication: value.rawPublication,
      }),
    ).rejects.toThrow(/raw publication identity mismatch/i);
    await expect(fs.readdir(value.outputRoot)).resolves.toEqual([]);
  });

  it("rejects a raw-verification root alias before publication", async () => {
    const value = await fixture();
    value.rawPublication.rawVerification.runRootRealPath = path.join(
      value.projectRoot,
      "different-run-root",
    );

    await expect(
      publishNhm2PrimaryComparisonProjectionAssessment({
        projectRoot: value.projectRoot,
        admission: value.admission,
        rawPublication: value.rawPublication,
      }),
    ).rejects.toThrow(/root identity mismatch/i);
    await expect(fs.readdir(value.outputRoot)).resolves.toEqual([]);
  });
});
