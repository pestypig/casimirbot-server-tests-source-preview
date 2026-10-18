import { describe, expect, it } from "vitest";

import { verifyHelixCanonicalTerminalProjection } from "../canonical-terminal-projection-verifier";
import { projectHelixAskExternalTurn } from "../external-turn-projection";
import {
  buildHelixTurnTerminalAuthority,
  hashHelixTerminalText,
} from "../turn-terminal-authority";

type RecordLike = Record<string, unknown>;

type EvidenceArtifact = {
  ref: string;
  kind: string;
  selected_as_support?: boolean;
  reentered_solver?: boolean;
  allowed_by_terminal_authority?: boolean;
  failure_codes?: string[];
};

const TURN_ID = "ask:external-projection:turn-1";
const THREAD_ID = "thread:external-projection";
const TEXT = "The canonical current-turn answer.";
const ARTIFACT_REF = `${TURN_ID}:model_synthesized_answer:1`;
const ARTIFACT_KIND = "model_synthesized_answer";
const FINAL_ANSWER_SOURCE = "final_answer_draft";
const ROUTE = "model_direct / runtime_loop";

const terminalPayload = (
  input: {
    groundingRequired?: boolean;
    evidence?: EvidenceArtifact[];
  } = {},
): RecordLike => {
  const groundingRequired = input.groundingRequired ?? false;
  const evidence = input.evidence ?? [];
  const selectedEvidenceRefs = groundingRequired
    ? evidence
        .filter((entry) => entry.selected_as_support !== false)
        .map((entry) => entry.ref)
    : [];
  const authority = {
    ...buildHelixTurnTerminalAuthority({
      thread_id: THREAD_ID,
      turn_id: TURN_ID,
      route: ROUTE,
      final_answer_source: FINAL_ANSWER_SOURCE,
      terminal_artifact_kind: ARTIFACT_KIND,
      terminal_text: TEXT,
      terminal_item_id: ARTIFACT_REF,
      terminal_kind: "answer",
      authority_origin: "terminal_presentation",
      server_authoritative: true,
      terminal_eligible: true,
      assistant_answer: false,
    }),
    terminal_artifact_ref: ARTIFACT_REF,
    raw_content_included: false,
  };

  return {
    ok: true,
    turn_id: TURN_ID,
    thread_id: THREAD_ID,
    route_reason_code: ROUTE,
    terminal_artifact_kind: ARTIFACT_KIND,
    final_answer_source: FINAL_ANSWER_SOURCE,
    selected_final_answer: TEXT,
    route_product_contract: {
      schema: "helix.route_product_contract.v1",
      allowed_terminal_artifact_kinds: [ARTIFACT_KIND],
      forbidden_terminal_artifact_kinds: [],
    },
    terminal_answer_authority: authority,
    terminal_presentation: {
      schema: "helix.terminal_presentation.v1",
      turn_id: TURN_ID,
      terminal_authority_ref: ARTIFACT_REF,
      terminal_artifact_ref: ARTIFACT_REF,
      terminal_artifact_kind: ARTIFACT_KIND,
      final_answer_source: FINAL_ANSWER_SOURCE,
      concise_text: TEXT,
      assistant_answer: false,
      raw_content_included: false,
    },
    terminal_authority_single_writer: {
      schema: "helix.terminal_authority_single_writer_result.v1",
      turn_id: TURN_ID,
      selected_terminal_artifact_ref: ARTIFACT_REF,
      selected_terminal_artifact_kind: ARTIFACT_KIND,
      selected_terminal_support_refs: selectedEvidenceRefs,
      visible_text: TEXT,
      source: FINAL_ANSWER_SOURCE,
      assistant_answer: false,
      integrity: {
        single_writer_applied: true,
        visible_matches_selected_artifact: true,
        stale_failure_visible: false,
        receipt_visible_as_answer: false,
        payload_mirror_written_after_terminal_selection: true,
        terminal_projection_failure_code: null,
      },
    },
    terminal_grounding_authority: {
      schema: "helix.terminal_grounding_authority.v1",
      authority_id: `${TURN_ID}:terminal_grounding_authority`,
      authority_source: "canonical_terminal_boundary",
      turn_id: TURN_ID,
      terminal_artifact_ref: ARTIFACT_REF,
      terminal_artifact_kind: ARTIFACT_KIND,
      final_answer_source: FINAL_ANSWER_SOURCE,
      terminal_text_hash: `sha256:${hashHelixTerminalText(TEXT)}`,
      grounding_required: groundingRequired,
      status: groundingRequired ? "validated" : "not_required",
      selected_evidence_refs: selectedEvidenceRefs,
      evidence_reentry_authority: groundingRequired
        ? "runtime_event_log"
        : "compatibility_projection",
      runtime_lifecycle_verified: groundingRequired,
      current_turn_only: true,
      completed_solver_path: true,
      route_authority_ok: true,
      poison_audit_ok: true,
      terminal_authority_ok: true,
      support_coverage_complete: true,
      failure_code: null,
      failure_codes: [],
      assistant_answer: false,
      terminal_eligible: false,
      provider_payload_included: false,
      raw_content_included: false,
    },
    solver_artifact_reentry_audit: {
      schema: "helix.solver_artifact_reentry_audit.v1",
      turn_id: TURN_ID,
      ok: true,
      terminal_relevant_artifacts: evidence.map((entry) => ({
        selected_as_support: true,
        reentered_solver: true,
        allowed_by_terminal_authority: true,
        failure_codes: [],
        ...entry,
      })),
    },
  };
};

