import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHelixAccountCapabilityPolicy,
  buildHelixSharedRealtimeRoomsExperimentPolicy,
  type HelixAccountType,
} from
  "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from
  "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_DEVICE_CHECK_LIST_SCHEMA } from
  "@shared/helix-environment-device-check";
import { helixMcpEvidenceObservationSchema } from
  "@shared/contracts/helix-mcp-evidence-capability.v1";
import {
  createHelixDeviceCheckMcpServer,
  HELIX_DEVICE_CHECK_RESOURCE_METADATA_PATH,
  type HelixEnvironmentDeviceCheckServicePort,
} from "../helix-mcp-server";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";
import type { HelixMcpEvidenceObservation } from
  "@shared/contracts/helix-mcp-evidence-capability.v1";
import { HelixMcpEvidenceObservationStoreError } from
  "../../services/mcp-evidence/observation-store";

const principal = (
  scopes: readonly string[],
  accountType: HelixAccountType = "developer",
): HelixAgentApiPrincipal => ({
  tenantId: "tenant-device-check",
  issuer: "https://issuer.example",
  subjectId: "subject-device-check",
  accountProfileId: "profile-device-check",
  accountType,
  scopes: new Set(scopes),
  tokenExpiresAt: "2099-01-01T00:00:00.000Z",
  accountContext: {
    session_id: "external-oauth:device-check",
    profile_id: "profile-device-check",
    trusted_account_session: true,
    account_session: null,
    account_policy: accountType === "developer"
      ? buildHelixSharedRealtimeRoomsExperimentPolicy("developer")
      : buildHelixAccountCapabilityPolicy("user"),
  },
});

