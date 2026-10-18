import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  Nhm2IndependentRuntimePlanAdmissionError,
  admitNhm2IndependentRuntimePlan,
  resolveNhm2IndependentRuntimeServerPolicy,
} from "../nhm2-independent-runtime-plan-admission";

const temporaryRoots: string[] = [];

const temporaryRoot = async (): Promise<string> => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-independent-admit-"),
  );
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("NHM2 independent runtime-plan admission skeleton", () => {
  it("resolves the server-owned policy as typed not_configured", async () => {
    const projectRoot = await temporaryRoot();

    await expect(
      resolveNhm2IndependentRuntimeServerPolicy({ projectRoot }),
    ).resolves.toMatchObject({
      status: "not_configured",
      authority: "server_owned_policy_resolver",
      policyId: null,
      policySemanticSha256: null,
      blocker: "server_owned_independent_runtime_policy_not_configured",
    });
  });

  it("stops before filesystem observation, persistence, or process launch", async () => {
    const projectRoot = await temporaryRoot();
    const result = await admitNhm2IndependentRuntimePlan({
      projectRoot,
      candidateManifestPath: "candidates/frozen-candidate.json",
    });

    expect(result.status).toBe("not_configured");
    expect(result.candidate).toMatchObject({
      manifestPath: "candidates/frozen-candidate.json",
      manifestReadAttempted: false,
      manifestSha256: null,
      candidateId: null,
    });
    expect(result.externalDescriptor.observationAttempted).toBe(false);
    expect(result.primaryReceipt.observationAttempted).toBe(false);
    expect(result.preseal).toMatchObject({
      status: "not_created",
      persistenceAttempted: false,
      path: null,
      sha256: null,
    });
    expect(result.process).toEqual({
      launchAttempted: false,
      launchPermitted: false,
      observation: null,
    });
    expect(Object.values(result.claimLocks).every((value) => !value)).toBe(
      true,
    );
    expect(await fs.readdir(projectRoot)).toEqual([]);
  });

  it("rejects caller authority seams and paths outside the project root", async () => {
    const projectRoot = await temporaryRoot();
    const withInjectedPolicy = {
      projectRoot,
      candidateManifestPath: "candidate.json",
      approvedPolicy: { status: "approved" },
    } as unknown as Parameters<typeof admitNhm2IndependentRuntimePlan>[0];

    await expect(
      admitNhm2IndependentRuntimePlan(withInjectedPolicy),
    ).rejects.toMatchObject<Nhm2IndependentRuntimePlanAdmissionError>({
      code: "admission_input_invalid",
    });
    await expect(
      admitNhm2IndependentRuntimePlan({
        projectRoot,
        candidateManifestPath: "../outside.json",
      }),
    ).rejects.toMatchObject<Nhm2IndependentRuntimePlanAdmissionError>({
      code: "admission_input_invalid",
    });
    expect(await fs.readdir(projectRoot)).toEqual([]);
  });
});
