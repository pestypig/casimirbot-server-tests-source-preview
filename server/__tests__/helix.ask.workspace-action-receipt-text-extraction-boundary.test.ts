import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAskTurnWorkspaceActionReceiptText,
  buildAskTurnWorkspaceFailureReceiptText,
} from "../services/helix-ask/workspace-action-receipt-text";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/workspace-action-receipt-text.ts");

describe("Helix Ask workspace action receipt text extraction boundary", () => {
  it("keeps workspace receipt text helpers outside agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/workspace-action-receipt-text");
    expect(routeSource).not.toMatch(/const\s+buildAskTurnWorkspaceActionReceiptText\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnWorkspaceFailureReceiptText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnWorkspaceActionReceiptText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnWorkspaceFailureReceiptText\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves workspace action receipt text behavior", () => {
    expect(buildAskTurnWorkspaceActionReceiptText(null)).toBe("Executed workspace action.");
    expect(buildAskTurnWorkspaceActionReceiptText({ panel_id: "docs-viewer", action_id: "open_doc" })).toBe(
      "Executed docs-viewer.open_doc.",
    );
    expect(buildAskTurnWorkspaceFailureReceiptText({ action: null, reason: "blocked" })).toBe(
      "Workspace action failed (blocked).",
    );
    expect(
      buildAskTurnWorkspaceFailureReceiptText({
        action: { panel_id: "scientific-calculator", action_id: "solve_expression" },
        reason: "runtime_error",
      }),
    ).toBe("Failed to execute scientific-calculator.solve_expression (runtime_error).");
    expect(buildAskTurnWorkspaceFailureReceiptText({ action: null, reason: " " })).toBe(
      "Workspace action failed (workspace_step_failed).",
    );
  });
});
