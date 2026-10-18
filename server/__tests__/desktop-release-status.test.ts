import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_RELEASE_STATUS_SCHEMA_VERSION,
  desktopReleaseStatusSchema,
} from "@shared/desktop-release";
import { createDesktopReleaseRouter } from "../routes/desktop-release";
import { resolveDesktopReleaseStatus } from "../services/desktop-release";

const validEnvironment = {
  DESKTOP_RELEASE_APPROVED: "1",
  DESKTOP_RELEASE_BINARY_REPOSITORY: "pestypig/casimirbot-desktop-releases",
  DESKTOP_RELEASE_VERSION: "0.1.0-alpha.1",
  DESKTOP_RELEASE_DOWNLOAD_URL:
    "https://github.com/pestypig/casimirbot-desktop-releases/releases/download/desktop-v0.1.0-alpha.1/CasimirBot-0.1.0-alpha.1-x64-setup.exe",
  DESKTOP_RELEASE_SHA256: "a".repeat(64),
  DESKTOP_RELEASE_PUBLISHER: "CasimirBot LLC",
  DESKTOP_RELEASE_PUBLISHED_AT: "2026-08-11T12:00:00.000Z",
  DESKTOP_RELEASE_CASIMIR_CERTIFICATE_HASH: "b".repeat(64),
} as const;

describe("desktop release status", () => {
  it("fails closed when a release has not been explicitly approved", () => {
    expect(resolveDesktopReleaseStatus({})).toEqual({
      schemaVersion: DESKTOP_RELEASE_STATUS_SCHEMA_VERSION,
      available: false,
      approved: false,
      reason: "not_configured",
    });
  });

  it.each([
    ["mutable latest URL", {
      ...validEnvironment,
      DESKTOP_RELEASE_DOWNLOAD_URL:
        "https://github.com/pestypig/casimirbot-desktop-releases/releases/latest/download/CasimirBot-0.1.0-alpha.1-x64-setup.exe",
    }],
    ["mismatched versioned asset", {
      ...validEnvironment,
      DESKTOP_RELEASE_DOWNLOAD_URL:
        "https://github.com/pestypig/casimirbot-desktop-releases/releases/download/desktop-v0.1.1/CasimirBot-0.1.1-x64-setup.exe",
    }],
    ["missing certificate evidence", {
      ...validEnvironment,
      DESKTOP_RELEASE_CASIMIR_CERTIFICATE_HASH: "",
    }],
  ])("rejects %s without exposing partial metadata", (_label, environment) => {
    expect(resolveDesktopReleaseStatus(environment)).toEqual({
      schemaVersion: DESKTOP_RELEASE_STATUS_SCHEMA_VERSION,
      available: false,
      approved: false,
      reason: "invalid_configuration",
    });
  });

  it("returns only validated immutable release metadata", () => {
    const status = resolveDesktopReleaseStatus(validEnvironment);
    expect(desktopReleaseStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({
      available: true,
      approved: true,
      release: {
        version: "0.1.0-alpha.1",
        sha256: "a".repeat(64),
        publisher: "CasimirBot LLC",
        casimirGate: {
          verdict: "PASS",
          certificateHash: "b".repeat(64),
          integrity: "OK",
        },
      },
    });
  });

  it("makes the shared browser schema reject a widened download origin", () => {
    const status = resolveDesktopReleaseStatus(validEnvironment);
    if (!status.available) throw new Error("Expected the valid release fixture");
    const widened = {
      ...status,
      release: {
        ...status.release,
        downloadUrl:
          "https://downloads.example.com/CasimirBot-0.1.0-alpha.1-x64-setup.exe",
      },
    };
    expect(desktopReleaseStatusSchema.safeParse(widened).success).toBe(false);
  });

  it("fails closed when the approved asset belongs to a different repository", () => {
    expect(resolveDesktopReleaseStatus({
      ...validEnvironment,
      DESKTOP_RELEASE_DOWNLOAD_URL: validEnvironment.DESKTOP_RELEASE_DOWNLOAD_URL.replace(
        "casimirbot-desktop-releases",
        "other-releases",
      ),
    })).toMatchObject({ available: false, approved: false, reason: "invalid_configuration" });
  });

  it("serves the contract without caching or sniffing", async () => {
    const app = express();
    app.use("/api", createDesktopReleaseRouter({ environment: validEnvironment }));

    const response = await request(app)
      .get("/api/desktop-release/latest")
      .expect(200)
      .expect("Cache-Control", "public, no-store")
      .expect("X-Content-Type-Options", "nosniff");

    expect(desktopReleaseStatusSchema.parse(response.body).available).toBe(true);
  });
});
