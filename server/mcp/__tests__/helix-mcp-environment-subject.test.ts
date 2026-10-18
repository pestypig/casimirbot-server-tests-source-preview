import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from
  "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from
  "@shared/contracts/helix-shared-live-room-agent.v1";
import {
  HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE,
} from "@shared/helix-environment-action";
import type {
  HelixRoomEnvironmentProjection,
  HelixRoomEnvironmentSubjectBinding,
} from "@shared/helix-environment-subject";
import {
  createHelixMcpServer,
  type HelixEnvironmentSubjectMcpService,
} from "../helix-mcp-server";
import type { HelixAgentApiService } from
  "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";

const ROOM_ID = "shared_realtime_room:mcp-environment-subject";
const ENVIRONMENT_BINDING_ID = "environment_binding:mcp-environment-subject";
const SUBJECT_REF = "environment_subject:mcp-player";
const PROFILE_ID = "profile-mcp-environment-subject";
const NOW = "2026-08-23T16:00:00.000Z";

const principal = (scopes: readonly string[]): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  return {
    tenantId: "tenant-mcp-environment-subject",
    issuer: "https://issuer.example",
    subjectId: "subject-mcp-environment-subject",
    accountProfileId: PROFILE_ID,
    accountType: "developer",
    scopes: new Set(scopes),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:mcp-environment-subject",
      profile_id: PROFILE_ID,
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:mcp-environment-subject",
        profile: {
          profile_id: PROFILE_ID,
          display_name: "MCP Environment Subject",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject-mcp-environment-subject",
          picture_url: null,
          created_at: NOW,
          updated_at: NOW,
        },
        account_policy: policy,
        status: "active",
        memory_scope: "profile",
        created_at: NOW,
        updated_at: NOW,
        expires_at: "2099-01-01T00:00:00.000Z",
      },
      account_policy: policy,
    },
  };
};

