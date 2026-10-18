import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { helixRuntimeGoalSessionStore } from "../services/helix-ask/agent-providers/goal-runtime-session";
import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../services/helix-account/account-session-store";
import {
  buildRuntimeGoalReadableSurfaceGatewayCall,
  readRuntimeGoalVisibleDocContext,
  routeHelixRuntimeGoalCommand as routeHelixRuntimeGoalCommandImpl,
} from "../services/helix-ask/runtime-goal-command-router";

const originalEnableCodexAgent = process.env.ENABLE_CODEX_AGENT;
const originalCodexFakeStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
const originalCodexFakeExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
let requestHeaders: { cookie: string };

const routeHelixRuntimeGoalCommand: typeof routeHelixRuntimeGoalCommandImpl = (input) =>
  routeHelixRuntimeGoalCommandImpl({ ...input, headers: input.headers ?? requestHeaders });

beforeEach(async () => {
  await resetAccountSessionStore();
  const receipt = await signInLocalAccountSession({
    profile_id: "profile:runtime-goal-command-route-test",
    account_type: "developer",
  });
  const sessionId = receipt.session?.session_id ?? "";
  requestHeaders = { cookie: `helix_session=${encodeURIComponent(sessionId)}` };
});

afterEach(() => {
  helixRuntimeGoalSessionStore.clear();
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
});

