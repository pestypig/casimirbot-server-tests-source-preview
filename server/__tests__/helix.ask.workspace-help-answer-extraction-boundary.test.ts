import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAskTurnWorkspaceHelpAnswer } from "../services/helix-ask/workspace-help-answer";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/workspace-help-answer.ts");

describe("Helix Ask workspace help answer extraction boundary", () => {
  it("keeps workspace help answer text out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/workspace-help-answer");
    expect(routeSource).not.toMatch(/const\s+buildAskTurnWorkspaceHelpAnswer\s*=\s*\(\)\s*:\s*string\s*=>/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnWorkspaceHelpAnswer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves deterministic workspace help text", () => {
    expect(buildAskTurnWorkspaceHelpAnswer()).toBe(
      [
        "I can help you work across the Helix workspace:",
        "- Open or find the latest docs and papers by topic.",
        "- Locate source paths, line spans, snippets, tables, fields, and named anchors inside docs.",
        "- Summarize the current document and explain what specific sections mean.",
        "- Create or update workstation notes with summaries, source paths, and located evidence.",
        "- Compare docs against notes and call out what is captured, missing, or unsupported.",
        "- Answer background-only questions without using workspace lookup when you ask for that scope.",
        "- Ask for clarification when a document, note, or target is ambiguous.",
      ].join("\n"),
    );
  });
});
