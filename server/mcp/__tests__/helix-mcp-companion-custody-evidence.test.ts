import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { buildHelixSharedRealtimeRoomsExperimentPolicy } from
  "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from
  "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_ACTION_READ_SCOPE } from
  "@shared/helix-environment-action";
import {
  HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_SCHEMA,
  HELIX_MINECRAFT_COMPANION_ROOM_CUSTODY_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_ROOM_CUSTODY_EVIDENCE_SCHEMA,
  helixMinecraftCompanionCustodyEvidenceSchema,
} from "@shared/helix-minecraft-companion-custody-mcp";
import type { HelixMcpEvidenceObservation } from
  "@shared/contracts/helix-mcp-evidence-capability.v1";
import type { HelixAgentApiService } from
  "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";
import {
  SharedLiveRoomControlError,
  type SharedLiveRoomControlService,
} from "../../services/shared-live-room-control/service";
import {
  createHelixMcpServer,
  type HelixMinecraftCompanionCustodyEvidenceReader,
} from "../helix-mcp-server";

const PROFILE_ID = "profile:g2-a1-codex";
const ROOM_ID = "shared_realtime_room:companion-c2-b";
const PARTICIPANT_ID = "room_participant:companion-c2-b-owner";
const HASH = `sha256:${"1".repeat(64)}`;
const BEFORE = `sha256:${"2".repeat(64)}`;
const AFTER = `sha256:${"3".repeat(64)}`;
const SCOPES = [
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
  HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
] as const;
const caseReceipt = (case_id: string, index: number) => ({
  case_id,
  game_test_id: `c2A0Case${index}`,
  passed: true,
  atomic_settlement: true,
  exact_item_conservation: true,
  controls_released: true,
  late_effect_count: 0,
  duplicate_effect_count: 0,
  state_hash_before: BEFORE,
  state_hash_after: AFTER,
  mining_authority: false,
  crafting_authority: false,
  combat_authority: false,
  world_authority: false,
  answer_authority: false,
  terminal_authority: false,
});
const EVIDENCE = helixMinecraftCompanionCustodyEvidenceSchema.parse({
  schema: HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_SCHEMA,
  capability_id: "resident.minecraft.companion-custody-evidence.read.v1",
  source_lane: "C2_A0_direct_fabric",
  identity: {
    companion_id: "companion:noble-one",
    actor_entity_id: "minecraft-entity:c2-a0:custody-baseline",
    actor_incarnation_id: "incarnation:c2-a0:1",
    environment_id: "environment:c2-a0:gametest",
    world_id: "minecraft:gametest:c2-a0",
    connector_epoch: "connector-epoch:c2-a0:1",
    observation_revision: 1,
  },
  controller_profile_id: "resident.minecraft.companion-custody.v1",
  controller_artifact_hash: HASH,
  custody_revision: 7,
  minecraft_version: "1.21.8",
  fabric_loader_version: "0.18.4",
  focused_game_test_total: 4,
  focused_game_test_passed: 4,
  case_receipts: [
    caseReceipt("pickup_equip_unequip_transfer_retry", 1),
    caseReceipt("denied_slots_containers_stale_revision_conflict", 2),
    caseReceipt("backend_rollback_disconnect_release", 3),
    caseReceipt("restart_keep_drop_death_policy", 4),
  ],
  canonical_inventory_slots: 9,
  canonical_equipment_slots: 6,
  restart_revision_rotated: true,
  keep_policy_proven: true,
  drop_policy_proven: true,
  stale_revision_rejected: true,
  denied_slot_rejected: true,
  denied_container_rejected: true,
  backend_rollback_proven: true,
  idempotent_retry_proven: true,
  disconnect_release_proven: true,
  zero_duplication_or_loss: true,
  public_capability_exposed: false,
  execution_authority: false,
  inventory_execution_authority: false,
  mining_authority: false,
  crafting_authority: false,
  combat_authority: false,
  world_authority: false,
  credential_included: false,
  content_role: "minecraft_companion_custody_evidence_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  observed_at: "2026-08-31T12:00:00.000Z",
  support_refs: ["support:c2:1", "support:c2:2", "support:c2:3", "support:c2:4"],
});

