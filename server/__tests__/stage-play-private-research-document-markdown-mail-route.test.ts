import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const accountSessionMocks = vi.hoisted(() => ({
  getAccountSessionById: vi.fn(),
}));

const researchLibraryMocks = vi.hoisted(() => ({
  readResearchLibraryDocument: vi.fn(),
}));

vi.mock("../services/helix-account/account-session-store", async () => {
  const actual = await vi.importActual<typeof import("../services/helix-account/account-session-store")>(
    "../services/helix-account/account-session-store",
  );
  return {
    ...actual,
    getAccountSessionById: accountSessionMocks.getAccountSessionById,
  };
});

vi.mock("../services/helix-account/research-library-store", async () => {
  const actual = await vi.importActual<typeof import("../services/helix-account/research-library-store")>(
    "../services/helix-account/research-library-store",
  );
  return {
    ...actual,
    readResearchLibraryDocument: researchLibraryMocks.readResearchLibraryDocument,
  };
});

import { helixStagePlayRouter } from "../routes/helix/stage-play";
import {
  researchLibraryDocumentViewerRef,
  researchLibraryPrivateMailboxThreadId,
} from "../services/helix-account/research-library-store";
import {
  listStagePlayLiveSourceMailItems,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  recordStagePlayMicroReasonerPromptToolActivity,
  resetStagePlayProcessedMailPacketStoreForTest,
} from "../services/stage-play/stage-play-processed-mail-packet-store";
import { researchLibraryDocViewerPath } from "../../shared/helix-research-library";

const OWNER_PROFILE_ID = "profile:private-research-owner";
const OTHER_PROFILE_ID = "profile:private-research-other";
const OWNER_DOCUMENT_ID = "research:private-route-document";
const OWNER_DOCUMENT_REF = researchLibraryDocumentViewerRef(OWNER_PROFILE_ID, OWNER_DOCUMENT_ID);
const OWNER_DOCUMENT_PATH = researchLibraryDocViewerPath(OWNER_DOCUMENT_REF);
const OWNER_SOURCE_ID = `document_markdown:${OWNER_DOCUMENT_PATH}`;
const OWNER_MAILBOX_THREAD_ID = researchLibraryPrivateMailboxThreadId(OWNER_PROFILE_ID);
const RAW_PRIVATE_SOURCE = "PRIVATE SOURCE: vacuum stress tensor notes must stay scoped.";

const createApp = () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/helix/stage-play", helixStagePlayRouter);
  return app;
};

const ownerDocument = () => ({
  document_id: OWNER_DOCUMENT_ID,
  viewer_ref: OWNER_DOCUMENT_REF,
  private_translation_scope: {
    doc_path: OWNER_DOCUMENT_PATH,
    source_id: OWNER_SOURCE_ID,
    mailbox_thread_id: OWNER_MAILBOX_THREAD_ID,
  },
});

const privateTranslationPayload = (overrides: Record<string, unknown> = {}) => ({
  threadId: "helix-ask:desktop",
  mailboxThreadId: "helix-ask:desktop",
  documentId: OWNER_DOCUMENT_ID,
  documentRef: OWNER_DOCUMENT_REF,
  documentSourceKind: "research_library",
  privateSource: true,
  docPath: OWNER_DOCUMENT_PATH,
  sourceId: OWNER_SOURCE_ID,
  sourceHash: "fnv1a32:private-route-source",
  sourceTextHash: "fnv1a32:private-route-text",
  sourceTextCharCount: RAW_PRIVATE_SOURCE.length,
  locale: "haw",
  targetLanguage: "haw",
  accountLocale: "haw-US",
  chunkId: "private-research-chunk:u0001",
  projectionTarget: "docs_chunk",
  units: [
    {
      unit_id: "u0001",
      kind: "paragraph",
      source_markdown: RAW_PRIVATE_SOURCE,
      translatable: true,
      protected_spans: [],
    },
  ],
  ...overrides,
});

const ownerCookie = { Cookie: "helix_session=session-owner" };
const otherCookie = { Cookie: "helix_session=session-other" };

