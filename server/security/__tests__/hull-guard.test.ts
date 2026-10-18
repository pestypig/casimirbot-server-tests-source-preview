import { afterEach, describe, expect, it } from "vitest";
import { isHullAllowed } from "../hull-guard";

const originalGuard = process.env.HULL_OUTBOUND_GUARD;
const originalAllowList = process.env.HULL_ALLOW_HOSTS;

afterEach(() => {
  if (originalGuard === undefined) delete process.env.HULL_OUTBOUND_GUARD;
  else process.env.HULL_OUTBOUND_GUARD = originalGuard;
  if (originalAllowList === undefined) delete process.env.HULL_ALLOW_HOSTS;
  else process.env.HULL_ALLOW_HOSTS = originalAllowList;
});

describe("HULL outbound host matching", () => {
  it("normalizes URLs and applies wildcard host allow-lists", () => {
    process.env.HULL_OUTBOUND_GUARD = "1";
    process.env.HULL_ALLOW_HOSTS = "api.example.com,*.trusted.example";
    expect(isHullAllowed("https://api.example.com/v1/models")).toBe(true);
    expect(isHullAllowed("https://node.trusted.example:8443/path")).toBe(true);
    expect(isHullAllowed("https://evil.example.com")).toBe(false);
  });
});
