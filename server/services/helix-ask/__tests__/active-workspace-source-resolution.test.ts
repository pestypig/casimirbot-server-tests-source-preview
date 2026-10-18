import { describe, expect, it } from "vitest";

import { buildActiveWorkspaceSourceResolution } from "../active-workspace-source-resolution";

const activeDocsSnapshot = {
  activePanel: "docs-viewer",
  activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
  hasDocContext: true,
};

const resolve = (promptText: string, workspaceSnapshot: unknown = activeDocsSnapshot) =>
  buildActiveWorkspaceSourceResolution({
    turnId: "turn:active-doc-test",
    promptText,
    workspaceSnapshot,
  });

describe("active workspace source resolution", () => {
  it.each([
    "What is the main idea?",
    "What is it about?",
    "Can you summarize the paper?",
    "What is it really trying to establish?",
    "That sounds stronger than the evidence. Correct it and tell me what the paper does not prove.",
    "How does that connect to the Casimir effect?",
    "Does the paper actually prove physical viability?",
  ])("binds a natural active-document continuation: %s", (promptText) => {
    const result = resolve(promptText);

    expect(result.resolved_source_target).toBe("active_doc");
    expect(result.reason).toBe("active_doc_evidence_followup");
    expect(result.requested_terminal_kind).toBe("doc_evidence_synthesis_answer");
  });

  it.each([
    "Do not summarize the paper.",
    "Later, explain what the main idea is.",
    "Earlier you explained how it connects to the Casimir effect.",
    "Do not correct that claim.",
    "Later, correct that claim and explain what the paper does not prove.",
    "Earlier you corrected that claim and explained what the paper did not prove.",
    'The button says "summarize the paper".',
    'The screen says "Correct it and tell me what the paper does not prove."',
    '"What is the main idea?"',
  ])("does not turn contextual language into active-doc authority: %s", (promptText) => {
    expect(resolve(promptText).reason).not.toBe("active_doc_evidence_followup");
  });

  it("does not bind the same natural continuation without a valid active document", () => {
    const result = resolve("What is the main idea?", {
      activePanel: "theory-badge-graph",
      activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
      hasDocContext: false,
    });

    expect(result.resolved_source_target).toBe("unknown");
    expect(result.reason).toBe("no_active_workspace_resolution");
  });
});
