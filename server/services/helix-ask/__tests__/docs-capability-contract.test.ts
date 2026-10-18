import { describe, expect, it } from "vitest";

import {
  HELIX_DOCS_OPEN_DOC_CAPABILITY,
  HELIX_DOCS_SEARCH_CAPABILITY,
  canonicalDocsRuntimeCapability,
  isDocsCompatibilityCapability,
} from "../docs-capability-contract";
import { explicitCapabilityContractForCapability } from "../explicit-capability-contract";
import { buildHelixCompoundCapabilityContract } from "../compound-capability-contract";

describe("Helix Docs capability contract", () => {
  it.each([
    "docs-viewer.search_docs",
    "docs-viewer.locate_in_doc",
    "docs-viewer.summarize_doc",
    "docs-viewer.doc_equation_context",
  ])("maps the compatibility read capability %s to docs.search", (capability) => {
    expect(canonicalDocsRuntimeCapability(capability)).toBe(HELIX_DOCS_SEARCH_CAPABILITY);
    expect(isDocsCompatibilityCapability(capability)).toBe(true);
    expect(explicitCapabilityContractForCapability(capability)?.runtime_capability)
      .toBe(HELIX_DOCS_SEARCH_CAPABILITY);
  });

  it("maps the safe path-based action alias to open_doc", () => {
    const capability = "docs-viewer.open_doc_by_path";
    expect(canonicalDocsRuntimeCapability(capability)).toBe(HELIX_DOCS_OPEN_DOC_CAPABILITY);
    expect(isDocsCompatibilityCapability(capability)).toBe(true);
  });

  it("keeps panel-only open as compatibility transport rather than an open_doc runtime call", () => {
    expect(canonicalDocsRuntimeCapability("docs-viewer.open")).toBeNull();
    expect(isDocsCompatibilityCapability("docs-viewer.open")).toBe(true);
  });

  it("keeps canonical Docs capabilities canonical", () => {
    expect(canonicalDocsRuntimeCapability(HELIX_DOCS_SEARCH_CAPABILITY)).toBe(HELIX_DOCS_SEARCH_CAPABILITY);
    expect(canonicalDocsRuntimeCapability(HELIX_DOCS_OPEN_DOC_CAPABILITY)).toBe(HELIX_DOCS_OPEN_DOC_CAPABILITY);
    expect(isDocsCompatibilityCapability(HELIX_DOCS_SEARCH_CAPABILITY)).toBe(false);
  });

  it("preserves the requested alias while planning the canonical runtime capability", () => {
    const contract = buildHelixCompoundCapabilityContract({
      turnId: "ask:docs-canonical-runtime",
      promptText: "Call docs-viewer.locate_in_doc to find the terminal authority rule in the active document.",
    });

    expect(contract?.subgoals).toHaveLength(1);
    expect(contract?.subgoals[0]).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      runtime_capability: HELIX_DOCS_SEARCH_CAPABILITY,
    });
  });
});
