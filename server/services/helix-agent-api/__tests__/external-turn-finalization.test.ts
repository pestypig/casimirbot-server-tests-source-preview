import { describe, expect, it, vi } from "vitest";
import { wasHelixAskTurnPayloadFinalized } from "../../helix-ask/turn-finalization-completion";
import { finalizeExternalTurnPayload } from "../external-turn-finalization";

vi.mock("../../helix-ask/turn-finalization-completion", () => ({
  wasHelixAskTurnPayloadFinalized: vi.fn(() => false),
}));

const ids = { threadId: "session-one", turnId: "turn-one" };
const terminalEnvelope = {
  terminal_text: "The bounded answer.",
  final_answer_source: "model_synthesis",
  terminal_artifact_kind: "model_answer",
};
const finalizedPayload = () => ({
  ok: true,
  terminal_answer_envelope: {
    schema: "helix.terminal_answer_envelope.v1",
    turn_id: ids.turnId,
    thread_id: ids.threadId,
  },
  resolved_turn_summary: { turn_id: ids.turnId },
  terminal_answer_authority: { terminal_kind: "final_answer" },
  terminal_grounding_authority: { ok: true },
  terminal_presentation_coverage_audit: { ok: true },
});

describe("external Ask turn finalization", () => {
  it("keeps the exact object after the canonical finalizer completed, even if legacy fields are absent", () => {
    const payload = { ok: true };
    vi.mocked(wasHelixAskTurnPayloadFinalized).mockReturnValueOnce(true);
    const resolveEnvelope = vi.fn(() => terminalEnvelope);
    const finalizeTurn = vi.fn(() => payload);
    expect(finalizeExternalTurnPayload({ payload, ...ids, resolveEnvelope, finalizeTurn })).toBe(payload);
    expect(wasHelixAskTurnPayloadFinalized).toHaveBeenCalledWith({ payload, ...ids });
    expect(resolveEnvelope).not.toHaveBeenCalled();
    expect(finalizeTurn).not.toHaveBeenCalled();
  });

  it("keeps a fully finalized exact turn without running another terminal writer", () => {
    const payload = finalizedPayload();
    const resolveEnvelope = vi.fn(() => terminalEnvelope);
    const finalizeTurn = vi.fn(() => payload);
    expect(finalizeExternalTurnPayload({ payload, ...ids, resolveEnvelope, finalizeTurn })).toBe(payload);
    expect(resolveEnvelope).not.toHaveBeenCalled();
    expect(finalizeTurn).not.toHaveBeenCalled();
  });

  it("runs the canonical finalizer when only an envelope exists or its identity differs", () => {
    const payload = finalizedPayload();
    delete (payload as { terminal_grounding_authority?: unknown }).terminal_grounding_authority;
    const resolveEnvelope = vi.fn(() => terminalEnvelope);
    const finalizeTurn = vi.fn((envelope) => ({ ...payload, text: envelope.terminal_text }));
    const result = finalizeExternalTurnPayload({ payload, ...ids, resolveEnvelope, finalizeTurn });
    expect(result.text).toBe("The bounded answer.");
    expect(resolveEnvelope).toHaveBeenCalledOnce();
    expect(finalizeTurn).toHaveBeenCalledWith(terminalEnvelope);

    const wrongTurn = { ...finalizedPayload(), terminal_answer_envelope: {
      schema: "helix.terminal_answer_envelope.v1", turn_id: "another-turn", thread_id: ids.threadId,
    } };
    finalizeExternalTurnPayload({ payload: wrongTurn, ...ids, resolveEnvelope, finalizeTurn });
    expect(finalizeTurn).toHaveBeenCalledTimes(2);
  });

  it("returns a safe stage without exposing exception content", () => {
    const payload = { ok: true };
    expect(() => finalizeExternalTurnPayload({
      payload, ...ids,
      resolveEnvelope: () => { throw new Error("private provider content"); },
      finalizeTurn: vi.fn(),
    })).toThrowError(expect.objectContaining({ finalizationStage: "terminal_envelope" }));
    expect(() => finalizeExternalTurnPayload({
      payload, ...ids,
      resolveEnvelope: () => terminalEnvelope,
      finalizeTurn: () => { throw new Error("private provider content"); },
    })).toThrowError(expect.objectContaining({ finalizationStage: "turn_finalizer" }));
  });
});
