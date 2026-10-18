import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration079 } from "../079_linked_provider_exact_unique_constraint";

describe("migration079", () => {
  it("materializes exact linked-provider ownership as a unique constraint", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    await pool.query(`
      CREATE TABLE helix_account_linked_providers (
        provider text NOT NULL,
        provider_subject text NOT NULL,
        profile_id text NOT NULL
      );
    `);

    await migration079.run(pool as never, { enablePgvector: false });

    await pool.query(`
      INSERT INTO helix_account_linked_providers
        (provider, provider_subject, profile_id)
      VALUES
        ('oidc', 'subject:one', 'profile:one'),
        ('oidc', 'subject:one', 'profile:two');
    `);
    await expect(pool.query(`
      INSERT INTO helix_account_linked_providers
        (provider, provider_subject, profile_id)
      VALUES ('oidc', 'subject:one', 'profile:one');
    `)).rejects.toThrow();

    const queries: string[] = [];
    await migration079.run({
      query: async (query: string) => {
        queries.push(query);
        return { rows: [] };
      },
    } as never, { enablePgvector: false });
    const generatedSql = queries.join("\n");
    expect(generatedSql).toContain(
      "ADD CONSTRAINT helix_account_linked_providers_exact_unique",
    );
    expect(generatedSql).toContain(
      "UNIQUE (\n        provider,\n        provider_subject,\n        profile_id",
    );
    const existingQueries: string[] = [];
    await migration079.run({
      query: async (query: string) => {
        existingQueries.push(query);
        return { rowCount: 1, rows: [{ exists: 1 }] };
      },
    } as never, { enablePgvector: false });
    expect(existingQueries).toHaveLength(1);
    await pool.end();
  });
});
