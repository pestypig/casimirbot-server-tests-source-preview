import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { buildHelixSharedRealtimeRoomsExperimentPolicy } from "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_ACTION_READ_SCOPE } from "@shared/helix-environment-action";
import {
  HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_SCHEMA,
  HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL,
  HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_SCHEMA,
  helixMinecraftCompanionMiningEvidenceSchema,
} from "@shared/helix-minecraft-companion-mining-mcp";
import type { HelixMcpEvidenceObservation } from "@shared/contracts/helix-mcp-evidence-capability.v1";
import type { HelixAgentApiService } from "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import type { SharedLiveRoomControlService } from "../../services/shared-live-room-control/service";
import {
  createHelixMcpServer,
  type HelixMinecraftCompanionMiningEvidenceReader,
} from "../helix-mcp-server";

const PRIVATE_CONFIG = JSON.parse(readFileSync(path.resolve(
  process.cwd(),
  "artifacts/eh-mc-companion-survival-party-v1/A1/runtime/private-mining-mcp-config.json",
), "utf8")) as { authorized_account_profile_id: string };
const PROFILE_ID = PRIVATE_CONFIG.authorized_account_profile_id;
const ROOM_ID = "shared_realtime_room:companion-c3-b";
const PARTICIPANT_ID = "room_participant:companion-c3-owner";
const EVIDENCE = helixMinecraftCompanionMiningEvidenceSchema.parse(JSON.parse(
  readFileSync(path.resolve(
    process.cwd(),
    "artifacts/eh-mc-companion-survival-party-v1/A1/runtime/current-mining-evidence.json",
  ), "utf8"),
));
const SCOPES = [HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_READ_SCOPE] as const;

const principal = (accountType: "developer" | "user" = "developer"): HelixAgentApiPrincipal => ({
  tenantId: "tenant:companion-c3",
  issuer: "https://issuer.example",
  subjectId: "subject:companion-c3",
  accountProfileId: PROFILE_ID,
  accountType,
  scopes: new Set(SCOPES),
  tokenExpiresAt: "2099-01-01T00:00:00.000Z",
  accountContext: {
    session_id: "external-oauth:companion-c3",
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: null,
    account_policy: buildHelixSharedRealtimeRoomsExperimentPolicy(accountType),
  },
}) as HelixAgentApiPrincipal;

const roomControl = (role: "owner" | "participant", status: "active" | "closed" = "active") => ({
  inspectRoom: vi.fn(async () => ({
    room: {
      room_id: ROOM_ID,
      status,
      self_participant_id: PARTICIPANT_ID,
      participants: [{ participant_id: PARTICIPANT_ID, role, presence: "present" }],
    },
  })),
}) as unknown as SharedLiveRoomControlService;

