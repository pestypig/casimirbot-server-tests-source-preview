import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseRuntimeGoalProbeSseEvents,
  validateRuntimeGoalProbeArtifacts,
} from "../../scripts/helix-ask-runtime-goal-probe";
import packageJson from "../../package.json";

const readRepoFile = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const startFixture = {
  selected_final_answer: [
    "Goal is active.",
    "",
    "Goal: Keep a cumulative summary of the visible document section.",
    "Goal id: goal:test:probe",
    "Runtime: codex",
    "Wake behavior: On wake, inspect admitted workstation evidence, re-enter observations, and report job progress through Helix terminal authority.",
    "Report policy: report_only_failure",
    "Wake sources: manual `/goal wake`, admitted visible-source changes, and configured timer candidates.",
  ].join("\n"),
  runtime_goal_command: {
    command: "start",
    goal_id: "goal:test:probe",
  },
  runtime_goal_session: {
    goal_id: "goal:test:probe",
    runtime_agent_provider: "codex",
    job_brief: {
      user_goal_text: "Keep a cumulative summary of the visible document section.",
    },
  },
  runtime_goal_job_brief: {
    user_goal_text: "Keep a cumulative summary of the visible document section.",
  },
  runtime_goal_debug_summary: {
    job_title: "Keep a cumulative summary of the visible document section.",
    runtime_agent_provider: "codex",
    session_status: "waiting",
    wake_timer_status: "unarmed",
    wake_timer_ms: null,
    next_wake_behavior:
      "On wake, inspect admitted workstation evidence, re-enter observations, and report job progress through Helix terminal authority.",
  },
};

const wakeFixture = {
  selected_final_answer: [
    "Goal: Keep a cumulative summary of the visible document section.",
    "Runtime: Codex Workstation Mode.",
    "Observed source: docs/current.md.",
    "Evidence used: docs-viewer.read_visible_surface.",
    "Current progress: The document treats labels as evidence states.",
  ].join("\n"),
  runtime_goal_command: {
    command: "wake",
    goal_id: "goal:test:probe",
  },
  runtime_goal_session: {
    goal_id: "goal:test:probe",
    runtime_agent_provider: "codex",
    latest_observation_refs: ["ask:test:probe:workstation_gateway:docs-viewer.read_visible_surface"],
    terminal_authority_status: "authorized",
  },
  runtime_goal_wake_plan: {
    requested_observation_or_lane: "docs-viewer.read_visible_surface",
  },
  runtime_goal_wake_candidate: {
    event_kind: "visible_source_changed",
    dedupe_key: "runtime-goal-probe:goal:test:probe:docs/current.md",
  },
  runtime_goal_wake_admission: {
    status: "admitted",
    reason: "visible_source_changed",
    goal_id: "goal:test:probe",
  },
  runtime_goal_wake_event: {
    wake_event_id: "goal-wake:test:probe",
    goal_id: "goal:test:probe",
    kind: "visible_source_changed",
  },
  runtime_goal_progress_summary: {
    current_summary: "The document treats labels as evidence states.",
    evidence_used: {
      requested_tool_or_lane: "docs-viewer.read_visible_surface",
      observation_refs: ["ask:test:probe:workstation_gateway:docs-viewer.read_visible_surface"],
    },
  },
  runtime_goal_source_binding: {
    doc_path: "docs/current.md",
  },
  runtime_goal_debug_summary: {
    job_title: "Keep a cumulative summary of the visible document section.",
    runtime_agent_provider: "codex",
    session_status: "waiting",
    last_wake_at: "2026-06-29T12:15:00.000Z",
    observed_source_kind: "docs_viewer_visible_surface",
    observed_source_doc_path: "docs/current.md",
    observed_source_freshness_ms: 0,
    requested_observation_or_lane: "docs-viewer.read_visible_surface",
    wake_relevance_reason:
      "The wake plan requests docs-viewer.read_visible_surface so the runtime can update the assigned job from current workstation evidence.",
    wake_expected_terminal_product: "job_progress_report",
    wake_timer_status: "unarmed",
    wake_timer_ms: null,
    current_progress_summary: "The document treats labels as evidence states.",
    terminal_authority_status: "authorized",
    terminal_answer_server_authoritative: true,
    latest_observation_refs: ["ask:test:probe:workstation_gateway:docs-viewer.read_visible_surface"],
  },
  runtime_goal_debug_export: {
    debug_events: [
      { stage: "tool_or_lane_requested" },
      { stage: "tool_or_lane_admitted" },
      { stage: "evidence_reentered" },
      { stage: "terminal_authority_evaluated" },
    ],
  },
  terminal_answer_authority: {
    server_authoritative: true,
  },
  turn_transcript_events: [
    {
      type: "runtime_goal_command",
      lane: "runtime_goal",
    },
    {
      type: "terminal_answer",
      lane: "terminal_authority",
    },
  ],
};

