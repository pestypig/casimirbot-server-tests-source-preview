import { expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { startDesktopProviderCredentialBroker } from "../../../apps/desktop/src/provider-credential-broker";
import { createNativePairingLedgerRepository } from "../../services/local-supervisor/pairing-ledger-repository";
import { createPairingDestinationRegistrationStore } from "../../services/local-supervisor/pairing-destination-registration";
import { createNativePairingDeliveryRepository } from "../../services/local-supervisor/pairing-delivery-repository";
import { createNativeDurableSteeringRepository } from "../../services/local-supervisor/durable-steering-repository";
import { createNativePersonalTaskResultRepository } from "../../services/local-supervisor/personal-task-result";
import { createNativeHostedRoomInterpreterResultRepository } from "../../services/local-supervisor/room-interpreter-task-result";
import { createNativeHostedRoomResultRepository, createNativeRoomMissionResultRepository } from "../../services/local-supervisor/room-mission-result";
import { acceptPairingLedgerRow, createPairingLedgerRow, pairingApprovalSchema } from "../../services/local-supervisor/pairing-ledger-contract";

vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

it("confirms an unchanged native encrypted pairing eight times without rewriting its acknowledged snapshot", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "casimir-pairing-read-cost-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  const broker = await startDesktopProviderCredentialBroker({ keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] } });
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN", broker.origin);
  vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN", broker.token);
  const db = await import("../client");
  try {
    await db.ensureDatabase();
    await db.getPool().query("INSERT INTO helix_accounts(profile_id,display_name) VALUES ('fixture-read-owner','Fixture')");
    await db.requireDurableDatabaseSnapshot(["helix_accounts"]);
    const repository = await createNativePairingLedgerRepository();
    const actor = { issuer: "fixture-issuer", profileId: "fixture-read-owner", installationId: "fixture-install", clientId: "fixture-client", taskId: "fixture-task" };
    const original = createPairingLedgerRow({ id: "pairing:fixture-read", requestDigest: "a".repeat(64),
      acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-consent",
      approval: pairingApprovalSchema.parse({ destination: actor, chatId: "fixture-chat", environment: null,
        scope: "exact_chat_steering", policyRevision: 1 }) }, new Date("2026-09-14T12:00:00Z"));
    const accepted = acceptPairingLedgerRow(original, actor, new Date("2026-09-14T12:01:00Z"));
    await repository.insert(original);
    await repository.compareAndSwap(accepted, 1);
    // Prime coverage for the repositories that polling routes reconstruct.
    await createPairingDestinationRegistrationStore();
    await createNativePairingDeliveryRepository();
    await createNativeDurableSteeringRepository();
    await createNativePersonalTaskResultRepository();
    await createNativeHostedRoomInterpreterResultRepository();
    await createNativeHostedRoomResultRepository();
    await createNativeRoomMissionResultRepository();
    await db.flushLocalDatabaseSnapshotIfEnabled();
    const rename = vi.spyOn(fs.promises, "rename");
    for (let index = 0; index < 8; index++) {
      await repository.confirmDurability();
      expect(await repository.read(actor.profileId, original.id)).toEqual(accepted);
      await createNativePairingLedgerRepository();
      await createPairingDestinationRegistrationStore();
      const delivery = await createNativePairingDeliveryRepository();
      const steering = await createNativeDurableSteeringRepository();
      await delivery.confirmDurability();
      await steering.confirmDurability();
      await createNativePersonalTaskResultRepository();
      await createNativeHostedRoomInterpreterResultRepository();
      await createNativeHostedRoomResultRepository();
      await createNativeRoomMissionResultRepository();
    }
    expect(rename.mock.calls.filter(([, target]) => target === snapshotPath)).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(snapshotPath, "utf8")).tables.helix_pairing_ledger[0].revision).toBe(2);
  } finally {
    vi.restoreAllMocks();
    await db.resetDbClient(); await broker.close(); vi.unstubAllEnvs();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
}, 60000);
