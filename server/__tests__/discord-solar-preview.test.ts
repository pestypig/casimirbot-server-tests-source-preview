import { afterEach, describe, expect, it, vi } from "vitest";
import { mayShareStarWatcherPreview, runDiscordSolarPreview } from "../services/discord/discord-solar-preview";
import { createSdoLivePreviewService } from "../services/solar-research/sdo-live-preview";

const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const now = Date.parse("2026-10-10T12:00:00Z");

function previewService(lastModified = new Date(now).toUTCString()) {
  const fetcher = vi.fn(async () => new Response(imageBytes, {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Last-Modified": lastModified },
  }));
  return { fetcher, preview: createSdoLivePreviewService({ fetcher: fetcher as typeof fetch, now: () => now }) };
}

describe("Discord Star Watcher solar preview disclosure", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses an exact server-side profile allowlist for user accounts", () => {
    vi.stubEnv("DISCORD_SOLAR_PREVIEW_ALLOWED_PROFILE_IDS", "profile-1, profile-2");
    expect(mayShareStarWatcherPreview("user", "profile-1")).toBe(true);
    expect(mayShareStarWatcherPreview("user", "profile-2")).toBe(true);
    expect(mayShareStarWatcherPreview("user", "profile-3")).toBe(false);
    expect(mayShareStarWatcherPreview("user", "profile-1-extra")).toBe(false);
    expect(mayShareStarWatcherPreview("user", "", () => true)).toBe(false);
    expect(mayShareStarWatcherPreview(null, "profile-1")).toBe(false);
  });

  it("rejects unlinked, public-profile, and unsupported-channel requests before fetching", async () => {
    const { fetcher, preview } = previewService();
    const readAccountType = vi.fn(async () => "user" as const);
    expect(await runDiscordSolarPreview({ profileId: "", channel: "aia193" },
      { readAccountType, preview })).toMatchObject({ ok: false, error: "solar_preview_channel_unsupported" });
    expect(await runDiscordSolarPreview({ profileId: "profile-1", channel: "bad" },
      { readAccountType, preview })).toMatchObject({ ok: false, error: "solar_preview_channel_unsupported" });
    expect(await runDiscordSolarPreview({ profileId: "profile-1", channel: "aia193" },
      { readAccountType, privateProfileAllowed: () => false, preview }))
      .toMatchObject({ ok: false, error: "solar_preview_account_policy_blocked" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns one exact fresh frame for a linked developer as browse evidence", async () => {
    const { preview } = previewService();
    const result = await runDiscordSolarPreview({ profileId: "profile-1", channel: "aia193" },
      { readAccountType: async () => "developer", preview });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.bytes).toEqual(imageBytes);
    expect(result.file.filename).toMatch(/^star-watcher-aia193-[a-f0-9]{12}\.jpg$/);
    expect(result.content).toContain(`Frame SHA-256: ${result.sha256}`);
    expect(result.content).toContain("not a verified observation time or science result");
  });

  it("admits only an exact linked private-preview profile without promoting its user account", async () => {
    const { preview } = previewService();
    const options = { readAccountType: async () => "user" as const,
      privateProfileAllowed: (id: string) => id === "profile-1", preview };
    const allowed = await runDiscordSolarPreview({ profileId: "profile-1", channel: "aia193" }, options);
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.file.bytes).toEqual(imageBytes);
    expect(await runDiscordSolarPreview({ profileId: "profile-2", channel: "aia193" }, options))
      .toMatchObject({ ok: false, error: "solar_preview_account_policy_blocked" });
  });

  it("does not share a fetched frame after the private-preview grant is removed", async () => {
    const { preview } = previewService();
    let reads = 0;
    expect(await runDiscordSolarPreview({ profileId: "profile-1", channel: "aia193" }, {
      readAccountType: async () => "user",
      privateProfileAllowed: () => ++reads === 1,
      preview,
    })).toMatchObject({ ok: false, error: "solar_preview_account_policy_blocked" });
  });

  it("rejects a stale frame and a profile whose developer access was revoked during retrieval", async () => {
    const stale = previewService(new Date(now - 2 * 60 * 60_000).toUTCString());
    expect(await runDiscordSolarPreview({ profileId: "profile-1", channel: "aia193" },
      { readAccountType: async () => "developer", preview: stale.preview }))
      .toMatchObject({ ok: false, error: "solar_preview_stale" });

    const fresh = previewService();
    const accountTypes: Array<"developer" | "user"> = ["developer", "user"];
    expect(await runDiscordSolarPreview({ profileId: "profile-1", channel: "aia193" },
      { readAccountType: async () => accountTypes.shift() ?? "user", preview: fresh.preview }))
      .toMatchObject({ ok: false, error: "solar_preview_account_policy_blocked" });
  });
});
