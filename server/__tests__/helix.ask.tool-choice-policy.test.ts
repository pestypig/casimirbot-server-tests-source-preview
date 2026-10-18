import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { decideHelixToolChoice } from "../services/helix-ask/tool-choice-policy";
import { planWorkstationToolUse } from "../services/helix-ask/workstation-tool-planner";

describe("Helix Ask tool-choice policy", () => {
  it("surfaces run_ask_tool affordance ids for workstation goal-context plans", () => {
    const workstationPlan = planWorkstationToolUse(
      "Start an agent goal session goal_id=goal:frog-monitor source_id=image-lens:latest objective=\"Monitor visual capture for frog classification evidence.\"",
      { threadId: "thread:frog", turnId: "turn:frog" },
    ).tool_plan;

    const decision = decideHelixToolChoice({
      turn_id: "turn:frog",
      prompt: "Start an agent goal session for frog classification.",
      workstation_tool_plan: workstationPlan,
    });

    expect(decision.decision).toBe("workstation_tool_plan");
    expect(decision.selected_affordance_ids).toEqual([
      "live_env.start_agent_goal_session",
      "live_env.query_workstation_goal_context",
    ]);
  });

  it("surfaces live_env narrator affordance ids for governed narrator control plans", () => {
    const workstationPlan = planWorkstationToolUse(
      'Narrator say text="Translation is now routed through Narrator."',
      { threadId: "thread:narrator", turnId: "turn:narrator" },
    ).tool_plan;

    const decision = decideHelixToolChoice({
      turn_id: "turn:narrator",
      prompt: "Narrator say this status update.",
      workstation_tool_plan: workstationPlan,
    });

    expect(decision.decision).toBe("workstation_tool_plan");
    expect(decision.selected_affordance_ids).toEqual([
      "live_env.narrator_say",
    ]);
  });

  it("keeps repair workstation source exposed in the top-level Ask live_env capability surface", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");
    const repairCapability = "live_env.repair_workstation_source";

    expect(agiPlanSource.match(new RegExp(`case "${repairCapability}"`, "g"))?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(agiPlanSource).toContain(`"${repairCapability}",`);
    expect(agiPlanSource).toContain(`capability_key: "${repairCapability}"`);
    expect(agiPlanSource).toContain("Creates a governed source-repair control receipt");
  });

  it("keeps context-resume memory from repairing failed stream terminal authority", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const shouldAttemptContextResumeStreamFailureAnswerRepair = (): boolean => false;");
    expect(agiPlanSource).toContain("streamSolverFailureRequiresTypedFailure && shouldAttemptContextResumeStreamFailureAnswerRepair()");
    expect(agiPlanSource).toContain("const recoveryRecall = shouldAttemptContextResumeStreamFailureAnswerRepair()");
    expect(agiPlanSource).toContain("stream_terminal_repair_suppressed_by_solver_authority");
    expect(agiPlanSource).toContain("context_resume_memory_must_not_repair_solver_path_incomplete_before_terminal");
  });

  it("does not let response-boundary projection guards bypass solver authority just because payload is not failed", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).not.toMatch(
      /const responseBoundaryCan(?:Promote|Project)[A-Za-z0-9_]+ =[\s\S]{0,260}!isAskTurnFailureOrPendingProjectionState\((?:payload|responsePayload)\)\s*\|\|/,
    );
  });

  it("does not hand-write completed solver traces for moral/civilization route terminals", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).not.toMatch(
      /ask_turn_solver_trace:\s*\{[^}]*route:\s*"moral_graph_reflection"[^}]*completed_solver_path:\s*true/s,
    );
    expect(agiPlanSource).not.toMatch(
      /ask_turn_solver_trace:\s*\{[^}]*route:\s*"civilization_bounds_reflection"[^}]*completed_solver_path:\s*true/s,
    );
    expect(agiPlanSource).toMatch(
      /selectedRoute:\s*"moral_graph_reflection"[\s\S]{0,420}payload\.ask_turn_solver_trace = buildAskTurnSolverTrace/,
    );
    expect(agiPlanSource).toMatch(
      /selectedRoute:\s*"civilization_bounds_reflection"[\s\S]{0,420}payload\.ask_turn_solver_trace = buildAskTurnSolverTrace/,
    );
  });

  it("requires solver permission before stream projection promotes a model draft to terminal authority", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const streamTerminalProjectionAllowedBySolver =");
    expect(agiPlanSource).toContain("const streamCanProjectSelectedAnswer =");
    expect(agiPlanSource).toContain("stream_projection_without_solver_authority");
    expect(agiPlanSource).toMatch(
      /const modelDraftIsTerminalAuthority =[\s\S]*!isWorkstationToolTerminalAuthority &&[\s\S]*streamTerminalProjectionAllowedBySolver &&[\s\S]*streamFinalAnswerSource === "final_answer_draft"/,
    );
    expect(agiPlanSource).toMatch(
      /const selectedStreamAnswerCandidate =[\s\S]*terminalPresentationConciseText[\s\S]*bodySelectedFinalAnswer/,
    );
    expect(agiPlanSource).toMatch(
      /let selectedStreamAnswer = streamCanProjectSelectedAnswer \? selectedStreamAnswerCandidate : "";/,
    );
  });

  it("does not let stream failure projection reuse stale success selected_final_answer", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const streamTypedFailureForProjection =");
    expect(agiPlanSource).toContain("const streamProjectionFailureTextCandidate =");
    expect(agiPlanSource).toContain("const bodySelectedFinalAnswerIsFailure =");
    expect(agiPlanSource).toMatch(
      /streamProjectionIsFailureOrPending[\s\S]*terminalAuthorityPreviewIsFailure[\s\S]*terminalPresentationConciseTextIsFailure[\s\S]*streamProjectionFailureTextCandidate[\s\S]*bodySelectedFinalAnswerIsFailure[\s\S]*: ""/,
    );
    expect(agiPlanSource).toMatch(
      /const streamCanProjectSelectedAnswer =[\s\S]*streamProjectionIsFailureOrPending[\s\S]*Boolean\(selectedStreamAnswerCandidate\)[\s\S]*streamTerminalProjectionAllowedBySolver/,
    );
  });

  it("requires solver permission before response-boundary presentation text becomes terminal authority", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const canProjectAskTurnTerminalAtResponseBoundary =");
    expect(agiPlanSource).toContain("const canPromoteAskTurnTerminalKindAtResponseBoundary =");
    expect(agiPlanSource).toContain("const isAskTurnAuthorityRecordUsableForProjection =");
    expect(agiPlanSource).toMatch(
      /isAskTurnAuthorityRecordUsableForProjection[\s\S]*server_authoritative !== false[\s\S]*terminal_eligible !== false[\s\S]*assistant_answer !== true/,
    );
    expect(agiPlanSource).toContain("const hasAskTurnSelectedTerminalAuthorityForProjection =");
    expect(agiPlanSource).toContain("const hasAskTurnTerminalAuthoritySelectingKindForProjection =");
    expect(agiPlanSource).not.toMatch(
      /hasAskTurnSelectedTerminalAuthorityForProjection[\s\S]{0,700}writer\?\.source/,
    );
    expect(agiPlanSource).not.toMatch(
      /hasAskTurnTerminalAuthoritySelectingKindForProjection[\s\S]{0,900}terminal_presentation/,
    );
    expect(agiPlanSource).toContain("const responseBoundaryCanProjectTerminalPresentation =");
    expect(agiPlanSource).toContain("terminal_presentation_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("const responseBoundaryCanProjectTerminalAuthority =");
    expect(agiPlanSource).toContain("response_projection_without_solver_authority");
    expect(agiPlanSource).toContain("response_boundary_projection_suppressed_by_solver_authority");
    expect(agiPlanSource).toMatch(
      /if \(responseBoundaryCanProjectTerminalPresentation\) \{[\s\S]*payload\.selected_final_answer = terminalPresentationBundle\.presentation\.concise_text;/,
    );
    expect(agiPlanSource).toMatch(
      /if \(authorityTerminalText && !responseBoundaryCanProjectTerminalAuthority\) \{[\s\S]*final_answer_source: "typed_failure"[\s\S]*terminal_artifact_kind: "typed_failure"/,
    );
  });

  it("requires solver permission before response-boundary repo evidence repair promotes typed failure to success", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteRepoEvidenceAnswer =");
    expect(agiPlanSource).toContain("const finalizerCanPromoteRepoEvidenceAnswer =");
    expect(agiPlanSource).toContain("const finalizerCanPromoteRepoDefinition =");
    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteRepoDefinition =");
    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteRepoEvidenceSurface =");
    expect(agiPlanSource).toContain("repo_evidence_answer_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("repo_definition_answer_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_repo_evidence_projection_suppressed");
    expect(agiPlanSource).toContain("response_boundary_repo_evidence_surface_projection_suppressed");
    expect(agiPlanSource).toContain("response_boundary_repo_definition_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /repoAnswerTextForResponseBoundary &&[\s\S]*routeProductContractForPresentation\.source_target === "repo_code" &&[\s\S]*responseBoundaryCanPromoteRepoEvidenceAnswer &&[\s\S]*payload\.terminal_artifact_kind = "repo_code_evidence_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /modelAuthoredRepoEvidenceText && finalizerCanPromoteRepoEvidenceAnswer[\s\S]*payload\.terminal_artifact_kind = "repo_code_evidence_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /repoEvidenceTerminalSurfaceReady &&[\s\S]*repoEvidenceAnswerTextForUniversalComposer &&[\s\S]*responseBoundaryCanPromoteRepoEvidenceSurface[\s\S]*payload\.terminal_artifact_kind = "repo_code_evidence_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /repoConceptForResponseBoundary &&[\s\S]*responseBoundaryCanPromoteRepoDefinition[\s\S]*payload\.terminal_artifact_kind = "repo_code_evidence_answer"/,
    );
  });

  it("requires solver permission before attached visual evidence repairs a failed terminal answer", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteAttachedVisual =");
    expect(agiPlanSource).toContain("visual_frame_evidence_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_visual_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /attachedVisualSummary &&[\s\S]*asksAboutAttachedVisual &&[\s\S]*visualPromotionDecision\?\.allowed === true &&[\s\S]*responseBoundaryCanPromoteAttachedVisual &&[\s\S]*applySituationContextFinalAnswer\(visualAnswer, terminalArtifactId\)/,
    );
  });

  it("requires solver permission before processed-mail checkpoint evidence repairs a failed terminal answer", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteProcessedMailCheckpoint =");
    expect(agiPlanSource).toContain("processed_mail_checkpoint_synthesis_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_processed_mail_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /processedMailCheckpointTextForResponseBoundary &&[\s\S]*processedMailCheckpointDecisionSatisfiedForResponseBoundary &&[\s\S]*responseBoundaryCanPromoteProcessedMailCheckpoint &&[\s\S]*payload\.terminal_artifact_kind = "model_synthesized_answer"/,
    );
  });

  it("requires solver permission before model-only concept drafts repair failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteModelOnlyConcept =");
    expect(agiPlanSource).toContain("model_only_concept_answer_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_model_only_concept_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /responseBoundaryCanPromoteModelOnlyConcept =[\s\S]*canPromoteAskTurnTerminalKindAtResponseBoundary\([\s\S]*"model_synthesized_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /richModelOnlyConceptSignalForBoundary\?\.applies === true &&[\s\S]*responseBoundaryCanPromoteModelOnlyConcept[\s\S]*payload\.terminal_artifact_kind = "model_synthesized_answer"/,
    );
  });

  it("requires solver permission before doc concept artifacts repair a failed terminal answer", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteDocConceptExplanation =");
    expect(agiPlanSource.match(/const responseBoundaryCanPromoteDocConceptExplanation =/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(agiPlanSource).toContain("doc_concept_explanation_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_doc_concept_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /conceptArtifact && conceptText\.trim\(\) && responseBoundaryCanPromoteDocConceptExplanation[\s\S]*payload\.terminal_artifact_kind = "doc_concept_explanation"/,
    );
  });

  it("requires solver permission before scientific evidence artifacts repair failed terminal answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteDocEquationLocation =");
    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteDocCalculatorEvidence =");
    expect(agiPlanSource.match(/const responseBoundaryCanPromoteDocCalculatorEvidence =/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(agiPlanSource).toContain("scientific_evidence_answer_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("doc_calculator_evidence_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_scientific_evidence_projection_suppressed");
    expect(agiPlanSource).toContain("response_boundary_doc_calculator_evidence_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /validEquationArtifact && renderedEquationArtifact && responseBoundaryCanPromoteDocEquationLocation[\s\S]*payload\.terminal_artifact_kind = "doc_equation_location"/,
    );
    expect(agiPlanSource).toMatch(
      /validCalculatorEvidenceArtifact &&[\s\S]*renderedCalculatorEvidenceArtifact &&[\s\S]*responseBoundaryCanPromoteDocCalculatorEvidence[\s\S]*payload\.terminal_artifact_kind = "doc_calculator_evidence"/,
    );
  });

  it("requires solver permission before active-doc navigation repairs failed terminal answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("active_doc_identity_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("doc_open_receipt_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("doc_navigation_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_active_doc_identity_projection_suppressed");
    expect(agiPlanSource).toContain("response_boundary_doc_open_receipt_projection_suppressed");
    expect(agiPlanSource).toContain("response_boundary_doc_navigation_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /failureCanPromoteActiveDocIdentity[\s\S]*payload\.terminal_artifact_kind = "active_doc_identity"/,
    );
    expect(agiPlanSource).toMatch(
      /failureCanPromoteDocOpenReceipt[\s\S]*payload\.terminal_artifact_kind = "doc_open_receipt"/,
    );
    expect(agiPlanSource).toMatch(
      /responseBoundaryCanPromoteDocNavigation[\s\S]*payload\.terminal_artifact_kind = repairedKind/,
    );
  });

  it("requires solver permission before composite receipts repair failed terminal answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteCompositeReceipt =");
    expect(agiPlanSource).toContain("composite_turn_receipt_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_composite_receipt_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /compositeTerminal\.applied &&[\s\S]*responseBoundaryCanPromoteCompositeReceipt[\s\S]*payload\.terminal_artifact_kind = "composite_turn_receipt"/,
    );
    expect(agiPlanSource).toMatch(
      /compositeTerminal\.applied &&[\s\S]*!responseBoundaryCanPromoteCompositeReceipt[\s\S]*response_boundary_composite_receipt_projection_suppressed/,
    );
  });

  it("requires solver permission before panel-control receipt projection rewrites visible answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanProjectPanelControlReceipt =");
    expect(agiPlanSource).toContain("panel_control_receipt_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_panel_control_receipt_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /openedPanelId[\s\S]*responseBoundaryCanProjectPanelControlReceipt[\s\S]*responsePayload\.selected_final_answer = panelReceiptText/,
    );
    expect(agiPlanSource).toMatch(
      /openedPanelId[\s\S]*responseBoundaryCanProjectPanelControlReceipt[\s\S]*response_boundary_panel_control_receipt_projection_suppressed/,
    );
  });

  it("requires solver permission before the top-level wrapper projects panel-control receipts", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteTopLevelPanelControlReceipt =");
    expect(agiPlanSource).toContain("const topLevelPanelControlRouteContractAllowsReceiptProjection =");
    expect(agiPlanSource).toContain("top_level_panel_control_receipt_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_top_level_panel_control_receipt_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /responseBoundaryCanPromoteTopLevelPanelControlReceipt[\s\S]*payload\.selected_final_answer = panelReceiptText/,
    );
    expect(agiPlanSource).toMatch(
      /topLevelPanelControlRouteContractAllowsReceiptProjection[\s\S]*canPromoteAskTurnTerminalKindAtResponseBoundary\([\s\S]*"workspace_action_receipt"/,
    );
    expect(agiPlanSource).toMatch(
      /responseCanonicalGoalKind === "panel_control"[\s\S]*required_terminal_kind\) === "workspace_action_receipt"/,
    );
    expect(agiPlanSource).toContain("const streamMirroredTruthTable =");
    expect(agiPlanSource).toMatch(
      /streamMirroredTruthTable[\s\S]*terminal:[\s\S]*kind: streamTerminalStatus[\s\S]*text: selectedStreamAnswer/,
    );
    expect(agiPlanSource).toMatch(
      /capability_adapter_request", "capability_adapter_result", "capability_lifecycle_ledger"[\s\S]*streamDebug\[key\] = streamFinalPayload\[key\]/,
    );
  });

  it("requires solver permission before note receipts repair terminal-boundary failures", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteNoteReceiptRepair =");
    expect(agiPlanSource).toContain("note_receipt_repair_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_note_receipt_repair_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /lateNoteUpdateReceiptForBoundaryRepair &&[\s\S]*terminal_boundary_ineligible[\s\S]*responseBoundaryCanPromoteNoteReceiptRepair[\s\S]*payload\.terminal_artifact_kind = "model_synthesized_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /lateNoteCreateTitle &&[\s\S]*terminal_boundary_ineligible[\s\S]*responseBoundaryCanPromoteNoteReceiptRepair[\s\S]*payload\.terminal_artifact_kind = "model_synthesized_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /lateNoteUpdateReceiptForBoundaryRepair &&[\s\S]*!responseBoundaryCanPromoteNoteReceiptRepair[\s\S]*response_boundary_note_receipt_repair_projection_suppressed/,
    );
  });

  it("requires solver permission before late location-to-note repair rewrites terminal answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteLocationNoteRepair =");
    expect(agiPlanSource).toContain("location_note_repair_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_location_note_repair_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /lateLocationToNoteWriteCue &&[\s\S]*responseBoundaryCanPromoteLocationNoteRepair[\s\S]*payload\.final_answer_source = "universal_composer"/,
    );
    expect(agiPlanSource).toMatch(
      /lateLocationToNoteWriteCue &&[\s\S]*!responseBoundaryCanPromoteLocationNoteRepair[\s\S]*response_boundary_location_note_repair_projection_suppressed/,
    );
  });

  it("requires solver permission before pre-failure note repairs rewrite terminal answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromotePreFailureNoteRepair =");
    expect(agiPlanSource).toContain("pre_failure_note_repair_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_pre_failure_note_repair_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /preFailureLocationToNoteCue &&[\s\S]*responseBoundaryCanPromotePreFailureNoteRepair[\s\S]*payload\.final_answer_source = "universal_composer"/,
    );
    expect(agiPlanSource).toMatch(
      /preFailureLocationToNoteCue &&[\s\S]*!responseBoundaryCanPromotePreFailureNoteRepair[\s\S]*response_boundary_pre_failure_note_repair_projection_suppressed/,
    );
    expect(agiPlanSource).toMatch(
      /preFailureNoteCreateTitle &&[\s\S]*responseBoundaryCanPromotePreFailureNoteRepair[\s\S]*payload\.terminal_artifact_id = `\$\{preFailureTurnId\}:note_create_repair:model_synthesized_answer`/,
    );
    expect(agiPlanSource).toMatch(
      /preFailureNoteCreateTitle &&[\s\S]*!responseBoundaryCanPromotePreFailureNoteRepair[\s\S]*response_boundary_pre_failure_note_repair_projection_suppressed/,
    );
  });

  it("requires solver permission before summary-to-note reentry repairs rewrite terminal answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteSummaryToNoteRepair =");
    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteRuntimeSummaryToNoteRepair =");
    expect(agiPlanSource).toContain("summary_to_note_repair_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_summary_to_note_repair_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /summaryToResolvedNoteRouteReentryRepairApplies &&[\s\S]*responseBoundaryCanPromoteSummaryToNoteRepair[\s\S]*payload\.final_answer_source = "universal_composer"/,
    );
    expect(agiPlanSource).toMatch(
      /summaryToResolvedNoteRouteReentryRepairApplies &&[\s\S]*!responseBoundaryCanPromoteSummaryToNoteRepair[\s\S]*response_boundary_summary_to_note_repair_projection_suppressed/,
    );
    expect(agiPlanSource).toMatch(
      /runtimeSummaryToNoteRepairApplies &&[\s\S]*responseBoundaryCanPromoteRuntimeSummaryToNoteRepair[\s\S]*payload\.final_answer_source = "universal_composer"/,
    );
    expect(agiPlanSource).toMatch(
      /runtimeSummaryToNoteRepairApplies &&[\s\S]*!responseBoundaryCanPromoteRuntimeSummaryToNoteRepair[\s\S]*response_boundary_summary_to_note_repair_projection_suppressed/,
    );
  });

  it("requires terminal authority before the source-path note receipt shortcut can answer", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("note_receipt_source_path_short_circuit");
    expect(agiPlanSource).toContain("const noteReceiptSourcePathCanPromote =");
    expect(agiPlanSource).toMatch(
      /noteReceiptSourcePathCanPromote[\s\S]*canPromoteAskTurnTerminalKindAtResponseBoundary\([\s\S]*"model_synthesized_answer"[\s\S]*\)/,
    );
    expect(agiPlanSource).toMatch(
      /activeDocPath && noteReceiptSourcePathCanPromote[\s\S]*terminal_artifact_id: `\$\{turnId\}:model_synthesized_answer:from_note_receipt`/,
    );
  });

  it("requires solver permission before late note receipts repair failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteLateNoteReceiptTerminal =");
    expect(agiPlanSource).toContain("late_note_receipt_terminal_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_late_note_receipt_terminal_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /lateNoteReceiptForTerminal &&[\s\S]*responseBoundaryCanPromoteLateNoteReceiptTerminal[\s\S]*payload\.terminal_artifact_kind = "model_synthesized_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /lateNoteReceiptForTerminal &&[\s\S]*!responseBoundaryCanPromoteLateNoteReceiptTerminal[\s\S]*response_boundary_late_note_receipt_terminal_projection_suppressed/,
    );
  });

  it("requires solver permission before live-environment drafts repair failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteLiveEnvironmentDraft =");
    expect(agiPlanSource.match(/const responseBoundaryCanPromoteLiveEnvironmentDraft =/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(agiPlanSource).toContain("live_environment_draft_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_live_environment_draft_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /liveEnvironmentDraftText &&[\s\S]*responseBoundaryCanPromoteLiveEnvironmentDraft[\s\S]*payload\.selected_final_answer = liveEnvironmentDraftText/,
    );
    expect(agiPlanSource).toMatch(
      /liveEnvironmentDraftIsDeterministicReceipt[\s\S]*responseBoundaryCanPromoteLiveEnvironmentDraft[\s\S]*payload\.final_answer_source = "deterministic_receipt_fallback"/,
    );
    expect(agiPlanSource).toMatch(
      /liveEnvironmentDraftText &&[\s\S]*!responseBoundaryCanPromoteLiveEnvironmentDraft[\s\S]*response_boundary_live_environment_draft_projection_suppressed/,
    );
  });

  it("requires solver permission before terminal note receipts repair failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteTerminalNoteReceipt =");
    expect(agiPlanSource).toContain("note_receipt_terminal_candidate_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_terminal_note_receipt_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /terminalNoteUpdateReceipt && responseBoundaryCanPromoteTerminalNoteReceipt[\s\S]*payload\.note_update_receipt_terminal_candidate_quarantined = true/,
    );
    expect(agiPlanSource).toMatch(
      /terminalNoteCreateReceipt &&[\s\S]*responseBoundaryCanPromoteTerminalNoteReceipt[\s\S]*payload\.note_create_receipt_terminal_candidate_quarantined = true/,
    );
    expect(agiPlanSource).toMatch(
      /terminalNoteUpdateReceipt && !responseBoundaryCanPromoteTerminalNoteReceipt[\s\S]*response_boundary_terminal_note_receipt_projection_suppressed/,
    );
  });

  it("requires solver permission before route draft projections rewrite terminal answers", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteRouteDraftProjection =");
    expect(agiPlanSource.match(/const responseBoundaryCanPromoteRouteDraftProjection =/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(agiPlanSource).toContain("route_draft_projection_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_route_draft_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /calculator_solve \/ calculator_compound_chain[\s\S]*responseBoundaryCanPromoteRouteDraftProjection[\s\S]*payload\.terminal_artifact_kind = "workstation_tool_evaluation"/,
    );
    expect(agiPlanSource).toMatch(
      /moral_graph_reflection[\s\S]*responseBoundaryCanPromoteRouteDraftProjection[\s\S]*payload\.terminal_error_code = null/,
    );
    expect(agiPlanSource).toMatch(
      /route_draft_projection_requires_solver_or_terminal_authority[\s\S]*response_boundary_route_draft_projection_suppressed/,
    );
  });

  it("requires solver permission before model-only direct repairs rewrite failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteModelOnlyDirectRepair =");
    expect(agiPlanSource).toContain("model_only_direct_repair_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_model_only_direct_repair_suppressed");
    expect(agiPlanSource).toMatch(
      /replacement && responseBoundaryCanPromoteModelOnlyDirectRepair[\s\S]*payload\.final_answer_source = "model_direct_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /repairAnswer &&[\s\S]*responseBoundaryCanPromoteModelOnlyDirectRepair[\s\S]*payload\.terminal_artifact_kind = "direct_answer_text"/,
    );
    expect(agiPlanSource).toMatch(
      /replacement && !responseBoundaryCanPromoteModelOnlyDirectRepair[\s\S]*response_boundary_model_only_direct_repair_suppressed/,
    );
    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteLateModelOnlyDirectRepair =");
    expect(agiPlanSource).toContain("response_boundary_late_model_only_direct_repair_suppressed");
    expect(agiPlanSource).toMatch(
      /modelOnlyReplacement && responseBoundaryCanPromoteLateModelOnlyDirectRepair[\s\S]*payload\.final_answer_source = "model_direct_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /modelOnlyReplacement && !responseBoundaryCanPromoteLateModelOnlyDirectRepair[\s\S]*model_only_direct_repair_requires_solver_authority/,
    );
  });

  it("requires solver permission before force-meta test terminals rewrite failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteForceMetaTerminal =");
    expect(agiPlanSource).toContain("force_meta_terminal_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_force_meta_terminal_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /forceMetaTerminalForTest && finalAnswerContractRepairApplied && responseBoundaryCanPromoteForceMetaTerminal[\s\S]*payload\.final_answer_source = "model_direct_answer"/,
    );
    expect(agiPlanSource).toMatch(
      /forceMetaTerminalForTest && finalAnswerContractRepairApplied && !responseBoundaryCanPromoteForceMetaTerminal[\s\S]*response_boundary_force_meta_terminal_projection_suppressed/,
    );
  });

  it("requires solver permission before situation context terminals repair failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteSituationContextHelper =");
    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteSituationContextTerminal =");
    expect(agiPlanSource).toContain("situation_context_terminal_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_situation_context_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /applySituationContextFinalAnswer[\s\S]*responseBoundaryCanPromoteSituationContextHelper[\s\S]*if \(!responseBoundaryCanPromoteSituationContextHelper\)[\s\S]*return;[\s\S]*payload\.final_answer_source = "artifact_synthesis"/,
    );
    expect(agiPlanSource).toMatch(
      /situationContextTerminalKind === "situation_context_pack"[\s\S]*responseBoundaryCanPromoteSituationContextTerminal[\s\S]*delete payload\.terminal_error_code/,
    );
    expect(agiPlanSource).toMatch(
      /!responseBoundaryCanPromoteSituationContextTerminal[\s\S]*response_boundary_situation_context_projection_suppressed/,
    );
  });

  it("requires solver permission before process graph overview repairs failed terminal state", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const responseBoundaryCanPromoteProcessGraphOverview =");
    expect(agiPlanSource).toContain("process_graph_overview_requires_solver_or_terminal_authority");
    expect(agiPlanSource).toContain("response_boundary_process_graph_overview_projection_suppressed");
    expect(agiPlanSource).toMatch(
      /processGraphRuntimeLoopBacked &&[\s\S]*responseBoundaryCanPromoteProcessGraphOverview[\s\S]*payload\.terminal_artifact_kind = "process_graph_overview"/,
    );
    expect(agiPlanSource).toMatch(
      /processGraphRuntimeLoopBacked &&[\s\S]*!responseBoundaryCanPromoteProcessGraphOverview[\s\S]*response_boundary_process_graph_overview_projection_suppressed/,
    );
  });

  it("requires solver permission before the top-level Ask wrapper mints terminal authority", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");

    expect(agiPlanSource).toContain("const askWrapperCanProjectTerminalAuthority =");
    expect(agiPlanSource).toContain("canProjectAskTurnTerminalAtResponseBoundary(typedPayload, typedDebug)");
    expect(agiPlanSource).toContain("ask_wrapper_projection_without_solver_authority");
    expect(agiPlanSource).toContain("ask_wrapper_projection_suppressed_by_solver_authority");
    expect(agiPlanSource).toMatch(
      /if \(poisonTerminalText && !askWrapperCanProjectTerminalAuthority\) \{[\s\S]*final_answer_source: "typed_failure"[\s\S]*terminal_artifact_kind: "typed_failure"/,
    );
    expect(agiPlanSource).toMatch(
      /const terminalAuthorityRecord = recordHelixTurnTerminalAuthority\(\{[\s\S]*terminal_text: poisonTerminalText/,
    );
  });

  it("keeps goal sessions, goal context, packet traces, route evidence, and automation policies exposed in the top-level Ask live_env capability surface", () => {
    const agiPlanSource = readFileSync(resolve(__dirname, "../routes/agi.plan.ts"), "utf8");
    const capabilities = [
      "live_env.start_agent_goal_session",
      "live_env.query_workstation_goal_context",
      "live_env.query_packet_traces",
      "live_env.query_route_evidence",
      "live_env.query_automation_policies",
    ];

    for (const capability of capabilities) {
      expect(agiPlanSource.match(new RegExp(`case "${capability}"`, "g"))?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(agiPlanSource).toContain(`"${capability}",`);
      expect(agiPlanSource).toContain(`capability_key: "${capability}"`);
    }

    expect(agiPlanSource).toContain("context_feeds");
    expect(agiPlanSource).toContain("allowed_actuators");
    expect(agiPlanSource).toContain("producer_kind");
    expect(agiPlanSource).toContain("update_kind");
    expect(agiPlanSource).toContain("packet_id");
    expect(agiPlanSource).toContain("route-watch GoalContextUpdate evidence");
  });
});
