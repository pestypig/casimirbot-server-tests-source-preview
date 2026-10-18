import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  NHM2_FORMAL_APPROVED_LAKE_RELEASE,
  NHM2_FORMAL_APPROVED_LAKE_VERSION_OUTPUT,
  NHM2_FORMAL_APPROVED_LEAN_COMMIT_SHA,
  NHM2_FORMAL_APPROVED_LEAN_RELEASE,
  NHM2_FORMAL_APPROVED_LEAN_TOOLCHAIN_FILE,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_BLOCKERS,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_CLAIM_BOUNDARY,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_ARTIFACT_ID,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_AUTHORITY,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_CONTRACT_VERSION,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_STATUS,
  NHM2_FORMAL_APPROVED_TOOLCHAIN_TARGETS,
  compareNhm2FormalApprovedToolchainUtf8,
  computeNhm2FormalApprovedToolchainLedgerSha256,
  computeNhm2FormalApprovedToolchainPolicySemanticSha256,
  type Nhm2FormalApprovedToolchainPolicySemanticV1,
  type Nhm2FormalApprovedToolchainPolicyV1,
} from "../../../../shared/contracts/nhm2-formal-approved-toolchain-policy.v1";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
  type Nhm2ExperimentReadyTheoryFormalRunSpecV1,
} from "../../../../tools/nhm2/run-experiment-ready-theory-formal";
import { computeNhm2FormalKernelLedgerSha256 } from "../nhm2-formal-kernel-executor";
import {
  Nhm2FormalApprovedToolchainPolicyVerifierError,
  verifyNhm2FormalApprovedToolchainPolicy,
} from "../nhm2-formal-approved-toolchain-policy-verifier";

const sha = (token: string): string => token.repeat(64);

const target =
  NHM2_FORMAL_APPROVED_TOOLCHAIN_TARGETS.find(
    (candidate) =>
      candidate.platform === process.platform &&
      candidate.architecture === process.arch,
  ) ??
  (() => {
    throw new Error("Test host is not an approved Lean target.");
  })();

const exactLeanVersionOutput = (
  selectedTarget: (typeof NHM2_FORMAL_APPROVED_TOOLCHAIN_TARGETS)[number],
): string =>
  `Lean (version ${NHM2_FORMAL_APPROVED_LEAN_RELEASE}, ${selectedTarget.leanTargetTriple}, commit ${NHM2_FORMAL_APPROVED_LEAN_COMMIT_SHA}, Release)`;

const executableSuffix = process.platform === "win32" ? ".exe" : "";

