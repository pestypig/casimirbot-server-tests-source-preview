import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

it("preserves temporal unknown-outcome state across separate process lifetimes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-et6-process-"));
  const snapshot = path.join(directory, "snapshot.json");
  try {
    for (const phase of ["write", "replace", "verify"]) {
      execFileSync(process.execPath, [path.resolve("node_modules/vitest/vitest.mjs"), "run",
        "server/db/__tests__/temporal-process-phase.test.ts", "--pool=forks", "--maxWorkers=1", "--minWorkers=1"], {
        cwd: process.cwd(), timeout: 40000, windowsHide: true, stdio: "pipe",
        env: { ...process.env, ET6_PERSIST_PROCESS_DIR: directory, ET6_PERSIST_PROCESS_PHASE: phase },
      });
    }
    const saved = JSON.parse(readFileSync(snapshot, "utf8"));
    expect(saved.tables.helix_environment_action_requests[0].status).toBe("connector_offline");
  } finally {
    // Exact owned file and empty directory only, never recursive removal.
    try { unlinkSync(snapshot); } catch {}
    rmdirSync(directory);
  }
}, 125000);
