import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { migration087 } from "../../db/migrations/087_pairing_ledger";
import { migration088 } from "../../db/migrations/088_pairing_destinations";
import { migration089 } from "../../db/migrations/089_pairing_destination_identity";
import { PairingLedgerRepository } from "../../services/local-supervisor/pairing-ledger-repository";
import { PairingDestinationRegistrationStore } from "../../services/local-supervisor/pairing-destination-registration";
import { PairingTransitionService } from "../../services/local-supervisor/pairing-transition-service";
import { DurableReasoningBindingAccess } from "../../services/local-supervisor/durable-reasoning-binding-access";
import { ephemeralPairingVault } from "../../services/local-supervisor/__tests__/pairing-vault-fixture";
import { HelixReasoningTaskBindingStore } from "../../services/local-supervisor/reasoning-task-binding-store";
import { createAgentConnectionsRouter } from "../agent-connections";
let fixturePool: Pool;
vi.mock("../../db/client", async importOriginal => ({
  ...await importOriginal<typeof import("../../db/client")>(),
  ensureDatabase: async () => {}, getPool: () => fixturePool,
}));
const nativeIssuer = "urn:casimirbot:desktop-session";
const owner = "fixture-native-owner";
const browserSession = "account_session:fixture-browser";
const delegatedSession = "account_session:fixture-delegated";
const device = "desktop_device_abcdefghijklmnopqrstuv";
const opaque = (prefix: string, value: string) => `${prefix}:${crypto.createHash("sha256").update(value).digest("hex")}`;
const actor = { issuer: opaque("issuer", nativeIssuer), profileId: owner,
  installationId: opaque("installation", device),
  clientId: opaque("mcp_client:native_desktop", `${device}\n${owner}\n${delegatedSession}`), taskId: "fixture-native-task" };
afterEach(async () => { await fixturePool?.end(); vi.unstubAllEnvs(); });

