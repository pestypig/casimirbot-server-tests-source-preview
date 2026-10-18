import { describe, expect, it } from "vitest";
import {
  captureEnvironmentActionDifferentialTrace,
} from "../services/environment-connectors/actions/workflow-differential-trace-capture";
import {
  buildDirectDiagnosticCapture,
  HELIX_PLAYER_DIRECT_DIAGNOSTIC_MARKER,
  parseDirectDiagnosticRecords,
} from "../../scripts/helix-minecraft-player-direct-diagnostic-capture";

const line = (record: Record<string, unknown>): string =>
  `[01:02:03] [Render thread/INFO]: ${HELIX_PLAYER_DIRECT_DIAGNOSTIC_MARKER}${JSON.stringify(record)}`;

const request = {
  schema: "helix.minecraft.player.direct_diagnostic_request.v1",
  workflow_id: "direct_player_action_workflow:test-walk",
  action_kind: "walk",
  arguments: { direction: "forward", duration_ms: 250, sprint: false },
  starting_state: {
    connected: true,
    x: 10,
    y: 64,
    z: 20,
    yaw: 0,
    pitch: 0,
    health: 20,
    on_ground: true,
  },
  started_at: "2026-08-10T01:02:03.000Z",
};

describe("Minecraft direct player diagnostic capture", () => {
  it("retains public starting state and terminal measurements without answer authority", () => {
    const logText = [
      "unrelated line",
      `${HELIX_PLAYER_DIRECT_DIAGNOSTIC_MARKER}{not-json}`,
      line(request),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: request.workflow_id,
        action_kind: "walk",
        event_type: "workflow.started",
        sequence: 0,
        workflow_state: "running",
        progress_fraction: 0,
        measurements: { x: 10, y: 64, z: 20 },
        manual_override_detected: false,
        controls_released: false,
        created_at: "2026-08-10T01:02:03.050Z",
      }),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: request.workflow_id,
        action_kind: "walk",
        event_type: "workflow.succeeded",
        sequence: 1,
        workflow_state: "succeeded",
        progress_fraction: 1,
        measurements: { x: 10, y: 64, z: 20.42, distance: 0.42 },
        manual_override_detected: false,
        controls_released: true,
        created_at: "2026-08-10T01:02:03.300Z",
      }),
    ].join("\n");

    expect(parseDirectDiagnosticRecords(logText)).toHaveLength(3);
    const capture = buildDirectDiagnosticCapture({
      logText,
      prompt: "Take one careful step forward.",
      scenarioId: "direct-walk-regression",
    });

    expect(capture.starting_state).toEqual(request.starting_state);
    expect(capture.selected_capability_id).toBe(
      "com.casimirbot.minecraft.player.walk",
    );
    expect(capture.execution_outcome).toBe("succeeded");
    expect(capture.postcondition_status).toBe("satisfied");
    expect(capture.normalized_progress).toHaveLength(2);
    expect(capture.observation_refs).toEqual([
      `direct_diagnostic_observation:${request.workflow_id}:1`,
    ]);
    expect(capture.observation_reentered).toBe(false);
    expect(capture.admission_status).toBe("not_applicable");
    expect(capture.terminal_authority_status).toBe("not_applicable");

    const trace = captureEnvironmentActionDifferentialTrace(capture);
    expect(trace.lane).toBe("direct_codex");
    expect(trace.execution_outcome).toBe("succeeded");
    expect(trace.observation_reentered).toBe(false);
    expect(trace.answer_authority).toBe(false);
    expect(trace.assistant_answer).toBe(false);
    expect(trace.terminal_eligible).toBe(false);
    expect(trace.raw_content_included).toBe(false);
  });

  it("maps a controller cancellation with manual input to manual_override", () => {
    const logText = [
      line({ ...request, workflow_id: "direct_player_action_workflow:old" }),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: "direct_player_action_workflow:old",
        action_kind: "walk",
        event_type: "workflow.canceled",
        sequence: 1,
        workflow_state: "canceled",
        progress_fraction: 0.4,
        measurements: { distance: 0.12 },
        manual_override_detected: true,
        controls_released: true,
        created_at: "2026-08-10T01:02:03.200Z",
      }),
      line(request),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: request.workflow_id,
        action_kind: "walk",
        event_type: "workflow.canceled",
        sequence: 1,
        workflow_state: "canceled",
        progress_fraction: 0.5,
        measurements: { distance: 0.2 },
        manual_override_detected: true,
        controls_released: true,
        created_at: "2026-08-10T01:02:03.250Z",
      }),
    ].join("\n");

    const capture = buildDirectDiagnosticCapture({
      logText,
      prompt: "Walk until I take over.",
      requestedWorkflowId: request.workflow_id,
    });

    expect(capture.execution_outcome).toBe("manual_override");
    expect(capture.postcondition_status).toBe("not_satisfied");
  });

  it("emits a lane-neutral fixture projection for differential comparison", () => {
    const logText = [
      line(request),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: request.workflow_id,
        action_kind: "walk",
        event_type: "workflow.started",
        sequence: 0,
        workflow_state: "running",
        progress_fraction: 0,
        measurements: { x: 10, y: 64, z: 20 },
        manual_override_detected: false,
        controls_released: false,
        created_at: "2026-08-10T01:02:03.050Z",
      }),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: request.workflow_id,
        action_kind: "walk",
        event_type: "workflow.succeeded",
        sequence: 1,
        workflow_state: "succeeded",
        progress_fraction: 1,
        measurements: { distance_blocks: 0.42, duration_ticks: 5, x: 10 },
        manual_override_detected: false,
        controls_released: true,
        created_at: "2026-08-10T01:02:03.300Z",
      }),
    ].join("\n");

    const capture = buildDirectDiagnosticCapture({
      logText,
      prompt: "Take one careful step forward.",
      scenarioId: "direct-walk-comparison",
      comparisonMode: true,
    });

    expect(capture.starting_state).toEqual({
      fixture_kind: "bounded_player_action",
      required_preconditions: ["connected", "on_ground"],
    });
    expect(capture.capability_contract).not.toHaveProperty("local_reference_lane");
    expect(capture.normalized_progress).toEqual([
      expect.objectContaining({
        event_type: "workflow.started",
        measurements: {},
      }),
      expect.objectContaining({
        event_type: "workflow.succeeded",
        measurements: { distance_blocks: 0.42, duration_ticks: 5, x: 10 },
      }),
    ]);
    expect(capture.terminal_outcome).toBe("success");
    expect(capture.terminal_authority_status).toBe("not_applicable");
  });

  it("refuses to manufacture a capture before a terminal controller event", () => {
    expect(() =>
      buildDirectDiagnosticCapture({
        logText: line(request),
        prompt: "Take one careful step forward.",
      }),
    ).toThrow(/no terminal workflow event/i);
  });

  it("retains navigation capability identity and the requested control engine", () => {
    const navigationRequest = {
      ...request,
      workflow_id: "direct_player_action_workflow:test-navigation",
      action_kind: "navigate_to",
      control_engine: "baritone",
      arguments: {
        destination: { x: 12, y: 64, z: 20 },
        arrival_radius: 0.6,
        allow_sprint: false,
        allow_dig: false,
        allow_place: false,
        engine_preference: "baritone",
      },
    };
    const logText = [
      line(navigationRequest),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: navigationRequest.workflow_id,
        action_kind: "navigate_to",
        event_type: "workflow.failed",
        sequence: 1,
        workflow_state: "failed",
        progress_fraction: null,
        measurements: {
          control_engine: "baritone",
          engine_available: false,
        },
        manual_override_detected: false,
        controls_released: true,
        created_at: "2026-08-10T01:02:03.100Z",
      }),
    ].join("\n");

    const capture = buildDirectDiagnosticCapture({
      logText,
      prompt: "Use Baritone to navigate to the safe target.",
      comparisonMode: true,
    });

    expect(capture.selected_capability_id).toBe(
      "com.casimirbot.minecraft.player.navigate",
    );
    expect(capture.capability_contract).toMatchObject({
      capability_id: "com.casimirbot.minecraft.player.navigate",
      control_engine: "baritone",
    });
    expect(capture.execution_outcome).toBe("failed");
    expect(capture.terminal_outcome).toBe("typed_failure");
  });

  it("retains the guardian capability identity and parallel terminal receipts", () => {
    const guardianRequest = {
      ...request,
      workflow_id: "direct_player_action_workflow:test-guardian",
      action_kind: "execute_reactive_program",
      arguments: {
        program_schema: "helix.minecraft.reactive_program.v1",
        program_id: "program:test-guardian",
      },
    };
    const terminalMeasurements = {
      program_schema: "helix.minecraft.reactive_program.v1",
      program_id: "program:test-guardian",
      reactive_program_completed: true,
      max_concurrent_lane_count: 2,
      parallel_tick_count: 4,
      controls_released: true,
    };
    const logText = [
      line(guardianRequest),
      line({
        schema: "helix.minecraft.player.direct_diagnostic_event.v1",
        workflow_id: guardianRequest.workflow_id,
        action_kind: "execute_reactive_program",
        event_type: "workflow.succeeded",
        sequence: 1,
        workflow_state: "succeeded",
        progress_fraction: 1,
        measurements: terminalMeasurements,
        manual_override_detected: false,
        controls_released: true,
        created_at: "2026-08-10T01:02:04.000Z",
      }),
    ].join("\n");

    const capture = buildDirectDiagnosticCapture({
      logText,
      prompt: "Track the target while taking one careful step.",
      comparisonMode: true,
    });

    expect(capture.selected_capability_id).toBe(
      "com.casimirbot.minecraft.player.guardian.execute",
    );
    expect(capture.execution_outcome).toBe("succeeded");
    expect(capture.normalized_progress.at(-1)?.measurements).toEqual(
      terminalMeasurements,
    );
    expect(capture.terminal_authority_status).toBe("not_applicable");
  });
});