const makePolicy = (): Nhm2FormalApprovedToolchainPolicyV1 => {
  const entries = [
    {
      relativePath: `bin/lake${executableSuffix}`,
      sha256: sha("b"),
      sizeBytes: 23,
    },
    {
      relativePath: `bin/lean${executableSuffix}`,
      sha256: sha("a"),
      sizeBytes: 19,
    },
    {
      relativePath: "lib/lean/Init.olean",
      sha256: sha("c"),
      sizeBytes: 31,
    },
  ].sort((left, right) =>
    compareNhm2FormalApprovedToolchainUtf8(
      left.relativePath,
      right.relativePath,
    ),
  );
  const semantic: Nhm2FormalApprovedToolchainPolicySemanticV1 = {
    artifactId: NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_ARTIFACT_ID,
    contractVersion:
      NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_CONTRACT_VERSION,
    policyId: `lean-4.31.0-${process.platform}-${process.arch}-fixture-v1`,
    approvedAt: "2026-07-19T12:00:00.000Z",
    authority: NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_AUTHORITY,
    status: NHM2_FORMAL_APPROVED_TOOLCHAIN_POLICY_STATUS,
    target,
    releases: {
      lean: {
        release: NHM2_FORMAL_APPROVED_LEAN_RELEASE,
        commitSha: NHM2_FORMAL_APPROVED_LEAN_COMMIT_SHA,
        buildProfile: "Release",
        exactVersionOutput: exactLeanVersionOutput(target),
      },
      lake: {
        release: NHM2_FORMAL_APPROVED_LAKE_RELEASE,
        leanReleaseBinding: NHM2_FORMAL_APPROVED_LEAN_RELEASE,
        leanCommitShaBinding: NHM2_FORMAL_APPROVED_LEAN_COMMIT_SHA,
        leanCommitPrefixBinding: "68218e8",
        exactVersionOutput: NHM2_FORMAL_APPROVED_LAKE_VERSION_OUTPUT,
      },
    },
    formalProjectToolchainFile: {
      ...NHM2_FORMAL_APPROVED_LEAN_TOOLCHAIN_FILE,
    },
    toolchainLedger: {
      rootIndependent: true,
      algorithm: "sha256_json_canonical_tuple_list/v1",
      domain: "nhm2_formal_kernel_sealed_ledger/v1",
      kind: "toolchain",
      entries,
      aggregateSha256:
        computeNhm2FormalApprovedToolchainLedgerSha256(entries),
      entryCount: entries.length,
      aggregateBytes: entries.reduce(
        (total, entry) => total + entry.sizeBytes,
        0,
      ),
    },
    executables: {
      lean: { ...entries.find((entry) => entry.relativePath.includes("lean"))! },
      lake: { ...entries.find((entry) => entry.relativePath.includes("lake"))! },
    },
    approvedEnvironment: {
      allowlist: ["LEAN_PATH"],
      values: [{ name: "LEAN_PATH", value: "" }],
    },
    blockers: [...NHM2_FORMAL_APPROVED_TOOLCHAIN_BLOCKERS],
    claimBoundary: { ...NHM2_FORMAL_APPROVED_TOOLCHAIN_CLAIM_BOUNDARY },
  };
  return {
    ...semantic,
    semanticSha256:
      computeNhm2FormalApprovedToolchainPolicySemanticSha256(semantic),
  };
};

const computeLedgerSha256 = (
  kind: "source" | "toolchain",
  entries: Array<{ relativePath: string; sha256: string; sizeBytes: number }>,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        domain: "nhm2_formal_kernel_sealed_ledger/v1",
        kind,
        entries,
      }),
    )
    .digest("hex");

const portable = (root: string, absolutePath: string): string =>
  path.relative(root, absolutePath).split(path.sep).join("/");

const makeRunSpec = (
  policy: Nhm2FormalApprovedToolchainPolicyV1,
  workspaceRoot = path.resolve("nhm2-approved-toolchain-test-workspace"),
): Nhm2ExperimentReadyTheoryFormalRunSpecV1 => {
  const sourceRoot = path.join(workspaceRoot, "preseal", "formal-source");
  const toolchainRoot = path.join(workspaceRoot, "preseal", "lean-toolchain");
  const sourceEntries = [
    {
      relativePath: "lean-toolchain",
      sha256: policy.formalProjectToolchainFile.sha256,
      sizeBytes: policy.formalProjectToolchainFile.sizeBytes,
    },
  ];
  const toolchainEntries = structuredClone(policy.toolchainLedger.entries);
  const toolchainBindings = toolchainEntries.map((entry) => {
    const absolutePath = path.resolve(
      toolchainRoot,
      ...entry.relativePath.split("/"),
    );
    return {
      toolchainRole:
        entry.relativePath === policy.executables.lean.relativePath
          ? ("lean_executable" as const)
          : entry.relativePath === policy.executables.lake.relativePath
            ? ("lake_executable" as const)
            : ("runtime_dependency" as const),
      path: portable(workspaceRoot, absolutePath),
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
    };
  });
  const spec = {
    artifactId: NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
    contractVersion:
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
    planBinding: {
      solver: {
        solverVersion: "caller-label-lean-999.0-is-not-authority",
      },
    },
    formalSourceBindings: {
      authority: "server_owned_formal_project",
      projectRoot: sourceRoot,
      entries: [
        {
          sourceRole: "lean_toolchain",
          path: portable(workspaceRoot, path.join(sourceRoot, "lean-toolchain")),
          sha256: policy.formalProjectToolchainFile.sha256,
          sizeBytes: policy.formalProjectToolchainFile.sizeBytes,
        },
      ],
    },
    toolchainBindings: {
      authority: "sealed_lean_toolchain",
      toolchainRoot,
      entries: toolchainBindings,
    },
    executor: {
      executables: {
        lean: {
          absolutePath: path.resolve(
            toolchainRoot,
            ...policy.executables.lean.relativePath.split("/"),
          ),
          sha256: policy.executables.lean.sha256,
          sizeBytes: policy.executables.lean.sizeBytes,
        },
        lake: {
          absolutePath: path.resolve(
            toolchainRoot,
            ...policy.executables.lake.relativePath.split("/"),
          ),
          sha256: policy.executables.lake.sha256,
          sizeBytes: policy.executables.lake.sizeBytes,
        },
      },
      ledgers: {
        source: {
          kind: "source",
          rootPath: sourceRoot,
          entries: sourceEntries,
          ledgerSha256: computeLedgerSha256("source", sourceEntries),
        },
        toolchain: {
          kind: "toolchain",
          rootPath: toolchainRoot,
          entries: toolchainEntries,
          ledgerSha256: computeLedgerSha256("toolchain", toolchainEntries),
        },
      },
      environmentAllowlist: [...policy.approvedEnvironment.allowlist],
      environment: Object.fromEntries(
        policy.approvedEnvironment.values.map((entry) => [
          entry.name,
          entry.value,
        ]),
      ),
    },
  };
  return spec as unknown as Nhm2ExperimentReadyTheoryFormalRunSpecV1;
};

