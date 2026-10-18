import { describe, expect, it } from "vitest";

import {
  CODEX_FINAL_ANSWER_PRESENTATION_POLICY_LINES,
  stripCodexSemanticRouteProposalMarkers,
} from "../codex-provider";

describe("Codex provider final-answer presentation contract", () => {
  it("defines the Markdown, LaTeX, and Mermaid dialect expected by the client", () => {
    const contract = CODEX_FINAL_ANSWER_PRESENTATION_POLICY_LINES.join("\n");

    expect(contract).toContain("GitHub-flavored Markdown");
    expect(contract).toContain("\\( ... \\)");
    expect(contract).toContain("\\[ ... \\]");
    expect(contract).toContain("never substitute standalone bare [ and ] lines");
    expect(contract).toContain("fenced mermaid block");
    expect(contract).toContain("Do not imitate a renderable diagram with ASCII");
  });

  it("preserves rich final-answer source while removing only the semantic route sideband", () => {
    const richAnswer = [
      "The field equation is \\(G_{\\mu\\nu}=8\\pi T_{\\mu\\nu}\\).",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Codex] --> B[Helix] --> C[Visible answer]",
      "```",
    ].join("\n");
    const providerOutput = [
      'HELIX_RUNTIME_SEMANTIC_ROUTE_PROPOSAL_JSON:{"proposed_route":"model_only"}',
      richAnswer,
    ].join("\n");

    expect(stripCodexSemanticRouteProposalMarkers(providerOutput)).toBe(richAnswer);
  });
});
