import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_ACTION_READ_SCOPE } from "@shared/helix-environment-action";
import {
  HELIX_ENVIRONMENT_PROBE_OBSERVATION_SCHEMA,
  HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
  type HelixEnvironmentProbeObservation,
} from "@shared/helix-environment-connector";
import {
  acknowledgeHelixEnvironmentMonitor,
  createHelixEnvironmentMonitorLease,
  deliverHelixEnvironmentMonitorItems,
  revokeHelixEnvironmentMonitor,
  type HelixEnvironmentMonitorLease,
} from "@shared/helix-environment-monitor";
import {
  HELIX_ENVIRONMENT_DURABLE_GOAL_PROJECTION_SCHEMA,
  type HelixEnvironmentDurableGoalProjection,
} from "@shared/helix-environment-durable-goal";
import {
  createHelixMcpServer,
  type HelixEnvironmentDurableGoalMcpStore,
  type HelixEnvironmentMonitorMcpStore,
  type HelixEnvironmentMonitorSemanticSourcePort,
  type HelixEnvironmentProbeMcpExecutor,
} from "../helix-mcp-server";
import type { HelixAgentApiService } from "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import type { SharedLiveRoomBindingStore } from "../../services/shared-live-room-control/binding-store";
import type { SharedLiveRoomControlService } from "../../services/shared-live-room-control/service";
import {
  listStagePlayLiveSourceMailItems,
  resetStagePlayLiveSourceMailboxForTest,
} from "../../services/stage-play/stage-play-live-source-mailbox-store";

const ROOM_ID = "shared_realtime_room:monitor";
const PARTICIPANT_ID = "shared_realtime_room_participant:monitor";
const CLIENT_REF = `oauth_client:${"c".repeat(64)}`;

const perceptionResult = (): Record<string, unknown> => ({
  snapshot_schema: "helix.minecraft_perception_snapshot.v1",
  observation_revision: 420,
  game_tick: 420,
  capture_duration_ms: 3.25,
  dimension: "minecraft:overworld",
  actor: {
    position: { x: 1.5, y: 64, z: -2.5 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 20,
    max_health: 20,
    food_level: 20,
    air: 300,
    on_ground: true,
    on_fire: false,
    freezing: false,
  },
  focus: {
    kind: "miss",
    distance_blocks: 0,
    line_of_sight: true,
    occlusion: "none",
  },
  entities: [],
  hazards: [],
  movement_candidates: [
    ["south", "forward"],
    ["west", "right"],
    ["north", "back"],
    ["east", "left"],
  ].map(([cardinal_direction, relative_direction], index) => ({
    cardinal_direction,
    relative_direction,
    target_feet_position: { x: index, y: 64, z: 0 },
    support_position: { x: index, y: 63, z: 0 },
    support_block: "minecraft:stone",
    evidence_complete: true,
    feet_clear: true,
    head_clear: true,
    drop_depth_blocks: 0,
    drop_scan_complete: true,
    nearby_hazard_count: 0,
    nearby_fluid_count: 0,
    safe_candidate: true,
  })),
  inventory: { item_count: 0, slots: [] },
  coverage: {
    horizontal_radius: 4,
    vertical_radius: 8,
    loaded_region_complete: true,
    unknown_cell_count: 0,
    entities_complete: true,
    hazards_complete: true,
    omitted_categories: ["manual_input_attribution"],
  },
  ui_state: {
    server_container_open: false,
    same_revision: true,
    client_screen_state: "closed",
    input_capture_known: true,
    input_activity: false,
    client_game_tick: 420,
    server_received_tick: 420,
    age_ticks: 0,
    freshness: "fresh",
    screen_kind: "none",
  },
  world_rules: { keep_inventory: false },
  semantic_fingerprint: `sha256:${"f".repeat(64)}`,
});

const principal = (): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  const now = "2026-08-24T12:00:00.000Z";
  return {
    tenantId: "tenant:monitor",
    issuer: "https://issuer.example",
    subjectId: "subject:monitor",
    accountProfileId: "profile:monitor",
    accountType: "developer",
    oauthClientRef: CLIENT_REF,
    scopes: new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_READ_SCOPE]),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:monitor",
      profile_id: "profile:monitor",
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:monitor",
        profile: {
          profile_id: "profile:monitor",
          display_name: "Monitor User",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject:monitor",
          picture_url: null,
          created_at: now,
          updated_at: now,
        },
        account_policy: policy,
        status: "active",
        memory_scope: "profile",
        created_at: now,
        updated_at: now,
        expires_at: "2099-01-01T00:00:00.000Z",
      },
      account_policy: policy,
    },
  };
};

