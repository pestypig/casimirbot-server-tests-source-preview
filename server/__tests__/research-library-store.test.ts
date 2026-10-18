import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { accountSessionRouter } from "../routes/account-session";
import { researchLibraryRouter } from "../routes/research-library";
import { getPool } from "../db/client";
import { resetAccountSessionStore } from "../services/helix-account/account-session-store";
import {
  listResearchLibraryDocuments,
  readResearchLibraryDocument,
  saveResearchLibraryExtraction,
} from "../services/helix-account/research-library-store";
import { runScholarlyFullTextFetch } from "../services/helix-ask/retrieval/scholarly-full-text-fetch";
import { callWorkstationGatewayCapability } from "../services/helix-ask/workstation-tool-gateway/registry";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/account", accountSessionRouter);
  app.use("/api/research-library", researchLibraryRouter);
  return app;
};

const sampleExtraction = (profileId: string) => saveResearchLibraryExtraction({
  profile_id: profileId,
  title: "A private extracted paper",
  source_url: "https://arxiv.org/pdf/2401.12345",
  source_kind: "pdf",
  source_pdf_ref: "artifact://scholarly-pdf/test.pdf",
  source_integrity_hash: "abc123",
  paper_result_id: "arxiv:2401.12345",
  query: "test paper",
  extraction_status: "full_text_usable",
  pages: [
    { page: 1, text: "page one private text", text_char_count: 21, extraction_status: "text", source_text_ref: "artifact://paper#page=1&text" },
    { page: 2, text: "page two private text", text_char_count: 21, extraction_status: "text", source_text_ref: "artifact://paper#page=2&text" },
  ],
});

