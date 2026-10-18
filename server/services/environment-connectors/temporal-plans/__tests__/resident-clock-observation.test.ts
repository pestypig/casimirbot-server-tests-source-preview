import { expect, it, vi } from "vitest";
import { readTemporalResidentClockObservation } from "../resident-clock-observation";

it.each(["valid", "manual_input", "missing_manual_flag", "legacy", "wrong_epoch", "paused", "stopped", "stale_receipt", "future_receipt", "stale_sample", "combined_age", "future_sample", "missing_monotonic", "malformed"])("reads only exact bounded resident clock evidence (%s)", async scenario => {
  const clock = { schema: "helix.environment_clock_snapshot.v1", clock_id: "clock:test", clock_kind: "minecraft_game_tick",
    tick_rate_hz: 20, tick_index: 12, world_tick_index: 99, synchronization: "server_synchronized",
    monotonic: { origin_id: "origin:test", elapsed_ms: 123.5 }, observed_at: "2026-09-05T00:00:00Z" };
  const row = { heartbeat_id: "heartbeat:test", producer_epoch_ref: "epoch:test", status: "active", emergency_stop_latched: false,
    manual_input_detected: false as boolean | undefined,
    received_at: "2026-09-05T00:00:00Z", created_at: "2026-09-05T00:00:00Z", clock_snapshot: clock as unknown };
  if (scenario === "manual_input") row.manual_input_detected = true;
  if (scenario === "missing_manual_flag") row.manual_input_detected = undefined;
  if (scenario === "legacy") row.clock_snapshot = null;
  if (scenario === "wrong_epoch") row.producer_epoch_ref = "epoch:other";
  if (scenario === "paused") row.status = "paused";
  if (scenario === "stopped") row.emergency_stop_latched = true;
  if (scenario === "stale_receipt") row.received_at = "2026-09-04T23:59:50Z";
  if (scenario === "future_receipt") row.received_at = "2026-09-05T00:00:20Z";
  if (scenario === "stale_sample") clock.observed_at = "2026-09-04T23:59:50Z";
  if (scenario === "combined_age") {
    clock.observed_at = "2026-09-04T23:59:53Z";
    row.created_at = "2026-09-04T23:59:57Z";
    row.received_at = "2026-09-04T23:59:57Z";
  }
  if (scenario === "future_sample") clock.observed_at = "2026-09-05T00:00:10Z";
  if (scenario === "missing_monotonic") row.clock_snapshot = { ...clock, monotonic: undefined };
  if (scenario === "malformed") row.clock_snapshot = "{";
  const query = vi.fn(async () => ({ rows: [row] }));
  const result = await readTemporalResidentClockObservation({ query } as never, {
    authorityId: "authority:test", manifestId: "manifest:test", producerEpochRef: "epoch:test", now: new Date("2026-09-05T00:00:01Z"),
  });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("action_authority_id=$1 AND manifest_id=$2"), ["authority:test", "manifest:test"]);
  if (scenario === "valid" || scenario === "manual_input") expect(result).toMatchObject({ clock,
    manual_input_detected: scenario === "manual_input", receipt_age_ms: 1_000,
    clock_extrapolated: false, execution_authority: false });
  else expect(result).toBeNull();
});
