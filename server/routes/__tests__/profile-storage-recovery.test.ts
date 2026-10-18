import express from "express";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { accountSessionRouter } from "../account-session";
import { resetAccountSessionStore } from "../../services/helix-account/account-session-store";
import { startDesktopProviderCredentialBroker } from "../../../apps/desktop/src/provider-credential-broker";
import { getPool } from "../../db/client";
import {writeProfileStorageSnapshot} from '../../services/helix-account/profile-storage-store';

afterEach(() => vi.unstubAllEnvs());

it("O5 real profile handlers report unavailable protection and recover without clearing saved data", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
  await resetAccountSessionStore();
  const broker = await startDesktopProviderCredentialBroker({
    keyring: { activeKey: randomBytes(32).toString("base64url"), retiredKeys: [] },
  });
  try {
    vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN", broker.origin);
    vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN", broker.token);
    const app = express();
    app.use(express.json());
    app.use("/api/account", accountSessionRouter);
    const agent = request.agent(app);
    const owner = "profile:isolated-recovery";
    await agent.post("/api/account/session/sign-in").send({ profile_id: owner }).expect(200);
    const value = JSON.stringify({ state: { activeId: "fixture-chat", sessions: {} } });
    await agent.post("/api/account/profile-storage/snapshot").send({
      expected_profile_id: owner,
      artifacts: [{ schema: "helix.workspace_memory_registry.v1", artifact_id: "fixture-chat",
        artifact_type: "helix_chat_session", owner_scope: "profile", storage_backend: "localStorage",
        storage_key: "agi-chat-sessions-v1", sync_status: "profile_synced", profile_id: owner,
        updated_at: new Date().toISOString() }],
      entries: [{ storage_key: "agi-chat-sessions-v1", storage_backend: "localStorage", value,
        size_bytes: value.length, updated_at: new Date().toISOString(), artifact_ids: ["fixture-chat"] }],
    }).expect(200);
    const before = await getPool().query("SELECT encrypted_snapshot FROM helix_account_profile_storage WHERE profile_id=$1", [owner]);
    vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN", "fixture-unavailable-protection");
    for (const endpoint of ["snapshot", "export"]) {
      await request(app).get(`/api/account/profile-storage/${endpoint}`).expect(401);
      const response = await agent.get(`/api/account/profile-storage/${endpoint}`).expect(503);
      expect(response.body).toMatchObject({ ok: false, error: "profile_storage_restore_unavailable",
        raw_profile_content_included: false });
      expect(response.body).not.toHaveProperty("entries");
      expect(response.body).not.toHaveProperty("snapshot");
      expect(JSON.stringify(response.body)).not.toContain("fixture-unavailable-protection");
      expect(JSON.stringify(response.body)).not.toContain(value);
    }
    const after = await getPool().query("SELECT encrypted_snapshot FROM helix_account_profile_storage WHERE profile_id=$1", [owner]);
    expect(after.rows).toEqual(before.rows);
    const refusedBackup=await agent.post('/api/account/profile-storage/snapshot').send({
      expected_profile_id:owner,entries:[],artifacts:[],
    }).expect(503);
    expect(refusedBackup.body.error).toBe('profile_storage_restore_unavailable');
    expect((await getPool().query('SELECT encrypted_snapshot FROM helix_account_profile_storage WHERE profile_id=$1',[owner])).rows)
      .toEqual(before.rows);
    vi.stubEnv("HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN", broker.token);
    const restored = await agent.get("/api/account/profile-storage/snapshot").expect(200);
    expect(restored.body.entries[0].value).toBe(value);
    const retainedKey=`solar-research-record:solar-primary:${'a'.repeat(64)}`;
    // Reserved namespace fixture tests preservation only, never numerical evidence.
    const retainedValue='UI_FIXTURE_NOT_SCIENTIFIC_EVIDENCE';
    const updated_at=new Date().toISOString();
    await writeProfileStorageSnapshot({profile_id:owner,snapshot:{
      entries:[...restored.body.entries,{storage_key:retainedKey,storage_backend:'localStorage',value:retainedValue,
        size_bytes:retainedValue.length,updated_at,artifact_ids:['retained-fixture']}],
      artifacts:[...restored.body.artifacts,{schema:'helix.workspace_memory_registry.v1',artifact_id:'retained-fixture',
        artifact_type:'linked_source',owner_scope:'profile',storage_backend:'localStorage',sync_status:'profile_candidate',
        profile_id:owner,chat_session_id:null,title:'Storage fixture',storage_key:retainedKey,updated_at}]
    }});
    await agent.post('/api/account/profile-storage/snapshot').send({expected_profile_id:owner,
      entries:[...restored.body.entries,{storage_key:retainedKey,storage_backend:'localStorage',value:'attempted overwrite',
        size_bytes:19,updated_at,artifact_ids:['retained-fixture']}],artifacts:restored.body.artifacts}).expect(200);
    const preserved=await agent.get('/api/account/profile-storage/snapshot').expect(200);
    expect(preserved.body.entries.find((entry:any)=>entry.storage_key===retainedKey)?.value).toBe(retainedValue);
    // Establish the new protected snapshot as the unchanged baseline for account-switch checks.
    before.rows=(await getPool().query('SELECT encrypted_snapshot FROM helix_account_profile_storage WHERE profile_id=$1',[owner])).rows;
    const exported = await agent.get("/api/account/profile-storage/export").expect(200);
    expect(exported.body.snapshot.entries[0].value).toBe(value);
    await agent.post("/api/account/session/sign-in").send({ profile_id: "profile:other-recovery" }).expect(200);
    const staleWrite = await agent.post("/api/account/profile-storage/snapshot").send({
      expected_profile_id: owner, entries: restored.body.entries, artifacts: restored.body.artifacts,
    }).expect(409);
    expect(staleWrite.body).toMatchObject({ ok: false, error: "profile_storage_account_changed",
      raw_profile_content_included: false });
    expect((await agent.get("/api/account/profile-storage/snapshot").expect(200)).body.entries).toEqual([]);
    for (const expected_profile_id of [undefined, "", [], 1]) {
      const malformed = await agent.post("/api/account/profile-storage/snapshot").send({
        expected_profile_id, entries: restored.body.entries, artifacts: restored.body.artifacts,
      }).expect(400);
      expect(malformed.body.error).toBe("profile_storage_expected_profile_required");
    }
    expect((await getPool().query("SELECT encrypted_snapshot FROM helix_account_profile_storage WHERE profile_id=$1", [owner])).rows).toEqual(before.rows);
  } finally {
    await broker.close();
  }
}, 20_000);
