import { readFileSync } from "node:fs";
import path from "node:path";
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
  HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_SCHEMA,
  HELIX_MINECRAFT_COMPANION_ROOM_FOLLOW_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_ROOM_FOLLOW_EVIDENCE_SCHEMA,
  helixMinecraftCompanionFollowEvidenceSchema,
} from "@shared/helix-minecraft-companion-follow-mcp";
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
  type HelixMinecraftCompanionFollowEvidenceReader,
} from "../helix-mcp-server";

const PROFILE_ID = "profile:g2-a1-codex";
const ROOM_ID = "shared_realtime_room:companion-c1-b";
const PARTICIPANT_ID = "room_participant:companion-c1-b-owner";
const SCOPES = [
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
  HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
] as const;
const EVIDENCE = helixMinecraftCompanionFollowEvidenceSchema.parse(JSON.parse(
  readFileSync(path.resolve(
    process.cwd(),
    "artifacts/eh-mc-companion-survival-party-v1/A1/runtime/current-follow-evidence.json",
  ), "utf8"),
));

const principal = (
  accountType: "developer" | "user" = "developer",
  scopes: readonly string[] = SCOPES,
): HelixAgentApiPrincipal => ({
  tenantId: "tenant:companion-c1",
  issuer: "https://issuer.example",
  subjectId: "subject:companion-c1",
  accountProfileId: PROFILE_ID,
  accountType,
  scopes: new Set(scopes),
  tokenExpiresAt: "2099-01-01T00:00:00.000Z",
  accountContext: {
    session_id: "external-oauth:companion-c1",
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
  enabled: boolean;
  reader?: HelixMinecraftCompanionFollowEvidenceReader;
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
    privateCompanionFollowMcpEnabled: input.enabled,
    minecraftCompanionFollowEvidenceReader: input.reader,
    roomControlService: input.roomControlService,
    mcpEvidenceObservationStore: evidenceStore as never,
  });
  const client = new Client(
    { name: "helix-companion-c1-test", version: "1.0.0" },
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

describe("private authenticated MCP C1 companion follow evidence", () => {
  it("is feature-gated, developer-only, and scope-gated", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    for (const entry of [
      { enabled: false, principal: principal(), reader },
      { enabled: true, principal: principal(), reader: undefined },
      { enabled: true, principal: principal("user"), reader },
    ]) {
      const connection = await connect(entry);
      try {
        expect((await connection.client.listTools()).tools.map((tool) => tool.name))
          .not.toContain(HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_READ_TOOL);
      } finally { await connection.close(); }
    }
    const missingScope = await connect({
      principal: principal("developer", [HELIX_SHARED_LIVE_ROOM_READ_SCOPE]),
      enabled: true,
      reader,
    });
    try {
      const result = await missingScope.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_READ_TOOL,
        arguments: {
          identity: EVIDENCE.identity,
          controller_artifact_hash: EVIDENCE.controller_artifact_hash,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: "insufficient_scope" });
      expect(reader).not.toHaveBeenCalled();
    } finally { await missingScope.close(); }
  });

  it("re-enters exact A1 evidence and rejects a stale controller artifact", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    const connection = await connect({ enabled: true, reader });
    try {
      const catalog = await connection.client.listTools();
      expect(catalog.tools.find((tool) =>
        tool.name === HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_READ_TOOL
      )?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      const stale = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_READ_TOOL,
        arguments: {
          identity: EVIDENCE.identity,
          controller_artifact_hash:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({
        error: "companion_follow_identity_mismatch",
        retryable: true,
      });
      expect(connection.evidenceStore.put).not.toHaveBeenCalled();

      const result = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_READ_TOOL,
        arguments: {
          identity: EVIDENCE.identity,
          controller_artifact_hash: EVIDENCE.controller_artifact_hash,
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        evidence: {
          schema: HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_SCHEMA,
          identity: EVIDENCE.identity,
          game_test_passed: 22,
          codex_delay_continuity_proven: true,
          serialized_authority_proven: true,
          execution_authority: false,
          inventory_authority: false,
          mining_authorized: false,
          combat_authorized: false,
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
          payload_schema: HELIX_MINECRAFT_COMPANION_FOLLOW_EVIDENCE_SCHEMA,
          payload: { identity: EVIDENCE.identity, game_test_passed: 22 },
        },
        terminal_eligible: false,
        reentry_required: true,
      });
    } finally { await connection.close(); }
  });

  it("admits only the current room owner, revokes closed rooms, and reconnects inertly", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    for (const denied of [
      {
        service: roomControl({ status: "active", role: "participant" }),
        error: "companion_follow_room_owner_required",
      },
      {
        service: roomControl({ status: "closed" }),
        error: "companion_follow_room_revoked",
      },
      {
        service: {
          inspectRoom: vi.fn(async () => {
            throw new SharedLiveRoomControlError(404, "room_not_found", "missing");
          }),
        } as unknown as SharedLiveRoomControlService,
        error: "companion_follow_room_revoked",
      },
    ]) {
      const connection = await connect({
        enabled: true,
        reader,
        roomControlService: denied.service,
      });
      try {
        const result = await connection.client.callTool({
          name: HELIX_MINECRAFT_COMPANION_ROOM_FOLLOW_EVIDENCE_READ_TOOL,
          arguments: {
            room_id: ROOM_ID,
            identity: EVIDENCE.identity,
            controller_artifact_hash: EVIDENCE.controller_artifact_hash,
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
        name: HELIX_MINECRAFT_COMPANION_ROOM_FOLLOW_EVIDENCE_READ_TOOL,
        arguments: {
          room_id: ROOM_ID,
          identity: EVIDENCE.identity,
          controller_artifact_hash: EVIDENCE.controller_artifact_hash,
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        room_evidence: {
          schema: HELIX_MINECRAFT_COMPANION_ROOM_FOLLOW_EVIDENCE_SCHEMA,
          room_id: ROOM_ID,
          room_role: "owner",
          evidence: { identity: EVIDENCE.identity, game_test_passed: 22 },
          commands_executed: 0,
          environment_mutated: false,
          execution_authority: false,
          inventory_authority: false,
          mining_authorized: false,
          combat_authorized: false,
          answer_authority: false,
          terminal_eligible: false,
        },
      });
    } finally { await admitted.close(); }
  });
});