const principal = (
  accountType: "developer" | "user" = "developer",
  scopes: readonly string[] = SCOPES,
): HelixAgentApiPrincipal => ({
  tenantId: "tenant:companion-c2",
  issuer: "https://issuer.example",
  subjectId: "subject:companion-c2",
  accountProfileId: PROFILE_ID,
  accountType,
  scopes: new Set(scopes),
  tokenExpiresAt: "2099-01-01T00:00:00.000Z",
  accountContext: {
    session_id: "external-oauth:companion-c2",
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: null,
    account_policy: buildHelixSharedRealtimeRoomsExperimentPolicy(accountType),
  },
}) as HelixAgentApiPrincipal;

const roomControl = (input: {
  status: "waiting_for_participant" | "active" | "closed";
  role?: "owner" | "participant";
  presence?: "present" | "left";
}) => ({
  inspectRoom: vi.fn(async () => ({
    room: {
      room_id: ROOM_ID,
      status: input.status,
      self_participant_id: PARTICIPANT_ID,
      participants: [{
        participant_id: PARTICIPANT_ID,
        role: input.role ?? "owner",
        presence: input.presence ?? "present",
      }],
    },
  })),
}) as unknown as SharedLiveRoomControlService;

const connect = async (input: {
  principal?: HelixAgentApiPrincipal;
  enabled?: boolean;
  reader?: HelixMinecraftCompanionCustodyEvidenceReader;
  roomControlService?: SharedLiveRoomControlService;
}) => {
  const observations = new Map<string, HelixMcpEvidenceObservation>();
  const evidenceStore = {
    put: vi.fn(async ({ observation }: { observation: HelixMcpEvidenceObservation }) => {
      observations.set(observation.observation_ref, observation);
    }),
    get: vi.fn(async ({ observationRef }: { observationRef: string }) => {
      const observation = observations.get(observationRef);
      if (!observation) throw new Error("missing_test_observation");
      return observation;
    }),
  };
  const server = createHelixMcpServer({
    principal: input.principal ?? principal(),
    service: {} as HelixAgentApiService,
    privateCompanionCustodyMcpEnabled: input.enabled,
    minecraftCompanionCustodyEvidenceReader: input.reader,
    roomControlService: input.roomControlService,
    mcpEvidenceObservationStore: evidenceStore as never,
  });
  const client = new Client(
    { name: "helix-companion-c2-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    evidenceStore,
    close: async () => { await client.close(); await server.close(); },
  };
};

describe("private authenticated MCP C2 companion custody evidence", () => {
  it("keeps injected readers developer-only and scope-gated", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    for (const entry of [
      { enabled: false, principal: principal(), reader },
      { enabled: true, principal: principal(), reader: undefined },
      { enabled: true, principal: principal("user"), reader },
    ]) {
      const connection = await connect(entry);
      try {
        const names = (await connection.client.listTools()).tools.map((tool) => tool.name);
        expect(names).not.toContain(HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_READ_TOOL);
        expect(names).not.toContain(HELIX_MINECRAFT_COMPANION_ROOM_CUSTODY_EVIDENCE_READ_TOOL);
      } finally { await connection.close(); }
    }
    const missingScope = await connect({
      principal: principal("developer", [HELIX_SHARED_LIVE_ROOM_READ_SCOPE]),
      enabled: true,
      reader,
    });
    try {
      const result = await missingScope.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_READ_TOOL,
        arguments: {
          identity: EVIDENCE.identity,
          controller_artifact_hash: EVIDENCE.controller_artifact_hash,
          custody_revision: EVIDENCE.custody_revision,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: "insufficient_scope" });
      expect(reader).not.toHaveBeenCalled();
    } finally { await missingScope.close(); }
  });

  it("re-enters exact A1 evidence and rejects stale artifact and revision", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    const connection = await connect({ enabled: true, reader });
    try {
      const catalog = await connection.client.listTools();
      expect(catalog.tools.find((tool) =>
        tool.name === HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_READ_TOOL
      )?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      for (const arguments_ of [
        { identity: EVIDENCE.identity, controller_artifact_hash: `sha256:${"a".repeat(64)}`, custody_revision: 7 },
        { identity: EVIDENCE.identity, controller_artifact_hash: HASH, custody_revision: 8 },
      ]) {
        const stale = await connection.client.callTool({
          name: HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_READ_TOOL,
          arguments: arguments_,
        });
        expect(stale.isError).toBe(true);
        expect(stale.structuredContent).toMatchObject({
          error: "companion_custody_identity_or_revision_mismatch",
          retryable: true,
        });
      }
      expect(connection.evidenceStore.put).not.toHaveBeenCalled();

      const result = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_READ_TOOL,
        arguments: {
          identity: EVIDENCE.identity,
          controller_artifact_hash: HASH,
          custody_revision: 7,
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        evidence: {
          schema: HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_SCHEMA,
          identity: EVIDENCE.identity,
          custody_revision: 7,
          focused_game_test_passed: 4,
          zero_duplication_or_loss: true,
          execution_authority: false,
          inventory_execution_authority: false,
          mining_authority: false,
          crafting_authority: false,
          combat_authority: false,
          world_authority: false,
          answer_authority: false,
          terminal_eligible: false,
        },
        mcp_evidence: { authority: { agent_executable: false, reentry_required: true } },
      });
      const observationRef = (result.structuredContent as {
        mcp_evidence: { observation_ref: string };
      }).mcp_evidence.observation_ref;
      const reentered = await connection.client.callTool({
        name: "helix_evidence_observation_get",
        arguments: { observation_ref: observationRef },
      });
      expect(reentered.structuredContent).toMatchObject({
        requested_observation_ref: observationRef,
        observation: {
          payload_schema: HELIX_MINECRAFT_COMPANION_CUSTODY_EVIDENCE_SCHEMA,
          payload: { identity: EVIDENCE.identity, custody_revision: 7 },
        },
        terminal_eligible: false,
        reentry_required: true,
      });
    } finally { await connection.close(); }
  });

  it("admits only the current room owner and revokes closed or missing rooms", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    for (const denied of [
      {
        service: roomControl({ status: "active", role: "participant" }),
        error: "companion_custody_room_owner_required",
      },
      {
        service: roomControl({ status: "closed" }),
        error: "companion_custody_room_revoked",
      },
      {
        service: {
          inspectRoom: vi.fn(async () => {
            throw new SharedLiveRoomControlError(404, "room_not_found", "missing");
          }),
        } as unknown as SharedLiveRoomControlService,
        error: "companion_custody_room_revoked",
      },
    ]) {
      const connection = await connect({
        enabled: true,
        reader,
        roomControlService: denied.service,
      });
      try {
        const result = await connection.client.callTool({
          name: HELIX_MINECRAFT_COMPANION_ROOM_CUSTODY_EVIDENCE_READ_TOOL,
          arguments: {
            room_id: ROOM_ID,
            identity: EVIDENCE.identity,
            controller_artifact_hash: HASH,
            custody_revision: 7,
          },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({ error: denied.error });
        expect(connection.evidenceStore.put).not.toHaveBeenCalled();
      } finally { await connection.close(); }
    }
    expect(reader).not.toHaveBeenCalled();

    const admitted = await connect({
      enabled: true,
      reader,
      roomControlService: roomControl({ status: "active" }),
    });
    try {
      const result = await admitted.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_CUSTODY_EVIDENCE_READ_TOOL,
        arguments: {
          room_id: ROOM_ID,
          identity: EVIDENCE.identity,
          controller_artifact_hash: HASH,
          custody_revision: 7,
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        room_evidence: {
          schema: HELIX_MINECRAFT_COMPANION_ROOM_CUSTODY_EVIDENCE_SCHEMA,
          room_id: ROOM_ID,
          room_role: "owner",
          evidence: { identity: EVIDENCE.identity, custody_revision: 7 },
          exact_identity_match: true,
          exact_revision_match: true,
          commands_executed: 0,
          environment_mutated: false,
          execution_authority: false,
          inventory_execution_authority: false,
          mining_authority: false,
          crafting_authority: false,
          combat_authority: false,
          world_authority: false,
          answer_authority: false,
          terminal_eligible: false,
        },
      });
    } finally { await admitted.close(); }
  });
});
