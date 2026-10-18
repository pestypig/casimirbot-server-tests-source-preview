import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { migration068 } from "../068_paper_reactive_partial_fills";

describe("migration068 paper reactive partial fills", () => {
  it("adds execution and cumulative fill state while allowing many fills per order", async () => {
    const db = newDb();
    db.public.none(`
      CREATE TABLE helix_paper_orders (
        order_id text PRIMARY KEY,
        account_id text NOT NULL,
        symbol text NOT NULL,
        notional_cents integer NOT NULL,
        quantity_micros bigint NOT NULL,
        reserved_cents integer NOT NULL DEFAULT 0,
        status text NOT NULL,
        created_at timestamptz NOT NULL,
        CONSTRAINT helix_paper_orders_status_check
          CHECK (status IN ('open', 'filled', 'cancelled'))
      );
      CREATE TABLE helix_paper_fills (
        fill_id text PRIMARY KEY,
        order_id text NOT NULL UNIQUE REFERENCES helix_paper_orders(order_id),
        source_observation_id text NOT NULL
      );
      CREATE TABLE helix_paper_journal_events (
        event_id text PRIMARY KEY,
        event_type text NOT NULL,
        CONSTRAINT helix_paper_journal_events_event_type_check
          CHECK (event_type IN (
            'entry_submitted', 'entry_filled', 'entry_cancelled',
            'position_marked', 'stop_triggered', 'exit_filled'
          ))
      );
      CREATE INDEX helix_paper_orders_open_idx
        ON helix_paper_orders (account_id, symbol, created_at)
        WHERE status = 'open';
    `);
    const adapter = db.adapters.createPg();
    const client = new adapter.Client();
    await client.connect();
    await migration068.run(client, { enablePgvector: false });
    await client.query(`
      INSERT INTO helix_paper_orders (
        order_id, account_id, symbol, notional_cents, quantity_micros, reserved_cents,
        status, created_at, execution_model_json, filled_quantity_micros,
        filled_notional_cents
      ) VALUES (
        'order:1', 'account:1', 'SPY', 100, 1000, 50, 'open', now(),
        '{"kind":"quote_touch_v1"}'::jsonb, 500, 25
      );
      INSERT INTO helix_paper_fills
        (fill_id, order_id, source_observation_id)
      VALUES ('fill:1', 'order:1', 'observation:1');
      INSERT INTO helix_paper_fills
        (fill_id, order_id, source_observation_id)
      VALUES ('fill:2', 'order:1', 'observation:2');
    `);
    const result = await client.query<{
      status: string;
      filled_quantity_micros: string | number;
      count: string | number;
    }>(`
      SELECT o.status, o.filled_quantity_micros, count(f.fill_id) AS count
      FROM helix_paper_orders o
      JOIN helix_paper_fills f ON f.order_id = o.order_id
      GROUP BY o.status, o.filled_quantity_micros;
    `);
    expect(result.rows[0]).toMatchObject({ status: "open" });
    expect(Number(result.rows[0]?.filled_quantity_micros)).toBe(500);
    expect(Number(result.rows[0]?.count)).toBe(2);
    await client.end();
  });
});
