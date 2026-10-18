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
  HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_CAPABILITY,
  HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_SCHEMA,
  HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_SCHEMA,
  type HelixMinecraftCompanionPresenceEvidence,
  type HelixMinecraftCompanionPresenceIdentity,
} from "@shared/helix-minecraft-companion-mcp";
import { CompanionPresenceStore } from
  "../../services/environment-connectors/resident-control/companion-presence-store";
import type { HelixAgentApiService } from
  "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";
import {
  SharedLiveRoomControlError,
  type SharedLiveRoomControlService,
} from
  "../../services/shared-live-room-control/service";
import type { HelixMcpEvidenceObservation } from
  "@shared/contracts/helix-mcp-evidence-capability.v1";
import {
  createHelixMcpServer,
  type HelixMinecraftCompanionPresenceEvidenceReader,
} from "../helix-mcp-server";

const PROFILE_ID = "profile:companion-c0-a1";
const ROOM_ID = "shared_realtime_room:companion-c0-b";
const PARTICIPANT_ID = "room_participant:companion-c0-b-owner";
const NOW = "2026-08-31T18:00:00.000Z";

const principal = (
  scopes: readonly string[],
  accountType: "developer" | "user" = "developer",
): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy(accountType);
  return {
    tenantId: "tenant:companion-c0-a1",
    issuer: "https://issuer.example",
    subjectId: "subject:companion-c0-a1",
    accountProfileId: PROFILE_ID,
    accountType,
    scopes: new Set(scopes),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:companion-c0-a1",
      profile_id: PROFILE_ID,
      trusted_account_session: true,
      account_session: null,
      account_policy: policy,
    },
  } as HelixAgentApiPrincipal;
};

const buildFixture = (): {
  identity: HelixMinecraftCompanionPresenceIdentity;
  evidence: HelixMinecraftCompanionPresenceEvidence;
} => {
  const store = new CompanionPresenceStore({
    schema: "helix.minecraft_companion.profile.v1",
    companion_id: "companion:noble-one",
    owner_account_id: "account:owner",
    authority_subject_id: "subject:owner",
    beneficiary_subject_id: "player:owner",
    controller_profile_id: "resident.minecraft.companion-follow.v1",
    controller_artifact_hash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    created_at: NOW,
    public_capability_exposed: false,
    credential_included: false,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
  }, NOW);
  store.spawn({
    actorEntityId: "minecraft-entity:c0-a0:1",
    actorIncarnationId: "incarnation:c0-a0:1",
    environmentId: "environment:c0-a0",
    worldId: "minecraft:gametest:c0-a0",
    connectorEpoch: "connector-epoch:c0-a0:1",
    spawnedAt: "2026-08-31T18:00:01.000Z",
    presenceExpiresAt: "2026-08-31T18:05:01.000Z",
    evidenceRefs: ["evidence:c0-a0:spawn"],
  });
  store.bind({
    observedAt: "2026-08-31T18:00:02.000Z",
    evidenceRefs: ["evidence:c0-a0:bind"],
  });
  store.admit({
    actorLeaseId: "actor-lease:c0-a0:1",
    effectLeaseId: "effect-lease:c0-a0:1",
    resourceKeys: ["chunk:c0-a0:0-0"],
    admittedAt: "2026-08-31T18:00:03.000Z",
    evidenceRefs: ["evidence:c0-a0:admit"],
  });
  store.activate({
    activatedAt: "2026-08-31T18:00:04.000Z",
    evidenceRefs: ["evidence:c0-a0:active"],
  });
  const presence = store.release({
    cleanupId: "cleanup:c0-a0:manual",
    reason: "manual_override",
    completedAt: "2026-08-31T18:00:05.000Z",
    evidenceRefs: ["evidence:c0-a0:cleanup"],
  });
  const incarnation = presence.incarnation!;
  const identity = {
    companion_id: presence.profile.companion_id,
    actor_entity_id: incarnation.actor_entity_id,
    actor_incarnation_id: incarnation.actor_incarnation_id,
    environment_id: incarnation.environment_id,
    world_id: incarnation.world_id,
    connector_epoch: incarnation.connector_epoch,
    observation_revision: presence.revision,
  };
  return {
    identity,
    evidence: {
      schema: HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_SCHEMA,
      capability_id:
        HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_CAPABILITY,
      source_lane: "C0_A0_direct_fabric",
      identity,
      presence,
      cleanup_receipt: presence.cleanup_receipt!,
      identity_match: true,
      cleanup_complete: true,
      stale_action_rejected: true,
      stale_action_rejection_reason: "companion_action_identity_stale",
      public_capability_exposed: false,
      execution_authority: false,
      mining_authorized: false,
      credential_included: false,
      content_role:
        "minecraft_companion_presence_evidence_not_assistant_answer",
      reentry_required: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    },
  };
};

