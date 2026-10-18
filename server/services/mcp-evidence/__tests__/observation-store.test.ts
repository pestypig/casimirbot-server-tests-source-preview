import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { migration026 } from "../../../db/migrations/026_helix_accounts";
import { migration074 } from "../../../db/migrations/074_mcp_evidence_observations";
import { getHelixMcpEvidenceCapabilityDescriptor } from
  "@shared/helix-mcp-evidence-capability-registry";
import { buildHelixMcpEvidenceObservation } from "../observation";
import {
  HelixMcpEvidenceObservationStore,
  HelixMcpEvidenceObservationStoreError,
} from "../observation-store";

const OWNER = { tenantId: "tenant-a", accountProfileId: "profile-a" } as const;
const OTHER_OWNER = { tenantId: "tenant-a", accountProfileId: "profile-b" } as const;
const OTHER_TENANT = { tenantId: "tenant-b", accountProfileId: "profile-a" } as const;
const NOW = new Date("2026-08-29T12:00:00.000Z");

const descriptor = getHelixMcpEvidenceCapabilityDescriptor("helix_public_ui_catalog")!;

describe("HelixMcpEvidenceObservationStore", () => {
  let pool: Pool;
  let store: HelixMcpEvidenceObservationStore;
  let persist: () => Promise<void>;

  beforeEach(async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const pg = memory.adapters.createPg();
    pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try {
      await migration026.run(client, { enablePgvector: false });
      await migration074.run(client, { enablePgvector: false });
    } finally {
      client.release();
    }
    await pool.query(
      `INSERT INTO helix_accounts(profile_id, display_name, account_type, provider)
       VALUES ('profile-a','A','developer','local'), ('profile-b','B','developer','local');`,
    );
    persist = vi.fn().mockResolvedValue(undefined);
    store = new HelixMcpEvidenceObservationStore({ pool, now: () => NOW, persist });
  });

  const observation = () => buildHelixMcpEvidenceObservation({
    descriptor,
    request: { surface_id: null },
    payload: { count: 2 },
    producerRef: "casimirbot-profile:profile-a",
    summary: "Observed the bounded public UI catalog.",
    payloadSchema: "test.catalog.v1",
    observedAt: NOW.toISOString(),
    retainedUntil: "2026-08-30T12:00:00.000Z",
    observationRefFactory: () => "mcp_evidence_observation:test:one",
  });

  it("persists and retrieves the exact validated envelope for its owner", async () => {
    const expected = observation();
    await store.put({ owner: OWNER, toolName: descriptor.mcp_tool_name, observation: expected });
    const restartedStore = new HelixMcpEvidenceObservationStore({
      pool,
      now: () => NOW,
      persist,
    });
    expect(await restartedStore.get({ owner: OWNER, observationRef: expected.observation_ref }))
      .toEqual(expected);
    expect(persist).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", "mcp_evidence_observation:test:missing", OWNER, "observation_not_found"],
    ["wrong owner", "mcp_evidence_observation:test:one", OTHER_OWNER, "observation_owner_mismatch"],
    ["wrong tenant", "mcp_evidence_observation:test:one", OTHER_TENANT, "observation_owner_mismatch"],
  ])("fails closed for %s references", async (_label, observationRef, owner, code) => {
    await store.put({ owner: OWNER, toolName: descriptor.mcp_tool_name, observation: observation() });
    await expect(store.get({ owner, observationRef })).rejects.toMatchObject({ code });
  });

  it("allows an exact persistence replay but rejects a conflicting observation identity", async () => {
    const expected = observation();
    await store.put({ owner: OWNER, toolName: descriptor.mcp_tool_name, observation: expected });
    await expect(store.put({
      owner: OWNER,
      toolName: descriptor.mcp_tool_name,
      observation: expected,
    })).resolves.toBeUndefined();
    await expect(store.put({
      owner: OTHER_OWNER,
      toolName: descriptor.mcp_tool_name,
      observation: expected,
    })).rejects.toMatchObject({ code: "observation_identity_conflict" });
  });

  it("fails closed after expiry without changing the stored envelope", async () => {
    const expiredStore = new HelixMcpEvidenceObservationStore({
      pool,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
      persist,
    });
    await store.put({ owner: OWNER, toolName: descriptor.mcp_tool_name, observation: observation() });
    await expect(expiredStore.get({
      owner: OWNER,
      observationRef: observation().observation_ref,
    })).rejects.toMatchObject({ code: "observation_expired" });
  });

  it("fails closed when source freshness expires before retention", async () => {
    const stale = buildHelixMcpEvidenceObservation({
      descriptor,
      request: { surface_id: null },
      payload: { count: 2 },
      producerRef: "casimirbot-profile:profile-a",
      summary: "Observed a time-bounded catalog projection.",
      payloadSchema: "test.catalog.v1",
      observedAt: NOW.toISOString(),
      retainedUntil: "2026-08-30T12:00:00.000Z",
      freshness: {
        state: "fresh",
        ageMs: 0,
        expiresAt: "2026-08-29T12:30:00.000Z",
      },
      observationRefFactory: () => "mcp_evidence_observation:test:stale",
    });
    await store.put({ owner: OWNER, toolName: descriptor.mcp_tool_name, observation: stale });
    const later = new HelixMcpEvidenceObservationStore({
      pool,
      now: () => new Date("2026-08-29T13:00:00.000Z"),
      persist,
    });
    await expect(later.get({ owner: OWNER, observationRef: stale.observation_ref }))
      .rejects.toMatchObject({ code: "observation_stale" });
  });

  it("fails closed for revoked and corrupt observations", async () => {
    const expected = observation();
    await store.put({ owner: OWNER, toolName: descriptor.mcp_tool_name, observation: expected });
    expect(await store.revoke({
      owner: OWNER,
      observationRef: expected.observation_ref,
      revocationRef: "operator-revocation:test",
    })).toBe(true);
    await expect(store.get({ owner: OWNER, observationRef: expected.observation_ref }))
      .rejects.toMatchObject({ code: "observation_revoked" });

    const corrupt = { ...expected, observation_ref: "mcp_evidence_observation:test:corrupt" };
    await store.put({ owner: OWNER, toolName: descriptor.mcp_tool_name, observation: corrupt });
    await pool.query(
      `UPDATE helix_mcp_evidence_observations
       SET observation = $1::jsonb WHERE observation_ref = $2;`,
      [JSON.stringify({ ...corrupt, payload: { count: 9 } }), corrupt.observation_ref],
    );
    await expect(store.get({ owner: OWNER, observationRef: corrupt.observation_ref }))
      .rejects.toBeInstanceOf(HelixMcpEvidenceObservationStoreError);
    await expect(store.get({ owner: OWNER, observationRef: corrupt.observation_ref }))
      .rejects.toMatchObject({ code: "observation_corrupt" });
  });
});
