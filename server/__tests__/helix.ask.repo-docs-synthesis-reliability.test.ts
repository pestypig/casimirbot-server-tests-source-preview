import { describe, expect, it } from "vitest";

import {
  attachSynthesisSupportRefs,
  buildRepoDocsSynthesisRepairInstruction,
  buildRepoDocsSynthesisPacket,
  classifyRepoDocsSynthesisAttemptStatus,
  repoDocsSynthesisTerminalErrorCode,
} from "../services/helix-ask/repo-docs-synthesis-packet";
import { evaluateRepoAnswerTextQualityGate } from "../services/helix-ask/repo-answer-text-quality-gate";
import { evaluateRepoEvidenceRelevanceGate } from "../services/helix-ask/repo-evidence-relevance-gate";
import { getHelixCausalTurnTimeline } from "../services/helix-ask/causal-turn-timeline";

const turnId = "ask:test:repo-docs-synthesis";

const dottieObservation = {
  schema: "helix.repo_code_evidence_observation.v1",
  artifact_id: `${turnId}:repo_code_evidence_observation`,
  turn_id: turnId,
  concept: "Auntie Dottie",
  query: "What is Auntie Dottie in this app?",
  evidence_refs: [
    "shared/helix-dottie-manifest-preset.ts:1-80",
    "server/services/situation-room/dottie-manifest-preset.ts:1-80",
  ],
  observations: [],
  spans: [
    {
      ref: "shared/helix-dottie-manifest-preset.ts:1-80",
      path: "shared/helix-dottie-manifest-preset.ts",
      start_line: 1,
      end_line: 80,
      sanitized_excerpt: "Dottie manifest presets describe observer subscriptions, commentary policy, and child artifact refs for Dottie setup.",
      reason: "Defines the Dottie manifest/preset contract.",
      source_kind: "repo_code",
      score: 42,
    },
    {
      ref: "shared/workstation-dynamic-tools.ts:100-160",
      path: "shared/workstation-dynamic-tools.ts",
      start_line: 100,
      end_line: 160,
      sanitized_excerpt: "Situation Room pipeline actions expose Dottie observer creation and voice delivery proposal capabilities.",
      reason: "Shows Dottie as workstation/Situation Room capabilities.",
      source_kind: "repo_code",
      score: 37,
    },
    {
      ref: "docs/helix-ask-agent-policy.md:20-45",
      path: "docs/helix-ask-agent-policy.md",
      start_line: 20,
      end_line: 45,
      sanitized_excerpt: "Voice delivery proposal is not speech; confirm_speak is required before spoken output.",
      reason: "Defines voice/terminal authority policy for Dottie-like commentary.",
      source_kind: "repo_doc",
      score: 31,
    },
  ],
  selected_for_answer: true,
  assistant_answer: false,
  raw_content_included: false,
};

const ledger = [
  {
    artifact_id: dottieObservation.artifact_id,
    kind: "repo_code_evidence_observation",
    payload: dottieObservation,
  },
];

