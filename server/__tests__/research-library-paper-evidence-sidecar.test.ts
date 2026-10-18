import { describe, expect, it } from "vitest";
import { getPool } from "../db/client";
import { signInLocalAccountSession } from "../services/helix-account/account-session-store";
import {
  applyResearchLibraryEvidenceEnrichment,
  readResearchLibraryDocument,
  saveResearchLibraryExtraction,
} from "../services/helix-account/research-library-store";

describe("Research Library paper evidence sidecars", () => {
  it("persists first-pass paper evidence inside encrypted document content", async () => {
    await signInLocalAccountSession({
      profile_id: "profile:paper-sidecar",
      display_name: "Paper Sidecar",
    });
    const saved = await saveResearchLibraryExtraction({
      profile_id: "profile:paper-sidecar",
      title: "Paper with an equation",
      source_url: "https://example.test/paper-sidecar.pdf",
      source_kind: "pdf",
      source_pdf_ref: "artifact://paper-sidecar.pdf",
      source_integrity_hash: "paper-sidecar-integrity-hash",
      paper_result_id: "paper:test-sidecar",
      query: "paper equation",
      extraction_status: "full_text_usable",
      pages: [{
        page: 3,
        text: "The sampled relation is rho >= -C/tau_0^4.",
        text_char_count: 45,
        extraction_status: "text",
        source_text_ref: "artifact://paper-sidecar.pdf#page=3&text",
      }],
    });

    expect(saved.sidecar_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "paper_evidence", page_start: 3, page_end: 3 }),
    ]));
    const document = await readResearchLibraryDocument("profile:paper-sidecar", saved.document_id);
    expect(document?.paper_evidence_sidecars[0]).toMatchObject({
      schema: "helix.paper_evidence_sidecar.v1",
      document_id: saved.document_id,
      summary: { equation_candidate_count: 1 },
      authority: {
        assistant_answer: false,
        terminal_eligible: false,
        exact_equation_authority: false,
        theory_graph_promotion_allowed: false,
      },
    });

    const { rows } = await getPool().query<{ encrypted_content: string }>(
      `SELECT encrypted_content FROM helix_research_library_documents WHERE document_id = $1`,
      [saved.document_id],
    );
    expect(rows[0]?.encrypted_content).not.toContain("rho >= -C/tau_0^4");
  });

  it("persists one revision, rejects stale writes, and makes proposal replay idempotent", async () => {
    await signInLocalAccountSession({
      profile_id: "profile:paper-enrichment",
      display_name: "Paper Enrichment",
    });
    const sourceTextRef = "artifact://paper-enrichment.pdf#page=4&text";
    const saved = await saveResearchLibraryExtraction({
      profile_id: "profile:paper-enrichment",
      title: "Paper enrichment",
      source_url: "https://example.test/paper-enrichment.pdf",
      source_kind: "pdf",
      source_integrity_hash: "paper-enrichment-integrity-hash",
      extraction_status: "full_text_usable",
      pages: [{
        page: 4,
        text: "The sampled relation is rho >= -C/tau_0^4.",
        text_char_count: 45,
        extraction_status: "text",
        source_text_ref: sourceTextRef,
      }],
    });
    const proposal = {
      schema: "helix.paper_evidence_enrichment_proposal.v1",
      proposal_id: "proposal:persistence:eq1",
      document_id: saved.document_id,
      sidecar_id: `${saved.document_id}:paper-evidence:v1`,
      source_integrity_hash: "paper-enrichment-integrity-hash",
      expected_revision: 1,
      agent_authored: true,
      equation_updates: [{
        equation_id: "paper-equation:p4:l1",
        classification: "bound",
        normalized_latex: "\\rho \\geq -C/\\tau_0^4",
        evidence_depth: "page_grounded",
        symbol_bindings: [{
          symbol: "\\rho",
          meaning: "sampled energy density",
          value: null,
          unit: null,
          basis: "paper",
          source_refs: [sourceTextRef],
          inference_note: null,
          confidence: 0.9,
        }],
        assumptions: [],
        calculator: {
          prefill_expression: "rho >= -C/tau_0^4",
          bound_expression: null,
          missing_variables: ["rho", "C", "tau_0"],
          auto_run_allowed: false,
        },
        exact_equation_authority_requested: false,
      }],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };

    const applied = await applyResearchLibraryEvidenceEnrichment({
      profile_id: "profile:paper-enrichment",
      document_id: saved.document_id,
      proposal,
    });
    expect(applied).toMatchObject({ ok: true, status: "applied", from_revision: 1, to_revision: 2 });
    const replay = await applyResearchLibraryEvidenceEnrichment({
      profile_id: "profile:paper-enrichment",
      document_id: saved.document_id,
      proposal,
    });
    expect(replay).toMatchObject({ ok: true, status: "idempotent", to_revision: 2 });
    const stale = await applyResearchLibraryEvidenceEnrichment({
      profile_id: "profile:paper-enrichment",
      document_id: saved.document_id,
      proposal: { ...proposal, proposal_id: "proposal:stale" },
    });
    expect(stale).toMatchObject({ ok: false, failure_code: "paper_evidence_enrichment_stale_revision" });
    await saveResearchLibraryExtraction({
      profile_id: "profile:paper-enrichment",
      title: "Paper enrichment fetched again",
      source_url: "https://example.test/paper-enrichment.pdf",
      source_kind: "pdf",
      source_integrity_hash: "paper-enrichment-integrity-hash",
      extraction_status: "full_text_usable",
      pages: [{
        page: 4,
        text: "The sampled relation is rho >= -C/tau_0^4.",
        text_char_count: 45,
        extraction_status: "text",
        source_text_ref: sourceTextRef,
      }],
    });
    const document = await readResearchLibraryDocument("profile:paper-enrichment", saved.document_id);
    expect(document?.paper_evidence_sidecars[0]).toMatchObject({
      revision: 2,
      enrichment: { agent_enrichment_status: "applied", last_proposal_id: "proposal:persistence:eq1" },
    });
  });
});
