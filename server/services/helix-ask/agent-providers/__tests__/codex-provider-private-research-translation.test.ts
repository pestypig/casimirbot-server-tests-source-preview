import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  activeDocVisibleTranslationContextFromBody,
  buildCodexModelVisibleWorkspaceSnapshot,
  enrichVisibleTranslationCollectorCandidateFromBody,
  codexProvider,
  isAffirmativePrivateVisibleDocumentTranslationRequest,
  privateResearchVisibleTranslationContextOwnedByRequest,
} from "../codex-provider";
import { researchLibraryPrivateAccountToken } from "../../../helix-account/research-library-store";

const buildPrivateResearchContext = (profileId = "profile:private-visible-owner") => {
  const documentRef = `private-research:${researchLibraryPrivateAccountToken(profileId)}:document-token`;
  const docPath = `research-library/${encodeURIComponent(documentRef)}`;
  const sourceId = `document_markdown:${docPath}`;
  const provenance = {
    document_source_kind: "research_library",
    document_ref: documentRef,
    private_source: true,
    doc_path: docPath,
  };
  return {
    schema: "helix.ask.active_doc_visible_translation_context.v1",
    ...provenance,
    source_kind: "docs_viewer",
    panel_id: "docs-viewer",
    source_id: sourceId,
    source_hash: "sha256:private-document",
    source_text_hash: "sha256:private-document",
    source_text_char_count: 21,
    chunk_count: 1,
    total_unit_count: 1,
    translatable_unit_count: 1,
    account_locale: "en-US",
    target_language: "es",
    projection_target: "docs_chunk",
    collection_strategy: "loaded_document_translation_units_bounded",
    chunks: [{
      ...provenance,
      source_kind: "docs_viewer",
      panel_id: "docs-viewer",
      source_id: sourceId,
      source_hash: "sha256:private-document",
      source_text_hash: "sha256:private-visible-chunk",
      source_text_char_count: 21,
      visible_text: "SECRET PRIVATE SOURCE",
      chunk_id: "u0001",
      chunk_index: 0,
      dedupe_key: "private-document:u0001:es",
      region_id: "docs-viewer:u0001",
      projection_target: "docs_chunk",
      raw_content_included: false,
      assistant_answer: false,
      terminal_eligible: false,
      answer_authority: false,
      reentry_required: true,
    }],
    ui_text_regions: [],
    raw_content_included: false,
    assistant_answer: false,
    terminal_eligible: false,
    answer_authority: false,
    reentry_required: true,
  };
};

