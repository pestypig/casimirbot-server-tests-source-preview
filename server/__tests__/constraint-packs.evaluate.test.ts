import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";
import fs from "node:fs/promises";

type ConstraintPackRouterModule = typeof import("../routes/agi.constraint-packs");
type TrainingTraceStoreModule = typeof import("../services/observability/training-trace-store");
type ConstraintPackPolicyStoreModule = typeof import("../services/constraint-packs/constraint-pack-policy-store");
type ToolLogStoreModule = typeof import("../services/observability/tool-log-store");

let app: express.Express;
let resetStore: (() => void) | undefined;
let resetPolicyStore: (() => void) | undefined;
let resetToolLogStore: (() => void) | undefined;
let toolLogStore: ToolLogStoreModule | undefined;

const loadModules = async (): Promise<{
  routes: ConstraintPackRouterModule;
  store: TrainingTraceStoreModule;
  policyStore: ConstraintPackPolicyStoreModule;
  toolLogStore: ToolLogStoreModule;
}> => {
  process.env.TRAINING_TRACE_PERSIST = "0";
  process.env.CASIMIR_AUTO_TELEMETRY = "0";
  process.env.TRAINING_TRACE_AUDIT_PATH = path.resolve(
    process.cwd(),
    ".cal",
    `constraint-pack-test-${process.pid}.jsonl`,
  );
  process.env.CONSTRAINT_PACK_POLICY_PERSIST = "0";
  process.env.CONSTRAINT_PACK_POLICY_AUDIT_PATH = path.resolve(
    process.cwd(),
    ".cal",
    `constraint-pack-policy-test-${process.pid}.jsonl`,
  );
  await vi.resetModules();
  const routes = await import("../routes/agi.constraint-packs");
  const store = await import("../services/observability/training-trace-store");
  const policyStore = await import("../services/constraint-packs/constraint-pack-policy-store");
  const toolLogStore = await import("../services/observability/tool-log-store");
  return { routes, store, policyStore, toolLogStore };
};

beforeAll(async () => {
  const { routes, store, policyStore, toolLogStore: loadedToolLogStore } =
    await loadModules();
  resetStore = store.__resetTrainingTraceStore;
  resetPolicyStore = policyStore.__resetConstraintPackPolicyStore;
  resetToolLogStore = loadedToolLogStore.__resetToolLogStore;
  toolLogStore = loadedToolLogStore;
  app = express();
  app.use(express.json());
  app.use("/api/agi", routes.constraintPacksRouter);
});

beforeEach(() => {
  resetStore?.();
  resetPolicyStore?.();
  resetToolLogStore?.();
});