const nativeDesktopPrincipalWithoutExpiry = (): HelixAgentApiPrincipal => {
  const value = principal();
  return {
    ...value,
    issuer: "urn:casimirbot:desktop-session",
    mcpClientRef: `mcp_client:native_desktop:${"d".repeat(64)}`,
    oauthClientRef: null,
    tokenExpiresAt: null,
    accountContext: {
      ...value.accountContext,
      trusted_account_session: true,
      account_session: {
        ...value.accountContext.account_session!,
        status: "active",
        expires_at: null,
      },
    },
  };
};

const goal: HelixEnvironmentDurableGoalProjection = {
  schema: HELIX_ENVIRONMENT_DURABLE_GOAL_PROJECTION_SCHEMA,
  goal_id: "environment_goal:monitor",
  revision: 1,
  latest_event_hash: `sha256:${"a".repeat(64)}`,
  status: "active",
  objective: {
    objective_text: "Prepare for a legitimate Nether journey.",
    goal_kind: "custom_survival",
    domain: "minecraft",
    game_version: "1.21.8",
    mechanics_collection_ref: null,
    milestones: [{
      milestone_id: "milestone:prepare",
      description: "Prepare safely.",
      dependency_milestone_ids: [],
      required_postcondition_ids: ["postcondition:viable"],
    }],
  },
  identity: {
    owner_profile_id: "profile:monitor",
    host_ref: "device:one",
    connector_installation_id: "installation:one",
    device_id: "device:one",
    environment_binding_id: "environment:one",
    room_source_binding_id: "room_source:one",
    room_id: ROOM_ID,
    goal_owner_participant_id: PARTICIPANT_ID,
    participant_id: PARTICIPANT_ID,
    authority_participant_id: PARTICIPANT_ID,
    subject_binding_id: "subject:one",
    subject_native_id: "player:one",
    source_id: "source:one",
    world_id: "minecraft:overworld",
    producer_epoch_ref: "epoch:one",
    action_authority_id: "authority:one",
    authority_policy_version: 2,
    authority_expires_at: "2099-01-01T00:00:00.000Z",
    run_id: "agent_run:monitor",
    turn_id: "turn:one",
  },
  active_milestone_id: null,
  milestones: [{
    milestone_id: "milestone:prepare",
    description: "Prepare safely.",
    status: "candidate",
    required_postcondition_ids: ["postcondition:viable"],
    completed_postcondition_ids: [],
  }],
  recent_attempts: [],
  attempt_count: 0,
  latest_checkpoint: null,
  recovery: { required: false, reason: null, rebound_event_id: null },
  consumed_semantic_wake_refs: [],
  event_refs: ["goal_event:one"],
  content_role: "environment_durable_goal_projection_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const connect = async (principalValue: HelixAgentApiPrincipal = principal()) => {
  let lease: HelixEnvironmentMonitorLease | null = null;
  const monitorStore = {
    create: vi.fn(async (input) => {
      lease ??= createHelixEnvironmentMonitorLease({
        monitorId: "environment_monitor:mcp",
        identity: input.identity,
        eventFamilies: input.eventFamilies,
        maxEventAgeMs: input.maxEventAgeMs,
        wakeBudgetTotal: input.wakeBudgetTotal,
        createdAt: "2026-08-24T12:00:00.000Z",
        expiresAt: input.expiresAt,
      });
      return lease;
    }),
    inspect: vi.fn(async () => lease!),
    readPendingDeliveries: vi.fn(),
    findDeliveredEvidenceRefs: vi.fn(),
    deliver: vi.fn(),
    markRetentionGap: vi.fn(),
    acknowledge: vi.fn(async (input) => {
      lease = acknowledgeHelixEnvironmentMonitor({ lease: lease!, cursor: input.cursor });
      return lease;
    }),
    recordFreshSnapshot: vi.fn(async () => lease!),
    revoke: vi.fn(async () => {
      lease = lease!.status === "revoked" ? lease : revokeHelixEnvironmentMonitor({ lease: lease! });
      return lease;
    }),
  } satisfies HelixEnvironmentMonitorMcpStore;
  const semanticSource = {
    readOrWait: vi.fn(async () => {
      const delivered = deliverHelixEnvironmentMonitorItems({
        lease: lease!,
        items: [{
          evidence_ref: "digest:one",
          digest_id: "digest:one",
          digest_hash: `sha256:${"d".repeat(64)}`,
          observation_revision: 7,
          event_families: ["hazard"],
          source_id: "source:one",
          world_id: "minecraft:overworld",
          subject_ref: "subject:one",
          producer_epoch_ref: "epoch:one",
          observed_at: new Date().toISOString(),
          provenance_valid: true,
          raw_events_included: false,
          content_role: "environment_monitor_item_not_assistant_answer",
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        }],
      });
      lease = delivered.lease;
      return delivered;
    }),
  } satisfies HelixEnvironmentMonitorSemanticSourcePort;
  const goalStore = {
    create: vi.fn(),
    inspect: vi.fn(async () => goal),
    append: vi.fn(),
  } satisfies HelixEnvironmentDurableGoalMcpStore;
  const probeObservation: HelixEnvironmentProbeObservation = {
    schema: HELIX_ENVIRONMENT_PROBE_OBSERVATION_SCHEMA,
    probe_request_ref: "environment_probe_request:perception",
    probe_attempt_ref: "environment_probe_attempt:perception",
    capability_id: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
    capability_version: 1,
    outcome: "succeeded",
    summary: "Same-revision perception captured.",
    result: perceptionResult(),
    evidence_ref: "environment_probe_evidence:perception",
    observation_revision: 420,
    observed_at: new Date().toISOString(),
    freshness_age_ms: 0,
    provenance_valid: true,
    eligible_for_current_turn_reentry: true,
    late_result_disposition: null,
    content_role: "environment_probe_observation_not_assistant_answer",
    reentry_required: true,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
  const executeProbe = vi.fn(async () => ({
    ok: true,
    status: "completed" as const,
    summary: probeObservation.summary,
    observation: probeObservation,
  })) as HelixEnvironmentProbeMcpExecutor;
  const server = createHelixMcpServer({
    principal: principalValue,
    service: {} as HelixAgentApiService,
    roomControlService: {
      inspectRoom: vi.fn(async () => ({ room: { self_participant_id: PARTICIPANT_ID } })),
    } as unknown as SharedLiveRoomControlService,
    roomBindingStore: {} as Pick<SharedLiveRoomBindingStore, "bindRunToRoom" | "claimPendingChatBinding" | "revokeRunRoomBindingForOwner" | "revokeClaimedRunChatBindingForOwner">,
    deviceCheckService: vi.fn(),
    environmentDurableGoalService: goalStore,
    environmentMonitorService: monitorStore,
    environmentMonitorSemanticSource: semanticSource,
    environmentProbeExecutor: executeProbe,
    mcpEvidenceObservationStore: { put: vi.fn(async () => undefined), get: vi.fn() } as never,
  });
  const client = new Client({ name: "monitor-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, monitorStore, semanticSource, executeProbe };
};

afterEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
});

describe("Helix MCP environment monitor", () => {
  it("projects only changed perception fingerprints into the ordered monitor source", async () => {
    const connection = await connect();
    try {
      const created = await connection.client.callTool({
        name: "helix_environment_monitor_create",
        arguments: {
          room_id: ROOM_ID,
          goal_id: goal.goal_id,
          client_continuation_ref: "continuation:perception",
          event_families: ["actor", "inventory", "hazard", "focus"],
        },
      });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      const call = async () => connection.client.callTool({
        name: "helix_minecraft_situation_probe",
        arguments: {
          room_id: ROOM_ID,
          monitor: {
            monitor_id: "environment_monitor:mcp",
            client_continuation_ref: "continuation:perception",
          },
          probe: {
            kind: "perception_snapshot",
            horizontal_radius: 4,
            vertical_radius: 8,
          },
        },
      });
      const first = await call();
      expect(first.isError, JSON.stringify(first)).not.toBe(true);
      expect(first.structuredContent).toMatchObject({
        monitor_projection: {
          disposition: "projected",
          monitor_id: "environment_monitor:mcp",
          evidence_ref: `environment_perception_snapshot:420:${"f".repeat(32)}`,
        },
      });
      const second = await call();
      expect(second.isError, JSON.stringify(second)).not.toBe(true);
      expect(second.structuredContent).toMatchObject({
        monitor_projection: { disposition: "unchanged" },
      });
      const mail = listStagePlayLiveSourceMailItems({
        roomId: ROOM_ID,
        sourceId: "source:one",
        sourceKind: "minecraft_world_event",
      });
      expect(mail).toHaveLength(1);
      expect(mail[0]).toMatchObject({
        environmentIdentity: {
          observationRevision: 420,
          digestHash: `sha256:${"f".repeat(64)}`,
        },
        sourceRefs: {
          observationRef: "environment_probe_evidence:perception",
        },
        hints: { deterministicChangeHint: "summary_changed" },
      });
      expect(JSON.parse(mail[0].summary.text)).toMatchObject({
        raw_snapshot_included: false,
          semantic_state: {
            client_screen_state: "closed",
            keep_inventory: false,
            semantic_fingerprint: `sha256:${"f".repeat(64)}`,
        },
      });
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it("binds the signed client and exposes finite nonterminal lifecycle operations", async () => {
    const connection = await connect();
    try {
      const catalog = await connection.client.listTools();
      expect(catalog.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "helix_client_authorization_status",
        "helix_environment_monitor_create",
        "helix_environment_monitor_inspect",
        "helix_environment_monitor_read",
        "helix_environment_monitor_acknowledge",
        "helix_environment_monitor_snapshot_record",
        "helix_environment_monitor_revoke",
      ]));
      const authorization = await connection.client.callTool({
        name: "helix_client_authorization_status",
        arguments: { capability_profile: "g8-monitor" },
      });
      expect(authorization.isError, JSON.stringify(authorization)).not.toBe(true);
      expect(authorization.structuredContent).toMatchObject({
        schema: "helix.client_authorization_readiness.v1",
        capability_profile: "g8-monitor",
        ready: false,
        missing_scopes: [
          "helix.environment_actions.write",
          "helix.agent_runs.write",
          "helix.brokerage.paper_observer.process",
        ],
        recovery_action: "authorize_missing_scopes",
        credential_included: false,
        bearer_included: false,
        subject_included: false,
        client_identity_included: false,
        raw_claims_included: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      const continuation = "codex_task:nether";
      const created = await connection.client.callTool({
        name: "helix_environment_monitor_create",
        arguments: {
          room_id: ROOM_ID,
          goal_id: goal.goal_id,
          client_continuation_ref: continuation,
          event_families: ["actor", "hazard", "workflow"],
          max_event_age_ms: 120_000,
          wake_budget_total: 8,
          expires_in_seconds: 900,
        },
      });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      expect(created.structuredContent).toMatchObject({
        operation: "environment.monitor.create",
        lease: {
          monitor_id: "environment_monitor:mcp",
          identity: {
            owner_profile_id: "profile:monitor",
            mcp_client_id: CLIENT_REF,
            client_continuation_ref: continuation,
            run_id: "agent_run:monitor",
          },
          credential_included: false,
          raw_events_included: false,
          answer_authority: false,
          terminal_eligible: false,
        },
      });
      const read = await connection.client.callTool({
        name: "helix_environment_monitor_read",
        arguments: {
          monitor_id: "environment_monitor:mcp",
          client_continuation_ref: continuation,
          timeout_ms: 0,
          limit: 10,
        },
      });
      expect(read.isError, JSON.stringify(read)).not.toBe(true);
      expect(read.structuredContent).toMatchObject({
        operation: "environment.monitor.read",
        delivery: {
          disposition: "delivered",
          cursor_after: 1,
          wake_requested: true,
          raw_events_included: false,
          answer_authority: false,
        },
      });
      await connection.client.callTool({
        name: "helix_environment_monitor_acknowledge",
        arguments: {
          monitor_id: "environment_monitor:mcp",
          client_continuation_ref: continuation,
          cursor: 1,
        },
      });
      expect(connection.monitorStore.acknowledge).toHaveBeenCalledWith(expect.objectContaining({
        mcpClientId: CLIENT_REF,
        cursor: 1,
      }));
      const revoked = await connection.client.callTool({
        name: "helix_environment_monitor_revoke",
        arguments: {
          monitor_id: "environment_monitor:mcp",
          client_continuation_ref: continuation,
        },
      });
      expect(revoked.structuredContent).toMatchObject({
        operation: "environment.monitor.revoke",
        lease: { status: "revoked" },
      });
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it("grants an authenticated native desktop client only its requested finite monitor lease when the local session has no expiry", async () => {
    const connection = await connect(nativeDesktopPrincipalWithoutExpiry());
    try {
      const authorization = await connection.client.callTool({
        name: "helix_client_authorization_status",
        arguments: { capability_profile: "g8-monitor" },
      });
      expect(authorization.isError, JSON.stringify(authorization)).not.toBe(true);

      const created = await connection.client.callTool({
        name: "helix_environment_monitor_create",
        arguments: {
          room_id: ROOM_ID,
          goal_id: goal.goal_id,
          client_continuation_ref: "codex_task:native-desktop",
          event_families: ["actor", "hazard"],
          expires_in_seconds: 90,
        },
      });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      expect(connection.monitorStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: expect.objectContaining({
            mcp_client_id: `mcp_client:native_desktop:${"d".repeat(64)}`,
          }),
        }),
      );
      const expiresAt = Date.parse(
        (connection.monitorStore.create.mock.calls[0]?.[0] as { expiresAt: string })
          .expiresAt,
      );
      expect(expiresAt - Date.now()).toBeGreaterThan(80_000);
      expect(expiresAt - Date.now()).toBeLessThanOrEqual(90_000);
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it("still rejects an external OAuth client whose token has no verified expiry", async () => {
    const externalWithoutExpiry = principal();
    externalWithoutExpiry.tokenExpiresAt = null;
    const connection = await connect(externalWithoutExpiry);
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_monitor_create",
        arguments: {
          room_id: ROOM_ID,
          goal_id: goal.goal_id,
          client_continuation_ref: "codex_task:external-unbounded",
          event_families: ["actor"],
          expires_in_seconds: 90,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: "monitor_run_unavailable",
      });
      expect(connection.monitorStore.create).not.toHaveBeenCalled();
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it("fails closed when the signed token lacks an OAuth client identity", async () => {
    const principalWithoutClient = principal();
    delete principalWithoutClient.oauthClientRef;
    const connection = await connect(principalWithoutClient);
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_monitor_create",
        arguments: {
          room_id: ROOM_ID,
          goal_id: goal.goal_id,
          client_continuation_ref: "codex_task:unbound",
          event_families: ["actor"],
          max_event_age_ms: 120_000,
          wake_budget_total: 8,
          expires_in_seconds: 900,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: "mcp_client_identity_required",
      });
      expect(connection.monitorStore.create).not.toHaveBeenCalled();
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });
});
