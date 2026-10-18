import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration078 } from "../078_environment_action_result_control_release_check";

describe("migration078", () => {
  it("keeps terminal control release mandatory with a portable check expression", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    await pool.query(`
      CREATE TABLE helix_environment_action_results (
        action_result_id text PRIMARY KEY,
        controls_released boolean NOT NULL,
        CONSTRAINT helix_environment_action_results_controls_released_check
          CHECK (controls_released)
      );
    `);

    await migration078.run(pool as never, { enablePgvector: false });

    await pool.query(`
      INSERT INTO helix_environment_action_results
        (action_result_id, controls_released)
      VALUES ('action_result:released', true);
    `);
    await expect(pool.query(`
      INSERT INTO helix_environment_action_results
        (action_result_id, controls_released)
      VALUES ('action_result:not_released', false);
    `)).rejects.toThrow();

    const queries: string[] = [];
    await migration078.run({
      query: async (query: string) => {
        queries.push(query);
        return { rows: [] };
      },
    } as never, { enablePgvector: false });
    const generatedSql = queries.join("\n");
    expect(generatedSql).toContain("CHECK (controls_released = true)");
    expect(generatedSql).not.toContain("CHECK (CHECK");
    await pool.end();
  });
});
