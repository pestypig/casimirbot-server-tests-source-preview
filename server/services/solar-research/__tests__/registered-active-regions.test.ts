import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NOAA_SRS_SOURCE_URL, type NoaaSrsReceipt } from "../noaa-srs";
import { createRegisteredSolarRegionsService } from "../registered-active-regions";
import type { sdoLivePreviewService } from "../sdo-live-preview";

const ID = "192879714";
const IMAGE_AT = "2026-10-10T15:59:00.000Z";
const HEADER_AT = "2026-10-10T15:58:59.700";
const IMAGE_URL = `https://api.helioviewer.org/v2/downloadImage/?id=${ID}&width=512&type=jpg`;
const HEADER_URL = `https://api.helioviewer.org/v2/getJP2Header/?id=${ID}`;
const SHA = "a".repeat(64);
let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 512, height: 512, channels: 3,
    background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
});

const image: Awaited<ReturnType<typeof sdoLivePreviewService.fromSource>> = {
  schemaVersion: "solar-live-preview/2", source: "Helioviewer / NASA SDO HMI",
  sourceId: "helioviewer-hmi", selectionReason: "explicit_source", productKind: "browse_image",
  channel: "hmiContinuum", label: "HMI continuum intensitygram (Helioviewer)",
  instrument: "HMI", wavelength_A: null, sourceUrl: IMAGE_URL,
  retrievedAt: "2026-10-10T16:00:00.000Z", upstreamLastModifiedAt: null,
  observationAt: IMAGE_AT, upstreamImageId: ID, sha256: SHA,
  imageUrl: `/api/star-watcher/live-preview/image?channel=hmiContinuum&source=helioviewer-hmi&sha256=${SHA}`,
  stale: false, scienceRunAllowed: false, quantitativeComparisonAllowed: false,
};

const region = (noaaNumber: number, latitudeDeg: number, carringtonLongitudeDeg: number) => ({
  noaaNumber, location: latitudeDeg >= 0 ? "N09W54" : "S14E61",
  latitudeDeg, centralMeridianDistanceDeg: carringtonLongitudeDeg > 166 ? 54 : -61,
  carringtonLongitudeDeg, category: "sunspot" as const, areaMillionths: 260,
  spotClass: "Eki", spotCount: 28, magneticClass: "Beta-Gamma-Delta",
});

const report: NoaaSrsReceipt = {
  schemaVersion: "solar-active-regions-current/1", sourceUrl: NOAA_SRS_SOURCE_URL,
  sourceSha256: "b".repeat(64), issuedAt: "2026-10-10T00:30:00.000Z",
  validAt: "2026-10-10T00:00:00.000Z", fetchedAt: "2026-10-10T16:00:00.000Z",
  complete: true,
  regions: [region(4549, 9, 216), region(4551, -14, 102), region(4559, 0, 346)],
};

