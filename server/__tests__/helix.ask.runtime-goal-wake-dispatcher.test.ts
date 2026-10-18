import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { helixRuntimeGoalSessionStore } from "../services/helix-ask/agent-providers/goal-runtime-session";
import { routeHelixRuntimeGoalCommand as routeHelixRuntimeGoalCommandImpl } from "../services/helix-ask/runtime-goal-command-router";
import { dispatchRuntimeGoalWakeCandidate as dispatchRuntimeGoalWakeCandidateImpl } from "../services/helix-ask/runtime-goals/runtime-goal-wake-dispatcher";
import { clearRuntimeGoalWakeAdmissionDedupe } from "../services/helix-ask/runtime-goals/runtime-goal-wake-admission";
import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../services/helix-account/account-session-store";
import { resolveWorkstationGatewayAccountContext } from "../services/helix-ask/workstation-tool-gateway/account-policy";
import type { HelixWorkstationGatewayAccountContext } from "../services/helix-ask/workstation-tool-gateway/account-policy";
import {
  bridgeRealtimeTranscriptToStagePlay,
  resetRealtimeStagePlayAskHandoffsForTests,
} from "../services/helix-ask/live-source/realtime-stage-play-handoff";
import { buildRealtimeTranscriptObservation } from "../services/helix-ask/realtime-session/route-boundary";
import {
  admitRealtimeSession,
  buildRealtimeRequesterRef,
  resetRealtimeSessionRegistryForTests,
} from "../services/helix-ask/realtime-session/session-registry";
import {
  readRealtimeGroundedAnswer,
  resetRealtimeGroundedAnswerFeedbackForTests,
} from "../services/helix-ask/realtime-session/grounded-answer-feedback";
import { readRealtimeGroundedAnswerRelay } from "../services/helix-ask/realtime-session/grounded-answer-relay";
import { resetStagePlayLiveSourceConversationStoreForTest } from "../services/stage-play/stage-play-live-source-conversation-store";
import { buildRuntimeGoalAccountScope } from "../services/helix-ask/runtime-goals/runtime-goal-account-binding";

const originalEnableCodexAgent = process.env.ENABLE_CODEX_AGENT;
const originalCodexFakeStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
const originalCodexFakeExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
let requestHeaders: { cookie: string };
let accountContext: HelixWorkstationGatewayAccountContext;

const routeHelixRuntimeGoalCommand: typeof routeHelixRuntimeGoalCommandImpl = (input) =>
  routeHelixRuntimeGoalCommandImpl({ ...input, headers: input.headers ?? requestHeaders });

const dispatchRuntimeGoalWakeCandidate: typeof dispatchRuntimeGoalWakeCandidateImpl = (input) =>
  dispatchRuntimeGoalWakeCandidateImpl({ ...input, headers: input.headers ?? requestHeaders });

const restoreEnv = () => {
  if (originalEnableCodexAgent === undefined) {
    delete process.env.ENABLE_CODEX_AGENT;
  } else {
    process.env.ENABLE_CODEX_AGENT = originalEnableCodexAgent;
  }
  if (originalCodexFakeStdout === undefined) {
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
  } else {
    process.env.CODEX_AGENT_FAKE_STDOUT = originalCodexFakeStdout;
  }
  if (originalCodexFakeExitCode === undefined) {
    delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
  } else {
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = originalCodexFakeExitCode;
  }
};

const visibleDocSnapshot = (docPath: string, visibleText: string, sourceHash = "fnv1a32:auto-wake") => ({
  activePanel: "docs-viewer",
  active_doc_path: docPath,
  active_doc_visible_translation_context: {
    schema: "helix.ask.active_doc_visible_translation_context.v1",
    doc_path: docPath,
    source_id: `document_markdown:${docPath}`,
    source_hash: sourceHash,
    chunks: [
      {
        chunk_id: `${sourceHash}:visible-1`,
        visible_text: visibleText,
      },
    ],
  },
});