describe("profile research library", () => {
  beforeEach(async () => {
    await resetAccountSessionStore();
  });

  it("encrypts page text, deduplicates by source hash, and omits raw text from list records", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);

    const first = await sampleExtraction("profile:research-a");
    const second = await sampleExtraction("profile:research-a");
    expect(second.document_id).toBe(first.document_id);

    const list = await listResearchLibraryDocuments("profile:research-a");
    expect(list.documents).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("page one private text");

    const { rows } = await getPool().query<{ encrypted_content: string }>(
      `SELECT encrypted_content FROM helix_research_library_documents WHERE document_id = $1`,
      [first.document_id],
    );
    expect(rows[0].encrypted_content).toMatch(/^v1:/);
    expect(rows[0].encrypted_content).not.toContain("page one private text");

    const response = await agent.get(`/api/research-library/${encodeURIComponent(first.document_id)}`).expect(200);
    expect(response.body.document.pages).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 1, text: "page one private text" }),
    ]));
  });

  it("isolates records by signed-in profile and rejects anonymous reads", async () => {
    const app = createApp();
    const profileA = request.agent(app);
    const profileB = request.agent(app);
    await profileA.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    await profileB.post("/api/account/session/sign-in").send({ profile_id: "profile:research-b", display_name: "Research B" }).expect(200);
    const saved = await sampleExtraction("profile:research-a");

    await profileB.get(`/api/research-library/${encodeURIComponent(saved.document_id)}`).expect(404);
    await request(app).get("/api/research-library").expect(401);
    expect((await readResearchLibraryDocument("profile:research-b", saved.document_id))).toBeNull();
  });

  it("deletes a saved extraction only for its signed-in owner", async () => {
    const app = createApp();
    const profileA = request.agent(app);
    const profileB = request.agent(app);
    await profileA.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    await profileB.post("/api/account/session/sign-in").send({ profile_id: "profile:research-b", display_name: "Research B" }).expect(200);
    const saved = await sampleExtraction("profile:research-a");
    const path = `/api/research-library/${encodeURIComponent(saved.document_id)}`;

    await profileB.delete(path).expect(404);
    const deleted = await profileA.delete(path).expect(200);
    expect(deleted.body).toEqual(expect.objectContaining({
      ok: true,
      document_id: saved.document_id,
    }));
    expect((await listResearchLibraryDocuments("profile:research-a")).documents).toHaveLength(0);
    expect(await readResearchLibraryDocument("profile:research-a", saved.document_id)).toBeNull();
    await profileA.delete(path).expect(404);
  });

  it("persists all extracted pages while keeping the scholarly observation compact", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const observation = await runScholarlyFullTextFetch({
      turnId: "ask:research-library-save",
      callId: "call:research-library-save",
      query: "test extraction",
      sourceUrl: "https://arxiv.org/pdf/2401.12345.pdf",
      cachePdf: false,
      researchLibraryProfileId: "profile:research-a",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
      extractPdfTextImpl: async () => ({
        totalPages: 2,
        pages: [
          { page: 1, text: "first complete extracted page with enough machine-readable prose to establish a usable bounded scholarly text observation for testing" },
          { page: 2, text: "second complete extracted page with enough machine-readable prose to remain durable in the private page-aligned research library" },
        ],
      }),
    });

    expect(observation).toMatchObject({
      evidence_state: "full_text_usable",
      research_library_persistence_status: "saved",
      research_library_document_ref: expect.stringMatching(/^research:/),
      raw_content_included: false,
    });
    expect(observation.page_text_refs.every((page) => !("text" in page))).toBe(true);
    const saved = await readResearchLibraryDocument(
      "profile:research-a",
      observation.research_library_document_ref!,
    );
    expect(saved?.pages.map((page) => page.text)).toEqual([
      "first complete extracted page with enough machine-readable prose to establish a usable bounded scholarly text observation for testing",
      "second complete extracted page with enough machine-readable prose to remain durable in the private page-aligned research library",
    ]);
  });

  it("retires private research content when the owning profile is deleted", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    const saved = await sampleExtraction("profile:research-a");

    await agent.delete("/api/account/profile").expect(200);
    expect(await readResearchLibraryDocument("profile:research-a", saved.document_id)).toBeNull();
  });

  it("materializes bounded saved-page evidence through the read-only workstation gateway", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    await sampleExtraction("profile:research-a");

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:read-saved-paper",
      arguments: {
        source_url: "https://arxiv.org/pdf/2401.12345",
        query: "report the title authors and abstract with page-grounded references",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: "research-library.read_document",
      observation: {
        schema: "helix.research_library_observation.v1",
        evidence_state: "full_text_usable",
        evidence_origin: "profile_research_library",
        selected_for_answer: true,
        selected_pages: expect.arrayContaining([
          expect.objectContaining({ page: 1, source_text_ref: "artifact://paper#page=1&text" }),
        ]),
        raw_content_included: false,
      },
    });
  });

  it("returns an authoritative successful observation for a zero-match saved-text scan", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    await sampleExtraction("profile:research-a");

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:read-saved-paper-zero-match",
      arguments: {
        source_url: "https://arxiv.org/pdf/2401.12345",
        search_term: "deliberately absent phrase",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        evidence_state: "full_text_usable",
        selected_for_answer: true,
        selected_pages: [],
        match_count: 0,
        match_pages: [],
        missing_requirements: [],
        status: "succeeded",
      },
    });
  });

  it("honors explicit case-sensitive saved-text scans", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    const saved = await saveResearchLibraryExtraction({
      profile_id: "profile:research-a",
      title: "Case-sensitive private paper",
      source_url: "https://arxiv.org/pdf/case-sensitive",
      source_kind: "pdf",
      source_pdf_ref: "artifact://scholarly-pdf/case-sensitive.pdf",
      source_integrity_hash: "case-sensitive-hash",
      paper_result_id: "arxiv:case-sensitive",
      query: "case-sensitive paper",
      extraction_status: "full_text_usable",
      pages: [{
        page: 1,
        text: "Wasserstein wasserstein WASSERSTEIN",
        text_char_count: 35,
        extraction_status: "text",
        source_text_ref: "artifact://case-sensitive#page=1&text",
      }],
    });

    const sensitive = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:case-sensitive-scan",
      arguments: { document_id: saved.document_id, search_term: "Wasserstein", case_sensitive: true },
    });
    const insensitive = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:case-insensitive-scan",
      arguments: { document_id: saved.document_id, search_term: "Wasserstein" },
    });

    expect(sensitive.observation).toMatchObject({ match_count: 1, match_pages: [1] });
    expect(insensitive.observation).toMatchObject({ match_count: 3, match_pages: [1] });
  });

  it("resolves a same-saved-paper referent only when the profile library is unambiguous", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    const saved = await sampleExtraction("profile:research-a");

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:read-same-saved-paper",
      arguments: {
        resolve_single_profile_document: true,
        page_start: 2,
        page_end: 2,
        search_term: "page two private text",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        resolved_document_id: saved.document_id,
        selected_for_answer: true,
        selected_pages: [expect.objectContaining({ page: 2 })],
      },
    });
  });

  it("materializes only explicitly listed saved-paper pages", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    const saved = await saveResearchLibraryExtraction({
      profile_id: "profile:research-a",
      title: "A three-page private paper",
      source_url: "https://arxiv.org/pdf/2401.12345",
      source_kind: "pdf",
      source_pdf_ref: "artifact://scholarly-pdf/three-page.pdf",
      source_integrity_hash: "three-page-hash",
      paper_result_id: "arxiv:2401.12345",
      query: "three-page paper",
      extraction_status: "full_text_usable",
      pages: [
        { page: 1, text: "first selected page", text_char_count: 19, extraction_status: "text", source_text_ref: "artifact://three#page=1&text" },
        { page: 2, text: "intervening page", text_char_count: 16, extraction_status: "text", source_text_ref: "artifact://three#page=2&text" },
        { page: 3, text: "third selected page", text_char_count: 19, extraction_status: "text", source_text_ref: "artifact://three#page=3&text" },
      ],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:read-explicit-page-list",
      arguments: { document_id: saved.document_id, page_numbers: [1, 3] },
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        page_numbers: [1, 3],
        selected_pages: [
          expect.objectContaining({ page: 1 }),
          expect.objectContaining({ page: 3 }),
        ],
      },
    });
    expect((result.observation as { selected_pages: Array<{ page: number }> }).selected_pages.map((page) => page.page)).toEqual([1, 3]);
  });

  it("derives exact textual sentence boundaries from the complete saved page", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    const saved = await saveResearchLibraryExtraction({
      profile_id: "profile:research-a",
      title: "A boundary-test private paper",
      source_url: "https://arxiv.org/pdf/boundary-test",
      source_kind: "pdf",
      source_pdf_ref: "artifact://scholarly-pdf/boundary-test.pdf",
      source_integrity_hash: "boundary-test-hash",
      paper_result_id: "arxiv:boundary-test",
      query: "boundary-test paper",
      extraction_status: "full_text_usable",
      pages: [{
        page: 8,
        text: "8 First actual sentence has enough words.\nEquation 1.\nLast actual sentence also has enough words.",
        text_char_count: 105,
        extraction_status: "text",
        source_text_ref: "artifact://boundary-test#page=8&text",
      }],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:read-page-boundaries",
      arguments: {
        document_id: saved.document_id,
        page_start: 8,
        page_end: 8,
        page_boundary_mode: "first_last_nonblank_sentence",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        page_boundary_mode: "first_last_nonblank_sentence",
        selected_pages: [{
          page: 8,
          first_nonblank_sentence: "First actual sentence has enough words.",
          last_nonblank_sentence: "Last actual sentence also has enough words.",
        }],
      },
    });
  });

  it("fails closed when a same-saved-paper referent could identify multiple profile documents", async () => {
    const agent = request.agent(createApp());
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:research-a", display_name: "Research A" }).expect(200);
    await sampleExtraction("profile:research-a");
    await saveResearchLibraryExtraction({
      profile_id: "profile:research-a",
      title: "A second private paper",
      source_url: "https://arxiv.org/pdf/2401.54321",
      source_kind: "pdf",
      source_pdf_ref: "artifact://scholarly-pdf/second.pdf",
      source_integrity_hash: "second-hash",
      paper_result_id: "arxiv:2401.54321",
      query: "second paper",
      extraction_status: "full_text_usable",
      pages: [{ page: 1, text: "second document text", text_char_count: 20, extraction_status: "text", source_text_ref: "artifact://second#page=1&text" }],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-library.read_document",
      profileId: "profile:research-a",
      turnId: "ask:read-ambiguous-saved-paper",
      arguments: { resolve_single_profile_document: true, page_start: 1, page_end: 1 },
    });

    expect(result).toMatchObject({
      ok: false,
      error: "saved_research_referent_ambiguous",
      observation: {
        status: "blocked",
        missing_requirements: ["saved_research_referent_ambiguous"],
      },
    });
  });
});