const connect = async (input: {
  principal: HelixAgentApiPrincipal;
  enabled: boolean;
  reader?: HelixMinecraftCompanionPresenceEvidenceReader;
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
    principal: input.principal,
    service: {} as HelixAgentApiService,
    privateCompanionPresenceMcpEnabled: input.enabled,
    minecraftCompanionPresenceEvidenceReader: input.reader,
    roomControlService: input.roomControlService,
    mcpEvidenceObservationStore: evidenceStore as never,
  });
  const client = new Client(
    { name: "helix-companion-c0-a1-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    evidenceStore,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

const roomControl = (state: {
  status: "waiting_for_participant" | "active" | "closed";
  role?: "owner" | "participant";
  presence?: "present" | "left";
}) => ({
  inspectRoom: vi.fn(async () => ({
    room: {
      room_id: ROOM_ID,
      status: state.status,
      self_participant_id: PARTICIPANT_ID,
      participants: [{
        participant_id: PARTICIPANT_ID,
        role: state.role ?? "owner",
        presence: state.presence ?? "present",
      }],
    },
  })),
}) as unknown as SharedLiveRoomControlService;

describe("private authenticated MCP C0 companion presence evidence", () => {
  it("stays absent when disabled, missing its private reader, or used by a public user", async () => {
    const fixture = buildFixture();
    const reader = vi.fn(async () => fixture.evidence);
    for (const entry of [
      { enabled: false, accountType: "developer" as const, reader },
      { enabled: true, accountType: "developer" as const, reader: undefined },
      { enabled: true, accountType: "user" as const, reader },
    ]) {
      const connection = await connect({
        principal: principal([
          HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
          HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
        ], entry.accountType),
        enabled: entry.enabled,
        reader: entry.reader,
      });
      try {
        const catalog = await connection.client.listTools();
        expect(catalog.tools.map((tool) => tool.name)).not.toContain(
          HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_READ_TOOL,
        );
      } finally {
        await connection.close();
      }
    }
  });

  it("discovers exact private evidence and re-enters its durable observation", async () => {
    const fixture = buildFixture();
    const reader = vi.fn(async () => fixture.evidence);
    const connection = await connect({
      principal: principal([
        HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
        HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
      ]),
      enabled: true,
      reader,
    });
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find((candidate) =>
        candidate.name ===
          HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_READ_TOOL
      );
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      expect(tool?._meta?.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: [
          HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
          HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
        ],
      }]);

      const stale = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_READ_TOOL,
        arguments: {
          identity: {
            ...fixture.identity,
            actor_incarnation_id: "incarnation:c0-a0:stale",
          },
        },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({
        error: "companion_presence_identity_mismatch",
        retryable: true,
      });
      expect(connection.evidenceStore.put).not.toHaveBeenCalled();

      const read = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_READ_TOOL,
        arguments: { identity: fixture.identity },
      });
      expect(read.isError, JSON.stringify(read)).not.toBe(true);
      expect(read.structuredContent).toMatchObject({
        evidence: {
          schema: HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_SCHEMA,
          identity: fixture.identity,
          cleanup_receipt: {
            cleanup_id: "cleanup:c0-a0:manual",
            controls_released: true,
            chunk_claims_released: true,
            late_effect_count: 0,
            duplicate_effect_count: 0,
          },
          public_capability_exposed: false,
          execution_authority: false,
          mining_authorized: false,
          credential_included: false,
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        },
        mcp_evidence: {
          authority: {
            agent_executable: false,
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
            reentry_required: true,
          },
        },
      });
      expect(reader).toHaveBeenLastCalledWith({
        ownerProfileId: PROFILE_ID,
        request: { identity: fixture.identity },
      });
      expect(reader).toHaveBeenCalledTimes(2);

      const observationRef = (read.structuredContent as {
        mcp_evidence: { observation_ref: string };
      }).mcp_evidence.observation_ref;
      const reentered = await connection.client.callTool({
        name: "helix_evidence_observation_get",
        arguments: { observation_ref: observationRef },
      });
      expect(reentered.isError, JSON.stringify(reentered)).not.toBe(true);
      expect(reentered.structuredContent).toMatchObject({
        schema: "helix.mcp_evidence_retrieval.v1",
        requested_observation_ref: observationRef,
        observation: {
          observation_ref: observationRef,
          payload_schema:
            HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_SCHEMA,
          payload: {
            identity: fixture.identity,
            cleanup_receipt: {
              cleanup_id: "cleanup:c0-a0:manual",
            },
            mining_authorized: false,
            terminal_eligible: false,
          },
        },
        content_role: "retrieved_observation_for_codex_reentry",
        agent_executable: false,
        terminal_eligible: false,
        reentry_required: true,
      });
      expect(connection.evidenceStore.put).toHaveBeenCalledTimes(2);
    } finally {
      await connection.close();
    }
  });

  it("fails closed before reading when either authenticated read scope is absent", async () => {
    const fixture = buildFixture();
    const reader = vi.fn(async () => fixture.evidence);
    const connection = await connect({
      principal: principal([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]),
      enabled: true,
      reader,
    });
    try {
      const result = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_PRESENCE_EVIDENCE_READ_TOOL,
        arguments: { identity: fixture.identity },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: "insufficient_scope",
      });
      expect(reader).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("projects exact C0 evidence into its current owner room and re-enters the same observation", async () => {
    const fixture = buildFixture();
    const reader = vi.fn(async () => fixture.evidence);
    const connection = await connect({
      principal: principal([
        HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
        HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
      ]),
      enabled: true,
      reader,
      roomControlService: roomControl({ status: "waiting_for_participant" }),
    });
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find((candidate) =>
        candidate.name ===
          HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_READ_TOOL
      );
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });

      const stale = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_READ_TOOL,
        arguments: {
          room_id: ROOM_ID,
          identity: {
            ...fixture.identity,
            actor_incarnation_id: "incarnation:c0-a0:stale",
          },
        },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({
        error: "companion_presence_identity_mismatch",
        retryable: true,
      });
      expect(connection.evidenceStore.put).not.toHaveBeenCalled();

      const read = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_READ_TOOL,
        arguments: { room_id: ROOM_ID, identity: fixture.identity },
      });
      expect(read.isError, JSON.stringify(read)).not.toBe(true);
      expect(read.structuredContent).toMatchObject({
        room_evidence: {
          schema: HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_SCHEMA,
          room_id: ROOM_ID,
          owner_profile_ref: PROFILE_ID,
          requesting_participant_ref: PARTICIPANT_ID,
          room_role: "owner",
          room_status: "waiting_for_participant",
          observation_origin: "room_projection",
          admission_basis: "room_owner_private_config",
          evidence: {
            identity: fixture.identity,
            cleanup_complete: true,
            execution_authority: false,
            mining_authorized: false,
            terminal_eligible: false,
          },
          room_binding_active: true,
          commands_executed: 0,
          side_effects: false,
          environment_mutated: false,
          public_capability_exposed: false,
          execution_authority: false,
          mutation_authority: false,
          mining_authorized: false,
          credential_included: false,
          private_endpoint_included: false,
          hidden_reasoning_included: false,
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        },
        mcp_evidence: {
          payload_schema:
            HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_SCHEMA,
          authority: {
            agent_executable: false,
            answer_authority: false,
            terminal_eligible: false,
            reentry_required: true,
          },
        },
      });
      const observationRef = (read.structuredContent as {
        mcp_evidence: { observation_ref: string };
      }).mcp_evidence.observation_ref;
      const reentered = await connection.client.callTool({
        name: "helix_evidence_observation_get",
        arguments: { observation_ref: observationRef },
      });
      expect(reentered.isError, JSON.stringify(reentered)).not.toBe(true);
      expect(reentered.structuredContent).toMatchObject({
        requested_observation_ref: observationRef,
        observation: {
          observation_ref: observationRef,
          payload_schema:
            HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_SCHEMA,
          payload: {
            room_id: ROOM_ID,
            requesting_participant_ref: PARTICIPANT_ID,
            evidence: { identity: fixture.identity },
            execution_authority: false,
            mining_authorized: false,
            terminal_eligible: false,
          },
        },
        terminal_eligible: false,
        reentry_required: true,
      });
    } finally {
      await connection.close();
    }
  });

  it("denies non-owner and revoked rooms, then admits a fresh MCP reconnection without restoring authority", async () => {
    const fixture = buildFixture();
    const reader = vi.fn(async () => fixture.evidence);
    const scopes = [
      HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
    ];
    for (const denied of [
      {
        service: roomControl({ status: "active", role: "participant" }),
        error: "companion_presence_room_owner_required",
      },
      {
        service: roomControl({ status: "closed" }),
        error: "companion_presence_room_revoked",
      },
      {
        service: {
          inspectRoom: vi.fn(async () => {
            throw new SharedLiveRoomControlError(
              404,
              "room_not_found",
              "Shared Live Room not found.",
            );
          }),
        } as unknown as SharedLiveRoomControlService,
        error: "companion_presence_room_revoked",
      },
    ]) {
      const connection = await connect({
        principal: principal(scopes),
        enabled: true,
        reader,
        roomControlService: denied.service,
      });
      try {
        const result = await connection.client.callTool({
          name: HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_READ_TOOL,
          arguments: { room_id: ROOM_ID, identity: fixture.identity },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({ error: denied.error });
        expect(connection.evidenceStore.put).not.toHaveBeenCalled();
      } finally {
        await connection.close();
      }
    }
    expect(reader).not.toHaveBeenCalled();

    const reconnected = await connect({
      principal: principal(scopes),
      enabled: true,
      reader,
      roomControlService: roomControl({ status: "active" }),
    });
    try {
      const result = await reconnected.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_PRESENCE_EVIDENCE_READ_TOOL,
        arguments: { room_id: ROOM_ID, identity: fixture.identity },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        room_evidence: {
          room_id: ROOM_ID,
          room_binding_active: true,
          execution_authority: false,
          mutation_authority: false,
          mining_authorized: false,
          terminal_eligible: false,
        },
      });
      expect(reader).toHaveBeenCalledTimes(1);
    } finally {
      await reconnected.close();
    }
  });
});
