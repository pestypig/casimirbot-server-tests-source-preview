import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimHelixAskTurnTransportExecution,
  readHelixAskTurnTransportReplay,
  rememberHelixAskTurnTransportReplay,
  resetHelixAskTurnTransportReplayForTests,
} from "../ask-turn-transport-replay";

describe("Ask turn stream-to-JSON transport replay", () => {
  beforeEach(resetHelixAskTurnTransportReplayForTests);

  it("reuses the completed payload for the same turn without invoking execution again", () => {
    const execute = vi.fn(() => ({
      turn_id: "turn-replay",
      selected_final_answer: "done",
      runtime_path_identity: { identity_hash: "sha256:same" },
    }));
    const firstPayload = execute();
    rememberHelixAskTurnTransportReplay({
      turnId: "turn-replay",
      sessionId: "session-replay",
      prompt: "same prompt",
      payload: firstPayload,
    });

    const replay = readHelixAskTurnTransportReplay({
      turnId: "turn-replay",
      sessionId: "session-replay",
      prompt: "same prompt",
    });
    expect(replay?.payload).toEqual(firstPayload);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns clones so JSON projection cannot poison the cached SSE result", () => {
    rememberHelixAskTurnTransportReplay({
      turnId: "turn-clone",
      sessionId: "session-clone",
      prompt: "same prompt",
      payload: { turn_id: "turn-clone", debug: { path: "native" } },
    });
    const read = () => readHelixAskTurnTransportReplay({
      turnId: "turn-clone",
      sessionId: "session-clone",
      prompt: "same prompt",
    });
    const first = read();
    (first?.payload.debug as Record<string, unknown>).path = "poisoned";
    expect(read()?.payload).toMatchObject({
      debug: { path: "native" },
    });
  });

  it("does not cache queue-admission responses as completed execution", () => {
    rememberHelixAskTurnTransportReplay({
      turnId: "turn-queued",
      sessionId: "session-queued",
      prompt: "same prompt",
      payload: { ask_turn_admission: { status: "queued" } },
    });
    expect(readHelixAskTurnTransportReplay({
      turnId: "turn-queued",
      sessionId: "session-queued",
      prompt: "same prompt",
    })).toBeNull();
  });

  it("rejects replay when the session or prompt fingerprint differs", () => {
    rememberHelixAskTurnTransportReplay({
      turnId: "turn-bound",
      sessionId: "session-owner",
      prompt: "original prompt",
      payload: { turn_id: "turn-bound", answer: "private result" },
    });
    expect(readHelixAskTurnTransportReplay({
      turnId: "turn-bound",
      sessionId: "session-other",
      prompt: "original prompt",
    })).toBeNull();
    expect(readHelixAskTurnTransportReplay({
      turnId: "turn-bound",
      sessionId: "session-owner",
      prompt: "different prompt",
    })).toBeNull();
  });

  it("blocks a second in-flight execution globally by turn identity", () => {
    expect(claimHelixAskTurnTransportExecution({
      turnId: "turn-in-flight",
      sessionId: "session-owner",
      prompt: "same prompt",
    }).status).toBe("claimed");
    expect(claimHelixAskTurnTransportExecution({
      turnId: "turn-in-flight",
      sessionId: "session-owner",
      prompt: "same prompt",
    }).status).toBe("already_in_flight");
    expect(claimHelixAskTurnTransportExecution({
      turnId: "turn-in-flight",
      sessionId: "session-other",
      prompt: "same prompt",
    }).status).toBe("identity_mismatch");
  });

  it("releases the matching in-flight claim only after completed payload capture", () => {
    const identity = {
      turnId: "turn-completes",
      sessionId: "session-owner",
      prompt: "same prompt",
    };
    expect(claimHelixAskTurnTransportExecution(identity).status).toBe("claimed");
    rememberHelixAskTurnTransportReplay({
      ...identity,
      sourceTransport: "ask_turn_sse",
      payload: { turn_id: identity.turnId, answer: "complete" },
    });
    expect(claimHelixAskTurnTransportExecution(identity).status).toBe("claimed");
  });
});