const binding: HelixRoomEnvironmentSubjectBinding = {
  schema: "helix.room_environment_subject_binding.v1",
  subject_binding_id: "environment_subject_binding:mcp-player",
  room_id: ROOM_ID,
  participant_id: "shared_realtime_participant:mcp-self",
  environment_binding_id: ENVIRONMENT_BINDING_ID,
  room_source_binding_id: "room_source_binding:mcp-environment-subject",
  source_id: "source:mcp-environment-subject",
  world_id: "minecraft:local:mcp-environment-subject",
  subject_kind: "minecraft.player",
  subject_ref: SUBJECT_REF,
  subject_label: "MCP Player",
  verification_method: "self_claim",
  confidence: 1,
  status: "active",
  producer_epoch_ref: "environment_action_epoch:mcp-environment-subject",
  verified_at: NOW,
  last_confirmed_at: NOW,
  expires_at: null,
  revoked_at: null,
  content_role: "environment_subject_identity_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const environment: HelixRoomEnvironmentProjection = {
  schema: "helix.room_environment_projection.v1",
  environment_binding_id: ENVIRONMENT_BINDING_ID,
  room_source_binding_id: "room_source_binding:mcp-environment-subject",
  room_id: ROOM_ID,
  source_id: "source:mcp-environment-subject",
  world_id: "minecraft:local:mcp-environment-subject",
  domain: "game.minecraft",
  domain_adapter: "minecraft.fabric_mod.v1",
  source_label: "Local Fabric source",
  connection_status: "active",
  latest_observed_at: NOW,
  capability_ids: ["minecraft.actor.status.read.v1"],
  subject_directory: {
    schema: "helix.environment_subject_directory.v1",
    environment_binding_id: ENVIRONMENT_BINDING_ID,
    room_source_binding_id: "room_source_binding:mcp-environment-subject",
    room_id: ROOM_ID,
    source_id: "source:mcp-environment-subject",
    world_id: "minecraft:local:mcp-environment-subject",
    subject_kind: "minecraft.player",
    observed_at: NOW,
    freshness: "fresh",
    subjects: [{
      subject_ref: SUBJECT_REF,
      subject_kind: "minecraft.player",
      display_label: "MCP Player",
      presence: "online",
      claimed_by_participant_id: null,
      observed_at: NOW,
      freshness: "fresh",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    }],
    content_role: "environment_subject_directory_not_assistant_answer",
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  },
  self_subject_binding: null,
  identity_assignment: "reverification_required",
  owner_controls_visible: true,
  content_role: "room_environment_projection_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const connect = async (input: {
  scopes: readonly string[];
  environmentSubjectService: HelixEnvironmentSubjectMcpService;
}) => {
  const server = createHelixMcpServer({
    principal: principal(input.scopes),
    service: {} as HelixAgentApiService,
    environmentSubjectService: input.environmentSubjectService,
  });
  const client = new Client(
    { name: "helix-environment-subject-mcp-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

describe("Helix MCP environment subject self-service boundary", () => {
  it("lists sanitized subjects and re-verifies only the authenticated member", async () => {
    const list = vi.fn(async () => [environment]);
    const select = vi.fn(async () => binding);
    const connection = await connect({
      scopes: [
        HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
        HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE,
      ],
      environmentSubjectService: { list, select },
    });
    try {
      const catalog = await connection.client.listTools();
      const listTool = catalog.tools.find(
        (candidate) => candidate.name === "helix_environment_subject_list",
      );
      const selectTool = catalog.tools.find(
        (candidate) => candidate.name === "helix_environment_subject_select",
      );
      expect(listTool?.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
      });
      expect(selectTool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });

      const listed = await connection.client.callTool({
        name: "helix_environment_subject_list",
        arguments: { room_id: ROOM_ID },
      });
      expect(listed.isError, JSON.stringify(listed)).not.toBe(true);
      expect(listed.structuredContent).toMatchObject({
        schema: "helix.room_environments.receipt.v1",
        environments: [{
          environment_binding_id: ENVIRONMENT_BINDING_ID,
          identity_assignment: "reverification_required",
          subject_directory: {
            subjects: [{ subject_ref: SUBJECT_REF, display_label: "MCP Player" }],
          },
        }],
        binding: null,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
      expect(list).toHaveBeenCalledWith({ roomId: ROOM_ID, profileId: PROFILE_ID });

      const selected = await connection.client.callTool({
        name: "helix_environment_subject_select",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: ENVIRONMENT_BINDING_ID,
          subject_ref: SUBJECT_REF,
        },
      });
      expect(selected.isError, JSON.stringify(selected)).not.toBe(true);
      expect(selected.structuredContent).toMatchObject({
        schema: "helix.room_environments.receipt.v1",
        binding: {
          subject_binding_id: binding.subject_binding_id,
          participant_id: binding.participant_id,
          subject_ref: SUBJECT_REF,
          verification_method: "self_claim",
        },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
      expect(select).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        profileId: PROFILE_ID,
        environmentBindingId: ENVIRONMENT_BINDING_ID,
        subjectRef: SUBJECT_REF,
      });

      const crossParticipant = await connection.client.callTool({
        name: "helix_environment_subject_select",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: ENVIRONMENT_BINDING_ID,
          subject_ref: SUBJECT_REF,
          participant_id: "shared_realtime_participant:someone-else",
        },
      });
      expect(crossParticipant.isError).toBe(true);
      expect(select).toHaveBeenCalledTimes(1);
    } finally {
      await connection.close();
    }
  });

  it("allows listing but rejects selection without environment write scope", async () => {
    const list = vi.fn(async () => [environment]);
    const select = vi.fn(async () => binding);
    const connection = await connect({
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
      environmentSubjectService: { list, select },
    });
    try {
      const listed = await connection.client.callTool({
        name: "helix_environment_subject_list",
        arguments: { room_id: ROOM_ID },
      });
      expect(listed.isError).not.toBe(true);

      const selected = await connection.client.callTool({
        name: "helix_environment_subject_select",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: ENVIRONMENT_BINDING_ID,
          subject_ref: SUBJECT_REF,
        },
      });
      expect(selected.isError).toBe(true);
      expect(selected.structuredContent).toMatchObject({
        error: "insufficient_scope",
      });
      expect(select).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });
});
