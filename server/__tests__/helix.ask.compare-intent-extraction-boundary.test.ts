import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  askTurnHasExplicitWorkspaceCompareOperand,
  createAskTurnCompareIntentReaders,
  isAskTurnComparePrecedenceIntent,
  isAskTurnGenericDocCompareTarget,
} from "../services/helix-ask/compare-intent";
import {
  createAskTurnActionArgBoundaryTrimmer,
  maskAskTurnProtectedArgumentSpansForIntent,
} from "../services/helix-ask/note-arg-boundaries";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/compare-intent.ts");

const readers = createAskTurnCompareIntentReaders({
  maskProtectedArgumentSpansForIntent: maskAskTurnProtectedArgumentSpansForIntent,
  trimActionArgBoundaries: createAskTurnActionArgBoundaryTrimmer({ isBoundedNoteArgsEnabled: () => true }),
});

describe("Helix Ask compare intent extraction boundary", () => {
  it("keeps compare intent helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/compare-intent");
    expect(routeSource).toContain("createAskTurnCompareIntentReaders({");
    expect(routeSource).not.toMatch(/const\s+askTurnHasExplicitWorkspaceCompareOperand\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnComparePrecedenceIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnConceptualVsQuestion\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+askTurnHasCompareCueOutsideProtectedArgs\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocNotesHybridCompareIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnExtractAppendCompareIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCreateCopyCompareIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCompareCopyResultToClipboardIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnCompareRightHandTargetArg\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnGenericDocCompareTarget\s*=\s*\(value/);
    expect(routeSource).not.toMatch(/const\s+HELIX_ASK_TURN_COMPARE_CUE_RE\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+HELIX_ASK_TURN_COMPARE_CUE_RE\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+askTurnHasExplicitWorkspaceCompareOperand\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnComparePrecedenceIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnGenericDocCompareTarget\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnCompareIntentReaders\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves workspace compare and conceptual-vs behavior", () => {
    expect(askTurnHasExplicitWorkspaceCompareOperand("compare docs/research/a.md with notes/b.md")).toBe(true);
    expect(isAskTurnComparePrecedenceIntent("Compare this document against my notes.")).toBe(true);
    expect(isAskTurnComparePrecedenceIntent("Compare proper time versus coordinate time.")).toBe(false);
    expect(readers.isAskTurnConceptualVsQuestion("what is proper time vs coordinate time?")).toBe(true);
    expect(readers.askTurnHasCompareCueOutsideProtectedArgs("what is proper time vs coordinate time?")).toBe(false);
    expect(readers.askTurnHasCompareCueOutsideProtectedArgs("compare the current doc with Field Notes")).toBe(true);
    expect(readers.isAskTurnDocNotesHybridCompareIntent("compare this document with my notes")).toBe(true);
    expect(readers.isAskTurnDocNotesHybridCompareIntent("compare proper time with coordinate time")).toBe(false);
    expect(readers.isAskTurnDocNotesHybridCompareIntent("summarize this document")).toBe(false);
    expect(readers.isAskTurnExtractAppendCompareIntent("extract numeric claims, append them to note, and compare")).toBe(true);
    expect(readers.isAskTurnExtractAppendCompareIntent("extract numeric claims into a note")).toBe(false);
    expect(readers.isAskTurnCreateCopyCompareIntent("create a note, copy latest clipboard entry into note, and compare")).toBe(true);
    expect(readers.isAskTurnCreateCopyCompareIntent("create a note from the clipboard")).toBe(false);
    expect(readers.isAskTurnCompareCopyResultToClipboardIntent("compare this doc and copy the result to clipboard")).toBe(true);
    expect(readers.isAskTurnCompareCopyResultToClipboardIntent("copy the result to clipboard")).toBe(false);
    expect(isAskTurnGenericDocCompareTarget("docs/research/nhm2-current-status-whitepaper.md")).toBe(true);
    expect(isAskTurnGenericDocCompareTarget("the current document")).toBe(true);
    expect(isAskTurnGenericDocCompareTarget("Field Notes")).toBe(false);
  });

  it("preserves protected title masking and right-hand target parsing", () => {
    expect(readers.askTurnHasCompareCueOutsideProtectedArgs("create note called compare vs contrast, then open docs")).toBe(
      false,
    );
    expect(readers.resolveAskTurnCompareRightHandTargetArg("compare this doc with Field Notes, tell me deltas")).toBe(
      "Field Notes",
    );
    expect(readers.resolveAskTurnCompareRightHandTargetArg("compare this doc with the note called Field Notes")).toBe(
      "Field Notes",
    );
  });
});
