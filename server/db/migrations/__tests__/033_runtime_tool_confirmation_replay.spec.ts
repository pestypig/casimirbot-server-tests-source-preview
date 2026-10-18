import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migration033 } from "../033_runtime_tool_confirmation_replay";

describe("migration033 runtime tool confirmation replay ledger", () => {
  let pool: Pool;

  beforeEach(async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    pool = new adapter.Pool() as unknown as Pool;
    const client = await pool.connect();
    try {
      await migration033.run(client, { enablePgvector: false });
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    await pool.end();
  });

  const insert = (receiptId: string, requestId: string) =>
    pool.query(
      `
        INSERT INTO helix_runtime_tool_confirmation_replay_claims (
          receipt_id,
          request_id,
          issuer,
          key_id,
          binding_sha256,
          artifact_sha256,
          signed_payload_sha256,
          approved_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `,
      [
        receiptId,
        requestId,
        "https://runtime.example",
        "runtime-key-1",
        "a".repeat(64),
        "b".repeat(64),
        "c".repeat(64),
        "2026-07-26T12:00:00.000Z",
        "2026-07-26T12:05:00.000Z",
      ],
    );

  it("stores every bounded replay claim field", async () => {
    await insert("receipt-1", "request-1");

    const { rows } = await pool.query(
      `
        SELECT
          receipt_id,
          request_id,
          issuer,
          key_id,
          binding_sha256,
          artifact_sha256,
          signed_payload_sha256,
          approved_at,
          expires_at,
          consumed_at
        FROM helix_runtime_tool_confirmation_replay_claims;
      `,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      receipt_id: "receipt-1",
      request_id: "request-1",
      issuer: "https://runtime.example",
      key_id: "runtime-key-1",
      binding_sha256: "a".repeat(64),
      artifact_sha256: "b".repeat(64),
      signed_payload_sha256: "c".repeat(64),
    });
    expect(new Date(rows[0].approved_at).toISOString()).toBe(
      "2026-07-26T12:00:00.000Z",
    );
    expect(new Date(rows[0].expires_at).toISOString()).toBe(
      "2026-07-26T12:05:00.000Z",
    );
    expect(rows[0].consumed_at).toBeTruthy();
  });

  it("enforces independent database uniqueness for receipt and request ids", async () => {
    await insert("receipt-1", "request-1");

    await expect(insert("receipt-1", "request-2")).rejects.toThrow();
    await expect(insert("receipt-2", "request-1")).rejects.toThrow();
  });

  it("rejects fields outside the database bounds", async () => {
    await expect(insert("r".repeat(257), "request-1")).rejects.toThrow();
    await expect(
      pool.query(
        `
          INSERT INTO helix_runtime_tool_confirmation_replay_claims (
            receipt_id,
            request_id,
            issuer,
            key_id,
            binding_sha256,
            artifact_sha256,
            signed_payload_sha256,
            approved_at,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
        `,
        [
          "receipt-2",
          "request-2",
          "https://runtime.example",
          "runtime-key-1",
          "short",
          "b".repeat(64),
          "c".repeat(64),
          "2026-07-26T12:05:00.000Z",
          "2026-07-26T12:00:00.000Z",
        ],
      ),
    ).rejects.toThrow();
  });
});