describe("Stage Play private Research Library document Markdown mail route", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayLiveSourceMailWakeStoreForTest();
    resetStagePlayProcessedMailPacketStoreForTest();
    accountSessionMocks.getAccountSessionById.mockReset();
    researchLibraryMocks.readResearchLibraryDocument.mockReset();
    accountSessionMocks.getAccountSessionById.mockImplementation(async (sessionId: string | null) => {
      if (sessionId === "session-owner") {
        return { profile: { profile_id: OWNER_PROFILE_ID } };
      }
      if (sessionId === "session-other") {
        return { profile: { profile_id: OTHER_PROFILE_ID } };
      }
      return null;
    });
    researchLibraryMocks.readResearchLibraryDocument.mockImplementation(
      async (profileId: string, documentId: string) =>
        profileId === OWNER_PROFILE_ID && documentId === OWNER_DOCUMENT_ID
          ? ownerDocument()
          : null,
    );
  });

  it("forces the owner's scoped mailbox and redacts HTTP responses while retaining raw worker mail", async () => {
    const app = createApp();
    const enqueueResponse = await request(app)
      .post("/api/helix/stage-play/live-source-mail/document-markdown")
      .set(ownerCookie)
      .send(privateTranslationPayload())
      .expect(200);

    expect(researchLibraryMocks.readResearchLibraryDocument).toHaveBeenCalledWith(
      OWNER_PROFILE_ID,
      OWNER_DOCUMENT_ID,
    );
    expect(enqueueResponse.body).toMatchObject({
      ok: true,
      sourceId: OWNER_SOURCE_ID,
      mailboxThreadId: OWNER_MAILBOX_THREAD_ID,
      traffic: {
        documentSourceKind: "research_library",
        privateSource: true,
        acceptedUnits: 1,
      },
      mail: {
        threadId: OWNER_MAILBOX_THREAD_ID,
        raw_content_included: false,
        summary: {
          preview: "Private Research Library source text is available only to the scoped translation worker.",
        },
      },
      raw_content_included: false,
    });
    expect(enqueueResponse.body.mailboxThreadId).not.toBe("helix-ask:desktop");
    expect(JSON.stringify(enqueueResponse.body)).not.toContain(RAW_PRIVATE_SOURCE);
    expect(JSON.parse(enqueueResponse.body.mail.summary.text)).toMatchObject({
      schema: "stage_play.private_research_mail_route_redaction.v1",
      source_id: OWNER_SOURCE_ID,
      private_source: true,
      raw_content_included: false,
    });

    const internalMail = listStagePlayLiveSourceMailItems({
      threadId: OWNER_MAILBOX_THREAD_ID,
      limit: 5,
    });
    expect(internalMail).toHaveLength(1);
    expect(JSON.stringify(internalMail[0])).toContain(RAW_PRIVATE_SOURCE);
    expect(JSON.parse(internalMail[0].summary.text)).toMatchObject({
      schema: "stage_play.document_markdown_visible_units.v1",
      doc_path: OWNER_DOCUMENT_PATH,
      document_source_kind: "research_library",
      private_source: true,
      units: [{ unit_id: "u0001", source_markdown: RAW_PRIVATE_SOURCE }],
    });

    const listResponse = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .set(ownerCookie)
      .query({ threadId: OWNER_MAILBOX_THREAD_ID })
      .expect(200);
    expect(listResponse.body.mailItems).toHaveLength(1);
    expect(JSON.stringify(listResponse.body)).not.toContain(RAW_PRIVATE_SOURCE);
    expect(JSON.parse(listResponse.body.mailItems[0].summary.text)).toMatchObject({
      schema: "stage_play.private_research_mail_route_redaction.v1",
      private_source: true,
      raw_content_included: false,
    });
  });

  it("does not expose private Research Library source identities in the unscoped preset directory", async () => {
    const app = createApp();
    const publicSourceId = "document_markdown:docs/public.md";
    recordStagePlayMicroReasonerPromptToolActivity({
      activityId: "stage_play_micro_reasoner_prompt_tool_activity:private-research",
      toolName: "microdeck.route_prompt",
      action: "route",
      status: "completed",
      summary: "Private Research Library prompt route",
      sourceIds: [OWNER_SOURCE_ID],
      evidenceRefs: [OWNER_SOURCE_ID],
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    });
    recordStagePlayMicroReasonerPromptToolActivity({
      activityId: "stage_play_micro_reasoner_prompt_tool_activity:public-doc",
      toolName: "microdeck.route_prompt",
      action: "route",
      status: "completed",
      summary: "Public document prompt route",
      sourceIds: [publicSourceId],
      evidenceRefs: [publicSourceId],
      createdAt: "2026-07-18T12:00:01.000Z",
      updatedAt: "2026-07-18T12:00:01.000Z",
    });
    recordStagePlayMicroReasonerPromptToolActivity({
      activityId: "stage_play_micro_reasoner_prompt_tool_activity:mixed-public-private",
      toolName: "microdeck.route_prompt",
      action: "route",
      status: "completed",
      summary: "Mixed public and private prompt route",
      sourceIds: [publicSourceId, OWNER_SOURCE_ID],
      evidenceRefs: [publicSourceId, OWNER_SOURCE_ID],
      createdAt: "2026-07-18T12:00:02.000Z",
      updatedAt: "2026-07-18T12:00:02.000Z",
    });
    const applyResponse = await request(app)
      .post("/api/helix/stage-play/micro-reasoner-prompt-preset/apply")
      .set(ownerCookie)
      .send({
        presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
        sourceIds: [OWNER_SOURCE_ID],
        sourceKind: "document_markdown",
      })
      .expect(200);
    expect(JSON.stringify(applyResponse.body)).not.toContain(OWNER_SOURCE_ID);
    expect(JSON.stringify(applyResponse.body)).not.toContain(OWNER_DOCUMENT_REF);

    const unscopedResponse = await request(app)
      .get("/api/helix/stage-play/micro-reasoner-prompt-preset")
      .expect(200);
    expect(JSON.stringify(unscopedResponse.body)).not.toContain(OWNER_SOURCE_ID);
    expect(JSON.stringify(unscopedResponse.body)).not.toContain(OWNER_DOCUMENT_REF);
    expect(unscopedResponse.body.presets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
      }),
    ]));

    const unscopedMailboxResponse = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .expect(200);
    expect(JSON.stringify(unscopedMailboxResponse.body)).not.toContain(OWNER_SOURCE_ID);
    expect(JSON.stringify(unscopedMailboxResponse.body)).not.toContain(OWNER_DOCUMENT_REF);
    expect(unscopedMailboxResponse.body.microReasonerPromptToolActivities).toEqual([
      expect.objectContaining({
        activityId: "stage_play_micro_reasoner_prompt_tool_activity:public-doc",
      }),
    ]);

    const publicSourceMailboxResponse = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({ sourceId: publicSourceId })
      .expect(200);
    expect(JSON.stringify(publicSourceMailboxResponse.body)).not.toContain(OWNER_SOURCE_ID);
    expect(JSON.stringify(publicSourceMailboxResponse.body)).not.toContain(OWNER_DOCUMENT_REF);
    expect(publicSourceMailboxResponse.body.microReasonerPromptToolActivities).toEqual([
      expect.objectContaining({
        activityId: "stage_play_micro_reasoner_prompt_tool_activity:public-doc",
      }),
    ]);
  });

  it("requires the owner session for private thread, source, and mail identities", async () => {
    const app = createApp();
    const enqueueResponse = await request(app)
      .post("/api/helix/stage-play/live-source-mail/document-markdown")
      .set(ownerCookie)
      .send(privateTranslationPayload())
      .expect(200);
    const mailId = enqueueResponse.body.mail.mailId as string;

    const anonymousResponse = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({ threadId: OWNER_MAILBOX_THREAD_ID })
      .expect(401);
    expect(anonymousResponse.body.error).toBe("private_research_mailbox_profile_session_required");

    for (const query of [
      { threadId: OWNER_MAILBOX_THREAD_ID },
      { sourceId: OWNER_SOURCE_ID },
      { mailId },
    ]) {
      const response = await request(app)
        .get("/api/helix/stage-play/live-source-mail")
        .set(otherCookie)
        .query(query)
        .expect(403);
      expect(response.body.error).toBe("private_research_mailbox_forbidden");
      expect(JSON.stringify(response.body)).not.toContain(RAW_PRIVATE_SOURCE);
    }
  });

  it("fails closed for forged viewer, source, and path provenance", async () => {
    const app = createApp();
    const sameAccountForgedRef = researchLibraryDocumentViewerRef(
      OWNER_PROFILE_ID,
      "research:forged-document",
    );
    const sameAccountForgedPath = researchLibraryDocViewerPath(sameAccountForgedRef);

    const sourceMismatch = await request(app)
      .post("/api/helix/stage-play/live-source-mail/document-markdown")
      .set(ownerCookie)
      .send(privateTranslationPayload({ sourceId: "document_markdown:docs/forged.md" }))
      .expect(400);
    expect(sourceMismatch.body.error).toBe("private_research_translation_source_id_mismatch");

    const viewerMismatch = await request(app)
      .post("/api/helix/stage-play/live-source-mail/document-markdown")
      .set(ownerCookie)
      .send(privateTranslationPayload({ documentRef: sameAccountForgedRef }))
      .expect(400);
    expect(viewerMismatch.body.error).toBe("private_research_document_provenance_mismatch");

    const forgedPath = await request(app)
      .post("/api/helix/stage-play/live-source-mail/document-markdown")
      .set(ownerCookie)
      .send(privateTranslationPayload({
        documentRef: sameAccountForgedRef,
        docPath: sameAccountForgedPath,
        sourceId: `document_markdown:${sameAccountForgedPath}`,
      }))
      .expect(403);
    expect(forgedPath.body.error).toBe("private_research_translation_document_ref_forbidden");

    const malformedPath = "research-library/%E0%A4%A";
    const malformedResponse = await request(app)
      .post("/api/helix/stage-play/live-source-mail/document-markdown")
      .set(ownerCookie)
      .send(privateTranslationPayload({
        documentRef: "private-research:forged:forged",
        docPath: malformedPath,
        sourceId: `document_markdown:${malformedPath}`,
      }))
      .expect(400);
    expect(malformedResponse.body.error).toBe("invalid_private_research_document_identity");

    expect(listStagePlayLiveSourceMailItems({
      threadId: OWNER_MAILBOX_THREAD_ID,
      limit: 5,
    })).toHaveLength(0);
  });
});
