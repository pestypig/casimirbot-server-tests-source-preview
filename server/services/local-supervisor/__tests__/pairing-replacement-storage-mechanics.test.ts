import { expect, it } from "vitest";
import { newDb } from "pg-mem";

// Diagnostic backend contract, not replacement implementation or acceptance.
// Prevent a future multi-write implementation from assuming embedded rollback.
it("O2 replacement storage diagnostic: embedded transaction rollback is not a multi-write atomicity primitive", async () => {
  const pool = new (newDb().adapters.createPg().Pool)();
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE pairing_probe (id text PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0))");
    await client.query("INSERT INTO pairing_probe VALUES ('old',1),('new',1)");
    await client.query("BEGIN");
    await client.query("UPDATE pairing_probe SET revision=2 WHERE id='old'");
    await client.query("ROLLBACK");
    expect((await client.query("SELECT * FROM pairing_probe ORDER BY id")).rows)
      .toEqual([{ id: "new", revision: 1 }, { id: "old", revision: 2 }]);
    await client.query("UPDATE pairing_probe SET revision=1");
    await expect(client.query("UPDATE pairing_probe SET revision=CASE WHEN id='old' THEN 2 ELSE 0 END"))
      .rejects.toThrow();
    expect((await client.query("SELECT * FROM pairing_probe ORDER BY id")).rows)
      .toEqual([{ id: "new", revision: 1 }, { id: "old", revision: 1 }]);
  } finally { client.release(); await pool.end(); }
});