describe("Helix Ask runtime-goal live probe validator", () => {
  it("exposes JSON, stream, and combined runtime goal probe package scripts", () => {
    expect(packageJson.scripts).toMatchObject({
      "helix:ask:runtime-goal-probe": "tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:codex":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=codex tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:helix":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=helix tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:codex:surface":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=codex HELIX_ASK_RUNTIME_GOAL_EVENT_KIND=visible_surface_changed tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:helix:surface":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=helix HELIX_ASK_RUNTIME_GOAL_EVENT_KIND=visible_surface_changed tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:providers:surface":
        "npm run helix:ask:runtime-goal-probe:codex:surface && npm run helix:ask:runtime-goal-probe:helix:surface",
      "helix:ask:runtime-goal-probe:stream":
        "cross-env HELIX_ASK_RUNTIME_GOAL_TRANSPORT=stream tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:both":
        "cross-env HELIX_ASK_RUNTIME_GOAL_TRANSPORT=both tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:codex:stream":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=codex HELIX_ASK_RUNTIME_GOAL_TRANSPORT=stream tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:helix:stream":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=helix HELIX_ASK_RUNTIME_GOAL_TRANSPORT=stream tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:codex:both":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=codex HELIX_ASK_RUNTIME_GOAL_TRANSPORT=both tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:helix:both":
        "cross-env HELIX_ASK_RUNTIME_GOAL_AGENT_RUNTIME=helix HELIX_ASK_RUNTIME_GOAL_TRANSPORT=both tsx scripts/helix-ask-runtime-goal-probe.ts",
      "helix:ask:runtime-goal-probe:providers:both":
        "npm run helix:ask:runtime-goal-probe:codex:both && npm run helix:ask:runtime-goal-probe:helix:both",
    });
  });

  it("writes stream debug export and validation artifacts for combined live probes", () => {
    const probeSource = readRepoFile("scripts/helix-ask-runtime-goal-probe.ts");

    expect(probeSource).toContain('"stream-debug-export.json"');
    expect(probeSource).toContain('"stream-validation.json"');
    expect(probeSource).toContain("debugExport: streamDebugExport");
  });

  it("uses the wake-candidate endpoint by default for JSON live probes", () => {
    const probeSource = readRepoFile("scripts/helix-ask-runtime-goal-probe.ts");

    expect(probeSource).toContain("HELIX_ASK_RUNTIME_GOAL_WAKE_MODE");
    expect(probeSource).toContain("HELIX_ASK_RUNTIME_GOAL_EVENT_KIND");
    expect(probeSource).toContain("/api/agi/runtime-goals/wake-candidate");
    expect(probeSource).toContain("fetchWakeCandidateJson(buildWakeCandidateBody");
    expect(probeSource).toContain("wake_mode: WAKE_MODE");
    expect(probeSource).toContain("event_kind: EVENT_KIND");
    expect(probeSource).toContain("docs_viewer_visible_surface_changed");
    expect(probeSource).toContain("expectedWakeEventKind()");
    expect(probeSource).toContain("wake_candidate_missing");
    expect(probeSource).toContain("runtime-goal-probe-visible-text-v1");
  });

  it("writes an artifact manifest for live runtime goal probe debugging", () => {
    const probeSource = readRepoFile("scripts/helix-ask-runtime-goal-probe.ts");

    expect(probeSource).toContain("helix.runtime_goal_probe.artifact_manifest.v1");
    expect(probeSource).toContain('"artifact-manifest.json"');
    expect(probeSource).toContain("artifact_files: artifactManifest.artifact_files");
    expect(probeSource).toContain('artifact_files: [...artifactFiles, "artifact-manifest.json"]');
  });

  it("writes a probe error artifact when live runtime goal validation fails before responses exist", () => {
    const probeSource = readRepoFile("scripts/helix-ask-runtime-goal-probe.ts");

    expect(probeSource).toContain("helix.runtime_goal_probe.error.v1");
    expect(probeSource).toContain('"probe-error.json"');
    expect(probeSource).toContain("probe_error: errorPayload");
    expect(probeSource).toContain("json_validation_ok: false");
  });

  it("accepts a runtime goal start and wake chain with evidence re-entry and terminal authority", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: wakeFixture,
      expectedWakeEventKind: "visible_source_changed",
    });

    expect(validation).toMatchObject({
      ok: true,
      failures: [],
      summary: {
        start_job_title: "Keep a cumulative summary of the visible document section.",
        start_runtime_agent_provider: "codex",
        start_console_summary_present: true,
        goal_id: "goal:test:probe",
        runtime_agent_provider: "codex",
        observed_source: "docs/current.md",
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
        current_progress_summary: "The document treats labels as evidence states.",
        terminal_authority_status: "authorized",
        console_summary_present: true,
        observation_refs: ["ask:test:probe:workstation_gateway:docs-viewer.read_visible_surface"],
      },
    });
  });

  it("rejects an event wake chain without admitted wake-candidate proof", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: {
        ...wakeFixture,
        runtime_goal_wake_admission: {
          status: "rejected",
          reason: "duplicate_wake_candidate",
          goal_id: "goal:test:probe",
        },
      },
      expectedWakeEventKind: "visible_source_changed",
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain("wake_candidate_not_admitted");
  });

  it("rejects candidate-mode probe proof when wake metadata is missing", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: {
        ...wakeFixture,
        runtime_goal_wake_candidate: undefined,
        runtime_goal_wake_admission: undefined,
        runtime_goal_wake_event: undefined,
      },
      expectedWakeEventKind: "visible_source_changed",
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(
      expect.arrayContaining([
        "wake_candidate_missing",
        "wake_candidate_admission_missing",
        "wake_event_missing",
      ]),
    );
  });

  it("rejects candidate-mode probe proof for the wrong wake event kind", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: wakeFixture,
      expectedWakeEventKind: "visible_surface_changed",
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(
      expect.arrayContaining([
        "wake_candidate_event_kind_mismatch",
        "wake_event_kind_mismatch",
      ]),
    );
  });

  it("rejects a wake chain without server terminal authority", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: {
        ...wakeFixture,
        terminal_answer_authority: {
          server_authoritative: false,
        },
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain("terminal_authority_not_server_authoritative");
  });

  it("rejects a wake chain that is not attached to the started goal", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: {
        ...wakeFixture,
        runtime_goal_command: {
          command: "wake",
          goal_id: "goal:test:other",
        },
        runtime_goal_session: {
          ...wakeFixture.runtime_goal_session,
          goal_id: "goal:test:other",
        },
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain("goal_session_continuity_mismatch");
  });

  it("rejects a start chain that does not visibly name the assigned job", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: {
        ...startFixture,
        selected_final_answer: "Goal is active.",
      },
      wake: wakeFixture,
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(
      expect.arrayContaining([
        "start_answer_job_brief_missing",
        "start_answer_wake_behavior_missing",
      ]),
    );
  });

  it("rejects a start chain without the console-facing durable job summary", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: {
        ...startFixture,
        runtime_goal_debug_summary: undefined,
      },
      wake: wakeFixture,
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain("start_runtime_goal_debug_summary_missing");
  });

  it("rejects a wake chain without the console-facing runtime goal summary", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: {
        ...wakeFixture,
        runtime_goal_debug_summary: undefined,
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain("runtime_goal_debug_summary_missing");
  });

  it("accepts runtime goal debug proof from the debug-export endpoint payload wrapper", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: {
        ...wakeFixture,
        runtime_goal_debug_summary: undefined,
        runtime_goal_debug_export: undefined,
      },
      debugExport: {
        ok: true,
        payload: {
          runtime_goal_debug_summary: wakeFixture.runtime_goal_debug_summary,
          runtime_goal_debug_export: wakeFixture.runtime_goal_debug_export,
        },
      },
    });

    expect(validation).toMatchObject({
      ok: true,
      failures: [],
      summary: {
        console_summary_present: true,
        current_progress_summary: "The document treats labels as evidence states.",
      },
    });
  });

  it("rejects debug-export endpoint proof for a different goal", () => {
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: wakeFixture,
      debugExport: {
        ok: true,
        payload: {
          runtime_goal_debug_summary: {
            ...wakeFixture.runtime_goal_debug_summary,
            goal_id: "goal:test:other",
          },
          runtime_goal_debug_export: {
            ...wakeFixture.runtime_goal_debug_export,
            goal_id: "goal:test:other",
          },
        },
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual(
      expect.arrayContaining([
        "debug_export_goal_continuity_mismatch",
        "debug_export_summary_goal_continuity_mismatch",
      ]),
    );
  });

  it("parses stream turn transcript and final events for UI-like runtime goal probes", () => {
    const events = parseRuntimeGoalProbeSseEvents([
      "event: turn_transcript_event",
      'data: {"type":"runtime_goal_command","lane":"runtime_goal"}',
      "",
      "event: turn_transcript_event",
      'data: {"type":"terminal_answer","lane":"terminal_authority"}',
      "",
      "event: turn_final",
      `data: ${JSON.stringify(wakeFixture)}`,
      "",
    ].join("\n"));

    expect(events).toEqual([
      {
        event: "turn_transcript_event",
        data: {
          type: "runtime_goal_command",
          lane: "runtime_goal",
        },
      },
      {
        event: "turn_transcript_event",
        data: {
          type: "terminal_answer",
          lane: "terminal_authority",
        },
      },
      {
        event: "turn_final",
        data: wakeFixture,
      },
    ]);

    const streamFinal = events.find((event) => event.event === "turn_final")?.data;
    const validation = validateRuntimeGoalProbeArtifacts({
      start: startFixture,
      wake: streamFinal && typeof streamFinal === "object" && !Array.isArray(streamFinal)
        ? streamFinal as Record<string, unknown>
        : null,
    });

    expect(validation.ok).toBe(true);
  });
});
