import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration031 } from "../031_room_source_ingress";
import { migration038 } from "../038_environment_adapter_registry";

describe("migration038 environment adapter admissions", () => {
  it("persists exact binding, credential, producer, profile, manifest, and mechanics identity", async () => {
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

      await client.query(
        `INSERT INTO helix_accounts (profile_id) VALUES ($1);`,
        ["profile:adapter-owner"],
      );
      await client.query(
        `INSERT INTO helix_shared_realtime_rooms (room_id) VALUES ($1);`,
        ["shared_realtime_room:adapter"],
      );
      await client.query(
        `
          INSERT INTO helix_room_source_bindings (
            binding_id,
            room_id,
            owner_profile_id,
            source_id,
            world_id,
            domain_adapter,
            source_label
          ) VALUES ($1, $2, $3, $4, $5, $6, $7);
        `,
        [
          "room_source_binding:adapter",
          "shared_realtime_room:adapter",
          "profile:adapter-owner",
          "source:room-ingress:adapter",
          "minecraft:minehut:adapter",
          "minecraft.paper_plugin.v1",
          "Adapter source",
        ],
      );
      await client.query(
        `
          INSERT INTO helix_room_source_credentials (
            credential_id,
            binding_id,
            token_hash,
            token_prefix,
            expires_at
          ) VALUES ($1, $2, $3, $4, now() + interval '1 hour');
        `,
        [
          "room_source_credential:adapter",
          "room_source_binding:adapter",
          "token-hash",
          "token-prefix",
        ],
      );
      await client.query(
        `
          INSERT INTO helix_environment_adapter_admissions (
            admission_id,
            binding_id,
            credential_id,
            producer_epoch,
            room_id,
            source_id,
            world_id,
            domain_adapter,
            adapter_profile_id,
            adapter_profile_version,
            adapter_contract_hash,
            manifest_id,
            manifest_hash,
            source_family,
            mechanics_collection_ids
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15::jsonb
          );
        `,
        [
          "environment_adapter_admission:adapter",
          "room_source_binding:adapter",
          "room_source_credential:adapter",
          "producer-epoch-adapter",
          "shared_realtime_room:adapter",
          "source:room-ingress:adapter",
          "minecraft:minehut:adapter",
          "minecraft.paper_plugin.v1",
          "game.minecraft.readonly.v1",
          1,
          `sha256:${"a".repeat(64)}`,
          "manifest:adapter",
          `sha256:${"b".repeat(64)}`,
          "minecraft",
          JSON.stringify(["mechanics.minecraft.java.v1"]),
        ],
      );

      const { rows } = await client.query<{
        adapter_profile_id: string;
        mechanics_collection_ids: string[];
        status: string;
      }>(
        `
          SELECT adapter_profile_id, mechanics_collection_ids, status
          FROM helix_environment_adapter_admissions
          WHERE admission_id = $1;
        `,
        ["environment_adapter_admission:adapter"],
      );
      expect(rows[0]).toEqual({
        adapter_profile_id: "game.minecraft.readonly.v1",
        mechanics_collection_ids: ["mechanics.minecraft.java.v1"],
        status: "active",
      });

      await expect(
        client.query(
          `
            INSERT INTO helix_environment_adapter_admissions (
              admission_id,
              binding_id,
              credential_id,
              producer_epoch,
              room_id,
              source_id,
              world_id,
              domain_adapter,
              adapter_profile_id,
              adapter_profile_version,
              adapter_contract_hash,
              manifest_id,
              manifest_hash,
              source_family
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $12, $13
            );
          `,
          [
            "environment_adapter_admission:duplicate-active",
            "room_source_binding:adapter",
            "room_source_credential:adapter",
            "producer-epoch-adapter",
            "shared_realtime_room:adapter",
            "source:room-ingress:adapter",
            "minecraft:minehut:adapter",
            "minecraft.paper_plugin.v1",
            "game.minecraft.readonly.v1",
            `sha256:${"c".repeat(64)}`,
            "manifest:adapter:second",
            `sha256:${"d".repeat(64)}`,
            "minecraft",
          ],
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
      await pool.end();
    }
  });
});
