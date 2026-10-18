import { describe, expect, it } from "vitest";
import { environmentActionEventCursorMatches } from "../action-broker";

describe("environment action heartbeat event cursor", () => {
  it("admits only the connector cursor represented by the durable server ledger", () => {
    expect(environmentActionEventCursorMatches(null, null)).toBe(true);
    expect(environmentActionEventCursorMatches(54, 54)).toBe(true);
    expect(environmentActionEventCursorMatches(54, 50)).toBe(false);
    expect(environmentActionEventCursorMatches(null, 0)).toBe(false);
    expect(environmentActionEventCursorMatches(0, null)).toBe(false);
  });
});
