import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createNoaaSrsService, NoaaSrsError, NOAA_SRS_SOURCE_URL, parseNoaaSrsReport,
} from "../noaa-srs";

const REPORT = `:Product: Solar Region Summary
:Issued: 2026 Oct 10 0030 UTC
# Prepared jointly by the U.S. Dept. of Commerce, NOAA,
# Space Weather Prediction Center and the U.S. Air Force.
Joint USAF/NOAA Solar Region Summary
SRS Number 283 Issued at 0030Z on 10 Oct 2026
Report compiled from data received at SWO on 09 Oct
I.  Regions with Sunspots.  Locations Valid at 09/2400Z
Nmbr Location  Lo  Area  Z   LL   NN Mag Type
4545 N18W46   222  0040 Dao  08   08 Beta
4548 S13W14   190  0040 Hsx  02   01 Alpha
4551 S13E71   105  0170 Dao  06   02 Beta-Gamma-Delta
IA. H-alpha Plages without Spots. Locations Valid at 09/2400Z Oct
Nmbr  Location  Lo
4550 S16W51   227
II. Regions Due to Return 10 Oct to 12 Oct
Nmbr Lat    Lo
4538 N12    084
`;

const NOW = Date.parse("2026-10-10T18:00:00Z");
const makeResponse = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/plain", ...headers } });

describe("NOAA SRS daily active-region catalog", () => {
  it("preserves daily issue/valid time, published IDs, signed central-meridian distance and missing plage fields", () => {
    const parsed = parseNoaaSrsReport(REPORT, "2026-10-10T18:00:00.000Z");
    expect(parsed).toMatchObject({
      schemaVersion: "solar-active-regions-current/1", sourceUrl: NOAA_SRS_SOURCE_URL,
      issuedAt: "2026-10-10T00:30:00.000Z", validAt: "2026-10-10T00:00:00.000Z",
      fetchedAt: "2026-10-10T18:00:00.000Z", complete: true,
    });
    expect(parsed.sourceSha256).toBe(createHash("sha256").update(Buffer.from(REPORT, "utf8")).digest("hex"));
    expect(parsed.regions).toHaveLength(4);
    expect(parsed.regions[0]).toEqual({ noaaNumber: 4545, location: "N18W46", latitudeDeg: 18,
      centralMeridianDistanceDeg: 46, carringtonLongitudeDeg: 222,
      category: "sunspot", areaMillionths: 40,
      spotClass: "Dao", spotCount: 8, magneticClass: "Beta" });
    expect(parsed.regions[2]).toMatchObject({ location: "S13E71", latitudeDeg: -13,
      centralMeridianDistanceDeg: -71, carringtonLongitudeDeg: 105,
      magneticClass: "Beta-Gamma-Delta" });
    expect(parsed.regions[3]).toEqual({ noaaNumber: 4550, location: "S16W51", latitudeDeg: -16,
      centralMeridianDistanceDeg: 51, carringtonLongitudeDeg: 227,
      category: "plage", areaMillionths: null,
      spotClass: null, spotCount: null, magneticClass: null });
  });

  it("accepts an explicitly empty plage section but rejects missing or malformed sections", () => {
    const emptyPlage = REPORT.replace("4550 S16W51   227", "None");
    expect(parseNoaaSrsReport(emptyPlage, new Date(NOW).toISOString()).regions).toHaveLength(3);
    for (const bad of [
      REPORT.replace("II. Regions Due to Return 10 Oct to 12 Oct", ""),
      REPORT.replace("4550 S16W51   227", ""),
      REPORT.replace("09/2400Z Oct", "08/2400Z Oct"),
      REPORT.replace("4550 S16W51   227", "4545 S16W51   227"),
      REPORT.replace("4550 S16W51   227", "4550 S16W51   361"),
      REPORT.replace("4545 N18W46   222", "4545 N18W46   361"),
      REPORT.replace("4545 N18W46   222  0040 Dao  08   08 Beta", "4545 N18W46 missing classification"),
      REPORT.replace("N18W46", "N99W46"),
    ]) {
      expect(() => parseNoaaSrsReport(bad, new Date(NOW).toISOString())).toThrow(NoaaSrsError);
    }
  });

  it("preserves both inclusive bounds of published Carrington longitude", () => {
    const bounded = REPORT.replace("4545 N18W46   222", "4545 N18W46   000")
      .replace("4550 S16W51   227", "4550 S16W51   360");
    const regions = parseNoaaSrsReport(bounded, new Date(NOW).toISOString()).regions;
    expect(regions[0].carringtonLongitudeDeg).toBe(0);
    expect(regions[3].carringtonLongitudeDeg).toBe(360);
  });

  it("fetches only the fixed NOAA URL, coalesces requests, and caches a verified daily report", async () => {
    const fetcher = vi.fn(async () => makeResponse(REPORT));
    const service = createNoaaSrsService({ fetcher: fetcher as typeof fetch, now: () => NOW });
    const [first, concurrent] = await Promise.all([service.current(), service.current()]);
    expect(first).toEqual(concurrent);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(NOAA_SRS_SOURCE_URL, expect.objectContaining({
      redirect: "error", cache: "no-store", signal: expect.any(AbortSignal),
      headers: {Accept:"text/plain"},
    }));
    expect(await service.current()).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not serve a cached receipt after the issue crosses the freshness limit", async () => {
    let clock = Date.parse("2026-10-12T00:29:59Z");
    const fetcher = vi.fn(async () => makeResponse(REPORT));
    const service = createNoaaSrsService({ fetcher: fetcher as typeof fetch, now: () => clock });
    await expect(service.current()).resolves.toMatchObject({complete:true});
    clock = Date.parse("2026-10-12T00:30:01Z");
    await expect(service.current()).rejects.toMatchObject({code:"srs_stale"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries one transient NOAA connection failure without changing source identity", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(makeResponse(REPORT));
    const service = createNoaaSrsService({ fetcher: fetcher as typeof fetch, now: () => NOW });
    await expect(service.current()).resolves.toMatchObject({ complete: true, sourceUrl: NOAA_SRS_SOURCE_URL });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(NOAA_SRS_SOURCE_URL);
    expect(fetcher.mock.calls[1][0]).toBe(NOAA_SRS_SOURCE_URL);
  });

  it("fails closed on stale issue time, malformed text, oversized body, HTML and upstream failure", async () => {
    const cases: Array<{ response: () => Response | Error; code: NoaaSrsError["code"] }> = [
      { response: () => makeResponse(REPORT.replace("2026 Oct 10", "2026 Oct 07").replace("10 Oct 2026", "07 Oct 2026")
        .replaceAll("09/2400Z", "06/2400Z")), code: "srs_stale" },
      { response: () => makeResponse(REPORT.replace("4545 N18W46", "4545 N99W46")), code: "srs_invalid" },
      { response: () => makeResponse(REPORT, { "content-length": "20000" }), code: "srs_invalid" },
      { response: () => makeResponse(REPORT, { "content-type": "text/html" }), code: "srs_invalid" },
      { response: () => new Response(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(REPORT)]),
        { headers: { "content-type": "text/plain" } }), code: "srs_invalid" },
      { response: () => new Error("offline"), code: "srs_unavailable" },
    ];
    for (const { response, code } of cases) {
      const fetcher = vi.fn(async () => {
        const value = response();
        if (value instanceof Error) throw value;
        return value;
      });
      const service = createNoaaSrsService({ fetcher: fetcher as typeof fetch, now: () => NOW });
      await expect(service.current()).rejects.toMatchObject({ code });
      await expect(service.current()).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(code === "srs_unavailable" ? 4 : 2);
    }
  });
});
