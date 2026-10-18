import { describe, expect, it } from "vitest";

import { sanitizeRepoEvidenceExcerptForPresentation } from "../services/helix-ask/repo-evidence-presentation-sanitizer";
import { evaluateRepoAnswerTextQualityGate } from "../services/helix-ask/repo-answer-text-quality-gate";

describe("repo evidence presentation sanitizer", () => {
  it("normalizes renderer-hostile excerpts for presentation while preserving raw identity", () => {
    const raw = "client/src/foo.ts\u200B\r\nconst 𝐒𝐢𝐭𝐮𝐚𝐭𝐢𝐨𝐧Room = true;\u0007";
    const result = sanitizeRepoEvidenceExcerptForPresentation({ raw, maxChars: 120 });

    expect(result.sanitized).toContain("SituationRoom");
    expect(result.sanitized).not.toMatch(/[\u200B-\u200D\uFEFF]/u);
    expect(result.sanitized).not.toMatch(/[\u{1D400}-\u{1D7FF}]/u);
    expect(result.changed).toBe(true);
    expect(result.rawHash).toHaveLength(16);
    expect(result.warnings).toEqual(expect.arrayContaining(["normalized_math_styled_alphanumerics", "removed_control_characters"]));
  });

  it("rejects deterministic repo evidence fallback text as terminal answer quality", () => {
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: "turn:repo-quality",
      answerRef: "answer:repo",
      answerText: [
        "I found current repo evidence for Situation Room.",
        "",
        "Key evidence:",
        "- client/src/components/workstation/SituationRoomPipelinesPanel.tsx: export function SituationRoomPipelinesPanel()",
      ].join("\n"),
      payload: {
        final_answer_draft: {
          authority: "deterministic_receipt_fallback",
        },
        current_turn_artifact_ledger: [
          {
            kind: "repo_code_evidence_observation",
            payload: {
              schema: "helix.repo_code_evidence_observation.v1",
              evidence_refs: ["client/src/components/workstation/SituationRoomPipelinesPanel.tsx:1"],
            },
          },
        ],
      },
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toEqual(expect.arrayContaining(["missing_model_synthesis", "canned_fallback_text"]));
    expect(gate.terminal_allowed).toBe(false);
  });

  it("allows concise model-authored repo prose with support refs", () => {
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: "turn:repo-quality-ok",
      answerRef: "answer:repo",
      answerText:
        "The Situation Room is the workstation control surface for live sources, pipeline setup, observer workflows, and Ask-visible evidence handoffs. Sources: client/src/components/workstation/SituationRoomPipelinesPanel.tsx; shared/workstation-dynamic-tools.ts.",
      payload: {
        final_answer_draft: {
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_repo_evidence",
        },
        repo_code_evidence_answer: {
          model_authored: true,
          model_step_capability: "model.synthesize_from_repo_evidence",
          synthesis_attempt_ref: "turn:repo-quality-ok:repo_evidence_synthesis_attempt",
          support_refs: [
            "client/src/components/workstation/SituationRoomPipelinesPanel.tsx:1",
            "shared/workstation-dynamic-tools.ts:1",
          ],
        },
      },
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).toEqual([]);
    expect(gate.terminal_allowed).toBe(true);
  });

  it("accepts current-turn provider reasoning after repository observation re-entry", () => {
    const turnId = "turn:repo-provider-reentry";
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex`;
    const observationRef = `${turnId}:repo_code_evidence_observation`;
    const answerText =
      "Terminal authority is implemented in server/services/helix-ask/terminal-authority-single-writer.ts, which selects the final artifact after repository evidence is re-entered into the provider.";
    const candidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      candidate_id: candidateRef,
      turn_id: turnId,
      provider_reasoning_completed: true,
      grounded_in_observation_refs: [observationRef],
      normalized_observation_refs: [observationRef],
    };
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: `${candidateRef}:route_product:repo_code_evidence_answer`,
      answerText,
      payload: {
        turn_id: turnId,
        repo_code_evidence_answer: {
          turn_id: turnId,
          answer_text: answerText,
          provider_terminal_candidate_ref: candidateRef,
          selected_observation_refs: [observationRef],
          support_refs: [observationRef],
        },
        provider_terminal_candidate: candidate,
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          turn_id: turnId,
          status: "completed",
          provider_terminal_candidate_ref: candidateRef,
          evidence_reentered: true,
          solver_completed: true,
        },
        provider_terminal_authority_bridge: {
          schema: "helix.provider_terminal_authority_bridge.v1",
          turn_id: turnId,
          provider_terminal_candidate_ref: candidateRef,
          provider_terminal_candidate: candidate,
          normalized_observations_ready: true,
          terminal_authority_granted: true,
          final_visible_answer_authorized: true,
        },
      },
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).toEqual([]);
    expect(gate.terminal_allowed).toBe(true);
  });

  it("rejects a provider candidate whose observation refs do not support the repo answer", () => {
    const turnId = "turn:repo-provider-reentry-mismatch";
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex`;
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId,
      answerRef: `${candidateRef}:route_product:repo_code_evidence_answer`,
      answerText:
        "Terminal authority is implemented in server/services/helix-ask/terminal-authority-single-writer.ts and selects the final visible answer.",
      payload: {
        turn_id: turnId,
        repo_code_evidence_answer: {
          turn_id: turnId,
          provider_terminal_candidate_ref: candidateRef,
          selected_observation_refs: [`${turnId}:answer-observation`],
          support_refs: [`${turnId}:answer-observation`],
        },
        provider_terminal_candidate: {
          schema: "helix.agent_provider_terminal_candidate.v1",
          candidate_id: candidateRef,
          turn_id: turnId,
          provider_reasoning_completed: true,
          grounded_in_observation_refs: [`${turnId}:different-observation`],
        },
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          turn_id: turnId,
          status: "completed",
          provider_terminal_candidate_ref: candidateRef,
          evidence_reentered: true,
          solver_completed: true,
        },
        provider_terminal_authority_bridge: {
          schema: "helix.provider_terminal_authority_bridge.v1",
          turn_id: turnId,
          provider_terminal_candidate_ref: candidateRef,
          normalized_observations_ready: true,
          terminal_authority_granted: true,
          final_visible_answer_authorized: true,
        },
      },
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toEqual(
      expect.arrayContaining(["missing_model_synthesis", "wrong_model_step_identity"]),
    );
  });

  it("rejects repo answers synthesized under the generic direct-answer identity", () => {
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: "turn:repo-quality-wrong-step",
      answerRef: "answer:repo",
      answerText:
        "Auntie Dottie is a witness-only Situation Room observer in this app. Sources: shared/helix-dottie-manifest-preset.ts.",
      payload: {
        final_answer_draft: {
          authority: "llm_post_observation_composer",
          model_step_capability: "model.direct_answer",
        },
        repo_code_evidence_answer: {
          model_authored: true,
          model_step_capability: "model.direct_answer",
          synthesis_attempt_ref: "turn:repo-quality-wrong-step:repo_evidence_synthesis_attempt",
          support_refs: ["shared/helix-dottie-manifest-preset.ts:1"],
        },
      },
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("wrong_model_step_identity");
    expect(gate.terminal_allowed).toBe(false);
  });

  it("rejects model-authored missing-evidence refusals when repo evidence is present", () => {
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: "turn:repo-quality-refusal",
      answerRef: "answer:repo",
      answerText:
        "I could not answer that as a repo/code evidence turn because no current-turn repo evidence observations proved the requested code paths, symbols, or line-backed sources.",
      payload: {
        final_answer_draft: {
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_repo_evidence",
        },
        repo_code_evidence_answer: {
          model_authored: true,
          model_step_capability: "model.synthesize_from_repo_evidence",
          synthesis_attempt_ref: "turn:repo-quality-refusal:repo_evidence_synthesis_attempt",
          support_refs: ["client/src/components/workstation/SituationRoomPipelinesPanel.tsx:1"],
        },
      },
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("unsupported_repo_claim");
  });

  it("rejects repo answers that violate the Chinese response language contract", () => {
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: "turn:repo-quality-language-zh",
      answerRef: "answer:repo",
      answerText:
        "Helix Ask decides the final answer language through the request language contract and response_language metadata. Sources: server/services/helix-ask/language-contract.ts; server/routes/agi.plan.ts.",
      payload: {
        language_contract: {
          schema: "helix.ask_language_contract.v1",
          response_language: "zh",
          language_detected: "zh",
          code_mixed: false,
        },
        final_answer_draft: {
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_repo_evidence",
        },
        repo_code_evidence_answer: {
          model_authored: true,
          model_step_capability: "model.synthesize_from_repo_evidence",
          synthesis_attempt_ref: "turn:repo-quality-language-zh:repo_evidence_synthesis_attempt",
          support_refs: [
            "server/services/helix-ask/language-contract.ts:1",
            "server/routes/agi.plan.ts:1",
          ],
        },
      },
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("response_language_contract_violated");
    expect(gate.terminal_allowed).toBe(false);
  });

  it("allows repo answers that honor the Chinese response language contract", () => {
    const gate = evaluateRepoAnswerTextQualityGate({
      turnId: "turn:repo-quality-language-zh-ok",
      answerRef: "answer:repo",
      answerText:
        "Helix Ask 会通过请求里的语言契约和 response_language 元数据决定最终回答语言，并在代码路径和标识符中保留英文原文。Sources: server/services/helix-ask/language-contract.ts; server/routes/agi.plan.ts.",
      payload: {
        language_contract: {
          schema: "helix.ask_language_contract.v1",
          response_language: "zh",
          language_detected: "zh",
          code_mixed: false,
        },
        final_answer_draft: {
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_repo_evidence",
        },
        repo_code_evidence_answer: {
          model_authored: true,
          model_step_capability: "model.synthesize_from_repo_evidence",
          synthesis_attempt_ref: "turn:repo-quality-language-zh-ok:repo_evidence_synthesis_attempt",
          support_refs: [
            "server/services/helix-ask/language-contract.ts:1",
            "server/routes/agi.plan.ts:1",
          ],
        },
      },
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).not.toContain("response_language_contract_violated");
  });
});
