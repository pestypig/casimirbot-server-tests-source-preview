import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  askTurnArtifactHasEvidenceSnippets,
  askTurnArtifactHasNonemptyText,
  askTurnArtifactHasNumericValues,
  askTurnArtifactHasSourcePath,
  readAskTurnArtifactSnippets,
  readAskTurnArtifactSourcePath,
} from "../services/helix-ask/artifact-text";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/artifact-text.ts");

describe("Helix Ask artifact text extraction boundary", () => {
  it("keeps pure artifact text helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/artifact-text");
    expect(routeSource).not.toMatch(/const\s+normalizeAskTurnArtifactText\s*=\s*\(value/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnArtifactTextByKind\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnInstructionOnlySummaryText\s*=/);
    expect(routeSource).not.toMatch(/const\s+mergeAskTurnLedgerArtifacts\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnLedgerArtifact\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnArtifactPayloadRecord\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnArtifactSourcePath\s*=/);
    expect(routeSource).not.toMatch(/const\s+readAskTurnArtifactSnippets\s*=/);
    expect(routeSource).not.toMatch(/const\s+askTurnArtifactHasNonemptyText\s*=/);
    expect(routeSource).not.toMatch(/const\s+askTurnArtifactHasEvidenceSnippets\s*=/);
    expect(routeSource).not.toMatch(/const\s+askTurnArtifactHasNumericValues\s*=/);
    expect(routeSource).not.toMatch(/const\s+askTurnArtifactHasSourcePath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeAskTurnArtifactText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnArtifactTextByKind\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnInstructionOnlySummaryText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+mergeAskTurnLedgerArtifacts\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnLedgerArtifact\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnArtifactPayloadRecord\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnArtifactSourcePath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readAskTurnArtifactSnippets\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+askTurnArtifactHasNonemptyText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+askTurnArtifactHasEvidenceSnippets\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+askTurnArtifactHasNumericValues\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+askTurnArtifactHasSourcePath\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves source path and snippet reader behavior", () => {
    expect(readAskTurnArtifactSourcePath({ source_path: " docs/a.md ", path: "docs/b.md" })).toBe("docs/a.md");
    expect(readAskTurnArtifactSourcePath({ path: " docs/b.md " })).toBe("docs/b.md");
    expect(readAskTurnArtifactSourcePath({ active_doc_path: " docs/c.md " })).toBe("docs/c.md");
    expect(readAskTurnArtifactSourcePath({ source_path: " " })).toBeNull();
    expect(readAskTurnArtifactSnippets({ snippets: [{ text: "a" }, null, "x"] })).toEqual([{ text: "a" }]);
    expect(readAskTurnArtifactSnippets({ matches: [{ text: "b" }, 1] })).toEqual([{ text: "b" }]);
    expect(readAskTurnArtifactSnippets({})).toEqual([]);
    expect(askTurnArtifactHasNonemptyText({ payload: { answer_text: " answer " } })).toBe(true);
    expect(askTurnArtifactHasNonemptyText({ payload: { text: " " } })).toBe(false);
    expect(askTurnArtifactHasEvidenceSnippets({ payload: { snippets: [] } })).toBe(false);
    expect(askTurnArtifactHasEvidenceSnippets({ payload: { snippets: ["not-record"] } })).toBe(true);
    expect(askTurnArtifactHasNumericValues({ payload: { values: [1] } })).toBe(true);
    expect(askTurnArtifactHasNumericValues({ payload: { values: [] } })).toBe(false);
    expect(askTurnArtifactHasSourcePath({ payload: { source_path: " docs/a.md " } })).toBe(true);
    expect(askTurnArtifactHasSourcePath({ payload: { path: " " } })).toBe(false);
  });
});
