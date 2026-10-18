import { describe, expect, it } from "vitest";

import { buildCanonicalDocsPanelAction } from "../docs-action-adapter";

describe("Helix canonical Docs action adapter", () => {
  it("translates docs.search into bounded compatibility transport", () => {
    expect(buildCanonicalDocsPanelAction({
      capability: "docs.search",
      args: { query: "terminal authority", paths: ["docs/helix-ask-codex-loop-discipline.md"], limit: 3 },
    })).toEqual({
      panel_id: "docs-viewer",
      action_id: "search_docs",
      args: {
        query: "terminal authority",
        limit: 3,
        path: "docs/helix-ask-codex-loop-discipline.md",
      },
    });
  });

  it("translates open_doc only for safe Docs paths", () => {
    expect(buildCanonicalDocsPanelAction({
      capability: "docs-viewer.open_doc",
      args: { path: "docs/research/nhm2-current-status-whitepaper.md" },
    })).toMatchObject({
      panel_id: "docs-viewer",
      action_id: "open_doc_by_path",
      args: { path: "docs/research/nhm2-current-status-whitepaper.md" },
    });
    expect(buildCanonicalDocsPanelAction({
      capability: "docs-viewer.open_doc",
      args: { path: "../secret.md" },
    })).toEqual({ panel_id: "docs-viewer", action_id: "open", args: {} });
  });

  it("does not translate compatibility names or unrelated capabilities", () => {
    expect(buildCanonicalDocsPanelAction({
      capability: "docs-viewer.locate_in_doc",
      args: { query: "terminal authority" },
    })).toBeNull();
    expect(buildCanonicalDocsPanelAction({ capability: "repo.search", args: {} })).toBeNull();
  });
});
