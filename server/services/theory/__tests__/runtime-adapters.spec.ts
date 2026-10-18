import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTheoryRuntimeReceiptV1 } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  buildTheoryRuntimeCommand,
  executeTheoryRuntimeCommand,
  runSmallRuntimeAdaptersForCompoundRun,
  runTheoryRuntimeAdapter,
  type TheoryRuntimeExecutionResult,
} from "../runtime-adapters";
import { buildNhm2TheoryBadgeGraphV1 } from "../../../../shared/theory/nhm2-theory-badges";
import { buildTheoryCompoundRun } from "../../../../shared/theory/theory-compound-run-builder";

let tempRoot: string;

async function writeFixture(relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(tempRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
}

const successfulExecution: TheoryRuntimeExecutionResult = {
  startedAt: "2026-05-29T00:00:00.000Z",
  completedAt: "2026-05-29T00:00:01.000Z",
  durationMs: 1000,
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  timedOut: false,
  error: null,
};

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "theory-runtime-adapter-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("small theory runtime adapters", () => {
  it("builds fixed npm script commands from registered entrypoints", () => {
    const command = buildTheoryRuntimeCommand({
      runtimeId: "solar.pipeline",
      graphId: "test.graph",
      badgeIds: ["solar.runtime.spectrum_analysis"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    if (process.platform === "win32") {
      if (command.command === process.execPath) {
        expect(command.args[0]?.toLowerCase()).toMatch(/(?:^|[\\/])npm-cli\.js$/);
        expect(command.args.slice(1)).toEqual(["run", "-s", "solar:pipeline"]);
      } else {
        expect(command.command.toLowerCase()).toMatch(/(?:^|[\\/])cmd\.exe$/);
        expect(command.args).toEqual(["/d", "/s", "/c", "npm.cmd", "run", "-s", "solar:pipeline"]);
      }
    } else {
      expect(command.command).toBe("npm");
      expect(command.args).toEqual(["run", "-s", "solar:pipeline"]);
    }
    expect(command.npmScript).toBe("solar:pipeline");
    expect(command.cwd).toBe(path.resolve(tempRoot));
  });

  it("rejects commands outside the small runtime allowlist", () => {
    expect(() =>
      buildTheoryRuntimeCommand({
        runtimeId: "warp.full_solve.campaign",
        graphId: "test.graph",
        badgeIds: ["nhm2.closure.source_residual"],
        projectRoot: tempRoot,
      }),
    ).toThrow(/not enabled for small adapter execution/i);
  });

  it("returns a completed receipt after a mocked successful adapter run and evidence parse", async () => {
    await writeFixture("docs/knowledge/physics/solar-test.json", JSON.stringify({
      gates: {
        calibration_context: "pass",
      },
    }));

    const receipt = await runTheoryRuntimeAdapter(
      {
        runtimeId: "solar.manifest",
        graphId: "test.graph",
        badgeIds: ["solar.runtime.spectrum_analysis"],
        projectRoot: tempRoot,
        generatedAt: "2026-05-29T00:00:00.000Z",
      },
      {
        spawnExecutor: async () => successfulExecution,
      },
    );

    expect(receipt.status).toBe("completed");
    expect(receipt.outputs.artifacts).toContain("docs/knowledge/physics/solar-test.json");
    expect(receipt.outputs.gates.calibration_context).toBe("pass");
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
  });

  it.runIf(process.platform === "win32")(
    "executes the registered Windows npm launcher without spawn EINVAL",
    async () => {
      const receipt = await runTheoryRuntimeAdapter({
        runtimeId: "solar.manifest",
        graphId: "test.graph",
        badgeIds: ["solar.runtime.spectrum_analysis"],
        projectRoot: path.resolve("."),
      });

      expect(receipt.outputs.warnings.join(" ")).not.toMatch(/spawn EINVAL/i);
      expect(receipt.provenance.startedAt).toBeTruthy();
      expect(receipt.provenance.completedAt).toBeTruthy();
      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
    },
    20_000,
  );

  it.runIf(process.platform === "win32")(
    "terminates the full Windows runtime process tree before returning a timeout",
    async () => {
      const descendantPidPath = path.join(tempRoot, "descendant.pid");
      const parentScript = [
        'const { spawn } = require("node:child_process")',
        'const fs = require("node:fs")',
        'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true })',
        `fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(child.pid))`,
        'setInterval(() => {}, 1000)',
      ].join(";");

      const execution = await executeTheoryRuntimeCommand({
        command: process.execPath,
        args: ["-e", parentScript],
        cwd: tempRoot,
        npmScript: "test:runtime-process-tree",
        timeoutMs: 300,
      });
      const descendantPid = Number(await fs.readFile(descendantPidPath, "utf8"));
      const processExists = (pid: number): boolean => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      expect(execution.timedOut).toBe(true);
      expect(processExists(descendantPid)).toBe(false);
    },
    10_000,
  );

  it("returns a timeout receipt when the adapter execution times out", async () => {
    const receipt = await runTheoryRuntimeAdapter(
      {
        runtimeId: "casimir.verify",
        graphId: "test.graph",
        badgeIds: ["casimir.runtime.static_casimir_module"],
        projectRoot: tempRoot,
        generatedAt: "2026-05-29T00:00:00.000Z",
      },
      {
        spawnExecutor: async () => ({
          ...successfulExecution,
          completedAt: "2026-05-29T00:00:03.000Z",
          durationMs: 3000,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: true,
          error: "timeout",
        }),
      },
    );

    expect(receipt.status).toBe("timeout");
    expect(receipt.outputs.warnings.join(" ")).toMatch(/timeout/i);
    expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
  });

  it("returns a failed receipt when artifact parsing fails", async () => {
    await writeFixture("artifacts/physics-validation-bad.json", "{bad json");

    const receipt = await runTheoryRuntimeAdapter(
      {
        runtimeId: "physics.validate",
        graphId: "test.graph",
        badgeIds: ["physics.units.dimension_consistency"],
        projectRoot: tempRoot,
        generatedAt: "2026-05-29T00:00:00.000Z",
      },
      {
        spawnExecutor: async () => successfulExecution,
      },
    );

    expect(receipt.status).toBe("failed");
    expect(receipt.outputs.warnings.join(" ")).toMatch(/JSON parse failed/i);
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
  });

  it("attaches small runtime receipts to matching compound run rows only when runtime scope is explicit", async () => {
    await writeFixture("docs/knowledge/physics/solar-test.json", JSON.stringify({
      gates: {
        manifest_available: "pass",
      },
    }));
    const graph = buildNhm2TheoryBadgeGraphV1();
    const run = buildTheoryCompoundRun({
      graph,
      badgeIds: ["solar.runtime.spectrum_analysis"],
      mode: "selected_badges",
      generatedAt: "2026-05-29T00:00:00.000Z",
    });
    const scalarOnly = await runSmallRuntimeAdaptersForCompoundRun(
      {
        run,
        scope: "scalar_only",
        projectRoot: tempRoot,
        generatedAt: "2026-05-29T00:00:00.000Z",
      },
      {
        spawnExecutor: async () => successfulExecution,
      },
    );
    expect(scalarOnly.rows.some((row) => row.runtimeReceiptV1)).toBe(false);

    const withRuntime = await runSmallRuntimeAdaptersForCompoundRun(
      {
        run,
        scope: "all_available",
        projectRoot: tempRoot,
        generatedAt: "2026-05-29T00:00:00.000Z",
      },
      {
        spawnExecutor: async () => successfulExecution,
      },
    );

    expect(withRuntime.rows.some((row) => row.runtimeReceiptV1?.runtimeId.startsWith("solar."))).toBe(true);
    expect(withRuntime.rows.every((row) => row.runtimeReceiptV1?.claimBoundary.promotionAllowed !== true)).toBe(true);
  });
});
