import { describe, expect, it, vi } from "vitest";
import {
  createConnectorPairingIdentity,
  HelixEnvironmentConnectorClient,
} from "../../../../../connectors/environment/sdk/typescript";

const DEVICE_CREDENTIAL =
  "helix_env_device_test_credential_abcdefghijklmnopqrstuvwxyz";

describe("environment connector TypeScript pairing client", () => {
  it("retains the device credential privately and returns only a nonsecret claim receipt", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/pairing/claim")) {
        return Response.json({
          device_id: "connector_device:test",
          installation_id: "connector_installation:test",
          environment_binding_id: "environment_binding:test",
          catalog_snapshot: {
            catalog_snapshot_id: "environment_catalog_snapshot:test",
          },
          device_credential: DEVICE_CREDENTIAL,
          device_credential_expires_at: "2026-07-29T00:00:00.000Z",
          scopes: ["probe.poll", "probe.result", "health.write"],
        });
      }
      if (url.endsWith("/device/heartbeat")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${DEVICE_CREDENTIAL}`,
        );
        return Response.json({
          health: "online",
          command_execution: "command_execution_not_enabled",
        });
      }
      throw new Error(`unexpected_test_url:${url}`);
    });
    const client = new HelixEnvironmentConnectorClient(
      "https://helix.example.test",
      fetchImpl as typeof fetch,
    );
    const identity = createConnectorPairingIdentity();
    const receipt = await client.claimPairing({
      pairingSessionId: "environment_pairing:test",
      claimChallenge:
        "claim_challenge_abcdefghijklmnopqrstuvwxyz0123456789",
      identity,
    });

    expect(receipt).toEqual({
      deviceId: "connector_device:test",
      installationId: "connector_installation:test",
      environmentBindingId: "environment_binding:test",
      catalogSnapshotId: "environment_catalog_snapshot:test",
      deviceCredentialExpiresAt: "2026-07-29T00:00:00.000Z",
      scopes: ["probe.poll", "probe.result", "health.write"],
    });
    expect(JSON.stringify(receipt)).not.toContain(DEVICE_CREDENTIAL);
    await expect(client.heartbeat()).resolves.toEqual({
      health: "online",
      commandExecution: "command_execution_not_enabled",
    });
  });
});
