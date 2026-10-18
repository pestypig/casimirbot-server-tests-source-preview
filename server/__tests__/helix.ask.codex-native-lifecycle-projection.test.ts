import { describe, expect, it } from "vitest";

import { mergeCodexNativeTranscriptEvents } from "../services/helix-ask/agent-providers/codex-provider";

describe("Helix Ask Codex native public lifecycle projection", () => {
  it("retains every native event with stable ids before the terminal event", () => {
    const nativeEvents = Array.from({ length: 37 }, (_, index) => ({
      id: `codex:native:event:${index}`,
      turn_id: "turn-native-lifecycle",
      source_event_type: "codex_native_runtime_event",
      provider_native_event_type: "ItemCompleted",
      seq: index,
    }));
    const merged = mergeCodexNativeTranscriptEvents({
      reconstructedEvents: [
        {
          id: "turn-native-lifecycle:runtime",
          source_event_type: "runtime_selected",
        },
        {
          id: "turn-native-lifecycle:terminal",
          source_event_type: "terminal_answer",
          type: "final_answer",
        },
      ],
      nativeEvents,
    });

    expect(merged).toHaveLength(39);
    expect(
      merged.filter((event) =>
        String(event.id).startsWith("codex:native:event:"),
      ),
    ).toEqual(nativeEvents);
    expect(merged.at(-1)?.source_event_type).toBe("terminal_answer");
  });

  it("deduplicates repeated native delivery by stable event id", () => {
    const repeated = {
      id: "codex:native:tool:call-1",
      source_event_type: "codex_native_tool_request",
    };
    const merged = mergeCodexNativeTranscriptEvents({
      reconstructedEvents: [],
      nativeEvents: [repeated, { ...repeated }],
    });

    expect(merged).toEqual([repeated]);
  });
});
