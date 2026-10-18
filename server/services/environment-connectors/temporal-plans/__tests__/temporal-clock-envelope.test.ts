import { expect, it } from "vitest";
import { mapTemporalServerMarkToRequest as map } from "../temporal-clock-envelope";
const sample = { nativeRoundtripMs: 50, serverReceivedMs: 1000,
  serverReturnedMs: 1030, serverMarkMs: 1020, errorBoundMs: 1 };
it("maps a server mark into a native request-relative interval, not a point", () => {
  expect(map(sample)).toMatchObject({ available: true, lower_ms: 19, upper_ms: 41 });
});
it("is independent of the server's arbitrary clock origin", () => {
  expect(map({ ...sample, serverReceivedMs: 2000, serverReturnedMs: 2030, serverMarkMs: 2020 })).toEqual(map(sample));
});
it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid input %s", value => {
  expect(map({ ...sample, nativeRoundtripMs: value }).available).toBe(false);
});
it.each([999, 1031])("does not extrapolate marks outside the enclosing request %s", value => {
  expect(map({ ...sample, serverMarkMs: value }).available).toBe(false);
});
it("rejects an impossible enclosure", () => {
  expect(map({ ...sample, nativeRoundtripMs: 10 })).toMatchObject({ available: false, reason: "clock_envelope_impossible" });
});
it("does not spend the same error budget twice at the endpoints", () => {
  expect(map({ ...sample, nativeRoundtripMs: 28 }).available).toBe(false);
});
it("preserves uncertainty at response boundary", () => {
  expect(map({ ...sample, serverMarkMs: 1030 })).toMatchObject({ available: true, lower_ms: 29, upper_ms: 50 });
});
