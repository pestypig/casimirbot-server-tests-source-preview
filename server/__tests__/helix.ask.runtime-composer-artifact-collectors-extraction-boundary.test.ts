import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-composer-artifact-collectors.ts");

describe("Helix Ask runtime composer artifact collectors extraction boundary", () => {
  it("keeps runtime composer artifact collectors out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-composer-artifact-collectors");
    expect(routeSource).toContain("createHelixRuntimeComposerArtifactCollectors({");
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerReceipts\s*=\s*\(artifacts/);
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerCoverageArtifacts\s*=\s*\(artifacts/);
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerToolObservations\s*=\s*\(artifacts/);
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerTextLines\s*=\s*\(value/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixRuntimeComposerArtifactCollectors\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