describe("constraint pack evaluation", () => {
  it("evaluates repo convergence telemetry", async () => {
    const response = await request(app)
      .post("/api/agi/constraint-packs/repo-convergence/evaluate")
      .send({
        traceId: "ci:run-1",
        telemetry: {
          build: { status: "pass", durationMs: 420000 },
          tests: { failed: 0, total: 128 },
          schema: { contracts: true },
          deps: { coherence: true },
          timeToGreenMs: 480000,
          lint: { status: true },
          typecheck: { status: true },
        },
      })
      .expect(200);

    expect(response.body?.evaluation?.pass).toBe(true);
    expect(response.body?.trace?.signal?.kind).toBe("repo-certified");
    expect(response.body?.trace?.signal?.ladder?.tier).toBe("certified");
  });

  it("auto-ingests repo telemetry from env when enabled", async () => {
    const envBackup = { ...process.env };
    process.env.CASIMIR_AUTO_TELEMETRY = "1";
    process.env.CASIMIR_BUILD_STATUS = "pass";
    process.env.CASIMIR_TEST_FAILED = "0";
    process.env.CASIMIR_TEST_TOTAL = "5";
    process.env.CASIMIR_SCHEMA_CONTRACTS = "true";
    process.env.CASIMIR_DEPS_COHERENCE = "true";
    try {
      const response = await request(app)
        .post("/api/agi/constraint-packs/repo-convergence/evaluate")
        .send({ traceId: "ci:auto-1" })
        .expect(200);

      expect(response.body?.evaluation?.pass).toBe(true);
      expect(response.body?.evaluation?.notes).toEqual(
        expect.arrayContaining(["telemetry_source=env"]),
      );
    } finally {
      process.env.CASIMIR_AUTO_TELEMETRY =
        envBackup.CASIMIR_AUTO_TELEMETRY;
      process.env.CASIMIR_BUILD_STATUS = envBackup.CASIMIR_BUILD_STATUS;
      process.env.CASIMIR_TEST_FAILED = envBackup.CASIMIR_TEST_FAILED;
      process.env.CASIMIR_TEST_TOTAL = envBackup.CASIMIR_TEST_TOTAL;
      process.env.CASIMIR_SCHEMA_CONTRACTS =
        envBackup.CASIMIR_SCHEMA_CONTRACTS;
      process.env.CASIMIR_DEPS_COHERENCE = envBackup.CASIMIR_DEPS_COHERENCE;
      if (envBackup.CASIMIR_AUTO_TELEMETRY === undefined) {
        delete process.env.CASIMIR_AUTO_TELEMETRY;
      }
      if (envBackup.CASIMIR_BUILD_STATUS === undefined) {
        delete process.env.CASIMIR_BUILD_STATUS;
      }
      if (envBackup.CASIMIR_TEST_FAILED === undefined) {
        delete process.env.CASIMIR_TEST_FAILED;
      }
      if (envBackup.CASIMIR_TEST_TOTAL === undefined) {
        delete process.env.CASIMIR_TEST_TOTAL;
      }
      if (envBackup.CASIMIR_SCHEMA_CONTRACTS === undefined) {
        delete process.env.CASIMIR_SCHEMA_CONTRACTS;
      }
      if (envBackup.CASIMIR_DEPS_COHERENCE === undefined) {
        delete process.env.CASIMIR_DEPS_COHERENCE;
      }
    }
  });

  it("auto-ingests repo telemetry from vitest/eslint/tsc reports", async () => {
    const envBackup = { ...process.env };
    process.env.CASIMIR_BUILD_STATUS = "pass";
    process.env.CASIMIR_SCHEMA_CONTRACTS = "true";
    process.env.CASIMIR_DEPS_COHERENCE = "true";
    try {
      const baseDir = path.join(process.cwd(), ".cal");
      await fs.mkdir(baseDir, { recursive: true });
      const tmpDir = await fs.mkdtemp(path.join(baseDir, "telemetry-"));
      const vitestPath = path.join(tmpDir, "vitest.json");
      const eslintPath = path.join(tmpDir, "eslint.json");
      const tscPath = path.join(tmpDir, "tsc.txt");
      await fs.writeFile(
        vitestPath,
        JSON.stringify({
          success: true,
          numTotalTests: 3,
          numPassedTests: 3,
          numFailedTests: 0,
        }),
        "utf8",
      );
      await fs.writeFile(
        eslintPath,
        JSON.stringify([{ errorCount: 0, fatalErrorCount: 0, warningCount: 1 }]),
        "utf8",
      );
      await fs.writeFile(tscPath, "Found 0 errors.\n", "utf8");

      const relativeVitest = path.relative(process.cwd(), vitestPath);
      const relativeEslint = path.relative(process.cwd(), eslintPath);
      const relativeTsc = path.relative(process.cwd(), tscPath);

      const response = await request(app)
        .post("/api/agi/constraint-packs/repo-convergence/evaluate")
        .send({
          traceId: "ci:auto-vt",
          autoTelemetry: true,
          vitestPath: relativeVitest,
          eslintPath: relativeEslint,
          tscPath: relativeTsc,
        })
        .expect(200);

      expect(response.body?.evaluation?.pass).toBe(true);
      expect(response.body?.evaluation?.notes).toEqual(
        expect.arrayContaining([
          `telemetry_source=vitest:${relativeVitest}`,
          `telemetry_source=eslint:${relativeEslint}`,
          `telemetry_source=tsc:${relativeTsc}`,
          "telemetry_source=env",
        ]),
      );
    } finally {
      process.env.CASIMIR_BUILD_STATUS = envBackup.CASIMIR_BUILD_STATUS;
      process.env.CASIMIR_SCHEMA_CONTRACTS = envBackup.CASIMIR_SCHEMA_CONTRACTS;
      process.env.CASIMIR_DEPS_COHERENCE = envBackup.CASIMIR_DEPS_COHERENCE;
      if (envBackup.CASIMIR_BUILD_STATUS === undefined) {
        delete process.env.CASIMIR_BUILD_STATUS;
      }
      if (envBackup.CASIMIR_SCHEMA_CONTRACTS === undefined) {
        delete process.env.CASIMIR_SCHEMA_CONTRACTS;
      }
      if (envBackup.CASIMIR_DEPS_COHERENCE === undefined) {
        delete process.env.CASIMIR_DEPS_COHERENCE;
      }
    }
  });

  it("auto-ingests repo telemetry from reports directory scan", async () => {
    const envBackup = { ...process.env };
    const reportDir = path.resolve(
      process.cwd(),
      "reports",
      `ci-auto-${process.pid}-${Date.now()}`,
    );
    process.env.CASIMIR_AUTO_TELEMETRY = "1";
    process.env.CASIMIR_AUTO_CI_REPORTS = "1";
    process.env.CASIMIR_BUILD_STATUS = "pass";
    process.env.CASIMIR_SCHEMA_CONTRACTS = "true";
    process.env.CASIMIR_DEPS_COHERENCE = "true";
    try {
      await fs.mkdir(reportDir, { recursive: true });
      await fs.writeFile(
        path.join(reportDir, "junit-results.xml"),
        '<testsuite tests="4" failures="0" errors="0" skipped="0" time="1" />',
        "utf8",
      );
      await fs.writeFile(
        path.join(reportDir, "vitest-results.json"),
        JSON.stringify({ numTotalTests: 4, numFailedTests: 0 }),
        "utf8",
      );
      await fs.writeFile(
        path.join(reportDir, "eslint-results.json"),
        JSON.stringify([{ errorCount: 0, fatalErrorCount: 0, warningCount: 1 }]),
        "utf8",
      );
      await fs.writeFile(
        path.join(reportDir, "tsc-output.log"),
        "Found 0 errors.",
        "utf8",
      );

      const response = await request(app)
        .post("/api/agi/constraint-packs/repo-convergence/evaluate")
        .send({ traceId: "ci:auto-reports", autoTelemetry: true })
        .expect(200);

      expect(response.body?.evaluation?.pass).toBe(true);
      expect(response.body?.evaluation?.notes).toEqual(
        expect.arrayContaining([
          expect.stringContaining("auto-reports:junit"),
          expect.stringContaining("auto-reports:vitest"),
          expect.stringContaining("auto-reports:eslint"),
          expect.stringContaining("auto-reports:tsc"),
        ]),
      );
    } finally {
      await fs.rm(reportDir, { recursive: true, force: true });
      process.env.CASIMIR_AUTO_TELEMETRY =
        envBackup.CASIMIR_AUTO_TELEMETRY;
      process.env.CASIMIR_AUTO_CI_REPORTS =
        envBackup.CASIMIR_AUTO_CI_REPORTS;
      process.env.CASIMIR_BUILD_STATUS = envBackup.CASIMIR_BUILD_STATUS;
      process.env.CASIMIR_SCHEMA_CONTRACTS =
        envBackup.CASIMIR_SCHEMA_CONTRACTS;
      process.env.CASIMIR_DEPS_COHERENCE = envBackup.CASIMIR_DEPS_COHERENCE;
      if (envBackup.CASIMIR_AUTO_TELEMETRY === undefined) {
        delete process.env.CASIMIR_AUTO_TELEMETRY;
      }
      if (envBackup.CASIMIR_AUTO_CI_REPORTS === undefined) {
        delete process.env.CASIMIR_AUTO_CI_REPORTS;
      }
      if (envBackup.CASIMIR_BUILD_STATUS === undefined) {
        delete process.env.CASIMIR_BUILD_STATUS;
      }
      if (envBackup.CASIMIR_SCHEMA_CONTRACTS === undefined) {
        delete process.env.CASIMIR_SCHEMA_CONTRACTS;
      }
      if (envBackup.CASIMIR_DEPS_COHERENCE === undefined) {
        delete process.env.CASIMIR_DEPS_COHERENCE;
      }
    }
  });

  it("auto-ingests tool-use telemetry from tool logs", async () => {
    const envBackup = { ...process.env };
    process.env.CASIMIR_COST_USD = "1.2";
    try {
      if (!toolLogStore) {
        throw new Error("tool log store not loaded");
      }
      toolLogStore.appendToolLog({
        tool: "mock-tool",
        paramsHash: "p1",
        durationMs: 120,
        ok: true,
        traceId: "trace-tool-1",
        stepId: "step-1",
      });
      toolLogStore.appendToolLog({
        tool: "mock-tool",
        paramsHash: "p2",
        durationMs: 80,
        ok: true,
        traceId: "trace-tool-1",
        stepId: "step-2",
      });

      const response = await request(app)
        .post("/api/agi/constraint-packs/tool-use-budget/evaluate")
        .send({
          traceId: "agent:auto-tool",
          autoTelemetry: true,
          toolLogTraceId: "trace-tool-1",
        })
        .expect(200);

      expect(response.body?.evaluation?.pass).toBe(true);
      expect(response.body?.evaluation?.notes).toEqual(
        expect.arrayContaining(["telemetry_source=tool-log", "telemetry_source=env"]),
      );
    } finally {
      process.env.CASIMIR_COST_USD = envBackup.CASIMIR_COST_USD;
      if (envBackup.CASIMIR_COST_USD === undefined) {
        delete process.env.CASIMIR_COST_USD;
      }
    }
  });

  it("flags tool-use policy violations from tool logs", async () => {
    const envBackup = { ...process.env };
    process.env.CASIMIR_COST_USD = "1.2";
    try {
      if (!toolLogStore) {
        throw new Error("tool log store not loaded");
      }
      toolLogStore.appendToolLog({
        tool: "mock-tool",
        paramsHash: "p3",
        durationMs: 60,
        ok: false,
        traceId: "trace-tool-2",
        stepId: "step-1",
        policy: { approvalMissing: true },
      });

      const response = await request(app)
        .post("/api/agi/constraint-packs/tool-use-budget/evaluate")
        .send({
          traceId: "agent:auto-tool-violations",
          autoTelemetry: true,
          toolLogTraceId: "trace-tool-2",
        })
        .expect(200);

      expect(response.body?.evaluation?.pass).toBe(false);
      expect(response.body?.evaluation?.firstFail?.id).toBe(
        "approval_required_missing",
      );
    } finally {
      process.env.CASIMIR_COST_USD = envBackup.CASIMIR_COST_USD;
      if (envBackup.CASIMIR_COST_USD === undefined) {
        delete process.env.CASIMIR_COST_USD;
      }
    }
  });

  it("flags tool-use budget violations", async () => {
    const response = await request(app)
      .post("/api/agi/constraint-packs/tool-use-budget/evaluate")
      .send({
        telemetry: {
          steps: { used: 50 },
          cost: { usd: 1.6 },
          ops: { forbidden: 0, approvalMissing: 0 },
          provenance: { missing: 0 },
          runtime: { ms: 42000 },
          tools: { calls: 6 },
        },
      })
      .expect(200);

    expect(response.body?.evaluation?.pass).toBe(false);
    expect(response.body?.evaluation?.firstFail?.id).toBe("step_limit");
    expect(response.body?.trace?.signal?.kind).toBe("tool-budget-diagnostic");
  });

  it("evaluates provenance safety telemetry", async () => {
    const response = await request(app)
      .post("/api/agi/constraint-packs/provenance-safety/evaluate")
      .send({
        telemetry: {
          audit: {
            files: { total: 12, tagged: 12, untagged: 0 },
            tags: { unknown: 0 },
            violations: { count: 0 },
            risk: { files: 2 },
            provenance: { files: 1, coverage: 1 },
            safety: { files: 1, coverage: 1 },
            critical: { files: 2 },
          },
        },
      })
      .expect(200);

    expect(response.body?.evaluation?.pass).toBe(true);
    expect(response.body?.trace?.signal?.kind).toBe("audit-certified");
    expect(response.body?.trace?.metrics?.["audit.files.total"]).toBe(12);
    expect(response.body?.trace?.metrics?.["audit.provenance.coverage"]).toBe(1);
  });

  it("flags missing provenance coverage in audit safety pack", async () => {
    const response = await request(app)
      .post("/api/agi/constraint-packs/provenance-safety/evaluate")
      .send({
        telemetry: {
          audit: {
            files: { total: 4, tagged: 4, untagged: 0 },
            tags: { unknown: 0 },
            violations: { count: 0 },
            risk: { files: 1 },
            provenance: { files: 0, coverage: 0 },
            safety: { files: 1, coverage: 1 },
          },
        },
      })
      .expect(200);

    expect(response.body?.evaluation?.pass).toBe(false);
    expect(response.body?.evaluation?.firstFail?.id).toBe("provenance_coverage");
  });

  it("applies policy profile overrides", async () => {
    const created = await request(app)
      .post("/api/agi/constraint-packs/policies")
      .send({
        customerId: "acme",
        name: "tight-budgets",
        packs: [
          {
            packId: "tool-use-budget",
            constraints: [{ id: "step_limit", max: 8 }],
          },
        ],
      })
      .expect(200);

    const profileId = created.body?.profile?.id;
    expect(profileId).toBeTruthy();

    const response = await request(app)
      .post("/api/agi/constraint-packs/tool-use-budget/evaluate")
      .send({
        policyProfileId: profileId,
        customerId: "acme",
        telemetry: {
          steps: { used: 10 },
          cost: { usd: 1.6 },
          ops: { forbidden: 0, approvalMissing: 0 },
          provenance: { missing: 0 },
          runtime: { ms: 42000 },
          tools: { calls: 6 },
        },
      })
      .expect(200);

    expect(response.body?.policyProfile?.id).toBe(profileId);
    expect(response.body?.evaluation?.firstFail?.id).toBe("step_limit");
  });

  it("enforces minimum ladder tier", async () => {
    const response = await request(app)
      .post("/api/agi/constraint-packs/repo-convergence/evaluate")
      .send({
        telemetry: {
          build: { status: "pass", durationMs: 420000 },
          tests: { failed: 0, total: 128 },
          schema: { contracts: true },
          deps: { coherence: true },
          timeToGreenMs: 480000,
          lint: { status: true },
          typecheck: { status: true },
        },
        proxy: true,
        policyOverride: {
          policy: { minLadderTier: "certified" },
        },
      })
      .expect(200);

    expect(response.body?.evaluation?.pass).toBe(false);
    expect(response.body?.evaluation?.ladderTier).toBe("reduced-order");
    expect(response.body?.evaluation?.notes).toEqual(
      expect.arrayContaining([
        "ladder_min_tier=certified",
        "ladder_actual=reduced-order",
      ]),
    );
    expect(response.body?.trace?.signal?.ladder?.tier).toBe("reduced-order");
  });
});
