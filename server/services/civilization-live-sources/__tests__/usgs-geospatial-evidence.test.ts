import { describe, expect, it } from "vitest";
import {
  CivilizationGeospatialSourceError,
  civilizationUsgsEvidenceOutputSchema,
  readUsgsGeospatialEvidence,
} from "../usgs-geospatial-evidence";

const query = {
  bbox: [-125, 30, -115, 45] as [number, number, number, number],
  startTime: "2026-09-28T00:00:00Z",
  endTime: "2026-09-29T00:00:00Z",
  minMagnitude: 4.5,
  maxEvents: 2,
};

describe("USGS geospatial evidence", () => {
  it("keeps an observed event and marks an unusable feature and result-limit gap", async () => {
    let requestedUrl = "";
    const fetcher = (async (url: string) => {
      requestedUrl = url;
      return new Response(JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            id: "us-test-1",
            properties: {
              mag: 5.1,
              place: "Observed event",
              time: Date.parse("2026-09-28T12:00:00Z"),
              updated: Date.parse("2026-09-28T12:10:00Z"),
              status: "reviewed",
              url: "https://earthquake.usgs.gov/earthquakes/eventpage/us-test-1",
            },
            geometry: { type: "Point", coordinates: [-120, 38, 8] },
          },
          {
            id: "us-test-2",
            properties: { mag: 4.9, place: "Missing observation time" },
            geometry: { type: "Point", coordinates: [-121, 39, 7] },
          },
        ],
      }), { status: 200, headers: { "Content-Type": "application/geo+json" } });
    }) as typeof fetch;

    const evidence = await readUsgsGeospatialEvidence(query, fetcher);
    expect(new URL(requestedUrl).hostname).toBe("earthquake.usgs.gov");
    expect(new URL(requestedUrl).searchParams.get("limit")).toBe("2");
    expect(evidence.collection.measurements).toHaveLength(1);
    expect(evidence.collection.measurements[0]).toMatchObject({
      measurementId: "measurement:usgs:earthquake:us-test-1",
      observedAt: "2026-09-28T12:00:00.000Z",
      validTo: "2026-09-28T12:00:00.000Z",
      sourceRecordUpdatedAt: "2026-09-28T12:10:00.000Z",
      geometry: { coordinates: { lat: 38, lon: -120, depthKm: 8 } },
      sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us-test-1",
    });
    expect(evidence.atlas.fieldLayers).toHaveLength(1);
    expect(evidence.coverage).toMatchObject({
      returnedFeatures: 2,
      normalizedMeasurements: 1,
      possiblyTruncated: true,
    });
    expect(evidence.coverage.missingEvidence).toContain("unusable_source_features");
    expect(evidence.coverage.missingEvidence).toContain("additional_events_may_be_omitted_by_limit");
    expect(evidence.authority.terminal_eligible).toBe(false);
    expect(civilizationUsgsEvidenceOutputSchema.safeParse(evidence).success).toBe(true);
  });

  it("rejects an invalid time window before contacting the provider", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    await expect(readUsgsGeospatialEvidence({
      ...query,
      endTime: "2026-11-01T00:00:00Z",
    }, fetcher)).rejects.toMatchObject({
      name: "CivilizationGeospatialSourceError",
      code: "invalid_time_window",
    } satisfies Partial<CivilizationGeospatialSourceError>);
    expect(called).toBe(false);
  });

  it("treats a valid empty collection as zero observations", async () => {
    const fetcher = (async () => new Response(JSON.stringify({
      type: "FeatureCollection",
      features: [],
    }), { status: 200 })) as typeof fetch;
    const evidence = await readUsgsGeospatialEvidence(query, fetcher);
    expect(evidence.collection.measurements).toEqual([]);
    expect(evidence.coverage.missingEvidence).toEqual([]);
  });
});
