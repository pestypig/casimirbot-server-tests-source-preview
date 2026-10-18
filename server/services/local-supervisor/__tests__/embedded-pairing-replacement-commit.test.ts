import { expect, it } from "vitest";
import { newDb } from "pg-mem";
import { commitEmbeddedPairingReplacement } from "../embedded-pairing-replacement-commit";

function fixture() {
  const db = newDb();
  db.public.none("CREATE TABLE helix_pairing_ledger (id text PRIMARY KEY, revision integer NOT NULL CHECK(revision>0))");
  db.public.none("INSERT INTO helix_pairing_ledger VALUES ('old',1),('new',1),('unrelated',7)");
  const write = (id: string, expected = 1, next = 2) => ({
    sql: "UPDATE helix_pairing_ledger SET revision=$1 WHERE id=$2 AND revision=$3 RETURNING id",
    values: [next, id, expected],
  });
  const rows = () => db.public.many("SELECT * FROM helix_pairing_ledger ORDER BY id");
  return { db, write, rows };
}

it("O2/O5 commits both embedded CAS writes once and rejects replay without partial state", () => {
  const h = fixture();
  expect(commitEmbeddedPairingReplacement(h.db, [h.write("old"), h.write("new")])).toBe(true);
  const committed = h.rows();
  expect(committed).toEqual([{ id: "new", revision: 2 }, { id: "old", revision: 2 }, { id: "unrelated", revision: 7 }]);
  expect(commitEmbeddedPairingReplacement(h.db, [h.write("old"), h.write("new")])).toBe(false);
  expect(h.rows()).toEqual(committed);
});

it.each(["conflict", "constraint"])("O2/O5 second-write %s restores the first without losing surrounding writes", async failure => {
  const h = fixture();
  h.db.public.none("UPDATE helix_pairing_ledger SET revision=8 WHERE id='unrelated'");
  const before = h.rows();
  // Queued application work cannot run inside the synchronous commit section.
  const after = Promise.resolve().then(() => h.db.public.none("UPDATE helix_pairing_ledger SET revision=9 WHERE id='unrelated'"));
  const operation = () => commitEmbeddedPairingReplacement(h.db, [h.write("old"),
    failure === "conflict" ? h.write("new", 99) : h.write("new", 1, 0)]);
  if (failure === "conflict") expect(operation()).toBe(false);
  else expect(operation).toThrow();
  expect(h.rows()).toEqual(before);
  await after;
  expect(h.rows()).toEqual([{ id: "new", revision: 1 }, { id: "old", revision: 1 }, { id: "unrelated", revision: 9 }]);
});

it("O2/O5 rejects non-ledger or multi-statement writes before mutation", () => {
  const h = fixture(); const before = h.rows();
  for (const sql of ["DELETE FROM helix_pairing_ledger", "UPDATE helix_pairing_ledger SET revision=2; DELETE FROM helix_pairing_ledger"]) {
    expect(() => commitEmbeddedPairingReplacement(h.db, [h.write("old"), { sql, values: [] }]))
      .toThrow("pairing_atomic_write_invalid");
  }
  expect(h.rows()).toEqual(before);
});
