import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration070 } from "../070_installed_security_devices";

describe("migration 070 installed security devices", () => {
  it("creates a profile-bound finite device lifecycle", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    memory.public.none(`CREATE TABLE helix_accounts(profile_id text PRIMARY KEY);`);
    const pg = memory.adapters.createPg();
    const client = new pg.Client();
    await client.connect();
    await migration070.run(client as never, { enablePgvector: false });
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.tables
       WHERE table_name = 'helix_installed_devices';`,
    );
    expect(rows).toEqual([{ table_name: "helix_installed_devices" }]);
    await client.query(`INSERT INTO helix_accounts(profile_id) VALUES ('owner');`);
    await expect(client.query(
      `INSERT INTO helix_installed_devices(
         profile_id, device_id, label, platform, status
       ) VALUES ('owner', 'device', 'Device', 'linux', 'active');`,
    )).rejects.toThrow();
    await expect(client.query(
      `INSERT INTO helix_installed_devices(
         profile_id, device_id, label, platform, status
       ) VALUES ('owner', 'device', 'Device', 'windows', 'unknown');`,
    )).rejects.toThrow();
    await client.end();
  });
});
