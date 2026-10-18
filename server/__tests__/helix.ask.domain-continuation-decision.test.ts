import { describe, expect, it } from "vitest";

import { buildHelixDomainContinuationDecision } from "../services/helix-ask/domain-continuation-decision";

const buildDecision = (prompt: string, payload: Record<string, unknown>) =>
  buildHelixDomainContinuationDecision({
    turnId: "ask:domain-continuation",
    prompt,
    payload,
  });

const suggestedAction = (decision: ReturnType<typeof buildDecision>) =>
  decision.recommended_capability_hint?.suggested_action;

describe("helix ask domain continuation decision", () => {
  it("continues docs-panel goals when the observed artifact is only active document identity", () => {
    const decision = buildDecision("Okay, can you open up the Docs panel?", {
      canonical_goal_frame: { goal_kind: "panel_control", required_terminal_kind: "workspace_action_receipt" },
      source_target_intent: { explicit_cues: ["docs_panel_open"] },
      terminal_artifact_kind: "active_doc_identity",
      current_turn_artifact_ledger: [
        {
          kind: "active_doc_identity",
          payload: { active_doc_path: "/docs/research/nhm2-current-status-whitepaper.md" },
        },
      ],
    });

    expect(decision.decision).toBe("continue");
    expect(decision.reason).toBe("docs_panel_open_requires_docs_viewer_open_action");
    expect(decision.schema).toBe("helix.domain_continuation_hint.v1");
    expect(decision.recommended_capability_hint?.authority).toBe("hint_only_agent_must_decide");
    expect(suggestedAction(decision)).toEqual(
      expect.objectContaining({ panel_id: "docs-viewer", action_id: "open" }),
    );
  });

  it("continues doc opening from search results to candidate validation", () => {
    const decision = buildDecision("Open the NHM-2 white paper from the docs.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "doc_open_best" },
      },
      current_turn_artifact_ledger: [
        {
          kind: "doc_search_results",
          payload: {
            query: "NHM-2 whitepaper",
            matches: [{ path: "/docs/research/nhm2-current-status-whitepaper.md" }],
          },
        },
      ],
    });

    expect(decision.decision).toBe("continue");
    expect(decision.reason).toBe("doc_search_candidates_require_validation");
    expect(suggestedAction(decision)).toEqual(
      expect.objectContaining({ panel_id: "docs-viewer", action_id: "validate_doc_candidates" }),
    );
    expect(suggestedAction(decision)?.args).toEqual(
      expect.objectContaining({ query: "NHM-2 whitepaper", transcript: "Open the NHM-2 white paper from the docs." }),
    );
  });

  it("exposes docs-summary search-to-validation as a model-visible required-next contract", () => {
    const decision = buildDecision(
      "Open the Helix Ask Codex parity model turn fidelity audit doc and summarize the remaining parity gap.",
      {
        goal_satisfaction_evaluation: {
          terminal_contract: { goal_kind: "doc_summary" },
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: "ask:test:doc_search_results",
            kind: "doc_search_results",
            payload: {
              query: "Helix Ask Codex parity model turn fidelity audit",
              matches: [{ path: "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md" }],
            },
          },
        ],
      },
    );

    expect(decision.decision).toBe("continue");
    expect(decision.reason).toBe("doc_summary_search_candidates_require_validation");
    expect(decision.docs_continuation_contract).toMatchObject({
      schema: "helix.docs_continuation_contract.v1",
      current_docs_phase: "candidate_validation_required",
      prior_observation_kind: "doc_search_results",
      required_next_capability: "docs-viewer.validate_doc_candidates",
      forbidden_repeated_capabilities: ["docs-viewer.search_docs"],
      expected_next_artifact: "doc_candidate_validation",
      terminal_block_reason_if_missing: "doc_candidate_validation missing",
    });
    expect(decision.docs_continuation_contract?.model_visible_instruction).toContain("Do not call docs-viewer.search_docs again");
  });

  it("exposes docs-summary validation-to-open and open-to-summary phases", () => {
    const path = "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md";
    const openDecision = buildDecision("Summarize the remaining parity gap in the audit doc.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "doc_summary" },
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test:doc_candidate_validation",
          kind: "doc_candidate_validation",
          payload: {
            query: "Helix Ask Codex parity model turn fidelity audit",
            selected_status: "strong",
            selected_path: path,
          },
        },
      ],
    });
    expect(openDecision.docs_continuation_contract).toMatchObject({
      current_docs_phase: "open_validated_doc_required",
      required_next_capability: "docs-viewer.open_doc_by_path",
      forbidden_repeated_capabilities: ["docs-viewer.search_docs", "docs-viewer.validate_doc_candidates"],
      expected_next_artifact: "active_doc_path",
    });

    const summaryDecision = buildDecision("Summarize the remaining parity gap in the audit doc.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "doc_summary" },
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test:doc_candidate_validation",
          kind: "doc_candidate_validation",
          payload: {
            selected_status: "strong",
            selected_path: path,
          },
        },
        {
          artifact_id: "ask:test:doc_open_receipt",
          kind: "doc_open_receipt",
          payload: {
            status: "opened",
            path,
          },
        },
      ],
    });
    expect(summaryDecision.docs_continuation_contract).toMatchObject({
      current_docs_phase: "summary_required",
      required_next_capability: "docs-viewer.summarize_doc",
      forbidden_repeated_capabilities: ["docs-viewer.search_docs", "docs-viewer.validate_doc_candidates", "docs-viewer.open_doc_by_path"],
      expected_next_artifact: "doc_summary",
    });
  });

  it("allows Codex synthesis after opened document content re-enters as bounded retrieval evidence", () => {
    const path = "/docs/research/casimir-dp-quantum-foam-study.md";
    const decision = buildDecision("Read the best result and explain what it is about.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "doc_summary" },
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test:doc_search_results",
          kind: "doc_search_results",
          payload: {
            query: "Casimir Dp Quantum Foam Study",
            matches: [{ path }],
          },
        },
        {
          artifact_id: "ask:test:doc_candidate_validation",
          kind: "doc_candidate_validation",
          payload: {
            selected_status: "strong",
            selected_path: path,
          },
        },
        {
          artifact_id: "ask:test:doc_open_receipt",
          kind: "doc_open_receipt",
          payload: {
            status: "opened",
            path,
          },
        },
        {
          artifact_id: "ask:test:retrieval_context",
          kind: "retrieval_context",
          payload: {
            path,
            excerpt: "The study keeps Casimir, Diósi-Penrose, and manifold-response claims in separate evidence lanes.",
          },
        },
      ],
    });

    expect(decision.decision).toBe("none");
    expect(decision.reason).toBe("doc_summary_has_terminal_artifact");
    expect(decision.docs_continuation_contract).toMatchObject({
      current_docs_phase: "terminal_ready",
      required_next_capability: null,
      terminal_block_reason_if_missing: null,
    });
  });

  it("continues doc opening from strong validation to open_doc_by_path", () => {
    const decision = buildDecision("Open the NHM-2 white paper from the docs.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "doc_open_best" },
      },
      current_turn_artifact_ledger: [
        {
          kind: "doc_candidate_validation",
          payload: {
            query: "NHM-2 whitepaper",
            selected_status: "strong",
            selected_path: "/docs/research/nhm2-current-status-whitepaper.md",
          },
        },
      ],
    });

    expect(decision.decision).toBe("continue");
    expect(decision.reason).toBe("validated_doc_candidate_requires_open");
    expect(suggestedAction(decision)).toEqual(
      expect.objectContaining({
        panel_id: "docs-viewer",
        action_id: "open_doc_by_path",
        args: expect.objectContaining({ path: "/docs/research/nhm2-current-status-whitepaper.md" }),
      }),
    );
  });

  it("retries doc opening when the opened path does not match the validated candidate", () => {
    const decision = buildDecision("Open the NHM-2 white paper from the docs.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "doc_open_best" },
      },
      current_turn_artifact_ledger: [
        {
          kind: "doc_candidate_validation",
          payload: {
            query: "NHM-2 whitepaper",
            selected_status: "strong",
            selected_path: "/docs/research/nhm2-current-status-whitepaper.md",
          },
        },
        {
          kind: "doc_open_receipt",
          payload: {
            path: "/docs/research/nhm2-current-status-whitepaper-2026-04-03.md",
            status: "opened",
          },
        },
      ],
    });

    expect(decision.decision).toBe("retry");
    expect(decision.reason).toBe("doc_open_path_mismatch_retry_selected_path");
    expect(suggestedAction(decision)?.args).toEqual(
      expect.objectContaining({
        path: "/docs/research/nhm2-current-status-whitepaper.md",
        previous_opened_path: "/docs/research/nhm2-current-status-whitepaper-2026-04-03.md",
      }),
    );
  });

  it("continues doc location goals when active doc context exists but locate has not run", () => {
    const decision = buildDecision("Find lapse shift in the current doc.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "doc_evidence_location" },
      },
      workspace_context_snapshot: {
        activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
      },
    });

    expect(decision.decision).toBe("continue");
    expect(decision.reason).toBe("active_doc_context_requires_locate_in_doc");
    expect(suggestedAction(decision)).toEqual(
      expect.objectContaining({
        panel_id: "docs-viewer",
        action_id: "locate_in_doc",
        args: expect.objectContaining({
          path: "/docs/research/nhm2-current-status-whitepaper.md",
          query: "lapse shift",
        }),
      }),
    );
  });

  it("fails closed for visual describe goals when no visual source is available", () => {
    const decision = buildDecision("Describe what you see in the live capture.", {
      canonical_goal_frame: { goal_kind: "model_only_concept" },
    });

    expect(decision.decision).toBe("typed_failure");
    expect(decision.typed_failure_code).toBe("visual_evidence_missing");
  });

  it("creates a typed repair candidate when visual source identity exists but field evaluations are missing", () => {
    const decision = buildDecision("Describe what you see in the live capture.", {
      canonical_goal_frame: { goal_kind: "situation_context_question" },
      live_source_identity_audit: {
        diagnosis: "field_evaluations_missing",
      },
    });

    expect(decision.decision).toBe("continue");
    expect(decision.reason).toBe("visual_source_requires_field_evaluations");
    expect(decision.repair_candidate).toEqual(
      expect.objectContaining({ capability: "situation-room.run_field_evaluations" }),
    );
  });

  it("treats screen-review prompts with negated interval language as visual content, not live control", () => {
    const decision = buildDecision(
      "Can you review what is happening in the screen capture? I haven't started the interval 10 seconds yet.",
      {
        canonical_goal_frame: { goal_kind: "live_pipeline_control" },
        live_source_identity_audit: {
          diagnosis: "field_evaluations_missing",
        },
      },
    );

    expect(decision.goal_kind).toBe("visual_capture_describe");
    expect(decision.decision).toBe("continue");
    expect(decision.reason).toBe("visual_source_requires_field_evaluations");
    expect(decision.recommended_capability_hint).toBeUndefined();
  });

  it("does not continue visual content goals after observation and field evaluation evidence are present", () => {
    const decision = buildDecision("Describe what you see in the live capture.", {
      goal_satisfaction_evaluation: {
        terminal_contract: { goal_kind: "visual_capture_describe" },
      },
      current_turn_artifact_ledger: [
        {
          kind: "situation_context_pack",
          payload: {
            selected_observation_refs: ["observation:current"],
            selected_field_evaluation_refs: ["field_eval:activity"],
          },
        },
      ],
    });

    expect(decision.decision).toBe("none");
    expect(decision.reason).toBe("visual_evidence_already_satisfies_content_goal");
  });
});
