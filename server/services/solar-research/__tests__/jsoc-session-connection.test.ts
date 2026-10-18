import { expect, it } from "vitest";
import { deleteJsocSessionConnection, getJsocEmailForSession,
  readJsocSessionConnectionStatus, setJsocSessionConnection } from "../jsoc-session-connection";

it("keeps a JSOC notification address within one server session and masks it in status", () => {
  const first = `session-${Date.now()}-a`;
  const second = `session-${Date.now()}-b`;
  expect(setJsocSessionConnection(first, "researcher@example.org")).toMatchObject({
    connected: true, maskedEmail: "r***@example.org", verifiedAtProvider: false,
  });
  expect(readJsocSessionConnectionStatus(second).connected).toBe(false);
  expect(getJsocEmailForSession(second)).toBeNull();
  expect(getJsocEmailForSession(first)).toBe("researcher@example.org");
  expect(JSON.stringify(readJsocSessionConnectionStatus(first))).not.toContain("researcher@example.org");
  expect(deleteJsocSessionConnection(first).connected).toBe(false);
  expect(() => setJsocSessionConnection(first, "not-an-email")).toThrow("jsoc_email_invalid");
});
