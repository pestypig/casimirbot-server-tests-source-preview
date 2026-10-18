import { describe, expect, it } from "vitest";
import {
  validateCivilizationSourceMeasurementCollectionV1,
} from "@shared/civilization-source-measurement";
import {
  buildTraversabilityAtlasFromMeasurements,
  validateCivilizationTraversabilityAtlasV1,
} from "@shared/civilization-traversability-atlas";
import {
  CIVILIZATION_LIVE_SOURCE_REGISTRY,
  normalizeCopernicusMarinePointSamples,
  normalizeNoaaCoopsData,
  normalizeNwsAlerts,
  normalizeNwsLatestObservation,
  normalizeUsgsEarthquakeGeoJson,
  planCopernicusMarineRequest,
  planNoaaCoopsRequest,
  planNwsWeatherRequest,
  planUsgsEarthquakeRequest,
} from "../index";

describe("civilization live source adapters", () => {
  it("plans read-only request surfaces for live and historical providers", () => {
    const usgs = planUsgsEarthquakeRequest({
      starttime: "2026-07-01T00:00:00Z",
      endtime: "2026-07-01T01:00:00Z",
      minmagnitude: 4.5,
    });
    const coops = planNoaaCoopsRequest({
      station: "9414290",
      product: "water_level",
      date: "latest",
      units: "metric",
    });
    const nws = planNwsWeatherRequest({
      endpoint: "stations_observations",
      stationId: "KJFK",
    });
    const copernicus = planCopernicusMarineRequest({
      datasetId: "cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i",
      variable: "uo,vo",
      startDatetime: "2026-07-01T00:00:00Z",
      endDatetime: "2026-07-01T06:00:00Z",
    });

    expect(CIVILIZATION_LIVE_SOURCE_REGISTRY.usgs_earthquake_catalog.evidenceOnly).toBe(true);
    expect(usgs.url).toContain("format=geojson");
    expect(usgs.url).toContain("minmagnitude=4.5");
    expect(coops.url).toContain("station=9414290");
    expect(coops.url).toContain("format=json");
    expect(nws.url).toContain("/stations/KJFK/observations/latest");
    expect(copernicus.method).toBe("TOOLBOX_OR_AUTHENTICATED_API");
    expect(CIVILIZATION_LIVE_SOURCE_REGISTRY.copernicus_marine_toolbox.authRequired).toBe(true);
  });

  it("normalizes USGS earthquakes as source-backed seismic measurements", () => {
    const request = planUsgsEarthquakeRequest({ minmagnitude: 5 });
    const collection = normalizeUsgsEarthquakeGeoJson(
      {
        features: [
          {
            id: "us7000test",
            properties: {
              mag: 5.4,
              place: "Test Ridge",
              time: Date.parse("2026-07-01T00:05:00Z"),
              updated: Date.parse("2026-07-01T00:12:00Z"),
              status: "reviewed",
              type: "earthquake",
              url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
            },
            geometry: { type: "Point", coordinates: [-122.4, 37.7, 10] },
          },
        ],
      },
      request,
      { fetchedAt: "2026-07-01T00:15:00.000Z" },
    );

    expect(validateCivilizationSourceMeasurementCollectionV1(collection)).toEqual([]);
    expect(collection.measurements[0]).toMatchObject({
      sourceKind: "usgs_earthquake",
      domain: "seismic_activity",
      quantity: { name: "earthquake_magnitude", value: 5.4 },
    });
  });

  it("normalizes NOAA, NWS, and Copernicus payloads into one atlas", () => {
    const coops = normalizeNoaaCoopsData(
      { data: [{ t: "2026-07-01 00:00", v: "1.23", q: "p" }] },
      planNoaaCoopsRequest({ station: "9414290", product: "water_level", date: "latest" }),
      { fetchedAt: "2026-07-01T00:15:00.000Z", stationLabel: "San Francisco", lat: 37.806, lon: -122.465 },
    );
    const nwsObservation = normalizeNwsLatestObservation(
      {
        properties: {
          timestamp: "2026-07-01T00:10:00+00:00",
          textDescription: "Breezy",
          temperature: { value: 19, unitCode: "wmoUnit:degC" },
          windSpeed: { value: 8, unitCode: "wmoUnit:m_s-1" },
          windDirection: { value: 270, unitCode: "wmoUnit:degree_(angle)" },
        },
        geometry: { coordinates: [-73.78, 40.64] },
      },
      planNwsWeatherRequest({ endpoint: "stations_observations", stationId: "KJFK" }),
      { fetchedAt: "2026-07-01T00:15:00.000Z" },
    );
    const nwsAlerts = normalizeNwsAlerts(
      {
        features: [
          {
            id: "alert:test",
            properties: {
              id: "alert-test",
              sent: "2026-07-01T00:03:00+00:00",
              event: "Marine Weather Statement",
              severity: "Moderate",
              areaDesc: "Coastal waters",
            },
          },
        ],
      },
      planNwsWeatherRequest({ endpoint: "alerts_active", area: "NY" }),
      { fetchedAt: "2026-07-01T00:15:00.000Z" },
    );
    const copernicus = normalizeCopernicusMarinePointSamples(
      [
        {
          sampleId: "north-atlantic-1",
          observedAt: "2026-07-01T00:00:00Z",
          lat: 40,
          lon: -40,
          u: 0.2,
          v: 0.1,
          variable: "ocean_current",
        },
      ],
      planCopernicusMarineRequest({
        datasetId: "cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i",
        variable: "uo,vo",
      }),
      { fetchedAt: "2026-07-01T00:15:00.000Z" },
    );

    for (const collection of [coops, nwsObservation, nwsAlerts, copernicus]) {
      expect(validateCivilizationSourceMeasurementCollectionV1(collection)).toEqual([]);
    }

    const atlas = buildTraversabilityAtlasFromMeasurements({
      scenarioId: "live_source_measurement_demo",
      generatedAt: "2026-07-01T00:16:00.000Z",
      collections: [coops, nwsObservation, nwsAlerts, copernicus],
    });

    expect(validateCivilizationTraversabilityAtlasV1(atlas)).toEqual([]);
    expect(atlas.fieldLayers.map((layer) => layer.kind)).toEqual(
      expect.arrayContaining(["water_level", "atmospheric_wind", "weather_alert", "ocean_current"]),
    );
    expect(atlas.authority.terminal_eligible).toBe(false);
  });
});