describe("repo/docs synthesis reliability", () => {
  it("builds compact synthesis packets from repo evidence observations", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
      maxEvidenceItems: 2,
    });

    expect(packet.schema).toBe("helix.repo_docs_synthesis_packet.v1");
    expect(packet.compact_evidence.length).toBeLessThanOrEqual(2);
    expect(packet.source_observation_refs).toContain(dottieObservation.artifact_id);
    expect(packet.answer_contract).toMatchObject({
      required_model_step_capability: "model.synthesize_from_repo_evidence",
      required_terminal_kind: "repo_code_evidence_answer",
      must_not_emit_file_inventory: true,
    });
    expect(packet.answer_depth_contract).toMatchObject({
      depth_mode: "internal_concept_overview",
      min_word_count: expect.any(Number),
      required_coverage_points: expect.arrayContaining(["identity", "responsibilities", "workflow_or_surfaces"]),
    });
    expect(packet.model_instruction).toMatch(/Explain what the evidence means/i);
    expect(packet.model_instruction).toMatch(/internal concept overview/i);
    expect(packet.assistant_answer).toBe(false);
    expect(packet.raw_content_included).toBe(false);
  });

  it("prefers path-diverse compact evidence before repeated spans from the same file", () => {
    const observation = {
      ...dottieObservation,
      evidence_refs: [
        "server/services/helix-ask/workstation-tool-planner.ts:1-20",
        "server/services/helix-ask/workstation-tool-planner.ts:21-40",
        "server/services/helix-ask/workstation-tool-planner.ts:41-60",
        "client/src/lib/workstation/panelActionAdapters.ts:1-30",
      ],
      spans: [
        {
          ref: "server/services/helix-ask/workstation-tool-planner.ts:1-20",
          path: "server/services/helix-ask/workstation-tool-planner.ts",
          sanitized_excerpt: "Dottie observer runtime planning behavior.",
          reason: "first runtime span",
          source_kind: "repo_code",
        },
        {
          ref: "server/services/helix-ask/workstation-tool-planner.ts:21-40",
          path: "server/services/helix-ask/workstation-tool-planner.ts",
          sanitized_excerpt: "More Dottie observer runtime planning behavior.",
          reason: "second runtime span",
          source_kind: "repo_code",
        },
        {
          ref: "server/services/helix-ask/workstation-tool-planner.ts:41-60",
          path: "server/services/helix-ask/workstation-tool-planner.ts",
          sanitized_excerpt: "More Dottie observer runtime planning behavior.",
          reason: "third runtime span",
          source_kind: "repo_code",
        },
        {
          ref: "client/src/lib/workstation/panelActionAdapters.ts:1-30",
          path: "client/src/lib/workstation/panelActionAdapters.ts",
          sanitized_excerpt: "Dottie manifest panel action adapter capability.",
          reason: "adapter capability span",
          source_kind: "repo_code",
        },
      ],
    };
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: [
        {
          artifact_id: observation.artifact_id,
          kind: "repo_code_evidence_observation",
          payload: observation,
        },
      ],
      maxEvidenceItems: 3,
    });

    expect(new Set(packet.compact_evidence.map((entry) => entry.path)).size).toBeGreaterThan(1);
    expect(packet.compact_evidence.map((entry) => entry.path)).toContain("client/src/lib/workstation/panelActionAdapters.ts");
  });

  it("attaches support refs from the packet so valid prose can pass the repo quality gate", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
    });
    const draft = attachSynthesisSupportRefs({
      draft: {
        schema: "helix.final_answer_draft.v1",
        text: "Auntie Dottie is a Situation Room/Helix Ask construct for setting up Dottie observer/commentary behavior from evidence and policy. The repo evidence shows manifest presets, workstation capabilities, and voice policy, including that voice delivery is proposed first and requires confirmation before speech.",
        artifact_refs: [],
        model_step_capability: "model.synthesize_from_repo_evidence",
        authority: "llm_post_observation_composer",
      },
      packet,
      observation: dottieObservation,
    });
    const payload = {
      final_answer_draft: draft,
      repo_code_evidence_answer: {
        schema: "helix.repo_code_evidence_answer.v1",
        artifact_id: `${turnId}:repo_code_evidence_answer`,
        answer_text: draft.text,
        model_authored: true,
        model_step_capability: "model.synthesize_from_repo_evidence",
        synthesis_attempt_ref: `${turnId}:repo_evidence_synthesis_attempt`,
        support_refs: draft.support_refs,
      },
      current_turn_artifact_ledger: [
        ...ledger,
        {
          artifact_id: `${turnId}:repo_evidence_synthesis_attempt`,
          kind: "repo_evidence_synthesis_attempt",
          payload: {
            schema: "helix.repo_evidence_synthesis_attempt.v1",
            model_step_capability: "model.synthesize_from_repo_evidence",
          },
        },
      ],
    };

    const gate = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: `${turnId}:repo_code_evidence_answer`,
      answerText: draft.text,
      payload,
    });

    expect(draft.support_refs.length).toBeGreaterThan(0);
    expect(gate.ok).toBe(true);
    expect(gate.violations).toEqual([]);
  });

  it("accepts substantive Dottie prose even when compact source refs are multiline", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
    });
    const answerText = [
      "Auntie Dottie in this app is a Dottie/Situation Room observer preset for public commentary and evidence, not a separate assistant runtime. Its responsibility is to attach a witness profile to selected Helix Ask or Situation Room activity, watch eligible public traces, and package observer, commentary, and voice proposal receipts as evidence. The workflow crosses the manifest contract, workstation capability surface, and policy lane: Dottie can observe and propose voice output, but confirmation and terminal answer authority stay outside the receipt itself. That boundary matters because receipts support the model's later synthesis; they do not authorize the final visible answer.",
      "",
      "Sources:",
      "- shared/helix-dottie-manifest-preset.ts:111",
      "- shared/helix-dottie-manifest-preset.ts:114",
      "- shared/workstation-dynamic-tools.ts:142",
      "- docs/helix-ask-agent-policy.md:32",
    ].join("\n");
    const payload = {
      repo_docs_synthesis_packet: packet,
      repo_code_evidence_answer: {
        schema: "helix.repo_code_evidence_answer.v1",
        support_refs: packet.compact_evidence.map((entry) => entry.ref),
        model_authored: true,
        model_step_capability: "model.synthesize_from_repo_evidence",
        synthesis_attempt_ref: `${turnId}:repo_evidence_synthesis_attempt`,
      },
      final_answer_draft: {
        authority: "llm_post_observation_composer",
        model_step_capability: "model.synthesize_from_repo_evidence",
        artifact_refs: packet.compact_evidence.map((entry) => entry.ref),
      },
      current_turn_artifact_ledger: [
        ...ledger,
        {
          artifact_id: `${turnId}:repo_evidence_synthesis_attempt`,
          kind: "repo_evidence_synthesis_attempt",
          payload: {
            schema: "helix.repo_evidence_synthesis_attempt.v1",
            model_step_capability: "model.synthesize_from_repo_evidence",
          },
        },
      ],
    };

    const gate = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: "candidate:dottie-prose-with-sources",
      answerText,
      payload,
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).not.toContain("excerpt_like_answer");
    expect(gate.violations).not.toContain("file_list_only");
  });

  it("builds exact-section contracts for requested field lists", () => {
    const exactTurnId = "ask:test:shared-tool-boundary-exact-section";
    const observation = {
      schema: "helix.repo_code_evidence_observation.v1",
      artifact_id: `${exactTurnId}:repo_code_evidence_observation`,
      turn_id: exactTurnId,
      concept: "Shared Tool Family Boundary",
      evidence_refs: ["docs/helix-ask-codex-loop-discipline.md:171-194"],
      spans: [
        {
          ref: "docs/helix-ask-codex-loop-discipline.md:171-194",
          path: "docs/helix-ask-codex-loop-discipline.md",
          source_kind: "repo_doc",
          sanitized_excerpt: [
            "## Shared Tool Family Boundary",
            "Required fields for a tool-family patch:",
            "source_target_intent",
            "tool_call_admission_decision",
            "agent_step_decision",
            "runtime_tool_call",
            "agent_step_observation_packet",
            "goal_satisfaction_evaluation",
            "final_answer_draft | request_user_input | typed_failure",
            "route_product_contract",
            "product_authority_guard",
            "terminal_answer_authority",
            "terminal_authority_single_writer",
            "terminal_presentation",
          ].join("\n"),
          reason: "Exact heading block lists the shared tool-family fields.",
        },
      ],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    };

    const packet = buildRepoDocsSynthesisPacket({
      turnId: exactTurnId,
      promptText:
        'Read repo path docs/helix-ask-codex-loop-discipline.md. Find the heading "Shared Tool Family Boundary". List the required fields under that heading.',
      routeFamily: "repo_evidence",
      artifactLedger: [{ artifact_id: observation.artifact_id, kind: "repo_code_evidence_observation", payload: observation }],
    });

    expect(packet.exact_section_contract).toMatchObject({
      contract_kind: "field_list",
      requested_path: "docs/helix-ask-codex-loop-discipline.md",
      requested_heading: "Shared Tool Family Boundary",
      extraction_status: "found",
      evidence_missing: false,
    });
    expect(packet.source_target_exact_contract).toMatchObject({
      schema: "helix.source_target_exact_contract.v1",
      requested_source_kind: "repo_heading_section",
      requested_source_identity: "docs/helix-ask-codex-loop-discipline.md#Shared Tool Family Boundary",
      extraction_status: "found",
      terminal_allowed: true,
      assistant_answer: false,
    });
    expect(packet.source_target_exact_contract?.evidence_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(packet.exact_section_contract?.required_terms).toEqual(
      expect.arrayContaining([
        "source_target_intent",
        "tool_call_admission_decision",
        "agent_step_observation_packet",
        "terminal_authority_single_writer",
      ]),
    );
  });

  it("supplements weak retrieval with the requested repo heading section", () => {
    const exactTurnId = "ask:test:shared-tool-boundary-file-fallback";
    const weakObservation = {
      schema: "helix.repo_code_evidence_observation.v1",
      artifact_id: `${exactTurnId}:repo_code_evidence_observation`,
      turn_id: exactTurnId,
      concept: "Shared Tool Family Boundary",
      evidence_refs: ["docs/helix-ask-codex-loop-discipline.md"],
      spans: [
        {
          ref: "docs/helix-ask-codex-loop-discipline.md:1",
          path: "docs/helix-ask-codex-loop-discipline.md",
          source_kind: "repo_doc",
          sanitized_excerpt: "The loop discipline document describes Codex and Helix Ask ownership boundaries.",
          reason: "Weak retrieval hit for the correct document.",
        },
      ],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    };

    const packet = buildRepoDocsSynthesisPacket({
      turnId: exactTurnId,
      promptText:
        'Read repo path docs/helix-ask-codex-loop-discipline.md. Find the heading "Shared Tool Family Boundary". List the required fields under that heading.',
      routeFamily: "repo_evidence",
      artifactLedger: [{ artifact_id: weakObservation.artifact_id, kind: "repo_code_evidence_observation", payload: weakObservation }],
    });

    expect(packet.compact_evidence[0]?.ref).toMatch(/docs\/helix-ask-codex-loop-discipline\.md:\d+-\d+/);
    expect(packet.exact_section_contract?.evidence_missing).toBe(false);
    expect(packet.source_target_exact_contract).toMatchObject({
      requested_source_identity: "docs/helix-ask-codex-loop-discipline.md#Shared Tool Family Boundary",
      extraction_status: "found",
      terminal_allowed: true,
    });
    expect(packet.source_target_exact_contract?.evidence_refs?.[0]).toMatch(/docs\/helix-ask-codex-loop-discipline\.md:\d+-\d+/);
    expect(packet.exact_section_contract?.required_terms).toEqual(
      expect.arrayContaining([
        "source_target_intent",
        "agent_step_observation_packet",
        "goal_satisfaction_evaluation",
        "terminal_authority_single_writer",
      ]),
    );
    expect(packet.exact_section_contract?.required_terms).not.toContain("ask_user");
    expect(packet.exact_section_contract?.required_terms).not.toContain("terminal_eligible");
  });

  it("blocks terminal eligibility when an exact source contract is missing evidence", () => {
    const exactTurnId = "ask:test:shared-tool-boundary-missing-exact-source";
    const weakObservation = {
      schema: "helix.repo_code_evidence_observation.v1",
      artifact_id: `${exactTurnId}:repo_code_evidence_observation`,
      turn_id: exactTurnId,
      concept: "Missing Exact Heading",
      query:
        'Read repo path docs/helix-ask-codex-loop-discipline.md. Find the heading "No Such Shared Boundary". List the required fields under that heading.',
      evidence_refs: ["docs/helix-ask-codex-loop-discipline.md"],
      spans: [
        {
          ref: "docs/helix-ask-codex-loop-discipline.md:1",
          path: "docs/helix-ask-codex-loop-discipline.md",
          source_kind: "repo_doc",
          sanitized_excerpt: "The loop discipline document describes Codex and Helix Ask ownership boundaries.",
          reason: "Weak retrieval hit for the correct document but not the requested heading.",
        },
      ],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    };

    const packet = buildRepoDocsSynthesisPacket({
      turnId: exactTurnId,
      promptText: weakObservation.query,
      routeFamily: "repo_evidence",
      artifactLedger: [{ artifact_id: weakObservation.artifact_id, kind: "repo_code_evidence_observation", payload: weakObservation }],
    });
    const observationWithContract = {
      ...weakObservation,
      source_target_exact_contract: packet.source_target_exact_contract,
    };
    const relevanceGate = evaluateRepoEvidenceRelevanceGate({
      turnId: exactTurnId,
      concept: "Missing Exact Heading",
      query: weakObservation.query,
      observation: observationWithContract as any,
      sourceTargetExactContract: packet.source_target_exact_contract as any,
    });

    expect(packet.source_target_exact_contract).toMatchObject({
      requested_source_identity: "docs/helix-ask-codex-loop-discipline.md#No Such Shared Boundary",
      extraction_status: "missing",
      terminal_allowed: false,
    });
    expect(relevanceGate.terminal_allowed).toBe(false);
    expect(relevanceGate.violations).toContain("exact_source_contract_failed");
  });

  it("rejects exact-section answers that invent field names or omit required terms", () => {
    const exactTurnId = "ask:test:shared-tool-boundary-bad-answer";
    const observation = {
      schema: "helix.repo_code_evidence_observation.v1",
      artifact_id: `${exactTurnId}:repo_code_evidence_observation`,
      turn_id: exactTurnId,
      concept: "Shared Tool Family Boundary",
      evidence_refs: ["docs/helix-ask-codex-loop-discipline.md:171-194"],
      spans: [
        {
          ref: "docs/helix-ask-codex-loop-discipline.md:171-194",
          path: "docs/helix-ask-codex-loop-discipline.md",
          source_kind: "repo_doc",
          sanitized_excerpt: [
            "## Shared Tool Family Boundary",
            "Required fields for a tool-family patch:",
            "source_target_intent",
            "tool_call_admission_decision",
            "agent_step_decision",
            "runtime_tool_call",
            "agent_step_observation_packet",
            "goal_satisfaction_evaluation",
            "final_answer_draft | request_user_input | typed_failure",
            "route_product_contract",
            "product_authority_guard",
            "terminal_answer_authority",
            "terminal_authority_single_writer",
            "terminal_presentation",
          ].join("\n"),
          reason: "Exact heading block lists the shared tool-family fields.",
        },
      ],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    };
    const packet = buildRepoDocsSynthesisPacket({
      turnId: exactTurnId,
      promptText:
        'Read repo path docs/helix-ask-codex-loop-discipline.md. Find the heading "Shared Tool Family Boundary". List the required fields under that heading.',
      routeFamily: "repo_evidence",
      artifactLedger: [{ artifact_id: observation.artifact_id, kind: "repo_code_evidence_observation", payload: observation }],
    });
    const payload = {
      repo_docs_synthesis_packet: packet,
      repo_code_evidence_answer: {
        schema: "helix.repo_code_evidence_answer.v1",
        support_refs: packet.compact_evidence.map((entry) => entry.ref),
        model_authored: true,
        model_step_capability: "model.synthesize_from_repo_evidence",
        synthesis_attempt_ref: `${exactTurnId}:repo_evidence_synthesis_attempt`,
      },
      final_answer_draft: {
        authority: "llm_post_observation_composer",
        model_step_capability: "model.synthesize_from_repo_evidence",
        artifact_refs: packet.compact_evidence.map((entry) => entry.ref),
      },
      current_turn_artifact_ledger: [
        { artifact_id: observation.artifact_id, kind: "repo_code_evidence_observation", payload: observation },
        {
          artifact_id: `${exactTurnId}:repo_evidence_synthesis_attempt`,
          kind: "repo_evidence_synthesis_attempt",
          payload: {
            schema: "helix.repo_evidence_synthesis_attempt.v1",
            model_step_capability: "model.synthesize_from_repo_evidence",
          },
        },
      ],
    };

    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: exactTurnId,
      answerRef: "candidate:bad-exact-section",
      answerText:
        'Under "Shared Tool Family Boundary," the fields include implementation_location, route_trace, tool_call_eligibility, and terminal_contract. Receipts cannot directly become final answers.',
      payload,
    });
    const instruction = buildRepoDocsSynthesisRepairInstruction({
      violations: gate.violations,
      packet,
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("missing_exact_section_terms");
    expect(gate.violations).toContain("unsupported_exact_section_terms");
    expect(instruction).toMatch(/exact section/i);
    expect(instruction).toMatch(/source_target_intent/);
  });

  it("accepts exact-section answers that cover every required field and no invented fields", () => {
    const exactTurnId = "ask:test:shared-tool-boundary-good-answer";
    const observation = {
      schema: "helix.repo_code_evidence_observation.v1",
      artifact_id: `${exactTurnId}:repo_code_evidence_observation`,
      turn_id: exactTurnId,
      concept: "Shared Tool Family Boundary",
      evidence_refs: ["docs/helix-ask-codex-loop-discipline.md:171-194"],
      spans: [
        {
          ref: "docs/helix-ask-codex-loop-discipline.md:171-194",
          path: "docs/helix-ask-codex-loop-discipline.md",
          source_kind: "repo_doc",
          sanitized_excerpt: [
            "## Shared Tool Family Boundary",
            "Required fields for a tool-family patch:",
            "source_target_intent",
            "tool_call_admission_decision",
            "agent_step_decision",
            "runtime_tool_call",
            "agent_step_observation_packet",
            "goal_satisfaction_evaluation",
            "final_answer_draft | request_user_input | typed_failure",
            "route_product_contract",
            "product_authority_guard",
            "terminal_answer_authority",
            "terminal_authority_single_writer",
            "terminal_presentation",
          ].join("\n"),
          reason: "Exact heading block lists the shared tool-family fields.",
        },
      ],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    };
    const packet = buildRepoDocsSynthesisPacket({
      turnId: exactTurnId,
      promptText:
        'Read repo path docs/helix-ask-codex-loop-discipline.md. Find the heading "Shared Tool Family Boundary". List the required fields under that heading.',
      routeFamily: "repo_evidence",
      artifactLedger: [{ artifact_id: observation.artifact_id, kind: "repo_code_evidence_observation", payload: observation }],
    });
    const payload = {
      repo_docs_synthesis_packet: packet,
      repo_code_evidence_answer: {
        schema: "helix.repo_code_evidence_answer.v1",
        support_refs: packet.compact_evidence.map((entry) => entry.ref),
        model_authored: true,
        model_step_capability: "model.synthesize_from_repo_evidence",
        synthesis_attempt_ref: `${exactTurnId}:repo_evidence_synthesis_attempt`,
      },
      final_answer_draft: {
        authority: "llm_post_observation_composer",
        model_step_capability: "model.synthesize_from_repo_evidence",
        artifact_refs: packet.compact_evidence.map((entry) => entry.ref),
      },
      current_turn_artifact_ledger: [
        { artifact_id: observation.artifact_id, kind: "repo_code_evidence_observation", payload: observation },
        {
          artifact_id: `${exactTurnId}:repo_evidence_synthesis_attempt`,
          kind: "repo_evidence_synthesis_attempt",
          payload: {
            schema: "helix.repo_evidence_synthesis_attempt.v1",
            model_step_capability: "model.synthesize_from_repo_evidence",
          },
        },
      ],
    };

    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: exactTurnId,
      answerRef: "candidate:good-exact-section",
      answerText:
        "The required fields are source_target_intent, tool_call_admission_decision, agent_step_decision, runtime_tool_call, agent_step_observation_packet, goal_satisfaction_evaluation, final_answer_draft, request_user_input, typed_failure, route_product_contract, product_authority_guard, terminal_answer_authority, terminal_authority_single_writer, and terminal_presentation. Receipts cannot directly become final answers; they must remain observations unless the route contract explicitly permits a receipt terminal.",
      payload,
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).toEqual([]);
  });

  it("rejects shallow broad-concept repo answers even when they have model synthesis and refs", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
    });
    const payload = {
      repo_docs_synthesis_packet: packet,
      repo_code_evidence_answer: {
        schema: "helix.repo_code_evidence_answer.v1",
        support_refs: packet.compact_evidence.map((entry) => entry.ref),
        model_authored: true,
        model_step_capability: "model.synthesize_from_repo_evidence",
        synthesis_attempt_ref: `${turnId}:repo_evidence_synthesis_attempt`,
      },
      final_answer_draft: {
        authority: "llm_post_observation_composer",
        model_step_capability: "model.synthesize_from_repo_evidence",
        artifact_refs: packet.compact_evidence.map((entry) => entry.ref),
      },
      current_turn_artifact_ledger: [
        ...ledger,
        {
          artifact_id: `${turnId}:repo_evidence_synthesis_attempt`,
          kind: "repo_evidence_synthesis_attempt",
          payload: {
            schema: "helix.repo_evidence_synthesis_attempt.v1",
            model_step_capability: "model.synthesize_from_repo_evidence",
          },
        },
      ],
    };

    const gate = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: "candidate:shallow-dottie",
      answerText: "Auntie Dottie is a witness-only observer preset for the Situation Room.",
      payload,
    });
    const instruction = buildRepoDocsSynthesisRepairInstruction({
      violations: gate.violations,
      packet,
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("shallow_broad_concept_answer");
    expect(instruction).toMatch(/too shallow for a broad repo concept/i);
    expect(instruction).toMatch(/identity, responsibilities, workflow/i);
  });

  it("keeps file inventories and no-evidence refusals from passing the quality gate", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
    });
    const payload = {
      repo_docs_synthesis_packet: packet,
      repo_code_evidence_answer: {
        schema: "helix.repo_code_evidence_answer.v1",
        support_refs: packet.compact_evidence.map((entry) => entry.ref),
        model_authored: true,
        model_step_capability: "model.synthesize_from_repo_evidence",
        synthesis_attempt_ref: `${turnId}:repo_evidence_synthesis_attempt`,
      },
      final_answer_draft: {
        authority: "llm_post_observation_composer",
        model_step_capability: "model.synthesize_from_repo_evidence",
        artifact_refs: packet.compact_evidence.map((entry) => entry.ref),
      },
      current_turn_artifact_ledger: [
        ...ledger,
        {
          artifact_id: `${turnId}:repo_evidence_synthesis_attempt`,
          kind: "repo_evidence_synthesis_attempt",
          payload: {
            schema: "helix.repo_evidence_synthesis_attempt.v1",
            model_step_capability: "model.synthesize_from_repo_evidence",
          },
        },
      ],
    };

    const fileList = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: "candidate:file-list",
      answerText: "shared/helix-dottie-manifest-preset.ts\nserver/services/situation-room/dottie-manifest-preset.ts",
      payload,
    });
    const sourceOnly = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: "candidate:source-only",
      answerText: [
        "Sources:",
        "- shared/helix-dottie-manifest-preset.ts:111",
        "- shared/helix-dottie-manifest-preset.ts:114",
        "- server/services/situation-room/dottie-manifest-preset.ts:22",
      ].join("\n"),
      payload,
    });
    const refusal = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: "candidate:refusal",
      answerText: "I cannot answer because no repo evidence observations were provided.",
      payload,
    });

    expect(fileList.violations).toContain("file_list_only");
    expect(sourceOnly.violations).toContain("excerpt_like_answer");
    expect(refusal.violations).toContain("unsupported_repo_claim");
  });

  it("rejects policy claim inversions about receipts and final-answer authority", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "Summarize what the loop discipline says about receipts and final answers.",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
    });
    const payload = {
      repo_docs_synthesis_packet: packet,
      repo_code_evidence_answer: {
        schema: "helix.repo_code_evidence_answer.v1",
        support_refs: packet.compact_evidence.map((entry) => entry.ref),
        model_authored: true,
        model_step_capability: "model.synthesize_from_repo_evidence",
        synthesis_attempt_ref: `${turnId}:repo_evidence_synthesis_attempt`,
      },
      final_answer_draft: {
        authority: "llm_post_observation_composer",
        model_step_capability: "model.synthesize_from_repo_evidence",
        artifact_refs: packet.compact_evidence.map((entry) => entry.ref),
      },
      current_turn_artifact_ledger: [
        ...ledger,
        {
          artifact_id: `${turnId}:repo_evidence_synthesis_attempt`,
          kind: "repo_evidence_synthesis_attempt",
          payload: {
            schema: "helix.repo_evidence_synthesis_attempt.v1",
            model_step_capability: "model.synthesize_from_repo_evidence",
          },
        },
      ],
    };

    const gate = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: "candidate:inverted-policy",
      answerText:
        "Receipts are essential because they validate final answers. Final answers must be derived from validated receipts to maintain the integrity of Helix Ask.",
      payload,
    });
    const instruction = buildRepoDocsSynthesisRepairInstruction({
      violations: gate.violations,
      packet,
    });
    const errorCode = repoDocsSynthesisTerminalErrorCode({
      status: classifyRepoDocsSynthesisAttemptStatus({ ok: gate.ok, violations: gate.violations }),
      repairAttempted: true,
      violations: gate.violations,
    });

    expect(gate.violations).toContain("policy_claim_inversion");
    expect(instruction).toMatch(/receipts\/tool outputs are observations/i);
    expect(errorCode).toBe("repo_docs_synthesis_policy_claim_inversion_after_repair");
  });

  it("builds targeted repair instructions and precise terminal codes for bad synthesis drafts", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
    });
    const instruction = buildRepoDocsSynthesisRepairInstruction({
      violations: ["excerpt_like_answer", "file_list_only"],
      packet,
    });
    const status = classifyRepoDocsSynthesisAttemptStatus({
      ok: false,
      violations: ["excerpt_like_answer", "file_list_only"],
    });
    const errorCode = repoDocsSynthesisTerminalErrorCode({
      status,
      repairAttempted: true,
      violations: ["excerpt_like_answer", "file_list_only"],
    });

    expect(status).toBe("excerpt_like");
    expect(instruction).toMatch(/previous answer was excerpt-like or file-list-like/i);
    expect(instruction).toMatch(/compact evidence refs/i);
    expect(instruction).toMatch(/Do not put each source on its own bullet line/i);
    expect(instruction).toMatch(/Auntie Dottie/i);
    expect(errorCode).toBe("repo_docs_synthesis_file_inventory_after_repair");
  });

  it("adds repo/docs packet and quality events to the causal timeline", () => {
    const packet = buildRepoDocsSynthesisPacket({
      turnId,
      promptText: "What is Auntie Dottie in this app?",
      routeFamily: "repo_evidence",
      artifactLedger: ledger,
    });
    const payload = {
      turn_id: turnId,
      route_reason_code: "repo_code_evidence",
      terminal_artifact_kind: "repo_code_evidence_answer",
      final_answer_source: "model_synthesis_from_repo_evidence",
      selected_final_answer: "Auntie Dottie is a Situation Room/Helix Ask construct.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "repo_entity_definition",
      },
      source_target_intent: {
        target_source: "repo_code",
      },
      agent_step_decision: {
        next_step: "answer",
        chosen_capability: "model.synthesize_from_repo_evidence",
      },
      current_turn_artifact_ledger: [
        ...ledger,
        {
          artifact_id: packet.packet_id,
          kind: "repo_docs_synthesis_packet",
          payload: packet,
        },
        {
          artifact_id: `${turnId}:repo_answer_text_quality_gate`,
          kind: "repo_answer_text_quality_gate",
          payload: {
            schema: "helix.repo_answer_text_quality_gate.v1",
            ok: true,
            violations: [],
          },
        },
        {
          artifact_id: `${turnId}:repo_code_evidence_answer`,
          kind: "repo_code_evidence_answer",
          payload: {
            schema: "helix.repo_code_evidence_answer.v1",
            support_refs: packet.compact_evidence.map((entry) => entry.ref),
          },
        },
      ],
      repo_docs_synthesis_packet: packet,
      repo_answer_text_quality_gate: {
        schema: "helix.repo_answer_text_quality_gate.v1",
        ok: true,
        violations: [],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      solver_controller_decision: {
        decision: "allow_terminal",
      },
      terminal_answer_authority: {
        terminal_artifact_kind: "repo_code_evidence_answer",
      },
    };

    const stages = getHelixCausalTurnTimeline(payload).events.map((event) => event.stage);

    expect(stages).toEqual(expect.arrayContaining([
      "repo_evidence_observation_created",
      "repo_docs_synthesis_packet_created",
      "quality_gate_evaluated",
      "terminal_artifact_materialized",
      "terminal_artifact_selected",
    ]));
  });
});