const resealPolicy = (
  policy: Nhm2FormalApprovedToolchainPolicyV1,
): Nhm2FormalApprovedToolchainPolicyV1 => {
  const mutable = policy as unknown as Record<string, unknown>;
  const { semanticSha256: _semanticSha256, ...semantic } = mutable;
  policy.semanticSha256 =
    computeNhm2FormalApprovedToolchainPolicySemanticSha256(
      semantic as unknown as Nhm2FormalApprovedToolchainPolicySemanticV1,
    );
  return policy;
};

const expectCode = (callback: () => unknown, code: string): void => {
  try {
    callback();
    throw new Error("Expected verifier failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(
      Nhm2FormalApprovedToolchainPolicyVerifierError,
    );
    expect(
      (error as Nhm2FormalApprovedToolchainPolicyVerifierError).code,
    ).toBe(code);
  }
};

describe("NHM2 formal approved toolchain policy verifier", () => {
  it("binds the repository lean-toolchain file to its exact frozen bytes", async () => {
    const bytes = await fs.readFile(
      path.resolve(NHM2_FORMAL_APPROVED_LEAN_TOOLCHAIN_FILE.path),
    );
    expect(bytes.byteLength).toBe(
      NHM2_FORMAL_APPROVED_LEAN_TOOLCHAIN_FILE.sizeBytes,
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      NHM2_FORMAL_APPROVED_LEAN_TOOLCHAIN_FILE.sha256,
    );
    expect(bytes.toString("utf8").trimEnd()).toBe(
      NHM2_FORMAL_APPROVED_LEAN_TOOLCHAIN_FILE.exactUtf8Line,
    );
  });

  it("admits only the exact root-independent ledger and keeps every physical claim closed", () => {
    const policy = makePolicy();
    const workspaceRoot = path.resolve("nhm2-toolchain-fixture-a");
    const result = verifyNhm2FormalApprovedToolchainPolicy({
      approvedPolicy: policy,
      formalRunSpec: makeRunSpec(policy, workspaceRoot),
      workspaceRoot,
    });

    expect(result.status).toBe("pass_approved_diagnostic_toolchain_match");
    expect(result.releases.lean).toMatchObject({
      release: "4.31.0",
      commitSha: NHM2_FORMAL_APPROVED_LEAN_COMMIT_SHA,
    });
    expect(result.releases.lake).toMatchObject({
      release: "5.0.0-src+68218e8",
      leanReleaseBinding: "4.31.0",
    });
    expect(result.formalProjectToolchainFile).toEqual(
      NHM2_FORMAL_APPROVED_LEAN_TOOLCHAIN_FILE,
    );
    expect(result.authorityBasis.callerSuppliedReleaseLabelsUsed).toBe(false);
    expect(result.claimBoundary).toMatchObject({
      diagnosticToolchainAdmissionOnly: true,
      formalReplayExecutedByThisArtifact: false,
      theoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
    expect(policy.toolchainLedger.aggregateSha256).toBe(
      computeNhm2FormalKernelLedgerSha256({
        kind: "toolchain",
        entries: policy.toolchainLedger.entries,
      }),
    );
  });

  it("relocates the preseal root without changing approved toolchain identity", () => {
    const policy = makePolicy();
    for (const workspaceRoot of [
      path.resolve("nhm2-toolchain-fixture-b-one"),
      path.resolve("nhm2-toolchain-fixture-b-two"),
    ]) {
      expect(
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: makeRunSpec(policy, workspaceRoot),
          workspaceRoot,
        }).toolchainLedger.aggregateSha256,
      ).toBe(policy.toolchainLedger.aggregateSha256);
    }
  });

  it.each([
    ["lean release", "lean", "release", "4.32.0", "lean_release_not_approved"],
    [
      "lean commit",
      "lean",
      "commitSha",
      sha("d").slice(0, 40),
      "lean_commit_not_approved",
    ],
    ["lake release", "lake", "release", "5.1.0", "lake_release_not_approved"],
    [
      "lake Lean binding",
      "lake",
      "leanReleaseBinding",
      "4.32.0",
      "lake_lean_binding_not_approved",
    ],
  ])("rejects a mismatched %s", (_label, family, key, value, code) => {
    const policy = structuredClone(makePolicy()) as unknown as Record<
      string,
      unknown
    >;
    const releases = policy.releases as Record<string, Record<string, unknown>>;
    releases[family][key] = value;
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: makeRunSpec(makePolicy()),
          workspaceRoot: path.resolve("nhm2-toolchain-release-mismatch"),
        }),
      code,
    );
  });

  it("rejects a policy for a different host platform before trusting its ledger", () => {
    const policy = structuredClone(makePolicy());
    const differentTarget = NHM2_FORMAL_APPROVED_TOOLCHAIN_TARGETS.find(
      (candidate) => candidate.platform !== process.platform,
    )!;
    (policy as unknown as { target: typeof differentTarget }).target =
      differentTarget;
    policy.releases.lean.exactVersionOutput =
      exactLeanVersionOutput(differentTarget);
    resealPolicy(policy);
    const workspaceRoot = path.resolve("nhm2-toolchain-platform-mismatch");
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: makeRunSpec(policy, workspaceRoot),
          workspaceRoot,
        }),
      "approved_toolchain_platform_mismatch",
    );
  });

  it("rejects a host architecture mismatch independently of caller labels", () => {
    const policy = makePolicy();
    const workspaceRoot = path.resolve("nhm2-toolchain-architecture-mismatch");
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "arch");
    if (originalDescriptor == null || !originalDescriptor.configurable) {
      throw new Error("process.arch must be restorable for this focused test.");
    }
    Object.defineProperty(process, "arch", {
      ...originalDescriptor,
      value: process.arch === "x64" ? "arm64" : "x64",
    });
    try {
      expectCode(
        () =>
          verifyNhm2FormalApprovedToolchainPolicy({
            approvedPolicy: policy,
            formalRunSpec: makeRunSpec(policy, workspaceRoot),
            workspaceRoot,
          }),
        "approved_toolchain_architecture_mismatch",
      );
    } finally {
      Object.defineProperty(process, "arch", originalDescriptor);
    }
  });

  it("rejects missing, extra, changed, and reordered toolchain ledger entries", () => {
    const variants = ["missing", "extra", "changed", "reordered"] as const;
    for (const variant of variants) {
      const policy = makePolicy();
      const workspaceRoot = path.resolve(`nhm2-ledger-${variant}`);
      const spec = makeRunSpec(policy, workspaceRoot) as unknown as {
        executor: {
          ledgers: {
            toolchain: {
              entries: Array<{
                relativePath: string;
                sha256: string;
                sizeBytes: number;
              }>;
              ledgerSha256: string;
            };
          };
        };
      };
      const ledger = spec.executor.ledgers.toolchain;
      if (variant === "missing") ledger.entries.pop();
      if (variant === "extra") {
        ledger.entries.push({
          relativePath: "share/extra",
          sha256: sha("d"),
          sizeBytes: 1,
        });
      }
      if (variant === "changed") ledger.entries[0].sha256 = sha("d");
      if (variant === "reordered") ledger.entries.reverse();
      ledger.ledgerSha256 = computeLedgerSha256("toolchain", ledger.entries);
      expectCode(
        () =>
          verifyNhm2FormalApprovedToolchainPolicy({
            approvedPolicy: policy,
            formalRunSpec: spec,
            workspaceRoot,
          }),
        variant === "reordered"
          ? "formal_run_spec_ledger_path_alias"
          : "approved_toolchain_ledger_mismatch",
      );
    }
  });

  it("rejects a spoofed caller role label and executable aliases", () => {
    const policy = makePolicy();
    const workspaceRoot = path.resolve("nhm2-toolchain-role-spoof");
    const roleSpoof = makeRunSpec(policy, workspaceRoot) as unknown as {
      toolchainBindings: {
        entries: Array<{ toolchainRole: string }>;
      };
    };
    roleSpoof.toolchainBindings.entries.find(
      (entry) => entry.toolchainRole === "lean_executable",
    )!.toolchainRole = "runtime_dependency";
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: roleSpoof,
          workspaceRoot,
        }),
      "formal_toolchain_binding_mismatch",
    );

    const executableAlias = makeRunSpec(policy, workspaceRoot) as unknown as {
      executor: {
        executables: {
          lean: { absolutePath: string };
          lake: { absolutePath: string };
        };
      };
    };
    executableAlias.executor.executables.lake.absolutePath =
      executableAlias.executor.executables.lean.absolutePath;
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: executableAlias,
          workspaceRoot,
        }),
      "formal_toolchain_executable_alias",
    );
  });

  it("rejects the wrong formal lean-toolchain bytes and an environment expansion", () => {
    const policy = makePolicy();
    const workspaceRoot = path.resolve("nhm2-source-and-environment-mismatch");
    const sourceMismatch = makeRunSpec(policy, workspaceRoot) as unknown as {
      executor: {
        ledgers: {
          source: {
            entries: Array<{
              relativePath: string;
              sha256: string;
              sizeBytes: number;
            }>;
            ledgerSha256: string;
          };
        };
      };
    };
    sourceMismatch.executor.ledgers.source.entries[0].sha256 = sha("d");
    sourceMismatch.executor.ledgers.source.ledgerSha256 = computeLedgerSha256(
      "source",
      sourceMismatch.executor.ledgers.source.entries,
    );
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: sourceMismatch,
          workspaceRoot,
        }),
      "formal_lean_toolchain_file_mismatch",
    );

    const environmentMismatch = makeRunSpec(policy, workspaceRoot) as unknown as {
      executor: {
        environmentAllowlist: string[];
        environment: Record<string, string>;
      };
    };
    environmentMismatch.executor.environmentAllowlist.push("PATH");
    environmentMismatch.executor.environment.PATH = "caller-selected";
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: environmentMismatch,
          workspaceRoot,
        }),
      "formal_environment_not_approved",
    );
  });

  it("rejects policy semantic drift and a weakened claim boundary", () => {
    const policy = makePolicy();
    const workspaceRoot = path.resolve("nhm2-policy-semantic-drift");
    policy.policyId = `${policy.policyId}-changed`;
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: policy,
          formalRunSpec: makeRunSpec(makePolicy(), workspaceRoot),
          workspaceRoot,
        }),
      "approved_toolchain_policy_semantic_hash_mismatch",
    );

    const weakened = structuredClone(makePolicy()) as unknown as {
      claimBoundary: { physicalViabilityClaimAllowed: boolean };
    };
    weakened.claimBoundary.physicalViabilityClaimAllowed = true;
    expectCode(
      () =>
        verifyNhm2FormalApprovedToolchainPolicy({
          approvedPolicy: weakened,
          formalRunSpec: makeRunSpec(makePolicy(), workspaceRoot),
          workspaceRoot,
        }),
      "approved_toolchain_claim_boundary_invalid",
    );
  });
});
