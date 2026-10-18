import { describe, expect, it } from "vitest";

import {
  HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
} from "@shared/helix-paper-evidence-enrichment";
import {
  buildHelixAccountCapabilityPolicy,
  resolveHelixWorkstationCapabilityAccess,
} from "@shared/helix-account-session";
import { signInLocalAccountSession } from "../services/helix-account/account-session-store";
import { saveResearchLibraryExtraction } from "../services/helix-account/research-library-store";
import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../services/helix-ask/workstation-tool-gateway/registry";
import {
  buildCodexNormalizedObservationArtifacts,
  codexProvider,
  enrichCapabilityLaneCandidatesFromBody,
} from "../services/helix-ask/agent-providers/codex-provider";
import { hasSelectedCapabilityObservation } from "../services/helix-ask/runtime-authority-contract";
import { runHelixCapabilityLaneOneShotRequests } from "../services/helix-ask/capability-lanes/one-shot-runner";

describe("Research Library enrichment gateway", () => {
  it("is developer-visible, user-locked, mutating, and non-terminal", () => {
    const developer = listWorkstationGatewayCapabilities({ mode: "act", accountType: "developer" });
    const manifest = developer.capabilities.find(
      (candidate) => candidate.capability_id === HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
    );
    expect(manifest).toMatchObject({
      mode: "act",
      mutating: true,
      permission_profile_required: "act",
      terminal_eligible: false,
      post_tool_model_step_required: true,
    });
    expect(resolveHelixWorkstationCapabilityAccess(
      buildHelixAccountCapabilityPolicy("user"),
      {
        capability_id: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
        permission_profile_required: "act",
      },
    )).toMatchObject({ state: "locked", reason: "capability_outside_account_policy" });
  });

  it("persists an admitted proposal as observation-only evidence requiring model re-entry", async () => {
    const profileId = "profile:enrichment-gateway";
    await signInLocalAccountSession({ profile_id: profileId, display_name: "Enrichment Gateway" });
    const sourceTextRef = "artifact://gateway-paper.pdf#page=2&text";
    const saved = await saveResearchLibraryExtraction({
      profile_id: profileId,
      title: "Gateway paper",
      source_url: "https://example.test/gateway-paper.pdf",
      source_kind: "pdf",
      source_integrity_hash: "gateway-paper-hash",
      extraction_status: "full_text_usable",
      pages: [{
        page: 2,
        text: "The relation is E = mc^2.",
        text_char_count: 25,
        extraction_status: "text",
        source_text_ref: sourceTextRef,
      }],
    });
    const readResult = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      accountType: "developer",
      profileId,
      capabilityId: "research-library.read_document",
      turnId: "ask:enrichment-read",
      iteration: 1,
      arguments: { document_id: saved.document_id, page_numbers: [2] },
    });
    expect(readResult).toMatchObject({
      ok: true,
      observation: {
        paper_evidence_sidecars: [{
          sidecar_id: `${saved.document_id}:paper-evidence:v1`,
          revision: 1,
          equation_candidates: [{ equation_id: "paper-equation:p2:l1" }],
          raw_content_included: false,
        }],
      },
    });
    expect((readResult.observation as Record<string, unknown>).document).not.toHaveProperty(
      "paper_evidence_sidecars",
    );
    expect(JSON.stringify(readResult.observation)).not.toContain('"raw_content_included":true');
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      accountType: "developer",
      profileId,
      capabilityId: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
      turnId: "ask:enrichment-gateway",
      iteration: 1,
      arguments: {
        document_id: saved.document_id,
        proposal: {
          schema: "helix.paper_evidence_enrichment_proposal.v1",
          proposal_id: "proposal:gateway:eq1",
          document_id: saved.document_id,
          sidecar_id: `${saved.document_id}:paper-evidence:v1`,
          source_integrity_hash: "gateway-paper-hash",
          expected_revision: 1,
          agent_authored: true,
          equation_updates: [{
            equation_id: "paper-equation:p2:l1",
            classification: "definition",
            normalized_latex: "E = mc^2",
            evidence_depth: "page_grounded",
            symbol_bindings: [{
              symbol: "E",
              meaning: "rest energy",
              value: null,
              unit: "J",
              basis: "paper",
              source_refs: [sourceTextRef],
              inference_note: null,
              confidence: 0.9,
            }],
            assumptions: [],
            calculator: {
              prefill_expression: "E = m*c^2",
              bound_expression: null,
              missing_variables: ["E", "m", "c"],
              auto_run_allowed: false,
            },
            exact_equation_authority_requested: false,
          }],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      observation: {
        schema: "helix.paper_evidence_enrichment_observation.v1",
        status: "applied",
        from_revision: 1,
        to_revision: 2,
        authority: {
          exact_equation_authority: false,
          calculator_auto_run_allowed: false,
          theory_graph_promotion_allowed: false,
        },
      },
    });

    const normalized = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:enrichment-gateway",
      gatewayCallResults: [result],
    });
    expect(normalized.missingNormalizationFailures).toEqual([]);
    expect(normalized.artifacts).toHaveLength(1);
    expect(normalized.artifacts[0]).toMatchObject({
      kind: "paper_evidence_enrichment_observation",
      payload_schema: "helix.paper_evidence_enrichment_observation.v1",
      capability_key: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
      payload: {
        schema: "helix.paper_evidence_enrichment_observation.v1",
        kind: "paper_evidence_enrichment_observation",
        status: "applied",
        from_revision: 1,
        to_revision: 2,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    const normalizedRef = normalized.artifacts[0]?.artifact_id as string;
    expect(hasSelectedCapabilityObservation({
      agent_runtime_loop: {
        iterations: [{
          chosen_capability: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
          observed_artifact_refs: [normalizedRef],
        }],
      },
      current_turn_artifact_ledger: normalized.artifacts,
    })).toBe(true);

    const laneCandidate = enrichCapabilityLaneCandidatesFromBody(
      { research_library_owner_id: profileId },
      {
        capability: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
        profile_id: "profile:untrusted-model-choice",
        document_id: saved.document_id,
        proposal: (result.observation as Record<string, unknown>).proposal ?? {
          schema: "helix.paper_evidence_enrichment_proposal.v1",
          proposal_id: "proposal:gateway:eq1",
          document_id: saved.document_id,
          sidecar_id: `${saved.document_id}:paper-evidence:v1`,
          source_integrity_hash: "gateway-paper-hash",
          expected_revision: 1,
          agent_authored: true,
          equation_updates: [{
            equation_id: "paper-equation:p2:l1",
            classification: "definition",
            normalized_latex: "E = mc^2",
            evidence_depth: "page_grounded",
            symbol_bindings: [{
              symbol: "E",
              meaning: "rest energy",
              value: null,
              unit: "J",
              basis: "paper",
              source_refs: [sourceTextRef],
              inference_note: null,
              confidence: 0.9,
            }],
            assumptions: [],
            calculator: {
              prefill_expression: "E = m*c^2",
              bound_expression: null,
              missing_variables: ["E", "m", "c"],
              auto_run_allowed: false,
            },
            exact_equation_authority_requested: false,
          }],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    ) as Record<string, unknown>;
    expect(laneCandidate.profile_id).toBe(profileId);
    const laneResult = await runHelixCapabilityLaneOneShotRequests({
      provider: codexProvider,
      body: {
        turn_id: "ask:enrichment-lane",
        capability_lane_call: laneCandidate,
      },
      env: {} as NodeJS.ProcessEnv,
    });
    expect(laneResult.call_results).toHaveLength(1);
    expect(laneResult.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.gateway_bridge_result.v1",
      ok: true,
      capability: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
      delegated_capability_id: HELIX_RESEARCH_LIBRARY_APPLY_EVIDENCE_ENRICHMENT_CAPABILITY,
      delegation_status: "gateway_executed",
      observation: {
        schema: "helix.paper_evidence_enrichment_observation.v1",
        status: "idempotent",
      },
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
