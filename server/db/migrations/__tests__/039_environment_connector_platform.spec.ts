import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration031 } from "../031_room_source_ingress";
import { migration038 } from "../038_environment_adapter_registry";
import { migration039 } from "../039_environment_connector_platform";

describe("migration039 environment connector platform", () => {
  it("keeps package, installation, device, binding, catalog, request, and lease identities separate", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_accounts (
          profile_id text PRIMARY KEY
        );
      `);
      await client.query(`
        CREATE TABLE helix_shared_realtime_rooms (
          room_id text PRIMARY KEY
        );
      `);
      await migration031.run(client, { enablePgvector: false });
      await migration038.run(client, { enablePgvector: false });
      await migration039.run(client, { enablePgvector: false });

      await client.query(
        `INSERT INTO helix_accounts (profile_id) VALUES ($1);`,
        ["profile:connector-owner"],
      );
      await client.query(
        `INSERT INTO helix_shared_realtime_rooms (room_id) VALUES ($1);`,
        ["shared_realtime_room:connector"],
      );
      await client.query(
        `
          INSERT INTO helix_room_source_bindings (
            binding_id, room_id, owner_profile_id, source_id, world_id,
            domain_adapter, source_label
          ) VALUES ($1, $2, $3, $4, $5, $6, $7);
        `,
        [
          "room_source_binding:connector",
          "shared_realtime_room:connector",
          "profile:connector-owner",
          "source:room-ingress:connector",
          "minecraft:connector",
          "minecraft.paper_plugin.v1",
          "Connector source",
        ],
      );
      await client.query(
        `
          INSERT INTO helix_room_source_credentials (
            credential_id, binding_id, token_hash, token_prefix, expires_at
          ) VALUES ($1, $2, $3, $4, now() + interval '1 hour');
        `,
        [
          "room_source_credential:connector",
          "room_source_binding:connector",
          "credential-hash",
          "credential-prefix",
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_adapter_admissions (
            admission_id, binding_id, credential_id, producer_epoch, room_id,
            source_id, world_id, domain_adapter, adapter_profile_id,
            adapter_profile_version, adapter_contract_hash, manifest_id,
            manifest_hash, source_family
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12, $13
          );
        `,
        [
          "environment_adapter_admission:connector",
          "room_source_binding:connector",
          "room_source_credential:connector",
          "producer-epoch",
          "shared_realtime_room:connector",
          "source:room-ingress:connector",
          "minecraft:connector",
          "minecraft.paper_plugin.v1",
          "game.minecraft.readonly.v1",
          `sha256:${"a".repeat(64)}`,
          "manifest:connector",
          `sha256:${"b".repeat(64)}`,
          "minecraft",
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_connector_packages (
            package_version_id, publisher_id, package_id, package_version,
            content_hash
          ) VALUES ($1, $2, $3, $4, $5);
        `,
        [
          "connector_package_version:minecraft:1",
          "publisher:casimirbot",
          "com.casimirbot.minecraft",
          "1.0.0",
          `sha256:${"c".repeat(64)}`,
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_connector_installations (
            installation_id, owner_profile_id, package_version_id,
            granted_capability_ids
          ) VALUES ($1, $2, $3, $4::jsonb);
        `,
        [
          "connector_installation:minecraft",
          "profile:connector-owner",
          "connector_package_version:minecraft:1",
          JSON.stringify(["com.casimirbot.minecraft.inventory.check"]),
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_connector_devices (
            device_id, installation_id, device_public_key_hash
          ) VALUES ($1, $2, $3);
        `,
        [
          "connector_device:minecraft",
          "connector_installation:minecraft",
          `sha256:${"d".repeat(64)}`,
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_connector_bindings (
            environment_binding_id, installation_id, device_id,
            room_source_binding_id, adapter_admission_id, owner_profile_id,
            room_id, source_id, world_id, consent_capability_ids
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);
        `,
        [
          "environment_binding:minecraft",
          "connector_installation:minecraft",
          "connector_device:minecraft",
          "room_source_binding:connector",
          "environment_adapter_admission:connector",
          "profile:connector-owner",
          "shared_realtime_room:connector",
          "source:room-ingress:connector",
          "minecraft:connector",
          JSON.stringify(["com.casimirbot.minecraft.inventory.check"]),
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_capability_catalog_snapshots (
            catalog_snapshot_id, environment_binding_id, catalog_hash,
            adapter_profile_id, adapter_profile_version,
            adapter_contract_hash, manifest_hash, capability_descriptors
          ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7::jsonb);
        `,
        [
          "environment_catalog_snapshot:minecraft",
          "environment_binding:minecraft",
          `sha256:${"e".repeat(64)}`,
          "game.minecraft.readonly.v1",
          `sha256:${"a".repeat(64)}`,
          `sha256:${"b".repeat(64)}`,
          JSON.stringify([
            { capability_id: "com.casimirbot.minecraft.inventory.check" },
          ]),
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_probe_requests (
            probe_request_id, tenant_id, owner_subject_id, owner_profile_id,
            run_id, turn_id, provider_execution_id, tool_call_id,
            catalog_snapshot_id, room_id, environment_binding_id, source_id,
            device_id, connector_installation_id, adapter_profile_id,
            adapter_profile_version, adapter_contract_hash, manifest_hash,
            producer_epoch_ref, capability_id, capability_version,
            input_schema_hash, output_schema_hash, arguments, arguments_hash,
            idempotency_key, freshness_requirement_ms, deadline_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, 1, $16, $17, $18, $19, 1, $20, $21, $22::jsonb, $23, $24,
            5000, now() + interval '10 seconds'
          );
        `,
        [
          "environment_probe_request:connector",
          "tenant:connector",
          "subject:connector",
          "profile:connector-owner",
          "run:connector",
          "turn:connector",
          "provider_execution:connector",
          "tool_call:connector",
          "environment_catalog_snapshot:minecraft",
          "shared_realtime_room:connector",
          "environment_binding:minecraft",
          "source:room-ingress:connector",
          "connector_device:minecraft",
          "connector_installation:minecraft",
          "game.minecraft.readonly.v1",
          `sha256:${"a".repeat(64)}`,
          `sha256:${"b".repeat(64)}`,
          "adapter_epoch:connector",
          "com.casimirbot.minecraft.inventory.check",
          `sha256:${"f".repeat(64)}`,
          `sha256:${"1".repeat(64)}`,
          JSON.stringify({ target: "current_actor" }),
          `sha256:${"2".repeat(64)}`,
          "idempotency:connector",
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_probe_attempts (
            probe_attempt_id, probe_request_id, attempt_number,
            leased_device_id, lease_token_hash, lease_expires_at
          ) VALUES ($1, $2, 1, $3, $4, now() + interval '5 seconds');
        `,
        [
          "environment_probe_attempt:connector:1",
          "environment_probe_request:connector",
          "connector_device:minecraft",
          `sha256:${"3".repeat(64)}`,
        ],
      );

      const { rows } = (await client.query(`
          SELECT
            r.status AS request_status,
            a.status AS attempt_status,
            r.capability_id
          FROM helix_environment_probe_requests r
          JOIN helix_environment_probe_attempts a
            ON a.probe_request_id = r.probe_request_id;
        `)) as {
        rows: Array<{
          request_status: string;
          attempt_status: string;
          capability_id: string;
        }>;
      };
      expect(rows[0]).toEqual({
        request_status: "pending",
        attempt_status: "leased",
        capability_id: "com.casimirbot.minecraft.inventory.check",
      });
    } finally {
      client.release();
      await pool.end();
    }
  });
});
