import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import {
  CODEX_PARITY_AGENT_SPINE_CLASSES,
  CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS,
  CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES,
  CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
  CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES,
  CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS,
  CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS,
  isCodexParityAgentSpineRailFailureCode,
} from "../services/helix-ask/codex-parity-agent-spine-contract";
import { runtimeMemoryGovernor } from "../services/runtime/runtime-memory-governor";
import {
  listStagePlayLiveSourceMailWakeResults,
  markStagePlayMailWakeRetryable,
  queueStagePlayLiveSourceMailWakeRequest,
  recordStagePlayMailWakeResult,
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-wake-store";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

beforeEach(() => {
  delete process.env.HELIX_ASK_DEFAULT_PINNED_MODEL;
  resetStagePlayLiveSourceMailWakeStoreForTest();
  runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
});

const expectNullableStringField = (record: Record<string, unknown>, key: string): void => {
  expect(record).toHaveProperty(key);
  const value = record[key];
  expect(value === null || typeof value === "string").toBe(true);
};

const expectNonEmptyStringArrayField = (record: Record<string, unknown>, key: string): void => {
  expect(record).toHaveProperty(key);
  expect(Array.isArray(record[key])).toBe(true);
  expect((record[key] as unknown[]).every((entry) => typeof entry === "string" && entry.trim().length > 0)).toBe(true);
};

const expectVisibleToolSurfaceMetadata = (record: Record<string, unknown>): void => {
  expect(record).toHaveProperty("visible_tool_surface_original_count");
  expect(record).toHaveProperty("visible_tool_surface_truncated");
  expect(typeof record.visible_tool_surface_original_count).toBe("number");
  expect(Number.isInteger(record.visible_tool_surface_original_count)).toBe(true);
  expect((record.visible_tool_surface_original_count as number)).toBeGreaterThanOrEqual(0);
  expect(typeof record.visible_tool_surface_truncated).toBe("boolean");
  const visibleSurfaceLength = Array.isArray(record.visible_tool_surface) ? record.visible_tool_surface.length : 0;
  expect((record.visible_tool_surface_original_count as number)).toBeGreaterThanOrEqual(visibleSurfaceLength);
  if (record.visible_tool_surface_truncated === true) {
    expect((record.visible_tool_surface_original_count as number)).toBeGreaterThan(visibleSurfaceLength);
  } else {
    expect(record.visible_tool_surface_original_count).toBe(visibleSurfaceLength);
  }
};

const expectCodexParityRailTableShape = (railTable: Record<string, unknown>, turnId: string): void => {
  expect(railTable).toMatchObject({
    schema: CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
    turn_id: turnId,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  });
  expectNullableStringField(railTable, "prompt");
  expectNonEmptyStringArrayField(railTable, "visible_tool_surface");
  expectVisibleToolSurfaceMetadata(railTable);
  expectNonEmptyStringArrayField(railTable, "required_observation_kinds_for_requested_capability");
  if (railTable.requested_capability) {
    expect((railTable.required_observation_kinds_for_requested_capability as unknown[]).length).toBeGreaterThan(0);
  }
  for (const key of CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS) {
    expectNullableStringField(railTable, key);
  }
  expect(CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES).toContain(railTable.reentry_status as never);
  expect(CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES).toContain(railTable.rail_status as never);
  expect(CODEX_PARITY_AGENT_SPINE_CLASSES).toContain(railTable.codex_parity_class as never);
  if (railTable.codex_parity_class === "complete" || railTable.rail_status === "complete") {
    expect(railTable.first_broken_rail).toBeNull();
    expect(railTable.rail_failure_code).toBeNull();
  } else {
    expect(typeof railTable.first_broken_rail).toBe("string");
    expect(String(railTable.first_broken_rail).length).toBeGreaterThan(0);
    expect(CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS).toContain(railTable.first_broken_rail as never);
    expect(typeof railTable.rail_failure_code).toBe("string");
    expect(String(railTable.rail_failure_code).length).toBeGreaterThan(0);
    expect(isCodexParityAgentSpineRailFailureCode(railTable.rail_failure_code)).toBe(true);
    expect(typeof railTable.repair_target).toBe("string");
    expect(String(railTable.repair_target).length).toBeGreaterThan(0);
    expect(CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS).toContain(railTable.repair_target as never);
  }
};

describe("helix ask E68 debug export endpoint", () => {
  it("returns a canonical active-turn debug export matching the completed turn", async () => {
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        languageModelProfile: "balanced",
        sessionId: `e68-debug-export-${Date.now()}`,
      })
      .expect(200);

    const turnId = turn.body?.turn_id;
    expect(turnId).toBeTruthy();
    expect(turn.body?.language_model_policy).toMatchObject({
      requested_profile: "balanced",
      resolved_profile: "balanced",
      reasoning_effort: "medium",
      selection_source: "user_selected",
      persistence_scope: "session",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(turn.body?.language_model_debug_summary).toContain("AI: Balanced -> Balanced");
    expect(turn.body?.debug?.language_model_policy).toMatchObject({
      requested_profile: "balanced",
      resolved_profile: "balanced",
    });
    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);

    expect(debugExport.body?.ok).toBe(true);
    expect(debugExport.body?.payload?.schema).toBe("helix.ask.debug_export.v1");
    expect(debugExport.body?.payload?.active_turn_id).toBe(turnId);
    expect(debugExport.body?.payload?.active_prompt).toBe("Open Scientific Calculator");
    expect(debugExport.body?.payload?.selected_final_answer).toBe(turn.body?.selected_final_answer);
    expect(debugExport.body?.payload?.resolved_turn_summary?.terminal_artifact_kind).toBe(turn.body?.terminal_artifact_kind);
    expect(debugExport.body?.payload?.payload_hash).toEqual(expect.any(String));
    expect(debugExport.body?.payload?.language_model_policy).toMatchObject({
      requested_profile: "balanced",
      resolved_profile: "balanced",
      resolved_model: expect.any(String),
      reasoning_effort: "medium",
      selection_source: "user_selected",
      persistence_scope: "session",
      account_policy: "user",
    });
    expect(debugExport.body?.payload?.debug?.language_model_policy).toMatchObject({
      requested_profile: "balanced",
      resolved_profile: "balanced",
    });
    expect(debugExport.body?.payload?.debug?.language_model_debug_summary).toContain("AI: Balanced -> Balanced");
    expect(debugExport.body.payload.payload_hash.length).toBeGreaterThan(12);
    expect(Array.isArray(debugExport.body?.payload?.current_turn_artifact_ledger)).toBe(true);
    expect(debugExport.body?.payload).toHaveProperty("terminal_candidate_rejections");
    expect(debugExport.body?.payload).toHaveProperty("evidence_reentry_proof");
    expect(debugExport.body?.payload).toHaveProperty("terminal_authority_single_writer");
    expect(debugExport.body?.payload?.artifact_query_index).toMatchObject({
      schema: "helix.artifact_query_index.v1",
      turn_id: turnId,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    const indexedRailTable = debugExport.body?.payload?.artifact_query_index?.codex_parity_agent_spine_rail_table;
    const payloadRailTable = debugExport.body?.payload?.codex_parity_agent_spine_rail_table;
    const debugRailTable = debugExport.body?.payload?.debug?.codex_parity_agent_spine_rail_table;
    const debugIndexedRailTable =
      debugExport.body?.payload?.debug?.artifact_query_index?.codex_parity_agent_spine_rail_table;
    expect(indexedRailTable && typeof indexedRailTable === "object" && !Array.isArray(indexedRailTable)).toBe(true);
    expect(payloadRailTable && typeof payloadRailTable === "object" && !Array.isArray(payloadRailTable)).toBe(true);
    expect(debugRailTable && typeof debugRailTable === "object" && !Array.isArray(debugRailTable)).toBe(true);
    expect(debugIndexedRailTable && typeof debugIndexedRailTable === "object" && !Array.isArray(debugIndexedRailTable)).toBe(true);
    expectCodexParityRailTableShape(indexedRailTable as Record<string, unknown>, turnId);
    expectCodexParityRailTableShape(payloadRailTable as Record<string, unknown>, turnId);
    expectCodexParityRailTableShape(debugRailTable as Record<string, unknown>, turnId);
    expectCodexParityRailTableShape(debugIndexedRailTable as Record<string, unknown>, turnId);
    expect(indexedRailTable.prompt).toBe("Open Scientific Calculator");
    expect(payloadRailTable.prompt).toBe("Open Scientific Calculator");
    expect(debugRailTable.prompt).toBe("Open Scientific Calculator");
    expect(debugIndexedRailTable.prompt).toBe("Open Scientific Calculator");
    expect(debugRailTable).toMatchObject({
      codex_parity_class: payloadRailTable.codex_parity_class,
      first_broken_rail: payloadRailTable.first_broken_rail,
      repair_target: payloadRailTable.repair_target,
    });
    expect(indexedRailTable).toMatchObject({
      codex_parity_class: payloadRailTable.codex_parity_class,
      first_broken_rail: payloadRailTable.first_broken_rail,
      repair_target: payloadRailTable.repair_target,
    });
    expect(debugIndexedRailTable).toMatchObject({
      codex_parity_class: payloadRailTable.codex_parity_class,
      first_broken_rail: payloadRailTable.first_broken_rail,
      repair_target: payloadRailTable.repair_target,
    });
    expect(indexedRailTable).toEqual(payloadRailTable);
    expect(debugRailTable).toEqual(payloadRailTable);
    expect(debugIndexedRailTable).toEqual(payloadRailTable);
    expect(debugExport.body?.payload?.tool_turn_chain_audit).toMatchObject({
      schema: "helix.tool_turn_chain_audit.v1",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(debugExport.body?.payload?.tool_rail_failure_triage).toMatchObject({
      schema: "helix.tool_rail_failure_triage.v1",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(Array.isArray(debugExport.body?.payload?.tool_turn_chain_family_matrix)).toBe(true);
    expect(Array.isArray(debugExport.body?.payload?.artifact_query_index?.artifact_refs)).toBe(true);
    expect(Array.isArray(debugExport.body?.payload?.artifact_query_index?.queryable_artifact_keys)).toBe(true);
  }, 60000);

  it("pins a low-cost model across the Ask API, debug export, and session continuation", async () => {
    const app = createApp();
    const sessionId = `e68-pinned-model-${Date.now()}`;
    const firstTurn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId,
        languageModelSelection: {
          mode: "pinned",
          model: "gpt-5.4-mini",
        },
      })
      .expect(200);

    expect(firstTurn.body?.language_model_policy).toMatchObject({
      requested_selection_mode: "pinned",
      selection_mode: "pinned",
      resolved_model: "gpt-5.4-mini",
      reasoning_effort: "low",
      selection_source: "operator_pinned",
      persistence_scope: "session",
      pinned_model_requested: true,
      pinned_model: "gpt-5.4-mini",
      pinned_model_allowed: true,
      pinned_model_rejected_reason: null,
    });
    expect(firstTurn.body?.language_model_debug_summary).toContain(
      "AI: Pinned | gpt-5.4-mini | reasoning: low | session-local",
    );

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(firstTurn.body?.turn_id)}/debug-export`)
      .expect(200);

    expect(debugExport.body?.payload?.language_model_policy).toMatchObject({
      requested_selection_mode: "pinned",
      selection_mode: "pinned",
      resolved_model: "gpt-5.4-mini",
      reasoning_effort: "low",
      selection_source: "operator_pinned",
      pinned_model: "gpt-5.4-mini",
      pinned_model_allowed: true,
    });
    expect(debugExport.body?.payload?.debug?.language_model_policy).toMatchObject({
      selection_mode: "pinned",
      resolved_model: "gpt-5.4-mini",
    });

    const continuedTurn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(continuedTurn.body?.language_model_policy).toMatchObject({
      requested_selection_mode: "pinned",
      selection_mode: "pinned",
      resolved_model: "gpt-5.4-mini",
      reasoning_effort: "low",
      selection_source: "operator_pinned",
      persistence_scope: "session",
      pinned_model: "gpt-5.4-mini",
      pinned_model_allowed: true,
    });
  }, 60000);

  it("accepts the simple language_model API alias as a public low-cost pin", async () => {
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        language_model: "gpt-5.4-mini",
      })
      .expect(200);

    expect(turn.body?.language_model_policy).toMatchObject({
      account_policy: "user",
      requested_selection_mode: "pinned",
      selection_mode: "pinned",
      resolved_model: "gpt-5.4-mini",
      reasoning_effort: "low",
      pinned_model_allowed: true,
    });

    const unsupportedTurn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        language_model_selection: { mode: "pinned", model: "gpt-5.5" },
      })
      .expect(200);

    expect(unsupportedTurn.body?.language_model_policy).toMatchObject({
      account_policy: "user",
      selection_mode: "pinned",
      selection_source: "policy_downgrade",
      resolved_model: "gpt-5.4-mini",
      pinned_model_allowed: false,
      pinned_model_rejected_reason: "pinned_model_missing_or_not_allowlisted",
    });
  }, 60000);

  it("uses the configured low-cost default only when the turn has no explicit model choice", async () => {
    process.env.HELIX_ASK_DEFAULT_PINNED_MODEL = "gpt-5.4-mini";
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
      })
      .expect(200);

    expect(turn.body?.language_model_policy).toMatchObject({
      requested_selection_mode: "pinned",
      selection_mode: "pinned",
      resolved_model: "gpt-5.4-mini",
      pinned_model_allowed: true,
    });

    const explicitAutoTurn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        language_model_selection: { mode: "auto" },
      })
      .expect(200);

    expect(explicitAutoTurn.body?.language_model_policy).toMatchObject({
      requested_selection_mode: "auto",
      selection_mode: "auto",
      pinned_model_requested: false,
      pinned_model: null,
    });
  }, 60000);

  it("registers Ask turns with the runtime memory governor and exports the admission debug", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        debug: true,
        sessionId: `e68-runtime-governor-${Date.now()}`,
      })
      .expect(200);

    const admission = response.body?.runtime_memory_governor_admission;
    expect(admission).toMatchObject({
      schema: "helix.ask.runtime_memory_governor_admission.v1",
      task_class: "active_user_turn",
      source: "helix_ask_turn",
      admitted: true,
      action: "admit",
      reason: "ok",
      blocked_reason: null,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(admission?.lease_id).toEqual(expect.any(String));
    expect(admission?.pressure_state).toEqual(expect.any(String));
    expect(response.body?.debug?.runtime_memory_governor_admission?.lease_id).toBe(admission?.lease_id);

    const turnId = response.body?.turn_id;
    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);

    expect(debugExport.body?.payload?.runtime_memory_governor_admission?.lease_id).toBe(admission?.lease_id);
    expect(debugExport.body?.payload?.runtime_memory_governor_admission?.pressure_state).toBe(admission?.pressure_state);
    expect(runtimeMemoryGovernor.getRuntimeTaskSnapshot().activeTasks).not.toContainEqual(
      expect.objectContaining({ id: admission?.lease_id }),
    );
  }, 60000);

  it("returns a typed debug failure for missing turn ids", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/api/agi/ask/turn/not-a-real-turn/debug-export")
      .expect(404);

    expect(response.body?.ok).toBe(false);
    expect(response.body?.terminal_error_code).toBe("debug_export_turn_not_found");
  });

  it("reconciles cached debug export from a completed mailbox wake result", async () => {
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Review the latest Stage Play live-source mailbox finding.",
        mode: "read",
        debug: true,
        sessionId: `e68-debug-export-mailbox-wake-${Date.now()}`,
      })
      .expect(200);

    const turnId = turn.body?.turn_id;
    expect(turnId).toBeTruthy();
    const wakeRequestId = `stage_play_live_source_mail_wake:e68-${Date.now()}`;
    const decisionId = `stage_play_live_source_mail_decision:e68-${Date.now()}`;
    const voiceReceiptRef = `helix_interim_voice_callout_receipt:e68-${Date.now()}`;
    const wakeResult = recordStagePlayMailWakeResult({
      wakeRequestId,
      threadId: "helix-ask:desktop",
      status: "completed",
      askTurnId: turnId,
      decisionIds: [decisionId],
      evidenceRefs: [
        "stage_play_live_source_voice_delivery_receipt:e68",
        voiceReceiptRef,
      ],
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);
    const payload = debugExport.body?.payload;

    expect(payload?.mailbox_wake_result_projection).toMatchObject({
      schema: "stage_play_live_source_mail_wake_result_projection/v1",
      wake_result_id: wakeResult.wakeResultId,
      wake_request_id: wakeRequestId,
      status: "completed",
      decision_ids: [decisionId],
      voice_checkpoint_refs: expect.arrayContaining([voiceReceiptRef]),
      requires_voice_checkpoint: true,
      requires_voice_checkpoint_source: "voice_checkpoint_receipt",
    });
    expect(payload?.mailbox_wake_result_observation).toMatchObject({
      schema: "stage_play_live_source_mail_wake_result_observation/v1",
      wake_result_id: wakeResult.wakeResultId,
      wake_request_id: wakeRequestId,
      status: "completed",
      completed: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload?.selected_final_answer ?? "").not.toContain("The live-source mailbox wake completed");
    expect(payload?.final_answer_source).not.toBe("stage_play_mailbox_wake_result");
    expect(payload?.terminal_artifact_kind).not.toBe("stage_play_live_source_mail_wake_result");
    expect(payload?.resolved_turn_summary).toMatchObject({
      resolved_route_label: "live_source_mailbox",
    });
    expect(payload?.terminal_answer_authority?.terminal_artifact_kind).not.toBe("stage_play_live_source_mail_wake_result");
    expect(payload?.solver_controller_summary?.selected_terminal_artifact_kind).not.toBe("stage_play_live_source_mail_wake_result");
    expect(payload?.terminal_authority_single_writer?.selectedArtifactKind).not.toBe("stage_play_live_source_mail_wake_result");
    expect(payload?.final_route_reconciliation?.selected_terminal_artifact_kind).not.toBe("stage_play_live_source_mail_wake_result");
    expect(payload?.source_target_intent).toMatchObject({
      target_source: "live_source_mailbox",
      targetSource: "live_source_mailbox",
      strength: "hard",
      wakeRequestId,
    });
    expect(payload?.source_target_intent?.target_source).toBe("live_source_mailbox");
    expect(payload?.source_target_intent?.targetSource).toBe("live_source_mailbox");
    expect(payload?.stage_play_live_source_mailbox_debug).toMatchObject({
      route: "live_source_mailbox",
      route_selected: "live_source_mailbox",
      route_admission: {
        status: "observed",
        reason: "wake_result_observed_for_ask_turn",
      },
      wake_request_id: wakeRequestId,
      wake_result_id: wakeResult.wakeResultId,
      decision_ids: [decisionId],
      voice_checkpoint_refs: expect.arrayContaining([voiceReceiptRef]),
    });
    expect(payload?.stage_play_live_source_mailbox_debug?.route).not.toMatch(/internet_search/i);
    expect(payload?.stage_play_live_source_mailbox_debug?.route_selected).toBe("live_source_mailbox");
    expect(payload?.stagePlayWakeTransaction).toMatchObject({
      schema: "stage_play_wake_transaction_debug/v1",
      wakeRequestId,
      askTurnId: turnId,
      selectedTargetSource: "live_source_mailbox",
      producedRefs: expect.arrayContaining([decisionId, voiceReceiptRef, wakeResult.wakeResultId]),
      decisionReceiptId: decisionId,
      voiceReceiptId: voiceReceiptRef,
      wakeResultId: wakeResult.wakeResultId,
      terminalKind: "stage_play_live_source_mail_wake_result",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(payload?.stagePlayWakeTransaction?.terminalKind).not.toBe("typed_failure");
    expect(payload?.stagePlayWakeTransaction?.selectedCapability).not.toBe("model.direct_answer");
    expect(payload?.stagePlayWakeTransaction?.selectedTargetSource).toBe("live_source_mailbox");
    expect(payload?.stage_play_wake_transaction).toEqual(
      payload?.stagePlayWakeTransaction,
    );
  }, 60000);

  it("does not terminalize a voice wake that has a decision but no voice checkpoint", async () => {
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId: `e68-debug-export-missing-voice-${Date.now()}`,
      })
      .expect(200);

    const turnId = turn.body?.turn_id;
    expect(turnId).toBeTruthy();
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId: "helix-ask:desktop",
      mailIds: [`stage_play_live_source_mail:e68-missing-voice-${Date.now()}`],
      sourceIds: ["visual_source:e68-missing-voice"],
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      packetIds: ["stage_play_processed_mail_packet:e68-missing-voice"],
      deckVerdict: {
        recommendedNext: "request_voice_callout",
        wakeAsk: true,
        voiceCandidate: true,
        reason: "danger cue requires voice callout",
      },
      evidenceRefs: ["stage_play_processed_mail_packet:e68-missing-voice"],
      now: "2026-06-04T12:08:00.000Z",
    });
    expect(wake).toBeTruthy();
    const decisionId = `${turnId}:agent_step_decision:missing-voice`;
    const wakeResult = recordStagePlayMailWakeResult({
      wakeRequestId: wake!.wakeRequestId,
      threadId: "helix-ask:desktop",
      status: "completed",
      askTurnId: turnId,
      decisionIds: [decisionId],
      evidenceRefs: ["stage_play_processed_mail_packet:e68-missing-voice"],
      createdAt: "2026-06-04T12:08:01.000Z",
    });

    expect(wakeResult).toMatchObject({
      status: "failed_retryable",
      failedReason: "missing_required_voice_receipt_or_hold",
      lifecycleStage: "failed",
      voiceCheckpointRefs: [],
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId: "helix-ask:desktop" }).at(-1)).toMatchObject({
      wakeResultId: wakeResult.wakeResultId,
      status: "failed_retryable",
    });

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/debug-export`)
      .expect(200);
    const payload = debugExport.body?.payload;

    expect(payload?.mailbox_wake_result_projection).toMatchObject({
      wake_result_id: wakeResult.wakeResultId,
      wake_request_id: wake!.wakeRequestId,
      status: "failed_retryable",
      requires_voice_checkpoint: true,
      requires_voice_checkpoint_source: "deck_voice_candidate",
      voice_checkpoint_refs: [],
    });
    expect(payload?.selected_final_answer ?? "").not.toContain("The live-source mailbox wake completed");
    expect(payload?.final_answer_source).not.toBe("stage_play_mailbox_wake_result");
    expect(payload?.terminal_artifact_kind).not.toBe("stage_play_live_source_mail_wake_result");
  }, 60000);

  it("exports a wake transaction debug block for a missing Ask turn id launch", async () => {
    const sessionId = `e68-missing-turn-id-${Date.now()}`;
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId: sessionId,
      roomId: "room:e68-missing-turn-id",
      mailIds: ["stage_play_live_source_mail:e68-missing-turn-id"],
      sourceIds: ["visual_source:e68-missing-turn-id"],
      reason: "unread_mail",
      evidenceRefs: ["stage_play_live_source_mail:e68-missing-turn-id"],
      now: "2026-06-04T12:02:00.000Z",
    });
    expect(wake?.wakeRequestId).toBeTruthy();
    const wakeRequestId = wake!.wakeRequestId;
    markStagePlayMailWakeRetryable({
      wakeRequestId,
      failureReason: "ask_launch_missing_ask_turn_id",
      now: "2026-06-04T12:02:01.000Z",
    });
    const wakeResult = recordStagePlayMailWakeResult({
      wakeRequestId,
      threadId: sessionId,
      roomId: "room:e68-missing-turn-id",
      status: "failed_retryable",
      askTurnId: null,
      failedReason: "ask_launch_missing_ask_turn_id",
      evidenceRefs: ["stage_play_wake_ask_launch_missing_ask_turn_id"],
      createdAt: "2026-06-04T12:02:02.000Z",
    });

    expect(wakeResult.stagePlayWakeTransaction).toMatchObject({
      schema: "stage_play_wake_transaction_debug/v1",
      wakeRequestId,
      askTurnId: null,
      askLaunchStatus: "missing_turn_id",
      producedRefs: expect.arrayContaining([
        "stage_play_wake_ask_launch_missing_ask_turn_id",
        wakeResult.wakeResultId,
      ]),
      artifactRefs: expect.objectContaining({
        wakeRequestId,
        askTurnId: null,
      }),
      wakeResultId: wakeResult.wakeResultId,
      failureCode: "ask_launch_missing_ask_turn_id",
      failureReason: "ask_launch_missing_ask_turn_id",
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("keeps completed mailbox wake results as observations during response finalization", async () => {
    const app = createApp();
    const turnId = `ask:e68-durable-mailbox-${Date.now()}`;
    const wakeRequestId = `stage_play_live_source_mail_wake:e68-durable-${Date.now()}`;
    const decisionId = `stage_play_live_source_mail_decision:e68-durable-${Date.now()}`;
    const voiceReceiptRef = `helix_interim_voice_callout_receipt:e68-durable-${Date.now()}`;
    const wakeResult = recordStagePlayMailWakeResult({
      wakeRequestId,
      threadId: "helix-ask:desktop",
      status: "completed",
      askTurnId: turnId,
      decisionIds: [decisionId],
      evidenceRefs: [voiceReceiptRef],
      createdAt: "2026-06-04T12:05:00.000Z",
    });

    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        turn_id: turnId,
        turnId,
        trace_id: turnId,
        traceId: turnId,
        sessionId: `e68-durable-mailbox-${Date.now()}`,
      })
      .expect(200);

    expect(turn.body?.selected_final_answer ?? "").not.toContain("The live-source mailbox wake completed");
    expect(turn.body?.final_answer_source).not.toBe("stage_play_mailbox_wake_result");
    expect(turn.body?.terminal_artifact_kind).not.toBe("stage_play_live_source_mail_wake_result");
    expect(turn.body?.mailbox_wake_result_projection).toMatchObject({
      wake_result_id: wakeResult.wakeResultId,
      wake_request_id: wakeRequestId,
      status: "completed",
      decision_ids: [decisionId],
      voice_checkpoint_refs: expect.arrayContaining([voiceReceiptRef]),
    });
    expect(turn.body?.mailbox_wake_result_observation).toMatchObject({
      wake_result_id: wakeResult.wakeResultId,
      wake_request_id: wakeRequestId,
      status: "completed",
      completed: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    const transcriptEvents = Array.isArray(turn.body?.turn_transcript_events)
      ? turn.body.turn_transcript_events
      : [];
    expect(
      transcriptEvents.some((event: any) =>
        event?.type === "final_answer" &&
        String(event?.detail ?? "") === "stage_play_mailbox_wake_result"
      ),
    ).toBe(false);
  }, 60000);

  it("returns replay-safe reasoning battle stage beats for a completed turn", async () => {
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId: `e68-battle-stage-${Date.now()}`,
      })
      .expect(200);

    const turnId = turn.body?.turn_id;
    expect(turnId).toBeTruthy();
    const response = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turnId)}/reasoning-battle-stage`)
      .expect(200);

    expect(response.body?.ok).toBe(true);
    expect(response.body?.schema).toBe("helix.reasoning_battle_stage_response.v1");
    expect(response.body?.battle_stage).toMatchObject({
      schema: "helix.reasoning_battle_stage.v1",
      turn_id: turnId,
      source: "debug_payload_cache",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(Array.isArray(response.body?.battle_stage?.beats)).toBe(true);
    expect(response.body.battle_stage.beats.length).toBeGreaterThan(0);
    expect(response.body.battle_stage.beats.length).toBeLessThanOrEqual(10);
    expect(response.body.battle_stage.beats.every((beat: any) => beat.raw_content_included === false)).toBe(true);
    const selectedFinalAnswer = typeof turn.body?.selected_final_answer === "string" ? turn.body.selected_final_answer : "";
    if (selectedFinalAnswer) {
      expect(JSON.stringify(response.body.battle_stage.beats)).not.toContain(selectedFinalAnswer);
    }
  }, 60000);
});
