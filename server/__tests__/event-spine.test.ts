import { describe, it, expect, beforeEach } from "vitest";
import { createEventSpine, __resetEventSpine, emitEventSpine, getEventSpineRecent, getEventSpineStats } from "../services/observability/event-spine";

beforeEach(() => {
  __resetEventSpine();
});

describe("event spine", () => {
  it("emits canonical envelopes in deterministic sequence order", () => {
    const spine = createEventSpine({
      capacity: 8,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      eventId: (() => {
        let n = 0;
        return () => `evt-${++n}`;
      })(),
      payloadHash: (value) => `hash:${JSON.stringify(value)}`,
    });

    const one = spine.emit({ kind: "tool.start", traceId: "t1", payload: { a: 1 } });
    const two = spine.emit({ kind: "adapter.verdict", traceId: "t1", payload: { verdict: "PASS" } });

    expect(one).toMatchObject({
      eventId: "evt-1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      kind: "tool.start",
      traceId: "t1",
      payloadHash: 'hash:{"a":1}',
    });
    expect(two.seq).toBe(2);
    expect(spine.recent().map((entry) => entry.eventId)).toEqual(["evt-1", "evt-2"]);
  });

  it("drops oldest events on overflow and increments dropped counter", () => {
    const spine = createEventSpine({ capacity: 2, eventId: (() => { let n = 0; return () => `e${++n}`; })() });
    spine.emit({ kind: "tool.start", payload: { i: 1 } });
    spine.emit({ kind: "tool.success", payload: { i: 2 } });
    spine.emit({ kind: "tool.error", payload: { i: 3 } });

    expect(spine.recent().map((entry) => entry.eventId)).toEqual(["e2", "e3"]);
    expect(spine.stats().dropped).toBe(1);
  });

  it("records global spine entries for integration callers", () => {
    const emitted = emitEventSpine({ kind: "nav.pose", traceId: "trace-nav", payload: { x: 1 } });
    const recent = getEventSpineRecent(1);
    expect(recent[0]?.eventId).toBe(emitted.eventId);
    expect(getEventSpineStats().totalEmitted).toBeGreaterThan(0);
  });
});
