import { expect, it } from "vitest";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { canonicalEnvironmentTimeValue, helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";

it("preserves Node hashes and validates temporal values without Node globals", async () => {
  const result = await build({ entryPoints: ["shared/helix-environment-time.ts"], bundle: true,
    platform: "browser", format: "iife", globalName: "Temporal", write: false, logLevel: "silent" });
  const browser: Record<string, any> = { TextEncoder };
  runInNewContext(result.outputFiles[0].text, browser);
  for (const value of [{ a: 1, A: 2, _x: 3, z: 4 }, { unicode: "🌍é", empty: null },
    [0, -0, 1e-7, 1e21, true, false], { nested: { long: "x".repeat(10000) } }]) {
    const expected = `sha256:${createHash("sha256").update(JSON.stringify(canonicalEnvironmentTimeValue(value)), "utf8").digest("hex")}`;
    expect(helixEnvironmentTimeSha256(value)).toBe(expected);
    expect(browser.Temporal.helixEnvironmentTimeSha256(value)).toBe(expected);
  }
  expect(browser.Temporal.helixEnvironmentPlanConditionSchema.safeParse({ kind: "adapter_condition",
    condition_id: "minecraft.test", arguments: { label: "🌍" } }).success).toBe(true);
  expect(browser.Buffer).toBeUndefined();
  expect(browser.process).toBeUndefined();
});

it("bundles the action schema for the EXE renderer", async () => {
  await expect(build({ entryPoints: ["shared/helix-environment-action.ts"], bundle: true,
    platform: "browser", write: false, logLevel: "silent" })).resolves.toHaveProperty("outputFiles");
});
