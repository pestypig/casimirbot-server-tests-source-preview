import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { helixStagePlayRouter } from "../routes/helix/stage-play";
import {
  listStagePlayLiveSourceMailItems,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";

const createApp = () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/helix/stage-play", helixStagePlayRouter);
  return app;
};

describe("stage play document Markdown mail route", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayLiveSourceMailWakeStoreForTest();
  });

  it("preserves docs chunk projection target through response and stored mail summary", async () => {
    const response = await request(createApp())
      .post("/api/helix/stage-play/live-source-mail/document-markdown")
      .send({
        threadId: "thread:docs-translation",
        docPath: "docs/example.md",
        locale: "haw",
        targetLanguage: "haw",
        accountLocale: "haw-US",
        sourceHash: "fnv1a32:test",
        sourceTextHash: "fnv1a32:text-payload",
        sourceTextCharCount: "Visible source paragraph.".length,
        sourceId: "document_markdown:docs/example.md",
        chunkId: "doc-inline:fnv1a32:test:u0001",
        chunkIndex: 2,
        laneSessionId: "lane_session:live_translation:docs:fnv1a32:test",
        sessionControlKey: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
        sourceBindingKey: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw-US::haw",
        sourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload::25::docs::docs_chunk::haw-US::haw",
        latestSourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload-latest::25::docs::docs_chunk::haw-US::haw",
        mailLoopObservationKey:
          "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw-US::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
        receiptRef: "receipt:doc-inline",
        projectionTarget: "docs_chunk",
        units: [
          {
            unit_id: "u0001",
            kind: "paragraph",
            source_markdown: "Visible source paragraph.",
            translatable: true,
            protected_spans: [],
          },
        ],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "stage_play_document_markdown_mail_enqueue_response/v1",
      sourceKind: "document_markdown",
      sourceId: "document_markdown:docs/example.md",
      traffic: {
        sourceHash: "fnv1a32:test",
        sourceTextHash: "fnv1a32:text-payload",
        sourceTextCharCount: "Visible source paragraph.".length,
        chunkId: "doc-inline:fnv1a32:test:u0001",
        chunkIndex: 2,
        laneSessionId: "lane_session:live_translation:docs:fnv1a32:test",
        sessionControlKey: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
        sourceBindingKey: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw-US::haw",
        sourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload::25::docs::docs_chunk::haw-US::haw",
        latestSourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload-latest::25::docs::docs_chunk::haw-US::haw",
        mailLoopObservationKey:
          "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw-US::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
        receiptRef: "receipt:doc-inline",
        projectionTarget: "docs_chunk",
        targetLanguage: "haw",
        accountLocale: "haw-US",
        acceptedUnits: 1,
      },
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });

    const storedMail = listStagePlayLiveSourceMailItems({
      threadId: "thread:docs-translation",
      limit: 5,
    });
    expect(storedMail).toHaveLength(1);
    expect(storedMail[0]).toMatchObject({
      sourceId: "document_markdown:docs/example.md",
      sourceKind: "document_markdown",
      sourceRefs: {
        sourceHash: "fnv1a32:test",
        sourceTextHash: "fnv1a32:text-payload",
        sourceTextCharCount: "Visible source paragraph.".length,
        laneSessionId: "lane_session:live_translation:docs:fnv1a32:test",
        sessionControlKey: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
        sourceBindingKey: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw-US::haw",
        sourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload::25::docs::docs_chunk::haw-US::haw",
        latestSourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload-latest::25::docs::docs_chunk::haw-US::haw",
        mailLoopObservationKey:
          "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw-US::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
        receiptRef: "receipt:doc-inline",
      },
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });

    const summary = JSON.parse(storedMail[0].summary.text);
    expect(summary).toMatchObject({
      schema: "stage_play.document_markdown_visible_units.v1",
      answer_authority: false,
      doc_path: "docs/example.md",
      source_hash: "fnv1a32:test",
      source_text_hash: "fnv1a32:text-payload",
      source_text_char_count: "Visible source paragraph.".length,
      chunk_id: "doc-inline:fnv1a32:test:u0001",
      chunk_index: 2,
      lane_session_id: "lane_session:live_translation:docs:fnv1a32:test",
      session_control_key: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
      source_binding_key: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw-US::haw",
      source_identity_key:
        "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload::25::docs::docs_chunk::haw-US::haw",
      latest_source_identity_key:
        "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload-latest::25::docs::docs_chunk::haw-US::haw",
      mail_loop_observation_key:
        "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw-US::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
      receipt_ref: "receipt:doc-inline",
      projection_target: "docs_chunk",
      target_language: "haw",
      account_locale: "haw-US",
      freshness_status: "fresh",
      traffic: {
        accepted_units: 1,
      },
      units: [
        {
          unit_id: "u0001",
          source_markdown: "Visible source paragraph.",
        },
      ],
    });
  });
});
