import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { migration066 } from "../066_live_attendance_generation";

describe("migration066 live attendance generation", () => {
  let client: any;

  beforeAll(async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    client = new adapter.Client();
    await client.connect();
    await client.query(`
      CREATE TABLE helix_live_trading_controls (
        control_id text PRIMARY KEY,
        operator_armed boolean NOT NULL DEFAULT false,
        operator_presence_at timestamptz,
        kill_switch_active boolean NOT NULL DEFAULT true,
        kill_switch_reason text NOT NULL,
        updated_at timestamptz NOT NULL
      );
      INSERT INTO helix_live_trading_controls VALUES (
        'live_trading_control:one', true, now(), false, 'armed', now()
      );
    `);
    await migration066.run(client, { enablePgvector: false });
  });

  afterAll(async () => {
    await client.end();
  });

  it("retires inherited presence and installs constrained generation state", async () => {
    const { rows } = await client.query(
      `SELECT operator_armed, operator_presence_at,
              operator_attendance_id_hash, operator_attendance_status,
              kill_switch_active, kill_switch_reason
       FROM helix_live_trading_controls
       WHERE control_id = 'live_trading_control:one';`,
    );
    expect(rows[0]).toMatchObject({
      operator_armed: false,
      operator_presence_at: null,
      operator_attendance_id_hash: null,
      operator_attendance_status: "inactive",
      kill_switch_active: true,
    });
    expect(rows[0].kill_switch_reason).toContain("attendance-generation");
    await expect(client.query(
      `UPDATE helix_live_trading_controls
       SET operator_attendance_status = 'unknown'
       WHERE control_id = 'live_trading_control:one';`,
    )).rejects.toThrow();
  });
});
