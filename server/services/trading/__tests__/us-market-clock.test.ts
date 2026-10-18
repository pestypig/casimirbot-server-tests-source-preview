import { describe, expect, it } from "vitest";
import { readUsMarketClock } from "../us-market-clock";

describe("US paper market clock", () => {
  it("handles Eastern daylight time regular sessions", () => {
    expect(readUsMarketClock(new Date("2026-08-11T15:00:00Z"))).toMatchObject({
      tradingDate: "2026-08-11",
      session: "regular",
      minutesSinceRegularOpen: 90,
      minutesUntilRegularClose: 300,
      holiday: false,
    });
  });

  it("fails closed on weekends and exchange holidays", () => {
    expect(readUsMarketClock(new Date("2026-08-15T15:00:00Z")).session).toBe("closed");
    expect(readUsMarketClock(new Date("2026-12-25T15:00:00Z"))).toMatchObject({
      session: "closed",
      holiday: true,
    });
    expect(readUsMarketClock(new Date("2026-04-03T15:00:00Z"))).toMatchObject({
      session: "closed",
      holiday: true,
    });
  });

  it("handles Eastern standard time boundaries", () => {
    expect(readUsMarketClock(new Date("2026-01-06T14:29:00Z")).session).toBe("pre");
    expect(readUsMarketClock(new Date("2026-01-06T14:30:00Z")).session).toBe("regular");
    expect(readUsMarketClock(new Date("2026-01-06T21:00:00Z")).session).toBe("post");
  });
});
