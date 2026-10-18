// Isolated subprocess fixture. Never invoked by production startup.
import { startDesktopProviderCredentialBroker } from "../../../../apps/desktop/src/provider-credential-broker";
import { createNativePairingLedgerRepository } from "../../../services/local-supervisor/pairing-ledger-repository";
import { createPairingLedgerRow, acceptPairingLedgerRow, pairingApprovalSchema, revokePairingLedgerRow } from "../../../services/local-supervisor/pairing-ledger-contract";
import { createNativeDurableSteeringRepository } from "../../../services/local-supervisor/durable-steering-repository";
import { DurableSteeringService } from "../../../services/local-supervisor/durable-steering-service";
import { getPool, requireDurableDatabaseSnapshot } from "../../client";
import { createNativePairingDeliveryRepository } from "../../../services/local-supervisor/pairing-delivery-repository";
import { createPairingDelivery, beginPairingDelivery } from "../../../services/local-supervisor/pairing-delivery-contract";

async function main() {
  const key = process.env.STEERING_PROCESS_FIXTURE_KEY;
  if (!key || !process.env.HELIX_LOCAL_DB_PATH?.includes("steering-process-")) throw new Error("fixture_scope_required");
  const broker = await startDesktopProviderCredentialBroker({ keyring: { activeKey: key, retiredKeys: [] } });
  process.env.HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN = broker.origin;
  process.env.HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN = broker.token;
  const repository = await createNativePairingLedgerRepository();
  const now = new Date("2026-09-12T12:00:00Z");
  const destination = { issuer: "fixture-provider", profileId: "fixture-owner", installationId: "fixture-install",
    clientId: "fixture-client", taskId: "fixture-task" };
  if (process.argv[2] === "create") {
    await getPool().query("INSERT INTO helix_accounts(profile_id, display_name) VALUES ('fixture-owner', 'Fixture')");
    await requireDurableDatabaseSnapshot(["helix_accounts"]);
    const pending = createPairingLedgerRow({ id: "fixture-pairing", consentReceiptId: "fixture-consent",
      requestDigest: "a".repeat(64), acceptanceSecretDigest: "b".repeat(64),
      approval: pairingApprovalSchema.parse({ destination, chatId: "fixture-chat", environment: null,
        scope: "exact_chat_steering", policyRevision: 1 }) }, now);
    await repository.insert(pending);
    await repository.compareAndSwap(acceptPairingLedgerRow(pending, destination, now), 1);
    const automatic = { ...pending, id: "fixture-delivery-grant", requestDigest: "c".repeat(64),
      approval: { ...pending.approval, invitationDelivery: "automatic" as const } };
    await repository.insert(automatic);
    await repository.insert({ ...automatic, id: "fixture-intent-grant", requestDigest: "d".repeat(64) });
    const deliveries = await createNativePairingDeliveryRepository();
    const initial = createPairingDelivery(automatic, now);
    await deliveries.insert(destination.profileId, initial);
    if (!await deliveries.compareAndSwap(destination.profileId, beginPairingDelivery(initial, automatic, now), 1)) {
      throw new Error("fixture_delivery_conflict");
    }
  } else if (!["recover", "revoke", "recover-revoked", "recover-expired"].includes(process.argv[2])) throw new Error("fixture_mode_invalid");
  if (process.argv[2] === "recover-expired") {
    const grant = await repository.read(destination.profileId, "fixture-pairing");
    if (!grant) throw new Error("fixture_grant_missing");
    now.setTime(Date.parse(grant.pairingExpiresAt));
  }
  const service = new DurableSteeringService(await createNativeDurableSteeringRepository(), async () => {
    const grant = await repository.read(destination.profileId, "fixture-pairing");
    if (!grant) throw new Error("fixture_grant_missing");
    return grant;
  }, () => now);
  const prompt = { clientEventRef: "fixture-ack", origin: "typed" as const, instructionText: "Private subprocess fixture instruction" };
  if (["revoke", "recover-revoked", "recover-expired"].includes(process.argv[2])) {
    const grant = await repository.read(destination.profileId, "fixture-pairing");
    if (!grant) throw new Error("fixture_grant_missing");
    if (process.argv[2] === "revoke") {
      const revoked = revokePairingLedgerRow(grant, destination.profileId, now);
      if (!await repository.compareAndSwap(revoked, grant.revision)) throw new Error("fixture_revoke_conflict");
    }
    const stored = await (await createNativeDurableSteeringRepository()).list(destination.profileId, "fixture-pairing");
    const errors: string[] = [];
    for (const operation of [() => service.list(), () => service.submit(prompt),
      () => service.acknowledge(stored[0].id), () => service.acknowledge(stored[1].id)]) {
      try { await operation(); errors.push("unexpected_success"); }
      catch (error) { errors.push(error instanceof Error ? error.message : "unknown_error"); }
    }
    // Close only HTTP handles to avoid a Windows Node/libuv exit assertion.
    // This broker has no database flush or persistence shutdown hook.
    await broker.close();
    process.stdout.write(`FIXTURE_RESULT:${JSON.stringify({ pid: process.pid, errors, stored })}\n`);
    return;
  }
  const before = await service.list();
  const acknowledged = await service.acknowledge((await service.submit(prompt)).id);
  const pending = await service.submit({ ...prompt, clientEventRef: "fixture-pending" });
  const after = await service.list();
  const deliveries = await createNativePairingDeliveryRepository();
  const delivery = await deliveries.read(destination.profileId, "fixture-delivery-grant");
  const deliveryCandidates = await repository.pendingAutomaticDelivery(destination.profileId, null, now);
  const intentWithoutOutbox = await deliveries.read(destination.profileId, "fixture-intent-grant");
  const result = { pid: process.pid, before, after, acknowledged, pending, delivery, deliveryCandidates, intentWithoutOutbox };
  // Intentionally no DB reset or broker shutdown: recovery must rely on the
  // durability acknowledgements already returned, not graceful cleanup hooks.
  process.stdout.write(`FIXTURE_RESULT:${JSON.stringify(result)}\n`);
}
main().catch(() => { process.stderr.write("steering_process_fixture_failed\n"); process.exit(1); });