const verify = (payload: RecordLike) =>
  verifyHelixCanonicalTerminalProjection({
    payload,
    turnId: TURN_ID,
    threadId: THREAD_ID,
  });

describe("canonical terminal projection verifier", () => {
  it("accepts a canonical current-turn terminal when grounding is not required", () => {
    const result = verify(terminalPayload());

    expect(result).toMatchObject({
      ok: true,
      reason: "canonical_terminal_authority_verified",
      authorityRef: `${TURN_ID}:terminal_grounding_authority`,
      artifactRef: ARTIFACT_REF,
      artifactKind: ARTIFACT_KIND,
      finalAnswerSource: FINAL_ANSWER_SOURCE,
      terminalText: TEXT,
      supportingEvidenceRefs: [],
    });
  });

  it("accepts a canonical current-turn validated terminal with selected evidence", () => {
    const evidenceRef = `${TURN_ID}:observation:scholarly:1`;
    const result = verify(
      terminalPayload({
        groundingRequired: true,
        evidence: [
          { ref: evidenceRef, kind: "scholarly_research_observation" },
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      supportingEvidenceRefs: [evidenceRef],
    });
  });

  it("rejects an intermediate writer that has every visible terminal field but no canonical grounding authority", () => {
    const payload = terminalPayload();
    delete payload.terminal_grounding_authority;

    expect(verify(payload)).toEqual({
      ok: false,
      reason: "canonical_grounding_authority_missing",
      authority: null,
    });
    expect(
      projectHelixAskExternalTurn({
        payload,
        status: 200,
        turnId: TURN_ID,
        threadId: THREAD_ID,
        requiredEvidence: [],
      }),
    ).toMatchObject({
      terminal_authority_status: "blocked",
      terminal_authority_reason: "canonical_grounding_authority_missing",
      terminal_product: null,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("rejects compatibility grounding authority even when its remaining fields look canonical", () => {
    const payload = terminalPayload();
    (payload.terminal_grounding_authority as RecordLike).authority_source =
      "canonical_terminal_boundary_compatibility";

    expect(verify(payload)).toMatchObject({
      ok: false,
      reason: "canonical_grounding_authority_missing",
    });
  });

  it.each([
    {
      label: "grounding authority",
      mutate: (payload: RecordLike) => {
        (payload.terminal_grounding_authority as RecordLike).turn_id =
          "ask:prior-turn";
      },
      reason: "canonical_grounding_turn_mismatch",
    },
    {
      label: "terminal presentation",
      mutate: (payload: RecordLike) => {
        (payload.terminal_presentation as RecordLike).turn_id =
          "ask:prior-turn";
      },
      reason: "canonical_terminal_presentation_invalid",
    },
    {
      label: "terminal answer authority",
      mutate: (payload: RecordLike) => {
        (payload.terminal_answer_authority as RecordLike).turn_id =
          "ask:prior-turn";
      },
      reason: "terminal_authority_record_blocked",
    },
    {
      label: "single writer",
      mutate: (payload: RecordLike) => {
        (payload.terminal_authority_single_writer as RecordLike).turn_id =
          "ask:prior-turn";
      },
      reason: "single_writer_integrity_blocked",
    },
  ])("rejects a stale-turn $label", ({ mutate, reason }) => {
    const payload = terminalPayload();
    mutate(payload);

    expect(verify(payload)).toMatchObject({ ok: false, reason });
  });

  it("rejects terminal authority copied from another thread", () => {
    const payload = terminalPayload();
    (payload.terminal_answer_authority as RecordLike).thread_id =
      "thread:other";

    expect(verify(payload)).toMatchObject({
      ok: false,
      reason: "terminal_authority_record_blocked",
    });
  });

  it("rejects terminal authority that omits its non-answer boundary", () => {
    const payload = terminalPayload();
    delete (payload.terminal_answer_authority as RecordLike).assistant_answer;

    expect(verify(payload)).toMatchObject({
      ok: false,
      reason: "terminal_authority_record_blocked",
    });
  });

  it("rejects a terminal text hash that is not bound to the canonical presentation", () => {
    const payload = terminalPayload();
    (payload.terminal_grounding_authority as RecordLike).terminal_text_hash =
      `sha256:${hashHelixTerminalText("A stale answer.")}`;

    expect(verify(payload)).toMatchObject({
      ok: false,
      reason: "canonical_terminal_text_hash_mismatch",
    });
  });

  it("rejects a terminal authority text hash that diverges from canonical grounding", () => {
    const payload = terminalPayload();
    (payload.terminal_answer_authority as RecordLike).terminal_text_hash =
      hashHelixTerminalText("A stale authority answer.");

    expect(verify(payload)).toMatchObject({
      ok: false,
      reason: "canonical_terminal_text_hash_mismatch",
    });
  });

  it.each([
    {
      label: "artifact reference",
      mutate: (payload: RecordLike) => {
        (payload.terminal_presentation as RecordLike).terminal_artifact_ref =
          `${TURN_ID}:other-artifact`;
      },
    },
    {
      label: "artifact kind",
      mutate: (payload: RecordLike) => {
        (
          payload.terminal_authority_single_writer as RecordLike
        ).selected_terminal_artifact_kind = "typed_failure";
      },
    },
    {
      label: "final answer source",
      mutate: (payload: RecordLike) => {
        (payload.terminal_answer_authority as RecordLike).final_answer_source =
          "stale_draft";
      },
    },
  ])("rejects a mismatched $label binding", ({ mutate }) => {
    const payload = terminalPayload();
    mutate(payload);

    expect(verify(payload)).toMatchObject({
      ok: false,
      reason: "canonical_terminal_identity_mismatch",
    });
  });
});

describe("external turn evidence projection", () => {
  it("does not authorize a payload that still requests input", () => {
    const payload = terminalPayload();
    payload.final_status = "needs_input";

    expect(
      projectHelixAskExternalTurn({
        payload,
        status: 200,
        turnId: TURN_ID,
        threadId: THREAD_ID,
        requiredEvidence: [],
      }),
    ).toMatchObject({
      terminal_authority_status: "blocked",
      terminal_authority_reason: "failure_or_pending_projection",
      terminal_product: null,
    });
  });

  it("projects only current-turn, selected, re-entered, authority-admitted evidence with no failures", () => {
    const scholarlyRef = `${TURN_ID}:observation:scholarly:1`;
    const repoRef = `${TURN_ID}:observation:repo:1`;
    const receiptRef = `${TURN_ID}:receipt:validation:1`;
    const theoryRef = `${TURN_ID}:theory:1`;
    const excludedRefs = {
      unselected: `${TURN_ID}:observation:unselected`,
      notReentered: `${TURN_ID}:observation:not-reentered`,
      disallowed: `${TURN_ID}:observation:disallowed`,
      failed: `${TURN_ID}:observation:failed`,
      unsupported: `${TURN_ID}:observation:not-terminal-support`,
    };
    const payload = terminalPayload({
      groundingRequired: true,
      evidence: [
        { ref: scholarlyRef, kind: "scholarly_research_observation" },
        { ref: repoRef, kind: "repo_code_evidence_observation" },
        { ref: receiptRef, kind: "validation_receipt" },
        { ref: theoryRef, kind: "theory_context_reflection" },
        {
          ref: excludedRefs.unselected,
          kind: "internet_search_observation",
          selected_as_support: false,
        },
        {
          ref: excludedRefs.notReentered,
          kind: "internet_search_observation",
          reentered_solver: false,
        },
        {
          ref: excludedRefs.disallowed,
          kind: "internet_search_observation",
          allowed_by_terminal_authority: false,
        },
        {
          ref: excludedRefs.failed,
          kind: "internet_search_observation",
          failure_codes: ["poisoned"],
        },
        {
          ref: excludedRefs.unsupported,
          kind: "internet_search_observation",
        },
      ],
    });
    const grounding = payload.terminal_grounding_authority as RecordLike;
    grounding.selected_evidence_refs = [
      scholarlyRef,
      repoRef,
      receiptRef,
      theoryRef,
      excludedRefs.unselected,
      excludedRefs.notReentered,
      excludedRefs.disallowed,
      excludedRefs.failed,
    ];

    const projection = projectHelixAskExternalTurn({
      payload,
      status: 200,
      turnId: TURN_ID,
      threadId: THREAD_ID,
      requiredEvidence: [
        "scholarly_evidence",
        "repository_evidence",
        "theory_registry_evidence",
        "scholarly_research_observation",
      ],
    });

    expect(projection.terminal_authority_status).toBe("authorized");
    expect(projection.observation_refs).toEqual([scholarlyRef, repoRef]);
    expect(projection.receipt_refs).toEqual([receiptRef]);
    expect(projection.evidence_refs).toEqual([theoryRef]);
    expect(projection.satisfied_evidence_requirements).toEqual([
      "scholarly_evidence",
      "repository_evidence",
      "theory_registry_evidence",
      "scholarly_research_observation",
    ]);
    expect(projection.missing_evidence_requirements).toEqual([]);
    expect([
      ...projection.observation_refs,
      ...projection.receipt_refs,
      ...projection.evidence_refs,
    ]).not.toEqual(expect.arrayContaining(Object.values(excludedRefs)));
    expect(projection.terminal_product).toMatchObject({
      authority_ref: `${TURN_ID}:terminal_grounding_authority`,
      text: TEXT,
    });
    expect(projection.answer_authority).toBe(false);
    expect(projection.assistant_answer).toBe(false);
    expect(projection.terminal_eligible).toBe(false);
    expect(projection.raw_content_included).toBe(false);
  });

  it("does not project evidence or satisfy requirements from a stale re-entry audit", () => {
    const evidenceRef = `${TURN_ID}:observation:scholarly:1`;
    const payload = terminalPayload({
      groundingRequired: true,
      evidence: [{ ref: evidenceRef, kind: "scholarly_research_observation" }],
    });
    (payload.solver_artifact_reentry_audit as RecordLike).turn_id =
      "ask:prior-turn";

    const projection = projectHelixAskExternalTurn({
      payload,
      status: 200,
      turnId: TURN_ID,
      threadId: THREAD_ID,
      requiredEvidence: ["scholarly_evidence"],
    });

    expect(projection.observation_refs).toEqual([]);
    expect(projection.evidence_refs).toEqual([]);
    expect(projection.receipt_refs).toEqual([]);
    expect(projection.satisfied_evidence_requirements).toEqual([]);
    expect(projection.missing_evidence_requirements).toEqual([
      "scholarly_evidence",
    ]);
  });

  it("satisfies bound-room evidence only from a selected current-turn observation that re-entered the solver", () => {
    const evidenceRef = `${TURN_ID}:observation:bound-room:1`;
    const payload = terminalPayload({
      groundingRequired: true,
      evidence: [
        {
          ref: evidenceRef,
          kind: "bound_room_evidence_observation",
        },
      ],
    });

    const projection = projectHelixAskExternalTurn({
      payload,
      status: 200,
      turnId: TURN_ID,
      threadId: THREAD_ID,
      requiredEvidence: ["shared_live_room_evidence"],
    });

    expect(projection).toMatchObject({
      observation_refs: [evidenceRef],
      satisfied_evidence_requirements: ["shared_live_room_evidence"],
      missing_evidence_requirements: [],
    });

    const audit = payload.solver_artifact_reentry_audit as RecordLike;
    const artifact = (audit.terminal_relevant_artifacts as RecordLike[])[0];
    artifact.reentered_solver = false;
    const notReentered = projectHelixAskExternalTurn({
      payload,
      status: 200,
      turnId: TURN_ID,
      threadId: THREAD_ID,
      requiredEvidence: ["shared_live_room_evidence"],
    });
    expect(notReentered).toMatchObject({
      terminal_authority_status: "blocked",
      terminal_authority_reason: "required_current_turn_evidence_missing",
      terminal_product: null,
      observation_refs: [],
      satisfied_evidence_requirements: [],
      missing_evidence_requirements: ["shared_live_room_evidence"],
    });
  });

  it("keeps canonical evidence available while blocking a forged terminal writer", () => {
    const evidenceRef = `${TURN_ID}:observation:repo:1`;
    const payload = terminalPayload({
      groundingRequired: true,
      evidence: [{ ref: evidenceRef, kind: "repo_code_evidence_observation" }],
    });
    delete payload.terminal_grounding_authority;

    const projection = projectHelixAskExternalTurn({
      payload,
      status: 200,
      turnId: TURN_ID,
      threadId: THREAD_ID,
      requiredEvidence: ["repository_evidence"],
    });

    expect(projection).toMatchObject({
      terminal_authority_status: "blocked",
      terminal_product: null,
      observation_refs: [evidenceRef],
      satisfied_evidence_requirements: ["repository_evidence"],
      missing_evidence_requirements: [],
    });
  });

  it("blocks terminal authority when required current-turn evidence was not selected as support", () => {
    const evidenceRef = `${TURN_ID}:observation:web:1`;
    const payload = terminalPayload({
      evidence: [{ ref: evidenceRef, kind: "internet_search_observation" }],
    });

    const projection = projectHelixAskExternalTurn({
      payload,
      status: 200,
      turnId: TURN_ID,
      threadId: THREAD_ID,
      requiredEvidence: ["internet_search_evidence"],
    });

    expect(projection.terminal_authority_status).toBe("blocked");
    expect(projection.terminal_authority_reason).toBe(
      "required_current_turn_evidence_missing",
    );
    expect(projection.terminal_product).toBeNull();
    expect(projection.observation_refs).toEqual([]);
    expect(projection.satisfied_evidence_requirements).toEqual([]);
    expect(projection.missing_evidence_requirements).toEqual([
      "internet_search_evidence",
    ]);
  });
});
