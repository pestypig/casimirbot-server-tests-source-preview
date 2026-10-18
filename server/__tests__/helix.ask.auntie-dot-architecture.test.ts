import { describe, expect, it } from "vitest";
import {
  buildHelixAskTypedItemDebugExport,
  CODEX_ITEM_KIND_TO_HELIX_THREAD_ITEM_TYPE,
  makeHelixAskTypedItemLifecycleEvent,
  toHelixAskTypedItem,
  toHelixAskTypedItemLifecycleEvent,
} from "../services/helix-ask/ask-typed-item-adapter";
import type { HelixThreadEvent, HelixThreadItem } from "../services/helix-thread/types";
import { HELIX_ASK_TYPED_ITEM_SCHEMA } from "@shared/helix-ask-typed-item";

const baseThreadItem = (overrides: Partial<HelixThreadItem> = {}): HelixThreadItem => ({
  thread_id: "thread:auntie-dot",
  turn_id: "turn:auntie-dot",
  item_id: "item:observation",
  item_type: "toolObservation",
  item_status: "completed",
  item_stream: "observation",
  started_at: "2026-05-19T00:00:00.000Z",
  updated_at: "2026-05-19T00:00:01.000Z",
  completed_at: "2026-05-19T00:00:01.000Z",
  text: "screen observation recorded",
  delta_count: 1,
  last_seq: 4,
  source_item_ids: ["observation:screen:1"],
  claim_links: null,
  observation_ref: {
    evidence_refs: ["visual_evidence:screen:1"],
  },
  meta: null,
  ...overrides,
});

const baseThreadEvent = (overrides: Partial<HelixThreadEvent> = {}): HelixThreadEvent => ({
  kind: "helix.thread.event",
  version: 1,
  event_id: "event:item-started",
  seq: 1,
  ts: "2026-05-19T00:00:00.000Z",
  thread_id: "thread:auntie-dot",
  route: "/ask",
  event_type: "item_started",
  turn_id: "turn:auntie-dot",
  session_id: null,
  trace_id: null,
  user_text: null,
  assistant_text: null,
  classifier_result: null,
  route_reason: null,
  brief_status: null,
  final_gate_outcome: null,
  fail_reason: null,
  thread_status: null,
  turn_kind: "ask",
  item_id: "item:observation",
  item_type: "toolObservation",
  item_status: "in_progress",
  item_stream: "observation",
  delta_text: null,
  request_id: null,
  request_kind: null,
  request_payload: null,
  observation_ref: null,
  source_item_ids: null,
  claim_links: null,
  answer_surface_mode: null,
  memory_citation: null,
  meta: null,
  ...overrides,
});

describe("helix ask Auntie Dot architecture typed item discipline", () => {
  it("wraps live artifacts in helix.ask_typed_item.v1 before terminal completion", () => {
    const item = toHelixAskTypedItem({ item: baseThreadItem() });

    expect(item).toMatchObject({
      schema: HELIX_ASK_TYPED_ITEM_SCHEMA,
      thread_id: "thread:auntie-dot",
      turn_id: "turn:auntie-dot",
      item_id: "item:observation",
      item_kind: "tool_observation",
      status: "completed",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(item.evidence_refs).toEqual(
      expect.arrayContaining(["observation:screen:1", "visual_evidence:screen:1"]),
    );

    const exportPayload = buildHelixAskTypedItemDebugExport({
      threadId: "thread:auntie-dot",
      turnId: "turn:auntie-dot",
      items: [item],
      events: [
        makeHelixAskTypedItemLifecycleEvent({
          event_type: "item.completed",
          thread_id: "thread:auntie-dot",
          turn_id: "turn:auntie-dot",
          item_id: "item:observation",
          item_kind: item.item_kind,
          status: item.status,
          created_at: "2026-05-19T00:00:01.000Z",
        }),
      ],
      createdAt: "2026-05-19T00:00:02.000Z",
    });

    expect(exportPayload.items).toHaveLength(1);
    expect(exportPayload.events[0]?.event_type).toBe("item.completed");
    expect(exportPayload.assistant_answer_item_count).toBe(0);
    expect(exportPayload.assistant_answer).toBe(false);
  });

  it("rejects schema-less items from debug export", () => {
    const item = toHelixAskTypedItem({ item: baseThreadItem() });
    const schemaLess = { ...item, schema: undefined } as any;

    expect(() =>
      buildHelixAskTypedItemDebugExport({
        threadId: "thread:auntie-dot",
        turnId: "turn:auntie-dot",
        items: [schemaLess],
      }),
    ).toThrow(/missing_schema/);
  });

  it("allows assistant_answer true only on the single terminal item", () => {
    const terminal = toHelixAskTypedItem({
      item: baseThreadItem({
        item_id: "item:terminal",
        item_type: "answer",
        text: "The live source shows a bound visual observation.",
      }),
      terminalItemId: "item:terminal",
      terminalAssistantAnswer: true,
    });

    expect(terminal.item_kind).toBe("terminal_assistant_answer");
    expect(terminal.assistant_answer).toBe(true);

    const secondTerminal = { ...terminal, item_id: "item:terminal:second" };
    expect(() =>
      buildHelixAskTypedItemDebugExport({
        threadId: "thread:auntie-dot",
        turnId: "turn:auntie-dot",
        items: [terminal, secondTerminal],
        terminalItemId: "item:terminal",
      }),
    ).toThrow(/multiple_terminal_answers/);

    expect(() =>
      buildHelixAskTypedItemDebugExport({
        threadId: "thread:auntie-dot",
        turnId: "turn:auntie-dot",
        items: [{ ...terminal, item_kind: "agent_message" }],
      }),
    ).toThrow(/assistant_answer_not_terminal/);
  });

  it("maps failed turns to explicit turn.failed lifecycle events", () => {
    const failed = toHelixAskTypedItemLifecycleEvent(
      baseThreadEvent({
        event_id: "event:turn-failed",
        event_type: "turn_failed",
        item_id: null,
        item_type: null,
        item_status: null,
        fail_reason: "source_binding_missing",
      }),
    );

    expect(failed).toMatchObject({
      event_type: "turn.failed",
      thread_id: "thread:auntie-dot",
      turn_id: "turn:auntie-dot",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("preserves Codex item kinds in the ThreadItem compatibility mapping", () => {
    expect(CODEX_ITEM_KIND_TO_HELIX_THREAD_ITEM_TYPE).toMatchObject({
      agent_message: "answer",
      reasoning: "validation",
      command_execution: "commandExecution",
      file_change: "toolObservation",
      mcp_tool_call: "dynamicToolCall",
      web_search: "retrieval",
      todo_list: "plan",
      error: "validation",
    });
  });
});
