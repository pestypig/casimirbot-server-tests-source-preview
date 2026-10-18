import { describe, expect, it } from "vitest";

// The operational installer is an ESM script shared with the local Fabric
// runbook, so it intentionally has no separate TypeScript declaration file.
// @ts-expect-error -- tested JavaScript module without declarations
import { rebaseHelixFabricCommandEndpoint } from "../../scripts/install-helix-fabric-room-config.mjs";

describe("local Fabric command configuration", () => {
  it("preserves the credential path while rebasing only to validated loopback", () => {
    expect(
      rebaseHelixFabricCommandEndpoint(
        "https://casimirbot.com/api/environment-command/v1/authorities/command_authority%3Aone",
        "http://127.0.0.1:1522",
      ),
    ).toBe(
      "http://127.0.0.1:1522/api/environment-command/v1/authorities/command_authority%3Aone",
    );
  });

  it("rejects a non-loopback override", () => {
    expect(() =>
      rebaseHelixFabricCommandEndpoint(
        "https://casimirbot.com/api/environment-command/v1/authorities/command_authority%3Aone",
        "https://example.com",
      ),
    ).toThrow("loopback HTTP origin");
  });
});
