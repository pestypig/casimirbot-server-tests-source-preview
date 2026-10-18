import { afterEach, expect, it, vi } from "vitest";
import { getPool, resetDbClient } from "../client";

afterEach(async () => {
  await resetDbClient();
  vi.unstubAllEnvs();
});

it("provides a fresh wall clock to lease guards in the embedded database", async () => {
  vi.stubEnv("DATABASE_URL", `pg-mem://clock-lease-${crypto.randomUUID()}`);
  const before = Date.now();
  const first = await getPool().query<{ wall_time: Date }>(
    "SELECT clock_timestamp() AS wall_time",
  );
  const firstTime = new Date(first.rows[0].wall_time).getTime();
  expect(firstTime).toBeGreaterThanOrEqual(before);
  expect(firstTime).toBeLessThanOrEqual(Date.now());

  const second = await getPool().query<{ wall_time: Date }>(
    "SELECT clock_timestamp() AS wall_time",
  );
  expect(new Date(second.rows[0].wall_time).getTime()).toBeGreaterThanOrEqual(firstTime);
});