describe("Codex provider private Research Library translation admission", () => {
  it("keeps opaque identity but removes private visible text from the model-visible workspace snapshot", () => {
    const activeContext = {
      schema: "helix.ask.active_doc_visible_translation_context.v1",
      document_source_kind: "research_library",
      document_ref: "private-research:account-token:document-token",
      private_source: true,
      doc_path: "research-library/private-research%3Aaccount-token%3Adocument-token",
      source_id: "document_markdown:research-library/private-research%3Aaccount-token%3Adocument-token",
      title: "SECRET PRIVATE TITLE",
      secret_payload: { arbitrary: "SECRET ARBITRARY PAYLOAD" },
      panel_text_regions: "SECRET MALFORMED REGION STRING",
      chunks: [{
        chunk_id: "u0001",
        visible_text: "SECRET PRIVATE SOURCE",
        nested: { sourceMarkdown: "SECRET PRIVATE MARKDOWN" },
        bbox: { source: "SECRET BBOX SOURCE" },
      }],
    };
    const workspace = {
      activeDocVisibleTranslationContext: activeContext,
      active_doc_visible_translation_context: activeContext,
      accountLanguageTranslationProjections: [{ displayText: "SECRET UI TRANSLATION" }],
      visibleTranslationProjections: [{ translated_text: "SECRET DOCUMENT TRANSLATION" }],
    };

    const result = buildCodexModelVisibleWorkspaceSnapshot({
      workspace_context_snapshot: workspace,
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      privateVisibleTextRedacted: true,
      private_visible_text_redacted: true,
      privateVisibleTextRequiresAffirmativeTranslationAdmission: true,
      accountLanguageTranslationProjections: [],
      visibleTranslationProjections: [],
      activeDocVisibleTranslationContext: {
        document_source_kind: "research_library",
        document_ref: "private-research:account-token:document-token",
        private_source: true,
        doc_path: "research-library/private-research%3Aaccount-token%3Adocument-token",
      },
    });
    expect(serialized).not.toContain("SECRET PRIVATE TITLE");
    expect(serialized).not.toContain("SECRET PRIVATE SOURCE");
    expect(serialized).not.toContain("SECRET PRIVATE MARKDOWN");
    expect(serialized).not.toContain("SECRET ARBITRARY PAYLOAD");
    expect(serialized).not.toContain("SECRET MALFORMED REGION STRING");
    expect(serialized).not.toContain("SECRET BBOX SOURCE");
    expect(serialized).not.toContain("SECRET UI TRANSLATION");
    expect(serialized).not.toContain("SECRET DOCUMENT TRANSLATION");
  });

  it("redacts both active-context aliases when either alias claims private research", () => {
    const canonicalContext = {
      document_source_kind: "canonical_docs",
      private_source: false,
      doc_path: "docs/public.md",
      visible_text: "SECRET SNAKE ALIAS SOURCE",
    };
    const privateContext = {
      ...buildPrivateResearchContext(),
      secret_payload: "SECRET CAMEL ALIAS PAYLOAD",
    };
    const result = buildCodexModelVisibleWorkspaceSnapshot({
      workspace_context_snapshot: {
        active_doc_visible_translation_context: canonicalContext,
        activeDocVisibleTranslationContext: privateContext,
      },
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      privateVisibleTextRedacted: true,
      privateVisibleContextAliasConflict: true,
      active_doc_visible_translation_context: {
        document_source_kind: "research_library",
        private_source: true,
      },
      activeDocVisibleTranslationContext: {
        document_source_kind: "research_library",
        private_source: true,
      },
    });
    expect(serialized).not.toContain("SECRET SNAKE ALIAS SOURCE");
    expect(serialized).not.toContain("SECRET CAMEL ALIAS PAYLOAD");
  });

  it("fails closed when private provenance aliases conflict inside the active context", () => {
    const privateContext = buildPrivateResearchContext();
    const conflictingContext = {
      ...privateContext,
      documentSourceKind: "canonical_docs",
      privateSource: false,
      docPath: "docs/forged-public.md",
      visible_text: "SECRET CONFLICT SOURCE",
    };
    const body = {
      workspace_context_snapshot: {
        active_doc_visible_translation_context: conflictingContext,
      },
    };
    const result = buildCodexModelVisibleWorkspaceSnapshot(body);

    expect(result).toMatchObject({
      privateVisibleTextRedacted: true,
      privateVisibleContextAliasConflict: true,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET CONFLICT SOURCE");
    expect(activeDocVisibleTranslationContextFromBody(body)).toBeNull();
  });

  it("redacts a canonical-looking parent when a nested chunk claims private research provenance", () => {
    const privateContext = buildPrivateResearchContext();
    const canonicalLookingContext = {
      schema: "helix.ask.active_doc_visible_translation_context.v1",
      document_source_kind: "canonical_docs",
      private_source: false,
      source_kind: "docs_viewer",
      panel_id: "docs-viewer",
      doc_path: "docs/public.md",
      source_id: "document_markdown:docs/public.md",
      chunks: [{
        ...privateContext.chunks[0],
        visible_text: "SECRET NESTED PRIVATE CHUNK",
      }],
      ui_text_regions: [],
    };
    const body = {
      workspace_context_snapshot: {
        active_doc_visible_translation_context: canonicalLookingContext,
      },
    };
    const result = buildCodexModelVisibleWorkspaceSnapshot(body);

    expect(result).toMatchObject({
      privateVisibleTextRedacted: true,
      active_doc_visible_translation_context: {
        document_source_kind: "canonical_docs",
        chunks: [{
          document_source_kind: "research_library",
          private_source: true,
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("SECRET NESTED PRIVATE CHUNK");
    expect(activeDocVisibleTranslationContextFromBody(body)).toBeNull();
  });

  it("detects private provenance in projection arrays and clears malformed mixed aliases", () => {
    const privateContext = buildPrivateResearchContext();
    const privateProjection = {
      documentSourceKind: "research_library",
      documentRef: privateContext.document_ref,
      privateSource: true,
      docPath: privateContext.doc_path,
      sourceId: privateContext.source_id,
      displayText: "SECRET PRIVATE PROJECTION",
      projection: {
        documentSourceKind: "research_library",
        documentRef: privateContext.document_ref,
        privateSource: true,
        docPath: privateContext.doc_path,
        sourceId: privateContext.source_id,
        translatedText: "SECRET NESTED PRIVATE PROJECTION",
      },
    };
    const result = buildCodexModelVisibleWorkspaceSnapshot({
      workspace_context_snapshot: {
        active_doc_visible_translation_context: {
          document_source_kind: "canonical_docs",
          private_source: false,
          doc_path: "docs/public.md",
          visible_text: "SECRET CANONICAL ALIAS CONTENT",
        },
        accountLanguageTranslationProjections: [privateProjection],
        visibleTranslationProjections: [privateProjection],
        visible_translation_projections: "SECRET MALFORMED PROJECTION ALIAS",
      },
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      privateVisibleTextRedacted: true,
      privateVisibleContextAliasConflict: true,
      accountLanguageTranslationProjections: [],
      account_language_translation_projections: [],
      visibleTranslationProjections: [],
      visible_translation_projections: [],
    });
    expect(serialized).not.toContain("SECRET PRIVATE PROJECTION");
    expect(serialized).not.toContain("SECRET NESTED PRIVATE PROJECTION");
    expect(serialized).not.toContain("SECRET MALFORMED PROJECTION ALIAS");
    expect(serialized).not.toContain("SECRET CANONICAL ALIAS CONTENT");
  });

  it("admits only structurally valid private context into the collector enrichment boundary", () => {
    const context = buildPrivateResearchContext();
    expect(activeDocVisibleTranslationContextFromBody({
      workspace_context_snapshot: {
        active_doc_visible_translation_context: context,
      },
    })).toBe(context);

    expect(activeDocVisibleTranslationContextFromBody({
      workspace_context_snapshot: {
        active_doc_visible_translation_context: {
          ...context,
          panel_text_regions: "SECRET MALFORMED REGION STRING",
        },
      },
    })).toBeNull();
  });

  it("strips candidate-carried private source unless the trusted body admits the exact context", () => {
    const context = buildPrivateResearchContext();
    const candidate = {
      capability: "workstation.visible_text.collect_translation_targets",
      active_doc_visible_translation_context: {
        ...context,
        secret_payload: "SECRET CANDIDATE PAYLOAD",
      },
      visible_text: "SECRET CANDIDATE TEXT",
    };

    expect(enrichVisibleTranslationCollectorCandidateFromBody({
      question: "Translate this paper to Spanish.",
    }, candidate)).toEqual({
      capability: "workstation.visible_text.collect_translation_targets",
      target_language: "es",
    });

    expect(enrichVisibleTranslationCollectorCandidateFromBody({
      question: "Translate this paper to Spanish.",
      research_library_owner_id: "profile:private-visible-owner",
      workspace_context_snapshot: {
        active_doc_visible_translation_context: context,
      },
    }, candidate)).toMatchObject({
      capability: "workstation.visible_text.collect_translation_targets",
      target_language: "es",
      active_doc_visible_translation_context: context,
    });
  });

  it("matches private context ownership only to the trusted request profile", () => {
    const ownerProfileId = "profile:private-visible-owner";
    const context = buildPrivateResearchContext(ownerProfileId);

    expect(privateResearchVisibleTranslationContextOwnedByRequest({
      research_library_owner_id: ownerProfileId,
    }, context)).toBe(true);
    expect(privateResearchVisibleTranslationContextOwnedByRequest({}, context)).toBe(false);
    expect(privateResearchVisibleTranslationContextOwnedByRequest({
      research_library_owner_id: "profile:different-owner",
    }, context)).toBe(false);
    expect(privateResearchVisibleTranslationContextOwnedByRequest({
      research_library_owner_id: ownerProfileId,
    }, {
      ...context,
      documentRef: "private-research:forged-account-token:document-token",
    })).toBe(false);
  });

  it("does not alter canonical document workspace context", () => {
    const workspace = {
      active_doc_visible_translation_context: {
        document_source_kind: "canonical_docs",
        private_source: false,
        visible_text: "Public documentation text",
      },
    };
    expect(buildCodexModelVisibleWorkspaceSnapshot({
      workspace_context_snapshot: workspace,
    })).toBe(workspace);
  });

  it("keeps private source text out of the initial Codex prompt before source admission", async () => {
    const previousStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
    const previousStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    const previousCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    const previousExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    const previousCapturePromptPath = process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-private-research-prompt-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: ["I can explain the available document actions without reading private source text."],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;
    try {
      const profileId = "profile:private-prompt-owner";
      await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-private-research-model-prompt",
          question: "What actions are available for this open paper?",
          research_library_owner_id: profileId,
          workspace_context_snapshot: {
            active_doc_visible_translation_context: buildPrivateResearchContext(profileId),
          },
        },
      });

      const prompt = fs.readFileSync(capturePromptPath, "utf8");
      expect(prompt).toContain("private_visible_text_redacted");
      expect(prompt).toContain("private_visible_text_requires_affirmative_translation_admission");
      expect(prompt).not.toContain("SECRET PRIVATE SOURCE");
    } finally {
      if (previousStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
      else process.env.CODEX_AGENT_FAKE_STDOUT = previousStdout;
      if (previousStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
      else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = previousStdoutSequence;
      if (previousCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
      else process.env.CODEX_AGENT_FAKE_CALL_INDEX = previousCallIndex;
      if (previousExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
      else process.env.CODEX_AGENT_FAKE_EXIT_CODE = previousExitCode;
      if (previousCapturePromptPath === undefined) delete process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH;
      else process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = previousCapturePromptPath;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it.each([
    "Translate this paper to Spanish.",
    "Could you translate the current research document?",
    "I would like this visible paper translated into French.",
    "Please provide a Spanish translation of the paper I have open.",
    "Don't summarize it; translate this paper to Japanese.",
    "If possible, please translate this paper to Spanish.",
    "When possible, translate this paper to Spanish.",
    "Please translate this paper when you can.",
    "Translate this paper now, but leave the appendix as-is.",
  ])("admits affirmative current-document requests: %s", (question) => {
    expect(isAffirmativePrivateVisibleDocumentTranslationRequest(question)).toBe(true);
  });

  it.each([
    "Do not translate this paper.",
    "Later we might translate this paper.",
    "If the paper is useful, translate it someday.",
    "I translated this paper yesterday.",
    "The button says \"Translate this paper\".",
    "What does \"translate this paper\" mean?",
    "Would a translator translate this paper?",
    "Please summarize this paper.",
    "Translate this paper—actually, don't translate it.",
    "Translate this paper. On second thought, don't do that.",
    "Translate this paper tomorrow.",
    "Translate this paper if I ask you later.",
    "When I am ready, translate this paper.",
    "Translate this paper was my request yesterday.",
    "The button reads Translate this paper.",
    "Translate this paper is the button label.",
    "Translate this paper, but do not translate the private appendix.",
    "Please translate the title, but don't translate this paper.",
    "Let's not translate this paper.",
    "I want no translation of this paper.",
    "I want to know whether you can translate this paper.",
    "Translate the public abstract, but not this current private document.",
    "Translate the public notes and leave this private paper untranslated.",
  ])("rejects contextual or non-command translation language: %s", (question) => {
    expect(isAffirmativePrivateVisibleDocumentTranslationRequest(question)).toBe(false);
  });
});
