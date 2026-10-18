import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHelixAskTurnJournal,
  buildHelixAskTurnRecovery,
  getHelixAskTurnCheckpointPath,
  readHelixAskTurnCheckpointRecords,
  recordHelixAskTurnCheckpoint,
} from "../turn-checkpoint-store";

describe("Helix Ask turn checkpoint store", () => {
  let tempDir: string;
  let priorPath: string | undefined;
  let priorPersist: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-ask-turn-checkpoints-"));
    priorPath = process.env.HELIX_ASK_TURN_CHECKPOINT_PATH;
    priorPersist = process.env.HELIX_ASK_TURN_CHECKPOINT_PERSIST;
    process.env.HELIX_ASK_TURN_CHECKPOINT_PATH = path.join(tempDir, "checkpoints.jsonl");
    delete process.env.HELIX_ASK_TURN_CHECKPOINT_PERSIST;
  });

  afterEach(() => {
    if (priorPath === undefined) {
      delete process.env.HELIX_ASK_TURN_CHECKPOINT_PATH;
    } else {
      process.env.HELIX_ASK_TURN_CHECKPOINT_PATH = priorPath;
    }
    if (priorPersist === undefined) {
      delete process.env.HELIX_ASK_TURN_CHECKPOINT_PERSIST;
    } else {
      process.env.HELIX_ASK_TURN_CHECKPOINT_PERSIST = priorPersist;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists visible turn checkpoints and rebuilds recovery after memory loss", () => {
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-a",
      turn_id: "turn-a",
      session_id: "thread-a",
      trace_id: "trace-a",
      route: "/ask/turn/stream",
      checkpoint_type: "turn_started",
      status: "running",
      prompt_text: "Summarize the current workspace state.",
      recorded_at: "2026-06-13T10:00:00.000Z",
    });
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-a",
      turn_id: "turn-a",
      session_id: "thread-a",
      trace_id: "trace-a",
      route: "/ask/turn/stream",
      checkpoint_type: "transcript_event",
      status: "checkpointed",
      prompt_text: "Summarize the current workspace state.",
      transcript_event: {
        id: "transcript:1:public_commentary",
        turn_id: "turn-a",
        seq: 1,
        at_ms: 1_780_000_000_000,
        role: "agent",
        type: "public_commentary",
        status: "running",
        text: "Checking workspace status before answering.",
        event_source: "live",
      },
      recorded_at: "2026-06-13T10:00:01.000Z",
    });
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-a",
      turn_id: "turn-a",
      session_id: "thread-a",
      trace_id: "trace-a",
      route: "/ask/turn/stream",
      checkpoint_type: "terminal_payload",
      status: "final_answer",
      prompt_text: "Summarize the current workspace state.",
      terminal_text: "Workspace status is available.",
      terminal_text_hash: "hash:terminal",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      recorded_at: "2026-06-13T10:00:02.000Z",
    });

    expect(fs.existsSync(getHelixAskTurnCheckpointPath())).toBe(true);
    const records = readHelixAskTurnCheckpointRecords({
      thread_id: "thread-a",
      turn_id: "turn-a",
    });
    expect(records).toHaveLength(3);

    const recovery = buildHelixAskTurnRecovery({
      thread_id: "thread-a",
      turn_id: "turn-a",
    });
    expect(recovery.schema).toBe("helix.ask.turn_recovery.v1");
    expect(recovery.recoverable).toBe(true);
    expect(recovery.status).toBe("final_answer");
    expect(recovery.latest_visible_text).toBe("Checking workspace status before answering.");
    expect(recovery.terminal_text).toBe("Workspace status is available.");
    expect(recovery.terminal_text_hash).toBe("hash:terminal");
    expect(recovery.authority).toEqual({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      terminal_ineligible_reason: "ask_turn_checkpoint_is_recovery_context_only",
    });
  });

  it("keeps checkpoint records non-terminal and sanitized", () => {
    const record = recordHelixAskTurnCheckpoint({
      thread_id: "thread-b",
      turn_id: "turn-b",
      route: "/ask/turn/stream",
      checkpoint_type: "transcript_event",
      status: "checkpointed",
      transcript_event: {
        id: "transcript:tool",
        at_ms: 1,
        role: "tool",
        type: "tool_result",
        text: "Observed artifacts: workspace_os.status",
        detail: "artifact contract satisfied",
        raw_content_included: true,
      },
    });

    expect(record.authority.assistant_answer).toBe(false);
    expect(record.authority.raw_content_included).toBe(false);
    expect(record.authority.terminal_eligible).toBe(false);
    expect(record.transcript_event).toMatchObject({
      text: "Observed artifacts: workspace_os.status",
      detail: "artifact contract satisfied",
    });
    expect(record.transcript_event).not.toHaveProperty("raw_content_included");
  });

  it("builds a latest-turn journal scoped by thread and session", () => {
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-journal",
      turn_id: "turn-old",
      session_id: "session-a",
      route: "/ask/turn",
      checkpoint_type: "turn_started",
      status: "running",
      prompt_text: "Older prompt",
      recorded_at: "2026-06-13T10:00:00.000Z",
    });
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-journal",
      turn_id: "turn-old",
      session_id: "session-a",
      route: "/ask/turn",
      checkpoint_type: "turn_completed",
      status: "completed",
      prompt_text: "Older prompt",
      recorded_at: "2026-06-13T10:00:01.000Z",
    });
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-journal",
      turn_id: "turn-new",
      session_id: "session-a",
      trace_id: "trace-new",
      route: "/ask/turn/stream",
      checkpoint_type: "turn_started",
      status: "running",
      prompt_text: "New prompt",
      recorded_at: "2026-06-13T10:01:00.000Z",
    });
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-journal",
      turn_id: "turn-new",
      session_id: "session-a",
      trace_id: "trace-new",
      route: "/ask/turn/stream",
      checkpoint_type: "transcript_event",
      status: "checkpointed",
      prompt_text: "New prompt",
      transcript_event: {
        id: "transcript:new",
        at_ms: 1,
        role: "agent",
        type: "public_commentary",
        text: "Running a status check.",
      },
      recorded_at: "2026-06-13T10:01:01.000Z",
    });
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-journal",
      turn_id: "turn-other-session",
      session_id: "session-b",
      route: "/ask/turn",
      checkpoint_type: "turn_started",
      status: "running",
      prompt_text: "Other session prompt",
      recorded_at: "2026-06-13T10:02:00.000Z",
    });

    const journal = buildHelixAskTurnJournal({
      thread_id: "thread-journal",
      session_id: "session-a",
    });

    expect(journal.schema).toBe("helix.ask.turn_journal.v1");
    expect(journal.turn_id).toBe("turn-new");
    expect(journal.recovery?.recoverable).toBe(true);
    expect(journal.recovery?.latest_visible_text).toBe("Running a status check.");
    expect(journal.summary.latest_turn_id).toBe("turn-new");
    expect(journal.summary.recoverable_turn_count).toBe(2);
    expect(journal.records.map((record) => record.turn_id)).toEqual(["turn-new", "turn-new"]);
    expect(journal.authority).toEqual({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      terminal_ineligible_reason: "ask_turn_checkpoint_is_recovery_context_only",
    });
  });

  it("scans the latest journal without reading the complete JSONL file into one string", () => {
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-streamed",
      turn_id: "turn-streamed",
      session_id: "session-streamed",
      route: "/ask/turn",
      checkpoint_type: "turn_started",
      status: "running",
      prompt_text: "Stream the journal.",
      recorded_at: "2026-06-13T10:03:00.000Z",
    });
    const readFile = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation(() => {
        throw new Error("unbounded_checkpoint_read");
      });
    try {
      const journal = buildHelixAskTurnJournal({
        thread_id: "thread-streamed",
        session_id: "session-streamed",
      });
      expect(journal.turn_id).toBe("turn-streamed");
      expect(journal.records).toHaveLength(1);
      expect(journal.summary.checkpoint_count).toBe(1);
    } finally {
      readFile.mockRestore();
    }
  });

  it("returns an empty non-terminal journal when no scoped checkpoints exist", () => {
    recordHelixAskTurnCheckpoint({
      thread_id: "thread-present",
      turn_id: "turn-present",
      session_id: "session-present",
      route: "/ask/turn",
      checkpoint_type: "turn_started",
      status: "running",
      prompt_text: "Visible prompt",
    });

    const journal = buildHelixAskTurnJournal({
      thread_id: "thread-missing",
      session_id: "session-missing",
    });

    expect(journal.schema).toBe("helix.ask.turn_journal.v1");
    expect(journal.turn_id).toBeNull();
    expect(journal.records).toEqual([]);
    expect(journal.recovery).toBeNull();
    expect(journal.summary.checkpoint_count).toBe(0);
    expect(journal.authority.assistant_answer).toBe(false);
    expect(journal.authority.terminal_eligible).toBe(false);
  });
});
