import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  cleanupAskTurnOpenDocSearchTopic,
  createAskTurnActiveDocIdentityReaders,
  createAskTurnActiveDocPromptReaders,
  createAskTurnDocIdentityIntentReaders,
  createAskTurnDocSummaryIntentReaders,
  createAskTurnLatestDocIntentReaders,
  createAskTurnOpenDocGoalIntentReader,
  extractAskTurnDocPathArgs,
  isAskTurnActiveDocConceptExplanationIntent,
  isAskTurnActiveDocLocationPrompt,
  isAskTurnActiveDocNumericExtractionIntent,
  isAskTurnActiveDocUsefulnessIntent,
  isAskTurnDeicticDocsIdentityIntent,
  isAskTurnCurrentDocIdentityToDeicticNoteIntent,
  isAskTurnCurrentDocIdentityTransferIntent,
  isAskTurnDocEvidenceSynthesisIntent,
  isAskTurnDocLocationCitationRequired,
  isAskTurnDocOpenBestIntent,
  isAskTurnDocSummaryDetailRequested,
  isAskTurnReadAloudRequested,
  isAskTurnDocsPanelOpenIntent,
  isAskTurnExplicitDocLocationPrompt,
  isAskTurnExplicitDocumentAcquisitionIntent,
  isAskTurnTopicQualifiedLatestDocIntent,
  normalizeAskTurnDocRoute,
  normalizeAskTurnLatestDocTopicText,
  normalizeAskTurnWorkspaceDocPath,
  resolveAskTurnCreateThenOpenDocTopicArg,
  resolveAskTurnDocPathArg,
  resolveAskTurnLatestDocTopicArg,
  resolveAskTurnNamedDocSummaryQueryArg,
  resolveAskTurnWorkspaceActionDocPath,
  resolveAskTurnTitleLikeOpenDocQueryArg,
  resolveAskTurnTopicDocQueryArg,
  tokenizeAskTurnDocTopic,
} from "../services/helix-ask/doc-args";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/doc-args.ts");

