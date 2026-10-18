import { describe, expect, it } from "vitest";
import { isPublicSiteOnlyRuntime, publicClientBuildDirectory, shouldRedirectPublicSitePage } from "../static";

const siteOnly = {
  NODE_ENV: "production",
  CASIMIR_PUBLIC_SITE_ONLY: "1",
} as NodeJS.ProcessEnv;

describe("download-first public site route boundary", () => {
  it("selects only the small site build for the public deployment", () => {
    expect(isPublicSiteOnlyRuntime(siteOnly)).toBe(true);
    expect(publicClientBuildDirectory(siteOnly)).toBe("site");
    expect(publicClientBuildDirectory({ ...siteOnly, CASIMIR_PUBLIC_SITE_ONLY: "0" })).toBe("public");
    expect(publicClientBuildDirectory({ ...siteOnly, CASIMIR_DESKTOP_HOST: "1" })).toBe("public");
  });
  it("keeps public identity and release pages available", () => {
    for (const path of ["/", "/account", "/download", "/sign-in", "/account/reset-password"]) {
      expect(shouldRedirectPublicSitePage(path, siteOnly)).toBe(false);
    }
  });

  it("redirects browser workstation routes only when the production switch is on", () => {
    for (const path of ["/open", "/desktop", "/mobile", "/start", "/agent-access"]) {
      expect(shouldRedirectPublicSitePage(path, siteOnly)).toBe(true);
      expect(shouldRedirectPublicSitePage(path, { ...siteOnly, CASIMIR_PUBLIC_SITE_ONLY: "0" })).toBe(false);
      expect(shouldRedirectPublicSitePage(path, { ...siteOnly, CASIMIR_DESKTOP_HOST: "1" })).toBe(false);
    }
  });
});