describe("Helix Ask runtime /goal command routing", () => {
  it.each([
    {
      label: "research-library provenance",
      snapshotDocPath: "docs/snapshot-canonical-fallback.md",
      context: {
        doc_path: "docs/canonical-decoy.md",
        document_source_kind: "research_library",
        chunks: [{ visible_text: "PRIVATE RESEARCH TEXT" }],
      },
    },
    {
      label: "private-source flag",
      snapshotDocPath: "docs/snapshot-canonical-fallback.md",
      context: {
        doc_path: "docs/canonical-decoy.md",
        private_source: true,
        chunks: [{ visible_text: "PRIVATE RESEARCH TEXT" }],
      },
    },
    {
      label: "opaque research viewer path",
      snapshotDocPath: "docs/snapshot-canonical-fallback.md",
      context: {
        doc_path: "research-library/private-research%3Aaccount-token%3Adocument-token",
        chunks: [{ visible_text: "PRIVATE RESEARCH TEXT" }],
      },
    },
    {
      label: "nested private target provenance",
      snapshotDocPath: "docs/snapshot-canonical-fallback.md",
      context: {
        doc_path: "docs/canonical-decoy.md",
        chunks: [{
          private_source: true,
          visible_text: "PRIVATE RESEARCH TEXT",
        }],
      },
    },
    {
      label: "research viewer path hidden behind a canonical body path",
      snapshotDocPath: "research-library/private-research%3Aaccount-token%3Adocument-token",
      context: {
        doc_path: "docs/canonical-decoy.md",
        chunks: [{ visible_text: "PRIVATE RESEARCH TEXT" }],
      },
    },
  ])("fails closed before reading $label into a runtime goal", ({ context, snapshotDocPath }) => {
    const body = {
      doc_path: "docs/body-canonical-fallback.md",
      source_freshness_ms: 7,
      workspace_context_snapshot: {
        active_panel_id: "docs-viewer",
        active_doc_path: snapshotDocPath,
        active_doc_visible_translation_context: context,
      },
    };

    expect(readRuntimeGoalVisibleDocContext(body)).toEqual({
      docPath: null,
      visibleText: null,
      sourceHash: null,
      sourceId: null,
      sourceFreshnessMs: null,
      unavailableReason: "private_research_runtime_goal_source_not_admitted",
    });
    const gatewayCall = buildRuntimeGoalReadableSurfaceGatewayCall(body);
    expect(gatewayCall).toMatchObject({
      arguments: {
        path: null,
        source_doc_path: null,
        text: null,
        visible_text: null,
        source_id: null,
        source_hash: null,
        source_refs: [],
      },
    });
    expect(JSON.stringify(gatewayCall)).not.toContain("PRIVATE RESEARCH TEXT");
    expect(JSON.stringify(gatewayCall)).not.toContain("docs/body-canonical-fallback.md");
  });

  it("blocks a manual runtime-goal wake before private research text reaches the provider", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "PRIVATE PROVIDER OUTPUT MUST NOT RUN";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:private-research-goal-start",
        question: "/goal Track the visible document.",
      },
    });
    expect(start.statusCode).toBe(200);

    const wake = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:private-research-goal-wake",
        question: "/goal wake",
        workspace_context_snapshot: {
          active_panel_id: "docs-viewer",
          active_doc_path:
            "research-library/private-research%3Aaccount-token%3Adocument-token",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            document_source_kind: "research_library",
            document_ref: "private-research:account-token:document-token",
            private_source: true,
            doc_path:
              "research-library/private-research%3Aaccount-token%3Adocument-token",
            chunks: [{ visible_text: "PRIVATE RESEARCH TEXT" }],
          },
        },
      },
    });

    expect(wake.statusCode).toBe(409);
    expect(wake.payload).toMatchObject({
      ok: false,
      blocked_reason: "private_research_runtime_goal_source_not_admitted",
      runtime_goal_command: {
        command: "wake",
        blocked_reason: "private_research_runtime_goal_source_not_admitted",
      },
    });
    expect(JSON.stringify(wake.payload)).not.toContain("PRIVATE RESEARCH TEXT");
    expect(JSON.stringify(wake.payload)).not.toContain("PRIVATE PROVIDER OUTPUT MUST NOT RUN");
  });

  it("routes /goal start through the runtime goal-session controller instead of Codex plain prompt text", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "This should not be used by goal start.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const response = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-start",
        question: "/goal Summarize the visible document section when manually woken.",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      ok: true,
      final_answer_source: "runtime_goal_command",
      terminal_artifact_kind: "runtime_goal_command_result",
      runtime_goal_command: {
        command: "start",
      },
      runtime_goal_session: {
        runtime_agent_provider: "codex",
        status: "waiting",
      },
    });
    expect(String(response.payload.selected_final_answer)).toContain("Goal is active.");
    expect(String(response.payload.selected_final_answer)).toContain(
      "Goal: Summarize the visible document section when manually woken.",
    );
    expect(String(response.payload.selected_final_answer)).toContain(
      "Wake behavior: On wake, inspect admitted workstation evidence, re-enter observations, and report job progress through Helix terminal authority.",
    );
    expect(String(response.payload.selected_final_answer)).not.toContain("This should not be used");
    expect(response.payload).toMatchObject({
      runtime_goal_job_brief: {
        user_goal_text: "Summarize the visible document section when manually woken.",
        selected_runtime_agent_provider: "codex",
      },
    });
    expect(response.payload.debug_export).toMatchObject({
      runtime_goal_command: {
        command: "start",
      },
      codex_no_tool_direct_answer: false,
    });
  });

  it("stores the visible source binding in the durable goal brief when a goal starts from the Ask UI", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "This should not be used by goal start.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const response = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-start-source",
        question: "/goal Track the currently visible document section.",
        source_freshness_ms: 7,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          active_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_id:
              "document_markdown:docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_hash: "visible-start-source-v1",
            chunks: [
              {
                chunk_id: "visible-start-source-1",
                visible_text: "The current section discusses civilization-bound evidence states.",
              },
            ],
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      runtime_goal_job_brief: {
        source_binding: {
          source_kind: "docs_viewer_visible_surface",
          active_panel_id: "docs-viewer",
          doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          source_id:
            "document_markdown:docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          source_hash: "visible-start-source-v1",
          source_freshness_ms: 7,
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      runtime_goal_session: {
        latest_source_binding: {
          doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
        },
      },
      runtime_goal_debug_summary: {
        observed_source_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
        observed_source_kind: "docs_viewer_visible_surface",
      },
    });
  });

  it("routes /goal wake through goal resume with visible document evidence before terminal answer", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "New visible point: the document treats labels as hypotheses.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-wake-start",
        question: "/goal Keep a cumulative summary of the visible document section.",
      },
    });
    expect(start.statusCode).toBe(200);
    const goalId = (start.payload.runtime_goal_session as Record<string, unknown>).goal_id;

    const response = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-wake",
        question: "/goal wake",
        source_freshness_ms: 42,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          active_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_id: "document_markdown:docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_hash: "fnv1a32:test-visible",
            chunks: [
              {
                visible_text: "The map should present nations as transient, multi-axis evidence states instead of fixed civilization classes.",
                chunk_id: "visible-1",
              },
            ],
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);

    const final = response.payload;
    const transcriptText = response.transcriptEvents.map((event) => String(event.text ?? "")).join("\n");
    expect(final).toMatchObject({
      ok: true,
      final_answer_source: "runtime_goal_command",
      terminal_artifact_kind: "runtime_goal_command_result",
      runtime_goal_command: {
        command: "wake",
        goal_id: goalId,
      },
      runtime_goal_session: {
        goal_id: goalId,
        runtime_agent_provider: "codex",
        terminal_authority_status: "authorized",
      },
    });
    expect(String(final.selected_final_answer)).not.toContain("Awake. I");
    expect(String(final.selected_final_answer)).toContain("Goal: Keep a cumulative summary of the visible document section.");
    expect(String(final.selected_final_answer)).toContain("Observed source: docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md");
    expect(String(final.selected_final_answer)).toContain("Evidence used: docs-viewer.read_visible_surface");
    expect(String(final.selected_final_answer)).toContain("New visible point: the document treats labels as hypotheses.");
    expect((final.runtime_goal_session as Record<string, unknown>).latest_observation_refs).toEqual(
      expect.arrayContaining([expect.stringContaining("docs-viewer.read_visible_surface")]),
    );
    expect(final).toMatchObject({
      runtime_goal_job_brief: {
        user_goal_text: "Keep a cumulative summary of the visible document section.",
      },
      runtime_goal_wake_plan: {
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
        expected_terminal_product: "job_progress_report",
      },
      runtime_goal_progress_summary: {
        current_summary: "New visible point: the document treats labels as hypotheses.",
        terminal_authority_status: "authorized",
      },
      runtime_goal_debug_summary: {
        schema: "helix.runtime_goal.debug_copy_summary.v1",
        job_title: "Keep a cumulative summary of the visible document section.",
        runtime_agent_provider: "codex",
        session_status: "waiting",
        observed_source_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
        observed_source_kind: "docs_viewer_visible_surface",
        observed_source_freshness_ms: 42,
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
        wake_relevance_reason: expect.stringContaining("docs-viewer.read_visible_surface"),
        wake_expected_terminal_product: "job_progress_report",
        current_progress_summary: "New visible point: the document treats labels as hypotheses.",
        terminal_authority_status: "authorized",
        terminal_answer_server_authoritative: true,
        latest_observation_refs: expect.arrayContaining([
          expect.stringContaining("docs-viewer.read_visible_surface"),
        ]),
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
    expect((final.debug_export as Record<string, unknown>).runtime_goal_debug_summary).toMatchObject(
      final.runtime_goal_debug_summary as Record<string, unknown>,
    );
    expect((final.debug as Record<string, unknown>).runtime_goal_debug_summary).toMatchObject(
      final.runtime_goal_debug_summary as Record<string, unknown>,
    );
    expect((final.debug as Record<string, unknown>).codex_no_tool_direct_answer).toBe(false);
    const debugEvents = ((final.runtime_goal_debug_export as Record<string, unknown>).debug_events as Array<Record<string, unknown>>);
    expect(debugEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "tool_or_lane_requested" }),
        expect.objectContaining({ stage: "tool_or_lane_admitted" }),
        expect.objectContaining({ stage: "evidence_reentered" }),
        expect.objectContaining({ stage: "terminal_authority_evaluated" }),
      ]),
    );
    expect(transcriptText).toContain("Runtime goal command routed: wake.");
    expect(final.turn_transcript_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          type: "runtime_goal_command",
          lane: "runtime_goal",
          text: "Runtime goal command routed: wake.",
        }),
        expect.objectContaining({
          role: "tool",
          lane: "runtime_goal",
          source_event_type: "runtime_goal_debug",
        }),
        expect.objectContaining({
          role: "agent",
          type: "terminal_answer",
          lane: "terminal_authority",
          terminal_eligible: true,
          assistant_answer: false,
        }),
      ]),
    );
    expect((final.debug_export as Record<string, unknown>).turn_transcript_events).toEqual(final.turn_transcript_events);
    expect((final.debug as Record<string, unknown>).runtime_goal_transcript_events).toEqual(final.turn_transcript_events);
  }, 15_000);

  it("routes Helix Native /goal wake through the same governed capability evidence chain", async () => {
    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "helix",
        turn_id: "ask:test:helix-goal-command-wake-start",
        question: "/goal Keep a Helix-native summary of the visible document section.",
      },
    });
    expect(start.statusCode).toBe(200);
    const goalId = (start.payload.runtime_goal_session as Record<string, unknown>).goal_id;

    const response = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "helix",
        turn_id: "ask:test:helix-goal-command-wake",
        question: "/goal wake",
        source_freshness_ms: 84,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          active_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_id: "document_markdown:docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_hash: "fnv1a32:test-visible-helix",
            chunks: [
              {
                visible_text: "Helix should treat visible document text as governed evidence before terminal authority.",
                chunk_id: "visible-helix-1",
              },
            ],
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);

    const final = response.payload;
    expect(final).toMatchObject({
      ok: true,
      final_answer_source: "runtime_goal_command",
      terminal_artifact_kind: "runtime_goal_command_result",
      runtime_goal_command: {
        command: "wake",
        goal_id: goalId,
      },
      runtime_goal_session: {
        goal_id: goalId,
        runtime_agent_provider: "helix",
        terminal_authority_status: "authorized",
      },
    });
    expect((final.runtime_goal_session as Record<string, unknown>).latest_observation_refs).toEqual(
      expect.arrayContaining([expect.stringContaining("docs-viewer.read_visible_surface")]),
    );
    expect(String(final.selected_final_answer)).toContain("Goal: Keep a Helix-native summary of the visible document section.");
    expect(String(final.selected_final_answer)).toContain("Observed source: docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md");
    expect(String(final.selected_final_answer)).toContain("Evidence used: docs-viewer.read_visible_surface");
    const debugExport = final.runtime_goal_debug_export as Record<string, unknown>;
    expect(debugExport).toMatchObject({
      runtime_goal_job_brief: {
        user_goal_text: "Keep a Helix-native summary of the visible document section.",
      },
      runtime_goal_wake_plan: {
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
      },
      runtime_goal_progress_summary: {
        terminal_authority_status: "authorized",
      },
    });
    expect(final.runtime_goal_debug_summary).toMatchObject({
      schema: "helix.runtime_goal.debug_copy_summary.v1",
      job_title: "Keep a Helix-native summary of the visible document section.",
      runtime_agent_provider: "helix",
      session_status: "waiting",
      observed_source_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
      observed_source_kind: "docs_viewer_visible_surface",
      observed_source_freshness_ms: 84,
      requested_observation_or_lane: "docs-viewer.read_visible_surface",
      wake_relevance_reason: expect.stringContaining("docs-viewer.read_visible_surface"),
      wake_expected_terminal_product: "job_progress_report",
      terminal_authority_status: "authorized",
      terminal_answer_server_authoritative: true,
      latest_observation_refs: expect.arrayContaining([
        expect.stringContaining("docs-viewer.read_visible_surface"),
      ]),
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(debugExport.provider_terminal_candidate).toMatchObject({
      agent_runtime: "helix",
      provider_label: "Helix Ask Native",
      grounded_in_observation_refs: expect.arrayContaining([
        expect.stringContaining("docs-viewer.read_visible_surface"),
      ]),
    });
    expect(debugExport.terminal_answer_authority).toMatchObject({
      schema: "helix.turn_terminal_authority.v1",
      server_authoritative: true,
    });
    expect(debugExport.debug_events as Array<Record<string, unknown>>).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "tool_or_lane_requested" }),
        expect.objectContaining({ stage: "tool_or_lane_admitted" }),
        expect.objectContaining({ stage: "evidence_reentered", reentry_status: "reentered" }),
        expect.objectContaining({ stage: "runtime_candidate_generated" }),
        expect.objectContaining({ stage: "terminal_authority_evaluated", terminal_authority_status: "authorized" }),
      ]),
    );
  });

  it("routes /goal wake without a resumable goal to a typed failure instead of Codex direct answer", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "Awake. I should not answer this directly.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const response = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-wake-missing",
        question: "/goal wake",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.payload).toMatchObject({
      ok: false,
      final_answer_source: "runtime_goal_command",
      blocked_reason: "goal_session_not_found",
      runtime_goal_command: {
        command: "wake",
        blocked_reason: "goal_session_not_found",
      },
    });
    expect(String(response.payload.selected_final_answer)).toBe("No active goal session was found.");
    expect(response.payload.debug_export).toMatchObject({
      codex_no_tool_direct_answer: false,
    });
  });

  it("routes /goal stop so a later wake fails as not resumable", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "Goal provider fake output.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const start = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-stop-start",
        question: "/goal Keep a cumulative summary.",
      },
    });
    expect(start.statusCode).toBe(200);

    const stop = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-stop",
        question: "/goal stop",
      },
    });
    expect(stop.statusCode).toBe(200);

    const wake = await routeHelixRuntimeGoalCommand({
      body: {
        agent_runtime: "codex",
        turn_id: "ask:test:goal-command-wake-after-stop",
        question: "/goal wake",
      },
    });

    expect(wake.statusCode).toBe(409);
    expect(wake.payload).toMatchObject({
      ok: false,
      blocked_reason: "goal_not_resumable",
      runtime_goal_command: {
        command: "wake",
        blocked_reason: "goal_not_resumable",
      },
    });
    expect(wake.payload.debug_export).toMatchObject({
      codex_no_tool_direct_answer: false,
    });
  });
});
