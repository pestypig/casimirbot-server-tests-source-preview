import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration030 } from "../030_shared_realtime_rooms";
import { migration116 } from "../116_three_human_text_room_capacity";

describe("migration116", () => {
  it("preserves two-person rooms and admits only the separate three-human storage profile", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    try {
      await pool.query(`CREATE TABLE helix_accounts (profile_id text PRIMARY KEY)`);
      await pool.query(`INSERT INTO helix_accounts (profile_id) VALUES
        ('profile:owner'),('profile:guest-a'),('profile:guest-b')`);
      await migration030.run(pool as never, { enablePgvector: false });
      await pool.query(`INSERT INTO helix_shared_realtime_rooms
        (room_id,owner_profile_id,title) VALUES ('room:old','profile:owner','Old voice room')`);
      await migration116.run(pool as never, { enablePgvector: false });
      expect((await pool.query(`SELECT max_participants,capacity_profile
        FROM helix_shared_realtime_rooms WHERE room_id='room:old'`)).rows).toEqual([
        { max_participants: 2, capacity_profile: "two_person_voice" },
      ]);
      await expect(pool.query(`UPDATE helix_shared_realtime_rooms SET max_participants=3
        WHERE room_id='room:old'`)).rejects.toThrow();
      await pool.query(`INSERT INTO helix_shared_realtime_rooms
        (room_id,owner_profile_id,title,max_participants,capacity_profile)
        VALUES ('room:text','profile:owner','Three-human text room',3,'three_human_text')`);
      await pool.query(`UPDATE helix_shared_realtime_rooms SET status='text_ready' WHERE room_id='room:text'`);
      await expect(pool.query(`UPDATE helix_shared_realtime_rooms SET status='ready'
        WHERE room_id='room:text'`)).rejects.toThrow();
      await expect(pool.query(`UPDATE helix_shared_realtime_rooms SET status='text_ready'
        WHERE room_id='room:old'`)).rejects.toThrow();
      await pool.query(`INSERT INTO helix_shared_realtime_room_members
        (room_id,slot_number,profile_id,participant_id,member_role)
        VALUES ('room:text',1,'profile:owner','participant:owner','owner'),
               ('room:text',2,'profile:guest-a','participant:guest-a','participant'),
               ('room:text',3,'profile:guest-b','participant:guest-b','participant')`);
      await migration116.run(pool as never, { enablePgvector: false });
      expect((await pool.query(`SELECT capacity_profile FROM helix_shared_realtime_rooms
        WHERE room_id='room:text'`)).rows).toEqual([{ capacity_profile: "three_human_text" }]);
      expect((await pool.query(`SELECT slot_number FROM helix_shared_realtime_room_members
        WHERE room_id='room:text' ORDER BY slot_number`)).rows.map(row => row.slot_number))
        .toEqual([1, 2, 3]);
      await expect(pool.query(`INSERT INTO helix_shared_realtime_room_members
        (room_id,slot_number,profile_id,participant_id,member_role)
        VALUES ('room:text',4,'profile:guest-b','participant:four','participant')`))
        .rejects.toThrow();
    } finally { await pool.end(); }
  });
});
