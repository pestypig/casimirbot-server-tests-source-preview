import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mergeHelixAskQueries } from "../services/helix-ask/query";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/query.ts");

describe("Helix Ask query merge extraction boundary", () => {
  it("keeps query merging out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("mergeHelixAskQueries");
    expect(routeSource).toContain("../services/helix-ask/query");
    expect(routeSource).not.toMatch(/function\s+mergeHelixAskQueries\s*\(/);
    expect(serviceSource).toMatch(/export\s+function\s+mergeHelixAskQueries\s*\(/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves query trimming, case-insensitive dedupe, group filtering, and limits", () => {
    expect(
      mergeHelixAskQueries(
        [" Alpha ", "beta", "ALPHA", ""],
        null,
        undefined,
        [" gamma ", "Beta", "delta"],
        3,
      ),
    ).toEqual(["Alpha", "beta", "gamma"]);

    expect(mergeHelixAskQueries([" one ", "two"], ["TWO", "three"], 10)).toEqual([
      "one",
      "two",
      "three",
    ]);

    expect(mergeHelixAskQueries(["one", "two"], 0)).toEqual(["one"]);
  });
});
