import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENVIRONMENT_ACTION_CONNECTOR_RATE_LIMITS,
  isDedicatedEnvironmentConnectorApiPath,
} from "../rate-limit";

describe("dedicated environment connector rate-limit routing", () => {
  it("recognizes the mounted and absolute player-action connector paths", () => {
    expect(
      isDedicatedEnvironmentConnectorApiPath(
        "/environment-action/v1/authorities/environment_action_authority:one/heartbeat",
      ),
    ).toBe(true);
    expect(
      isDedicatedEnvironmentConnectorApiPath(
        "/api/environment-action/v1/authorities/environment_action_authority:one/requests/pending",
      ),
    ).toBe(true);
  });

  it("does not exempt browser, MCP, or unrelated environment routes", () => {
    expect(isDedicatedEnvironmentConnectorApiPath("/agi/ask")).toBe(false);
    expect(isDedicatedEnvironmentConnectorApiPath("/environment-command/v1/commands")).toBe(false);
    expect(isDedicatedEnvironmentConnectorApiPath("/environment-action/browser/control")).toBe(false);
  });

  it("keeps the authenticated connector allowance above its measured active cadence", () => {
    expect(DEFAULT_ENVIRONMENT_ACTION_CONNECTOR_RATE_LIMITS).toEqual({
      windowMs: 60_000,
      perIp: 3_600,
      perAuthority: 3_600,
    });
  });
});