const connect = async (input: {
  accountType?: "developer" | "user";
  enabled?: boolean;
  reader?: HelixMinecraftCompanionMiningEvidenceReader;
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
    principal: principal(input.accountType),
    service: {} as HelixAgentApiService,
    privateCompanionMiningMcpEnabled: input.enabled,
    minecraftCompanionMiningEvidenceReader: input.reader,
    roomControlService: input.roomControlService,
    mcpEvidenceObservationStore: evidenceStore as never,
  });
  const client = new Client({ name: "helix-c3-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, evidenceStore, close: async () => { await client.close(); await server.close(); } };
};

const exactArguments = () => ({
  identity: EVIDENCE.identity,
  controller_artifact_hash: EVIDENCE.controller_artifact_hash,
  custody_revision: EVIDENCE.custody_revision,
});

describe("private authenticated MCP C3 companion mining evidence", () => {
  it("admits the exact owner through the hash-pinned default runtime", async () => {
    const connection = await connect({ roomControlService: roomControl("owner") });
    try {
      const names = (await connection.client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain(HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_READ_TOOL);
      expect(names).toContain(HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL);
      const result = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_READ_TOOL,
        arguments: exactArguments(),
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        evidence: {
          controller_artifact_hash: EVIDENCE.controller_artifact_hash,
          custody_revision: EVIDENCE.custody_revision,
          zero_duplication_or_loss: true,
        },
      });
    } finally { await connection.close(); }
  });

  it("keeps injected C3 readers developer-only", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    const user = await connect({ accountType: "user", enabled: true, reader });
    try {
      const names = (await user.client.listTools()).tools.map((tool) => tool.name);
      expect(names).not.toContain(HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_READ_TOOL);
      expect(names).not.toContain(HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL);
    } finally { await user.close(); }
  });

  it("re-enters exact A1 evidence and rejects stale identity/revision", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    const connection = await connect({ enabled: true, reader });
    try {
      const stale = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_READ_TOOL,
        arguments: { ...exactArguments(), custody_revision: EVIDENCE.custody_revision + 1 },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({
        error: "companion_mining_identity_or_revision_mismatch", retryable: true,
      });
      const result = await connection.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_READ_TOOL,
        arguments: exactArguments(),
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        evidence: {
          schema: HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_SCHEMA,
          focused_game_test_passed: 7,
          atomic_block_drop_custody_settlement: true,
          zero_duplication_or_loss: true,
          execution_authority: false,
          mining_execution_authority: false,
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
        observation: {
          payload_schema: HELIX_MINECRAFT_COMPANION_MINING_EVIDENCE_SCHEMA,
          payload: { controller_artifact_hash: EVIDENCE.controller_artifact_hash },
        },
        terminal_eligible: false,
        reentry_required: true,
      });
    } finally { await connection.close(); }
  });

  it("admits only the current room owner, rejects stale reads, revokes in place, and reconnects", async () => {
    const reader = vi.fn(async () => EVIDENCE);
    const participant = await connect({
      enabled: true,
      reader,
      roomControlService: roomControl("participant"),
    });
    try {
      const denied = await participant.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL,
        arguments: { room_id: ROOM_ID, ...exactArguments() },
      });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({
        error: "companion_mining_room_owner_required",
      });
    } finally { await participant.close(); }

    let roomStatus: "active" | "closed" = "active";
    const statefulOwnerControl = {
      inspectRoom: vi.fn(async () => ({
        room: {
          room_id: ROOM_ID,
          status: roomStatus,
          self_participant_id: PARTICIPANT_ID,
          participants: [{ participant_id: PARTICIPANT_ID, role: "owner", presence: "present" }],
        },
      })),
    } as unknown as SharedLiveRoomControlService;
    const owner = await connect({
      enabled: true,
      reader,
      roomControlService: statefulOwnerControl,
    });
    try {
      const stale = await owner.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL,
        arguments: {
          room_id: ROOM_ID,
          ...exactArguments(),
          custody_revision: EVIDENCE.custody_revision + 1,
        },
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({
        error: "companion_mining_identity_or_revision_mismatch",
        retryable: true,
      });

      const admitted = await owner.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL,
        arguments: { room_id: ROOM_ID, ...exactArguments() },
      });
      expect(admitted.isError, JSON.stringify(admitted)).not.toBe(true);
      expect(admitted.structuredContent).toMatchObject({
        room_evidence: {
          schema: HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_SCHEMA,
          room_role: "owner",
          exact_identity_match: true,
          exact_revision_match: true,
          commands_executed: 0,
          environment_mutated: false,
          execution_authority: false,
          mining_execution_authority: false,
          world_authority: false,
          answer_authority: false,
          terminal_eligible: false,
        },
      });
      const observationRef = (admitted.structuredContent as {
        mcp_evidence: { observation_ref: string };
      }).mcp_evidence.observation_ref;
      const reentered = await owner.client.callTool({
        name: "helix_evidence_observation_get",
        arguments: { observation_ref: observationRef },
      });
      expect(reentered.structuredContent).toMatchObject({
        observation: {
          payload_schema: HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_SCHEMA,
          payload: {
            room_id: ROOM_ID,
            evidence: { controller_artifact_hash: EVIDENCE.controller_artifact_hash },
          },
        },
        terminal_eligible: false,
        reentry_required: true,
      });

      roomStatus = "closed";
      const revoked = await owner.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL,
        arguments: { room_id: ROOM_ID, ...exactArguments() },
      });
      expect(revoked.isError).toBe(true);
      expect(revoked.structuredContent).toMatchObject({
        error: "companion_mining_room_revoked",
        retryable: false,
      });
    } finally { await owner.close(); }

    const reconnected = await connect({
      enabled: true,
      reader,
      roomControlService: roomControl("owner"),
    });
    try {
      const result = await reconnected.client.callTool({
        name: HELIX_MINECRAFT_COMPANION_ROOM_MINING_EVIDENCE_READ_TOOL,
        arguments: { room_id: ROOM_ID, ...exactArguments() },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        room_evidence: {
          room_binding_active: true,
          exact_identity_match: true,
          exact_revision_match: true,
        },
      });
    } finally { await reconnected.close(); }
  });
});