beforeEach(async () => {
  resetRealtimeGroundedAnswerFeedbackForTests();
  resetRealtimeStagePlayAskHandoffsForTests();
  resetRealtimeSessionRegistryForTests();
  resetStagePlayLiveSourceConversationStoreForTest();
  await resetAccountSessionStore();
  const receipt = await signInLocalAccountSession({
    profile_id: "profile:runtime-goal-wake-test",
    account_type: "developer",
  });
  const sessionId = receipt.session?.session_id ?? "";
  requestHeaders = { cookie: `helix_session=${encodeURIComponent(sessionId)}` };
  accountContext = await resolveWorkstationGatewayAccountContext(sessionId);
});

afterEach(() => {
  helixRuntimeGoalSessionStore.clear();
  clearRuntimeGoalWakeAdmissionDedupe();
  restoreEnv();
});

describe("runtime goal wake dispatcher", () => {
  it("admits a visible source change and resumes the runtime goal through governed document evidence", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "Auto wake summary: the new document section was inspected.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:auto-wake-start",
        question: "/goal Keep a cumulative summary of the visible document section.",
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/original.md",
          "The original visible section is only the starting point.",
          "fnv1a32:auto-start",
        ),
      },
    });
    expect(start.statusCode).toBe(200);
    const goalId = String((start.payload.runtime_goal_session as Record<string, unknown>).goal_id);

    const result = await dispatchRuntimeGoalWakeCandidate({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:auto-wake",
        event_kind: "visible_source_changed",
        goal_id: goalId,
        source_kind: "docs_viewer_visible_surface",
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        active_panel_id: "docs-viewer",
        source_freshness_ms: 11,
        source_hash: "fnv1a32:auto-new",
        reason: "docs_viewer_active_doc_changed",
        dedupe_key: "docs-viewer:docs/research/nhm2-current-status-whitepaper.md",
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/research/nhm2-current-status-whitepaper.md",
          "The NHM2 document frames current status as diagnostic and artifact-limited.",
          "fnv1a32:auto-new",
        ),
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      goal_id: goalId,
      wake_event_id: expect.stringContaining("goal-wake:"),
      runtime_goal_wake_candidate: {
        event_kind: "visible_source_changed",
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        dedupe_key: "docs-viewer:docs/research/nhm2-current-status-whitepaper.md",
      },
      runtime_goal_wake_admission: {
        status: "admitted",
        reason: "visible_source_changed",
        goal_id: goalId,
      },
      runtime_goal_wake_event: {
        wake_event_id: expect.stringContaining("goal-wake:"),
        goal_id: goalId,
        kind: "visible_source_changed",
      },
      runtime_goal_session: {
        goal_id: goalId,
        status: "waiting",
        runtime_agent_provider: "codex",
        terminal_authority_status: "authorized",
      },
      runtime_goal_source_binding: {
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        source_kind: "docs_viewer_visible_surface",
      },
      runtime_goal_wake_plan: {
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
      },
      runtime_goal_debug_export: {
        latest_wake_candidate: {
          event_kind: "visible_source_changed",
        },
        latest_wake_admission: {
          status: "admitted",
        },
      },
    });
    expect(String(result.payload.selected_final_answer)).toContain("Auto wake summary");
    expect(String(result.payload.selected_final_answer)).toContain(
      "Observed source: docs/research/nhm2-current-status-whitepaper.md",
    );
    expect((result.payload.runtime_goal_session as Record<string, unknown>).latest_observation_refs).toEqual(
      expect.arrayContaining([expect.stringContaining("docs-viewer.read_visible_surface")]),
    );
    const debugEvents = ((result.payload.runtime_goal_debug_export as Record<string, unknown>).debug_events ?? []) as Array<Record<string, unknown>>;
    expect(debugEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "wake_received" }),
        expect.objectContaining({ stage: "tool_or_lane_admitted" }),
        expect.objectContaining({ stage: "evidence_reentered" }),
        expect.objectContaining({ stage: "terminal_authority_evaluated", terminal_authority_status: "authorized" }),
      ]),
    );
  }, 15_000);

  it("admits a same-document visible surface change and resumes the runtime goal once", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "Visible surface wake summary: the next section was inspected.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:surface-wake-start",
        question: "/goal Keep a cumulative summary of the visible document section.",
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/current.md",
          "The first visible section opens the document.",
          "fnv1a32:surface-doc",
        ),
      },
    });
    expect(start.statusCode).toBe(200);
    const goalId = String((start.payload.runtime_goal_session as Record<string, unknown>).goal_id);

    const result = await dispatchRuntimeGoalWakeCandidate({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:surface-wake",
        event_kind: "visible_surface_changed",
        goal_id: goalId,
        source_kind: "docs_viewer_visible_surface",
        doc_path: "docs/current.md",
        active_panel_id: "docs-viewer",
        source_id: "document_markdown:docs/current.md",
        source_hash: "fnv1a32:surface-doc",
        reason: "docs_viewer_visible_surface_changed",
        dedupe_key: "docs-viewer:docs/current.md:visible-surface:u0003:fnv1a32:surface-chunk",
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/current.md",
          "The second visible section changes within the same document.",
          "fnv1a32:surface-doc",
        ),
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      goal_id: goalId,
      runtime_goal_wake_candidate: {
        event_kind: "visible_surface_changed",
        reason: "docs_viewer_visible_surface_changed",
        doc_path: "docs/current.md",
        source_hash: "fnv1a32:surface-doc",
      },
      runtime_goal_wake_admission: {
        status: "admitted",
        reason: "visible_surface_changed",
        goal_id: goalId,
      },
      runtime_goal_wake_event: {
        wake_event_id: expect.stringContaining("goal-wake:"),
        goal_id: goalId,
        kind: "visible_surface_changed",
      },
      runtime_goal_session: {
        goal_id: goalId,
        status: "waiting",
        runtime_agent_provider: "codex",
        terminal_authority_status: "authorized",
      },
      runtime_goal_wake_plan: {
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
      },
    });
    expect(String(result.payload.selected_final_answer)).toContain("Visible surface wake summary");
    expect(String(result.payload.selected_final_answer)).toContain("Observed source: docs/current.md");
    expect((result.payload.runtime_goal_session as Record<string, unknown>).latest_observation_refs).toEqual(
      expect.arrayContaining([expect.stringContaining("docs-viewer.read_visible_surface")]),
    );
  }, 15_000);

  it("returns an authorized durable-goal wake answer to the account-bound Realtime relay", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Live goal summary: the visible document evidence was inspected and retained.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:live-goal-start",
        question: "/goal Track the visible document and report grounded progress on voice wakes.",
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/live-goal.md",
          "The initial live-goal section establishes the baseline.",
          "fnv1a32:live-goal-start",
        ),
      },
    });
    expect(start.statusCode).toBe(200);
    const goalId = String((start.payload.runtime_goal_session as Record<string, unknown>).goal_id);
    const realtimeSessionId = "realtime:goal-relay:test";
    admitRealtimeSession({
      realtimeSessionId,
      requesterRef: buildRealtimeRequesterRef(accountContext.session_id),
      visibleUserConsentReceipt: "receipt:visible-consent:goal-relay",
      model: "gpt-realtime-2.1",
      threadId: "helix-ask:desktop",
      selectedRuntimeAgentProvider: "codex",
      runtimeGoalAccountScope: buildRuntimeGoalAccountScope(accountContext),
    });
    const transcriptText = "What has the goal worker found so far?";
    const observation = buildRealtimeTranscriptObservation({
      realtimeSessionId,
      body: {
        event_type: "transcript.final",
        event_ref: "provider-event:goal-relay",
        transcript_text: transcriptText,
      },
    })!;
    const handoff = bridgeRealtimeTranscriptToStagePlay({
      realtimeSessionId,
      threadId: "helix-ask:desktop",
      providerEventRef: "provider-event:goal-relay",
      transcriptText,
      observation,
      selectedRuntimeAgentProvider: "helix",
      runtimeGoalAccountScope: buildRuntimeGoalAccountScope(accountContext),
      sourceBinding: {
        focus_panel_id: "docs-viewer",
        document_ref: "docs/live-goal.md",
      },
    });
    expect(handoff).toMatchObject({
      goal_id: goalId,
      runtime_agent_provider: "codex",
      worker_admission: {
        outcome: "durable_goal_bound",
        selected_runtime_agent_provider: "codex",
        dispatch: {
          kind: "goal_wake",
          target_runtime_agent_provider: "codex",
          runtime_selection_source: "goal_binding",
        },
      },
    });

    const result = await dispatchRuntimeGoalWakeCandidate({
      body: {
        agent_runtime: "codex",
        turn_id: `${handoff.handoff_id}:goal-wake`,
        event_kind: "manual_resume",
        goal_id: goalId,
        source_kind: "realtime_transcript",
        source_id: observation.observation_ref,
        source_hash: handoff.transcript_text_hash,
        source_label: "GPT Live transcript",
        reason: "realtime_durable_goal_voice_turn",
        dedupe_key: `realtime-goal-wake:${handoff.handoff_id}`,
        requires_user_visible_turn: true,
        question: transcriptText,
        realtime_handoff_id: handoff.handoff_id,
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/live-goal.md",
          "The current section reports grounded progress for the Live wake.",
          "fnv1a32:live-goal-current",
        ),
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      workstation_gateway_call_results: [
        expect.objectContaining({
          ok: true,
          capability_id: "docs-viewer.read_visible_surface",
        }),
      ],
      realtime_grounded_answer_feedback: {
        schema: "helix.runtime_goal.realtime_grounded_feedback.v1",
        handoff_id: handoff.handoff_id,
        account_bound: true,
        feedback_recorded: true,
        blocked_reason: null,
        answer_authority: false,
      },
    });
    expect(readRealtimeGroundedAnswer(handoff.handoff_id)).toMatchObject({
      handoff_id: handoff.handoff_id,
      goal_id: goalId,
      final_answer_source: "runtime_goal_command",
      terminal_artifact_kind: "runtime_goal_command_result",
      completed_solver_path: true,
      server_authoritative: true,
    });
    expect(readRealtimeGroundedAnswerRelay(handoff.handoff_id)?.status).toBe(
      "relay_queued_busy",
    );
  }, 15_000);

  it("admits a visible source change without a goal id by resolving the latest active runtime goal", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "Server-resolved wake summary: the latest active goal was resumed.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:server-resolved-start",
        question: "/goal Keep a cumulative summary of the visible document section.",
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/original.md",
          "The original visible section is only the starting point.",
          "fnv1a32:server-resolved-start",
        ),
      },
    });
    expect(start.statusCode).toBe(200);
    const goalId = String((start.payload.runtime_goal_session as Record<string, unknown>).goal_id);

    const result = await dispatchRuntimeGoalWakeCandidate({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:server-resolved-wake",
        event_kind: "visible_source_changed",
        source_kind: "docs_viewer_visible_surface",
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        active_panel_id: "docs-viewer",
        source_hash: "fnv1a32:server-resolved-new",
        reason: "docs_viewer_active_doc_changed",
        dedupe_key: "docs-viewer:docs/research/nhm2-current-status-whitepaper.md:server-resolved",
        workspace_context_snapshot: visibleDocSnapshot(
          "docs/research/nhm2-current-status-whitepaper.md",
          "The NHM2 document frames current status as diagnostic and artifact-limited.",
          "fnv1a32:server-resolved-new",
        ),
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      ok: true,
      goal_id: goalId,
      runtime_goal_wake_candidate: {
        goal_id: null,
        event_kind: "visible_source_changed",
      },
      runtime_goal_wake_admission: {
        status: "admitted",
        reason: "visible_source_changed",
        goal_id: goalId,
      },
      runtime_goal_wake_event: {
        goal_id: goalId,
        kind: "visible_source_changed",
      },
    });
    expect(String(result.payload.selected_final_answer)).toContain("Server-resolved wake summary");
  }, 15_000);

  it("does not expose, wake, or consume dedupe state for another account's runtime goal", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "Owner wake accepted after the denied account attempt.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:account-owner-start",
        question: "/goal Track visible source changes for this account.",
      },
    });
    expect(start.statusCode).toBe(200);
    const goalId = String((start.payload.runtime_goal_session as Record<string, unknown>).goal_id);

    const intruderReceipt = await signInLocalAccountSession({
      profile_id: "profile:runtime-goal-wake-intruder",
      account_type: "developer",
    });
    const intruderSessionId = intruderReceipt.session?.session_id ?? "";
    const intruderHeaders = {
      cookie: `helix_session=${encodeURIComponent(intruderSessionId)}`,
    };
    const wakeBody = {
      agent_runtime: "codex",
      turn_id: "ask:test:account-wake",
      event_kind: "visible_source_changed",
      goal_id: goalId,
      source_kind: "docs_viewer_visible_surface",
      doc_path: "docs/account-owned.md",
      active_panel_id: "docs-viewer",
      reason: "docs_viewer_active_doc_changed",
      dedupe_key: "docs-viewer:docs/account-owned.md:account-bound",
      workspace_context_snapshot: visibleDocSnapshot(
        "docs/account-owned.md",
        "Only the owning account may wake this goal.",
      ),
    };

    const deniedExplicit = await dispatchRuntimeGoalWakeCandidate({
      headers: intruderHeaders,
      body: wakeBody,
    });
    expect(deniedExplicit.statusCode).toBe(404);
    expect(deniedExplicit.payload).toMatchObject({
      ok: false,
      blocked_reason: "goal_session_not_found",
      runtime_goal_wake_admission: {
        status: "rejected",
        reason: "goal_session_not_found",
      },
    });

    const deniedImplicit = await dispatchRuntimeGoalWakeCandidate({
      headers: intruderHeaders,
      body: {
        ...wakeBody,
        goal_id: undefined,
        turn_id: "ask:test:account-wake-implicit",
      },
    });
    expect(deniedImplicit.statusCode).toBe(404);
    expect(deniedImplicit.payload).toMatchObject({
      blocked_reason: "goal_session_not_found",
      runtime_goal_wake_admission: {
        goal_id: null,
        reason: "goal_session_not_found",
      },
    });

    const ownerResult = await dispatchRuntimeGoalWakeCandidate({ body: wakeBody });
    expect(ownerResult.statusCode).toBe(200);
    expect(ownerResult.payload).toMatchObject({
      ok: true,
      goal_id: goalId,
      runtime_goal_wake_admission: {
        status: "admitted",
        goal_id: goalId,
      },
      runtime_goal_session: {
        goal_id: goalId,
        wake_count: 1,
      },
    });
    expect(String(ownerResult.payload.selected_final_answer)).toContain(
      "Owner wake accepted after the denied account attempt.",
    );
  }, 15_000);

  it("rejects a duplicate visible source wake candidate instead of waking repeatedly", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "First auto wake accepted.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:auto-dup-start",
        question: "/goal Track visible source changes.",
      },
    });
    const goalId = String((start.payload.runtime_goal_session as Record<string, unknown>).goal_id);
    const candidateBody = {
      agent_runtime: "codex",
      turn_id: "ask:test:auto-dup",
      event_kind: "visible_source_changed",
      goal_id: goalId,
      source_kind: "docs_viewer_visible_surface",
      doc_path: "docs/current.md",
      active_panel_id: "docs-viewer",
      reason: "docs_viewer_active_doc_changed",
      dedupe_key: "docs-viewer:docs/current.md",
      workspace_context_snapshot: visibleDocSnapshot("docs/current.md", "Visible text."),
    };

    const first = await dispatchRuntimeGoalWakeCandidate({ body: candidateBody });
    expect(first.statusCode).toBe(200);

    const duplicate = await dispatchRuntimeGoalWakeCandidate({
      body: {
        ...candidateBody,
        turn_id: "ask:test:auto-dup-second",
      },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.payload).toMatchObject({
      ok: false,
      blocked_reason: "duplicate_wake_candidate",
      runtime_goal_wake_admission: {
        status: "rejected",
        reason: "duplicate_wake_candidate",
        goal_id: goalId,
      },
    });
  }, 15_000);

  it("rejects source-change candidates for stopped runtime goals", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "This should not run.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:auto-stopped-start",
        question: "/goal Track visible source changes.",
      },
    });
    const goalId = String((start.payload.runtime_goal_session as Record<string, unknown>).goal_id);
    const stopped = helixRuntimeGoalSessionStore.stopGoalRuntimeSession({ goalId, accountContext });
    expect(stopped.session.status).toBe("cancelled");

    const result = await dispatchRuntimeGoalWakeCandidate({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:auto-stopped",
        event_kind: "visible_source_changed",
        goal_id: goalId,
        source_kind: "docs_viewer_visible_surface",
        doc_path: "docs/current.md",
        active_panel_id: "docs-viewer",
        reason: "docs_viewer_active_doc_changed",
        dedupe_key: "docs-viewer:docs/current.md:stopped",
        workspace_context_snapshot: visibleDocSnapshot("docs/current.md", "Visible text."),
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.payload).toMatchObject({
      ok: false,
      blocked_reason: "goal_not_resumable",
      runtime_goal_wake_admission: {
        status: "rejected",
        reason: "goal_not_resumable",
        goal_id: goalId,
      },
    });
  }, 15_000);

  it("keeps timer candidates policy-gated without starting a hidden loop", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "Timer wake evidence inspected.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const deniedStart = await helixRuntimeGoalSessionStore.startGoalRuntimeSession({
      objective: "Track timer wakes.",
      runtimeAgentProvider: "codex",
      wakePolicy: {
        timer_ms: null,
      },
      accountContext,
    });
    const deniedGoalId = deniedStart.session.goal_id;
    const denied = await dispatchRuntimeGoalWakeCandidate({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:timer-denied",
        event_kind: "timer",
        goal_id: deniedGoalId,
        source_kind: "runtime_goal_timer",
        source_id: deniedGoalId,
        reason: "timer_elapsed",
        dedupe_key: `${deniedGoalId}:timer:1`,
      },
    });

    expect(denied.statusCode).toBe(409);
    expect(denied.payload).toMatchObject({
      ok: false,
      blocked_reason: "wake_policy_denied",
      runtime_goal_wake_admission: {
        status: "rejected",
        reason: "wake_policy_denied",
        goal_id: deniedGoalId,
      },
    });

    const admittedStart = await helixRuntimeGoalSessionStore.startGoalRuntimeSession({
      objective: "Track timer wakes.",
      runtimeAgentProvider: "codex",
      wakePolicy: {
        timer_ms: 30_000,
      },
      accountContext,
    });
    const admittedGoalId = admittedStart.session.goal_id;
    const admitted = await dispatchRuntimeGoalWakeCandidate({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:timer-admitted",
        event_kind: "timer",
        goal_id: admittedGoalId,
        source_kind: "runtime_goal_timer",
        source_id: admittedGoalId,
        reason: "timer_elapsed",
        dedupe_key: `${admittedGoalId}:timer:1`,
        workstation_gateway_call: {
          tool: "docs-viewer.read_visible_surface",
          arguments: {},
        },
      },
    });

    expect(admitted.statusCode).toBe(200);
    expect(admitted.payload).toMatchObject({
      ok: true,
      goal_id: admittedGoalId,
      runtime_goal_wake_candidate: {
        event_kind: "timer",
        reason: "timer_elapsed",
      },
      runtime_goal_wake_admission: {
        status: "admitted",
        reason: "timer_wake_admitted",
        goal_id: admittedGoalId,
      },
      runtime_goal_wake_event: {
        kind: "timer",
        goal_id: admittedGoalId,
      },
      runtime_goal_debug_summary: {
        wake_timer_status: "armed",
        wake_timer_ms: 30_000,
      },
    });
  }, 15_000);

  it("rejects source-change candidates when no runtime goal is active", async () => {
    const result = await dispatchRuntimeGoalWakeCandidate({
      body: {
        event_kind: "visible_source_changed",
        source_kind: "docs_viewer_visible_surface",
        doc_path: "docs/current.md",
        active_panel_id: "docs-viewer",
        dedupe_key: "docs-viewer:docs/current.md",
      },
    });

    expect(result.statusCode).toBe(404);
    expect(result.payload).toMatchObject({
      ok: false,
      blocked_reason: "goal_session_not_found",
      runtime_goal_wake_admission: {
        status: "rejected",
        reason: "goal_session_not_found",
      },
    });
  });
});
