import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAskTurnActionArgBoundaryTrimmer,
  createAskTurnNoteSinkArgReaders,
  createAskTurnNoteTransferIntentReaders,
  isAskTurnArtifactReferenceIntent,
  isAskTurnArtifactToClipboardIntent,
  isAskTurnArtifactToNoteIntent,
  isAskTurnAppendToNoteCue,
  isAskTurnCreateNoteIntent,
  isAskTurnDeicticNoteLabel,
  isAskTurnDeicticNoteWriteWithoutExplicitTitle,
  isAskTurnDeicticNoteTarget,
  isAskTurnInvalidResolvedNoteTitle,
  isAskTurnNoteMutationPrecedenceIntent,
  isAskTurnRepoCueIntent,
  maskAskTurnProtectedArgumentSpansForIntent,
  resolveAskTurnCreateNoteBodyArg,
  resolveAskTurnCreateNoteTitleArg,
  resolveAskTurnTextArg,
  resolveAskTurnTitleArg,
  trimAskTurnProtectedTitleArgBoundaries,
} from "../services/helix-ask/note-arg-boundaries";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/note-arg-boundaries.ts");

describe("Helix Ask note arg boundary extraction boundary", () => {
  it("keeps note arg boundary trimming out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/note-arg-boundaries");
    expect(routeSource).toContain("createAskTurnActionArgBoundaryTrimmer({");
    expect(routeSource).not.toMatch(/const\s+trimAskTurnActionArgBoundaries\s*=\s*\(value/);
    expect(routeSource).not.toMatch(/const\s+trimAskTurnProtectedTitleArgBoundaries\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnTextArg\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnTitleArg\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnCreateNoteTitleArg\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCreateNoteIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+maskAskTurnProtectedArgumentSpansForIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDeicticNoteLabel\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDeicticNoteTarget\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnInvalidResolvedNoteTitle\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnArtifactReferenceIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnArtifactToNoteIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDeicticNoteWriteWithoutExplicitTitle\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnArtifactToClipboardIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+normalizeAskTurnRequestedNoteTitle\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnLayDestinationNoteSinkArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnSummaryNamedNoteSinkArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnLocationNamedNoteSinkArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnArtifactBareNoteTargetArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnAppendNoteTextArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnDocsRetrievalQueryArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnRepoCueIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnAppendToNoteCue\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnNoteMutationPrecedenceIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCreateNoteThenOpenDocIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnArtifactCarryoverToNoteIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnSafeDefaultPreserveToNoteIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocsRetrievalToNoteIntent\s*=\s*\(transcript/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnActionArgBoundaryTrimmer\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnNoteSinkArgReaders\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnNoteTransferIntentReaders\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+trimAskTurnProtectedTitleArgBoundaries\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnTextArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnTitleArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnCreateNoteTitleArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnCreateNoteIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+maskAskTurnProtectedArgumentSpansForIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDeicticNoteLabel\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDeicticNoteTarget\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnInvalidResolvedNoteTitle\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnArtifactReferenceIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnArtifactToNoteIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDeicticNoteWriteWithoutExplicitTitle\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnArtifactToClipboardIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnRepoCueIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnAppendToNoteCue\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnNoteMutationPrecedenceIntent\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves bounded and unbounded trim behavior", () => {
    const boundedTrim = createAskTurnActionArgBoundaryTrimmer({ isBoundedNoteArgsEnabled: () => true });
    const unboundedTrim = createAskTurnActionArgBoundaryTrimmer({ isBoundedNoteArgsEnabled: () => false });

    expect(boundedTrim('"field notes, then summarize the doc."')).toBe("field notes");
    expect(boundedTrim("field notes explain later")).toBe("field notes");
    expect(unboundedTrim('"field notes, then summarize the doc."')).toBe("field notes, then summarize the doc");
    expect(trimAskTurnProtectedTitleArgBoundaries('"field notes, then open docs."')).toBe("field notes");
  });

  it("preserves basic text and title argument readers", () => {
    expect(resolveAskTurnTextArg("write this: alpha beta")).toBe("alpha beta");
    expect(resolveAskTurnTextArg('write "quoted text"')).toBe("quoted text");
    expect(resolveAskTurnTextArg("write without explicit content")).toBeNull();
    expect(resolveAskTurnTitleArg('create note "Field Notes, then read docs"')).toBe("Field Notes");
    expect(resolveAskTurnTitleArg("create note called Field Notes, then read docs")).toBe("Field Notes");
    expect(resolveAskTurnTitleArg("create note Field Notes, then read docs")).toBe("Field Notes");
  });

  it("extracts create-note bodies without treating them as titles", () => {
    expect(resolveAskTurnCreateNoteBodyArg('make a note for me "qwerty"')).toBe("qwerty");
    expect(resolveAskTurnCreateNoteBodyArg("Create a workstation note with body hello")).toBe("hello");
    expect(resolveAskTurnCreateNoteBodyArg("make a note called Field Notes")).toBeNull();
  });

  it("preserves create-note title and protected argument masking", () => {
    expect(resolveAskTurnCreateNoteTitleArg("title Field Notes, then read docs")).toBe("Field Notes");
    expect(resolveAskTurnCreateNoteTitleArg('write "Warp Metrics"')).toBe("Warp Metrics");
    expect(isAskTurnCreateNoteIntent("make a new research note")).toBe(true);
    expect(isAskTurnCreateNoteIntent("append to the active note")).toBe(false);
    expect(maskAskTurnProtectedArgumentSpansForIntent("create note called compare vs contrast, then open docs")).toBe(
      "create note called <NOTE_TITLE>, then open docs",
    );
  });

  it("preserves deictic and invalid note title predicates", () => {
    expect(isAskTurnDeicticNoteLabel("this note")).toBe(true);
    expect(isAskTurnDeicticNoteTarget("the note I just created")).toBe(true);
    expect(isAskTurnDeicticNoteTarget("Field Notes")).toBe(false);
    expect(isAskTurnInvalidResolvedNoteTitle("and then compare")).toBe(true);
    expect(isAskTurnInvalidResolvedNoteTitle("Field Notes")).toBe(false);
  });

  it("preserves artifact reference destination predicates", () => {
    expect(isAskTurnArtifactReferenceIntent("copy that result to my note")).toBe(true);
    expect(isAskTurnArtifactToNoteIntent("copy that result to my note")).toBe(true);
    expect(isAskTurnArtifactToNoteIntent("copy that result to Field Notes")).toBe(true);
    expect(isAskTurnDeicticNoteWriteWithoutExplicitTitle("save that answer into the note")).toBe(true);
    expect(isAskTurnArtifactToClipboardIntent("copy that answer to clipboard")).toBe(true);
    expect(isAskTurnArtifactToClipboardIntent("copy Field Notes to clipboard")).toBe(false);
  });

  it("preserves requested note-title normalization and named sink readers", () => {
    const {
      normalizeAskTurnRequestedNoteTitle,
      resolveAskTurnAppendNoteTextArg,
      resolveAskTurnArtifactBareNoteTargetArg,
      resolveAskTurnDocsRetrievalQueryArg,
      resolveAskTurnLayDestinationNoteSinkArg,
      resolveAskTurnLocationNamedNoteSinkArg,
      resolveAskTurnSummaryNamedNoteSinkArg,
    } = createAskTurnNoteSinkArgReaders({
      trimActionArgBoundaries: createAskTurnActionArgBoundaryTrimmer({ isBoundedNoteArgsEnabled: () => true }),
    });

    expect(normalizeAskTurnRequestedNoteTitle("the note called Field Notes, too")).toBe("Field Notes");
    expect(normalizeAskTurnRequestedNoteTitle("this note")).toBeNull();
    expect(resolveAskTurnLayDestinationNoteSinkArg("drop that finding into Field Notes")).toBe("Field Notes");
    expect(resolveAskTurnSummaryNamedNoteSinkArg("summarize this doc into Field Notes")).toBe("Field Notes");
    expect(resolveAskTurnSummaryNamedNoteSinkArg("summarize this doc into two paragraphs")).toBeNull();
    expect(resolveAskTurnLocationNamedNoteSinkArg("put the location into Field Notes")).toBe("Field Notes");
    expect(resolveAskTurnArtifactBareNoteTargetArg("copy that result into Field Notes")).toBe("Field Notes");
    expect(resolveAskTurnArtifactBareNoteTargetArg("copy Field Notes into clipboard")).toBeNull();
    expect(resolveAskTurnAppendNoteTextArg("append alpha beta to my note")).toBe("alpha beta");
    expect(resolveAskTurnAppendNoteTextArg("append: alpha beta")).toBe("alpha beta");
    expect(resolveAskTurnAppendNoteTextArg("append alpha beta, then open docs")).toBe("alpha beta");
    expect(resolveAskTurnDocsRetrievalQueryArg("look in the docs for warp field notes and then put summary into Field Notes")).toBe(
      "warp field notes",
    );
    expect(resolveAskTurnDocsRetrievalQueryArg("find Casimir tile capacity to put useful notes into Field Notes")).toBe(
      "Casimir tile capacity",
    );
    expect(isAskTurnRepoCueIntent("check the repo code paths")).toBe(true);
    expect(isAskTurnRepoCueIntent("check the document")).toBe(false);
    expect(isAskTurnAppendToNoteCue("append this to my note")).toBe(true);
    expect(isAskTurnAppendToNoteCue("open my note")).toBe(false);
    expect(isAskTurnNoteMutationPrecedenceIntent("Create a workstation note called Field Notes.")).toBe(true);
    expect(isAskTurnNoteMutationPrecedenceIntent("Explain the current document.")).toBe(false);
  });

  it("preserves note transfer intent readers behind route-owned dependencies", () => {
    const transferReaders = createAskTurnNoteTransferIntentReaders({
      isAskTurnArtifactReferenceIntent,
      resolveAskTurnAnyNoteSinkArg: (prompt) => /\bField Notes\b/.test(prompt) ? "Field Notes" : null,
      resolveAskTurnCreateNoteTitleArg,
      resolveAskTurnCreateThenOpenDocTopicArg: (prompt) => /\bopen\s+NHM2\b/i.test(prompt) ? "NHM2" : null,
      resolveAskTurnLayDestinationNoteSinkArg: (prompt) => /\bField Notes\b/.test(prompt) ? "Field Notes" : null,
    });

    expect(transferReaders.isAskTurnCreateNoteThenOpenDocIntent("create note called Field Notes and open NHM2")).toBe(true);
    expect(transferReaders.isAskTurnCreateNoteThenOpenDocIntent("create note called Field Notes")).toBe(false);
    expect(transferReaders.isAskTurnArtifactCarryoverToNoteIntent("copy that result to Field Notes")).toBe(true);
    expect(transferReaders.isAskTurnArtifactCarryoverToNoteIntent("summarize that result to Field Notes")).toBe(false);
    expect(transferReaders.isAskTurnSafeDefaultPreserveToNoteIntent("preserve this somewhere useful in notes")).toBe(true);
    expect(transferReaders.isAskTurnDocsRetrievalToNoteIntent("look in the docs for NHM2 summary and put it into Field Notes")).toBe(true);
    expect(transferReaders.isAskTurnDocsRetrievalToNoteIntent("look in the docs for NHM2")).toBe(false);
  });
});
