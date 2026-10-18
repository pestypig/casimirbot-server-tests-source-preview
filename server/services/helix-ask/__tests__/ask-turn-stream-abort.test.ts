import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createHelixAskTurnHttpAbortBoundary,
  createHelixAskTurnStreamAbortBoundary,
} from "../ask-turn-stream-abort";

describe("Helix Ask stream abort boundary", () => {
  it("aborts unfinished provider work when the response closes", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const boundary = createHelixAskTurnStreamAbortBoundary({
      request: request as never,
      response: response as never,
    });

    response.emit("close");

    expect(boundary.signal.aborted).toBe(true);
    boundary.dispose();
  });

  it("does not turn a normal completed response close into cancellation", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: true });
    const boundary = createHelixAskTurnStreamAbortBoundary({
      request: request as never,
      response: response as never,
    });

    response.emit("close");

    expect(boundary.signal.aborted).toBe(false);
    boundary.dispose();
  });

  it("propagates disconnect cancellation for the non-stream Ask transport", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const boundary = createHelixAskTurnHttpAbortBoundary({
      request: request as never,
      response: response as never,
      reasonPrefix: "ask_turn",
    });

    request.emit("aborted");

    expect(boundary.signal.aborted).toBe(true);
    expect((boundary.signal.reason as Error).message).toBe(
      "ask_turn_request_aborted",
    );
    boundary.dispose();
  });

  it("removes transport listeners after the turn is complete", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const boundary = createHelixAskTurnHttpAbortBoundary({
      request: request as never,
      response: response as never,
      reasonPrefix: "ask_turn",
    });

    boundary.dispose();
    response.emit("close");

    expect(boundary.signal.aborted).toBe(false);
  });

  it("starts aborted when the client disconnected before listeners were attached", () => {
    const request = Object.assign(new EventEmitter(), { aborted: true });
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
    });
    const boundary = createHelixAskTurnHttpAbortBoundary({
      request: request as never,
      response: response as never,
      reasonPrefix: "ask_turn",
    });

    expect(boundary.signal.aborted).toBe(true);
    boundary.dispose();
  });
});