async function harness(destination = actor) {
  fixturePool = new (newDb().adapters.createPg().Pool)();
  await fixturePool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await fixturePool.query("INSERT INTO helix_accounts VALUES ($1)", [owner]);
  const client = await fixturePool.connect();
  try { for (const migration of [migration087, migration088, migration089]) await migration.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  await fixturePool.query(`CREATE TABLE helix_agent_runs(run_id text,tenant_id text,issuer text,subject_id text,
    account_profile_id text,lifecycle_status text,expires_at timestamptz,cancelled_at timestamptz,
    completed_at timestamptz,steps_used integer,max_steps integer)`);
  await fixturePool.query(`CREATE TABLE helix_agent_run_room_bindings(run_id text,tenant_id text,issuer text,
    subject_id text,account_profile_id text,status text,room_id text,participant_id_at_bind text)`);
  await fixturePool.query("INSERT INTO helix_agent_runs VALUES ('fixture-run','fixture-tenant',$1,'fixture-subject',$2,'waiting','2099-01-01',NULL,NULL,0,10)", [nativeIssuer, owner]);
  await fixturePool.query("INSERT INTO helix_agent_run_room_bindings VALUES ('fixture-run','fixture-tenant',$1,'fixture-subject',$2,'active','fixture-room','fixture-participant')", [nativeIssuer, owner]);
  vi.stubEnv("HELIX_DESKTOP_DEVICE_ID", device);
  const vault = ephemeralPairingVault();
  const repository = new PairingLedgerRepository(fixturePool, vault, async () => {});
  const registrations = new PairingDestinationRegistrationStore(fixturePool, async () => {}, () => new Date(), vault);
  const registration = await registrations.registerAuthenticated(destination, { requestId: "fixture-native-registration", durationSeconds: 900 });
  const link = { binding_ref: "fixture-link", issuer: "https://external.example/", status: "active" };
  const listBindings = vi.fn(async () => ({ schema: "helix.agent_account_bindings.v1", oauth_ready: true, bindings: [link] }));
  const resolveSession = vi.fn(async (id?: string | null) => [browserSession, delegatedSession].includes(id ?? "")
    ? { session_id: id!, profile: { profile_id: owner } } : null);
  const trust = vi.fn(async () => ({ trusted: true, delegated_account_session_id: delegatedSession }));
  const presence = { serviceInstanceRef: "fixture-service", listPresence: () => [] };
  const runtimeStore = new HelixReasoningTaskBindingStore(presence);
  const app = express();
  app.use("/api/account", createAgentConnectionsRouter({ coordinationStore: presence,
    reasoningBindingStore: runtimeStore,
    bindingStore: { listBindings } as never, resolveSession,
    destinationRegistrationStore: registrations, pairingLedgerRepository: repository,
    readPairingDeviceTrust: trust as never,
    readPreparationMembership: async () => ({ participantId: "fixture-participant", roomStatus: "open" }) as never,
  }));
  const body = { requestId: "fixture-native-human-approved-request", registrationId: registration.registrationId,
    chatId: "fixture-chat", environment: { roomId: "fixture-room", runId: "fixture-run" }, invitationSeconds: 900, pairingSeconds: 28800 };
  const issue = (value = body) => request(app).post("/api/account/session/agent-connections/reasoning-invitations")
    .set("Cookie", `helix_session=${browserSession}`).send(value);
  return { app, repository, registrations, runtimeStore, link, listBindings, resolveSession, trust, body, issue };
}

it("issues the actual native run with its native issuer, replays once, and revalidates accepted browser access", async () => {
  const h = await harness();
  const first = await h.issue();
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect((await h.issue()).body).toEqual(first.body);
  expect((await fixturePool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(1);
  const transitions = new PairingTransitionService(h.repository, { destination: async () => actor, humanOwner: async () => owner });
  await transitions.accept("fixture-authenticated-provider", first.body.invitation);
  const restored = await new DurableReasoningBindingAccess(h.runtimeStore, async authenticated => {
    expect(authenticated).toEqual(actor);
  }, async () => h.repository).restore({ destination: actor, pairingId: first.body.pairing.id,
    clientSessionRef: "fixture-runtime-client-session" });
  const current = () => request(h.app).get("/api/account/session/agent-connections/reasoning-bindings/current?helix_conversation_id=fixture-chat")
    .set("Cookie", `helix_session=${browserSession}`);
  expect((await current()).status).toBe(200);
  const mirror = (body: Record<string, unknown>) => request(h.app)
    .post(`/api/account/session/agent-connections/reasoning-bindings/${restored.reasoning_binding_id}/codex-mirror-target`)
    .set("Cookie", `helix_session=${browserSession}`).send(body);
  expect((await mirror({ helix_conversation_id: "fixture-chat",
    approve_visible_transcript_read: true })).body).toMatchObject({
      task_id: actor.taskId, binding_id: restored.reasoning_binding_id,
      read_scope: "user_visible_messages_only", room_visible: false });
  expect((await mirror({ helix_conversation_id: "fixture-chat" })).status).toBe(400);
  expect((await mirror({ helix_conversation_id: "another-chat",
    approve_visible_transcript_read: true })).status).toBe(409);
  h.link.status = "revoked";
  expect((await current()).body.error).toBe("pairing_account_link_required");
  expect((await mirror({ helix_conversation_id: "fixture-chat",
    approve_visible_transcript_read: true })).body.error).toBe("pairing_account_link_required");
  expect((await h.issue()).body.error).toBe("pairing_account_link_required");
});

it.each(["absent_link", "revoked_link", "expired_delegation", "foreign_delegation", "wrong_delegation", "untrusted"])("rejects native issuance with %s and writes no pairing", async fault => {
  const h = await harness();
  if (fault === "absent_link") h.listBindings.mockResolvedValue({ schema: "helix.agent_account_bindings.v1", oauth_ready: false, bindings: [] });
  if (fault === "revoked_link") h.link.status = "revoked";
  if (fault === "expired_delegation") h.resolveSession.mockImplementation(async id => id === browserSession ? { session_id: id, profile: { profile_id: owner } } : null);
  if (fault === "foreign_delegation") h.resolveSession.mockImplementation(async id => ({ session_id: id!, profile: { profile_id: id === delegatedSession ? "fixture-foreign" : owner } }));
  if (fault === "wrong_delegation") h.trust.mockResolvedValue({ trusted: true, delegated_account_session_id: browserSession });
  if (fault === "untrusted") h.trust.mockResolvedValue({ trusted: false, delegated_account_session_id: delegatedSession });
  const denied = await h.issue();
  expect(denied.status).toBe(403);
  expect((await fixturePool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(0);
});

it.each(["wrong_native_client", "oauth_client_with_native_issuer", "foreign_oauth_issuer", "oauth_run"])("keeps issuer/client/run namespaces distinct: %s", async fault => {
  const destination = { ...actor };
  if (fault === "wrong_native_client") destination.clientId = opaque("mcp_client:native_desktop", "fixture-foreign");
  if (fault === "oauth_client_with_native_issuer") destination.clientId = "mcp_client:oauth:fixture";
  if (fault === "foreign_oauth_issuer") destination.issuer = opaque("issuer", "https://foreign.example/");
  const h = await harness(destination);
  if (fault === "oauth_run") {
    await fixturePool.query("UPDATE helix_agent_runs SET issuer=$1", [h.link.issuer]);
    await fixturePool.query("UPDATE helix_agent_run_room_bindings SET issuer=$1", [h.link.issuer]);
  }
  const denied = await h.issue();
  expect(denied.status).toBe(fault === "oauth_run" ? 409 : 403);
  expect((await fixturePool.query("SELECT * FROM helix_pairing_ledger")).rows).toHaveLength(0);
});
