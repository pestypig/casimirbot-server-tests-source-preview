import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration073 } from "../073_billing_entitlement_ledger";

describe("migration 073 billing entitlement ledger", () => {
  it("creates sandbox-only immutable billing tables with currency and amount checks", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    memory.public.none("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY);");
    const pg = memory.adapters.createPg();
    const client = new pg.Client();
    await client.connect();
    await migration073.run(client as never, { enablePgvector: false });
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name LIKE 'helix_billing_%' ORDER BY table_name;`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "helix_billing_entitlements",
      "helix_billing_ledger_entries",
      "helix_billing_webhook_events",
    ]);
    await client.query("INSERT INTO helix_accounts(profile_id) VALUES ('owner');");
    await expect(client.query(
      `INSERT INTO helix_billing_entitlements(profile_id, environment)
       VALUES ('owner', 'live');`,
    )).rejects.toThrow();
    await expect(client.query(
      `INSERT INTO helix_billing_ledger_entries(
         entry_id, profile_id, kind, amount_minor, idempotency_key
       ) VALUES ('entry', 'owner', 'prepaid_credit', 0, 'key');`,
    )).rejects.toThrow();
    await client.end();
  });
});
