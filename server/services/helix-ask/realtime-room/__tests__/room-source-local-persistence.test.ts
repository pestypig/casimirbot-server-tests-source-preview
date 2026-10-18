import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDatabase, getPool, resetDbClient } from "../../../../db/client";
import { SharedLiveRoomBindingStore } from
  "../../../shared-live-room-control/binding-store";
import {
  createSharedRealtimeRoomSourceBindingWithoutCredential,
  persistSharedRealtimeRoomSourceCredentialForTrustedClaim,
  revokeSharedRealtimeRoomSourceBinding,
} from "../source-link-store";

describe("room source local database persistence", () => {
  afterEach(async () => {
    await resetDbClient();
    vi.unstubAllEnvs();
  });

  it("persists transactional create, rotate, and revoke state across restarts", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "helix-room-source-persistence-"),
    );
    const snapshotPath = path.join(tempRoot, "helix-db.json");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
    vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);

    try {
      await resetDbClient();
      await ensureDatabase();
      await getPool().query(
        `
          INSERT INTO helix_accounts (
            profile_id, display_name, account_type, provider
          ) VALUES ($1, $2, 'developer', 'local');
        `,
        ["profile:persistence-owner", "Persistence Owner"],
      );
      await getPool().query(
        `
          INSERT INTO helix_shared_realtime_rooms (
            room_id, owner_profile_id, title
          ) VALUES ($1, $2, $3);
        `,
        [
          "shared_realtime_room:persistence",
          "profile:persistence-owner",
          "Persistence room",
        ],
      );

      const bindingStore = new SharedLiveRoomBindingStore();
      const createdBinding =
        await createSharedRealtimeRoomSourceBindingWithoutCredential({
        roomId: "shared_realtime_room:persistence",
        ownerProfileId: "profile:persistence-owner",
      });
      const createDelivery =
        await bindingStore.createCredentialDeliveryHandle({
          bindingId: createdBinding.binding_id,
          ownerProfileId: "profile:persistence-owner",
          purpose: "create",
        });
      let createdTokenValue: string | null = null;
      await bindingStore.claimCredentialDeliveryHandle({
        ownerProfileId: "profile:persistence-owner",
        deliveryHandle: createDelivery.deliveryHandle,
        consume: async (claim, client) => {
          const persisted =
            await persistSharedRealtimeRoomSourceCredentialForTrustedClaim(
              claim,
              client,
            );
          createdTokenValue = persisted.tokenValue;
        },
      });
      expect(createdTokenValue).toMatch(/^helix_room_src_/);
      await resetDbClient();
      await ensureDatabase();
      const restoredCreated = await getPool().query<{
        binding_status: string;
        credential_status: string;
        token_hash: string;
      }>(
        `
          SELECT
            b.status AS binding_status,
            c.status AS credential_status,
            c.token_hash
          FROM helix_room_source_bindings b
          JOIN helix_room_source_credentials c
            ON c.binding_id = b.binding_id
          WHERE b.binding_id = $1;
        `,
        [createdBinding.binding_id],
      );
      expect(restoredCreated.rows[0]).toMatchObject({
        binding_status: "active",
        credential_status: "active",
      });
      expect(JSON.stringify(restoredCreated.rows[0])).not.toContain(
        createdTokenValue,
      );

      const rotateDelivery =
        await bindingStore.createCredentialDeliveryHandle({
          bindingId: createdBinding.binding_id,
          ownerProfileId: "profile:persistence-owner",
          purpose: "rotate",
        });
      let rotatedTokenValue: string | null = null;
      await bindingStore.claimCredentialDeliveryHandle({
        ownerProfileId: "profile:persistence-owner",
        deliveryHandle: rotateDelivery.deliveryHandle,
        consume: async (claim, client) => {
          const persisted =
            await persistSharedRealtimeRoomSourceCredentialForTrustedClaim(
              claim,
              client,
            );
          rotatedTokenValue = persisted.tokenValue;
        },
      });
      expect(rotatedTokenValue).toMatch(/^helix_room_src_/);
      await resetDbClient();
      await ensureDatabase();
      const restoredRotated = await getPool().query<{
        status: string;
        credential_id: string;
      }>(
        `
          SELECT status, credential_id
          FROM helix_room_source_credentials
          WHERE binding_id = $1
          ORDER BY created_at ASC;
        `,
        [createdBinding.binding_id],
      );
      expect(restoredRotated.rows.map((row) => row.status).sort()).toEqual([
        "active",
        "revoked",
      ]);
      expect(JSON.stringify(restoredRotated.rows)).not.toContain(
        rotatedTokenValue,
      );

      await revokeSharedRealtimeRoomSourceBinding({
        roomId: "shared_realtime_room:persistence",
        bindingId: createdBinding.binding_id,
        ownerProfileId: "profile:persistence-owner",
      });
      await resetDbClient();
      await ensureDatabase();
      const restoredRevoked = await getPool().query<{
        binding_status: string;
        credential_status: string;
      }>(
        `
          SELECT
            b.status AS binding_status,
            c.status AS credential_status
          FROM helix_room_source_bindings b
          JOIN helix_room_source_credentials c
            ON c.binding_id = b.binding_id
          WHERE b.binding_id = $1
          ORDER BY c.created_at ASC;
        `,
        [createdBinding.binding_id],
      );
      expect(restoredRevoked.rows.map((row) => row.binding_status)).toEqual([
        "revoked",
        "revoked",
      ]);
      expect(restoredRevoked.rows.map((row) => row.credential_status)).toEqual([
        "revoked",
        "revoked",
      ]);
    } finally {
      await resetDbClient();
      if (tempRoot.startsWith(path.resolve(os.tmpdir()))) {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    }
  });
});
