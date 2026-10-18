import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { finalizeExternalTurnPayload } from "../../helix-agent-api/external-turn-finalization";
import {
  carryHelixAskTurnPayloadFinalization,
  recordHelixAskTurnPayloadFinalized,
  wasHelixAskTurnPayloadFinalized,
} from "../turn-finalization-completion";

const ids = { threadId: "session-one", turnId: "turn-one" };

describe("Ask turn finalization completion", () => {
  it("carries completion to a slim response projection for the same turn", () => {
    const payload = { debug: { detailed: true } };
    recordHelixAskTurnPayloadFinalized({ payload, ...ids });
    const projection = carryHelixAskTurnPayloadFinalization(payload, {
      ...payload,
      debug: { summary: true },
    });

    expect(projection).not.toBe(payload);
    expect(wasHelixAskTurnPayloadFinalized({ payload: projection, ...ids })).toBe(true);
    expect(wasHelixAskTurnPayloadFinalized({ payload: projection, ...ids, turnId: "other-turn" })).toBe(false);
    expect(wasHelixAskTurnPayloadFinalized({ payload: projection, ...ids, threadId: "other-session" })).toBe(false);

    const resolveEnvelope = vi.fn(() => ({
      terminal_text: "duplicate",
      final_answer_source: "model_synthesis",
      terminal_artifact_kind: "model_answer",
    }));
    const finalizeTurn = vi.fn(() => projection);
    expect(finalizeExternalTurnPayload({
      payload: projection,
      ...ids,
      resolveEnvelope,
      finalizeTurn,
    })).toBe(projection);
    expect(resolveEnvelope).not.toHaveBeenCalled();
    expect(finalizeTurn).not.toHaveBeenCalled();
  });

  it("does not mark an unfinalized projection complete", () => {
    const payload = { text: "unfinished" };
    const projection = carryHelixAskTurnPayloadFinalization(payload, { ...payload });
    expect(wasHelixAskTurnPayloadFinalized({ payload: projection, ...ids })).toBe(false);
  });
});
