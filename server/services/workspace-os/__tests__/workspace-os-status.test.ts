import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { workspaceOsRouter } from "../../../routes/workspace-os";
import {
  buildHelixWorkspaceOsStatus,
  getHelixWorkspaceOsStatus,
} from "../workspace-os-status";
import {
  listClientCapabilityActions,
  requestClientCapabilityAction,
  resetClientCapabilityActionsForTest,
} from "../../client-capabilities/client-action-queue";
import {
  recordClientCapabilityAdoption,
  resetClientCapabilityAdoptionsForTest,
} from "../../client-capabilities/client-adoption-store";
import {
  registerSituationSourceCapability,
  resetSituationSourceCapabilitiesForTest,
} from "../../situation-room/situation-source-capability-store";
import {
  resetSourceBindingStatusForTest,
  upsertSourceBindingStatus,
} from "../../situation-room/source-binding-status-store";
import {
  registerEnvironmentSourceManifest,
  resetEnvironmentSourceRegistryForTest,
} from "../../situation-room/environment-source-registry";
import {
  recordEnvironmentSourceHeartbeat,
  resetEnvironmentSourceHeartbeatStoreForTest,
} from "../../situation-room/environment-source-heartbeat-store";
import { runtimeMemoryGovernor } from "../../runtime/runtime-memory-governor";
import type {
  HelixEnvironmentSourceHeartbeat,
  HelixEnvironmentSourceManifest,
} from "@shared/helix-environment-source-manifest";

const threadId = "workspace-os:test-thread";
const roomId = "workspace-os:test-room";

const envKeys = [
  "LLM_POLICY",
  "LLM_RUNTIME",
  "ENABLE_LLM_LOCAL_SPAWN",
  "LLM_LOCAL_CMD",
  "LLM_LOCAL_MODEL",
  "LLM_LOCAL_MODEL_PATH",
  "OPENAI_API_KEY",
  "LLM_HTTP_BASE",
  "LLM_HYDRATE_LOCAL_ARTIFACTS_IN_HTTP_MODE",
] as const;
const originalEnv = new Map<string, string | undefined>();
for (const key of envKeys) {
  originalEnv.set(key, process.env[key]);
}

const restoreEnv = () => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const buildApp = () => {
  const app = express();
  app.use("/api/workspace-os", workspaceOsRouter);
  return app;
};

const environmentManifest = (): HelixEnvironmentSourceManifest => ({
  schema: "helix.environment_source_manifest.v1",
  manifest_id: "manifest-env-source-1",
  source_id: "env-source-1",
  room_id: roomId,
  domain: "minecraft",
  domain_adapter: "minecraft.paper",
  source_label: "Minecraft test source",
  adapter_version: "test",
  protocol_version: "test",
  modalities: ["environment_state", "environment_affordance"],
  supported_snapshot_sections: ["actor_state", "inventory_state"],
  supported_probe_types: ["route_feasibility", "reachability", "inventory_check"],
  forbidden_probe_types: [],
  snapshot_policy: {
    baseline_interval_ms: 1000,
    burst_interval_ms: null,
    send_only_changed_sections: true,
    include_section_hashes: true,
    max_payload_bytes: 64000,
    raw_payload_included: false,
  },
  execution_policy: {
    may_execute_live_actions: false,
    may_perform_read_only_probes: true,
    require_human_approval_for_execution: true,
  },
  sensor_scope_policy: {
    default_scope: "local_room",
    can_report_privileged_state: false,
    privileged_state_requires_caveat: true,
    player_memory_requires_prior_observation: true,
  },
  auth_policy: {
    bearer_required: false,
  },
  created_at: "2026-06-05T00:00:00.000Z",
  assistant_answer: false,
  raw_content_included: false,
  context_policy: "compact_context_pack_only",
});

const environmentHeartbeat = (): HelixEnvironmentSourceHeartbeat => {
  const now = new Date().toISOString();
  return {
    schema: "helix.environment_source_heartbeat.v1",
    heartbeat_id: "heartbeat-env-source-1",
    source_id: "env-source-1",
    room_id: roomId,
    domain: "minecraft",
    domain_adapter: "minecraft.paper",
    status: "active",
    latest_snapshot_ts: now,
    runtime_status: {
      status: "active",
      auth_failure_count: 0,
      oversized_payload_count: 0,
      last_error: null,
    },
    evidence_refs: ["environment_heartbeat:env-source-1"],
    created_at: now,
    assistant_answer: false,
    raw_content_included: false,
  };
};