describe("Helix Ask doc args extraction boundary", () => {
  it("keeps doc path argument extraction out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/doc-args");
    expect(routeSource).not.toMatch(/const\s+normalizeAskTurnWorkspaceDocPath\s*=\s*\(value/);
    expect(routeSource).not.toMatch(/const\s+normalizeAskTurnDocRoute\s*=\s*\(value/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnWorkspaceActionDocPath\s*=/);
    expect(routeSource).not.toMatch(/const\s+extractAskTurnDocPathArgs\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnDocPathArg\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnReadAloudRequested\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnExplicitDocumentAcquisitionIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocOpenBestIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnExplicitDocLocationPrompt\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnActiveDocLocationPrompt\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocSummaryDetailRequested\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnActiveDocUsefulnessIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnActiveDocConceptExplanationIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnActiveDocNumericExtractionIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCompoundDocAnswerIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocAboutSummaryPrompt\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocsSummaryRequest\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocsViewerCapabilityTopicLabelPrompt\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocsOpenAndSummarizeIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocsTopicSummaryPrompt\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+shouldAskTurnSearchDocsBeforeSummary\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCurrentDocIdentityTransferIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnCurrentDocIdentityToDeicticNoteIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocIdentityIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocIdentityExplainHybridIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocLocationCitationRequired\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocEvidenceSynthesisIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDeicticDocsIdentityIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnActiveDocSummaryIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnActiveDocIdentityIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnOpenDocGoalIntent\s*=\s*\(transcript/);
    expect(routeSource).not.toMatch(/const\s+normalizeAskTurnLatestDocTopicText\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnLatestDocTopicArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnTopicQualifiedLatestDocIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+cleanupAskTurnOpenDocSearchTopic\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnCreateThenOpenDocTopicArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnOpenLatestDocIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnStrictLatestDocAcquisitionIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnRecentDocAcquisitionQueryArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+tokenizeAskTurnDocTopic\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnTopicDocQueryArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnDocsPanelOpenIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnTitleLikeOpenDocQueryArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnOpenResultDocQueryArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+resolveAskTurnOpenDocSearchQueryArg\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnTopicDocAcquisitionIntent\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnOpenDocSearchIntent\s*=/);
    expect(routeSource).toContain("createAskTurnLatestDocIntentReaders({");
    expect(serviceSource).toMatch(/export\s+const\s+extractAskTurnDocPathArgs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeAskTurnDocRoute\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeAskTurnWorkspaceDocPath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnWorkspaceActionDocPath\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnDocPathArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnReadAloudRequested\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnExplicitDocumentAcquisitionIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDocOpenBestIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnExplicitDocLocationPrompt\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnActiveDocLocationPrompt\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDocSummaryDetailRequested\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnActiveDocUsefulnessIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnActiveDocConceptExplanationIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnActiveDocNumericExtractionIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnDocSummaryIntentReaders\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnCurrentDocIdentityTransferIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnCurrentDocIdentityToDeicticNoteIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDocLocationCitationRequired\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDocEvidenceSynthesisIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDeicticDocsIdentityIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnActiveDocPromptReaders\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnActiveDocIdentityReaders\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnOpenDocGoalIntentReader\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnDocIdentityIntentReaders\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+tokenizeAskTurnDocTopic\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeAskTurnLatestDocTopicText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnLatestDocTopicArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnTopicQualifiedLatestDocIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+cleanupAskTurnOpenDocSearchTopic\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnCreateThenOpenDocTopicArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnTopicDocQueryArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnDocsPanelOpenIntent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnTitleLikeOpenDocQueryArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+resolveAskTurnOpenResultDocQueryArg\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnLatestDocIntentReaders\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves doc path extraction behavior", () => {
    expect(normalizeAskTurnWorkspaceDocPath(" docs/research/a.md ")).toBe("docs/research/a.md");
    expect(normalizeAskTurnWorkspaceDocPath("   ")).toBeNull();
    expect(normalizeAskTurnWorkspaceDocPath(null)).toBeNull();
    expect(normalizeAskTurnDocRoute(" research/a.md ")).toBe("/docs/research/a.md");
    expect(normalizeAskTurnDocRoute(" /docs/research/a.md ")).toBe("/docs/research/a.md");
    expect(normalizeAskTurnDocRoute("docs\\research\\a.md")).toBe("/docs/research/a.md");
    expect(normalizeAskTurnDocRoute("")).toBe("");
    expect(resolveAskTurnWorkspaceActionDocPath({ args: { path: " docs/a.md ", doc_path: "docs/b.md" } })).toBe(
      "docs/a.md",
    );
    expect(resolveAskTurnWorkspaceActionDocPath({ args: { path: " ", doc_path: " docs/b.md " } })).toBe("docs/b.md");
    expect(resolveAskTurnWorkspaceActionDocPath({ args: { docPath: " docs/c.md " } })).toBe("docs/c.md");
    expect(resolveAskTurnWorkspaceActionDocPath({ args: { currentPath: " docs/d.md " } })).toBe("docs/d.md");
    expect(resolveAskTurnWorkspaceActionDocPath({ args: { path: " " } })).toBeNull();
    expect(resolveAskTurnWorkspaceActionDocPath(null)).toBeNull();
    expect(
      extractAskTurnDocPathArgs("Read docs/research/nhm2-current-status-whitepaper.md, then ./notes/a.txt and docs/research/nhm2-current-status-whitepaper.md"),
    ).toEqual(["docs/research/nhm2-current-status-whitepaper.md", "./notes/a.txt"]);
    expect(extractAskTurnDocPathArgs("no explicit path here")).toEqual([]);
    expect(resolveAskTurnDocPathArg("Read docs/research/nhm2-current-status-whitepaper.md, then ./notes/a.txt")).toBe(
      "docs/research/nhm2-current-status-whitepaper.md",
    );
    expect(resolveAskTurnDocPathArg("Open the NHM2 deeper reformulation decision memo")).toBe(
      "/docs/research/nhm2-deeper-reformulation-decision-memo-2026-04-02.md",
    );
    expect(resolveAskTurnDocPathArg("no explicit path here")).toBeNull();
    expect(isAskTurnReadAloudRequested("Read this document aloud.")).toBe(true);
    expect(isAskTurnReadAloudRequested("Narrate it to me.")).toBe(true);
    expect(isAskTurnReadAloudRequested("Summarize this document silently.")).toBe(false);
    expect(isAskTurnExplicitDocumentAcquisitionIntent("Open the NHM2 white paper in the docs viewer.")).toBe(true);
    expect(isAskTurnExplicitDocumentAcquisitionIntent("Open the docs viewer.")).toBe(false);
    expect(isAskTurnDocOpenBestIntent("Find and open the best matching NHM2 document.")).toBe(true);
    expect(isAskTurnDocOpenBestIntent("Summarize the current document.")).toBe(false);
    expect(isAskTurnExplicitDocLocationPrompt("Where in docs/research/nhm2-current-status-whitepaper.md does it discuss tile force?")).toBe(true);
    expect(isAskTurnExplicitDocLocationPrompt("Summarize docs/research/nhm2-current-status-whitepaper.md")).toBe(false);
    expect(isAskTurnActiveDocLocationPrompt("Where in this document does it mention Casimir tiles?")).toBe(true);
    expect(isAskTurnActiveDocLocationPrompt("Summarize this document in 3 bullets.")).toBe(false);
    expect(isAskTurnDocSummaryDetailRequested("Summarize this document with citations and exact claims.")).toBe(true);
    expect(isAskTurnActiveDocUsefulnessIntent("What is this document useful for?")).toBe(true);
    expect(isAskTurnActiveDocConceptExplanationIntent("Explain what Casimir tiles means in this document.")).toBe(true);
    expect(isAskTurnActiveDocNumericExtractionIntent("Find the key numeric value in this document.")).toBe(true);
    expect(isAskTurnDocEvidenceSynthesisIntent("What problem is this solving?")).toBe(true);
    expect(isAskTurnDeicticDocsIdentityIntent("Which paper are we reading right now?")).toBe(true);
    expect(isAskTurnDeicticDocsIdentityIntent("What screen are we looking at?")).toBe(false);
  });

  it("preserves latest-doc topic and acquisition prompt readers", () => {
    const readers = createAskTurnLatestDocIntentReaders({
      isStructuredDocsViewerPrompt: (prompt) => /\bDocument\s+path\s*:/i.test(prompt),
    });

    expect(normalizeAskTurnLatestDocTopicText("latest NH-M2 white paper and tell me")).toBe("NHM2 whitepaper");
    expect(resolveAskTurnLatestDocTopicArg("open the latest doc about NHM2 white paper")).toBe("NHM2 NHM2 whitepaper");
    expect(resolveAskTurnLatestDocTopicArg("latest NHM2 status doc")).toBe("NHM2 status");
    expect(isAskTurnTopicQualifiedLatestDocIntent("open the latest doc about NHM2")).toBe(true);
    expect(cleanupAskTurnOpenDocSearchTopic("the recent document that talks about NHM2 white paper, then tell me")).toBe(
      "NHM2 whitepaper",
    );
    expect(readers.isAskTurnOpenLatestDocIntent("open the latest doc about NHM2")).toBe(true);
    expect(readers.isAskTurnOpenLatestDocIntent("Document path: docs/a.md\nLocate query: NHM2")).toBe(false);
    expect(readers.isAskTurnStrictLatestDocAcquisitionIntent("open latest NHM2 doc")).toBe(true);
    expect(readers.isAskTurnStrictLatestDocAcquisitionIntent("open the latest doc about NHM2")).toBe(false);
    expect(readers.resolveAskTurnRecentDocAcquisitionQueryArg("find me the recent document that talks about Casimir tiles")).toBe(
      "Casimir tiles",
    );
    expect(resolveAskTurnCreateThenOpenDocTopicArg("create note called Field Notes, then open latest doc about NHM2")).toBe(
      "NHM2",
    );
  });

  it("preserves open-doc search query readers", () => {
    const readers = createAskTurnLatestDocIntentReaders({
      isStructuredDocsViewerPrompt: (prompt) => /\bDocument\s+path\s*:/i.test(prompt),
    });

    expect(tokenizeAskTurnDocTopic("Latest NHM2 white paper report")).toEqual(["nhm2", "white", "report"]);
    expect(isAskTurnDocsPanelOpenIntent("open the docs viewer")).toBe(true);
    expect(isAskTurnDocsPanelOpenIntent("open the docs about NHM2")).toBe(false);
    expect(resolveAskTurnTopicDocQueryArg("open the doc about Casimir tile load bearing")).toBe("Casimir tile load bearing");
    expect(resolveAskTurnTopicDocQueryArg(
      "Find the local document about Helix Ask terminal authority and tell me which document you used.",
    )).toBe("Helix Ask terminal authority");
    expect(resolveAskTurnTopicDocQueryArg(
      "Do not find the local document about Helix Ask terminal authority; explain the request only.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Later, find the local document about Helix Ask terminal authority, but not now.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Search our docs for NHM2 and summarize its treatment of boundary conditions.",
    )).toBe("NHM2");
    for (const contextualPrompt of [
      "Do not search our docs for NHM2; explain the wording only.",
      "Later, search our docs for NHM2, but not now.",
      "Earlier I searched our docs for NHM2 and summarized it.",
      'The screen says "Search our docs for NHM2"; explain that visible text.',
      '"Search our docs for NHM2" was my previous prompt; do not search now.',
    ]) {
      expect(resolveAskTurnTopicDocQueryArg(contextualPrompt)).toBeNull();
    }
    expect(resolveAskTurnTopicDocQueryArg(
      "Can you look for docs about NHM2 and explain what it is?",
    )).toBe("NHM2");
    expect(resolveAskTurnTopicDocQueryArg(
      "Okay, can you look at the NHM tube doc and explain what it's about?",
    )).toBe("NHM tube");
    expect(resolveAskTurnTopicDocQueryArg(
      "Look at the NHM2 Status Document and give me the main idea.",
    )).toBe("NHM2 Status");
    expect(resolveAskTurnTopicDocQueryArg(
      "And how does this relate to the Casimir DP quantum foam document?",
    )).toBe("Casimir DP quantum foam");
    expect(resolveAskTurnTopicDocQueryArg(
      "Do not look for docs about NHM2; just explain NHM2 generally.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Later, look for docs about NHM2 and explain it.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Earlier you looked for docs about NHM2 and explained it.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      'The screen says "look for docs about NHM2 and explain it"; explain that UI text.',
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Do not look at the NHM tube doc and explain it.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Later, look at the NHM tube doc and explain it.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Earlier you looked at the NHM tube doc and explained it.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Do not look at the NHM2 Status Document and give me the main idea.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Later, look at the NHM2 Status Document and give me the main idea.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Do not compare this with the Casimir DP quantum foam document.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      "Later, compare this with the Casimir DP quantum foam document.",
    )).toBeNull();
    expect(resolveAskTurnTopicDocQueryArg(
      'The screen says "how does this relate to the Casimir DP quantum foam document?"; explain that text.',
    )).toBeNull();
    expect(resolveAskTurnTitleLikeOpenDocQueryArg("open the NHM2 deeper reformulation decision memo")).toBe(
      "NHM2 deeper reformulation decision memo",
    );
    expect(resolveAskTurnTitleLikeOpenDocQueryArg(
      "Open the NHM2 current status whitepaper in the local docs and compare its source-closure caution with the primary paper arXiv:2105.03079.",
    )).toBe("NHM2 current status whitepaper");
    expect(readers.resolveAskTurnOpenDocSearchQueryArg("show the latest result about Casimir tile load bearing")).toBe(
      "Casimir tile load bearing",
    );
    expect(readers.resolveAskTurnOpenDocSearchQueryArg("NHM2 deeper reformulation decision memo")).toBe(
      "NHM2 deeper reformulation decision memo",
    );
    expect(readers.isAskTurnTopicDocAcquisitionIntent("find a doc about Casimir tiles")).toBe(true);
    expect(readers.isAskTurnOpenDocSearchIntent("open the docs viewer")).toBe(false);
    expect(resolveAskTurnNamedDocSummaryQueryArg('Ok we have a doc called "Casimir Dp Quantum Foam Study" what this abot?')).toBe(
      "Casimir Dp Quantum Foam Study",
    );
    expect(resolveAskTurnNamedDocSummaryQueryArg("We have a document named Casimir Dp Quantum Foam Study. What is it about?")).toBe(
      "Casimir Dp Quantum Foam Study",
    );
    expect(
      readers.resolveAskTurnOpenDocSearchQueryArg('Can you tell me what the document called "Casimir Dp Quantum Foam Study" is about?'),
    ).toBe("Casimir Dp Quantum Foam Study");
  });

  it("preserves doc summary prompt readers", () => {
    const latestReaders = createAskTurnLatestDocIntentReaders({
      isStructuredDocsViewerPrompt: (prompt) => /\bDocument\s+path\s*:/i.test(prompt),
    });
    const activeDocReaders = createAskTurnActiveDocPromptReaders({
      isAskTurnComparePrecedenceIntent: (prompt) => /\bcompare\b/i.test(prompt),
      isAskTurnCurrentOpenDocsViewerSummaryPrompt: (prompt) => /\bcurrent open docs viewer summary\b/i.test(prompt),
      isAskTurnNoWorkspaceBackgroundScope: (prompt) => /\bbackground\s+only\b/i.test(prompt),
      isAskTurnNoteMutationPrecedenceIntent: (prompt) => /\bnote\b/i.test(prompt),
      isAskTurnSummarizeAndAddToNoteIntent: (prompt) => /\bsummarize\b[\s\S]*\bnote\b/i.test(prompt),
      maskProtectedArgumentSpansForIntent: (prompt) => prompt,
    });
    const summaryReaders = createAskTurnDocSummaryIntentReaders({
      isAskTurnNoWorkspaceBackgroundScope: (prompt) => /\bbackground\s+only\b/i.test(prompt),
      resolveAskTurnOpenDocSearchQueryArg: latestReaders.resolveAskTurnOpenDocSearchQueryArg,
    });

    expect(activeDocReaders.isAskTurnActiveDocSummaryIntent("What is this document about?")).toBe(true);
    expect(activeDocReaders.isAskTurnActiveDocSummaryIntent("Summarize this doc background only")).toBe(false);
    expect(activeDocReaders.isAskTurnActiveDocSummaryIntent("Compare this document with the note")).toBe(false);
    expect(activeDocReaders.isAskTurnActiveDocSummaryIntent("current open docs viewer summary")).toBe(true);
    expect(summaryReaders.isAskTurnCompoundDocAnswerIntent("open the doc about Casimir tiles and summarize it")).toBe(true);
    expect(summaryReaders.isAskTurnDocAboutSummaryPrompt("What is this document about?")).toBe(true);
    expect(summaryReaders.isAskTurnDocsViewerCapabilityTopicLabelPrompt("Docs viewer: dynamic actions coverage")).toBe(true);
    expect(summaryReaders.isAskTurnDocsSummaryRequest("Summarize this document")).toBe(true);
    expect(summaryReaders.isAskTurnDocsSummaryRequest("Summarize this document background only")).toBe(false);
    expect(summaryReaders.isAskTurnDocsOpenAndSummarizeIntent("find and open the best NHM2 whitepaper and summarize it")).toBe(true);
    expect(summaryReaders.isAskTurnDocsTopicSummaryPrompt("summarize the NHM2 whitepaper docs")).toBe(true);
    expect(summaryReaders.shouldAskTurnSearchDocsBeforeSummary("summarize the NHM2 whitepaper docs")).toBe(true);
    expect(summaryReaders.shouldAskTurnSearchDocsBeforeSummary("summarize this document")).toBe(false);
    expect(summaryReaders.isAskTurnDocAboutSummaryPrompt('Ok we have a doc called "Casimir Dp Quantum Foam Study" what this abot?')).toBe(true);
    expect(summaryReaders.shouldAskTurnSearchDocsBeforeSummary('Ok we have a doc called "Casimir Dp Quantum Foam Study" what this abot?')).toBe(true);
  });

  it("does not admit contextual named-document summary references", () => {
    const prompts = [
      'Do not look up the doc called "Casimir Dp Quantum Foam Study"; explain the wording only.',
      '\'We have a doc called "Casimir Dp Quantum Foam Study" what is it about?\' was my earlier prompt. Do not search now.',
      'If we later have a doc called "Casimir Dp Quantum Foam Study", what should we ask to learn what it is about?',
      'The visible text on screen says doc called "Casimir Dp Quantum Foam Study"; explain the label without searching.',
    ];

    for (const prompt of prompts) {
      expect(resolveAskTurnNamedDocSummaryQueryArg(prompt)).toBeNull();
    }
  });

  it("preserves active-doc identity prompt readers with visual precedence", () => {
    const readers = createAskTurnActiveDocIdentityReaders({
      isAskTurnVisualScreenTargetIntent: (prompt) => /\bvisual\s+screen\s+capture\b/i.test(prompt),
    });

    expect(readers.isAskTurnActiveDocIdentityIntent("What docs are open right now?")).toBe(true);
    expect(readers.isAskTurnActiveDocIdentityIntent("What docs are open in the visual screen capture?")).toBe(false);
    expect(readers.isAskTurnActiveDocIdentityIntent("Summarize this document.")).toBe(false);
  });

  it("preserves open-doc goal intent while keeping Dottie voice as a route dependency", () => {
    const readers = createAskTurnOpenDocGoalIntentReader({
      isAskTurnDocsPanelOpenIntent,
      isAskTurnDottieVoiceReadoutIntent: (prompt) => /\bdottie\b/i.test(prompt),
      isAskTurnOpenDocSearchIntent: (prompt) => /\bopen\s+the\s+matching\s+doc\b/i.test(prompt),
      isAskTurnOpenLatestDocIntent: (prompt) => /\bopen\s+latest\b/i.test(prompt),
      isAskTurnReadAloudRequested,
      isAskTurnTopicQualifiedLatestDocIntent,
    });

    expect(readers.isAskTurnOpenDocGoalIntent("open the matching doc")).toBe(true);
    expect(readers.isAskTurnOpenDocGoalIntent("read this document aloud")).toBe(true);
    expect(readers.isAskTurnOpenDocGoalIntent("Dottie read this document aloud")).toBe(false);
    expect(readers.isAskTurnOpenDocGoalIntent("open the docs viewer")).toBe(false);
  });

  it("preserves doc identity prompt readers", () => {
    const identityReaders = createAskTurnDocIdentityIntentReaders({
      isAskTurnComposedResearchToNoteIntent: () => false,
      isAskTurnCompareCopyResultToClipboardIntent: () => false,
      isAskTurnDocDocCompareIntent: () => false,
      isAskTurnDocNotesHybridCompareIntent: () => false,
      isAskTurnDocVsNoteCompareIntent: () => false,
      isAskTurnExplainIntent: (prompt) => /\bexplain\b/i.test(prompt),
      isAskTurnSummarizeAndAddToNoteIntent: () => false,
    });

    expect(isAskTurnCurrentDocIdentityTransferIntent("What is the current document path?")).toBe(true);
    expect(isAskTurnCurrentDocIdentityToDeicticNoteIntent("Copy the current document path to that note.")).toBe(true);
    expect(identityReaders.isAskTurnDocIdentityIntent("What document are we viewing?")).toBe(true);
    expect(identityReaders.isAskTurnDocIdentityIntent("Open the docs viewer.")).toBe(false);
    expect(identityReaders.isAskTurnDocIdentityIntent("Summarize this document.")).toBe(false);
    expect(identityReaders.isAskTurnDocIdentityExplainHybridIntent("What document are we viewing? explain")).toBe(false);
    expect(isAskTurnDocLocationCitationRequired("Find where NHM2 appears and cite document evidence.")).toBe(true);
    expect(isAskTurnDocLocationCitationRequired("Find where NHM2 appears.")).toBe(false);
  });
});
