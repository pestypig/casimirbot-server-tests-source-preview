import express from "express";
import request from "supertest";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { migration026 } from "../../db/migrations/026_helix_accounts";
import { migration070 } from "../../db/migrations/070_installed_security_devices";
import { migration081 } from "../../db/migrations/081_installed_device_full_harness_trust";
import { InstalledSecurityStore } from "../../services/helix-account/installed-security-store";
import { DesktopMcpTunnelTransitionStore } from "../../services/local-supervisor/desktop-mcp-tunnel-transition-store";

const { resolveSession } = vi.hoisted(() => ({ resolveSession: vi.fn() }));
vi.mock("../../services/helix-account/account-session-store", () => ({
  getAccountSessionById: resolveSession,
}));
import { createDesktopMcpTunnelTransitionRouter } from "../desktop-mcp-tunnel-transition";

describe("O5 device trust through the real route and registration store", () => {
  it("preserves the missing-device reason for a signed-in developer, then accepts only after registration", async () => {
    const now = new Date("2026-09-13T21:00:00Z");
    const owner = { sessionId: "fixture-session", profileId: "fixture-profile" };
    const deviceId = "desktop_device_AAAAAAAAAAAAAAAAAAAAAA";
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const pool = new (memory.adapters.createPg().Pool)() as unknown as Pool;
    const client = await pool.connect();
    try {
      for (const migration of [migration026, migration070, migration081]) {
        await migration.run(client, { enablePgvector: false });
      }
    } finally { client.release(); }
    try {
      await pool.query(`INSERT INTO helix_accounts
        (profile_id, display_name, account_type, provider, created_at, updated_at)
        VALUES ($1, 'Fixture', 'developer', 'local', $2, $2)`, [owner.profileId, now.toISOString()]);
      await pool.query(`INSERT INTO helix_account_sessions
        (session_id, profile_id, status, memory_scope, account_policy, created_at, updated_at, expires_at)
        VALUES ($1, $2, 'active', 'profile', $3::jsonb, $4, $4, $5)`,
      [owner.sessionId, owner.profileId, JSON.stringify({ account_type: "developer" }),
        now.toISOString(), new Date(now.getTime() + 3_600_000).toISOString()]);
      resolveSession.mockResolvedValue({ session_id: owner.sessionId, status: "active",
        profile: { profile_id: owner.profileId }, account_policy: { account_type: "developer" } });
      let event = 0;
      const security = new InstalledSecurityStore({ pool, now: () => now,
        randomId: () => `fixture-event-${++event}`, persist: async () => undefined });
      const app = express();
      app.use("/trust", createDesktopMcpTunnelTransitionRouter({
        store: new DesktopMcpTunnelTransitionStore("service_instance:fixture-trust"),
        installedSecurityStore: security, desktopDeviceId: deviceId, desktopHostEnabled: true,
      }));
      const headers = { Cookie: `helix_session=${owner.sessionId}`, Origin: "http://127.0.0.1",
        Host: "127.0.0.1", "Sec-Fetch-Site": "same-origin" };
      const put = (revision = 0, trusted = true) => request(app).put("/trust/full-harness-trust")
        .set(headers).send({ trusted, expected_policy_revision: revision });
      const initial = await request(app).get("/trust/full-harness-trust").set(headers);
      expect(initial.status).toBe(200);
      expect(initial.body.trust.trusted).toBe(false);
      const missing = await put();
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ ok: false, error: "device_not_registered",
        environment_authority_granted: false, answer_authority: false });
      expect((await pool.query("SELECT * FROM helix_installed_devices")).rows).toHaveLength(0);
      // Isolated fixture registration. Production still requires its MFA receipt.
      await security.registerDevice({ session: owner, deviceId });
      const unreviewed = await request(app).put("/trust/full-harness-trust").set(headers).send({ trusted: true });
      expect(unreviewed.status).toBe(400);
      expect((await security.inspectFullHarnessTrust({ profileId: owner.profileId, deviceId })).policy_revision).toBe(0);
      const accepted = await put();
      expect(accepted.status).toBe(200);
      expect(accepted.body.trust).toMatchObject({ trusted: true, policy_revision: 1,
        environment_authority_granted: false, trading_authority_granted: false });
      const duplicate = await put();
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error).toBe("device_trust_revision_changed");
      expect((await put(1, false)).body.trust).toMatchObject({ trusted: false, policy_revision: 2 });
      const delayed = await put();
      expect(delayed.status).toBe(409);
      expect((await security.inspectFullHarnessTrust({ profileId: owner.profileId, deviceId })))
        .toMatchObject({ trusted: false, policy_revision: 2 });
      await security.revokeDevice({ session: owner, deviceId });
      const revoked = await put();
      expect(revoked.status).toBe(404);
      expect(revoked.body.error).toBe("device_not_registered");
      for (const response of [missing, accepted, revoked]) {
        expect(JSON.stringify(response.body)).not.toContain(owner.sessionId);
        expect(JSON.stringify(response.body)).not.toContain(deviceId);
      }
    } finally { await pool.end(); }
  });
});
