import { describe, expect, it } from "vitest";

import { shouldServeViteIndexFallback } from "../vite";

const requestLike = (path: string, originalUrl = path, accept = "text/html") => ({
  method: "GET",
  path,
  originalUrl,
  headers: { accept },
});

describe("Vite dev fallback routing", () => {
  it("serves the SPA shell for page navigations", () => {
    expect(shouldServeViteIndexFallback(requestLike("/desktop"))).toBe(true);
  });

  it("does not serve index.html for Vite module and html-proxy requests", () => {
    expect(
      shouldServeViteIndexFallback(
        requestLike(
          "/src/components/helix/HelixAskPill.tsx",
          "/src/components/helix/HelixAskPill.tsx?html-proxy&direct&index=0.css",
          "text/css,*/*;q=0.1",
        ),
      ),
    ).toBe(false);
    expect(
      shouldServeViteIndexFallback(
        requestLike("/src/main.tsx", "/src/main.tsx", "*/*"),
      ),
    ).toBe(false);
    expect(
      shouldServeViteIndexFallback(
        requestLike("/@vite/client", "/@vite/client", "*/*"),
      ),
    ).toBe(false);
  });
});
