import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readAskTurnActionArgString,
  readAskTurnMandatoryToolName,
  readAskTurnObjectRecord,
  readAskTurnRecordArray,
  readAskTurnString,
  readAskTurnStringList,
  readAskTurnWorkspaceSnapshotPath,
} from "../services/helix-ask/value-readers";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/value-readers.ts");

describe("Helix Ask value readers extraction boundary", () => {
  it("keeps the primitive string reader out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/value-readers");
    expect(routeSource).not.toMatch(/const\s+readAskTurnString\s*=\s*\(value/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnObjectRecord\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnStringList\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnRecordArray\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnMandatoryToolName\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnActionArgString\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnWorkspaceSnapshotPath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnString\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnObjectRecord\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnStringList\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnRecordArray\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnMandatoryToolName\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnActionArgString\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnWorkspaceSnapshotPath\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves string trim/null behavior", () => {
    expect(readAskTurnString(" value ")).toBe("value");
    expect(readAskTurnString("   ")).toBeNull();
    expect(readAskTurnString(42)).toBeNull();
    expect(readAskTurnString(null)).toBeNull();
    expect(readAskTurnObjectRecord({ a: 1 })).toEqual({ a: 1 });
    expect(readAskTurnObjectRecord(["a"])).toBeNull();
    expect(readAskTurnObjectRecord(null)).toBeNull();
    expect(readAskTurnStringList([" a ", "", 12, "b"])).toEqual(["a", "b"]);
    expect(readAskTurnStringList("a")).toEqual([]);
    expect(readAskTurnRecordArray([{ a: 1 }, ["b"], null, { c: 3 }])).toEqual([{ a: 1 }, { c: 3 }]);
    expect(readAskTurnRecordArray({ a: 1 })).toEqual([]);
    expect(readAskTurnMandatoryToolName({ tool_name: " scientific-calculator.solve_expression " })).toBe(
      "scientific-calculator.solve_expression",
    );
    expect(readAskTurnMandatoryToolName({ tool_name: " ", toolName: "docs-viewer.locate_in_doc" })).toBe(
      "docs-viewer.locate_in_doc",
    );
    expect(readAskTurnMandatoryToolName({ selected_capability: "repo-code.search_concept" })).toBe("repo-code.search_concept");
    expect(readAskTurnMandatoryToolName({ requiredCapability: "workspace_os.status" })).toBe("workspace_os.status");
    expect(readAskTurnMandatoryToolName(["scientific-calculator.solve_expression"])).toBeNull();
    expect(readAskTurnMandatoryToolName({ tool_name: " " })).toBeNull();
    expect(readAskTurnActionArgString({ args: { title: " My Note ", name: "Fallback" } }, ["title", "name"])).toBe("My Note");
    expect(readAskTurnActionArgString({ args: { title: " ", name: "Fallback" } }, ["title", "name"])).toBe("Fallback");
    expect(readAskTurnActionArgString({ args: null }, ["title"])).toBeNull();
    expect(readAskTurnWorkspaceSnapshotPath({ workspace_context_snapshot: { activeDocPath: " docs/a.md " } })).toBe("docs/a.md");
    expect(readAskTurnWorkspaceSnapshotPath({ workspace_context_snapshot: { activeDocPath: " " } })).toBeNull();
    expect(readAskTurnWorkspaceSnapshotPath({})).toBeNull();
  });
});
