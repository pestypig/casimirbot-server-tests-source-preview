import { describe, expect, it, vi } from "vitest";
import { createSdoLivePreviewService } from "../sdo-live-preview";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const imageResponse = () => new Response(jpeg, { status: 200, headers: {
  "Content-Type": "image/jpeg", "Last-Modified": "Mon, 28 Sep 2026 10:00:00 GMT",
} });

describe("SDO live browse preview", () => {
  it("uses only fixed source URLs, hashes the cached bytes and respects the 15-minute cadence", async () => {
    let time = Date.parse("2026-09-28T10:01:00Z");
    const fetcher = vi.fn(async () => imageResponse()) as unknown as typeof fetch;
    const service = createSdoLivePreviewService({ fetcher, now: () => time });
    const first = await service.latest("aia193");
    expect(fetcher).toHaveBeenCalledWith(
      "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg",
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
    expect(first).toMatchObject({schemaVersion:"solar-live-preview/2",sourceId:"sdo",
      selectionReason:"preferred_fresh",quantitativeComparisonAllowed:false});
    expect(first.observationAt).toBeNull();
    expect(first.productKind).toBe("browse_image");
    expect(first.scienceRunAllowed).toBe(false);
    expect(service.image("aia193", "sdo", first.sha256)).toEqual({bytes:Buffer.from(jpeg),mime:"image/jpeg"});
    expect(service.image("aia171", "sdo", first.sha256)).toBeNull();
    time += 14 * 60_000;
    await service.latest("aia193");
    expect(fetcher).toHaveBeenCalledTimes(1);
    time += 60_000;
    await service.latest("aia193");
    expect(fetcher).toHaveBeenCalledTimes(2);
    time += 46 * 60_000;
    expect((await service.latest("aia193")).stale).toBe(true);
  });

  it("returns a labeled stale frame on a short outage and rejects invalid images", async () => {
    let time = Date.parse("2026-09-28T10:01:00Z");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(imageResponse())
      .mockRejectedValueOnce(new Error("offline"));
    const service = createSdoLivePreviewService({ fetcher: fetcher as typeof fetch, now: () => time });
    await service.latest("hmiMag");
    time += 16 * 60_000;
    expect((await service.latest("hmiMag")).stale).toBe(true);

    const invalid = createSdoLivePreviewService({ fetcher: vi.fn(async () =>
      new Response("not jpeg", { headers: { "Content-Type": "image/jpeg" } })) as typeof fetch });
    await expect(invalid.latest("aia171")).rejects.toThrow("solar_preview_unavailable");
  });

  it("serves the grayscale HMI continuum browse image without inventing an exposure time", async () => {
    const fetcher = vi.fn(async () => imageResponse()) as unknown as typeof fetch;
    const service = createSdoLivePreviewService({
      fetcher, now: () => Date.parse("2026-09-28T10:01:00Z"),
    });
    const result = await service.latest("hmiContinuum");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMII.jpg",
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
    expect(result).toMatchObject({
      channel: "hmiContinuum", sourceId: "sdo", source: "NASA/SDO",
      instrument: "HMI", label: "HMI continuum intensitygram (gray)",
      productKind: "browse_image", wavelength_A: null, observationAt: null,
      upstreamLastModifiedAt: "2026-09-28T10:00:00.000Z",
      stale: false, scienceRunAllowed: false, quantitativeComparisonAllowed: false,
    });
    expect(service.image("hmiContinuum", "sdo", result.sha256))
      .toEqual({ bytes: Buffer.from(jpeg), mime: "image/jpeg" });
    expect(service.image("hmiContinuum", "suvi-primary", result.sha256)).toBeNull();
  });
});
