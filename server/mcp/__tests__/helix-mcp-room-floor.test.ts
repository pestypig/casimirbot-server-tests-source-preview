import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from
  "@shared/helix-account-session";
import {
  HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";
import type { SharedLiveRoomControlService } from
  "../../services/shared-live-room-control/service";
import { createHelixMcpServer } from "../helix-mcp-server";

const ROOM_ID = "shared_realtime_room:mcp-floor";
const FLOOR = {
  participant_id: "participant:profile-room-floor",
  epoch: 9,
  acquired_at: "2026-08-29T17:00:00.000Z",
  lease_expires_at: "2026-08-29T17:00:30.000Z",
};

const principal = (): HelixAgentApiPrincipal => ({
  tenantId: "tenant-room-floor",
  issuer: "https://issuer.example",
  subjectId: "subject-room-floor",
  accountProfileId: "profile-room-floor",
  accountType: "user",
  scopes: new Set([
    HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
    HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
  ]),
  tokenExpiresAt: "2099-01-01T00:00:00.000Z",
  accountContext: {
    session_id: "external-oauth:room-floor",
    profile_id: "profile-room-floor",
    trusted_account_session: true,
    account_session: null,
    account_policy: buildHelixSharedRealtimeRoomsExperimentPolicy("user"),
  },
});

const connections: Array<{
  client: Client;
  server: ReturnType<typeof createHelixMcpServer>;
}> = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map(async ({ client, server }) => {
    await client.close();
    await server.close();
  }));
});

describe("Helix MCP Shared Live Room speaking floor", () => {
  it("inspects the floor epoch before releasing only the caller's matching floor", async () => {
    const inspectFloor = vi.fn(async () => ({
      api_version: "v1" as const,
      ok: true as const,
      schema: "helix.shared_live_room.floor_inspect_receipt.v1" as const,
      operation: "room.floor.inspect" as const,
      content_role: "room_control_observation_not_assistant_answer" as const,
      room_id: ROOM_ID,
      floor: FLOOR,
      reentry_required: true as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
      raw_content_included: false as const,
    }));
    const releaseOwnFloor = vi.fn(async () => ({
      api_version: "v1" as const,
      ok: true as const,
      schema: "helix.shared_live_room.floor_release_receipt.v1" as const,
      operation: "room.floor.release" as const,
      content_role: "room_control_receipt_not_assistant_answer" as const,
      room: { room_id: ROOM_ID },
      released: true,
      requested_floor_epoch: FLOOR.epoch,
      floor: {
        participant_id: null,
        epoch: FLOOR.epoch,
        acquired_at: null,
        lease_expires_at: null,
      },
      authority_delta: "reduced_only" as const,
      reentry_required: true as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
      raw_content_included: false as const,
    }));
    const server = createHelixMcpServer({
      principal: principal(),
      roomControlService: {
        inspectFloor,
        releaseOwnFloor,
      } as unknown as SharedLiveRoomControlService,
    });
    const client = new Client(
      { name: "room-floor-test", version: "1.0.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    connections.push({ client, server });

    const catalog = await client.listTools();
    expect(catalog.tools.find((tool) => tool.name === "helix_room_floor_inspect")?.annotations)
      .toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(catalog.tools.find((tool) => tool.name === "helix_room_floor_release")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });

    const inspected = await client.callTool({
      name: "helix_room_floor_inspect",
      arguments: { room_id: ROOM_ID },
    });
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    expect(inspected.structuredContent).toMatchObject({
      operation: "room.floor.inspect",
      floor: { participant_id: FLOOR.participant_id, epoch: FLOOR.epoch },
      assistant_answer: false,
      terminal_eligible: false,
    });

    const released = await client.callTool({
      name: "helix_room_floor_release",
      arguments: {
        request: { room_id: ROOM_ID, floor_epoch: FLOOR.epoch },
      },
    });
    expect(released.isError, JSON.stringify(released)).not.toBe(true);
    expect(released.structuredContent).toMatchObject({
      operation: "room.floor.release",
      released: true,
      requested_floor_epoch: FLOOR.epoch,
      authority_delta: "reduced_only",
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(releaseOwnFloor).toHaveBeenCalledWith({
      actor: expect.objectContaining({ profileId: "profile-room-floor" }),
      request: { room_id: ROOM_ID, floor_epoch: FLOOR.epoch },
    });
  });
});
