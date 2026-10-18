import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbClient } from "../../../db/client";
import { migration033 } from "../../../db/migrations/033_runtime_tool_confirmation_replay";
import {
  PostgresTrustedRuntimeToolConfirmationReplayLedgerV1,
  createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1,
} from "../runtime-tool-confirmation-postgres-replay-ledger";
import type {
  TrustedRuntimeToolConfirmationReplayClaimV1,
  TrustedRuntimeToolConfirmationReplayConsumeResultV1,
} from "../runtime-tool-confirmation-receipt-verifier";

const claim = (
  overrides: Partial<TrustedRuntimeToolConfirmationReplayClaimV1> = {},
): TrustedRuntimeToolConfirmationReplayClaimV1 => ({
  receiptId: "receipt-1",
  requestId: "request-1",
  issuer: "https://runtime.example",
  keyId: "runtime-key-1",
  bindingSha256: "a".repeat(64),
  artifactSha256: "b".repeat(64),
  signedPayloadSha256: "c".repeat(64),
  approvedAt: "2026-07-26T12:00:00.000Z",
  expiresAt: "2026-07-26T12:05:00.000Z",
  ...overrides,
});

describe("Postgres runtime tool confirmation replay ledger", () => {
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

  it("atomically consumes exactly once across independent ledger instances", async () => {
    const first =
      createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1(pool);
    const second =
      createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1(pool);

    const outcomes = await Promise.all([
      first.consumeOnce(claim()),
      second.consumeOnce(claim()),
    ]);

    expect(
      outcomes
        .map(
          (outcome: TrustedRuntimeToolConfirmationReplayConsumeResultV1) =>
            outcome.status,
        )
        .sort(),
    ).toEqual(["already_consumed", "consumed"]);
    const { rows } = await pool.query(
      "SELECT receipt_id, request_id FROM helix_runtime_tool_confirmation_replay_claims;",
    );
    expect(rows).toEqual([
      { receipt_id: "receipt-1", request_id: "request-1" },
    ]);
  });

  it("rejects reuse of either unique identity", async () => {
    const ledger =
      createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1(pool);

    await expect(ledger.consumeOnce(claim())).resolves.toEqual({
      status: "consumed",
    });
    await expect(
      ledger.consumeOnce(claim({ requestId: "request-2" })),
    ).resolves.toEqual({ status: "already_consumed" });
    await expect(
      ledger.consumeOnce(claim({ receiptId: "receipt-2" })),
    ).resolves.toEqual({ status: "already_consumed" });
  });

  it("fails closed before SQL for malformed or unbounded claims", async () => {
    const ledger =
      createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1(pool);
    const invalidClaims = [
      null as unknown as TrustedRuntimeToolConfirmationReplayClaimV1,
      claim({ receiptId: "r".repeat(257) }),
      claim({ requestId: "request\u0000one" }),
      claim({ issuer: " https://runtime.example" }),
      claim({ keyId: "k".repeat(257) }),
      claim({ bindingSha256: "A".repeat(64) }),
      claim({ artifactSha256: "short" }),
      claim({ signedPayloadSha256: "g".repeat(64) }),
      claim({ approvedAt: "2026-07-26T12:00:00Z" }),
      claim({
        approvedAt: "2026-07-26T12:05:00.000Z",
        expiresAt: "2026-07-26T12:00:00.000Z",
      }),
    ];

    for (const invalidClaim of invalidClaims) {
      await expect(ledger.consumeOnce(invalidClaim)).resolves.toEqual({
        status: "unavailable",
      });
    }
    const { rows } = await pool.query(
      "SELECT count(*)::int AS count FROM helix_runtime_tool_confirmation_replay_claims;",
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("returns only unavailable when the database fails", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(
        new Error("postgres password and internal host must never leak"),
      );
    const ledger = new PostgresTrustedRuntimeToolConfirmationReplayLedgerV1({
      query,
    } as unknown as Pool);

    const result = await ledger.consumeOnce(claim());

    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("postgres");
    expect(JSON.stringify(result)).not.toContain("password");
  });
});

describe("runtime tool confirmation replay ledger local restart", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await resetDbClient();
    vi.unstubAllEnvs();
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("retains consumed identities through a local pg-mem restart", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "casimirbot-replay-ledger-"),
    );
    tempDirs.push(tempDir);
    const snapshotPath = path.join(tempDir, "local-pg-mem.json");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
    await resetDbClient();

    const beforeRestart =
      createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1();
    await expect(beforeRestart.consumeOnce(claim())).resolves.toEqual({
      status: "consumed",
    });
    expect(fs.existsSync(snapshotPath)).toBe(true);

    await resetDbClient();

    const afterRestart =
      createPostgresTrustedRuntimeToolConfirmationReplayLedgerV1();
    await expect(afterRestart.consumeOnce(claim())).resolves.toEqual({
      status: "already_consumed",
    });
  });
});
