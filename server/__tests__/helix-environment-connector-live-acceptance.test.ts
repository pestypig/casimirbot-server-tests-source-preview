import { describe, expect, it, vi } from "vitest";
import {
  HELIX_ENVIRONMENT_CONNECTOR_LIVE_ACCEPTANCE_SCHEMA,
  runEnvironmentConnectorLiveAcceptance,
} from "../../scripts/helix-environment-connector-live-acceptance";

const jsonResponse = (
  body: unknown,
  input: { status?: number; headers?: Record<string, string> } = {},
): Response =>
  new Response(JSON.stringify(body), {
    status: input.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(input.headers ?? {}),
    },
  });

describe("environment connector live acceptance harness", () => {
  it("is a zero-network dry run unless both mutation opt-ins are explicit", async () => {
    const fetchImpl = vi.fn();
    const report = await runEnvironmentConnectorLiveAcceptance({
      env: {
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_BASE_URL:
          "http://127.0.0.1:1522",
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ALLOW_LOOPBACK_HTTP: "1",
      },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    });

    expect(report).toMatchObject({
      schema: HELIX_ENVIRONMENT_CONNECTOR_LIVE_ACCEPTANCE_SCHEMA,
      status: "partial",
      configuration: {
        network_enabled: false,
        mutation_enabled: false,
      },
      security: {
        source_credential_persisted: false,
        device_credential_persisted: false,
        credential_values_reported: false,
        command_execution: "command_execution_not_enabled",
      },
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "live_mutation_opt_in",
        status: "skipped",
        reason_code: "acceptance_live_mutation_not_enabled",
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toMatch(
      /helix_(?:room_src|env_device)_/u,
    );
  });

  it("rejects non-loopback plain HTTP before any request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      runEnvironmentConnectorLiveAcceptance({
        env: {
          HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_BASE_URL:
            "http://example.test",
          HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_NETWORK: "1",
          HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ALLOW_MUTATION: "1",
          HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ALLOW_LOOPBACK_HTTP: "1",
        },
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("acceptance_target_transport_invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports only OAuth readiness while keeping a supplied token out of dry-run output", async () => {
    const fetchImpl = vi.fn();
    const token = "acceptance-token-that-must-never-be-reported";
    const report = await runEnvironmentConnectorLiveAcceptance({
      env: {
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_BASE_URL:
          "http://127.0.0.1:1522",
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ALLOW_LOOPBACK_HTTP: "1",
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ACCESS_TOKEN: token,
      },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-07-28T00:00:00.000Z"),
    });

    expect(report.configuration.agent_api_access_configured).toBe(true);
    expect(report.security.credential_values_reported).toBe(false);
    expect(JSON.stringify(report)).not.toContain(token);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("services an authenticated Agent API probe lease before accepting evidence re-entry and terminal completion", async () => {
    const token = "acceptance-oauth-token-that-must-stay-memory-only";
    const capabilityId = "com.casimirbot.minecraft.inventory.check";
    let continuationStarted = false;
    let continuationResolved = false;
    let resolveContinuation:
      | ((response: Response) => void)
      | null = null;
    const fetchImpl = vi.fn(
      async (
        input: string | URL | Request,
        init: RequestInit = {},
      ): Promise<Response> => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        const method = String(init.method ?? "GET").toUpperCase();
        const path = url.pathname;

        if (path === "/api/account/session/sign-in") {
          return jsonResponse(
            { ok: true },
            {
              headers: {
                "set-cookie": "helix_session=session-acceptance; Path=/",
              },
            },
          );
        }
        if (path === "/api/agi/realtime/rooms" && method === "POST") {
          return jsonResponse({
            room: { room_id: "room_environment_acceptance" },
          });
        }
        if (
          path ===
          "/api/agi/realtime/rooms/room_environment_acceptance/source-bindings"
        ) {
          return jsonResponse({
            binding: {
              binding_id: "binding_environment_acceptance",
              source_id: "source_environment_acceptance",
              world_id: "minecraft:acceptance:test",
              domain_adapter: "minecraft.paper_plugin.v1",
            },
            credential_delivery: {
              claim_handle: "claim_environment_acceptance",
              bearer_included: false,
              plugin_config_included: false,
            },
          });
        }
        if (
          path ===
          "/api/agi/realtime/room-source-credential-deliveries/claim"
        ) {
          return jsonResponse({
            token_value:
              "helix_room_src_acceptance_memory_only_1234567890",
            token_value_shown_once: true,
            secret_stored_raw: false,
          });
        }
        if (
          path ===
          "/api/room-ingress/v1/bindings/binding_environment_acceptance/manifest"
        ) {
          return jsonResponse({
            observation_ref: {
              audit_ok: true,
              adapter_admission: {
                adapter_profile_id: "game.minecraft.readonly.v1",
              },
            },
          });
        }
        if (
          path ===
          "/api/room-ingress/v1/bindings/binding_environment_acceptance/heartbeat"
        ) {
          return jsonResponse({
            observation_ref: { status: "active" },
          });
        }
        if (
          path === "/api/environment-connectors/v1/pairing/start"
        ) {
          return jsonResponse({
            schema: "helix.environment_connector.pairing_session.v1",
            pairing_session_id: "pairing_session:acceptance",
            verification_uri:
              "http://127.0.0.1:1522/environment-connectors/pair",
            user_code: "PAIRTEST",
            expires_at: "2026-07-28T01:00:00.000Z",
            interval_seconds: 2,
            status: "pending",
            requested_capability_ids: [capabilityId],
            credential_included: false,
            assistant_answer: false,
            raw_content_included: false,
            claim_challenge:
              "claim-challenge-acceptance-abcdefghijklmnopqrstuvwxyz",
          });
        }
        if (
          path ===
          "/api/agi/environment-connectors/pairing/approve"
        ) {
          return jsonResponse({ ok: true });
        }
        if (
          path === "/api/environment-connectors/v1/pairing/claim"
        ) {
          return jsonResponse({
            device_credential:
              "helix_env_device_acceptance_memory_only_1234567890",
            device_id: "connector_device:acceptance",
            installation_id: "connector_installation:acceptance",
            environment_binding_id:
              "environment_binding:acceptance",
            device_credential_expires_at:
              "2026-07-29T00:00:00.000Z",
            scopes: [capabilityId],
            catalog_snapshot: {
              catalog_snapshot_id: "catalog_snapshot:acceptance",
            },
          });
        }
        if (
          path ===
          "/api/environment-connectors/v1/device/heartbeat"
        ) {
          return jsonResponse({
            health: "online",
            command_execution: "command_execution_not_enabled",
          });
        }
        if (
          path ===
            "/api/agi/realtime/rooms/room_environment_acceptance/environments" &&
          method === "GET"
        ) {
          return jsonResponse({
            environments: [
              {
                environment_binding_id: "environment_binding:acceptance",
                room_source_binding_id: "binding_environment_acceptance",
                subject_directory: {
                  subjects: [
                    {
                      subject_ref: "environment_subject:acceptance",
                      display_label: "AcceptancePlayer",
                    },
                  ],
                },
              },
            ],
          });
        }
        if (
          path ===
            "/api/agi/realtime/rooms/room_environment_acceptance/environments/environment_binding%3Aacceptance/me" &&
          method === "PUT"
        ) {
          return jsonResponse({
            binding: {
              subject_kind: "minecraft.player",
              subject_label: "AcceptancePlayer",
              verification_method: "self_claim",
            },
          });
        }
        if (
          path ===
          "/api/environment-connectors/v1/device/probes/pending"
        ) {
          if (!continuationStarted) {
            return jsonResponse({ leases: [] });
          }
          return jsonResponse({
            leases: [
              {
                schema: "helix.environment_connector.probe_lease.v1",
                probe_attempt_id: "probe_attempt:acceptance",
                lease_token:
                  "helix_probe_lease_acceptance_12345678901234567890",
                lease_expires_at: "2026-07-28T00:01:00.000Z",
                capability_id: capabilityId,
                capability_version: 1,
                catalog_snapshot_id: "catalog_snapshot:acceptance",
                capability_request: {
                  schema:
                    "helix.environment_connector.probe_request.v1",
                  probe_request_id: "probe_request:acceptance",
                  capability_id: capabilityId,
                  capability_version: 1,
                  catalog_snapshot_id: "catalog_snapshot:acceptance",
                  arguments: {
                    target: "current_actor",
                    freshness_requirement_ms: 5_000,
                  },
                  constraints: {
                    read_only: true,
                    side_effects_allowed: false,
                    max_duration_ms: 15_000,
                  },
                  created_at: "2026-07-28T00:00:00.000Z",
                  deadline_at: "2026-07-28T00:01:00.000Z",
                  assistant_answer: false,
                  raw_content_included: false,
                },
                request: null,
              },
            ],
          });
        }
        if (
          path ===
          "/api/environment-connectors/v1/device/probes/result"
        ) {
          continuationResolved = true;
          resolveContinuation?.(
            jsonResponse({
              run_id: "run_environment_acceptance",
              version: 2,
              lifecycle_status: "completed",
              completion_status: "completed",
              terminal_authority_status: "authorized",
              evidence: {
                observation_refs: [
                  "environment_probe_observation:acceptance",
                ],
              },
            }),
          );
          return jsonResponse({ ok: true });
        }
        if (
          path ===
          "/.well-known/oauth-protected-resource/api/v1/agent-runs"
        ) {
          return jsonResponse({
            resource: "http://127.0.0.1:1522",
            authorization_servers: ["https://issuer.example"],
          });
        }
        if (path === "/api/v1/agent-runs" && method === "POST") {
          return jsonResponse(
            {
              run_id: "run_environment_acceptance",
              version: 1,
            },
            { status: 201 },
          );
        }
        if (
          path === "/api/v1/rooms/run-bindings" &&
          method === "POST"
        ) {
          return jsonResponse({
            binding_ref: "run-room-binding:acceptance",
          });
        }
        if (
          path ===
          "/api/v1/agent-runs/run_environment_acceptance/continue"
        ) {
          continuationStarted = true;
          return new Promise<Response>((resolve) => {
            resolveContinuation = resolve;
          });
        }
        if (
          path ===
          "/api/v1/agent-runs/run_environment_acceptance/events"
        ) {
          return jsonResponse({
            events: [
              { event_type: "evidence_reentered" },
              { event_type: "terminal_authority_evaluated" },
              { event_type: "run_completed" },
            ],
          });
        }
        if (
          path ===
            "/api/v1/rooms/run-bindings/run-room-binding%3Aacceptance" &&
          method === "DELETE"
        ) {
          return jsonResponse({ revocation_status: "revoked" });
        }
        if (
          path ===
            "/api/v1/agent-runs/run_environment_acceptance" &&
          method === "GET"
        ) {
          return jsonResponse({
            run_id: "run_environment_acceptance",
            version: 2,
            lifecycle_status: "completed",
          });
        }
        if (
          path ===
            "/api/agi/environment-connectors/devices/connector_device%3Aacceptance" &&
          method === "DELETE"
        ) {
          return jsonResponse({ ok: true });
        }
        if (
          path ===
          "/api/agi/realtime/rooms/room_environment_acceptance/source-bindings/binding_environment_acceptance/revoke"
        ) {
          return jsonResponse({ ok: true });
        }
        if (
          path ===
          "/api/agi/realtime/rooms/room_environment_acceptance/leave"
        ) {
          return jsonResponse({ ok: true });
        }
        if (path === "/api/account/session/sign-out") {
          return jsonResponse({ ok: true });
        }
        throw new Error(`unexpected_acceptance_request:${method}:${path}`);
      },
    );

    const report = await runEnvironmentConnectorLiveAcceptance({
      env: {
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_BASE_URL:
          "http://127.0.0.1:1522",
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_NETWORK: "1",
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ALLOW_MUTATION: "1",
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ALLOW_LOOPBACK_HTTP: "1",
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_ACCESS_TOKEN: token,
        HELIX_ENVIRONMENT_CONNECTOR_ACCEPTANCE_TIMEOUT_MS: "1000",
      },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-07-28T00:00:00.000Z"),
      randomId: () => "acceptance-random-id",
    });

    expect(continuationStarted).toBe(true);
    expect(continuationResolved).toBe(true);
    expect(report.status).toBe("pass");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "room_environment_subject_binding",
        status: "pass",
        evidence: expect.objectContaining({
          subject_kind: "minecraft.player",
          subject_label: "AcceptancePlayer",
          verification_method: "self_claim",
          raw_native_identity_reported: false,
        }),
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "agent_api_environment_probe",
        status: "pass",
        evidence: expect.objectContaining({
          evidence_reentered: true,
          terminal_authority_status: "authorized",
          command_execution: "command_execution_not_enabled",
        }),
      }),
    );
    expect(report.cleanup).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "agent_run_room_binding_revoke",
          status: "pass",
        }),
        expect.objectContaining({
          id: "agent_run_cleanup",
          status: "pass",
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain(token);
    expect(JSON.stringify(report)).not.toMatch(
      /helix_(?:room_src|env_device|probe_lease)_/u,
    );
  });
});
