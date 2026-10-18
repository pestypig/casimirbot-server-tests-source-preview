import { describe, expect, it, vi } from "vitest";
import { createDiscordSolarWake } from "../../integrations/discord-helix-bot/src/solar-wake";

const due = new Date("2026-10-11T12:00:00.000Z");
const receipt = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const confirmed = {
  ok: true, due: true, delivered: 1, alreadyDelivered: 0,
  receipts: [{ messageId: "1558811514297655307" }],
};

describe("Discord solar worker wake", () => {
  it("does not call the domain without a token or outside 8 AM New York", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await createDiscordSolarWake({ baseUrl: "https://casimirbot.com", token: "", now: () => due, fetchImpl })();
    await createDiscordSolarWake({ baseUrl: "https://casimirbot.com", token: "scoped", now: () => new Date("2026-10-11T11:59:00Z"), fetchImpl })();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a confirmed receipt once per New York day", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(receipt(confirmed));
    let current = due;
    const tick = createDiscordSolarWake({ baseUrl: "https://casimirbot.com", token: "scoped", now: () => current, fetchImpl, log: vi.fn() });
    await tick();
    current = new Date("2026-10-11T12:30:00Z");
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://casimirbot.com/api/discord/solar/tick");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer scoped" } });
  });

  it("retries an unconfirmed response after five minutes", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(receipt({ ok: true, due: true, delivered: 0, alreadyDelivered: 0, receipts: [] }))
      .mockResolvedValueOnce(receipt(confirmed));
    let current = due;
    const tick = createDiscordSolarWake({ baseUrl: "https://casimirbot.com", token: "scoped", now: () => current, fetchImpl, log: vi.fn() });
    await tick();
    current = new Date("2026-10-11T12:04:59Z");
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    current = new Date("2026-10-11T12:05:00Z");
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not overlap domain calls", async () => {
    let resolve!: (value: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const tick = createDiscordSolarWake({ baseUrl: "https://casimirbot.com", token: "scoped", now: () => due, fetchImpl, log: vi.fn() });
    const first = tick();
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolve(receipt(confirmed));
    await first;
  });
});