function xml(fields: Record<string, string> = {}, hvFields: Record<string, string> = {}) {
  const fits = {
    DATE_OBS: HEADER_AT, TELESCOP: "SDO", INSTRUME: "HMI_FRONT2",
    CONTENT: "CONTINUUM INTENSITY", BUNIT: "DN", QUALITY: "1024",
    NAXIS1: "4096", NAXIS2: "4096",
    CTYPE1: "HPLN-TAN", CTYPE2: "HPLT-TAN", CUNIT1: "arcsec", CUNIT2: "arcsec",
    CRVAL1: "0", CRVAL2: "0", CDELT1: "0.60000002", CDELT2: "0.60000002",
    CRPIX1: "2048.5", CRPIX2: "2048.5", CROTA2: "0",
    CRLN_OBS: "166.83664", CRLT_OBS: "6.1982274",
    DSUN_OBS: "1.4936631e+11", RSUN_REF: "6.9600000e+08",
    ...fields,
  };
  const hv = { HV_ROTATION: "0", ...hvFields };
  const tags = (values: Record<string, string>) => Object.entries(values)
    .map(([key, value]) => `<${key}>${value}</${key}>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?><meta><fits>${tags(fits)}</fits>` +
    `<helioviewer>${tags(hv)}</helioviewer></meta>`;
}

function harness(options: { header?: string; preview?: typeof image; srs?: NoaaSrsReceipt;
  imageBytes?: Buffer; contentType?: string; geometry?: {width:number;height:number;
    refPixelX:number;refPixelY:number;offsetX:number;offsetY:number;rotation:number;scale:number}|null } = {}) {
  const fetcher = vi.fn(async (url: string) => {
    expect(url).toBe(`https://api.helioviewer.org/v2/getJP2Header/?id=${options.preview?.upstreamImageId ?? ID}`);
    return new Response(options.header ?? xml(), {
      headers: { "content-type": options.contentType ?? "text/xml; charset=UTF-8" },
    });
  });
  const preview = {
    fromSource: vi.fn(async () => options.preview ?? image),
    image: vi.fn(() => ({ bytes: options.imageBytes ?? jpeg, mime: "image/jpeg" as const })),
    helioviewerGeometry: vi.fn(() => options.geometry === undefined
      ? { width: 4096, height: 4096, refPixelX: 2048.5, refPixelY: 2048.5,
        offsetX: 0, offsetY: 0, rotation: 0, scale: 0.59887 }
      : options.geometry),
  };
  const srs = { current: vi.fn(async () => options.srs ?? report) };
  return { service: createRegisteredSolarRegionsService({ fetcher: fetcher as typeof fetch,
    preview, srs }), fetcher, preview, srs };
}

describe("image-bound NOAA active-region registration", () => {
  it("binds exact Helioviewer JPEG/header ID and SRS report, with top-down pixels", async () => {
    const { service, preview, fetcher } = harness();
    const result = await service.current("hmiContinuum");
    expect(preview.fromSource).toHaveBeenCalledWith("hmiContinuum", "helioviewer-hmi");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.image.imageUrl).toContain(`sha256=${SHA}`);
    expect(result.image.upstreamImageId).toBe(ID);
    expect(result.image.widthPx).toBe(512);
    expect(result.wcs.headerUrl).toBe(HEADER_URL);
    expect(result.wcs.headerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.wcs.qualityInterpretation).toBe("numeric_flag_only_not_science_admission");
    expect(result.report.sourceSha256).toBe(report.sourceSha256);
    expect(result.registration.rotationAssumption).toBe("fixed_carrington_longitude");
    expect(result.registration.timeDeltaSeconds).toBe(15 * 3600 + 59 * 60);
    expect(result.registration.pixelOrigin).toBe("top_left");
    expect(result.regions[0]).toMatchObject({ noaaNumber: 4549, visible: true, spotCount: 28 });
    expect(result.regions[0].xPx).toBeGreaterThan(380);
    expect(result.regions[0].yPx).toBeLessThan(256); // northern spot above disk center
    expect(result.regions[1].xPx).toBeLessThan(100);
    expect(result.regions[1].yPx).toBeGreaterThan(300); // southern spot below disk center
    expect(result.regions[2]).toMatchObject({ noaaNumber: 4559, visible: false,
      xPx: null, yPx: null, omissionReason: "outside_visible_disk_or_image" });
  });

  it("does not register markers on a preferred SDO JPEG without matching JP2 identity", async () => {
    const { service, fetcher } = harness({ preview: {
      ...image, source: "NASA/SDO", sourceId: "sdo", upstreamImageId: null,
      observationAt: null, sourceUrl: "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMII.jpg",
    } });
    await expect(service.current("hmiContinuum")).rejects.toMatchObject({ code: "image_invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the same exact-source registration contract for an HMI magnetogram", async () => {
    const magId = "192879726";
    const magImage = {
      ...image, channel: "hmiMag" as const, sourceId: "helioviewer-hmi-mag" as const,
      label: "HMI magnetogram (Helioviewer)", upstreamImageId: magId,
      observationAt: "2026-10-10T16:02:45.000Z",
      sourceUrl: `https://api.helioviewer.org/v2/downloadImage/?id=${magId}&width=512&type=jpg`,
      imageUrl: `/api/star-watcher/live-preview/image?channel=hmiMag&source=helioviewer-hmi-mag&sha256=${SHA}`,
    };
    const { service, preview } = harness({ preview: magImage,
      header: xml({ DATE_OBS: "2026-10-10T16:02:44.700",
        CONTENT: "MAGNETOGRAM", BUNIT: "Gauss" }) });
    const result = await service.current("hmiMag");
    expect(preview.fromSource).toHaveBeenCalledWith("hmiMag", "helioviewer-hmi-mag");
    expect(result.image).toMatchObject({ channel: "hmiMag", upstreamImageId: magId });
    expect(result.regions[0]).toMatchObject({ noaaNumber: 4549, visible: true });
  });

  it("rejects different product, rotated WCS, and mismatched observation timestamp", async () => {
    for (const header of [
      xml({ CONTENT: "MAGNETOGRAM", BUNIT: "Gauss" }),
      xml({ CROTA2: "90" }),
      xml({ PC1_1: "1" }),
      xml({}, { HV_ROTATION: "180" }),
    ]) {
      await expect(harness({ header }).service.current("hmiContinuum"))
        .rejects.toMatchObject({ code: "header_invalid" });
    }
    await expect(harness({ header: xml({ DATE_OBS: "2026-10-10T15:50:00.000" }) })
      .service.current("hmiContinuum")).rejects.toMatchObject({ code: "image_header_mismatch" });
  });

  it("fails closed if closest-image geometry cannot prove full-frame JPEG alignment", async () => {
    await expect(harness({ geometry: null }).service.current("hmiContinuum"))
      .rejects.toMatchObject({ code: "image_header_mismatch" });
    await expect(harness({ geometry: { width: 4096, height: 4096,
      refPixelX: 2048.5, refPixelY: 2048.5, offsetX: 40, offsetY: 0,
      rotation: 0, scale: 0.59887 } }).service.current("hmiContinuum"))
      .rejects.toMatchObject({ code: "image_header_mismatch" });
  });

  it("rejects an old report or non-512 JPEG instead of placing dubious labels", async () => {
    await expect(harness({ srs: { ...report, validAt: "2026-10-08T00:00:00.000Z" } })
      .service.current("hmiContinuum")).rejects.toMatchObject({ code: "report_image_time_mismatch" });
    const wrongSize = await sharp({ create: { width: 256, height: 256, channels: 3,
      background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    await expect(harness({ imageBytes: wrongSize }).service.current("hmiContinuum"))
      .rejects.toMatchObject({ code: "image_invalid" });
  });

  it("bounds XML and rejects wrong content type or embedded entities", async () => {
    await expect(harness({ contentType: "text/html" }).service.current("hmiContinuum"))
      .rejects.toMatchObject({ code: "header_invalid" });
    await expect(harness({ header: `<?xml version="1.0"?><!DOCTYPE meta [<!ENTITY x "bad">]><meta/>` })
      .service.current("hmiContinuum")).rejects.toMatchObject({ code: "header_invalid" });
  });
});