const createConnectedClient = async (input: {
  scopes: readonly string[];
  deviceCheckService: HelixEnvironmentDeviceCheckServicePort;
  accountType?: HelixAccountType;
}) => {
  const observations = new Map<string, HelixMcpEvidenceObservation>();
  const server = createHelixDeviceCheckMcpServer({
    principal: principal(input.scopes, input.accountType),
    deviceCheckService: input.deviceCheckService,
    mcpEvidenceObservationStore: {
      put: async ({ observation }: { observation: HelixMcpEvidenceObservation }) => {
        observations.set(observation.observation_ref, observation);
      },
      get: async ({ observationRef }: { observationRef: string }) => {
        const observation = observations.get(observationRef);
        if (!observation) throw new HelixMcpEvidenceObservationStoreError(
          "observation_not_found", "The MCP evidence observation does not exist.",
        );
        return observation;
      },
    },
  });
  const client = new Client(
    { name: "casimirbot-device-check-test", version: "1.0.0" },
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

const emptyObservation = () => ({
  schema: HELIX_ENVIRONMENT_DEVICE_CHECK_LIST_SCHEMA,
  generated_at: "2026-08-11T20:00:00.000Z",
  devices: [],
  content_role: "device_health_observations_not_assistant_answer" as const,
  credential_included: false as const,
  answer_authority: false as const,
  assistant_answer: false as const,
  terminal_eligible: false as const,
  raw_content_included: false as const,
});

const originalPublicBaseUrl = process.env.CASIMIR_PUBLIC_BASE_URL;
const ROOM_ID = "shared_realtime_room:mcp-device-check";

afterEach(() => {
  if (originalPublicBaseUrl === undefined) {
    delete process.env.CASIMIR_PUBLIC_BASE_URL;
  } else {
    process.env.CASIMIR_PUBLIC_BASE_URL = originalPublicBaseUrl;
  }
  vi.restoreAllMocks();
});

describe("Helix MCP Device Check boundary", () => {
  it("publishes Device Check and the public UI catalog as read-only observations", async () => {
    const deviceCheckService = vi.fn(async () => emptyObservation());
    const connection = await createConnectedClient({
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
      deviceCheckService,
    });
    try {
      const catalog = await connection.client.listTools();
      expect(catalog.tools.map((candidate) => candidate.name)).toEqual([
        "helix_environment_device_check",
        "helix_public_ui_catalog",
        "helix_evidence_observation_get",
      ]);
      const tool = catalog.tools.find(
        (candidate) => candidate.name === "helix_environment_device_check",
      ) as (typeof catalog.tools)[number] & {
        _meta?: Record<string, unknown>;
      };
      expect(tool).toBeDefined();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool._meta?.securitySchemes).toEqual([
        {
          type: "oauth2",
          scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
        },
      ]);

      const result = await connection.client.callTool({
        name: "helix_environment_device_check",
        arguments: { room_id: ROOM_ID },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject(emptyObservation());
      expect(result.structuredContent).toMatchObject({
        credential_included: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
      const evidence = helixMcpEvidenceObservationSchema.parse(
        (result.structuredContent as Record<string, unknown>).mcp_evidence,
      );
      const {
        mcp_evidence: _mcpEvidence,
        ...legacyDeviceCheckPayload
      } = result.structuredContent as Record<string, unknown>;
      expect(evidence.payload).toEqual(legacyDeviceCheckPayload);
      expect(evidence).toMatchObject({
        capability_id: "helix.environment.device_check.inspect",
        handler_id: "helix.environment.device_check.handler",
        payload_schema: HELIX_ENVIRONMENT_DEVICE_CHECK_LIST_SCHEMA,
        payload: emptyObservation(),
        freshness: { state: "fresh", age_ms: 0 },
        retention: { class: "profile_durable", retrieval_allowed: true },
        authority: {
          assistant_answer: false,
          answer_authority: false,
          agent_executable: false,
          terminal_eligible: false,
          raw_content_included: false,
          reentry_required: true,
        },
      });
      expect(deviceCheckService).toHaveBeenCalledWith({
        ownerProfileId: "profile-device-check",
        roomId: ROOM_ID,
      });

      const publicUiTool = catalog.tools.find(
        (candidate) => candidate.name === "helix_public_ui_catalog",
      ) as (typeof catalog.tools)[number] & {
        _meta?: Record<string, unknown>;
      };
      expect(publicUiTool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(publicUiTool._meta?.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
      }]);
      const publicUiResult = await connection.client.callTool({
        name: "helix_public_ui_catalog",
        arguments: { surface_id: "helix.ask", include_capabilities: false },
      });
      expect(publicUiResult.isError, JSON.stringify(publicUiResult)).not.toBe(true);
      expect(publicUiResult.structuredContent).toMatchObject({
        schema: "helix.public_ui_agent_catalog.v1",
        account_type: "user",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        query: {
          surface_id: "helix.ask",
          include_capabilities: false,
        },
        totals: {
          matched_surface_count: 1,
          matched_capability_count: 0,
        },
      });
    } finally {
      await connection.close();
    }
  });

  it("fails with a scope challenge before reading device state", async () => {
    process.env.CASIMIR_PUBLIC_BASE_URL = "https://agent.example";
    const deviceCheckService = vi.fn(async () => emptyObservation());
    const connection = await createConnectedClient({
      scopes: [],
      deviceCheckService,
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_device_check",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: "insufficient_scope",
      });
      const meta = (result as { _meta?: Record<string, unknown> })._meta;
      const challenges = meta?.["mcp/www_authenticate"] as string[];
      expect(challenges).toHaveLength(1);
      expect(challenges[0]).toContain(
        `resource_metadata="https://agent.example${HELIX_DEVICE_CHECK_RESOURCE_METADATA_PATH}"`,
      );
      expect(challenges[0]).toContain(
        `scope="${HELIX_SHARED_LIVE_ROOM_READ_SCOPE}"`,
      );
      expect(deviceCheckService).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("allows an owner-scoped user Device Check without unlocking Shared Live Rooms", async () => {
    const deviceCheckService = vi.fn(async () => emptyObservation());
    const connection = await createConnectedClient({
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
      deviceCheckService,
      accountType: "user",
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_device_check",
        arguments: {},
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject(emptyObservation());
      expect(
        helixMcpEvidenceObservationSchema.parse(
          (result.structuredContent as Record<string, unknown>).mcp_evidence,
        ).subject_refs,
      ).toContain("account-profile:profile-device-check");
      expect(deviceCheckService).toHaveBeenCalledWith({
        ownerProfileId: "profile-device-check",
        roomId: undefined,
      });
      expect(principal(
        [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
        "user",
      ).accountContext.account_policy.locked_features).toContain(
        "shared_realtime_rooms",
      );
    } finally {
      await connection.close();
    }
  });

  it("uses the Device Check resource challenge for a catalog request without scope", async () => {
    process.env.CASIMIR_PUBLIC_BASE_URL = "https://agent.example";
    const connection = await createConnectedClient({
      scopes: [],
      deviceCheckService: vi.fn(async () => emptyObservation()),
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_public_ui_catalog",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("insufficient_scope");
      const challenges = (result as { _meta?: Record<string, unknown> })
        ._meta?.["mcp/www_authenticate"] as string[];
      expect(challenges).toHaveLength(1);
      expect(challenges[0]).toContain(
        `resource_metadata="https://agent.example${HELIX_DEVICE_CHECK_RESOURCE_METADATA_PATH}"`,
      );
      expect(challenges[0]).toContain(
        `scope="${HELIX_SHARED_LIVE_ROOM_READ_SCOPE}"`,
      );
    } finally {
      await connection.close();
    }
  });
});
