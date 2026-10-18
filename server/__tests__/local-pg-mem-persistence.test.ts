import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureDatabase,
  flushLocalDatabaseSnapshotIfEnabled,
  getPool,
  requireLocalDatabaseSnapshotIfEnabled,
  resetDbClient,
  writeLocalSnapshotAtomically,
} from "../db/client";
import {
  getAccountSessionStatus,
  resetAccountSessionStore,
  signInPasswordAccountSession,
  signUpPasswordAccountSession,
} from "../services/helix-account/account-session-store";
import {
  readProfileStorageSnapshot,
  writeProfileStorageSnapshot,
} from "../services/helix-account/profile-storage-store";
import { InstalledSecurityStore } from
  "../services/helix-account/installed-security-store";
import { BillingEntitlementStore } from
  "../services/helix-account/billing-entitlement-store";

import { temporalSuccessorLeaseSql } from "../services/environment-connectors/actions/temporal-successor-query";
import { closeTemporalEpochGapSql } from "../services/environment-connectors/actions/temporal-epoch-gap";
import { withSharedRealtimeRoomTransaction } from "../services/helix-ask/realtime-room/room-store/database";

describe("local pg-mem persistence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "casimirbot-local-db-"));
  const snapshotPath = path.join(tempDir, "local-pg-mem.json");
  const recoveryPath = `${snapshotPath}.last-good`;

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
    await resetDbClient();
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    if (fs.existsSync(recoveryPath)) fs.unlinkSync(recoveryPath);
  });

  afterEach(async () => {
    await resetAccountSessionStore().catch(() => undefined);
    await resetDbClient();
    vi.unstubAllEnvs();
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    if (fs.existsSync(recoveryPath)) fs.unlinkSync(recoveryPath);
  });

  it("verifies the written snapshot and retains a separate recovery copy", async () => {
    const snapshot = {
      schema: "helix.local_pg_mem_snapshot.v1" as const,
      saved_at: "2026-10-01T00:00:00.000Z",
      tables: { helix_accounts: [{ account_id: "recovery-check" }] },
    };
    const timings = await writeLocalSnapshotAtomically(snapshotPath, snapshot);
    expect(JSON.parse(fs.readFileSync(snapshotPath, "utf8"))).toEqual(snapshot);
    expect(fs.readFileSync(recoveryPath)).toEqual(fs.readFileSync(snapshotPath));
    expect(timings.bytes).toBe(fs.statSync(snapshotPath).size);
    expect([
      timings.serialize_ms,
      timings.active_sync_verify_ms,
      timings.recovery_copy_sync_verify_ms,
      timings.rename_ms,
    ].every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);

    fs.writeFileSync(snapshotPath, Buffer.alloc(4096));
    await expect(ensureDatabase()).rejects.toThrow("local_pg_mem_snapshot_restore_failed");
    expect(JSON.parse(fs.readFileSync(recoveryPath, "utf8"))).toEqual(snapshot);
  });

  it("does not replace the active snapshot if the recovery copy fails verification", async () => {
    const original = { schema: "helix.local_pg_mem_snapshot.v1", saved_at: "old", tables: {} };
    fs.writeFileSync(snapshotPath, JSON.stringify(original));
    const copyFile = fs.promises.copyFile.bind(fs.promises);
    const spy = vi.spyOn(fs.promises, "copyFile").mockImplementation(async (source, destination, flags) => {
      await copyFile(source, destination, flags);
      await fs.promises.writeFile(destination, Buffer.alloc(4096));
    });
    try {
      await expect(writeLocalSnapshotAtomically(snapshotPath, {
        schema: "helix.local_pg_mem_snapshot.v1",
        saved_at: "new",
        tables: {},
      })).rejects.toThrow("local_pg_mem_snapshot_integrity_failed");
      expect(JSON.parse(fs.readFileSync(snapshotPath, "utf8"))).toEqual(original);
      expect(fs.existsSync(recoveryPath)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("fails closed on a zeroed snapshot without replacing it with an empty database", async () => {
    const zeroedSnapshot = Buffer.alloc(4096);
    fs.writeFileSync(snapshotPath, zeroedSnapshot);

    await expect(ensureDatabase()).rejects.toThrow("local_pg_mem_snapshot_restore_failed");
    await expect(ensureDatabase()).rejects.toThrow("local_pg_mem_snapshot_restore_failed");
    expect(fs.readFileSync(snapshotPath)).toEqual(zeroedSnapshot);
  });

  it("fails closed on an unsupported snapshot schema without replacing it", async () => {
    const unsupportedSnapshot = JSON.stringify({ schema: "other.snapshot.v1", tables: {} });
    fs.writeFileSync(snapshotPath, unsupportedSnapshot, "utf8");

    await expect(ensureDatabase()).rejects.toThrow("local_pg_mem_snapshot_restore_failed");
    expect(fs.readFileSync(snapshotPath, "utf8")).toBe(unsupportedSnapshot);
  });

  it("restores password accounts and profile saves after a local server restart", async () => {
    const email = "persisted-local-profile@example.com";
    const password = "CorrectHorseBattery123!";
    const signUp = await signUpPasswordAccountSession({
      email,
      password,
      display_name: "Persistent Local Profile",
    });
    expect(signUp.ok).toBe(true);
    const profileId = signUp.session?.profile.profile_id;
    expect(profileId).toBeTruthy();

    const saved = await writeProfileStorageSnapshot({
      profile_id: profileId!,
      quota_bytes: 1024 * 1024,
      snapshot: {
        entries: [
          {
            storage_key: "helix:test:restart-proof",
            storage_backend: "localStorage",
            value: JSON.stringify({ title: "Restart proof", steps: ["save", "restart", "restore"] }),
            size_bytes: 64,
            updated_at: "2026-07-06T00:00:00.000Z",
            artifact_ids: ["artifact:restart-proof"],
          },
        ],
        artifacts: [
          {
            schema: "helix.workspace_memory_registry.v1",
            artifact_id: "artifact:restart-proof",
            artifact_type: "remembered_procedure",
            owner_scope: "browser_guest",
            storage_backend: "localStorage",
            sync_status: "profile_candidate",
            profile_id: null,
            chat_session_id: null,
            title: "Restart proof",
            storage_key: "helix:test:restart-proof",
            updated_at: "2026-07-06T00:00:00.000Z",
          },
        ],
      },
    });
    expect(saved.ok).toBe(true);
    expect(fs.existsSync(snapshotPath)).toBe(true);

    await resetDbClient();

    const signIn = await signInPasswordAccountSession({ email, password });
    expect(signIn.ok).toBe(true);
    expect(signIn.session?.profile.email).toBe(email);
    expect((await getAccountSessionStatus(signIn.session?.session_id)).session?.profile.email).toBe(email);

    const restored = await readProfileStorageSnapshot(profileId!, { quota_bytes: 1024 * 1024 });
    expect(restored.entries).toHaveLength(1);
    expect(JSON.parse(restored.entries[0]?.value ?? "{}")).toMatchObject({ title: "Restart proof" });
    expect(restored.artifacts[0]?.sync_status).toBe("profile_synced");
  });

  it("retains installed-device revoke and recovery state across EXE restarts", async () => {
    const signUp = await signUpPasswordAccountSession({
      email: "installed-security-persistence@example.com",
      password: "CorrectHorseInstalledSecurity123!",
      display_name: "Installed Security Persistence Owner",
    });
    expect(signUp.ok).toBe(true);
    const session = {
      sessionId: signUp.session!.session_id,
      profileId: signUp.session!.profile.profile_id,
    };
    const deviceId = "desktop_device_restart_persistence";
    let store = new InstalledSecurityStore();

    await store.registerDevice({ session, deviceId });
    await store.revokeDevice({ session, deviceId });
    await flushLocalDatabaseSnapshotIfEnabled();
    await resetDbClient();

    store = new InstalledSecurityStore();
    let status = await store.status({
      session,
      deviceId,
      auth0Configured: true,
      maximumAgeSeconds: 300,
    });
    expect(status.current_device).toMatchObject({
      status: "revoked",
      recovery_generation: 0,
    });
    expect(status.recent_events.map((event) => event.event_type)).toEqual([
      "installed_device_revoked",
      "installed_device_registered",
    ]);

    await store.recoverDevice({ session, deviceId });
    await flushLocalDatabaseSnapshotIfEnabled();
    await resetDbClient();

    store = new InstalledSecurityStore();
    status = await store.status({
      session,
      deviceId,
      auth0Configured: true,
      maximumAgeSeconds: 300,
    });
    expect(status.current_device).toMatchObject({
      status: "active",
      recovery_generation: 1,
    });
    expect(status.recent_events.map((event) => event.event_type)).toEqual([
      "installed_device_recovered",
      "installed_device_revoked",
      "installed_device_registered",
    ]);
  });

  it("retains Stripe sandbox entitlement, idempotency, and credit across EXE restarts", async () => {
    const signUp = await signUpPasswordAccountSession({
      email: "billing-persistence@example.com",
      password: "CorrectHorseBillingPersistence123!",
      display_name: "Billing Persistence Owner",
    });
    expect(signUp.ok).toBe(true);
    const profileId = signUp.session!.profile.profile_id;
    let billing = new BillingEntitlementStore({ sandboxConfigured: () => true });
    const accepted = await billing.applyStripeEvent({
      event_id: "evt_restart_plan_1",
      event_type: "checkout.session.completed",
      object_id: "cs_restart_plan_1",
      created_at: "2026-08-28T12:00:00.000Z",
      profile_id: profileId,
      action: "plan_activated",
      plan_id: "starter_monthly",
      amount_minor: 1200,
      currency: "usd",
      status: "active",
      period_starts_at: "2026-08-28T12:00:00.000Z",
      period_ends_at: "2026-09-28T12:00:00.000Z",
      customer_id: "cus_restart1",
      subscription_id: "sub_restart1",
      reference_object_id: null,
      payload_sha256: "b".repeat(64),
    });
    expect(accepted.outcome).toBe("processed");
    await flushLocalDatabaseSnapshotIfEnabled();
    await resetDbClient();

    billing = new BillingEntitlementStore({ sandboxConfigured: () => true });
    const restored = await billing.status(profileId);
    expect(restored).toMatchObject({
      status: "active",
      plan_id: "starter_monthly",
      balance: { included_credit_minor: 1200, available_credit_minor: 1200 },
    });
    const replay = await billing.applyStripeEvent({
      event_id: "evt_restart_plan_1",
      event_type: "checkout.session.completed",
      object_id: "cs_restart_plan_1",
      created_at: "2026-08-28T12:00:00.000Z",
      profile_id: profileId,
      action: "plan_activated",
      plan_id: "starter_monthly",
      amount_minor: 1200,
      currency: "usd",
      status: "active",
      period_starts_at: "2026-08-28T12:00:00.000Z",
      period_ends_at: "2026-09-28T12:00:00.000Z",
      customer_id: "cus_restart1",
      subscription_id: "sub_restart1",
      reference_object_id: null,
      payload_sha256: "b".repeat(64),
    });
    expect(replay.outcome).toBe("duplicate");
    expect((await billing.status(profileId)).balance.available_credit_minor).toBe(1200);
  });

  it("defers and coalesces local snapshots until an explicit flush", async () => {
    vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_IDLE_FLUSH_MS", "60000");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_MAX_FLUSH_MS", "60000");

    const signedUp = await signUpPasswordAccountSession({
      email: "deferred-local-profile@example.com",
      password: "CorrectHorseBattery456!",
      display_name: "Deferred Local Profile",
    });
    expect(signedUp.ok).toBe(true);
    expect(fs.existsSync(snapshotPath)).toBe(false);

    await flushLocalDatabaseSnapshotIfEnabled();
    expect(fs.existsSync(snapshotPath)).toBe(true);

    await resetDbClient();
    const signedIn = await signInPasswordAccountSession({
      email: "deferred-local-profile@example.com",
      password: "CorrectHorseBattery456!",
    });
    expect(signedIn.ok).toBe(true);
  });

  it("does not dirty the durable snapshot for a non-durable table mutation", async () => {
    vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_IDLE_FLUSH_MS", "60000");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_MAX_FLUSH_MS", "60000");

    const signedUp = await signUpPasswordAccountSession({
      email: "non-durable-local-profile@example.com",
      password: "CorrectHorseBattery789!",
      display_name: "Non-durable Local Profile",
    });
    expect(signedUp.ok).toBe(true);
    await flushLocalDatabaseSnapshotIfEnabled();
    const before = fs.readFileSync(snapshotPath, "utf8");

    const pool = getPool();
    await pool.query("CREATE TABLE local_ephemeral_probe (probe_id text PRIMARY KEY);");
    await pool.query(
      "INSERT INTO local_ephemeral_probe (probe_id) VALUES ($1);",
      ["probe:non-durable"],
    );
    await flushLocalDatabaseSnapshotIfEnabled();

    expect(fs.readFileSync(snapshotPath, "utf8")).toBe(before);
  });

  it("restores encrypted brokerage connections, private-room bindings, and paper accounts", async () => {
    vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_IDLE_FLUSH_MS", "60000");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_MAX_FLUSH_MS", "60000");

    const signedUp = await signUpPasswordAccountSession({
      email: "brokerage-persistence@example.com",
      password: "CorrectHorseBrokerage123!",
      display_name: "Brokerage Persistence Owner",
    });
    expect(signedUp.ok).toBe(true);
    const profileId = signedUp.session!.profile.profile_id;
    await ensureDatabase();
    const pool = getPool();
    await pool.query(`
      INSERT INTO helix_shared_realtime_rooms (
        room_id, owner_profile_id, title, status
      ) VALUES (
        'shared_realtime_room:brokerage-persistence', $1,
        'Brokerage persistence', 'ready'
      );
      INSERT INTO helix_brokerage_connections (
        connection_id, owner_profile_id, provider, resource_url,
        oauth_issuer, oauth_client_id, encrypted_credential_bundle,
        encryption_key_id, encryption_algorithm, granted_capability_ids,
        producer_epoch_ref
      ) VALUES (
        'brokerage_connection:persistence', $1, 'robinhood',
        'https://mcp.robinhood.com/mcp', 'https://robinhood.com',
        'casimirbot-persistence-client', 'v1:ciphertext-only-fixture',
        'sha256:${"a".repeat(64)}', 'aes-256-gcm',
        '["brokerage.robinhood.market_data.read"]'::jsonb,
        'producer_epoch:persistence'
      );
      INSERT INTO helix_brokerage_room_bindings (
        binding_id, connection_id, owner_profile_id, room_id,
        consent_capability_ids
      ) VALUES (
        'brokerage_binding:persistence', 'brokerage_connection:persistence',
        $1, 'shared_realtime_room:brokerage-persistence',
        '["brokerage.robinhood.market_data.read"]'::jsonb
      );
      INSERT INTO helix_paper_trading_accounts (
        account_id, owner_profile_id, connection_id, room_id,
        policy_json, policy_hash, starting_equity_cents,
        account_equity_cents, buying_power_cents, trading_day
      ) VALUES (
        'paper_account:persistence', $1, 'brokerage_connection:persistence',
        'shared_realtime_room:brokerage-persistence',
        '{"long_equities_only":true}'::jsonb, 'sha256:${"b".repeat(64)}',
        100000, 100000, 100000, '2026-08-12'
      );
    `, [profileId]);
    await flushLocalDatabaseSnapshotIfEnabled();
    await resetDbClient();
    await ensureDatabase();

    const restoredConnection = await getPool().query<{
      encrypted_credential_bundle: string;
      status: string;
    }>(`SELECT encrypted_credential_bundle, status
        FROM helix_brokerage_connections
        WHERE connection_id = 'brokerage_connection:persistence';`);
    const restoredBinding = await getPool().query(
      `SELECT binding_id FROM helix_brokerage_room_bindings
       WHERE binding_id = 'brokerage_binding:persistence';`,
    );
    const restoredPaper = await getPool().query(
      `SELECT account_id FROM helix_paper_trading_accounts
       WHERE account_id = 'paper_account:persistence';`,
    );
    expect(restoredConnection.rows[0]).toEqual({
      encrypted_credential_bundle: "v1:ciphertext-only-fixture",
      status: "connected",
    });
    expect(restoredBinding.rowCount).toBe(1);
    expect(restoredPaper.rowCount).toBe(1);
  });

  it("restores environment command authority and its evidence ledger after restart", async () => {
    vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_IDLE_FLUSH_MS", "60000");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_MAX_FLUSH_MS", "60000");

    const signedUp = await signUpPasswordAccountSession({
      email: "command-persistence@example.com",
      password: "CorrectHorseCommand123!",
      display_name: "Command Persistence Owner",
    });
    expect(signedUp.ok).toBe(true);
    const profileId = signedUp.session!.profile.profile_id;
    await ensureDatabase();
    const pool = getPool();
    await pool.query(
      `
        INSERT INTO helix_shared_realtime_rooms (
          room_id, owner_profile_id, title, status
        ) VALUES (
          'shared_realtime_room:command-persistence', $1,
          'Command persistence', 'ready'
        );
        INSERT INTO helix_shared_realtime_room_members (
          room_id, slot_number, profile_id, participant_id, member_role
        ) VALUES (
          'shared_realtime_room:command-persistence', 1, $1,
          'participant:command-persistence', 'owner'
        );
        INSERT INTO helix_room_source_bindings (
          binding_id, room_id, owner_profile_id, source_id, world_id,
          domain_adapter, source_label, scopes
        ) VALUES (
          'room_source_binding:command-persistence',
          'shared_realtime_room:command-persistence', $1,
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence', 'minecraft.fabric_mod.v1',
          'Command persistence Fabric source', '["environment:observe"]'::jsonb
        );
        INSERT INTO helix_room_source_credentials (
          credential_id, binding_id, token_hash, token_prefix, expires_at
        ) VALUES (
          'room_source_credential:command-persistence',
          'room_source_binding:command-persistence',
          'room-source-command-persistence-hash', 'room_source_test',
          now() + interval '1 day'
        );
        INSERT INTO helix_environment_adapter_admissions (
          admission_id, binding_id, credential_id, producer_epoch, room_id,
          source_id, world_id, domain_adapter, adapter_profile_id,
          adapter_profile_version, adapter_contract_hash, manifest_id,
          manifest_hash, source_family, mechanics_collection_ids
        ) VALUES (
          'environment_adapter_admission:command-persistence',
          'room_source_binding:command-persistence',
          'room_source_credential:command-persistence', 'epoch:persistence',
          'shared_realtime_room:command-persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence', 'minecraft.fabric_mod.v1',
          'game.minecraft.fabric.v1', 1, 'sha256:${"a".repeat(64)}',
          'manifest:command-persistence', 'sha256:${"b".repeat(64)}',
          'minecraft', '["minecraft.fabric.command_dispatcher.v1"]'::jsonb
        );
        INSERT INTO helix_environment_connector_packages (
          package_version_id, publisher_id, package_id, package_version,
          content_hash, trust_classification, security_review_state
        ) VALUES (
          'package_version:command-persistence', 'publisher:casimirbot',
          'com.casimirbot.minecraft.fabric', '0.1.0',
          'sha256:${"c".repeat(64)}', 'first_party', 'approved'
        );
        INSERT INTO helix_environment_connector_installations (
          installation_id, owner_profile_id, package_version_id,
          granted_capability_ids
        ) VALUES (
          'installation:command-persistence', $1,
          'package_version:command-persistence',
          '["com.casimirbot.minecraft.command"]'::jsonb
        );
        INSERT INTO helix_environment_connector_devices (
          device_id, installation_id, device_public_key_hash,
          producer_epoch_ref, health_status
        ) VALUES (
          'device:command-persistence', 'installation:command-persistence',
          'sha256:${"d".repeat(64)}', 'epoch:persistence', 'online'
        );
        INSERT INTO helix_environment_connector_bindings (
          environment_binding_id, installation_id, device_id,
          room_source_binding_id, adapter_admission_id, owner_profile_id,
          room_id, source_id, world_id, consent_capability_ids
        ) VALUES (
          'environment_binding:command-persistence',
          'installation:command-persistence', 'device:command-persistence',
          'room_source_binding:command-persistence',
          'environment_adapter_admission:command-persistence', $1,
          'shared_realtime_room:command-persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence',
          '["com.casimirbot.minecraft.command"]'::jsonb
        );
        INSERT INTO helix_environment_command_authorities (
          command_authority_id, environment_binding_id,
          room_source_binding_id, owner_profile_id, room_id, source_id,
          world_id, adapter_profile_id, authority_profile, autonomy_mode,
          approved_categories
        ) VALUES (
          'command_authority:persistence',
          'environment_binding:command-persistence',
          'room_source_binding:command-persistence', $1,
          'shared_realtime_room:command-persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence', 'game.minecraft.fabric.v1',
          'server_administrator', 'autonomous', '["query"]'::jsonb
        );
        INSERT INTO helix_environment_command_member_grants (
          command_grant_id, command_authority_id, room_id, participant_id,
          profile_id, environment_binding_id, max_authority_profile
        ) VALUES (
          'command_grant:persistence', 'command_authority:persistence',
          'shared_realtime_room:command-persistence',
          'participant:command-persistence', $1,
          'environment_binding:command-persistence', 'server_administrator'
        );
        INSERT INTO helix_environment_command_connector_credentials (
          command_credential_id, command_authority_id,
          environment_binding_id, token_hash, token_prefix, scopes, expires_at
        ) VALUES (
          'command_credential:persistence', 'command_authority:persistence',
          'environment_binding:command-persistence', 'sha256:${"e".repeat(64)}',
          'helix_env_cmd_test',
          '["command.poll","command.result.write"]'::jsonb,
          now() + interval '1 day'
        );
        INSERT INTO helix_environment_command_catalog_snapshots (
          command_catalog_id, command_authority_id, environment_binding_id,
          source_id, world_id, adapter_profile_id, domain_adapter,
          game_version, producer_epoch_ref, command_tree_hash,
          root_command_count, catalog_summary
        ) VALUES (
          'command_catalog:persistence', 'command_authority:persistence',
          'environment_binding:command-persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence', 'game.minecraft.fabric.v1',
          'minecraft.fabric_mod.v1', '1.21.8', 'epoch:persistence',
          'sha256:${"f".repeat(64)}', 84, '{"root_commands":["time"]}'::jsonb
        );
        INSERT INTO helix_environment_command_requests (
          command_request_id, command_authority_id, command_grant_id,
          command_catalog_id, environment_binding_id, room_id, source_id,
          world_id, participant_id, run_id, turn_id, provider_execution_id,
          tool_call_id, authority_profile, autonomy_mode, approved_categories,
          policy_version, command_text, command_hash, command_root_hint,
          requested_category, expected_effect, idempotency_key,
          confirmation_state, status, deadline_at
        ) VALUES (
          'command_request:persistence', 'command_authority:persistence',
          'command_grant:persistence', 'command_catalog:persistence',
          'environment_binding:command-persistence',
          'shared_realtime_room:command-persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence',
          'participant:command-persistence', 'run:persistence',
          'turn:persistence', 'provider:persistence', 'tool:persistence',
          'server_administrator', 'autonomous', '["query"]'::jsonb, 1,
          'time query daytime', 'sha256:${"1".repeat(64)}', 'time', 'query',
          'read_only', 'idempotency:persistence', 'not_required', 'succeeded',
          now() + interval '1 day'
        );
        INSERT INTO helix_environment_command_results (
          command_result_id, command_request_id, command_execution_id,
          command_hash, command_root, parsed_category, effect_class, outcome,
          result_code, result_payload, result_hash, side_effects_performed,
          environment_mutation_performed, server_administration_performed,
          provenance_valid, eligible_for_current_turn_reentry
        ) VALUES (
          'command_result:persistence', 'command_request:persistence',
          'command_execution:persistence', 'sha256:${"1".repeat(64)}', 'time',
          'query', 'read_only', 'succeeded', 1,
          '{"summary":"The time is 1000."}'::jsonb,
          'sha256:${"2".repeat(64)}', false, false, false, true, true
        );
        INSERT INTO helix_environment_command_events (
          event_id, command_authority_id, command_request_id, event_type,
          payload
        ) VALUES (
          'command_event:persistence', 'command_authority:persistence',
          'command_request:persistence', 'command_result_recorded',
          '{"outcome":"succeeded"}'::jsonb
        );
        INSERT INTO helix_room_environment_subject_bindings (
          subject_binding_id, room_id, participant_id, profile_id,
          environment_binding_id, room_source_binding_id, source_id, world_id,
          subject_kind, subject_ref, subject_native_id, subject_label,
          verification_method, confidence, producer_epoch_ref
        ) VALUES (
          'subject_binding:durable-goal-persistence',
          'shared_realtime_room:command-persistence',
          'participant:command-persistence', $1,
          'environment_binding:command-persistence',
          'room_source_binding:command-persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence', 'player',
          'minecraft-player:persistence', 'player:persistence',
          'Persistence Player', 'server_auth', 1, 'epoch:persistence'
        );
        INSERT INTO helix_environment_action_authorities (
          action_authority_id, environment_binding_id,
          room_source_binding_id, owner_profile_id, room_id, source_id,
          world_id, adapter_profile_id, domain_adapter, participant_id,
          subject_binding_id, subject_native_id, allowed_capability_ids,
          autonomy_mode, manual_override_policy, policy_version, status,
          expires_at
        ) VALUES (
          'environment_action_authority:persistence',
          'environment_binding:command-persistence',
          'room_source_binding:command-persistence', $1,
          'shared_realtime_room:command-persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence',
          'game.minecraft.player.fabric.v1', 'minecraft.fabric_client.v1',
          'participant:command-persistence',
          'subject_binding:durable-goal-persistence', 'player:persistence',
          '["com.casimirbot.minecraft.player.navigate"]'::jsonb,
          'approved_capabilities', 'cancel', 1, 'active',
          now() + interval '1 day'
        );
        INSERT INTO helix_environment_durable_goals (
          goal_id, owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          participant_id, subject_binding_id, subject_native_id, source_id,
          world_id, objective_hash, objective_payload, current_sequence,
          latest_event_hash
        ) VALUES (
          'environment_durable_goal:persistence', $1,
          'installation:command-persistence', 'device:command-persistence',
          'environment_binding:command-persistence',
          'room_source_binding:command-persistence',
          'shared_realtime_room:command-persistence',
          'participant:command-persistence',
          'subject_binding:durable-goal-persistence', 'player:persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence', 'sha256:${"2".repeat(64)}',
          '{"objective_text":"Survive restart"}'::jsonb, 1,
          'sha256:${"3".repeat(64)}'
        );
        INSERT INTO helix_environment_durable_goal_participants (
          goal_id, participant_id, profile_id, granted_by_profile_id, scopes
        ) VALUES (
          'environment_durable_goal:persistence',
          'participant:command-persistence', $1, $1,
          '["read","steer"]'::jsonb
        );
        INSERT INTO helix_environment_durable_goal_participant_events (
          grant_event_id, goal_id, sequence, event_hash, event_kind,
          participant_id, profile_id, actor_profile_id, scopes
        ) VALUES (
          'durable_goal_grant_event:persistence',
          'environment_durable_goal:persistence', 1,
          'sha256:${"4".repeat(64)}', 'granted',
          'participant:command-persistence', $1, $1,
          '["read","steer"]'::jsonb
        );
        INSERT INTO helix_environment_durable_goal_events (
          event_id, goal_id, sequence, event_kind, event_hash,
          owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          goal_owner_participant_id, participant_id,
          authority_participant_id, subject_binding_id, subject_native_id,
          source_id, world_id, producer_epoch_ref, action_authority_id,
          authority_policy_version, authority_expires_at, turn_id,
          event_payload, payload, evidence_refs, occurred_at
        ) VALUES (
          'environment_durable_goal_event:persistence',
          'environment_durable_goal:persistence', 1, 'goal_created',
          'sha256:${"3".repeat(64)}', $1,
          'installation:command-persistence', 'device:command-persistence',
          'environment_binding:command-persistence',
          'room_source_binding:command-persistence',
          'shared_realtime_room:command-persistence',
          'participant:command-persistence', 'participant:command-persistence',
          'participant:command-persistence',
          'subject_binding:durable-goal-persistence', 'player:persistence',
          'source:room-ingress:command-persistence',
          'minecraft:local:command-persistence', 'epoch:persistence',
          'environment_action_authority:persistence', 1,
          now() + interval '1 day', 'turn:persistence',
          '{"kind":"goal_created"}'::jsonb,
          '{"kind":"goal_created"}'::jsonb, '[]'::jsonb, now()
        );
      `,
      [profileId],
    );
    await flushLocalDatabaseSnapshotIfEnabled();

    await resetDbClient();
    await ensureDatabase();
    const restored = await getPool().query<Record<string, string>>(`
      SELECT
        (SELECT count(*)::text FROM helix_environment_command_authorities) AS authorities,
        (SELECT count(*)::text FROM helix_environment_command_member_grants) AS grants,
        (SELECT count(*)::text FROM helix_environment_command_connector_credentials) AS credentials,
        (SELECT count(*)::text FROM helix_environment_command_catalog_snapshots) AS catalogs,
        (SELECT count(*)::text FROM helix_environment_command_requests) AS requests,
        (SELECT count(*)::text FROM helix_environment_command_results) AS results,
        (SELECT count(*)::text FROM helix_environment_command_events) AS events,
        (SELECT count(*)::text FROM helix_environment_action_authorities) AS action_authorities,
        (SELECT count(*)::text FROM helix_environment_durable_goals) AS durable_goals,
        (SELECT count(*)::text FROM helix_environment_durable_goal_participants) AS durable_participants,
        (SELECT count(*)::text FROM helix_environment_durable_goal_participant_events) AS durable_participant_events,
        (SELECT count(*)::text FROM helix_environment_durable_goal_events) AS durable_events;
    `);
    const restoredCounts = Object.fromEntries(
      Object.entries(restored.rows[0]).map(([key, value]) => [
        key,
        Number(Array.isArray(value) ? value[0] : value),
      ]),
    );
    expect(restoredCounts).toEqual({
      authorities: 1,
      grants: 1,
      credentials: 1,
      catalogs: 1,
      requests: 1,
      results: 1,
      events: 1,
      action_authorities: 1,
      durable_goals: 1,
      durable_participants: 1,
      durable_participant_events: 1,
      durable_events: 1,
    });
    const jsonRestored = await getPool().query<{
      approved_categories: unknown;
      catalog_summary: unknown;
      result_payload: unknown;
      payload: unknown;
    }>(`
      SELECT
        a.approved_categories,
        c.catalog_summary,
        r.result_payload,
        e.payload
      FROM helix_environment_command_authorities a
      JOIN helix_environment_command_catalog_snapshots c
        ON c.command_authority_id = a.command_authority_id
      JOIN helix_environment_command_requests q
        ON q.command_authority_id = a.command_authority_id
      JOIN helix_environment_command_results r
        ON r.command_request_id = q.command_request_id
      JOIN helix_environment_command_events e
        ON e.command_request_id = q.command_request_id;
    `);
    expect(jsonRestored.rows[0]).toMatchObject({
      approved_categories: ["query"],
      catalog_summary: { root_commands: ["time"] },
      result_payload: { summary: "The time is 1000." },
      payload: { outcome: "succeeded" },
    });
    // Seed temporal evidence against the restored real FK graph, then restart
    // again. This tests persistence only, not plan validity or action admission.
    const insert = async (table: string, row: Record<string, unknown>) => {
      const columns = Object.keys(row);
      await getPool().query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(row).map(value => value instanceof Date ? value.toISOString()
          : value !== null && typeof value === "object" ? JSON.stringify(value) : value));
    };
    const authority = (await getPool().query("SELECT * FROM helix_environment_action_authorities")).rows[0];
    const hash = `sha256:${"a".repeat(64)}`;
    const identity = Object.fromEntries(["action_authority_id", "environment_binding_id", "room_id", "source_id", "world_id", "participant_id", "subject_binding_id", "subject_native_id"].map(key => [key, authority[key]]));
    await insert("helix_environment_capability_catalog_snapshots", {
      catalog_snapshot_id: "catalog:temporal-persistence", environment_binding_id: authority.environment_binding_id,
      catalog_hash: hash, adapter_profile_id: "game.minecraft.player.fabric.v1", adapter_profile_version: 1,
      adapter_contract_hash: hash, manifest_hash: hash, capability_descriptors: [],
    });
    await insert("helix_environment_action_connector_manifests", {
      ...identity, manifest_id: "manifest:temporal-persistence", connector_installation_id: "installation:command-persistence",
      producer_epoch_ref: "epoch:persistence", domain: "minecraft", domain_adapter: "minecraft.fabric_client.v1",
      adapter_profile_id: "game.minecraft.player.fabric.v1", adapter_version: "test", protocol_version: "1",
      manifest_hash: hash, capabilities: [], available_control_engines: ["native_fabric"], safety_policy: {},
    });
    await insert("helix_environment_action_requests", {
      ...identity, action_request_id: "action:temporal-persistence", workflow_id: "workflow:temporal-persistence",
      connector_manifest_id: "manifest:temporal-persistence", catalog_snapshot_id: "catalog:temporal-persistence",
      run_id: "run:persistence", turn_id: "turn:temporal-persistence", provider_execution_id: "execution:persistence",
      tool_call_id: "call:persistence", capability_id: "com.casimirbot.minecraft.player.sequence.execute", capability_version: 1,
      action_kind: "execute_sequence", effect_class: "continuous_control", workflow_mode: "long_running",
      requested_control_engine: "native_fabric", request_payload: { fixture: true }, request_hash: hash,
      idempotency_key: "temporal:persistence", confirmation_state: "not_required", policy_version: 1,
      status: "canceled", deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await insert("helix_environment_temporal_frontiers", {
      frontier_id: "frontier:persistence", goal_id: "environment_durable_goal:persistence", goal_revision: 1,
      frontier_revision: 1, observation_evidence_ref: "observation:persistence",
      observation_producer_epoch_ref: "observation-epoch:persistence", action_producer_epoch_ref: "epoch:persistence",
      identity_hash: hash, payload_hash: hash, frontier_payload: { capabilities: ["walk"], execution_authority: false },
      observed_at: new Date().toISOString(), retained_until: new Date(Date.now() + 60_000).toISOString(),
    });
    const retainedPlan = {
      plan_id: "plan:persistence", plan_hash: hash, source_plan: { nodes: [{ id: "checkpoint" }] },
      compilation_hash: hash, compilation_artifact: { arguments: { sequence_id: "sequence:persistence" } },
      action_request_id: "action:temporal-persistence", resident_action_request_id: "action:temporal-persistence",
      frontier_id: "frontier:persistence", goal_id: "environment_durable_goal:persistence", goal_revision: 1,
      reasoning_binding_id: "binding:persistence", reasoning_binding_epoch: 1,
      client_continuation_ref: "continuation:persistence",
      checkpoint_association: { event_id: "event:persistence", evidence_refs: ["evidence:persistence"] },
    };
    await insert("helix_environment_temporal_plan_admissions", retainedPlan);
    const originalAction = (await getPool().query("SELECT * FROM helix_environment_action_requests WHERE action_request_id='action:temporal-persistence'")).rows[0];
    const chain = [retainedPlan];
    for (let index = 1; index <= 3; index++) {
      const actionId = `action:temporal-successor-${index}`;
      await insert("helix_environment_action_requests", { ...originalAction,
        action_request_id: actionId, workflow_id: `workflow:successor-${index}`,
        status: index === 1 ? "admitted" : "canceled",
        request_payload: { temporal_plan: { plan_id: `plan:successor-${index}` } },
        tool_call_id: `call:successor-${index}`, idempotency_key: `successor-${index}` });
      const previous = chain.at(-1)!;
      const successor = { ...retainedPlan, plan_id: `plan:successor-${index}`,
        action_request_id: actionId, previous_plan_id: previous.plan_id,
        previous_plan_hash: previous.plan_hash };
      await insert("helix_environment_temporal_plan_admissions", successor);
      chain.push(successor);
    }
    // Real schema + production lease CAS + strict disk barrier. Earlier
    // admission/authorization is seeded, not proven by this persistence test.
    await withSharedRealtimeRoomTransaction(async client => {
      const leased = await client.query(temporalSuccessorLeaseSql,
        ["action:temporal-successor-1", new Date(Date.now() + 30000).toISOString()]);
      expect(leased.rows).toHaveLength(1);
    }, { requireLocalSnapshot: true });
    const savedLease = JSON.parse(fs.readFileSync(snapshotPath, "utf8")).tables.helix_environment_action_requests
      .find((row: any) => row.action_request_id === "action:temporal-successor-1");
    expect(savedLease).toMatchObject({ status: "leased", attempt_count: 1 });
    await flushLocalDatabaseSnapshotIfEnabled();
    await resetDbClient();
    // SQL row order is not a dependency contract. A child-first snapshot must
    // restore the exact chain without dropping children or guessing parents.
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    snapshot.tables.helix_environment_temporal_plan_admissions.reverse();
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    await ensureDatabase();
    const restoredPlans = (await getPool().query("SELECT * FROM helix_environment_temporal_plan_admissions")).rows;
    expect(restoredPlans).toHaveLength(4);
    expect(restoredPlans).toEqual(expect.arrayContaining(chain.map(plan => expect.objectContaining(plan))));
    expect((await getPool().query("SELECT frontier_payload FROM helix_environment_temporal_frontiers")).rows).toEqual([
      { frontier_payload: { capabilities: ["walk"], execution_authority: false } },
    ]);
    expect((await getPool().query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='action:temporal-persistence'")).rows[0].status).toBe("canceled");
    expect((await getPool().query("SELECT status,attempt_count FROM helix_environment_action_requests WHERE action_request_id='action:temporal-successor-1'")).rows[0])
      .toMatchObject({ status: "leased", attempt_count: 1 });
    await getPool().query(closeTemporalEpochGapSql, [authority.action_authority_id, "epoch:replacement"]);
    await requireLocalDatabaseSnapshotIfEnabled(["helix_environment_action_requests"]);
    await resetDbClient();
    await ensureDatabase();
    expect((await getPool().query("SELECT status,attempt_count,cancellation_reason FROM helix_environment_action_requests WHERE action_request_id='action:temporal-successor-1'")).rows[0])
      .toMatchObject({ status: "connector_offline", attempt_count: 1,
        cancellation_reason: "producer_epoch_replaced_evidence_incomplete_no_replay" });
    const durableJsonRestored = await getPool().query<{
      objective_payload: unknown;
      scopes: unknown;
      event_payload: unknown;
      payload: unknown;
      evidence_refs: unknown;
    }>(`
      SELECT g.objective_payload, p.scopes, e.event_payload, e.payload,
             e.evidence_refs
      FROM helix_environment_durable_goals g
      JOIN helix_environment_durable_goal_participants p
        ON p.goal_id = g.goal_id
      JOIN helix_environment_durable_goal_events e
        ON e.goal_id = g.goal_id
      WHERE g.goal_id = 'environment_durable_goal:persistence';
    `);
    expect(durableJsonRestored.rows[0]).toMatchObject({
      objective_payload: { objective_text: "Survive restart" },
      scopes: ["read", "steer"],
      event_payload: { kind: "goal_created" },
      payload: { kind: "goal_created" },
      evidence_refs: [],
    });
  }, 30_000);

  it("restores large snapshots in batches and discards expired room ingress requests", async () => {
    vi.stubEnv("HELIX_LOCAL_PG_MEM_ROOM_SOURCE_REQUEST_MAX_ROWS_PER_BINDING", "128");
    const now = Date.now();
    const ownerProfileId = "profile:local-restore-owner";
    const roomId = "shared_realtime_room:local-restore";
    const bindingId = "room_source_binding:local-restore";
    const credentialId = "room_source_credential:local-restore";
    const accounts = Array.from({ length: 601 }, (_, index) => ({
      profile_id: index === 0 ? ownerProfileId : `profile:local-restore-${index}`,
      display_name: `Local restore ${index}`,
      email: null,
      account_type: "user",
      provider: "local",
      provider_subject: null,
      picture_url: null,
      deleted_at: null,
      created_at: new Date(now - 60_000).toISOString(),
      updated_at: new Date(now - 60_000).toISOString(),
    }));
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        schema: "helix.local_pg_mem_snapshot.v1",
        saved_at: new Date(now).toISOString(),
        tables: {
          helix_accounts: accounts,
          helix_shared_realtime_rooms: [{
            room_id: roomId,
            owner_profile_id: ownerProfileId,
            title: "Local restore room",
            status: "waiting_for_participant",
            max_participants: 2,
            created_at: new Date(now - 60_000).toISOString(),
            updated_at: new Date(now - 60_000).toISOString(),
            closed_at: null,
          }],
          helix_room_source_bindings: [{
            binding_id: bindingId,
            room_id: roomId,
            owner_profile_id: ownerProfileId,
            source_id: "source:room-ingress:local-restore",
            world_id: "minecraft:local:restore",
            domain_adapter: "minecraft.fabric_mod.v1",
            source_label: "Local restore source",
            scopes: ["environment:observe"],
            status: "active",
            created_at: new Date(now - 60_000).toISOString(),
            updated_at: new Date(now - 60_000).toISOString(),
            revoked_at: null,
          }],
          helix_room_source_credentials: [{
            credential_id: credentialId,
            binding_id: bindingId,
            token_hash: "local-restore-token-hash",
            token_prefix: "local_restore",
            status: "active",
            created_at: new Date(now - 60_000).toISOString(),
            expires_at: new Date(now + 60_000).toISOString(),
            revoked_at: null,
          }],
          helix_room_source_ingress_requests: [
            ...Array.from({ length: 130 }, (_, index) => ({
              binding_id: bindingId,
              credential_id: credentialId,
              request_id: `request:fresh:${index.toString().padStart(3, "0")}`,
              producer_epoch: "epoch:fresh",
              sequence_number: String(index + 1),
              route_key: "heartbeat",
              body_digest: `digest:fresh:${index}`,
              sent_at: new Date(now - index * 1_000).toISOString(),
              received_at: new Date(now - index * 1_000).toISOString(),
              response_status: 200,
              response_receipt: { ok: true },
            })),
            {
              binding_id: bindingId,
              credential_id: credentialId,
              request_id: "request:expired",
              producer_epoch: "epoch:expired",
              sequence_number: "2",
              route_key: "heartbeat",
              body_digest: "digest:expired",
              sent_at: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
              received_at: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
              response_status: 200,
              response_receipt: { ok: true },
            },
          ],
        },
      }),
      "utf8",
    );

    await resetDbClient();
    await ensureDatabase();
    const pool = getPool();
    const accountsResult = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM helix_accounts;",
    );
    const requestsResult = await pool.query<{ request_id: string }>(
      "SELECT request_id FROM helix_room_source_ingress_requests ORDER BY request_id;",
    );

    expect(Number(accountsResult.rows[0]?.count)).toBe(601);
    expect(requestsResult.rows).toHaveLength(128);
    expect(requestsResult.rows.map((row) => row.request_id)).not.toContain(
      "request:fresh:129",
    );
    expect(requestsResult.rows.map((row) => row.request_id)).not.toContain(
      "request:expired",
    );
  });

  it("restores guest policy and valid environment rows around an orphaned adapter admission", async () => {
    vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_IDLE_FLUSH_MS", "60000");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_MAX_FLUSH_MS", "60000");
    const now = Date.now();
    const profileId = "guest:local-restart-owner";
    const roomId = "shared_realtime_room:local-restart-owner";
    const bindingId = "room_source_binding:local-restart-owner";
    const credentialId = "room_source_credential:local-restart-owner";
    const admission = (admissionId: string, selectedCredentialId: string) => ({
      admission_id: admissionId,
      binding_id: bindingId,
      credential_id: selectedCredentialId,
      producer_epoch: admissionId,
      room_id: roomId,
      source_id: "source:room-ingress:local-restart-owner",
      world_id: "minecraft:local:restart-owner",
      domain_adapter: "minecraft.fabric_mod.v1",
      adapter_profile_id: "game.minecraft.readonly.v1",
      adapter_profile_version: 1,
      adapter_contract_hash: `sha256:${"a".repeat(64)}`,
      manifest_id: `manifest:${admissionId}`,
      manifest_hash: `sha256:${"b".repeat(64)}`,
      source_family: "minecraft",
      mechanics_collection_ids: ["mechanics.minecraft.java.v1"],
      status: "active",
      admitted_at: new Date(now - 10_000).toISOString(),
      updated_at: new Date(now - 10_000).toISOString(),
      revoked_at: null,
    });
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        schema: "helix.local_pg_mem_snapshot.v1",
        saved_at: new Date(now).toISOString(),
        tables: {
          helix_accounts: [{
            profile_id: profileId,
            display_name: "Local restart owner",
            email: null,
            account_type: "user",
            provider: "guest",
            provider_subject: profileId,
            picture_url: null,
            deleted_at: null,
            created_at: new Date(now - 60_000).toISOString(),
            updated_at: new Date(now - 60_000).toISOString(),
          }],
          helix_account_sessions: [{
            session_id: "account_session:local-restart-owner",
            profile_id: profileId,
            status: "active",
            memory_scope: "session_only",
            account_policy: {
              account_type: "user",
              feature_flags: ["shared_realtime_rooms", "room_source_ingress"],
              locked_features: [],
              allowed_panels: [],
              allowed_workstation_capabilities: [],
            },
            created_at: new Date(now - 60_000).toISOString(),
            updated_at: new Date(now - 60_000).toISOString(),
            expires_at: new Date(now + 60_000).toISOString(),
          }],
          helix_shared_realtime_rooms: [{
            room_id: roomId,
            owner_profile_id: profileId,
            title: "Local restart room",
            status: "waiting_for_participant",
            max_participants: 2,
            created_at: new Date(now - 60_000).toISOString(),
            updated_at: new Date(now - 60_000).toISOString(),
            closed_at: null,
          }],
          helix_shared_realtime_room_members: [{
            room_id: roomId,
            slot_number: 1,
            profile_id: profileId,
            participant_id: "shared_realtime_participant:local-restart-owner",
            member_role: "owner",
            presence: "present",
            consent: {},
            joined_at: new Date(now - 60_000).toISOString(),
            updated_at: new Date(now - 60_000).toISOString(),
            left_at: null,
          }],
          helix_room_source_bindings: [{
            binding_id: bindingId,
            room_id: roomId,
            owner_profile_id: profileId,
            source_id: "source:room-ingress:local-restart-owner",
            world_id: "minecraft:local:restart-owner",
            domain_adapter: "minecraft.fabric_mod.v1",
            source_label: "Local restart Fabric source",
            scopes: ["environment:observe"],
            status: "active",
            created_at: new Date(now - 60_000).toISOString(),
            updated_at: new Date(now - 60_000).toISOString(),
            revoked_at: null,
          }],
          helix_room_source_credentials: [{
            credential_id: credentialId,
            binding_id: bindingId,
            token_hash: "local-restart-owner-token-hash",
            token_prefix: "local_restart",
            status: "active",
            created_at: new Date(now - 60_000).toISOString(),
            expires_at: new Date(now + 60_000).toISOString(),
            revoked_at: null,
          }],
          helix_environment_adapter_admissions: [
            admission(
              "environment_adapter_admission:local-restart-valid",
              credentialId,
            ),
            admission(
              "environment_adapter_admission:local-restart-orphan",
              "room_source_credential:missing-parent",
            ),
          ],
        },
      }),
      "utf8",
    );

    await resetDbClient();
    await ensureDatabase();
    const restored = await getPool().query<Record<string, string>>(`
      SELECT
        (SELECT count(*)::text FROM helix_account_sessions
          WHERE session_id = 'account_session:local-restart-owner') AS sessions,
        (SELECT count(*)::text FROM helix_room_source_bindings
          WHERE binding_id = 'room_source_binding:local-restart-owner'
            AND status = 'active') AS bindings,
        (SELECT count(*)::text FROM helix_environment_adapter_admissions
          WHERE admission_id = 'environment_adapter_admission:local-restart-valid') AS valid_admissions,
        (SELECT count(*)::text FROM helix_environment_adapter_admissions
          WHERE admission_id = 'environment_adapter_admission:local-restart-orphan') AS orphan_admissions;
    `);
    const counts = Object.fromEntries(
      Object.entries(restored.rows[0]).map(([key, value]) => [
        key,
        Number(Array.isArray(value) ? value[0] : value),
      ]),
    );
    expect(counts).toMatchObject({
      sessions: 1,
      bindings: 1,
      valid_admissions: 1,
      orphan_admissions: 0,
    });

    await flushLocalDatabaseSnapshotIfEnabled();
    const pruned = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
      tables: Record<string, Array<Record<string, unknown>>>;
    };
    expect(pruned.tables.helix_environment_adapter_admissions).toHaveLength(1);
  });
});
