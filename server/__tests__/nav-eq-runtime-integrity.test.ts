import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectNavEqRuntimeIntegrity } from "../../scripts/nav-eq-runtime-integrity";

const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

const files = {
  "CasimirBot.exe": Buffer.from("exe-fixture"),
  "app.asar": Buffer.from("asar-fixture"),
  "agent.jar": Buffer.from("fabric-fixture"),
  "runtime-manifest.json": Buffer.from(
    JSON.stringify({
      schemaVersion: "casimir_desktop_runtime_manifest/2",
      sourceCommit: "commit-fixture",
      serverSha256: "a".repeat(64),
    }),
  ),
};

const readFixture = (path: string): Buffer => {
  const key = Object.keys(files).find((name) => path.endsWith(name));
  if (!key) throw new Error("fixture missing");
  return files[key as keyof typeof files];
};

const protocol = () => ({
  runtime: {
    desktop_package: "fixture/CasimirBot.exe",
    desktop_executable_sha256: hash(files["CasimirBot.exe"]),
    desktop_app_asar: "fixture/app.asar",
    desktop_app_asar_sha256: hash(files["app.asar"]),
    fabric_jar: "fixture/agent.jar",
    fabric_jar_sha256: hash(files["agent.jar"]),
    runtime_manifest: "fixture/runtime-manifest.json",
    runtime_manifest_sha256: hash(files["runtime-manifest.json"]),
    runtime_manifest_schema: "casimir_desktop_runtime_manifest/2",
    runtime_manifest_source_commit: "commit-fixture",
    runtime_manifest_server_sha256: "a".repeat(64),
  },
});

describe("NAV-EQ runtime integrity", () => {
  it("verifies every declared artifact and manifest identity", () => {
    const result = inspectNavEqRuntimeIntegrity(protocol(), {
      workspaceRoot: "C:/workspace",
      readFile: readFixture,
    });

    expect(result.integrity_ok).toBe(true);
    expect(result.artifacts).toHaveLength(4);
    expect(result.artifacts.every((artifact) => artifact.hash_matches)).toBe(true);
    expect(result.manifest).toEqual({
      parsed: true,
      schema_matches: true,
      source_commit_matches: true,
      server_sha256_matches: true,
    });
  });

  it("fails closed on a changed artifact or manifest claim", () => {
    const changed = protocol();
    changed.runtime.desktop_executable_sha256 = "0".repeat(64);
    changed.runtime.runtime_manifest_server_sha256 = "b".repeat(64);

    const result = inspectNavEqRuntimeIntegrity(changed, {
      workspaceRoot: "C:/workspace",
      readFile: readFixture,
    });

    expect(result.integrity_ok).toBe(false);
    expect(result.violations).toContain("artifact_hash_mismatch:desktop_executable");
    expect(result.violations).toContain("runtime_manifest_server_sha256_mismatch");
  });
});