describe("Workspace OS status", () => {
  afterEach(() => {
    resetClientCapabilityActionsForTest();
    resetClientCapabilityAdoptionsForTest();
    resetSituationSourceCapabilitiesForTest();
    resetSourceBindingStatusForTest();
    resetEnvironmentSourceRegistryForTest();
    resetEnvironmentSourceHeartbeatStoreForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
    restoreEnv();
  });

  it("aggregates existing status systems without raw client content", async () => {
    process.env.LLM_POLICY = "http";
    process.env.ENABLE_LLM_LOCAL_SPAWN = "1";
    process.env.LLM_LOCAL_CMD = "C:\\Users\\test\\secret\\llama-cli.exe";
    process.env.OPENAI_API_KEY = "test-openai-key";

    const clipboardWrite = requestClientCapabilityAction({
      thread_id: threadId,
      capability: "clipboard_write",
      action: "adopt_producer",
      target_client: "current_browser",
      args: {
        text: "SECRET_CLIPBOARD_TEXT_SHOULD_NOT_LEAK",
      },
    });
    recordClientCapabilityAdoption({
      action_request_id: clipboardWrite.action_request_id,
      thread_id: threadId,
      client_id: "current_browser",
      ok: false,
      observed_state: {
        clipboard_text: "SECRET_CLIPBOARD_TEXT_SHOULD_NOT_LEAK",
      },
      error: "native_clipboard_write_failed",
      next_required_action: "manual_clipboard_fallback",
    });
    registerSituationSourceCapability({
      source_id: "visual-source-1",
      thread_id: threadId,
      room_id: roomId,
      modality: "visual_frame",
      status: "permission_required",
      contribution: "visual_scene",
      missing_reason: "Browser capture permission has not been granted.",
      next_required_action: "grant_visual_capture_permission",
    });
    upsertSourceBindingStatus({
      thread_id: threadId,
      source_id: "visual-source-1",
      source_kind: "visual_frame",
      modality: "visual_frame",
      state: "repair_candidate",
      terminal_eligible: false,
      terminal_ineligible_reason: "repair_candidate_requires_explicit_acceptance",
      latest_observation_refs: ["observation:visual-source-1"],
    });
    registerEnvironmentSourceManifest(environmentManifest());
    recordEnvironmentSourceHeartbeat(environmentHeartbeat());

    const status = await getHelixWorkspaceOsStatus({
      thread_id: threadId,
      room_id: roomId,
    });
    const serialized = JSON.stringify(status);

    expect(status.schema_version).toBe("helix.workspace_os.status.v1");
    expect(status.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
    });
    expect(status.capabilities.every((capability) =>
      capability.authority.assistant_answer === false &&
      capability.authority.raw_content_included === false &&
      capability.authority.terminal_eligible === false
    )).toBe(true);
    expect(status.capabilities.find((entry) => entry.capability_id === "clipboard.write")).toMatchObject({
      status: "error",
      failure_reason: "native_clipboard_write_failed",
      next_required_action: "manual_clipboard_fallback",
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "situation.source.visual-source-1")).toMatchObject({
      status: "permission_required",
      next_required_action: "grant_visual_capture_permission",
    });
    expect(status.capabilities.find((entry) => entry.capability_id.startsWith("source.binding."))).toMatchObject({
      status: "waiting_for_client",
      authority: {
        terminal_eligible: false,
      },
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "environment.source.env-source-1")).toMatchObject({
      status: "available",
      diagnostics: expect.objectContaining({
        execution: "disabled",
      }),
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "workstation.dynamic_actions")).toMatchObject({
      status: "available",
      diagnostics: expect.objectContaining({
        terminal_receipt_required_count: expect.any(Number),
      }),
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "workstation.task_manager")).toMatchObject({
      status: "available",
      surface: "runtime_memory",
      mode: "read_only",
      authority: {
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
      diagnostics: expect.objectContaining({
        endpoint: "/api/workspace-os/task-manager",
        executes_task_control: false,
      }),
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "runtime.local_ai")).toMatchObject({
      status: "available",
      surface: "runtime_memory",
      mode: "diagnostic",
      authority: {
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
      diagnostics: expect.objectContaining({
        backend: "http",
        http_runtime_locked: true,
        local_execution_possible: false,
        provider_called_by_status_read: false,
        exposes_raw_model_path: false,
        exposes_raw_command_path: false,
        executes_model_call: false,
      }),
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "workstation.browser_responsiveness")).toMatchObject({
      status: "available",
      surface: "screen",
      mode: "diagnostic",
      diagnostics: expect.objectContaining({
        status_endpoint: "/api/workspace-os/browser-performance/status",
        command_status_endpoint: "/api/workspace-os/command-reliability/status",
        exposes_clipboard_contents: false,
        executes_task_control: false,
      }),
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "workstation.storage_map")).toMatchObject({
      status: "available",
      surface: "filesystem",
      mode: "read_only",
      authority: {
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
      diagnostics: expect.objectContaining({
        endpoint: "/api/workspace-os/storage/status",
        scans_local_machine_filesystem: false,
        exposes_raw_storage_values: false,
        executes_cleanup: false,
      }),
    });
    expect(status.runtime).toMatchObject({
      memory_pressure: "normal",
      active_task_count: 0,
    });
    expect(serialized).not.toContain("SECRET_CLIPBOARD_TEXT_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("C:\\Users");
    expect(serialized).not.toContain("test-openai-key");
  });

  it("represents workstation deep-link restore as diagnostic shell capability metadata", async () => {
    const status = await getHelixWorkspaceOsStatus({ thread_id: threadId, room_id: roomId });
    const serialized = JSON.stringify(status);

    expect(status.capabilities.find((entry) => entry.capability_id === "workstation.deep_link_state")).toMatchObject({
      surface: "workstation_action",
      mode: "diagnostic",
      status: "available",
      source: "workstation_shell_capability_contract",
      authority: {
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
      diagnostics: expect.objectContaining({
        supported_query_params: ["panels", "focus", "doc", "anchor", "entry"],
        path_policy: "workspace_relative_path_ref_only",
        passive_restore_emits_receipt: false,
        workspace_os_status_executes: false,
        raw_local_paths_allowed: false,
      }),
    });

    expect(status.capabilities.find((entry) => entry.capability_id === "workstation.restore_view_state")).toMatchObject({
      surface: "workstation_action",
      mode: "diagnostic",
      status: "available",
      source: "workstation_shell_capability_contract",
      fallbacks: expect.arrayContaining(["workstation.panel_focus", "docs-viewer.open_doc_by_path"]),
      authority: {
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
      diagnostics: expect.objectContaining({
        action_id: "restore_view_state",
        supported_query_params: ["panels", "focus", "doc", "anchor"],
        path_policy: "workspace_relative_path_ref_only",
        passive_restore_emits_receipt: false,
        agent_triggered_emits_receipt: true,
        agent_receipt_kind: "workstation_view_state_restore",
        workspace_os_status_executes: false,
        raw_local_paths_allowed: false,
      }),
    });

    expect(serialized).not.toMatch(/[A-Za-z]:\\\\|C:\\Users/);
  });

  it("maps source capability states into Workspace OS status language", async () => {
    registerSituationSourceCapability({
      source_id: "source-active",
      thread_id: threadId,
      room_id: roomId,
      modality: "world_event",
      status: "active",
      contribution: "activity",
    });
    registerSituationSourceCapability({
      source_id: "source-stale",
      thread_id: threadId,
      room_id: roomId,
      modality: "audio_transcript",
      status: "stale",
      contribution: "dialogue",
      next_required_action: "send_source_heartbeat",
    });

    const status = await getHelixWorkspaceOsStatus({ thread_id: threadId, room_id: roomId });

    expect(status.capabilities.find((entry) => entry.capability_id === "situation.source.source-active")).toMatchObject({
      status: "available",
    });
    expect(status.capabilities.find((entry) => entry.capability_id === "situation.source.source-stale")).toMatchObject({
      status: "stale",
      next_required_action: "send_source_heartbeat",
    });
  });

  it("degrades gracefully when a subsystem status reader throws", async () => {
    const status = await buildHelixWorkspaceOsStatus(
      { thread_id: threadId, room_id: roomId },
      {
        readSituationSourceCapabilities: () => {
          throw new Error("reader failed with token=VERY_SECRET_TOKEN_VALUE_THAT_SHOULD_BE_REDACTED_1234567890");
        },
      },
    );

    const errorRecord = status.capabilities.find((entry) => entry.capability_id === "workspace_os.situation_sources.error");

    expect(errorRecord).toMatchObject({
      status: "error",
      authority: {
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      },
    });
    expect(JSON.stringify(status)).not.toContain("VERY_SECRET_TOKEN_VALUE");
  });

  it("serves sanitized route JSON without executing mutating actions", async () => {
    const action = requestClientCapabilityAction({
      thread_id: threadId,
      capability: "clipboard_write",
      action: "adopt_producer",
      target_client: "current_browser",
      args: {
        text: "ROUTE_SECRET_CLIPBOARD_TEXT_SHOULD_NOT_LEAK",
      },
    });
    const app = buildApp();

    const response = await request(app)
      .get(`/api/workspace-os/status?thread_id=${encodeURIComponent(threadId)}&room_id=${encodeURIComponent(roomId)}`)
      .expect(200);

    const afterAction = listClientCapabilityActions({ threadId })
      .find((entry) => entry.action_request_id === action.action_request_id);
    expect(response.body.schema_version).toBe("helix.workspace_os.status.v1");
    expect(response.body.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("ROUTE_SECRET_CLIPBOARD_TEXT_SHOULD_NOT_LEAK");
    expect(afterAction?.status).toBe("requested");
  });

  it("does not provide final assistant answer authority", async () => {
    const status = await getHelixWorkspaceOsStatus({ thread_id: threadId });

    expect(status.authority.terminal_eligible).toBe(false);
    expect(status.authority.terminal_ineligible_reason).toBe("workspace_os_status_is_diagnostic_only");
    expect(status.capabilities.some((entry) => entry.authority.terminal_eligible)).toBe(false);
  });
});
