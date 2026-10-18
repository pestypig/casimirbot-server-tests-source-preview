import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { splitHelixCapabilityKey } from "../services/helix-ask/tool-router/capability-key";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/tool-router/capability-key.ts");

describe("Helix Ask capability-key extraction boundary", () => {
  it("keeps capability-key splitting out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/tool-router/capability-key");
    expect(routeSource).not.toMatch(/const\s+splitHelixCapabilityKey\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+splitHelixCapabilityKey\s*=/);
    expect(serviceSource).toContain("capabilityKey.indexOf(\".\")");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves panel/action split behavior", () => {
    expect(splitHelixCapabilityKey("docs-viewer.locate_in_doc")).toEqual({
      panelId: "docs-viewer",
      actionId: "locate_in_doc",
    });
    expect(splitHelixCapabilityKey("workspace_os")).toEqual({
      panelId: "workspace_os",
      actionId: "",
    });
    expect(splitHelixCapabilityKey("a.b.c")).toEqual({
      panelId: "a",
      actionId: "b.c",
    });
  });
});
