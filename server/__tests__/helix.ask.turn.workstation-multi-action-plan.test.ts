import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { synthesizeWorkstationToolAnswer } from "../services/helix-ask/workstation-answer-synthesizer";
import { evaluateWorkstationToolPlan } from "../services/helix-ask/workstation-tool-result-evaluator";
import { planWorkstationToolUse } from "../services/helix-ask/workstation-tool-planner";
import { listSubgoalEvaluations } from "../services/helix-ask/subgoal-evaluator";
import {
  listStagePlayGoalContextUpdates,
  resetStagePlayGoalContextStoreForTest,
} from "../services/stage-play/stage-play-goal-context-store";
import { listCategorizationEvents } from "../services/situation-room/categorization-bus";
import { listSyntheticEvidence } from "../services/situation-room/synthetic-evidence-ledger";

const actionKeys = (prompt: string): string[] =>
  (planWorkstationToolUse(prompt).tool_plan?.steps ?? [])
    .map((step) =>
      step.panel_id && step.action_id
        ? `${step.panel_id}.${step.action_id}`
        : null,
    )
    .filter((entry): entry is string => Boolean(entry));

describe("Helix Ask workstation multi-action tool plans", () => {
  it("builds calculator verification as open -> ingest -> solve -> evaluate", () => {
    const prompt = "Check this equation with the scientific calculator: x^2 - 4 = 0";
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:test",
      turnId: "turn:test",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("calculator_verify");
    expect(actionKeys(prompt)).toEqual(
      expect.arrayContaining([
        "scientific-calculator.open",
        "scientific-calculator.ingest_latex",
        "scientific-calculator.solve_with_steps",
      ]),
    );

    const evaluation = evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:calculator"],
      evidence_refs: ["receipt:calculator"],
    });
    expect(evaluation.schema).toBe("helix.workstation_tool_evaluation.v1");
    expect(evaluation.deterministic).toBe(true);
    expect(evaluation.model_invoked).toBe(false);
    expect(evaluation.categorization_event_ids?.length).toBeGreaterThan(0);
    expect(evaluation.synthetic_evidence_ids?.length).toBeGreaterThan(0);
    expect(evaluation.subgoal_evaluation_ids?.length).toBeGreaterThan(0);
    const evidence = listSyntheticEvidence("helix-ask:test").find(
      (entry) => entry.evidence_id === evaluation.synthetic_evidence_ids?.[0],
    );
    expect(evidence?.produced_by).toBe("calculator");
    expect(evidence?.assistant_answer).toBe(false);
    expect(evidence?.raw_content_included).toBe(false);
    expect(listCategorizationEvents("helix-ask:test").at(-1)?.category).toBe("equation_result");
    expect(listSubgoalEvaluations("helix-ask:test").at(-1)?.status).toBe("completed");
    expect(synthesizeWorkstationToolAnswer({ prompt, plan: result.tool_plan!, evaluation })).toMatch(/Result:\s*2,\s*-2/i);
  });

  it("builds note creation as open -> create -> evaluate and answers with a note reference", () => {
    const prompt = 'Create a workstation note titled "Test" with body hello';
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:test",
      turnId: "turn:test",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("notes_create");
    expect(actionKeys(prompt)).toEqual(
      expect.arrayContaining(["workstation-notes.open", "workstation-notes.create_note"]),
    );

    const evaluation = evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:note"],
      evidence_refs: ["receipt:note"],
    });
    expect(evaluation.supports_goal).toBe(true);
    const evidence = listSyntheticEvidence("helix-ask:test").find(
      (entry) => entry.evidence_id === evaluation.synthetic_evidence_ids?.[0],
    );
    expect(evidence?.produced_by).toBe("workstation_note");
    expect(evidence?.reusable_context_ref).toBe("receipt:note");
    expect(evidence?.assistant_answer).toBe(false);
    expect(listCategorizationEvents("helix-ask:test").at(-1)?.category).toBe("context_reference");
    expect(synthesizeWorkstationToolAnswer({ prompt, plan: result.tool_plan!, evaluation })).toMatch(
      /Created workstation note "Test"/i,
    );
  });

  it("builds Moral motive comparison through the mission-ethos affordance", () => {
    const prompt = "Compare this motive to Moral: I am gathering resources to survive.";
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:test",
      turnId: "turn:test",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("ideology_compare");
    expect(actionKeys(prompt)).toEqual(
      expect.arrayContaining(["mission-ethos.open", "mission-ethos.compare_motive_to_zen"]),
    );

    const evaluation = evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:mission-ethos"],
      evidence_refs: ["receipt:mission-ethos"],
    });
    expect(evaluation.tool_receipt_ids).toEqual(["receipt:mission-ethos"]);
    expect(listSyntheticEvidence("helix-ask:test").at(-1)?.produced_by).toBe("ideology");
    expect(listCategorizationEvents("helix-ask:test").at(-1)?.category).toBe("motive_framework");
    expect(synthesizeWorkstationToolAnswer({ prompt, plan: result.tool_plan!, evaluation })).toMatch(
      /Mission Ethos|Moral|ideology comparison/i,
    );
  });

  it("evaluates narrator control receipts as non-terminal deterministic evidence", () => {
    resetStagePlayGoalContextStoreForTest();
    const prompt =
      "Run panel action panel_id=narrator action_id=narrator.bind_stream source_ref=source:browser-audio stream_kind=translated_transcript.";
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:narrator-control",
      turnId: "turn:narrator-control",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("narrator_control");
    expect(actionKeys(prompt)).toEqual(
      expect.arrayContaining(["narrator.open", "narrator.narrator.bind_stream"]),
    );

    const evaluation = evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:narrator-bind"],
      evidence_refs: ["receipt:narrator-bind"],
    });
    expect(evaluation.schema).toBe("helix.workstation_tool_evaluation.v1");
    expect(evaluation.deterministic).toBe(true);
    expect(evaluation.model_invoked).toBe(false);
    expect(evaluation.supports_goal).toBe(true);
    const evidence = listSyntheticEvidence("helix-ask:narrator-control").find(
      (entry) => entry.evidence_id === evaluation.synthetic_evidence_ids?.[0],
    );
    expect(evidence?.produced_by).toBe("deterministic_reducer");
    expect(evidence?.assistant_answer).toBe(false);
    expect(evidence?.raw_content_included).toBe(false);
    expect(listCategorizationEvents("helix-ask:narrator-control").at(-1)?.category).toBe("context_reference");
    const goalContextUpdates = listStagePlayGoalContextUpdates({
      threadId: "helix-ask:narrator-control",
      producerKind: "narrator",
    });
    expect(goalContextUpdates).toHaveLength(1);
    expect(goalContextUpdates[0]).toMatchObject({
      producerKind: "narrator",
      updateKind: "suggested_action",
      contentRef: "receipt:narrator-bind",
      sourceRefs: expect.arrayContaining(["source:browser-audio", "translated_transcript"]),
      evidenceRefs: expect.arrayContaining(["receipt:narrator-bind"]),
      receiptRefs: ["receipt:narrator-bind"],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(goalContextUpdates[0].suggestedDispatch.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "log_receipt",
      "update_panel",
      "bind_narrator_stream",
      "speak_narrator",
    ]));
    expect(goalContextUpdates[0].suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bind_narrator_stream",
        sourceRef: "source:browser-audio",
        streamKind: "translated_transcript",
      }),
    ]));
  });

  it("evaluates narrator.say panel receipts as non-terminal voice dispatch context", () => {
    resetStagePlayGoalContextStoreForTest();
    const prompt =
      'Run panel action panel_id=narrator action_id=narrator.say with text="Translation is now routed through Narrator." source_id=helix_ask:translation delivery_mode=visible_only.';
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:narrator-say-panel",
      turnId: "turn:narrator-say-panel",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("narrator_control");
    expect(actionKeys(prompt)).toEqual(
      expect.arrayContaining(["narrator.open", "narrator.narrator.say"]),
    );

    const evaluation = evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:narrator-say"],
      evidence_refs: ["helix_narrator_event:translation"],
      summary: "Narrator say queued as governed workstation speech.",
    });
    expect(evaluation.schema).toBe("helix.workstation_tool_evaluation.v1");
    expect(evaluation.deterministic).toBe(true);
    expect(evaluation.model_invoked).toBe(false);
    expect(evaluation.supports_goal).toBe(true);
    const evidence = listSyntheticEvidence("helix-ask:narrator-say-panel").find(
      (entry) => entry.evidence_id === evaluation.synthetic_evidence_ids?.[0],
    );
    expect(evidence?.assistant_answer).toBe(false);
    expect(evidence?.raw_content_included).toBe(false);

    const goalContextUpdates = listStagePlayGoalContextUpdates({
      threadId: "helix-ask:narrator-say-panel",
      producerKind: "narrator",
    });
    expect(goalContextUpdates).toHaveLength(1);
    expect(goalContextUpdates[0]).toMatchObject({
      producerKind: "narrator",
      updateKind: "suggested_action",
      contentRef: "receipt:narrator-say",
      sourceRefs: expect.arrayContaining([
        "helix_ask:translation",
        "workstation_actuator:narrator_say",
      ]),
      loopRefs: expect.arrayContaining([
        "narrator:say",
        "workstation_actuator:narrator_say",
      ]),
      evidenceRefs: expect.arrayContaining([
        "receipt:narrator-say",
        "helix_narrator_event:translation",
        "allowed_actuator:narrator_say",
      ]),
      receiptRefs: ["receipt:narrator-say"],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(goalContextUpdates[0].suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: "receipt:narrator-say" }),
      expect.objectContaining({ kind: "update_panel", panelId: "narrator" }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "speak_narrator", mode: "visible_only" }),
    ]));
    expect(goalContextUpdates[0].suggestedDispatch.map((action) => action.kind)).not.toContain("bind_narrator_stream");
  });

  it("evaluates workstation control receipts as non-terminal graph dispatch context", () => {
    resetStagePlayGoalContextStoreForTest();
    const prompt = "Run live_env.set_workstation_loop_state goal_id=goal:frog loop_ref=loop:visual-mail state=paused";
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:workstation-control",
      turnId: "turn:workstation-control",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("workstation_control");
    expect(result.tool_plan?.steps[0]).toMatchObject({
      step_id: "set_workstation_loop_state",
      kind: "run_ask_tool",
      tool_id: "live_env.set_workstation_loop_state",
      args: expect.objectContaining({
        goal_id: "goal:frog",
        loop_ref: "loop:visual-mail",
        state: "paused",
      }),
      expected_receipt_kind: "stage_play_workstation_control_receipt",
      expected_state_change: {
        store: "stage-play-goal-context",
        proof_key: "goalContextUpdates",
      },
    });

    const evaluation = evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:loop-paused"],
      evidence_refs: ["receipt:loop-paused"],
      summary: "Workstation loop state change receipt recorded for graph dispatch.",
    });
    expect(evaluation.schema).toBe("helix.workstation_tool_evaluation.v1");
    expect(evaluation.deterministic).toBe(true);
    expect(evaluation.model_invoked).toBe(false);
    expect(evaluation.supports_goal).toBe(true);

    const evidence = listSyntheticEvidence("helix-ask:workstation-control").find(
      (entry) => entry.evidence_id === evaluation.synthetic_evidence_ids?.[0],
    );
    expect(evidence?.assistant_answer).toBe(false);
    expect(evidence?.raw_content_included).toBe(false);

    const goalContextUpdates = listStagePlayGoalContextUpdates({
      threadId: "helix-ask:workstation-control",
      producerKind: "automation",
    });
    expect(goalContextUpdates).toHaveLength(1);
    expect(goalContextUpdates[0]).toMatchObject({
      producerKind: "automation",
      updateKind: "automation_status",
      contentRef: "receipt:loop-paused",
      sourceRefs: expect.arrayContaining([
        "goal:frog",
        "loop:visual-mail",
        "workstation_actuator:set_loop_state",
      ]),
      loopRefs: expect.arrayContaining([
        "thread:helix-ask:workstation-control",
        "set_workstation_loop_state",
        "workstation_control:set_loop_state",
        "workstation_actuator:set_loop_state",
        "loop:visual-mail",
      ]),
      evidenceRefs: expect.arrayContaining([
        "receipt:loop-paused",
        "goal:frog",
        "loop:visual-mail",
        "allowed_actuator:set_loop_state",
        "agent_goal_allowed_actuator:set_loop_state",
      ]),
      receiptRefs: ["receipt:loop-paused"],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
      goalRelevance: {
        goalId: "goal:frog",
        relevance: 0.75,
        reason: "Workstation control receipt belongs to this active operator goal.",
      },
      toolIdentity: {
        requestedToolName: "live_env.set_workstation_loop_state",
        canonicalToolName: "live_env.set_workstation_loop_state",
        matchedAllowedActuators: ["set_loop_state"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:set_loop_state"],
      },
    });
    expect(goalContextUpdates[0].suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: "receipt:loop-paused" }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "append_goal_context", goalId: "goal:frog" }),
      expect.objectContaining({ kind: "set_loop_state", loopRef: "loop:visual-mail", state: "paused" }),
    ]));
    expect(goalContextUpdates[0].suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
  });

  it("preserves source repair as a distinct non-terminal workstation dispatch", () => {
    resetStagePlayGoalContextStoreForTest();
    const prompt =
      "Run live_env.repair_workstation_source goal_id=goal:frog source_ref=source:visual-tab loop_ref=loop:visual-mail";
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:repair-source",
      turnId: "turn:repair-source",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("workstation_control");
    expect(result.tool_plan?.steps[0]).toMatchObject({
      step_id: "repair_workstation_source",
      kind: "run_ask_tool",
      tool_id: "live_env.repair_workstation_source",
      args: expect.objectContaining({
        goal_id: "goal:frog",
        source_ref: "source:visual-tab",
        loop_ref: "loop:visual-mail",
        state: "repaired",
      }),
    });

    evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:source-repaired"],
      evidence_refs: ["receipt:source-repaired"],
      summary: "Workstation source repair receipt recorded for graph dispatch.",
    });

    const goalContextUpdates = listStagePlayGoalContextUpdates({
      threadId: "helix-ask:repair-source",
      producerKind: "source_health",
    });
    expect(goalContextUpdates).toHaveLength(1);
    expect(goalContextUpdates[0]).toMatchObject({
      producerKind: "source_health",
      updateKind: "source_status",
      contentRef: "receipt:source-repaired",
      sourceRefs: expect.arrayContaining([
        "goal:frog",
        "source:visual-tab",
        "loop:visual-mail",
        "workstation_actuator:repair_source",
      ]),
      loopRefs: expect.arrayContaining([
        "thread:helix-ask:repair-source",
        "repair_workstation_source",
        "workstation_control:repair_source",
        "workstation_actuator:repair_source",
        "loop:visual-mail",
      ]),
      evidenceRefs: expect.arrayContaining([
        "receipt:source-repaired",
        "allowed_actuator:repair_source",
        "agent_goal_allowed_actuator:repair_source",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(goalContextUpdates[0].suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "repair_source", sourceRef: "source:visual-tab", loopRef: "loop:visual-mail" }),
      expect.objectContaining({ kind: "set_loop_state", loopRef: "loop:visual-mail", state: "repaired" }),
    ]));
    expect(goalContextUpdates[0].suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
  });

  it("evaluates goal-session setup controls as one non-terminal workstation dispatch context", () => {
    resetStagePlayGoalContextStoreForTest();
    const prompt =
      'Start an agent goal session goal_id=goal:visual-ops source_id=source:visual-tab objective="Monitor visual source." Apply visual preset target_ref=source:visual-tab preset_id=preset:frog-classifier, bind source source_ref=source:visual-tab bind_target_ref=live-answer:desktop, pause loop loop_ref=loop:visual-mail, update Live Answer projection line_key=visual_summary, and focus the process graph node_ref=packet:visual-frog.';
    const result = planWorkstationToolUse(prompt, {
      threadId: "helix-ask:goal-setup-controls",
      turnId: "turn:goal-setup-controls",
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(result.tool_plan?.intent).toBe("workstation_goal_context");
    expect(result.tool_plan?.steps.map((step) => step.tool_id ?? step.action_id)).toEqual(expect.arrayContaining([
      "live_env.start_agent_goal_session",
      "live_env.set_visual_preset",
      "live_env.bind_workstation_source",
      "live_env.update_live_answer_projection",
      "live_env.set_workstation_loop_state",
      "live_env.focus_process_graph",
    ]));

    evaluateWorkstationToolPlan({
      plan: result.tool_plan!,
      receipt_ids: ["receipt:goal-setup-controls"],
      evidence_refs: ["receipt:goal-setup-controls"],
      summary: "Goal-session setup prepared the workstation control circuit.",
    });

    const goalContextUpdates = listStagePlayGoalContextUpdates({
      threadId: "helix-ask:goal-setup-controls",
      producerKind: "live_answer",
    });
    expect(goalContextUpdates).toHaveLength(1);
    expect(goalContextUpdates[0]).toMatchObject({
      producerKind: "live_answer",
      updateKind: "summary",
      contentRef: "receipt:goal-setup-controls",
      sourceRefs: expect.arrayContaining([
        "goal:visual-ops",
        "source:visual-tab",
        "live-answer:desktop",
        "preset:frog-classifier",
        "loop:visual-mail",
        "packet:visual-frog",
        "workstation_actuator:set_visual_preset",
        "workstation_actuator:bind_source",
        "workstation_actuator:update_live_answer",
        "workstation_actuator:set_loop_state",
        "workstation_actuator:focus_process_graph",
      ]),
      loopRefs: expect.arrayContaining([
        "thread:helix-ask:goal-setup-controls",
        "set_visual_preset",
        "bind_workstation_source",
        "update_live_answer_projection",
        "set_workstation_loop_state",
        "focus_process_graph",
        "workstation_control:set_visual_preset",
        "workstation_control:bind_source",
        "workstation_control:update_live_answer",
        "workstation_control:set_loop_state",
        "workstation_control:focus_process_graph",
      ]),
      evidenceRefs: expect.arrayContaining([
        "receipt:goal-setup-controls",
        "allowed_actuator:set_visual_preset",
        "allowed_actuator:bind_source",
        "allowed_actuator:update_live_answer",
        "allowed_actuator:set_loop_state",
        "allowed_actuator:focus_process_graph",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(goalContextUpdates[0].suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: "receipt:goal-setup-controls" }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "update_panel", panelId: "live-answer-environment" }),
      expect.objectContaining({ kind: "append_goal_context", goalId: "goal:visual-ops" }),
      expect.objectContaining({ kind: "change_preset", targetRef: "source:visual-tab", presetId: "preset:frog-classifier" }),
      expect.objectContaining({ kind: "bind_source", sourceRef: "source:visual-tab", targetRef: "live-answer:desktop" }),
      expect.objectContaining({ kind: "update_live_answer", lineKey: "visual_summary" }),
      expect.objectContaining({ kind: "set_loop_state", loopRef: "loop:visual-mail", state: "paused" }),
      expect.objectContaining({ kind: "focus_process_graph", nodeRef: "packet:visual-frog" }),
    ]));
    expect(goalContextUpdates[0].suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
  });

  it("returns matching receipt artifacts from the ask/turn note path", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/agi", planRouter);
    const sessionId = `workstation-note-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: 'Create a workstation note titled "Trace Check" with body hello',
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.final_answer_source).toBe("final_answer_draft");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    const evidenceResponse = await request(app)
      .get("/api/agi/situation/synthetic-evidence")
      .query({ thread_id: sessionId })
      .expect(200);
    expect(evidenceResponse.body?.raw_logs_included).toBe(false);
    expect(evidenceResponse.body?.deterministic_content_role).toBe("observation_not_assistant_answer");
    expect(evidenceResponse.body?.evidence?.at(-1)?.produced_by).toBe("workstation_note");
    expect(evidenceResponse.body?.evidence?.at(-1)?.assistant_answer).toBe(false);

    const categorizationResponse = await request(app)
      .get("/api/agi/situation/categorization-events")
      .query({ thread_id: sessionId })
      .expect(200);
    expect(categorizationResponse.body?.events?.at(-1)?.category).toBe("context_reference");

    const subgoalResponse = await request(app)
      .get("/api/agi/situation/subgoal-evaluations")
      .query({ thread_id: sessionId })
      .expect(200);
    expect(subgoalResponse.body?.evaluations?.at(-1)?.status).toBe("completed");
  }, 20_000);
});
