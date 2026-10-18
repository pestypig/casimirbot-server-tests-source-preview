import { describe, expect, it } from "vitest";
import { HELIX_DESKTOP_MCP_ISSUER } from "../../../../auth/helix-desktop-mcp-identity";
import type { HelixAgentApiPrincipal } from "../../../helix-agent-api/types";
import { assertNativeRoomInterpreterPrincipal } from "../room-store/interpreter-mcp-lease";

describe("native room interpreter principal", () => {
  it("rejects a trusted-looking desktop principal without a current account session ID", async () => {
    const principal = {
      issuer: HELIX_DESKTOP_MCP_ISSUER,
      accountType: "developer",
      trustedDeveloperProfile: true,
      mcpClientRef: "desktop_mcp_client:test",
      accountProfileId: "profile:guard-owner",
      accountContext: {
        profile_id: "profile:guard-owner",
        session_id: null,
        trusted_account_session: true,
      },
    } as HelixAgentApiPrincipal;
    await expect(assertNativeRoomInterpreterPrincipal(principal))
      .rejects.toMatchObject({ statusCode: 401 });
  });
});
