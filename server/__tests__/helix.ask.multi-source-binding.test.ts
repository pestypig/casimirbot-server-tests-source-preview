import { beforeEach, describe, expect, it } from "vitest";
import {
  addLiveAnswerEnvironmentSourceIds,
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { ensureLiveSituationRunForEnvironment, resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { appendLiveSourceChunk, resetLiveSourceChunkBufferForTest, upsertLiveSourceProducer } from "../services/situation-room/live-source-chunk-buffer";
import { appendObservationJournalEntry, listObservationJournalEntries, resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { routeSituationContextTurn } from "../services/helix-ask/situation-context-turn-router";
import { resolveActiveSituationContext } from "../services/situation-room/active-situation-context-resolver";
import { selectSituationEvidence } from "../services/helix-ask/situation-evidence-selector";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { guardTerminalArtifactSelection } from "../services/helix-ask/terminal-artifact-selection-guard";
import {
  acceptSourceBindingRepairCandidate,
  createSourceBindingRepairCandidate,
  listSourceBindingStatusLedger,
  listSourceBindingStatuses,
  resetSourceBindingStatusForTest,
} from "../services/situation-room/source-binding-status-store";

const THREAD_ID = "helix-ask:desktop";

beforeEach(() => {
  resetLiveAnswerEnvironments();
  resetLiveSituationRunsForTest();
  resetLiveSourceChunkBufferForTest();
  resetObservationJournalForTest();
  resetSourceBindingStatusForTest();
});

describe("Helix Ask multi-source binding", () => {
  it("keeps unbound visual evidence global-only and surfaces a repair candidate", () => {
    upsertLiveSourceProducer({
      sourceId: "visual_source:unbound",
      threadId: THREAD_ID,
      modality: "visual_frame",
      status: "active",
    });
    const old = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:old-unbound-visual",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:unbound",
      text: "A folder is visible on the screen.",
      evidence_refs: ["live_source_analysis_job:old"],
      model_invoked: true,
      created_at: "2026-05-19T12:00:00.000Z",
    });

    const status = listSourceBindingStatuses({ threadId: THREAD_ID, sourceId: "visual_source:unbound" }).at(-1);
    expect(status).toMatchObject({
      state: "observed_unbound",
      terminal_eligible: false,
    });
    expect(listSourceBindingStatusLedger({ threadId: THREAD_ID }).some((entry) => entry.event_kind === "source_observed_unbound")).toBe(true);

    const route = routeSituationContextTurn({
      threadId: THREAD_ID,
      promptText: "what am I looking at?",
      turnId: "turn:visual-unbound",
    });
    expect(route.situation_evidence_selection.answerable).toBe(false);
    expect(route.situation_evidence_selection.selected_observation_refs).not.toContain(old.observation_id);
    expect(route.binding_repair?.schema).toBe("helix.source_binding_repair_candidate.v1");
    expect(route.binding_repair?.requires_explicit_acceptance).toBe(true);
  });

  it("accepts visual repair as future-only without replaying old unbound observations", () => {
    appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:old-visual-future-only",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:future",
      text: "Old unbound visual evidence.",
      evidence_refs: ["old_visual_ref"],
      model_invoked: true,
      created_at: "2026-05-19T12:00:00.000Z",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: THREAD_ID,
      created_turn_id: "turn:create-visual-run",
      objective: "Answer from future visual evidence only.",
      preset: "custom",
      source_ids: ["visual_source:future"],
      now: "2026-05-19T12:01:00.000Z",
    });
    const run = ensureLiveSituationRunForEnvironment({ environment, now: "2026-05-19T12:01:00.000Z" });
    const candidate = createSourceBindingRepairCandidate({
      threadId: THREAD_ID,
      sourceId: "visual_source:future",
      sourceKind: "visual_capture",
      modality: "visual_frame",
      targetSituationRunId: run.situation_run_id,
      targetEnvironmentId: run.environment_id,
      proposedReplayPolicy: "future_only",
      oldUnboundObservationRefs: ["observation:old-visual-future-only"],
    });
    const accepted = acceptSourceBindingRepairCandidate({
      repairCandidateId: candidate.repair_candidate_id,
      acceptedByTurnId: "turn:accept-visual",
      replayPolicy: "future_only",
      targetSituationRunId: run.situation_run_id,
      targetEnvironmentId: run.environment_id,
      now: "2026-05-19T12:02:00.000Z",
    });
    expect(accepted?.replayed_observation_refs).toEqual([]);

    const immediateContext = resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id });
    const immediateSelection = selectSituationEvidence({ threadId: THREAD_ID, activeContext: immediateContext });
    expect(immediateSelection.selected_observation_refs).not.toContain("observation:old-visual-future-only");
    const lateOld = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:late-old-visual",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:future",
      text: "Late-ingested but old visual evidence.",
      evidence_refs: ["late_old_visual_ref"],
      model_invoked: true,
      observed_at: "2026-05-19T12:00:30.000Z",
      created_at: "2026-05-19T12:02:30.000Z",
    });
    expect(lateOld.source_binding_id).toBeNull();
    expect(selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id }),
    }).selected_observation_refs).not.toContain(lateOld.observation_id);

    const next = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:new-bound-visual",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:future",
      source_binding_id: accepted?.status.binding_id,
      text: "New bound visual evidence.",
      evidence_refs: ["new_visual_ref"],
      model_invoked: true,
      created_at: "2026-05-19T12:03:00.000Z",
    });
    const context = resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id });
    const selection = selectSituationEvidence({ threadId: THREAD_ID, activeContext: context });
    expect(selection.answerable).toBe(true);
    expect(selection.selected_observation_refs).toContain(next.observation_id);
    expect(selection.selected_source_binding_status_refs).toContain(accepted?.status.status_id);

    const answered = routeSituationContextTurn({
      threadId: THREAD_ID,
      promptText: "what am I looking at?",
      turnId: "turn:visual-bound-answer",
      submittedAt: "2026-05-19T12:03:01.000Z",
      answerStartedAt: "2026-05-19T12:03:01.000Z",
    });
    expect(answered.answer_text).toContain("Source refs:");
  });

  it("keeps calculator chunks unselected until explicit replay creates replayed observations", () => {
    appendLiveSourceChunk({
      source_id: "calculator_stream:test",
      thread_id: THREAD_ID,
      modality: "calculator_stream",
      compact_summary: "Old calculator tick: x=2.",
      evidence_refs: ["calc_tick:old"],
      ts: "2026-05-19T12:00:00.000Z",
    });
    const old = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:old-calculator",
      kind: "tool_observation",
      modality: "calculator_stream",
      source_id: "calculator_stream:test",
      text: "Old calculator result x=2.",
      evidence_refs: ["calc_tick:old"],
      model_invoked: false,
      created_at: "2026-05-19T12:00:01.000Z",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: THREAD_ID,
      created_turn_id: "turn:create-calc-run",
      objective: "Answer from calculator stream.",
      preset: "calculator_equation_interpreter",
      source_ids: ["calculator_stream:test"],
      now: "2026-05-19T12:01:00.000Z",
    });
    const run = ensureLiveSituationRunForEnvironment({ environment, now: "2026-05-19T12:01:00.000Z" });
    const candidate = createSourceBindingRepairCandidate({
      threadId: THREAD_ID,
      sourceId: "calculator_stream:test",
      sourceKind: "calculator_stream",
      modality: "calculator_stream",
      targetSituationRunId: run.situation_run_id,
      targetEnvironmentId: run.environment_id,
      proposedReplayPolicy: "explicit_replay_window",
      oldUnboundObservationRefs: [old.observation_id],
      oldUnboundChunkRefs: ["live_source_chunk:old-calculator"],
    });
    const futureOnly = acceptSourceBindingRepairCandidate({
      repairCandidateId: candidate.repair_candidate_id,
      replayPolicy: "future_only",
      targetSituationRunId: run.situation_run_id,
      targetEnvironmentId: run.environment_id,
    });
    expect(futureOnly?.replayed_observation_refs).toEqual([]);
    expect(selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id }),
    }).selected_observation_refs).not.toContain(old.observation_id);

    const replayCandidate = createSourceBindingRepairCandidate({
      threadId: THREAD_ID,
      sourceId: "calculator_stream:test",
      sourceKind: "calculator_stream",
      modality: "calculator_stream",
      targetSituationRunId: run.situation_run_id,
      targetEnvironmentId: run.environment_id,
      proposedReplayPolicy: "explicit_replay_window",
      oldUnboundObservationRefs: [old.observation_id],
    });
    const replayed = acceptSourceBindingRepairCandidate({
      repairCandidateId: replayCandidate.repair_candidate_id,
      replayPolicy: "explicit_replay_window",
      replayWindow: {
        from_ts: "2026-05-19T11:59:00.000Z",
        to_ts: "2026-05-19T12:01:00.000Z",
      },
      targetSituationRunId: run.situation_run_id,
      targetEnvironmentId: run.environment_id,
      now: "2026-05-19T12:02:00.000Z",
    });
    expect(replayed?.replayed_observation_refs.length).toBeGreaterThan(0);
    const observations = listObservationJournalEntries({ threadId: THREAD_ID, limit: 20 });
    expect(observations.find((entry) => entry.observation_id === old.observation_id)?.source_binding_id).toBeNull();
    expect(observations.find((entry) => replayed?.replayed_observation_refs.includes(entry.observation_id))?.replay_status).toBe("replayed");
    expect(listSourceBindingStatusLedger({ threadId: THREAD_ID }).map((entry) => entry.event_kind)).toEqual(
      expect.arrayContaining(["repair_replay_window_created", "repair_replay_completed"]),
    );
  });

  it("binds visual and Minecraft world-event sources independently", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: THREAD_ID,
      created_turn_id: "turn:create-mc-run",
      objective: "Answer from visual and Minecraft world events.",
      preset: "minecraft_run_monitor",
      source_ids: ["visual_source:mc"],
      now: "2026-05-19T13:00:00.000Z",
    });
    const run = ensureLiveSituationRunForEnvironment({ environment, now: "2026-05-19T13:00:00.000Z" });
    const visual = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:mc-visual-bound",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:mc",
      text: "Minecraft is visible on screen.",
      evidence_refs: ["visual:mc"],
      model_invoked: true,
      created_at: "2026-05-19T13:00:05.000Z",
    });
    const unboundWorld = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:mc-world-unbound",
      kind: "raw_source_event",
      modality: "world_event",
      source_id: "world_event:mc",
      text: "A zombie containment event arrived from the Minecraft server.",
      evidence_refs: ["world:old"],
      model_invoked: false,
      created_at: "2026-05-19T13:00:06.000Z",
    });

    let selection = selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id }),
    });
    expect(selection.selected_observation_refs).toContain(visual.observation_id);
    expect(selection.selected_observation_refs).not.toContain(unboundWorld.observation_id);
    expect(listSourceBindingStatuses({ threadId: THREAD_ID, sourceId: "world_event:mc" }).at(-1)?.state).toBe("observed_unbound");

    const attached = addLiveAnswerEnvironmentSourceIds({
      environment_id: environment.environment_id,
      source_ids: ["world_event:mc"],
      now: "2026-05-19T13:01:00.000Z",
    });
    expect(attached).toBeTruthy();
    const refreshedRun = ensureLiveSituationRunForEnvironment({
      environment: attached!.environment,
      now: "2026-05-19T13:01:00.000Z",
    });
    const boundWorld = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:mc-world-bound",
      kind: "raw_source_event",
      modality: "world_event",
      source_id: "world_event:mc",
      text: "The Minecraft server reports a contained zombie cluster.",
      evidence_refs: ["world:new"],
      model_invoked: false,
      created_at: "2026-05-19T13:01:05.000Z",
    });
    selection = selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: refreshedRun.environment_id }),
    });
    expect(selection.selected_observation_refs).toContain(boundWorld.observation_id);
    expect(selection.selected_source_binding_status_refs.some((ref) => ref.includes("source_binding_status:"))).toBe(true);
  });

  it("keeps audio transcript chunks unbound until explicit transcript attachment", () => {
    appendLiveSourceChunk({
      source_id: "audio_transcript:display",
      thread_id: THREAD_ID,
      modality: "audio_transcript",
      compact_summary: "Old display transcript: build succeeded.",
      evidence_refs: ["audio:old"],
      ts: "2026-05-19T14:00:00.000Z",
    });
    expect(listSourceBindingStatuses({ threadId: THREAD_ID, sourceId: "audio_transcript:display" }).at(-1)).toMatchObject({
      source_kind: "display_audio_transcript",
      state: "observed_unbound",
    });

    const { environment } = createLiveAnswerEnvironment({
      thread_id: THREAD_ID,
      created_turn_id: "turn:create-audio-run",
      objective: "Answer from display transcript evidence.",
      preset: "custom",
      source_ids: ["audio_transcript:display"],
      now: "2026-05-19T14:01:00.000Z",
    });
    const run = ensureLiveSituationRunForEnvironment({ environment, now: "2026-05-19T14:01:00.000Z" });
    const transcript = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:audio-bound",
      kind: "transcript_observation",
      modality: "audio_transcript",
      source_id: "audio_transcript:display",
      text: "The transcript says the build succeeded.",
      evidence_refs: ["audio:new"],
      model_invoked: false,
      created_at: "2026-05-19T14:01:05.000Z",
    });
    const selection = selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id }),
    });
    expect(selection.selected_observation_refs).toContain(transcript.observation_id);
    expect(selection.selected_source_binding_status_refs.length).toBeGreaterThan(0);
  });

  it("keeps docs-viewer observations global-only until bound and preserves docs terminal contract", () => {
    const docsIntent = arbitrateAskSourceTarget({
      turnId: "turn:docs-contract",
      threadId: THREAD_ID,
      promptText: "In the docs viewer, locate the equation.",
    });
    const docsContract = buildRouteProductContract({
      turnId: "turn:docs-contract",
      threadId: THREAD_ID,
      sourceTargetIntent: docsIntent,
      promptText: "In the docs viewer, locate the equation.",
    });
    expect(docsContract.allowed_terminal_artifact_kinds).toContain("doc_location_result");
    expect(docsContract.forbidden_terminal_artifact_kinds).toContain("situation_context_pack");

    const oldDoc = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:doc-unbound",
      kind: "reference_observation",
      modality: "document_context",
      source_id: "docs_viewer:main",
      text: "The docs viewer shows Equation 4.",
      evidence_refs: ["doc:old"],
      model_invoked: false,
      created_at: "2026-05-19T15:00:00.000Z",
    });
    expect(listSourceBindingStatuses({ threadId: THREAD_ID, sourceId: "docs_viewer:main" }).at(-1)?.state).toBe("observed_unbound");

    const { environment } = createLiveAnswerEnvironment({
      thread_id: THREAD_ID,
      created_turn_id: "turn:create-docs-run",
      objective: "Answer from docs viewer context.",
      preset: "custom",
      source_ids: ["docs_viewer:main"],
      now: "2026-05-19T15:01:00.000Z",
    });
    const run = ensureLiveSituationRunForEnvironment({ environment, now: "2026-05-19T15:01:00.000Z" });
    let selection = selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id }),
    });
    expect(selection.selected_observation_refs).not.toContain(oldDoc.observation_id);

    const newDoc = appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:doc-bound",
      kind: "reference_observation",
      modality: "document_context",
      source_id: "docs_viewer:main",
      text: "The bound docs viewer context shows Equation 5.",
      evidence_refs: ["doc:new"],
      model_invoked: false,
      created_at: "2026-05-19T15:01:05.000Z",
    });
    selection = selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id }),
    });
    expect(selection.selected_observation_refs).toContain(newDoc.observation_id);
    expect(selection.selected_source_refs.every((ref) => !ref.includes("visual"))).toBe(true);
  });

  it("supports process_graph source kind and enforces terminal source refs", () => {
    appendLiveSourceChunk({
      source_id: "process_graph:workstation",
      thread_id: THREAD_ID,
      modality: "process_graph",
      compact_summary: "Process graph observed node build:test.",
      evidence_refs: ["process:old"],
      ts: "2026-05-19T16:00:00.000Z",
    });
    expect(listSourceBindingStatuses({ threadId: THREAD_ID, sourceId: "process_graph:workstation" }).at(-1)).toMatchObject({
      source_kind: "process_graph",
      state: "observed_unbound",
    });

    const processIntent = arbitrateAskSourceTarget({
      turnId: "turn:process-contract",
      threadId: THREAD_ID,
      promptText: "Show the process graph overview.",
    });
    const processContract = buildRouteProductContract({
      turnId: "turn:process-contract",
      threadId: THREAD_ID,
      sourceTargetIntent: processIntent,
      promptText: "Show the process graph overview.",
    });
    expect(processContract.allowed_terminal_artifact_kinds).toContain("process_graph_overview");

    const { environment } = createLiveAnswerEnvironment({
      thread_id: THREAD_ID,
      created_turn_id: "turn:create-process-run",
      objective: "Answer from process graph.",
      preset: "custom",
      source_ids: ["process_graph:workstation"],
      now: "2026-05-19T16:01:00.000Z",
    });
    const run = ensureLiveSituationRunForEnvironment({ environment, now: "2026-05-19T16:01:00.000Z" });
    appendObservationJournalEntry({
      thread_id: THREAD_ID,
      observation_id: "observation:process-bound",
      kind: "tool_observation",
      modality: "process_graph",
      source_id: "process_graph:workstation",
      text: "Process graph node build:test is active.",
      evidence_refs: ["process:new"],
      model_invoked: false,
      created_at: "2026-05-19T16:01:05.000Z",
    });
    const selection = selectSituationEvidence({
      threadId: THREAD_ID,
      activeContext: resolveActiveSituationContext({ threadId: THREAD_ID, environmentId: run.environment_id }),
    });
    const statuses = listSourceBindingStatuses({ threadId: THREAD_ID, sourceId: "process_graph:workstation" });
    expect(guardTerminalArtifactSelection({
      contract: processContract,
      terminalArtifactKind: "process_graph_overview",
      evidenceSelection: selection,
      sourceBindingStatuses: statuses,
      terminalText: "Process graph overview",
    }).allowed).toBe(false);
    expect(guardTerminalArtifactSelection({
      contract: processContract,
      terminalArtifactKind: "process_graph_overview",
      evidenceSelection: selection,
      sourceBindingStatuses: statuses,
      terminalText: `Process graph overview\nSource refs: ${selection.selected_source_refs.join(", ")}.`,
    }).allowed).toBe(true);
    expect(listSourceBindingStatusLedger({ threadId: THREAD_ID }).map((entry) => entry.event_kind)).toEqual(
      expect.arrayContaining(["terminal_selection_rejected", "terminal_selection_allowed"]),
    );
  });
});
