import { describe, expect, it } from "vitest";

import { buildAskTurnSolverTrace } from "../services/helix-ask/ask-turn-solver";
import { buildToolUseRestatement } from "../services/helix-ask/internet-search-intent";
import { interpretHelixAskPrompt } from "../services/helix-ask/prompt-interpretation";

describe("Helix Ask voice read-aloud admission", () => {
  it("classifies last-final-answer read-aloud as voice delivery instead of model-only", () => {
    const prompt = "read the last final answer outloud";
    const restatement = buildToolUseRestatement(prompt);
    const interpretation = interpretHelixAskPrompt(prompt);
    const trace = buildAskTurnSolverTrace({
      turnId: "ask:test:voice-read-last-final-answer",
      promptText: prompt,
      selectedRoute: "/ask/turn/stream",
      terminalArtifactKind: "typed_failure",
      finalAnswerSource: "typed_failure",
      payload: {
        turn_id: "ask:test:voice-read-last-final-answer",
        selected_final_answer: "missing_previous_assistant_final_answer",
        terminal_answer_authority: {
          server_authoritative: true,
          terminal_artifact_kind: "typed_failure",
        },
        route_authority_audit: { route_authority_ok: true },
        poison_audit: { ok: true },
      },
    });

    expect(restatement.requiredToolFamilies).toContain("voice_delivery");
    expect(interpretation).toMatchObject({
      requested_output: "operator receipt",
      control_command_detected: true,
      content_question_detected: false,
    });
    expect(interpretation.executable_operator_commands).toEqual([
      expect.objectContaining({
        action_family: "voice_delivery",
        reason: "affirmative voice or text-to-speech delivery command",
      }),
    ]);
    expect(trace.tool_use_restatement.requiredToolFamilies).toContain("voice_delivery");
    expect(trace.committed_ask_route.capability_policy.allowed_tool_families).toContain("voice_delivery");
    expect(trace.tool_admission_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_family: "voice_delivery",
          admitted: true,
          mutating: true,
          reason: "required_by_tool_use_restatement",
        }),
      ]),
    );
  });

  it("does not admit voice delivery from negated or hypothetical read-aloud text", () => {
    for (const prompt of [
      "do not read the last final answer aloud",
      "if later we read the last final answer aloud, what should happen?",
    ]) {
      expect(buildToolUseRestatement(prompt).requiredToolFamilies).not.toContain("voice_delivery");
      expect(interpretHelixAskPrompt(prompt).executable_operator_commands).toEqual([]);
    }
  });
});
